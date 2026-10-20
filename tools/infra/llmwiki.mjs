#!/usr/bin/env node
// ProjectWikiInfra.v1 / ProjectRoot.v1 / KnowledgeWrite.v1 CLI — validate | qualify | probe
//
// 只登记、声明与验收：不启动常驻服务、不持有阶段/DAG/业务重试、不改活配置
// （.mcp.json 与 mcp-capabilities.yaml 的 MCP host 注册由对应 P 任务串行接纳，本工具只产出组件 profile 证据）。
// llmwiki/ 内容目录是项目数据，本工具对它零写入：一切写探针只落在一次性 sandbox workspace。
// 秘密值永不读写：index-policy 只携带 secret-ref 引用（sdd-harness-pilot/llmwiki-source-read），解析属运行时授权机制。
//
// 退出码契约（execution-contract.json cli_contract，与 I01/I02/I03 同源）：
//   0 = PASS（validate 通过 / 所有拒绝性不变量成立 / 探针全链路真实读回一致）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、未知 probe case）
//   2 = 验证失败（语义违规、qualify NOT_READY、真实 MCP 通道不可用而 UNVERIFIED、独立索引读回不一致）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 或 mock 转绿。
//
// ProjectRoot.v1 硬不变量：包含性拒绝（目录穿越、符号链接越域、未包含路径）由解析器无条件执行；
// policy 文件里的 denials.* 是声明记录，关掉声明既过不了 validate，也削弱不了解析器（probe 实证）。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, scanForForbiddenValues } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const DEFAULT_DIR = path.join(repoRoot, 'infra', 'delivery', 'llmwiki');

const DOMAIN_FILES = ['package.lock.json', 'project-root-policy.json', 'index-policy.json', 'mcp-profile.json'];
const FORBIDDEN_AUTHORITIES = ['openspec-specs', 'openspec-tasks', 'task-checkmarks', 'source-code', 'comet-state'];
const SECRET_REF_PREFIX = 'secret-ref:';
const MAIN_TREE_LABEL = '<main-working-tree>';
const MCP_INIT_TIMEOUT_MS = 15_000;
const MCP_LIST_TIMEOUT_MS = 15_000;
const MCP_WRITE_TIMEOUT_MS = 20_000;

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时目录）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

const UNVERIFIED = (reason) => ({ status: 'UNVERIFIED', reason });
const RECORDED = (reason) => ({ status: 'RECORDED', reason });

const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');
const sha256File = (file) => sha256Text(fs.readFileSync(file));

function usage() {
  return [
    'usage:',
    '  llmwiki.mjs validate --registry <file> [--dir <llmwiki policy dir>] [--refs <file>] [--json]',
    '  llmwiki.mjs qualify  --registry <file> [--dir <llmwiki policy dir>] [--json]',
    '  llmwiki.mjs probe    --case <worktree-mcp-readback|escape-denial> [--dir <llmwiki policy dir>] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (value === undefined) return { command, opts, error: `missing value for ${arg}` };
      opts[arg.slice(2)] = value;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, null, 2) + '\n');
}

function failInput(message) {
  process.stderr.write(`${message}\n${usage()}\n`);
  return EXIT_INPUT;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadDomainFiles(dir) {
  const files = new Map();
  const missing = [];
  const unparseable = [];
  for (const name of DOMAIN_FILES) {
    try {
      files.set(name, fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      missing.push(name);
    }
  }
  for (const name of DOMAIN_FILES) {
    if (!files.has(name)) continue;
    try {
      JSON.parse(files.get(name));
    } catch (error) {
      unparseable.push(`${name}: ${redactHostPaths(error.message)}`);
    }
  }
  return { files, missing, unparseable };
}

function collectSecretRefs(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectSecretRefs(item, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectSecretRefs(value, out);
    return;
  }
  if (typeof node === 'string' && node.trim().startsWith(SECRET_REF_PREFIX)) out.add(node.trim());
}

function runGit(cwd, args, timeoutMs = 15_000) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: timeoutMs });
  return run.status === 0 ? { ok: true, out: run.stdout.trim() } : { ok: false, err: redactHostPaths((run.stderr ?? '').trim().split('\n')[0] || `git exited ${run.status}`) };
}

// ---- ProjectRoot.v1：worktree -> canonical root 解析与包含性判定（硬不变量） ----

const realpathIfExists = (dir) => {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return null;
  }
};

// git worktree list 语义：git-common-dir 的父目录就是 main working tree。
function resolveCanonicalRoot(policy) {
  const common = runGit(repoRoot, ['rev-parse', '--git-common-dir']);
  if (!common.ok) return { ok: false, reason: `git-common-dir unavailable: ${common.err}` };
  const mainTree = path.resolve(repoRoot, common.out, '..');
  const root = path.join(mainTree, policy.canonicalWiki?.root ?? 'llmwiki');
  const realRoot = realpathIfExists(root) ?? path.resolve(root);
  return { ok: true, mainTree, root, realRoot, rootPresent: realpathIfExists(root) !== null, rootLabel: `${MAIN_TREE_LABEL}/${policy.canonicalWiki?.root ?? 'llmwiki'}` };
}

function listWorktrees() {
  const list = runGit(repoRoot, ['worktree', 'list', '--porcelain']);
  if (!list.ok) return { ok: false, reason: `git worktree list unavailable: ${list.err}` };
  const worktrees = [];
  let current = null;
  for (const line of list.out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length) };
    } else if (line === '' && current) {
      worktrees.push(current);
      current = null;
    }
  }
  if (current) worktrees.push(current);
  return { ok: worktrees.length > 0, worktrees };
}

// 单次包含性解析：声明的 policy 标志只做记录，安全决定完全由几何（.. 与 realpath 包含性）作出。
function resolveContainedPath(canonicalRootReal, claimedRelative, flags) {
  const denied = (code, reason) => ({ code, allowed: false, reason, flagsRecorded: { ...flags } });
  if (typeof claimedRelative !== 'string' || claimedRelative === '') {
    return denied('CLAIM_INVALID', 'claimed path must be a non-empty string');
  }
  const target = path.resolve(canonicalRootReal, claimedRelative);
  if (claimedRelative.split(path.sep).includes('..') || claimedRelative.includes('..')) {
    return denied('PATH_TRAVERSAL_DENIED', 'claimed path carries a .. segment; traversal out of the canonical wiki root is refused regardless of policy flags');
  }
  let realTarget;
  try {
    realTarget = fs.realpathSync.native(target);
  } catch {
    return denied('PATH_NOT_RESOLVABLE', 'claimed path does not resolve to an existing filesystem entry');
  }
  const rel = path.relative(canonicalRootReal, realTarget);
  const contained = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!contained) {
    return denied('SYMLINK_ESCAPE_DENIED', 'realpath resolves outside the canonical wiki root (symlink escape); refusal is unconditional');
  }
  return { code: 'CONTAINED', allowed: true, flagsRecorded: { ...flags } };
}

function resolveForeignRoot(canonicalRootReal, claimedRootDir) {
  let realClaimed;
  try {
    realClaimed = fs.realpathSync.native(claimedRootDir);
  } catch (error) {
    return { code: 'FOREIGN_WIKI_ROOT_DENIED', allowed: false, reason: `claimed wiki root does not resolve: ${redactHostPaths(error.message)}` };
  }
  const rel = path.relative(canonicalRootReal, realClaimed);
  const contained = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!contained) {
    return {
      code: 'FOREIGN_WIKI_ROOT_DENIED',
      allowed: false,
      reason: 'a per-worktree or foreign llmwiki/ directory is never a wiki root; every worktree must use the canonical main-tree root',
    };
  }
  return { code: 'CONTAINED', allowed: true };
}

function resolveProjectIdentity(policy, claimedProjectId) {
  if (claimedProjectId !== policy.projectId) {
    return {
      code: 'PROJECT_ID_MISMATCH_DENIED',
      allowed: false,
      reason: `claimed project id ${claimedProjectId} does not match the policy-bound project ${policy.projectId}`,
    };
  }
  return { code: 'IDENTITY_MATCHED', allowed: true };
}

// ---- KnowledgeWrite.v1：curated 条目准入（纯判定；独立读回由探针实跑） ----

function admitKnowledgeEntry(entry, policy) {
  const denied = (code, reason) => ({ code, allowed: false, reason });
  const authority = entry?.factAuthority ?? null;
  if (FORBIDDEN_AUTHORITIES.includes(authority)) {
    return denied('KNOWLEDGE_AUTHORITY_DENIED', `${authority} is a forbidden wiki fact authority; specs/tasks checkmarks, source code and Comet state never author wiki facts`);
  }
  if (authority === null || !(policy.knowledgeAuthority?.wikiFactAuthorities ?? []).includes(authority)) {
    return denied('ENTRY_ADMISSION_DENIED', `factAuthority must be one of ${JSON.stringify(policy.knowledgeAuthority?.wikiFactAuthorities ?? [])}`);
  }
  if (entry?.tier !== 'curated') {
    return denied('ENTRY_ADMISSION_DENIED', 'only curated tier entries are admissible; raw/staging are never wiki facts');
  }
  const fields = policy.knowledgeWrite?.requiredEntryFields ?? ['tier', 'title', 'content', 'approvedBy', 'source', 'revision'];
  const missing = fields.filter((field) => entry?.[field] === undefined || entry?.[field] === null || entry?.[field] === '');
  if (missing.length > 0) {
    return denied('ENTRY_ADMISSION_DENIED', `curated entry is missing required fields: ${missing.join(', ')} (approval + source + revision are non-negotiable)`);
  }
  if ((entry?.intake ?? null) === 'full-git-history' && policy.intake?.fullGitIngestWithoutApproval !== 'allowed-with-approval') {
    return denied('UNAPPROVED_INTAKE_DENIED', 'full Git code intake without an explicit approval channel is forbidden by intake policy');
  }
  return { code: 'ADMITTED', allowed: true, reason: 'approved curated entry with source and revision; independent readback still required before any write is called successful' };
}

// ---- validate ----

function validateDomain({ registry, refsDoc, files }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const projectId = registry?.project?.id;
  const docs = new Map(DOMAIN_FILES.map((name) => [name, JSON.parse(files.get(name))]));
  const lock = docs.get('package.lock.json');
  const rootPolicy = docs.get('project-root-policy.json');
  const indexPolicy = docs.get('index-policy.json');
  const profile = docs.get('mcp-profile.json');

  // package.lock.json：接口、commit 形态、upGate 关闭、无虚构字段。
  if (lock.interface !== 'PackageLock.v1') add('LOCK_INTERFACE_INVALID', 'package.lock.json', { expected: 'PackageLock.v1' });
  if (!/^[0-9a-f]{40}$/.test(lock.source?.commit ?? '')) add('LOCK_COMMIT_FORMAT_INVALID', 'package.lock.json:source.commit', { commit: lock.source?.commit ?? null });
  for (const [index, pkg] of (lock.distribution?.packages ?? []).entries()) {
    if (!pkg.name || !pkg.observedVersion) add('LOCK_PACKAGE_RECORD_INCOMPLETE', `package.lock.json:distribution.packages[${index}]`);
  }
  if (lock.upGate?.enabled !== false) {
    add('UP_GATE_NOT_CLOSED', 'package.lock.json:upGate', { reason: 'committed lock must declare upGate.enabled=false until host admission by the P task' });
  }

  // project-root-policy.json：接口、项目绑定、拒绝声明、canonical root 包含性。
  if (rootPolicy.interface !== 'ProjectRoot.v1') add('ROOT_INTERFACE_INVALID', 'project-root-policy.json', { expected: 'ProjectRoot.v1' });
  if (projectId && rootPolicy.projectId !== projectId) {
    add('PROJECT_ID_MISMATCH', 'project-root-policy.json:projectId', { policy: rootPolicy.projectId, registry: projectId });
  }
  if (registry?.project?.github?.repoFullname && rootPolicy.repoId !== registry.project.github.repoFullname) {
    add('REPO_ID_MISMATCH', 'project-root-policy.json:repoId', { policy: rootPolicy.repoId, registry: registry.project.github.repoFullname });
  }
  for (const [flag, value] of Object.entries(rootPolicy.denials ?? {})) {
    if (value !== true) add('POLICY_DENIAL_DISABLED', `project-root-policy.json:denials.${flag}`, { reason: 'containment denial declarations must all be true; flags are records, and a false record fails validate' });
  }
  const rootClaim = rootPolicy.canonicalWiki?.root ?? '';
  if (!rootClaim || path.isAbsolute(rootClaim) || rootClaim.includes('..')) {
    add('CANONICAL_ROOT_NOT_CONTAINED', 'project-root-policy.json:canonicalWiki.root', { root: rootClaim });
  }

  // index-policy.json：接口、三态、索引非权威、知识权威边界、写入门禁、intake 禁令。
  if (indexPolicy.interface !== 'IndexPolicy.v1') add('INDEX_POLICY_INTERFACE_INVALID', 'index-policy.json', { expected: 'IndexPolicy.v1' });
  for (const tier of ['raw', 'staging', 'curated']) {
    if (!indexPolicy.tiers?.[tier]) add('TIER_MODEL_INCOMPLETE', `index-policy.json:tiers.${tier}`);
  }
  if (indexPolicy.index?.knowledgeAuthority !== false) {
    add('INDEX_AS_AUTHORITY_FORBIDDEN', 'index-policy.json:index.knowledgeAuthority', { reason: 'the index is a rebuildable cache and never the knowledge authority' });
  }
  if (indexPolicy.index?.overridesSourceRecords !== false || indexPolicy.index?.rebuildable !== true) {
    add('INDEX_SEMANTICS_INVALID', 'index-policy.json:index', { reason: 'index must be rebuildable and must never override source records' });
  }
  const authorities = indexPolicy.knowledgeAuthority?.wikiFactAuthorities ?? [];
  const forbiddenDeclared = authorities.filter((authority) => FORBIDDEN_AUTHORITIES.includes(authority));
  if (forbiddenDeclared.length > 0) {
    add('KNOWLEDGE_AUTHORITY_FORBIDDEN', 'index-policy.json:knowledgeAuthority.wikiFactAuthorities', { forbidden: forbiddenDeclared });
  }
  if (indexPolicy.intake?.fullGitIngestWithoutApproval !== 'forbidden') {
    add('UNAPPROVED_INTAKE_FORBIDDEN', 'index-policy.json:intake.fullGitIngestWithoutApproval', { declared: indexPolicy.intake?.fullGitIngestWithoutApproval ?? null });
  }
  if (indexPolicy.knowledgeWrite?.requiresApproval !== true || indexPolicy.knowledgeWrite?.requiresSourceAndRevision !== true || indexPolicy.knowledgeWrite?.independentReadbackRequired !== true) {
    add('KNOWLEDGE_WRITE_GATE_DISABLED', 'index-policy.json:knowledgeWrite', { reason: 'approval, source/revision and independent readback must all be required' });
  }

  // mcp-profile.json：接口、component-profile-only 边界（不得双写活配置）。
  if (profile.interface !== 'McpComponentProfile.v1') add('MCP_PROFILE_INTERFACE_INVALID', 'mcp-profile.json', { expected: 'McpComponentProfile.v1' });
  if (profile.registrationScope !== 'component-profile-only') {
    add('HOST_REGISTRATION_SCOPE_INVALID', 'mcp-profile.json:registrationScope', { declared: profile.registrationScope, reason: 'this task produces a component profile only; host registration belongs to the P task via mcp-capabilities.yaml' });
  }
  if (profile.observation?.hostDiscoveryStatus === 'VERIFIED' && profile.observation?.hostDiscovered !== true) {
    add('HOST_DISCOVERY_CLAIM_INVALID', 'mcp-profile.json:observation', { reason: 'a VERIFIED host discovery claim must carry hostDiscovered=true' });
  }
  const launcherPath = lock.distribution?.launcher?.path ?? '';
  const entryCommand = profile.hostEntry?.command ?? '';
  if (launcherPath && entryCommand && !entryCommand.endsWith(launcherPath)) {
    add('LAUNCHER_PATH_MISMATCH', 'mcp-profile.json:hostEntry.command', { launcherPath });
  }

  // 全域 secret-ref：格式 + 项目绑定 + catalog 登记缺口（缺口显式上报，绝不静默）。
  const refs = new Set();
  for (const doc of docs.values()) collectSecretRefs(doc, refs);
  const catalogRefs = new Set((refsDoc?.refs ?? []).map((entry) => entry.ref));
  const catalogGaps = [];
  for (const ref of refs) {
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) {
      add('MALFORMED_REF', 'domain refs', { ref, reason: parsed.error });
      continue;
    }
    if (projectId && parsed.project !== projectId) {
      add('CROSS_PROJECT_REF', 'domain refs', { ref, project: parsed.project });
      continue;
    }
    if (!catalogRefs.has(ref)) catalogGaps.push(ref);
  }
  catalogGaps.sort();

  // JSON 结构安全扫描（秘密明文 / 宿主绝对路径）。
  for (const name of DOMAIN_FILES) violations.push(...scanForForbiddenValues(docs.get(name)));

  return { violations, catalogGaps, docs };
}

// ---- qualify ----

function resolveDistributionPaths(lock) {
  const sddHome = process.env.SDD_HOME || path.join(os.homedir(), '.sdd');
  return {
    sddHome,
    cloneDir: path.join(sddHome, 'repos', 'llmwiki'),
    mcpDir: path.join(sddHome, 'repos', 'llmwiki', 'mcp'),
    requirementsLock: path.join(sddHome, 'repos', 'llmwiki', 'mcp', 'requirements.lock'),
    venvPython: process.env.LLMWIKI_PYTHON || path.join(sddHome, 'repos', 'llmwiki', '.venv', 'bin', 'python'),
    launcher: path.join(repoRoot, lock.distribution?.launcher?.path ?? 'tools/mcp/llmwiki.sh'),
  };
}

function buildQualification({ registryFile, dir, docs }) {
  const lock = docs.get('package.lock.json');
  const indexPolicy = docs.get('index-policy.json');
  const dist = resolveDistributionPaths(lock);
  const categories = {};
  const inputs = { registrySha256: sha256File(registryFile), domainFiles: {} };
  for (const name of DOMAIN_FILES) inputs.domainFiles[name] = sha256Text(fs.readFileSync(path.join(dir, name)));

  const expectedLauncherSha = lock.distribution?.launcher?.sha256 ?? null;
  try {
    const observed = sha256File(dist.launcher);
    const executable = (() => {
      try {
        fs.accessSync(dist.launcher, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    })();
    categories['launcher-entry'] =
      observed === expectedLauncherSha && executable
        ? { status: 'VERIFIED', observed, executable }
        : UNVERIFIED(`launcher ${lock.distribution?.launcher?.path} missing, not executable, or digest mismatch (observed ${observed.slice(0, 12)}…)`);
  } catch (error) {
    categories['launcher-entry'] = UNVERIFIED(`launcher unreadable: ${redactHostPaths(error.message)}`);
  }

  try {
    const observed = sha256File(dist.requirementsLock);
    const expected = lock.distribution?.requirementsLock?.sha256 ?? null;
    categories['requirements-lock-digest'] =
      observed === expected
        ? { status: 'VERIFIED', observed, bytes: fs.statSync(dist.requirementsLock).size }
        : { status: 'MISMATCH', observed, expected };
  } catch (error) {
    categories['requirements-lock-digest'] = UNVERIFIED(`requirements.lock not resolvable via SDD_HOME: ${redactHostPaths(error.message)}`);
  }

  const head = runGit(dist.cloneDir, ['rev-parse', 'HEAD']);
  categories['upstream-source'] = !head.ok
    ? UNVERIFIED(`local llmwiki clone not resolvable via SDD_HOME: ${head.err}`)
    : head.out === lock.source?.commit
      ? { status: 'VERIFIED', observedCommit: head.out, note: 'matches the lock; remote confirmation against the upstream is still pending' }
      : { status: 'MISMATCH', observedCommit: head.out, expected: lock.source?.commit ?? null };

  const pyRun = spawnSync(dist.venvPython, ['--version'], { encoding: 'utf8', timeout: 15_000 });
  if (pyRun.status !== 0) {
    categories['venv-runtime'] = UNVERIFIED(`resolved python did not run: ${redactHostPaths((pyRun.stderr ?? '').trim().split('\n')[0] || `exited ${pyRun.status}`)}`);
  } else {
    const observedPython = pyRun.stdout.trim();
    const pkgRun = spawnSync(dist.venvPython, ['-c', 'import importlib.metadata as m; print(m.version("mcp"))'], { encoding: 'utf8', timeout: 15_000 });
    const observedPkg = pkgRun.status === 0 ? pkgRun.stdout.trim() : null;
    const expectedPkg = (lock.distribution?.packages ?? []).find((pkg) => pkg.name === 'mcp')?.observedVersion ?? null;
    categories['venv-runtime'] = { status: 'VERIFIED', observed: observedPython, driftNote: lock.distribution?.python?.note ?? null };
    categories['mcp-package-version'] =
      observedPkg === null
        ? UNVERIFIED('mcp package version not observable in the resolved venv')
        : observedPkg === expectedPkg
          ? { status: 'VERIFIED', observed: observedPkg }
          : { status: 'MISMATCH', observed: observedPkg, expected: expectedPkg };
  }

  const roots = resolveCanonicalRoot(docs.get('project-root-policy.json'));
  categories['workspace-identity'] = !roots.ok
    ? UNVERIFIED(roots.reason)
    : {
        status: 'VERIFIED',
        canonicalRootLabel: roots.rootLabel,
        rootPresent: fs.existsSync(roots.realRoot),
        note: 'resolution observed; the root directory existing is NOT host discovery and grants nothing',
      };

  categories['mcp-host-discovery'] = UNVERIFIED(
    'file existence is not host discovery: no real MCP host admission evidence exists; the 2026-10-20 session observed the host entry failing with ENOENT. Host registration is adopted by the P task via mcp-capabilities.yaml',
  );
  categories['mcp-write-channel'] = UNVERIFIED(
    'no successful MCP write round-trip is registered; run probe --case worktree-mcp-readback (create did not return in the recording session — recorded in package.lock.json:mcpSession)',
  );
  categories['index-consistency'] = UNVERIFIED(
    'independent file+index readback against a real MCP write is pending; the local gate mechanics (file without index row = INCONSISTENT) are exercised by probe --case worktree-mcp-readback',
  );
  categories['knowledge-authority-separation'] = RECORDED(
    'policy declares the separation (curated only; specs/tasks/source-code/comet-state forbidden) and validate enforces the declaration; runtime admission denials are exercised by probe --case escape-denial',
  );
  categories['secret-provisioned'] = UNVERIFIED(
    `${indexPolicy.secretRefs?.sourceRead ?? 'source-read ref'} is referenced, never provisioned; resolution requires a runtime-authorized secret store this task deliberately does not implement`,
  );

  const values = Object.values(categories);
  return {
    interface: 'Qualification.v1',
    domain: 'llmwiki',
    dir: displayPath(dir),
    ready: values.every((category) => category.status === 'VERIFIED'),
    unverifiedCount: values.filter((category) => category.status === 'UNVERIFIED').length,
    catalogGaps: [],
    categories,
    inputs,
  };
}

// ---- probe: worktree-mcp-readback ----

function mcpJsonRpcStep(frames, timeoutMs, workspace, venvPython, mcpDir) {
  const run = spawnSync(venvPython, ['-m', 'local_server', '--workspace', workspace], {
    input: frames.join('\n') + '\n',
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: mcpDir, LLMWIKI_USER_ID: 'i04-probe-user' },
  });
  const responses = new Map();
  for (const line of (run.stdout ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const message = JSON.parse(trimmed);
      if (message.id !== undefined) responses.set(message.id, message);
    } catch {
      // 非 JSON 行（日志混流）忽略；真实性由 stderr 记录补充。
    }
  }
  return { responses, timedOut: run.signal === 'SIGTERM', stderrTail: redactHostPaths((run.stderr ?? '').trim().split('\n').slice(-2).join(' | ')), status: run.status, signal: run.signal };
}

function probeWorktreeMcpReadback(domainDir, docs) {
  const receipt = {
    interface: 'ProjectWikiInfra.v1',
    command: 'probe',
    case: 'worktree-mcp-readback',
    executed: true,
    status: 'UNVERIFIED',
    reason: null,
    worktrees: [],
    worktreesCanonicalRootsConsistent: false,
    mcpSession: { workspace: 'sandbox' },
    fileLevelEquivalent: { executed: false, workspace: 'sandbox', steps: [] },
    requiredInputs: [
      'a resolved llmwiki venv python (LLMWIKI_PYTHON or SDD_HOME/repos/llmwiki/.venv/bin/python) with the mcp package installed',
      'a real MCP host admission (owned by the P task via mcp-capabilities.yaml) before any host-level claim',
      'the sqlite3 CLI for independent index readback (present on this host at probe time)',
    ],
    plannedSteps: [
      'resolve every git worktree to the canonical main-tree wiki root and require one identical root',
      'open a real stdio MCP session against a disposable sandbox workspace: initialize, tools/list',
      'perform a real create write via the MCP channel with a bounded timeout',
      'independently read the written file back (content hash) and query the index separately; file without index row must read INCONSISTENT (Kp fail signal)',
      'file-level equivalent: the same write/readback/index-consistency gate executed directly against the sandbox workspace when (or after) the MCP channel is unavailable',
    ],
  };

  // 1) worktree -> canonical root 一致性（只读；绝不写仓库 llmwiki/）。
  const rootPolicy = docs.get('project-root-policy.json');
  const canonical = resolveCanonicalRoot(rootPolicy);
  if (!canonical.ok) {
    receipt.reason = `canonical root unresolved: ${canonical.reason}`;
    print(receipt);
    return EXIT_VERIFY;
  }
  const worktreeList = listWorktrees();
  if (!worktreeList.ok) {
    receipt.reason = `worktree list unavailable: ${worktreeList.reason}`;
    print(receipt);
    return EXIT_VERIFY;
  }
  let consistent = true;
  for (const [index, worktree] of worktreeList.worktrees.entries()) {
    const common = runGit(worktree.path, ['rev-parse', '--git-common-dir']);
    // git 可能对当前目录返回相对路径（如 '.git'），必须相对该 worktree 解析。
    const root = common.ok ? path.join(path.resolve(worktree.path, common.out, '..'), rootPolicy.canonicalWiki.root) : null;
    const realRoot = realpathIfExists(root);
    const same =
      root !== null &&
      (realRoot !== null ? realRoot === fs.realpathSync.native(canonical.realRoot) : path.resolve(root) === path.resolve(canonical.realRoot));
    consistent = consistent && same;
    receipt.worktrees.push({
      label: index === 0 ? MAIN_TREE_LABEL : `<linked-worktree:${path.basename(worktree.path)}>`,
      canonicalRootLabel: same ? canonical.rootLabel : '<mismatch>',
      resolvesToCanonicalRoot: same,
    });
  }
  receipt.worktreesCanonicalRootsConsistent = consistent;

  // 2+3) 真实 stdio MCP 会话（sandbox workspace），写通道有界超时。
  const lock = docs.get('package.lock.json');
  const dist = resolveDistributionPaths(lock);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i04-probe-'));
  try {
    const initFrames = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'i04-infra-probe', version: '0.0.1' } } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    ];
    const session = mcpJsonRpcStep(initFrames, MCP_INIT_TIMEOUT_MS + MCP_LIST_TIMEOUT_MS, sandbox, dist.venvPython, dist.mcpDir);
    const initResult = session.responses.get(1)?.result ?? null;
    receipt.mcpSession.initialize = initResult
      ? { status: 'VERIFIED', serverName: initResult.serverInfo?.name ?? null, serverVersion: initResult.serverInfo?.version ?? null, protocolVersion: initResult.protocolVersion ?? null }
      : { status: 'UNVERIFIED', reason: `no initialize response (signal=${session.signal ?? session.status}); stderr: ${session.stderrTail}` };
    const tools = session.responses.get(2)?.result?.tools?.map((tool) => tool.name) ?? null;
    receipt.mcpSession.toolsList = tools
      ? { status: 'VERIFIED', tools }
      : { status: 'UNVERIFIED', reason: `no tools/list response; stderr: ${session.stderrTail}` };

    const writeFrames = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'i04-infra-probe', version: '0.0.1' } } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create', arguments: { knowledge_base: 'wiki', title: 'I04 Probe Entry', content: 'curated probe entry body (sandbox)', tags: ['probe'], path: '/wiki/probes/' } } }),
    ];
    const writeRun = mcpJsonRpcStep(writeFrames, MCP_WRITE_TIMEOUT_MS, sandbox, dist.venvPython, dist.mcpDir);
    const writeResult = writeRun.responses.get(3) ?? null;
    if (writeResult) {
      const errorText = writeResult.result?.isError ? String(writeResult.result?.content?.[0]?.text ?? 'tool error') : null;
      receipt.mcpSession.write = errorText
        ? { status: 'UNVERIFIED', reason: `MCP create returned an error: ${redactHostPaths(errorText.slice(0, 300))}` }
        : { status: 'VERIFIED', response: redactHostPaths(JSON.stringify(writeResult.result ?? {}).slice(0, 300)) };
    } else {
      receipt.mcpSession.write = {
        status: 'UNVERIFIED',
        reason: `no response to the create write within ${MCP_WRITE_TIMEOUT_MS}ms (tool call hangs in this environment; recorded, not mocked); nothing was written via MCP`,
      };
    }

    // 4+5) 文件级等价探针：直接对 sandbox workspace 的写 / 独立读回 / 索引一致门（正负对照都实跑）。
    receipt.fileLevelEquivalent = runFileLevelEquivalent(sandbox, lock);
    receipt.fileLevelEquivalent.executed = true;

    const steps = new Map(receipt.fileLevelEquivalent.steps.map((step) => [step.step, step]));
    const allFileLevelVerified = receipt.fileLevelEquivalent.steps.every((step) => step.status === 'VERIFIED');
    const mcpWriteVerified = receipt.mcpSession.write?.status === 'VERIFIED';
    if (mcpWriteVerified && allFileLevelVerified && consistent) {
      receipt.status = 'VERIFIED';
      print(receipt);
      return EXIT_PASS;
    }
    const failures = [
      ...(consistent ? [] : ['worktrees resolve to divergent canonical roots']),
      ...(mcpWriteVerified ? [] : ['real MCP write channel not verified']),
      ...(allFileLevelVerified ? [] : [`file-level gate steps failed: ${receipt.fileLevelEquivalent.steps.filter((s) => s.status !== 'VERIFIED').map((s) => s.step).join(', ')}`]),
    ];
    receipt.reason = `${failures.join('; ')} — infrastructure returns facts only and signs no Kp receipt; archiving stays blocked`;
    print(receipt);
    return EXIT_VERIFY;
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function runFileLevelEquivalent(sandbox, lock) {
  const steps = [];
  const record = (step, status, observed) => steps.push({ step, status, ...(observed ? { observed } : {}) });
  const entryRel = 'wiki/probes/i04-probe-entry.md';
  const entryAbs = path.join(sandbox, ...entryRel.split('/'));
  const body = [
    '---',
    'tier: curated',
    'title: I04 Probe Entry',
    'approvedBy: ql-wade',
    'source: curated digest; source read bound to secret-ref:sdd-harness-pilot/llmwiki-source-read',
    `revision: ${(lock.source?.commit ?? '').slice(0, 12) || 'unrecorded'}`,
    '---',
    '',
    'curated probe entry body (sandbox).',
    '',
  ].join('\n');
  try {
    fs.mkdirSync(path.dirname(entryAbs), { recursive: true });
    fs.writeFileSync(entryAbs, body);
  } catch (error) {
    record('curated-entry-write', 'UNVERIFIED', { reason: redactHostPaths(error.message) });
    return { workspace: 'sandbox', steps };
  }
  record('curated-entry-write', 'VERIFIED', { entry: entryRel });

  try {
    const written = fs.readFileSync(entryAbs, 'utf8');
    const match = sha256Text(written) === sha256Text(body);
    record('independent-file-readback', match ? 'VERIFIED' : 'UNVERIFIED', { contentHashMatches: match, sha256: sha256Text(written) });
  } catch (error) {
    record('independent-file-readback', 'UNVERIFIED', { reason: redactHostPaths(error.message) });
    return { workspace: 'sandbox', steps };
  }

  // 负对照：文件存在但没有索引行 → 门必须读到 INCONSISTENT（Kp 失败信号；绝不因文件存在放行）。
  const indexDb = path.join(sandbox, '.llmwiki', 'index.db');
  const gateTable = 'i04_index_gate';
  const query = (sql) => {
    const run = spawnSync('sqlite3', [indexDb, sql], { encoding: 'utf8', timeout: 15_000 });
    return run.status === 0 ? { ok: true, out: run.stdout.trim() } : { ok: false, err: redactHostPaths((run.stderr ?? '').trim().split('\n')[0] || `sqlite3 exited ${run.status}`) };
  };
  if (!query('').ok) {
    record('index-mismatch-detection', 'UNVERIFIED', { reason: 'sqlite3 CLI unavailable; independent index readback cannot run' });
    return { workspace: 'sandbox', steps };
  }
  query(`CREATE TABLE IF NOT EXISTS ${gateTable}(relative_path TEXT PRIMARY KEY, title TEXT, content_hash TEXT);`);
  const before = query(`SELECT title FROM ${gateTable} WHERE relative_path='${entryRel}';`);
  const inconsistentDetected = before.ok && before.out === '';
  record('index-mismatch-detection', inconsistentDetected ? 'VERIFIED' : 'UNVERIFIED', {
    consistency: inconsistentDetected ? 'INCONSISTENT' : 'UNKNOWN',
    reason: inconsistentDetected
      ? 'file exists but the independent index readback finds no row: gate reads INCONSISTENT — a Kp failure signal, never an archiving pass'
      : `unexpected index readback: ${before.ok ? before.out : before.err}`,
  });

  // 正对照：独立通道登记索引行后重读 → CONSISTENT（门通过仅当双方一致）。
  const insert = query(`INSERT INTO ${gateTable}(relative_path, title, content_hash) VALUES('${entryRel}','I04 Probe Entry','${sha256Text(body)}');`);
  const after = insert.ok ? query(`SELECT content_hash FROM ${gateTable} WHERE relative_path='${entryRel}';`) : { ok: false, err: insert.err };
  const hashMatches = after.ok && after.out === sha256Text(body);
  record('index-consistent-readback', hashMatches ? 'VERIFIED' : 'UNVERIFIED', {
    consistency: hashMatches ? 'CONSISTENT' : 'UNKNOWN',
    reason: hashMatches
      ? 'file and independently registered index row agree on the content hash; gate reads CONSISTENT (sandbox gate exercise, not an MCP write substitute)'
      : `index readback mismatch or insert failure: ${after.ok ? after.out : after.err}`,
  });
  return { workspace: 'sandbox', steps };
}

// ---- probe: escape-denial ----

function probeEscapeDenial(domainDir, docs) {
  const receipt = {
    interface: 'ProjectWikiInfra.v1',
    command: 'probe',
    case: 'escape-denial',
    executed: true,
    status: 'UNVERIFIED',
    reason: null,
    sandbox: 'git-repo-with-linked-worktree',
    denials: [],
    positiveControls: [],
    hardInvariantsHeld: false,
    knowledgeWrite: { denials: [], positiveControls: [] },
  };

  const rootPolicy = docs.get('project-root-policy.json');
  const indexPolicy = docs.get('index-policy.json');
  const canonicalRootRel = rootPolicy.canonicalWiki?.root ?? 'llmwiki';

  // sandbox：一个真实 git 仓库 + 一个真实 linked worktree（git worktree list 语义）。
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i04-escape-'));
  const gitIdentity = ['-c', 'user.email=i04@probe.invalid', '-c', 'user.name=i04-probe'];
  try {
    const init = runGit(sandbox, ['init', '-q']);
    if (!init.ok) {
      receipt.reason = `sandbox git init failed: ${init.err}`;
      print(receipt);
      return EXIT_VERIFY;
    }
    runGit(sandbox, [...gitIdentity, 'commit', '--allow-empty', '-q', '-m', 'init']);
    const linkedDir = path.join(sandbox, 'linked-wt');
    runGit(sandbox, ['worktree', 'add', '--detach', '-q', linkedDir]);
    const mainTree = path.join(sandbox, '.git', '..');
    const canonicalRoot = path.join(mainTree, canonicalRootRel);
    fs.mkdirSync(canonicalRoot, { recursive: true });
    fs.mkdirSync(path.join(linkedDir, canonicalRootRel), { recursive: true });
    const realCanonicalRoot = fs.realpathSync.native(canonicalRoot);

    // 正对照：canonical root 内的合法路径（claim 相对 canonical root 本身）。
    fs.writeFileSync(path.join(canonicalRoot, 'contained.md'), 'contained\n');
    const positive = resolveContainedPath(realCanonicalRoot, 'contained.md', rootPolicy.denials ?? {});
    receipt.positiveControls.push({ code: positive.code, allowed: positive.allowed });

    // 目录穿越：.. 逃出 canonical root（目标文件真实存在，穿越被几何拒绝）。
    fs.writeFileSync(path.join(sandbox, 'outside.md'), 'outside\n');
    const traversal = resolveContainedPath(realCanonicalRoot, '../../outside.md', rootPolicy.denials ?? {});
    receipt.denials.push({ code: traversal.code, allowed: traversal.allowed, reason: traversal.reason });

    // 符号链接越域：canonical root 内的 symlink 指向 sandbox 外。
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i04-outside-'));
    const outsideFile = path.join(outsideDir, 'target.md');
    fs.writeFileSync(outsideFile, 'secret-outside\n');
    fs.symlinkSync(outsideFile, path.join(canonicalRoot, 'escape.md'));
    const symlink = resolveContainedPath(realCanonicalRoot, 'escape.md', rootPolicy.denials ?? {});
    receipt.denials.push({ code: symlink.code, allowed: symlink.allowed, reason: symlink.reason });

    // 另一 wiki：linked worktree 自己的 llmwiki/ 副本永不是 root。
    const foreign = resolveForeignRoot(realCanonicalRoot, path.join(linkedDir, canonicalRootRel));
    receipt.denials.push({ code: foreign.code, allowed: foreign.allowed, reason: foreign.reason });

    // 错误 project ID。
    const identity = resolveProjectIdentity(rootPolicy, 'pav-legacy');
    receipt.denials.push({ code: identity.code, allowed: identity.allowed, reason: identity.reason });

    // 硬不变量：把声明全关掉再试，包含性拒绝必须原样成立。
    const disabledFlags = Object.fromEntries(Object.keys(rootPolicy.denials ?? {}).map((flag) => [flag, false]));
    const hardTraversal = resolveContainedPath(realCanonicalRoot, '../../outside.md', disabledFlags);
    const hardSymlink = resolveContainedPath(realCanonicalRoot, 'escape.md', disabledFlags);
    const hardForeign = resolveForeignRoot(realCanonicalRoot, path.join(linkedDir, canonicalRootRel));
    receipt.hardInvariantsHeld =
      hardTraversal.code === 'PATH_TRAVERSAL_DENIED' &&
      hardSymlink.code === 'SYMLINK_ESCAPE_DENIED' &&
      hardForeign.code === 'FOREIGN_WIKI_ROOT_DENIED';
    fs.rmSync(outsideDir, { recursive: true, force: true });

    // KnowledgeWrite.v1 准入拒绝（确定性与本地）。
    const base = { tier: 'curated', title: 't', content: 'c', factAuthority: 'approved-curated-entry', approvedBy: 'ql-wade', source: 'approved digest', revision: '075c5b4' };
    receipt.knowledgeWrite.denials.push(admitKnowledgeEntry({ ...base, factAuthority: 'openspec-tasks' }, indexPolicy));
    receipt.knowledgeWrite.denials.push(admitKnowledgeEntry({ ...base, intake: 'full-git-history' }, indexPolicy));
    receipt.knowledgeWrite.denials.push(admitKnowledgeEntry({ ...base, approvedBy: null, revision: null }, indexPolicy));
    receipt.knowledgeWrite.denials.push(admitKnowledgeEntry({ ...base, tier: 'raw' }, indexPolicy));
    receipt.knowledgeWrite.positiveControls.push(admitKnowledgeEntry(base, indexPolicy));

    const pathDenialsHold = ['PATH_TRAVERSAL_DENIED', 'SYMLINK_ESCAPE_DENIED', 'FOREIGN_WIKI_ROOT_DENIED', 'PROJECT_ID_MISMATCH_DENIED'].every((code) =>
      receipt.denials.some((denial) => denial.code === code && denial.allowed === false),
    );
    const positiveHolds = receipt.positiveControls.some((control) => control.allowed === true);
    const kwDenialsHold = ['KNOWLEDGE_AUTHORITY_DENIED', 'UNAPPROVED_INTAKE_DENIED', 'ENTRY_ADMISSION_DENIED'].every((code) =>
      receipt.knowledgeWrite.denials.some((denial) => denial.code === code && denial.allowed === false),
    );
    const kwPositiveHolds = receipt.knowledgeWrite.positiveControls.some((control) => control.allowed === true);

    if (pathDenialsHold && positiveHolds && receipt.hardInvariantsHeld && kwDenialsHold && kwPositiveHolds) {
      receipt.status = 'VERIFIED';
      print(receipt);
      return EXIT_PASS;
    }
    receipt.reason = 'a denial or positive control did not hold — containment or admission is leaky; refuse closed';
    print(receipt);
    return EXIT_VERIFY;
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ---- main ----

function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');

  if (command === 'probe') {
    const dir = opts.dir ?? DEFAULT_DIR;
    const { files, missing, unparseable } = loadDomainFiles(dir);
    if (missing.length > 0) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
    if (unparseable.length > 0) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);
    const docs = new Map(DOMAIN_FILES.map((name) => [name, JSON.parse(files.get(name))]));
    if (opts.case === 'worktree-mcp-readback') return probeWorktreeMcpReadback(dir, docs);
    if (opts.case === 'escape-denial') return probeEscapeDenial(dir, docs);
    return failInput(`unknown probe case: ${opts.case ?? '(missing --case)'}`);
  }

  // validate/qualify：registry 与 refs 目录必须先可读（fail-closed，绝不静默降级为空规则）。
  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  const refsFile = opts.refs ?? DEFAULT_REFS;
  let registry;
  let refsDoc;
  try {
    registry = readJson(registryFile);
  } catch (err) {
    return failInput(`registry unreadable: ${redactHostPaths(err.message)}`);
  }
  try {
    refsDoc = readJson(refsFile);
  } catch (err) {
    return failInput(`refs catalog unreadable (${displayPath(refsFile)}): ${redactHostPaths(err.message)}`);
  }
  const dir = opts.dir ?? DEFAULT_DIR;
  const { files, missing, unparseable } = loadDomainFiles(dir);
  if (missing.length > 0) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
  if (unparseable.length > 0) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);

  if (command === 'validate') {
    const { violations, catalogGaps, docs } = validateDomain({ registry, refsDoc, files });
    print({
      interface: 'ProjectWikiInfra.v1',
      command: 'validate',
      registry: displayPath(registryFile),
      refs: displayPath(refsFile),
      dir: displayPath(dir),
      ok: violations.length === 0,
      violations,
      catalogGaps,
      packageLock: { interface: docs.get('package.lock.json').interface, component: docs.get('package.lock.json').component, upGate: docs.get('package.lock.json').upGate ?? null },
      projectRoot: { interface: docs.get('project-root-policy.json').interface, projectId: docs.get('project-root-policy.json').projectId, repoId: docs.get('project-root-policy.json').repoId, canonicalWiki: docs.get('project-root-policy.json').canonicalWiki ?? null },
      indexPolicy: { interface: docs.get('index-policy.json').interface, tiers: Object.keys(docs.get('index-policy.json').tiers ?? {}), knowledgeWrite: docs.get('index-policy.json').knowledgeWrite ?? null },
      mcpProfile: { interface: docs.get('mcp-profile.json').interface, registrationScope: docs.get('mcp-profile.json').registrationScope, hostDiscoveryStatus: docs.get('mcp-profile.json').observation?.hostDiscoveryStatus ?? null },
    });
    return violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'qualify') {
    const { catalogGaps, docs } = validateDomain({ registry, refsDoc, files });
    const qualification = buildQualification({ registryFile, dir, docs });
    qualification.catalogGaps = catalogGaps;
    print(qualification);
    return qualification.ready ? EXIT_PASS : EXIT_VERIFY;
  }

  return failInput(`unknown command: ${command}`);
}

process.exit(main(process.argv.slice(2)));
