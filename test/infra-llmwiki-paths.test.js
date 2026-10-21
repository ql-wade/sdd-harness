import assert from 'node:assert/strict';
import { AssertionError } from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I04 — I04 项目LLMWiki MCP、索引与worktree安全路径 的契约检查。
// 规格：infrastructure-tasks.json 的 I04 条目 + infrastructure-plan.md I04 小节。
//
//   ProjectWikiInfra.v1  validate|qualify|probe -> canonical project/wiki/index identity
//                        与真实 MCP 读写观察；宿主入口 ENOENT、直连 venv 写通道挂起时
//                        probe 必须结构化 UNVERIFIED（退出 2 + requiredInputs + plannedSteps），
//                        绝不 mock 转绿、绝不 skip；文件级等价探针（写/读回/索引一致）必须本地实跑。
//   ProjectRoot.v1       projectID/repoID/wikiRoot/worktree 映射；worktree -> canonical main-tree
//                        wiki root（git worktree list 语义）；目录穿越、符号链接越域、指向另一 wiki、
//                        错误 project ID 一律拒绝，且拒绝是硬不变量（关掉 policy 声明也拦得住）。
//   KnowledgeWrite.v1    只有带 approval + source/revision 的 curated 条目可写入并须独立读回；
//                        源码/OpenSpec specs/tasks 勾选/Comet 状态永不是 wiki 事实权威；
//                        未经批准的全 Git 代码摄入不允许；文件存在但独立索引读回不一致 = 失败信号，
//                        绝不因本地文件存在放行归档。
//
// CLI 退出码契约（execution-contract.json cli_contract）：
//   0=PASS，1=输入/前置无效（文件缺失/不可解析/参数错误），2=验证失败（语义违规、UNVERIFIED、读回不一致）。
//
// 负例 fixture 全部在 os.tmpdir() 生成，不向活配置写入任何状态；
// llmwiki/ 内容目录是数据不是本任务的，所有写入只落在 sandbox workspace。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const llmwikiDir = path.join(repoRoot, 'infra', 'delivery', 'llmwiki');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const cliPath = path.join(repoRoot, 'tools', 'infra', 'llmwiki.mjs');
const secretRefsModuleUrl = new URL('../tools/infra/secret-refs.mjs', import.meta.url);

const RUN_TIMEOUT_MS = 120_000;
const DOMAIN_FILES = [
  'package.lock.json',
  'project-root-policy.json',
  'index-policy.json',
  'mcp-profile.json',
];
const SOURCE_REF = 'secret-ref:sdd-harness-pilot/llmwiki-source-read';
const HOST_PATH_OUTPUT_RE = /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
}

function parseJsonOut(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError(`${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

// 把已提交的 llmwiki 域整体拷到 tmp fixture，应用 mutate({dir, read, write, json, writeJson}) 后返回 fixture 目录。
function makeFixtureDir(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i04-'));
  for (const name of DOMAIN_FILES) {
    fs.copyFileSync(path.join(llmwikiDir, name), path.join(dir, name));
  }
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const json = (name) => JSON.parse(read(name));
  const writeJson = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
  mutate({ dir, read, write, json, writeJson });
  return dir;
}

function codes(report) {
  return (report.violations ?? []).map((v) => v.code);
}

test('V_INFRA_I04 contract: committed llmwiki domain validates clean; qualify honors the exit contract', () => {
  const validate = runCli(['validate', '--registry', registryPath, '--dir', llmwikiDir, '--json']);
  assert.equal(validate.status, 0, `validate must PASS on committed files: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.interface, 'ProjectWikiInfra.v1');
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  // 结构化回执绝不回显宿主绝对路径（fixture 目录在 tmp，也必须脱敏）。
  assert.doesNotMatch(validate.stdout, HOST_PATH_OUTPUT_RE, 'validate output must not carry host absolute paths');
  // 四个域文件的公共接口必须在回执中如实呈现。
  for (const key of ['packageLock', 'projectRoot', 'indexPolicy', 'mcpProfile']) {
    assert.ok(report[key], `${key} summary must be present in the validate receipt`);
  }

  // 配置有效 ≠ 运行 ready：qualify 必须诚实 NOT_READY 且退出 2。
  const qualify = runCli(['qualify', '--registry', registryPath, '--dir', llmwikiDir, '--json']);
  assert.equal(qualify.status, 2, 'qualify must exit 2 while evidence is unready');
  const receipt = parseJsonOut(qualify, 'qualify');
  assert.equal(receipt.interface, 'Qualification.v1');
  assert.equal(receipt.ready, false);
  const unverified = Object.entries(receipt.categories).filter(([, c]) => c.status === 'UNVERIFIED');
  assert.ok(unverified.length > 0, 'honest receipt must expose UNVERIFIED categories');
  for (const [, category] of unverified) {
    assert.ok(category.reason && category.reason.length > 0, 'every UNVERIFIED category carries an exact reason');
  }
  // "文件存在不算宿主已发现"：宿主发现与 MCP 写通道必须保持 UNVERIFIED，直到真实宿主证据出现。
  assert.equal(receipt.categories['mcp-host-discovery'].status, 'UNVERIFIED', 'host discovery stays UNVERIFIED (file existence is not discovery)');
  assert.equal(receipt.categories['mcp-write-channel'].status, 'UNVERIFIED', 'MCP write channel stays UNVERIFIED until a real write round-trip');
  assert.equal(receipt.categories['secret-provisioned'].status, 'UNVERIFIED', 'the source-read secret ref is referenced, never provisioned, by this task');
  assert.doesNotMatch(qualify.stdout, HOST_PATH_OUTPUT_RE);

  // 未知命令 / 缺参 / 未知 probe case = 输入无效 → 退出 1。
  assert.equal(runCli(['frobnicate', '--json']).status, 1);
  assert.equal(runCli(['probe', '--json']).status, 1);
  assert.equal(runCli(['probe', '--case', 'not-a-case', '--json']).status, 1);

  // 域文件缺失 = 前置无效 → 退出 1（不是静默跳过）。
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i04-partial-'));
  for (const name of DOMAIN_FILES.filter((n) => n !== 'index-policy.json')) {
    fs.copyFileSync(path.join(llmwikiDir, name), path.join(partial, name));
  }
  const missing = runCli(['validate', '--registry', registryPath, '--dir', partial, '--json']);
  assert.equal(missing.status, 1, 'a missing domain file is an input/prerequisite failure');
  assert.doesNotMatch(missing.stdout + missing.stderr, HOST_PATH_OUTPUT_RE);
});

test('RED worktree safety: escape-denial probe enforces traversal, symlink, foreign-root and project-ID denials for real', () => {
  const result = runCli(['probe', '--case', 'escape-denial', '--dir', llmwikiDir, '--json']);
  assert.equal(result.status, 0, `every containment denial must hold: ${result.stdout}\n${result.stderr}`);
  const report = parseJsonOut(result, 'probe escape-denial');
  assert.equal(report.interface, 'ProjectWikiInfra.v1');
  assert.equal(report.case, 'escape-denial');
  assert.equal(report.status, 'VERIFIED');
  assert.equal(report.executed, true, 'this probe is deterministic and local; it must really execute');

  const denialCodes = (report.denials ?? []).map((d) => d.code);
  // 目录穿越（..）→ 拒绝。
  assert.ok(denialCodes.includes('PATH_TRAVERSAL_DENIED'), `traversal must be denied: ${JSON.stringify(report.denials)}`);
  // 符号链接越域 → 拒绝。
  assert.ok(denialCodes.includes('SYMLINK_ESCAPE_DENIED'), `symlink escape must be denied: ${JSON.stringify(report.denials)}`);
  // 不同 worktree 指向另一 wiki → 拒绝（per-worktree wiki 副本永不是 root）。
  assert.ok(denialCodes.includes('FOREIGN_WIKI_ROOT_DENIED'), `foreign wiki root must be denied: ${JSON.stringify(report.denials)}`);
  // 错误 project ID → 拒绝。
  assert.ok(denialCodes.includes('PROJECT_ID_MISMATCH_DENIED'), `project id mismatch must be denied: ${JSON.stringify(report.denials)}`);
  for (const denial of report.denials) {
    assert.equal(denial.allowed, false, `${denial.code} must record allowed=false`);
    assert.ok(denial.reason && denial.reason.length > 0, 'every denial carries its reason');
  }
  // 正对照：canonical root 内的合法路径必须放行。
  assert.ok(report.positiveControls?.some((c) => c.allowed === true), 'a contained path must resolve (positive control)');
  // 硬不变量：包含性拒绝无条件生效（policy 声明不削弱解析器）。
  assert.equal(report.hardInvariantsHeld, true, 'containment must hold even with policy denial flags disabled');
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE, 'probe output must not carry host absolute paths');
});

test('RED knowledge authority: spec/task checkmarks and unapproved full-git intake are denied as wiki authorities', () => {
  const result = runCli(['probe', '--case', 'escape-denial', '--dir', llmwikiDir, '--json']);
  assert.equal(result.status, 0);
  const report = parseJsonOut(result, 'probe escape-denial authority');

  const denialCodes = (report.knowledgeWrite?.denials ?? []).map((d) => d.code);
  // 源码/正式 spec/tasks 勾选被当 wiki 事实权威 → 拒绝。
  assert.ok(denialCodes.includes('KNOWLEDGE_AUTHORITY_DENIED'), `forbidden authorities must be denied: ${JSON.stringify(report.knowledgeWrite)}`);
  // 未经批准的全 Git 代码摄入 → 拒绝。
  assert.ok(denialCodes.includes('UNAPPROVED_INTAKE_DENIED'), `unapproved full-git intake must be denied: ${JSON.stringify(report.knowledgeWrite)}`);
  // 缺 approval/source/revision 的 curated 条目 → 拒绝。
  assert.ok(denialCodes.includes('ENTRY_ADMISSION_DENIED'), `entries without approval/source/revision must be denied: ${JSON.stringify(report.knowledgeWrite)}`);
  // 正对照：带 approval + source/revision 的 curated 条目可被接纳。
  assert.ok(report.knowledgeWrite?.positiveControls?.some((c) => c.allowed === true), 'an approved curated entry with source/revision must be admitted (positive control)');
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
});

test('RED policy fixtures: semantic violations are rejected at validate time (exit 2)', () => {
  // task 勾选被声明为 wiki 事实权威 → 违反 KnowledgeWrite.v1。
  const taskAuthority = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('index-policy.json');
    policy.knowledgeAuthority.wikiFactAuthorities.push('openspec-tasks');
    writeJson('index-policy.json', policy);
  });
  const taskRun = runCli(['validate', '--registry', registryPath, '--dir', taskAuthority, '--json']);
  assert.equal(taskRun.status, 2, 'task checkmarks must not be declarable as wiki fact authority');
  assert.ok(codes(parseJsonOut(taskRun, 'validate')).includes('KNOWLEDGE_AUTHORITY_FORBIDDEN'), JSON.stringify(taskRun.stdout));

  // 未经批准的全 Git 代码摄入被声明为允许 → 违反 intake 政策。
  const fullGit = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('index-policy.json');
    policy.intake.fullGitIngestWithoutApproval = 'allowed';
    writeJson('index-policy.json', policy);
  });
  const gitRun = runCli(['validate', '--registry', registryPath, '--dir', fullGit, '--json']);
  assert.equal(gitRun.status, 2, 'unapproved full-git intake must not be declarable');
  assert.ok(codes(parseJsonOut(gitRun, 'validate')).includes('UNAPPROVED_INTAKE_FORBIDDEN'));

  // 索引被声明为知识权威 → 违反"索引不覆盖源记录、不改知识授权"。
  const indexAuthority = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('index-policy.json');
    policy.index.knowledgeAuthority = true;
    writeJson('index-policy.json', policy);
  });
  const idxRun = runCli(['validate', '--registry', registryPath, '--dir', indexAuthority, '--json']);
  assert.equal(idxRun.status, 2);
  assert.ok(codes(parseJsonOut(idxRun, 'validate')).includes('INDEX_AS_AUTHORITY_FORBIDDEN'));

  // 写入门禁被关闭（approval 不再必须）→ 拒绝。
  const noApproval = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('index-policy.json');
    policy.knowledgeWrite.requiresApproval = false;
    writeJson('index-policy.json', policy);
  });
  const approveRun = runCli(['validate', '--registry', registryPath, '--dir', noApproval, '--json']);
  assert.equal(approveRun.status, 2);
  assert.ok(codes(parseJsonOut(approveRun, 'validate')).includes('KNOWLEDGE_WRITE_GATE_DISABLED'));

  // ProjectRoot 拒绝声明被关闭 → 拒绝（声明层面）。
  const noTraversal = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('project-root-policy.json');
    policy.denials.traversal = false;
    writeJson('project-root-policy.json', policy);
  });
  const travRun = runCli(['validate', '--registry', registryPath, '--dir', noTraversal, '--json']);
  assert.equal(travRun.status, 2);
  assert.ok(codes(parseJsonOut(travRun, 'validate')).includes('POLICY_DENIAL_DISABLED'));

  // 错误 project ID 绑定 → 拒绝。
  const wrongProject = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('project-root-policy.json');
    policy.projectId = 'pav-legacy';
    writeJson('project-root-policy.json', policy);
  });
  const projRun = runCli(['validate', '--registry', registryPath, '--dir', wrongProject, '--json']);
  assert.equal(projRun.status, 2, 'policy projectId must match the registry project');
  assert.ok(codes(parseJsonOut(projRun, 'validate')).includes('PROJECT_ID_MISMATCH'));

  // canonical wiki root 试图带 .. 逃逸 → 拒绝。
  const escapingRoot = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('project-root-policy.json');
    policy.canonicalWiki.root = 'llmwiki/../../elsewhere';
    writeJson('project-root-policy.json', policy);
  });
  const rootRun = runCli(['validate', '--registry', registryPath, '--dir', escapingRoot, '--json']);
  assert.equal(rootRun.status, 2);
  assert.ok(codes(parseJsonOut(rootRun, 'validate')).includes('CANONICAL_ROOT_NOT_CONTAINED'));

  // package lock：坏 commit / 打开 upGate → 拒绝。
  const badCommit = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('package.lock.json');
    lock.source.commit = 'deadbeef';
    writeJson('package.lock.json', lock);
  });
  const commitRun = runCli(['validate', '--registry', registryPath, '--dir', badCommit, '--json']);
  assert.equal(commitRun.status, 2);
  assert.ok(codes(parseJsonOut(commitRun, 'validate')).includes('LOCK_COMMIT_FORMAT_INVALID'));

  const openGate = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('package.lock.json');
    lock.upGate.enabled = true;
    writeJson('package.lock.json', lock);
  });
  const gateRun = runCli(['validate', '--registry', registryPath, '--dir', openGate, '--json']);
  assert.equal(gateRun.status, 2, 'committed lock must keep the up gate closed');
  assert.ok(codes(parseJsonOut(gateRun, 'validate')).includes('UP_GATE_NOT_CLOSED'));

  // mcp profile 试图僭越宿主注册（双写活配置）→ 拒绝。
  const hostGrab = makeFixtureDir(({ json, writeJson }) => {
    const profile = json('mcp-profile.json');
    profile.registrationScope = 'host-registration';
    writeJson('mcp-profile.json', profile);
  });
  const grabRun = runCli(['validate', '--registry', registryPath, '--dir', hostGrab, '--json']);
  assert.equal(grabRun.status, 2, 'this task produces a component profile only; host registration belongs to the P task via mcp-capabilities.yaml');
  assert.ok(codes(parseJsonOut(grabRun, 'validate')).includes('HOST_REGISTRATION_SCOPE_INVALID'));

  // 不可解析的域文件 → 前置无效，退出 1。
  const broken = makeFixtureDir(({ write }) => {
    write('index-policy.json', '{not json');
  });
  const brokenRun = runCli(['validate', '--registry', registryPath, '--dir', broken, '--json']);
  assert.equal(brokenRun.status, 1);
  assert.doesNotMatch(brokenRun.stdout + brokenRun.stderr, HOST_PATH_OUTPUT_RE);
});

test('RED cross-worktree identity + index consistency: worktree-mcp-readback runs the real MCP channel first and never pretends', () => {
  const result = runCli(['probe', '--case', 'worktree-mcp-readback', '--dir', llmwikiDir, '--json']);
  assert.ok(result.status === 0 || result.status === 2, `probe must honor the exit contract, got ${result.status}: ${result.stdout}`);
  const report = parseJsonOut(result, 'probe worktree-mcp-readback');
  assert.equal(report.interface, 'ProjectWikiInfra.v1');
  assert.equal(report.case, 'worktree-mcp-readback');

  // 两工作树 canonical root 一致（oracle）：只登记事实（计数 + 布尔 + 稳定标签），不回显宿主路径。
  assert.ok(Array.isArray(report.worktrees) && report.worktrees.length >= 1, 'at least the current worktree must be resolved');
  assert.equal(report.worktreesCanonicalRootsConsistent, true, 'every worktree must resolve to the same canonical wiki root');
  for (const wt of report.worktrees) {
    assert.ok(wt.label, 'worktree entries carry a stable label, never a raw host path');
    assert.equal(wt.canonicalRootLabel, report.worktrees[0].canonicalRootLabel, 'all canonical root labels agree');
  }

  const mcp = report.mcpSession ?? {};
  if (result.status === 0) {
    assert.equal(report.status, 'VERIFIED');
    assert.equal(mcp.write?.status, 'VERIFIED', 'exit 0 requires a real MCP write round-trip');
  } else {
    assert.equal(report.status, 'UNVERIFIED');
    assert.ok((report.reason ?? '').length > 0, 'UNVERIFIED requires the exact reason');
    assert.ok(Array.isArray(report.requiredInputs) && report.requiredInputs.length > 0, 'structured UNVERIFIED carries requiredInputs');
    assert.ok(Array.isArray(report.plannedSteps) && report.plannedSteps.length > 0, 'probe must declare its real steps');
  }
  // MCP 通道绝不能被 mock 成 skip。
  assert.doesNotMatch(result.stdout, /"skip"\s*:\s*true/, 'probes must not skip');

  // 文件级等价探针：本地实跑（写/独立读回/索引一致 + 负对照），无论 MCP 通道成败。
  const fileLevel = report.fileLevelEquivalent ?? {};
  assert.equal(fileLevel.executed, true, 'the file-level equivalent probe must really run');
  const stepByName = new Map((fileLevel.steps ?? []).map((s) => [s.step, s]));
  const readback = stepByName.get('independent-file-readback');
  assert.ok(readback, 'an independent file readback step must run');
  assert.equal(readback.status, 'VERIFIED', 'independent file readback must succeed locally');
  const negative = stepByName.get('index-mismatch-detection');
  assert.ok(negative, 'the negative control (file without index row) must run');
  assert.equal(negative.status, 'VERIFIED', 'a file existing without an index row must be DETECTED as inconsistent (gate fires, Kp fail signal)');
  assert.equal(negative.observed?.consistency, 'INCONSISTENT', 'the negative control must record INCONSISTENT — file existence alone never passes');
  const positive = stepByName.get('index-consistent-readback');
  assert.ok(positive, 'the positive control (file + independently registered index row) must run');
  assert.equal(positive.status, 'VERIFIED');
  assert.equal(positive.observed?.consistency, 'CONSISTENT');
  // sandbox workspace 绝不能是仓库的 llmwiki/ 数据目录。
  assert.equal(fileLevel.workspace, 'sandbox', 'file-level probe writes only into a sandbox workspace');
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE, 'probe output must not carry host absolute paths');
});

test('secret-ref discipline: the source-read ref is referenced only, catalog gap reported explicitly, no secret-shaped values', async () => {
  const secretRefs = await import(secretRefsModuleUrl);
  for (const name of DOMAIN_FILES) {
    const doc = JSON.parse(fs.readFileSync(path.join(llmwikiDir, name), 'utf8'));
    const violations = secretRefs.scanForForbiddenValues(doc);
    assert.deepEqual(violations, [], `${name} must contain no secret-shaped values or host paths`);
  }
  const referenced = DOMAIN_FILES.map((name) => fs.readFileSync(path.join(llmwikiDir, name), 'utf8')).join('\n');
  assert.ok(referenced.includes(SOURCE_REF), 'domain files must reference the source-read secret ref');
  const parsed = secretRefs.parseSecretRef(SOURCE_REF);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.project, 'sdd-harness-pilot', 'the ref is project-bound');

  // catalog 缺口必须显式上报（目录归 I01 所有，本任务只引用不登记、不存值）。
  const validate = runCli(['validate', '--registry', registryPath, '--dir', llmwikiDir, '--json']);
  const report = parseJsonOut(validate, 'validate gaps');
  assert.ok(
    (report.catalogGaps ?? []).includes(SOURCE_REF),
    'validate must explicitly report the unregistered ref as a catalogGap instead of passing silently',
  );
});
