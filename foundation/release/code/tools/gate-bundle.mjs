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
import { evaluate } from '../lib/delivery/gate.js';
import { createProtectedHostPorts } from '../lib/adapters/comet-host-ports.js';

const sha256 = (d) => createHash('sha256').update(d).digest('hex');
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
  const opts = { gate: null, action: null, claim: null, openEvidence: null, args: null, project: process.cwd(), cometRoot: null, checkOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--gate') opts.gate = argv[++i];
    else if (k === '--action') opts.action = argv[++i];
    else if (k === '--claim') opts.claim = argv[++i];
    else if (k === '--open-evidence') opts.openEvidence = argv[++i];
    else if (k === '--args') opts.args = argv[++i];
    else if (k === '--project') opts.project = argv[++i];
    else if (k === '--comet-root') opts.cometRoot = argv[++i];
    else if (k === '--check-only') opts.checkOnly = true;
    else if (k === '--help' || k === '-h') opts.help = true;
  }
  return opts;
}

export async function buildGateBundle(opts, { now = () => new Date().toISOString(), clock = Date.now } = {}) {
  const defaults = GATE_DEFAULTS[opts.gate];
  if (!defaults) throw new Error(`--gate 必须是 ${Object.keys(GATE_DEFAULTS).join('/')} 之一`);
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
  writeFileSync(authorityPath, JSON.stringify({ runId, environment, entries }, null, 2) + '\n');

  const ports = createProtectedHostPorts({ context: { identity: { contentHash: identity.contentHash, runtimeVersion: identity.runtimeVersion }, projectRoot: opts.project } });
  const inputs = { inputDigest, builderExecution };
  const runInput = action.input?.input ?? action.input;
  const gateOk = ports.verifyGateInputs({ run: { runId, input: runInput, state: { phase: cur.phase ?? 'open' }, actions: cur.actions }, action, gate: opts.gate, inputs, policy });
  if (!gateOk) throw new Error('gate inputs refused——claim/run 形状与当前门不符（核对 claim 是否来自带 session-id 的 claim、input 是否为 Run 平铺 input）');

  const verdict = evaluate(inputs, [entry], policy, {
    requireManaged: true, currentGate: opts.gate, currentRunId: runId,
    admissionOptionsFor: ports.admissionOptionsFor, verifyReview: ports.verifyReview,
  });
  if (verdict.verdict !== 'pass') {
    const e = new Error(`GATE BLOCKED: ${JSON.stringify(verdict.receipt?.blocked ?? verdict, null, 1)}`);
    e.verdict = verdict; throw e;
  }

  const artifactRef = `.sdd/delivery/gates/${defaults.dir}/receipt-bundle.json`;
  const bytes = buildBundleBytes({ gate: opts.gate, artifactRef, inputs, receipts: [entry], policy, verdict, evaluatedBy: `sdd.delivery.gate.${opts.gate.toLowerCase()}@1 (packaged bindings -> lib/delivery/gate.js evaluate)` });
  const outcome = { status: 'succeeded', output: { verdict: 'pass', sourceHash: null, artifactHashes: { [artifactRef]: sha256(bytes) }, gateEvidence: { gate: opts.gate, inputs, receipts: [entry], policy } } };
  return { runId, artifactRef, bytes, outcome, appDir: APP };
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
  if (opts.help || !opts.gate || !opts.action) {
    console.error('用法: node tools/gate-bundle.mjs --project <root> --gate R|A|T|P|V|Kp --action <actionId> --claim <claim.json> --open-evidence <ev.json> --args <args.json> [--comet-root <pkgRoot>] [--check-only]');
    process.exit(opts.help ? 0 : 1);
  }
  try {
    const built = await buildGateBundle(opts);
    const artifactAbs = path.join(opts.project, built.artifactRef);
    if (!opts.checkOnly) {
      mkdirSync(path.dirname(artifactAbs), { recursive: true });
      writeFileSync(artifactAbs, built.bytes);
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
