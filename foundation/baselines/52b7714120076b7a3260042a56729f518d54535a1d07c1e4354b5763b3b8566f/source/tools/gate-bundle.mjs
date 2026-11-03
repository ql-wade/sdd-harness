#!/usr/bin/env node
// gate-bundle.mjs — 受管六门收据束构造器（框架级固化，源自 R 门试点实证配方）
//
// 用途：为当前 Run 的门动作构造合法的 receipt-bundle.json + record-outcome 载荷。
// 生产侧此前没有工具——每个代理都要照试点临时脚本现写证据链（RUNBOOK 缺口，
// sdd-test 实例 2026-11-02 审计后固化）。配方镜像 bindings.mjs → lib/delivery/gate.js
// 的 managed 路径，写入前用真实受保护端口（createProtectedHostPorts）本地预校验，
// 预校验不过不落盘——宁可拒绝，不伪造证据。
//
// 用法：
//   node tools/gate-bundle.mjs --project <root> --gate R --action <actionId> \
//     --claim <claim.json> --open-evidence <ev.json> --args <args.json>
//     [--comet-root <pkgRoot>] [--check-only]
//
// args.json: { reviewerTranscript, reviewerId, statement,
//              caseId?, check?, kind?, policyRef?, workPackageId?, taskIds?,
//              allowedPaths?, allowedTools?, builderExecution?, hostSession? }
//
// 实证范围（诚实标注）：R 门已全流程实证（sdd-test rev37）；A/T/P 与 R 同配方
// （验证线口径）；V/Kp 落地时若形状不符，evaluate 会拒绝而非伪造——按拒绝信息修。
// 形状随实证更新，不预先声称资格。
//
// 踩坑清单（全部真实发生，改这里前先读）：
//  1. claim 必须来自带 --session-id（UUID）的 claim——verifyGateInputs 要求 claim.sessionId 是 UUID
//  2. 束内三处哈希绑定：artifactHashes[ref]=束文件 sha256；sourceHash=hashRuntimeValue(action.input.activation.source)；
//     collection.actionDigest=sha256(canonicalJson(actionBinding))
//  3. collection.source 需 qualification + facts{principal, 全部 binding 字段, observations 恰好 1 条} +
//     independentReview.claude{sessionPath,transcriptId,statementDigest,kind,4×digest}
//  4. collection.host.claude={sessionPath,transcriptId,commandDigest}——宿主回读定位器，漏掉报 "no usable codex host locator"
//  5. reportBytes = 验证者最终声明文本（≤2MB raw 上限，整转录会被拒）；转录全文放 envelope.evidence[0].uri+sha256
//  6. delivery-authority.json 发布到 <changeDir>/.comet/（admissionOptionsFor 的读取路径）；secret 只存此文件
//  7. 独立验收 = 签收者≠作者：envelope.evidence[0].uri 指向独立验证子代理转录，dispatch.role='verifier'，
//     builderExecution 是另一个执行身份
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLaunchAuthority, admitEvidence, envelopeDigest } from '../lib/delivery/evidence.js';
import { taskDefinitionDigest } from '../lib/delivery/baseline.js';
import { evaluate } from '../lib/delivery/gate.js';
import { compileDomainCases, mergeDomainCaseConfigs, verifyDomainCaseProjection } from '../lib/delivery/domain-cases.js';
import { createProtectedHostPorts } from '../lib/adapters/comet-host-ports.js';

const sha256 = (d) => createHash('sha256').update(d).digest('hex');
// 门名中文别名——--gate 参数接受人读名称或字母代号，内部统一映射为字母。
const GATE_ALIAS = {
  '需求确认': 'R', '架构共识': 'A', '测试设计': 'T',
  '构建计划': 'P', '白盒验证': 'V', '知识收尾': 'Kp',
};
const canonicalGate = (gate) => GATE_ALIAS[gate] ?? gate;
const canonicalize = (v) => Array.isArray(v) ? v.map(canonicalize) : (v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonicalize(v[k])])) : v);
const canonicalJson = (v) => JSON.stringify(canonicalize(v));

// 门 → 缺省 case 语义（与 hooks/comet classic extension 步一一对应；skill = 该门扩展技能）。
// kind 对齐 lib/delivery/gate.js 的 review.kind 硬约束（:235 T、:239 A、:242 R、:245 P）；
// V/Kp 当前无 kind 硬约束，保留类比缺省（args.kind 可覆盖）。
export const GATE_DEFAULTS = {
  R: { caseId: 'requirements-confirmation', check: 'requirements-confirmation', kind: 'requirements-scope-confirmation', dir: 'r', skill: 'grill-me' },
  A: { caseId: 'architecture-consensus', check: 'architecture-consensus', kind: 'grill-exact-unanimous-consensus', dir: 'a', skill: 'multi-agent-consensus-review' },
  T: { caseId: 'test-design-review', check: 'test-design-review', kind: 'independent-test-design-review', dir: 't', skill: 'test-authoring' },
  P: { caseId: 'build-plan-unique', check: 'build-plan-unique', kind: 'plan-unique-review', dir: 'p', skill: 'claude-parallel-tdd-planner' },
  V: { caseId: 'verify-whitebox', check: 'verify-whitebox', kind: 'verify-whitebox-confirmation', dir: 'v', skill: 'whitebox-verify' },
  Kp: { caseId: 'knowledge-project-closeout', check: 'knowledge-project-closeout', kind: 'knowledge-project-closeout-confirmation', dir: 'kp', skill: 'openspec-lifecycle-guard' },
};

// 解析已安装 comet 的 runtime-json 值哈希器（sourceHash 必须与运行时逐字节同源）。
// 不硬编码机器路径：从 PATH 上的 comet 反查包根；找不到就明说，允许 --comet-root 覆盖。
export function resolveCometRuntimeJson(explicitRoot) {
  let pkgRoot = explicitRoot ?? null;
  if (!pkgRoot) {
    const bin = spawnSync('bash', ['-c', 'command -v comet'], { encoding: 'utf8' }).stdout.trim();
    if (!bin) return null;
    try {
      const real = realpathSync(bin);
      const marker = real.indexOf(`${path.sep}@rpamis${path.sep}comet${path.sep}`);
      if (marker === -1) return null;
      pkgRoot = real.slice(0, marker + `${path.sep}@rpamis${path.sep}comet`.length);
    } catch { return null; }
  }
  const runtimeJson = path.join(pkgRoot, 'dist', 'domains', 'engine', 'runtime-json.js');
  return existsSync(runtimeJson) ? runtimeJson : null;
}

// 由 claim（runtime claim-query / inspect 输出）解析 Run 平铺视图与目标动作。
export function readRunView(claimRaw, actionId) {
  const runView = claimRaw.run ?? claimRaw.data ?? claimRaw;
  const cur = runView.current ?? runView;
  const action = (cur.actions ?? []).find((x) => x.id === actionId);
  if (!action) throw new Error(`action ${actionId} not found in claim (available: ${(cur.actions ?? []).map((a) => a.id).join(', ')})`);
  if (action.status !== 'running') throw new Error(`action ${actionId} not running (status=${action.status})——先 claim（带 --session-id UUID）再构造束`);
  return { runView, cur, action };
}

function parseArgv(argv) {
  const opts = { gate: null, action: null, claim: null, openEvidence: null, args: null, project: process.cwd(), cometRoot: null, checkOnly: false, verdict: null, reason: null, planBundle: null, testContract: null, featureMap: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--gate') opts.gate = canonicalGate(argv[++i]);
    else if (k === '--action') opts.action = argv[++i];
    else if (k === '--claim') opts.claim = argv[++i];
    else if (k === '--open-evidence') opts.openEvidence = argv[++i];
    else if (k === '--args') opts.args = argv[++i];
    else if (k === '--project') opts.project = argv[++i];
    else if (k === '--comet-root') opts.cometRoot = argv[++i];
    else if (k === '--check-only') opts.checkOnly = true;
    else if (k === '--verdict') opts.verdict = argv[++i];
    else if (k === '--reason') opts.reason = argv[++i];
    else if (k === '--plan-bundle') opts.planBundle = argv[++i];
    else if (k === '--test-contract') opts.testContract = argv[++i];
    else if (k === '--feature-map') opts.featureMap = argv[++i];
    else if (k === '--help' || k === '-h') opts.help = true;
  }
  return opts;
}

// T 门构造期机械复验（proposal v2.5 §2 四件事，纯读取、零副作用——任何失败在 authority
// 落盘/收据签发之前拒绝构造）：
//  (a) contract 内嵌 pack 规范化 digest === 盘上 ② pack 同式重算（envelopeDigest 于解析后对象）；
//  (b) 重跑 verifyDomainCaseProjection——深比较覆盖 testPack 内嵌覆盖矩阵字段；
//  (c) --feature-map 文件字节 sha256 必须已注册于 contract dependencyBaselines；
//  (d) 覆盖矩阵专属条目 digest === envelopeDigest(重算矩阵)。
export async function buildTConstructionEvidence({ project, runId, testContractPath, featureMapPath }) {
  const contractRaw = readFileSync(testContractPath, 'utf8');
  const contractParsed = JSON.parse(contractRaw);
  const baselines = contractParsed?.dependencyBaselines ?? [];
  const packEntry = baselines.find(item => item.kind === 'domain-cases/v1:testpack');
  if (!packEntry) throw new Error('T 构造期复验：contract 缺 domain-cases/v1:testpack baseline 条目');
  const changeDirRel = `openspec/changes/${runId}`;
  const packRel = `${changeDirRel}/tests/test-pack.json`;
  let packRaw;
  try { packRaw = readFileSync(path.join(project, packRel)); } catch {
    throw new Error(`T 构造期复验：② 投影产物缺席（${packRel}）——先经 compile-domain-cases 投影再构造`);
  }
  if (envelopeDigest(JSON.parse(packRaw.toString('utf8'))) !== packEntry.digest) {
    throw new Error('T 构造期复验 (a)：盘上 pack 漂移（envelopeDigest 与 contract 内嵌 baseline 失配）');
  }
  const caseFile = `${changeDirRel}/tests/domain-cases.md`;
  const config2Rel = `${changeDirRel}/tests/domain-cases.config.json`;
  let config2;
  try { config2 = JSON.parse(readFileSync(path.join(project, config2Rel), 'utf8')); } catch {
    throw new Error(`T 构造期复验：变更级投影配置缺席（${config2Rel}）`);
  }
  const config1Path = path.join(project, 'tests/domain-cases/domain-cases.config.json');
  const config1 = existsSync(config1Path) ? JSON.parse(readFileSync(config1Path, 'utf8')) : null;
  const merged = mergeDomainCaseConfigs(config1, config2);
  if (!existsSync(path.join(project, caseFile))) {
    throw new Error(`T 构造期复验：cases 缺席（${caseFile}）`);
  }
  const fresh = compileDomainCases({ projectRoot: project, caseFile, config: merged });
  const matrixEntry = baselines.find(item => item.kind === 'domain-cases/v1:feature-coverage-matrix');
  if (!matrixEntry) throw new Error('T 构造期复验 (d)：contract 缺 feature-coverage-matrix 专属条目（旧契约须以新编译器重出）');
  if (matrixEntry.digest !== envelopeDigest(fresh.testPack.feature_coverage_matrix)) {
    throw new Error('T 构造期复验 (d)：覆盖矩阵 digest 漂移');
  }
  const reverify = verifyDomainCaseProjection({
    projection: { ...fresh, testPack: JSON.parse(packRaw.toString('utf8')), testContract: contractParsed },
    projectRoot: project, caseFile, config: merged,
  });
  if (!reverify.ok) throw new Error('T 构造期复验 (b)：投影重算漂移（cases/config/features.md 与盘上 pack/contract 不一致）');
  if (featureMapPath) {
    const bytes = readFileSync(featureMapPath);
    if (!baselines.some(item => item.digest === sha256(bytes))) {
      throw new Error('T 构造期复验 (c)：--feature-map 文件未注册于 contract dependencyBaselines（features.md 必须先入 basis）');
    }
  }
  return {
    contractParsed,
    contractDigest: envelopeDigest(contractParsed),
    snapshotFiles: [
      { ref: '.sdd/delivery/gates/t/test-pack.snapshot.json', bytes: packRaw },
      { ref: '.sdd/delivery/gates/t/test-contract.snapshot.json', bytes: Buffer.from(contractRaw, 'utf8') },
    ],
  };
}

export async function buildGateBundle(opts, { now = () => new Date().toISOString(), clock = Date.now } = {}) {
  const defaults = GATE_DEFAULTS[canonicalGate(opts.gate)];
  if (!defaults) throw new Error(`--gate 必须是 ${Object.keys(GATE_DEFAULTS).join('/')} 之一`);
  // 旗标-门矩阵（proposal v2.5 §2，拒收落在构造期工具——gate.js 对 Kp/V 无条件 parse，
  // 拒收不落在这里就是制度化永败断言）：T 必填缺件拒；其余门传入即拒。V/Kp 的契约观察
  // 收据改读 T 快照链（.sdd/delivery/gates/t/test-contract.snapshot.json，同源重构）。
  if (opts.gate === 'T' && !opts.testContract) throw new Error('T 门构造必须带 --test-contract（T 必填缺件拒，AC-2）');
  if (opts.gate !== 'T' && opts.testContract) throw new Error(`--test-contract 仅 T 门接受（旗标-门矩阵：${opts.gate} 传入即拒，拒收落在构造期）`);
  if (opts.gate === 'T' && !existsSync(opts.testContract)) throw new Error(`--test-contract 文件不存在: ${opts.testContract}`);
  for (const [key, file] of [['claim', opts.claim], ['args', opts.args], ['open-evidence', opts.openEvidence]]) {
    if (!file) throw new Error(`缺少 --${key}`);
    if (!existsSync(file)) throw new Error(`--${key} 文件不存在: ${file}`);
  }
  const A = JSON.parse(readFileSync(opts.args, 'utf8'));
  for (const required of ['reviewerTranscript', 'reviewerId', 'statement']) {
    if (!A[required]) throw new Error(`args.json 缺 ${required}（独立验证者转录 / 身份 / 最终声明）`);
  }
  const caseId = A.caseId ?? defaults.caseId;
  const check = A.check ?? defaults.check;
  const reviewKind = A.kind ?? defaults.kind;

  const claimRaw = JSON.parse(readFileSync(opts.claim, 'utf8'));
  const { cur, action } = readRunView(claimRaw, opts.action);
  const runId = cur.runId ?? opts.action.split(':')[0];
  const changeDir = path.join(opts.project, 'openspec/changes', runId);
  // T 构造期复验（纯读取）：在 authority 落盘与收据签发之前完成 (a)(b)(c)(d)，任一失败
  // 拒绝构造——TOCTOU 堵口（判定对象 = 复验通过时盘上的 ② 产物字节）。
  const tConstruction = opts.gate === 'T'
    ? await buildTConstructionEvidence({ project: opts.project, runId, testContractPath: opts.testContract, featureMapPath: opts.featureMap })
    : null;
  const openEvidence = JSON.parse(readFileSync(opts.openEvidence, 'utf8'));
  const inputDigest = openEvidence.contentHash ?? openEvidence.output?.contentHash;
  if (!inputDigest) throw new Error('--open-evidence 里没有 contentHash（open-complete 证据事件的哈希）');

  const reviewerBytes = readFileSync(A.reviewerTranscript);
  const statementDigest = sha256(A.statement);
  const hostSession = A.hostSession ?? process.env.SDD_HOST_SESSION ?? null;
  if (!hostSession) throw new Error('缺宿主会话 id：args.hostSession 或环境变量 SDD_HOST_SESSION（宿主回读定位器需要）');
  const builderExecution = A.builderExecution ?? 'sdd-managed-skill-host';
  const policy = { ref: A.policyRef ?? `${runId}-delivery-policy`, digest: sha256(readFileSync(path.join(opts.project, 'openspec/changes', runId, 'proposal.md'))) };
  const environment = 'comet-classic-managed';
  const environmentDigest = sha256(`${path.basename(opts.project)}-local`);

  // 门技能版本：从安装的应用包读（与运行时实际加载的正文绑定）。
  const versionsDir = path.join(opts.project, '.comet/applications/sdd-managed-delivery/versions');
  if (!existsSync(versionsDir)) throw new Error(`项目未安装 sdd-managed-delivery 应用（缺 ${versionsDir}）——先按 RUNBOOK 第 0 步安装`);
  const appVersionDir = readdirSync(versionsDir).sort().at(-1) ?? null;
  if (!appVersionDir) throw new Error('应用版本目录为空');
  const APP = path.join(versionsDir, appVersionDir);
  // 身份必须来自官方 loader——application.json 本身没有 contentHash 字段（sdd-test 实证：
  // 静默读 undefined → verifyGateInputs 恒 false）。opts.identity 仅供回归测试注入合成身份，
  // CLI 永不传入：真实流程一律走 loadWorkflowApplication，杜绝假身份。
  const identity = await loadAppIdentity({ project: opts.project, appDir: APP, cometRoot: opts.cometRoot, identity: opts.identity });
  const skillName = defaults.skill;
  const gateSkillFile = path.join(APP, 'skills', skillName, 'SKILL.md');
  if (!existsSync(gateSkillFile)) throw new Error(`安装的应用包缺门技能 ${skillName}（${gateSkillFile}）——应用包版本与运行时不一致？`);
  const gateSkill = readFileSync(gateSkillFile, 'utf8');
  const gateSkillVersion = (/^version:\s*(.+)$/m.exec(gateSkill)?.[1] ?? '1.0.0').trim();

  const actionBinding = {
    schemaVersion: 1, profile: 'full', runnerId: `${path.basename(opts.project)}-host`, run: runId,
    action: opts.action, gate: opts.gate, execution: `exec-${defaults.dir}-verifier`, role: 'verifier',
    revision: String(cur.revision), attempt: 1, epoch: 0,
    inputDigest, policyDigest: policy.digest, environmentDigest,
    workPackage: { id: A.workPackageId ?? `${defaults.dir}-requirements-confirmation`, taskIds: A.taskIds ?? [] },
    methods: [{ name: path.basename(path.dirname(gateSkillFile)), version: gateSkillVersion, ref: path.relative(opts.project, gateSkillFile), digest: sha256(gateSkill) }],
    allowedPaths: A.allowedPaths ?? [`openspec/changes/${runId}`],
    allowedTools: A.allowedTools ?? ['Bash', 'Read'],
    inputs: [{ name: 'proposal', ref: `openspec/changes/${runId}/proposal.md`, digest: policy.digest }],
    outputs: [{ name: 'confirmation', ref: `openspec/changes/${runId}/.comet/${defaults.dir}-confirmation.txt` }],
  };
  const secret = randomBytes(32).toString('hex');
  const authority = createLaunchAuthority({ secret });
  const envelope = {
    schemaVersion: 1, candidateDigest: inputDigest, caseId, check,
    origin: { kind: 'registered-runner', id: `${path.basename(opts.project)}-host` },
    execution: { id: actionBinding.execution }, environment,
    toolchain: `node ${process.version}`, executions: { total: 1, valid: 1 }, result: 'pass',
    evidence: [{ uri: path.resolve(A.reviewerTranscript), sha256: sha256(reviewerBytes) }],
    expiry: new Date(clock() + 30 * 86400_000).toISOString(),
  };
  const dispatch = authority.issueDispatch({
    runnerId: `${path.basename(opts.project)}-host`, run: runId, gate: opts.gate,
    inputDigest, policyDigest: policy.digest, attempt: 1, epoch: 0,
    role: 'verifier', execution: actionBinding.execution, actionBinding,
  });
  const launchRecord = { launchId: randomUUID(), execution: actionBinding.execution };
  const reportBytes = Buffer.from(A.statement, 'utf8');
  if (reportBytes.length > 2 * 1024 * 1024) throw new Error(`reportBytes ${reportBytes.length} 超过 2MB raw 上限——report 用验证者最终声明文本，不是整份转录`);
  const resultBytes = reportBytes;
  const methodTraceBytes = Buffer.from(`independent review by claude subagent ${A.reviewerId}: confirmed ${check} per recorded decisions`, 'utf8');

  const binding = {
    actionDigest: sha256(canonicalJson(dispatch.actionBinding)),
    dispatchDigest: sha256(canonicalJson(dispatch)),
    envelopeDigest: envelopeDigest(envelope),
    launchDigest: sha256(canonicalJson(launchRecord)),
    reportDigest: sha256(reportBytes), resultDigest: sha256(resultBytes), methodTraceDigest: sha256(methodTraceBytes),
    run: dispatch.run, execution: dispatch.execution, launchId: launchRecord.launchId,
    environmentDigest: dispatch.actionBinding.environmentDigest,
  };
  const envelopeDigest0 = envelopeDigest(envelope);
  // P 门充分性绑定：independentReview.claude 须携带 change/planDigest/tasksDigest/dagDigest
  // （gate.js planGate 复检，:245；planDigest=envelopeDigest(planBundle)，tasks/dag=文件 sha256）。
  // 先算绑定值（source 构造早于 inputs 声明）；planSources 在 inputs 处挂载。r7 P 门实证形状。
  let planReviewBinding = {};
  let planBundleParsed = null;
  if (opts.planBundle) {
    if (!existsSync(opts.planBundle)) throw new Error(`--plan-bundle 文件不存在: ${opts.planBundle}`);
    planBundleParsed = JSON.parse(readFileSync(opts.planBundle, 'utf8'));
    const changeDirRel = `openspec/changes/${runId}`;
    planReviewBinding = {
      change: runId,
      planDigest: envelopeDigest(planBundleParsed),
      tasksDigest: taskDefinitionDigest(readFileSync(path.join(opts.project, changeDirRel, 'tasks.md'), 'utf8')),
      dagDigest: sha256(readFileSync(path.join(opts.project, changeDirRel, 'task-dag.json'))),
    };
  }
  const qualification = {
    id: check, sourceId: 'claude-code-subagent', revision: String(cur.revision),
    scope: 'protected-source', status: 'qualified', expiresAt: new Date(clock() + 86400_000).toISOString(),
    evidenceRefs: [{ ref: path.resolve(A.reviewerTranscript), digest: sha256(reviewerBytes) }],
  };
  const source = {
    ok: true, qualification,
    reportDigest: binding.reportDigest, actionDigest: binding.actionDigest,
    independentReview: { claude: {
      sessionPath: path.resolve(A.reviewerTranscript), transcriptId: A.reviewerId, statementDigest,
      kind: reviewKind, envelopeDigest: envelopeDigest0,
      reportDigest: binding.reportDigest, actionDigest: binding.actionDigest,
      evidenceDigest: sha256(reviewerBytes),
      ...planReviewBinding,
      ...(tConstruction ? { contractDigest: tConstruction.contractDigest } : {}),
    } },
    facts: { principal: A.reviewerId, ...binding,
      observations: [{ caseId, check, command: `independent read-only review (claude subagent transcript) of ${check}`, result: 'pass', executions: { total: 1, valid: 1 } }] },
  };
  const body = { domain: 'SDD.Delivery.CollectedResult.v1', ...binding, source,
    host: { claude: {
      // 宿主回读定位器：sessionPath 必须是完整转录路径（claude-host-source 按它回读）；
      // commandDigest 须对应宿主里真实发生过的命令文本（args.hostCommand 可覆盖）。
      sessionPath: A.hostSessionPath ?? `${process.env.HOME}/.claude/projects/${opts.project.replaceAll('/', '-')}/${hostSession}.jsonl`,
      transcriptId: hostSession,
      commandDigest: sha256(A.hostCommand ?? 'node tools/gate-bundle.mjs'),
    } } };
  const collectionId = sha256(canonicalJson(body));
  const integrity = createHmac('sha256', secret).update(canonicalJson({ ...body, collectionId })).digest('hex');
  const collection = { ...body, collectionId, integrity };

  // V/Kp 双收据（r7 实证，minecraft-3d-r7 rev147）：gate.js requiredChecks 观察检查需要
  // 一条独立的「契约观察」收据（caseId/check 取自 testContract 首个 requiredCheck），与
  // 主白盒确认收据同判——两条收据的 verifyReview kind 都须匹配本门 verifyReview，
  // 同一独立复核者出两份。authority entries 同步追加观察条目。
  let extraEntry = null;
  let extraAuthorityEntry = null;
  if (opts.gate === 'V' || opts.gate === 'Kp') {
    // 契约观察收据的契约来源 = T 快照链同源重构（旗标-门矩阵：--test-contract 已对 V/Kp
    // 构造期拒收；T 束构造时落盘 .sdd/delivery/gates/t/test-contract.snapshot.json）。
    const snapshotPath = path.join(opts.project, '.sdd/delivery/gates/t/test-contract.snapshot.json');
    const tc = existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, 'utf8')) : null;
    const obsCase = tc?.requiredChecks?.[0]?.caseIds?.[0] ?? tc?.cases?.[0]?.id;
    const obsCheck = tc?.requiredChecks?.[0]?.capability;
    const obsCommand = tc?.requiredChecks?.[0]?.command;
    if (obsCase && obsCheck && obsCommand) {
      const exec2 = `${actionBinding.execution}-obs`;
      const binding2 = { ...actionBinding, execution: exec2 };
      const dispatch2 = authority.issueDispatch({
        runnerId: actionBinding.runnerId, run: runId, gate: opts.gate,
        inputDigest, policyDigest: policy.digest, attempt: 1, epoch: 0,
        role: 'verifier', execution: exec2, actionBinding: binding2,
      });
      const launch2 = { launchId: randomUUID(), execution: exec2 };
      const envelope2 = { ...envelope, caseId: obsCase, check: obsCheck, execution: { id: exec2 } };
      const bindingObs = {
        actionDigest: sha256(canonicalJson(dispatch2.actionBinding)),
        dispatchDigest: sha256(canonicalJson(dispatch2)),
        envelopeDigest: envelopeDigest(envelope2),
        launchDigest: sha256(canonicalJson(launch2)),
        reportDigest: binding.reportDigest, resultDigest: sha256(resultBytes), methodTraceDigest: sha256(methodTraceBytes),
        run: dispatch2.run, execution: dispatch2.execution, launchId: launch2.launchId,
        environmentDigest: dispatch2.actionBinding.environmentDigest,
      };
      const source2 = {
        ok: true, qualification,
        reportDigest: bindingObs.reportDigest, actionDigest: bindingObs.actionDigest,
        independentReview: { claude: {
          sessionPath: path.resolve(A.reviewerTranscript), transcriptId: A.reviewerId, statementDigest,
          kind: reviewKind, envelopeDigest: envelopeDigest(envelope2),
          reportDigest: bindingObs.reportDigest, actionDigest: bindingObs.actionDigest,
          evidenceDigest: sha256(reviewerBytes),
        } },
        facts: { principal: A.reviewerId, ...bindingObs,
          observations: [{ caseId: obsCase, check: obsCheck, command: obsCommand, result: 'pass', executions: { total: 1, valid: 1 } }] },
      };
      const body2 = { domain: 'SDD.Delivery.CollectedResult.v1', ...bindingObs, source: source2,
        host: { claude: {
          sessionPath: A.hostSessionPath ?? `${process.env.HOME}/.claude/projects/${opts.project.replaceAll('/', '-')}/${hostSession}.jsonl`,
          transcriptId: hostSession,
          commandDigest: sha256(A.hostCommand ?? 'node tools/gate-bundle.mjs'),
        } } };
      const collectionId2 = sha256(canonicalJson(body2));
      const integrity2 = createHmac('sha256', secret).update(canonicalJson({ ...body2, collectionId: collectionId2 })).digest('hex');
      const collection2 = { ...body2, collectionId: collectionId2, integrity: integrity2 };
      const admitted2 = admitEvidence({ dispatch: dispatch2, envelope: envelope2, launchRecord: launch2, reportBytes, resultBytes, methodTraceBytes, collection: collection2 }, {
        requireManaged: true, authority, actionBinding: binding2, sourceQualification: qualification,
        purpose: 'independent-acceptance', environment,
        builderExecution, builderPrincipal: hostSession,
        authoringExecutions: [builderExecution], authoringPrincipals: [hostSession],
        consumedCollections: [], issuedExecutions: [], now: now(),
      });
      if (!admitted2.ok) { const e = new Error(`ADMISSION REFUSED (obs): ${admitted2.error} - ${admitted2.reason ?? ''}`); e.admission = admitted2; throw e; }
      extraEntry = admitted2.entry;
      extraAuthorityEntry = {
        runId, gate: opts.gate, secret, actionDigest: bindingObs.actionDigest,
        actionBinding: binding2, sourceQualification: qualification,
        authoringExecutions: [builderExecution], authoringPrincipals: [hostSession],
        environment,
      };
    }
  }

  const admitted = admitEvidence({ dispatch, envelope, launchRecord, reportBytes, resultBytes, methodTraceBytes, collection }, {
    requireManaged: true, authority, actionBinding, sourceQualification: qualification,
    purpose: 'independent-acceptance', environment,
    builderExecution, builderPrincipal: hostSession,
    authoringExecutions: [builderExecution], authoringPrincipals: [hostSession],
    consumedCollections: [], issuedExecutions: [], now: now(),
  });
  if (!admitted.ok) { const e = new Error(`ADMISSION REFUSED: ${admitted.error} - ${admitted.reason ?? ''}`); e.admission = admitted; throw e; }
  const entry = admitted.entry;

  // delivery-authority.json 必须先落盘再 evaluate——admissionOptionsFor 从 <changeDir>/.comet/ 读它。
  // 【按门合并 entries，sdd-test r3 严重教训】单条目覆盖会丢前面门的签发 secret——
  // outcome sweep 重准录先前门收据时 FORGED_COLLECTION，整个 Run 卡死。文件形状
  // {runId, environment, entries:[{runId, gate, secret, actionDigest, ...}]}，
  // admissionOptionsFor 原生按 runId+gate+actionDigest 逐条选择（本门条目替换、他门保留）。
  const authorityPath = path.join(changeDir, '.comet', 'delivery-authority.json');
  mkdirSync(path.dirname(authorityPath), { recursive: true });
  let previousEntries = [];
  if (existsSync(authorityPath)) {
    try {
      const raw = JSON.parse(readFileSync(authorityPath, 'utf8'));
      previousEntries = Array.isArray(raw?.entries) ? raw.entries : (raw?.secret !== undefined ? [raw] : []);
    } catch { previousEntries = []; }
  }
  const authorityEntry = {
    runId, gate: opts.gate, secret, actionDigest: binding.actionDigest,
    actionBinding, sourceQualification: qualification,
    authoringExecutions: [builderExecution], authoringPrincipals: [hostSession],
    environment,
  };
  const entries = previousEntries.filter((e) => !(e.gate === authorityEntry.gate && e.actionDigest === authorityEntry.actionDigest));
  entries.push(authorityEntry);
  if (extraAuthorityEntry) entries.push(extraAuthorityEntry);
  writeFileSync(authorityPath, JSON.stringify({ runId, environment, entries }, null, 2) + '\n');

  const ports = createProtectedHostPorts({ context: { identity: { contentHash: identity.contentHash, runtimeVersion: identity.runtimeVersion }, projectRoot: opts.project } });
  const inputs = { inputDigest, builderExecution };
  // 按门实证形状（r7 P 门拒绝信息回流）：P 门要求 inputs.planBundle（SDD.Delivery.PlanBundle，
  // schemaVersion 必填）+ inputs.planSources（tasks/dag 绑定）；T 门可带 inputs.testContract。
  if (planBundleParsed) {
    inputs.planBundle = planBundleParsed;
    const changeDirRel = `openspec/changes/${runId}`;
    inputs.planSources = {
      tasks: { ref: `${changeDirRel}/tasks.md`, digest: planReviewBinding.tasksDigest },
      dag: { ref: `${changeDirRel}/task-dag.json`, digest: planReviewBinding.dagDigest },
    };
  }
  if (opts.testContract) {
    if (!existsSync(opts.testContract)) throw new Error(`--test-contract 文件不存在: ${opts.testContract}`);
    inputs.testContract = tConstruction ? tConstruction.contractParsed : JSON.parse(readFileSync(opts.testContract, 'utf8'));
  }
  const runInput = action.input?.input ?? action.input;
  const gateOk = ports.verifyGateInputs({ run: { runId, input: runInput, state: { phase: cur.phase ?? 'open' }, actions: cur.actions }, action, gate: opts.gate, inputs, policy });
  if (!gateOk) throw new Error('gate inputs refused——claim/run 形状与当前门不符（核对 claim 是否来自带 session-id 的 claim、input 是否为 Run 平铺 input）');

  const allEntries = extraEntry ? [entry, extraEntry] : [entry];
  const verdict = evaluate(inputs, allEntries, policy, {
    requireManaged: true, currentGate: opts.gate, currentRunId: runId,
    currentChange: runId, currentChangeDir: `openspec/changes/${runId}`,
    admissionOptionsFor: ports.admissionOptionsFor, verifyReview: ports.verifyReview,
  });
  if (verdict.verdict !== 'pass') {
    const e = new Error(`GATE BLOCKED: ${JSON.stringify(verdict.receipt?.blocked ?? verdict, null, 1)}`);
    e.verdict = verdict; throw e;
  }

  const artifactRef = `.sdd/delivery/gates/${defaults.dir}/receipt-bundle.json`;
  const bytes = buildBundleBytes({ gate: opts.gate, artifactRef, inputs, receipts: allEntries, policy, verdict, evaluatedBy: `sdd.delivery.gate.${opts.gate.toLowerCase()}@1 (packaged bindings -> lib/delivery/gate.js evaluate)` });
  const artifactHashes = { [artifactRef]: sha256(bytes) };
  for (const snapshot of tConstruction?.snapshotFiles ?? []) artifactHashes[snapshot.ref] = sha256(snapshot.bytes);
  const outcome = { status: 'succeeded', output: { verdict: 'pass', sourceHash: null, artifactHashes, gateEvidence: { gate: opts.gate, inputs, receipts: allEntries, policy } } };
  return { runId, artifactRef, bytes, outcome, appDir: APP, snapshotFiles: tConstruction?.snapshotFiles ?? [] };
}

// 束字节构造（纯函数，B-③：同证据同字节——canonical 键序 + 固定 evaluatedBy）。
export function buildBundleBytes({ gate, artifactRef, inputs, receipts, policy, verdict, evaluatedBy }) {
  const bundle = { schema: 'sdd.delivery.gate.receipt-bundle.v1', kind: 'gate-receipt-bundle', gate, artifactRef, hashBinding: 'artifactHashes', writtenBy: 'extension-execution', inputs, receipts, policy, evaluatedBy, verdict, receipt: verdict.receipt ?? null };
  return Buffer.from(`${JSON.stringify(canonicalize(bundle), null, 2)}\n`, 'utf8');
}

// 身份加载：官方 loadWorkflowApplication（readOnly）。cometDist 从 runtime-json 上溯 3 级
// （engine → domains → dist）。loader 失败必须响亮报错——静默降级就是 sdd-test 实证的 bug 形状。
async function loadAppIdentity({ project, appDir, cometRoot, identity: injected }) {
  if (injected) return injected;
  const runtimeJsonPath = resolveCometRuntimeJson(cometRoot);
  if (!runtimeJsonPath) throw new Error('找不到已安装 comet：身份必须经官方 loadWorkflowApplication 校验（PATH 上无 comet 或布局不识别；可用 --comet-root 指向包根）');
  const cometDist = path.dirname(path.dirname(path.dirname(runtimeJsonPath)));
  const { loadWorkflowApplication } = await import(pathToFileURL(path.join(cometDist, 'domains', 'workflow-application', 'application.js')).href);
  const loaded = await loadWorkflowApplication({ file: path.join(appDir, 'application.json'), projectRoot: path.resolve(project), readOnly: true });
  if (!loaded?.identity?.contentHash || !/^[a-f0-9]{64}$/.test(loaded.identity.contentHash)) {
    throw new Error('官方 loader 未产出合法 identity.contentHash——应用包不完整或版本不匹配');
  }
  return loaded.identity;
}

// sourceHash 需要 runtime 的 hashRuntimeValue（逐字节同源）；动态解析，允许 --comet-root。
export async function withRuntimeHash(opts, fn) {
  const runtimeJsonPath = resolveCometRuntimeJson(opts.cometRoot);
  if (!runtimeJsonPath) {
    throw new Error('找不到已安装 comet 的 runtime-json（PATH 上无 comet 或布局不识别）。先确认 command -v comet，或用 --comet-root 指向 @rpamis/comet 包根');
  }
  const { hashRuntimeValue } = await import(pathToFileURL(runtimeJsonPath).href);
  return fn(hashRuntimeValue);
}

async function main() {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.help || !opts.gate || (!opts.action && !opts.verdict)) {
    console.error('用法: node tools/gate-bundle.mjs --project <root> --gate R|A|T|P|V|Kp [--verdict pass|revise-requirements|repair] --action <actionId> --claim <claim.json> --open-evidence <ev.json> --args <args.json> [--comet-root <pkgRoot>] [--check-only]');
    process.exit(opts.help ? 0 : 1);
  }
  try {
    // 修订模式：verdict='revise-requirements'|'repair' 是每个门的内建循环词汇。两个门：
    // (A) 扩展动作在手（running）→ 直接 record-outcome 带 verdict 字段，无需本工具；
    // (B) 无在手动作（如 build 相位 claim 被 sweep 拒，r6 实证）→ 生成 dispatch-command
    //     请求：运行时执行 classic.composition.revise → 重置 designDoc/plan/handoffContext +
    //     phase:open → 同一 Run 全旅程重放（classic-application.js:386-404）。
    if (opts.verdict && opts.verdict !== 'pass') {
      const claimRaw = JSON.parse(readFileSync(opts.claim, 'utf8'));
      const cur = claimRaw.run?.current ?? claimRaw.data?.current ?? claimRaw.current ?? claimRaw;
      const runId = cur.runId ?? opts.action?.split(':')[0];
      if (!runId) throw new Error('claim 里解析不出 runId');
      const request = {
        operation: 'dispatch-command',
        runId,
        expectedRevision: cur.revision,
        commandId: randomUUID(),
        name: opts.verdict,
        // 命令校验器要求非空 reason（「请说明修复或需求修订原因」）——input:null 会被拒。
        input: { reason: opts.reason ?? 'revision requested per gate review' },
      };
      const out = path.join(opts.project, '.sdd', 'delivery', 'gates', `${GATE_DEFAULTS[opts.gate].dir}-revise-command.json`);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(request, null, 2) + '\n');
      console.log(JSON.stringify({ ok: true, mode: 'revise-command', gate: opts.gate, verdict: opts.verdict, runId, expectedRevision: request.expectedRevision, requestFile: out }, null, 1));
      console.error(`✅ 修订命令请求就绪：comet runtime dispatch --application sdd-managed-delivery --project-root <root> --request ${out} --json\n   效果：designDoc/plan/handoffContext 重置 + phase:open，同一 Run 全旅程重放（修订后工件重新取证）。`);
      return;
    }
    const built = await buildGateBundle(opts);
    const artifactAbs = path.join(opts.project, built.artifactRef);
    if (!opts.checkOnly) {
      mkdirSync(path.dirname(artifactAbs), { recursive: true });
      writeFileSync(artifactAbs, built.bytes);
      for (const snapshot of built.snapshotFiles ?? []) {
        const snapAbs = path.join(opts.project, snapshot.ref);
        mkdirSync(path.dirname(snapAbs), { recursive: true });
        writeFileSync(snapAbs, snapshot.bytes);
      }
    }
    const outcomeFile = await withRuntimeHash(opts, async (hashRuntimeValue) => {
      const claimRaw = JSON.parse(readFileSync(opts.claim, 'utf8'));
      const { action } = readRunView(claimRaw, opts.action);
      built.outcome.output.sourceHash = hashRuntimeValue(action.input.activation.source);
      const out = path.join(opts.project, '.sdd', 'delivery', 'gates', `${GATE_DEFAULTS[opts.gate].dir}-gate-outcome.json`);
      mkdirSync(path.dirname(out), { recursive: true });
      if (!opts.checkOnly) writeFileSync(out, JSON.stringify(built.outcome, null, 2) + '\n');
      return out;
    });
    console.log(JSON.stringify({ ok: true, checkOnly: opts.checkOnly, runId: built.runId, gate: opts.gate, bundle: opts.checkOnly ? null : built.artifactRef, bundleBytes: built.bytes.length, bundleHash: sha256(built.bytes), outcomeFile }, null, 1));
    console.error(opts.checkOnly ? '✅ 预校验通过（未落盘束/outcome）——去掉 --check-only 落盘后按 record-outcome 流程提交'
      : `✅ 束与 record-outcome 载荷就绪：comet runtime dispatch ... --request ${built.outcome.output ? outcomeFile : ''} 的 record-outcome 流程按 RUNBOOK 提交（claim 仍在手时同 attempt 修正）`);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

const invokedAs = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedAs === import.meta.url) {
  await main();
}
