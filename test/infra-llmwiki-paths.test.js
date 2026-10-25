import assert from 'node:assert/strict';
import { AssertionError } from 'node:assert';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
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

const fixtureRoots = new Set();
const makeTemp = (prefix) => { const dir = fs.mkdtempSync(prefix); fixtureRoots.add(dir); return dir; };
after(() => { for (const dir of fixtureRoots) fs.rmSync(dir, { recursive: true, force: true }); });

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

const gitCommon = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(gitCommon.status, 0);
const mainTree = path.resolve(repoRoot, gitCommon.stdout.trim(), '..');

function runCli(args, overrides = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, SDD_HOME: process.env.SDD_HOME ?? path.join(mainTree, '.sdd'), SDD_WIKI_HOME: process.env.SDD_WIKI_HOME ?? path.join(mainTree, JSON.parse(fs.readFileSync(path.join(llmwikiDir, 'project-root-policy.json'), 'utf8')).canonicalWiki.root), PYTHONDONTWRITEBYTECODE: '1', ...overrides },
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
}

function parseJsonOut(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError({ message: `${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}` });
  }
}

// 把已提交的 llmwiki 域整体拷到 tmp fixture，应用 mutate({dir, read, write, json, writeJson}) 后返回 fixture 目录。
function makeFixtureDir(mutate) {
  const dir = makeTemp(path.join(os.tmpdir(), 'infra-i04-'));
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
  const partial = makeTemp(path.join(os.tmpdir(), 'infra-i04-partial-'));
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

  assert.equal(report.knowledgeGateSigned, false, 'infrastructure observations never sign Kp');
  assert.equal(report.legacyFileLevelEquivalent?.acceptedForCurrentProof, false);
  if (result.status === 0) {
    assert.equal(report.nativeReadback?.source, 'upstream-documents-and-fts');
    assert.equal(report.nativeReadback?.consistency, 'CONSISTENT');
    assert.equal(report.payloadUnchanged, true);
    assert.equal(report.nativeReadback?.file?.sha256, report.nativeReadback?.index?.contentSha256);
    assert.ok(report.nativeReadback.index.chunkCount > 0);
    assert.ok(report.nativeReadback.index.ftsMatches > 0);
    assert.equal(report.negativeControls.fileWithoutNativeIndex.consistency, 'INCONSISTENT');
    assert.equal(report.negativeControls.changedFileStaleIndex.consistency, 'INCONSISTENT');
  } else {
    assert.equal(report.nativeReadback?.status, 'UNVERIFIED', 'absent execution cannot be replaced by a synthetic local table');
  }
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);

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


test('I04 convergence qualify keeps semantic admission violations before runtime checks', () => {
  const dir = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('project-root-policy.json');
    policy.projectId = 'another-project';
    writeJson('project-root-policy.json', policy);
  });
  const result = runCli(['qualify', '--registry', registryPath, '--dir', dir, '--json']);
  assert.equal(result.status, 2);
  const report = parseJsonOut(result, 'qualify semantic admission');
  assert.ok(codes(report).includes('PROJECT_ID_MISMATCH'), `semantic denial must survive qualify: ${JSON.stringify(report)}`);
  assert.equal(report.runtimeExecuted, false, 'invalid identity must be rejected before any runtime execution');
});

test('I04 convergence probe cannot bypass the registry prerequisite', () => {
  const result = runCli(['probe', '--case', 'escape-denial', '--registry', path.join(os.tmpdir(), 'i04-never-registered.json'), '--dir', llmwikiDir, '--json']);
  assert.equal(result.status, 1, `missing registry must prevent a probe: ${result.stdout}`);
  assert.match(result.stderr, /registry unreadable/);
});


test('I04 convergence MCP storage readback uses the unchanged created entry and native index', () => {
  const result = runCli(['probe', '--case', 'worktree-mcp-readback', '--registry', registryPath, '--dir', llmwikiDir, '--json']);
  const report = parseJsonOut(result, 'actual MCP index readback');
  if (report.mcpSession?.write?.status !== 'VERIFIED') {
    assert.equal(result.status, 2);
    assert.equal(report.nativeReadback?.status, 'UNVERIFIED', 'missing runtime cannot be replaced by a hand-built equivalent');
    return;
  }
  assert.equal(report.nativeReadback?.source, 'upstream-documents-and-fts', `a same-entry native index readback is required: ${JSON.stringify(report)}`);
  assert.equal(report.nativeReadback?.consistency, 'CONSISTENT');
  assert.equal(report.nativeReadback?.file?.sha256, report.nativeReadback?.index?.contentSha256);
  assert.ok(report.nativeReadback?.index?.chunkCount > 0);
  assert.ok(report.nativeReadback?.index?.ftsMatches > 0);
  assert.equal(report.negativeControls?.fileWithoutNativeIndex?.consistency, 'INCONSISTENT');
  assert.equal(report.negativeControls?.changedFileStaleIndex?.consistency, 'INCONSISTENT');
  assert.equal(report.negativeControls?.fileWithoutNativeIndex?.status, 'MISMATCH');
  assert.equal(report.negativeControls?.changedFileStaleIndex?.status, 'MISMATCH');
  assert.equal(report.knowledgeGateSigned, false);
});


for (const command of ['validate', 'qualify', 'probe']) {
  test(`I04 convergence ${command} rejects a registry without registered identity`, () => {
    const dir = makeTemp(path.join(os.tmpdir(), 'i04-empty-registry-'));
    const file = path.join(dir, 'registry.json'); fs.writeFileSync(file, '{}');
    const args = [command, '--registry', file, '--dir', llmwikiDir, '--json'];
    if (command === 'probe') args.push('--case', 'escape-denial');
    const result = runCli(args); const report = parseJsonOut(result, 'registered identity is required');
    assert.equal(result.status, 2, result.stdout);
    assert.ok(codes(report).some((code) => /REGISTRY|PROJECT_ID/.test(code)), result.stdout);
    assert.equal(report.runtimeExecuted, false);
  });
}

test('I04 convergence path admission distinguishes dot segments and exact canonical roots', () => {
  const result = runCli(['probe', '--case', 'escape-denial', '--registry', registryPath, '--dir', llmwikiDir, '--json']);
  const report = parseJsonOut(result, 'path geometry');
  for (const claim of ['release..notes.md', '..draft.md']) {
    const control = report.positiveControls.find((c) => c.claim === claim);
    assert.equal(control?.allowed, true, `a safe filename is not a real parent segment: ${JSON.stringify(control)}`);
  }
  assert.equal(report.exactRootControl?.allowed, false, 'a contained subdirectory is not the one canonical root');
  assert.equal(report.hardInvariantsHeld, true);
});


for (const command of ['validate', 'qualify', 'probe']) {
  test(`I04 convergence ${command} rejects a policy and env that jointly invent a wiki target`, () => {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      const policy = json('project-root-policy.json'); policy.canonicalWiki.root = 'unregistered-project-wiki'; writeJson('project-root-policy.json', policy);
    });
    const args = [command, '--registry', registryPath, '--dir', dir, '--json'];
    if (command === 'probe') args.push('--case', 'escape-denial');
    const result = runCli(args, { SDD_WIKI_HOME: path.join(mainTree, 'unregistered-project-wiki') });
    const report = parseJsonOut(result, 'unregistered wiki target');
    assert.equal(result.status, 2, result.stdout);
    assert.ok(codes(report).includes('ROOT_REGISTRATION_MISMATCH'), result.stdout);
    assert.equal(report.runtimeExecuted, false);
  });
}

test('I04 convergence probe rejects an explicit foreign wiki binding before fixture execution', () => {
  const dir = makeTemp(path.join(os.tmpdir(), 'i04-foreign-binding-'));
  const result = runCli(['probe', '--case', 'escape-denial', '--registry', registryPath, '--dir', llmwikiDir, '--json'], { SDD_WIKI_HOME: dir });
  assert.equal(result.status, 2, result.stdout);
  const report = parseJsonOut(result, 'foreign runtime binding');
  assert.equal(report.runtimeExecuted, false);
  assert.match(report.reason, /CLI_WIKI_BINDING_MISMATCH/);
});

test('I04 convergence unknown CLI options cannot silently bypass declared inputs', () => {
  const result = runCli(['probe', '--case', 'escape-denial', '--unrecognized-binding', 'ignored', '--json']);
  assert.equal(result.status, 1, result.stdout);
});


test('I04 convergence arbitrary interpreter overrides are not executed', () => {
  const dir = makeTemp(path.join(os.tmpdir(), 'i04-interpreter-denial-'));
  const marker = path.join(dir, 'unexpected-execution');
  const fake = path.join(dir, 'fake-python');
  fs.writeFileSync(fake, `#!/bin/sh\nprintf ran > '${marker}'\nexit 0\n`); fs.chmodSync(fake, 0o755);
  const result = runCli(['qualify', '--registry', registryPath, '--dir', llmwikiDir, '--json'], { LLMWIKI_PYTHON: fake });
  assert.equal(result.status, 2);
  const report = parseJsonOut(result, 'unregistered interpreter');
  assert.equal(report.categories['venv-runtime'].status, 'REJECTED');
  assert.equal(fs.existsSync(marker), false);
});

test('I04 convergence required tier and denial fields cannot be omitted to weaken admission', () => {
  for (const mutate of [
    ({ json, writeJson }) => { const p = json('project-root-policy.json'); delete p.denials.traversal; writeJson('project-root-policy.json', p); },
    ({ json, writeJson }) => { const p = json('index-policy.json'); p.tiers.raw.isWikiFactAuthority = true; writeJson('index-policy.json', p); },
    ({ json, writeJson }) => { const p = json('index-policy.json'); p.knowledgeWrite.requiredEntryFields = ['tier','content']; writeJson('index-policy.json', p); },
    ({ json, writeJson }) => { const p = json('package.lock.json'); p.distribution.packages = []; writeJson('package.lock.json', p); },
  ]) {
    const dir = makeFixtureDir(mutate);
    for (const command of ['validate','qualify','probe']) {
      const args = [command,'--registry',registryPath,'--dir',dir,'--json']; if (command==='probe') args.push('--case','escape-denial');
      const result = runCli(args); assert.equal(result.status,2,result.stdout);
      const report = parseJsonOut(result,'required admission fields');
      assert.ok(report.violations.length>0); assert.equal(report.runtimeExecuted,false);
    }
  }
});


test('I04 convergence denial receipts never echo simulated credential-shaped policy values', () => {
  const simulated = 'ghp_' + 'A'.repeat(36);
  for (const [file, field] of [['package.lock.json','commit'],['project-root-policy.json','projectId']]) {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      const p = json(file); if (field === 'commit') p.source.commit = simulated; else p.projectId = simulated; writeJson(file,p);
    });
    const result = runCli(['validate','--registry',registryPath,'--dir',dir,'--json']);
    assert.equal(result.status,2);
    assert.equal((result.stdout+result.stderr).includes(simulated),false,'a rejected field must not be copied into a receipt');
    assert.ok(parseJsonOut(result,'safe refusal').violations.length>0);
  }
});

test('I04 convergence malformed option errors do not echo simulated credentials', () => {
  const simulated = 'ghp_' + 'B'.repeat(36);
  const result = runCli(['validate',`--unknown-${simulated}`,'ignored','--json']);
  assert.equal(result.status,1);
  assert.equal((result.stdout+result.stderr).includes(simulated),false);
});


for (const [name, mutate] of [
  ['wrong component identity', (p) => { p.component = 'another-knowledge-component'; }],
  ['unknown tool', (p) => p.capabilities.push('unregistered-knowledge-tool')],
  ['missing required tool', (p) => { p.capabilities = p.capabilities.filter((tool) => tool !== 'create'); }],
  ['foreign entry prefix', (p) => { p.hostEntry.command = 'unregistered/' + p.hostEntry.command; }],
  ['host registration grab', (p) => { p.hostRegistration.thisFileDoesNotRegister = false; }],
]) {
  test(`I04 convergence profile admission rejects ${name}`, () => {
    const dir = makeFixtureDir(({ json, writeJson }) => { const p = json('mcp-profile.json'); mutate(p); writeJson('mcp-profile.json',p); });
    const result = runCli(['validate','--registry',registryPath,'--dir',dir,'--json']);
    assert.equal(result.status,2,result.stdout);
    assert.ok(parseJsonOut(result,'profile admission').violations.length>0);
  });
}


const INPUT_ENTRYPOINTS = [
  ['validate', ['validate']],
  ['qualify', ['qualify']],
  ['probe escape-denial', ['probe', '--case', 'escape-denial']],
  ['probe worktree-mcp-readback', ['probe', '--case', 'worktree-mcp-readback']],
];

function schemaRejection(entrypoint, dir, label, overrides = {}) {
  const result = runCli([...entrypoint, '--registry', registryPath, '--dir', dir, '--json'], overrides);
  const report = parseJsonOut(result, label);
  assert.equal(result.status, 2, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.equal(report.ok, false, label);
  assert.equal(report.runtimeExecuted, false, label);
  assert.equal(report.executed, false, label);
  assert.equal(report.status, 'REJECTED', label);
  assert.ok(codes(report).includes('DOMAIN_SCHEMA_INVALID'), `${label}: ${result.stdout}`);
  for (const key of ['packageLock', 'projectRoot', 'indexPolicy', 'mcpProfile', 'categories', 'inputs', 'mcpSession']) {
    assert.equal(Object.hasOwn(report, key), false, `${label}: invalid input cannot publish a ${key} observation`);
  }
  assert.doesNotMatch(result.stderr, /TypeError|ReferenceError|at .*llmwiki/);
}

for (const [name, entrypoint] of INPUT_ENTRYPOINTS) {
  test(`I04 input types ${name}: null documents reject before summaries and runtime`, () => {
    const failures = [];
    for (const file of DOMAIN_FILES) {
      const dir = makeFixtureDir(({ writeJson }) => writeJson(file, null));
      try { schemaRejection(entrypoint, dir, file); }
      catch (error) { failures.push({ file, error: error.message }); }
    }
    assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  });
}

test('I04 input types: commit coercion and null tiers are rejected structurally', () => {
  const pin = '075c5b4996ff4e07f9d3c57c1f14fd2b54a955db';
  const failures = [];
  for (const [file, field, value] of [
    ['package.lock.json', 'source.commit', [pin]],
    ['package.lock.json', 'source.commit', { toString: null }],
    ['index-policy.json', 'tiers', null],
  ]) {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      const doc = json(file); const keys = field.split('.'); let parent = doc;
      for (const key of keys.slice(0, -1)) parent = parent[key];
      parent[keys.at(-1)] = value; writeJson(file, doc);
    });
    for (const [name, entrypoint] of INPUT_ENTRYPOINTS) {
      try { schemaRejection(entrypoint, dir, `${name} ${file}:${field}`); }
      catch (error) { failures.push({ name, file, field, value, error: error.message }); }
    }
  }
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});


for (const [name, entrypoint] of INPUT_ENTRYPOINTS) {
  test(`I04 input types ${name}: document arrays, primitives and hostile objects fail closed`, () => {
    const failures = [];
    for (const file of DOMAIN_FILES) {
      for (const value of [[], 'not-a-domain', true, 7, { toString: null }]) {
        const dir = makeFixtureDir(({ writeJson }) => writeJson(file, value));
        try { schemaRejection(entrypoint, dir, `${file} ${JSON.stringify(value)}`); }
        catch (error) { failures.push({ file, value, error: error.message }); }
      }
    }
    assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  });
}

// Independent malformed examples for every field consumed by validation,
// path/runtime helpers or validate summaries; prose metadata is not execution input.
const MALFORMED_DOMAIN_FIELDS = [
  ['package.lock.json', 'interface', ['PackageLock.v1']],
  ['package.lock.json', 'component', { toString: null }],
  ['package.lock.json', 'source', null],
  ['package.lock.json', 'source', []],
  ['package.lock.json', 'source.commit', { toString: null }],
  ['package.lock.json', 'source.treeSha256', ['861319ee0c84d0ef2aa56ee5ac1ee507364785b5fe48295bde17d9e4dcd99357']],
  ['package.lock.json', 'source.treeSha256', { toString: null }],
  ['package.lock.json', 'distribution', []],
  ['package.lock.json', 'distribution.launcher', null],
  ['package.lock.json', 'distribution.launcher.path', ['tools/mcp/llmwiki.sh']],
  ['package.lock.json', 'distribution.launcher.sha256', []],
  ['package.lock.json', 'distribution.requirementsLock', []],
  ['package.lock.json', 'distribution.requirementsLock.sha256', ['678bd7301d80a602336e8fd3a81f98adcd4c5beaec4e2f1f2bfb8d2e04a9e732']],
  ['package.lock.json', 'distribution.requirementsLock.bytes', '154140'],
  ['package.lock.json', 'distribution.packages', null],
  ['package.lock.json', 'distribution.packages.0', null],
  ['package.lock.json', 'distribution.packages.0', []],
  ['package.lock.json', 'distribution.packages.0.name', ['mcp']],
  ['package.lock.json', 'distribution.packages.0.observedVersion', ['1.27.0']],
  ['package.lock.json', 'mcpSession', null],
  ['package.lock.json', 'mcpSession.toolsObserved', { toString: null }],
  ['package.lock.json', 'mcpSession.toolsObserved.0', null],
  ['package.lock.json', 'upGate', []],
  ['package.lock.json', 'upGate.enabled', 'false'],
  ['project-root-policy.json', 'interface', ['ProjectRoot.v1']],
  ['project-root-policy.json', 'component', []],
  ['project-root-policy.json', 'projectId', { toString: null }],
  ['project-root-policy.json', 'repoId', ['ql-wade/sdd-harness']],
  ['project-root-policy.json', 'canonicalWiki', null],
  ['project-root-policy.json', 'canonicalWiki.root', ['.sdd/wiki/sdd-harness']],
  ['project-root-policy.json', 'denials', null],
  ...['traversal', 'symlinkEscape', 'foreignWikiRoot', 'projectIdMismatch', 'uncontainedPaths']
    .map((key) => ['project-root-policy.json', `denials.${key}`, 'true']),
  ['index-policy.json', 'interface', ['IndexPolicy.v1']],
  ['index-policy.json', 'component', []],
  ['index-policy.json', 'tiers', null],
  ['index-policy.json', 'tiers.raw', []],
  ['index-policy.json', 'tiers.staging', null],
  ['index-policy.json', 'tiers.curated', { toString: null }],
  ...['raw', 'staging', 'curated'].flatMap((tier) => [
    ['index-policy.json', `tiers.${tier}.path`, ['wiki/curated/']],
    ['index-policy.json', `tiers.${tier}.isWikiFactAuthority`, String(tier === 'curated')],
  ]),
  ['index-policy.json', 'index', []],
  ...['rebuildable', 'knowledgeAuthority', 'overridesSourceRecords', 'grantsKnowledgeAuthority']
    .map((key) => ['index-policy.json', `index.${key}`, 'false']),
  ['index-policy.json', 'knowledgeAuthority', null],
  ['index-policy.json', 'knowledgeAuthority.wikiFactAuthorities', {}],
  ['index-policy.json', 'knowledgeAuthority.wikiFactAuthorities.0', { toString: null }],
  ['index-policy.json', 'knowledgeWrite', null],
  ...['requiresApproval', 'requiresSourceAndRevision', 'independentReadbackRequired']
    .map((key) => ['index-policy.json', `knowledgeWrite.${key}`, 'true']),
  ['index-policy.json', 'knowledgeWrite.requiredEntryFields', null],
  ['index-policy.json', 'knowledgeWrite.requiredEntryFields.0', {}],
  ['index-policy.json', 'intake', []],
  ['index-policy.json', 'intake.fullGitIngestWithoutApproval', ['forbidden']],
  ['mcp-profile.json', 'interface', ['McpComponentProfile.v1']],
  ['mcp-profile.json', 'component', []],
  ['mcp-profile.json', 'registrationScope', ['component-profile-only']],
  ['mcp-profile.json', 'hostRegistration', null],
  ['mcp-profile.json', 'hostRegistration.thisFileDoesNotRegister', 'true'],
  ['mcp-profile.json', 'hostRegistration.liveConfigDoubleWriteForbidden', 1],
  ['mcp-profile.json', 'hostEntry', []],
  ['mcp-profile.json', 'hostEntry.command', ['${CLAUDE_PROJECT_DIR}/tools/mcp/llmwiki.sh']],
  ['mcp-profile.json', 'hostEntry.args', null],
  ['mcp-profile.json', 'hostEntry.args.0', {}],
  ['mcp-profile.json', 'hostEntry.transport', ['stdio']],
  ['mcp-profile.json', 'capabilities', { toString: null }],
  ['mcp-profile.json', 'capabilities.0', null],
  ['mcp-profile.json', 'observation', null],
  ['mcp-profile.json', 'observation.hostDiscoveryStatus', ['VERIFIED']],
  ['mcp-profile.json', 'observation.hostDiscovered', 'false'],
];

function malformedFieldFixture(file, field, value) {
  return makeFixtureDir(({ json, writeJson }) => {
    const doc = json(file); const keys = field.split('.'); let parent = doc;
    for (const key of keys.slice(0, -1)) parent = parent[key];
    parent[keys.at(-1)] = value; writeJson(file, doc);
  });
}

for (const [name, entrypoint] of INPUT_ENTRYPOINTS) {
  test(`I04 input types ${name}: every consumed nested field is typed before use`, () => {
    const failures = [];
    for (const [file, field, value] of MALFORMED_DOMAIN_FIELDS) {
      const dir = malformedFieldFixture(file, field, value);
      try { schemaRejection(entrypoint, dir, `${file}:${field}`); }
      catch (error) { failures.push({ file, field, error: error.message }); }
    }
    assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  });
}

test('I04 input types: malformed domains cannot reach source inspection or runtime child processes', () => {
  const dir = makeTemp(path.join(os.tmpdir(), 'i04-input-io-guard-'));
  const marker = path.join(dir, 'unexpected-io'); const guard = path.join(dir, 'guard.cjs');
  fs.writeFileSync(guard, `const fs=require('node:fs'),cp=require('node:child_process');
const mark=${JSON.stringify(marker)},source=${JSON.stringify(path.join(mainTree, '.sdd/repos/llmwiki'))};
const write=fs.writeFileSync.bind(fs);
function deny(){write(mark,'unexpected domain/runtime I/O');throw Error('invalid domain reached runtime I/O');}
for(const key of ['readFileSync','readdirSync','statSync','lstatSync','realpathSync']){
 const original=fs[key];fs[key]=function(target,...args){if(typeof target==='string'&&(target===source||target.startsWith(source+'/')))deny();return original.call(this,target,...args);};
 if(original.native)fs[key].native=original.native;
}
const spawn=cp.spawnSync;cp.spawnSync=function(command,args,...rest){
 if(!(command===process.execPath&&args[0].endsWith('/tools/infra/registry.mjs')))deny();return spawn.call(this,command,args,...rest);
};require('node:module').syncBuiltinESMExports();\n`);
  for (const fixture of [
    malformedFieldFixture('package.lock.json', 'source.commit', ['075c5b4996ff4e07f9d3c57c1f14fd2b54a955db']),
    malformedFieldFixture('project-root-policy.json', 'canonicalWiki.root', []),
    malformedFieldFixture('index-policy.json', 'tiers', null),
    malformedFieldFixture('mcp-profile.json', 'capabilities', null),
  ]) {
    for (const [name, entrypoint] of INPUT_ENTRYPOINTS) {
      schemaRejection(entrypoint, fixture, name, { NODE_OPTIONS: `--require ${guard}` });
      assert.equal(fs.existsSync(marker), false, 'invalid input must precede source/path/runtime I/O; guard records attempts before any access');
    }
  }
});

test('I04 input types read-only runtime: missing source does not claim interpreter execution', () => {
  const dir = makeTemp(path.join(os.tmpdir(), 'i04-empty-runtime-'));
  const result = runCli(['qualify', '--registry', registryPath, '--dir', llmwikiDir, '--json'], { SDD_HOME: dir });
  const report = parseJsonOut(result, 'unexecuted interpreter');
  assert.equal(result.status, 2);
  assert.equal(report.sourceRuntimeReady, false);
  assert.equal(report.runtimeExecuted, false, 'workspace admission alone is not actual interpreter execution');
  assert.equal(report.categories['upstream-source'].status, 'UNVERIFIED');
  assert.equal(report.categories['venv-runtime'].status, 'UNVERIFIED');
});


test('I04 input types: minimum valid v1 documents need no optional history or observation claims', () => {
  const minimal = {
    'package.lock.json': {
      interface: 'PackageLock.v1', component: 'llmwiki',
      source: { commit: '075c5b4996ff4e07f9d3c57c1f14fd2b54a955db', treeSha256: '861319ee0c84d0ef2aa56ee5ac1ee507364785b5fe48295bde17d9e4dcd99357' },
      distribution: {
        launcher: { path: 'tools/mcp/llmwiki.sh', sha256: 'bd18bfea155ec0fc8c1ce9fb23414dafbeb94416f4096eb92624eb59932ae863' },
        packages: [{ name: 'mcp', observedVersion: '1.27.0' }],
        requirementsLock: { sha256: '678bd7301d80a602336e8fd3a81f98adcd4c5beaec4e2f1f2bfb8d2e04a9e732', bytes: 154140 },
      },
      mcpSession: { toolsObserved: ['create', 'read', 'search'] }, upGate: { enabled: false },
    },
    'project-root-policy.json': {
      interface: 'ProjectRoot.v1', component: 'llmwiki', projectId: 'sdd-harness-pilot', repoId: 'ql-wade/sdd-harness',
      canonicalWiki: { root: '.sdd/wiki/sdd-harness' },
      denials: { traversal: true, symlinkEscape: true, foreignWikiRoot: true, projectIdMismatch: true, uncontainedPaths: true },
    },
    'index-policy.json': {
      interface: 'IndexPolicy.v1', component: 'llmwiki',
      tiers: {
        raw: { path: 'raw/', isWikiFactAuthority: false },
        staging: { path: 'staging/', isWikiFactAuthority: false },
        curated: { path: 'wiki/curated/', isWikiFactAuthority: true },
      },
      index: { rebuildable: true, knowledgeAuthority: false, overridesSourceRecords: false, grantsKnowledgeAuthority: false },
      knowledgeAuthority: { wikiFactAuthorities: ['approved-curated-entry'] },
      knowledgeWrite: { requiresApproval: true, requiresSourceAndRevision: true, independentReadbackRequired: true,
        requiredEntryFields: ['tier', 'title', 'content', 'approvedBy', 'source', 'revision'] },
      intake: { fullGitIngestWithoutApproval: 'forbidden' },
    },
    'mcp-profile.json': {
      interface: 'McpComponentProfile.v1', component: 'llmwiki', registrationScope: 'component-profile-only',
      hostRegistration: { thisFileDoesNotRegister: true, liveConfigDoubleWriteForbidden: true },
      hostEntry: { command: '${CLAUDE_PROJECT_DIR}/tools/mcp/llmwiki.sh', args: [], transport: 'stdio' },
      capabilities: ['create', 'read', 'search'],
    },
  };
  for (const observation of [undefined, {}, { hostDiscoveryStatus: 'UNVERIFIED', hostDiscovered: false }]) {
    const dir = makeFixtureDir(({ writeJson }) => {
      const docs = structuredClone(minimal);
      if (observation !== undefined) docs['mcp-profile.json'].observation = observation;
      for (const [name, doc] of Object.entries(docs)) writeJson(name, doc);
    });
    const result = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
    const report = parseJsonOut(result, 'minimal v1 configuration');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(report.ok, true);
    assert.deepEqual(report.violations, []);
    assert.equal(report.packageLock.interface, 'PackageLock.v1');
    assert.equal(report.projectRoot.interface, 'ProjectRoot.v1');
    assert.equal(report.indexPolicy.interface, 'IndexPolicy.v1');
    assert.equal(report.mcpProfile.interface, 'McpComponentProfile.v1');
    const escape = runCli(['probe', '--case', 'escape-denial', '--registry', registryPath, '--dir', dir, '--json']);
    assert.equal(escape.status, 0, escape.stdout + escape.stderr);
    assert.equal(parseJsonOut(escape, 'minimal policy geometry').hardInvariantsHeld, true);
  }
});

const DIAGNOSTIC_INPUTS = [...DOMAIN_FILES, 'registry', 'refs'];
const DIAGNOSTIC_SENTINELS = [
  { text: 'PRIV3KEY_invalid_json', fragments: ['PRIV3KEY'] },
  { text: 'mQ7v', fragments: ['mQ7v'] },
];

function diagnosticIoGuard() {
  const dir = makeTemp(path.join(os.tmpdir(), 'i04-diagnostic-guard-'));
  const marker = path.join(dir, 'unexpected-io'); const guard = path.join(dir, 'guard.cjs');
  fs.writeFileSync(guard, `const fs=require('node:fs'),cp=require('node:child_process');
const marker=${JSON.stringify(marker)},source=${JSON.stringify(path.join(mainTree, '.sdd/repos/llmwiki'))};
const write=fs.writeFileSync.bind(fs);function deny(){write(marker,'unexpected runtime I/O');throw Error('runtime I/O after invalid JSON');}
for(const key of ['readFileSync','readdirSync','statSync','lstatSync']){const original=fs[key];fs[key]=function(target,...args){if(typeof target==='string'&&(target===source||target.startsWith(source+'/')))deny();return original.call(this,target,...args);};}
const spawn=cp.spawnSync;cp.spawnSync=function(command,args,...rest){if(!(command===process.execPath&&args[0].endsWith('/tools/infra/registry.mjs')))deny();return spawn.call(this,command,args,...rest);};require('node:module').syncBuiltinESMExports();\n`);
  return { marker, env: { NODE_OPTIONS: `--require ${guard}` } };
}

function diagnosticInput(target, state) {
  let registry = registryPath; let refs = path.join(repoRoot, 'infra/delivery/secrets.refs.example.json'); let dir = llmwikiDir;
  if (DOMAIN_FILES.includes(target)) {
    dir = makeFixtureDir(({ dir: fixture, write }) => {
      const file = path.join(fixture, target);
      if (state === 'directory') { fs.rmSync(file); fs.mkdirSync(file); }
      else write(target, state);
    });
  } else {
    const fixture = makeTemp(path.join(os.tmpdir(), 'i04-diagnostic-input-'));
    const file = path.join(fixture, 'input.json');
    if (state === 'directory') fs.mkdirSync(file); else fs.writeFileSync(file, state);
    if (target === 'registry') registry = file; else refs = file;
  }
  return { registry, refs, dir };
}

function diagnosticRun(entrypoint, input, env = {}) {
  return runCli([...entrypoint, '--registry', input.registry, '--refs', input.refs, '--dir', input.dir, '--json'], env);
}

for (const [name, entrypoint] of INPUT_ENTRYPOINTS) {
  test(`I04 diagnostic privacy ${name}: bad JSON never echoes arbitrary content`, () => {
    const guard = diagnosticIoGuard(); const failures = [];
    for (const target of DIAGNOSTIC_INPUTS) {
      for (const sentinel of DIAGNOSTIC_SENTINELS) {
        const result = diagnosticRun(entrypoint, diagnosticInput(target, sentinel.text), guard.env);
        try {
          assert.equal(result.status, 1);
          assert.equal(result.stdout, '');
          for (const fragment of sentinel.fragments) assert.equal((result.stdout + result.stderr).includes(fragment), false, `private JSON fragment echoed: ${result.stderr}`);
          assert.match(result.stderr, /JSON_INVALID/, 'a safe useful parse category must remain');
          assert.match(result.stderr, target === 'registry' ? /registry unreadable/ : target === 'refs' ? /refs catalog unreadable/ : /domain input invalid/);
          assert.equal(fs.existsSync(guard.marker), false, 'invalid JSON cannot inspect source or launch runtime');
          assert.doesNotMatch(result.stderr, /SyntaxError|TypeError|\n\s+at /);
        } catch (error) { failures.push({ target, sentinel: sentinel.text, error: error.message }); }
      }
    }
    assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  });

  test(`I04 diagnostic privacy ${name}: file failures retain safe labels and reason codes`, () => {
    const guard = diagnosticIoGuard(); const failures = [];
    for (const target of DIAGNOSTIC_INPUTS) {
      for (const kind of ['missing', 'directory']) {
        let input;
        if (kind === 'directory') input = diagnosticInput(target, 'directory');
        else {
          const missing = path.join(repoRoot, '.local', 'i04-never-created-' + crypto.randomUUID(), 'mQ7v-private-input.json');
          assert.equal(fs.existsSync(missing), false);
          input = { registry: registryPath, refs: path.join(repoRoot, 'infra/delivery/secrets.refs.example.json'), dir: llmwikiDir };
          if (target === 'registry') input.registry = missing;
          else if (target === 'refs') input.refs = missing;
          else input.dir = missing;
        }
        const result = diagnosticRun(entrypoint, input, guard.env);
        try {
          assert.equal(result.status, 1);
          assert.equal(result.stdout, '');
          assert.equal(result.stderr.includes('mQ7v'), false, `untrusted relative path was echoed: ${result.stderr}`);
          assert.match(result.stderr, kind === 'missing' ? /FILE_READ_ENOENT/ : /FILE_READ_EISDIR/);
          assert.match(result.stderr, target === 'registry' ? /registry unreadable/ : target === 'refs' ? /refs catalog unreadable/ : /domain input invalid/);
          if (DOMAIN_FILES.includes(target)) assert.ok(result.stderr.includes(target), 'only the fixed domain file label is reported');
          assert.equal(fs.existsSync(guard.marker), false, 'file failure cannot inspect source or launch runtime');
          assert.doesNotMatch(result.stderr, /SyntaxError|TypeError|\n\s+at /);
        } catch (error) { failures.push({ target, kind, error: error.message }); }
      }
    }
    assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  });
}

test('I04 diagnostic privacy: malformed command, option and case values are never repeated', () => {
  const sentinel = 'mQ7v';
  for (const [args, code] of [
    [[sentinel, '--json'], 'COMMAND_UNKNOWN'],
    [['validate', `--${sentinel}`, 'value', '--json'], 'ARGUMENT_OPTION_INVALID'],
    [['probe', '--case', sentinel, '--json'], 'PROBE_CASE_INVALID'],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes(sentinel), false, result.stderr);
    assert.ok(result.stderr.includes(code), 'fixed error code is useful without the rejected input');
  }
});

test('I04 diagnostic privacy: unexpected exceptions stay nonzero and distinct without raw message, code or stack', () => {
  const dir = makeTemp(path.join(os.tmpdir(), 'i04-diagnostic-internal-'));
  const input = path.join(dir, 'registry.json'); fs.writeFileSync(input, '{}');
  const guard = path.join(dir, 'fault.cjs');
  fs.writeFileSync(guard, `const fs=require('node:fs'),original=fs.readFileSync;fs.readFileSync=function(file,...args){if(file===${JSON.stringify(input)}){const error=Error('mQ7v');error.code='mQ7v';throw error;}return original.call(this,file,...args);};require('node:module').syncBuiltinESMExports();\n`);
  for (const [, entrypoint] of INPUT_ENTRYPOINTS) {
    const result = diagnosticRun(entrypoint, { registry: input, refs: path.join(repoRoot, 'infra/delivery/secrets.refs.example.json'), dir: llmwikiDir }, { NODE_OPTIONS: `--require ${guard}` });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /internal failure: INTERNAL_FAILURE/);
    assert.equal(result.stderr.includes('mQ7v'), false);
    assert.doesNotMatch(result.stderr, /registry unreadable|usage:|\n\s+at /, 'a genuine unexpected failure must not masquerade as invalid input');
  }
});
