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
import { parseSecretRef, scanForForbiddenValues, redactSecretValue } from './secret-refs.mjs';
import { getWikiHome } from '../../lib/sdd-paths.js';

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

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|Volumes|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时目录）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

const UNVERIFIED = (reason) => ({ status: 'UNVERIFIED', reason });

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
  const opts = { _: [] }; const command = argv[0];
  const valueOptions = new Set(['--registry', '--refs', '--dir', '--case']);
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json' && !opts.json) { opts.json = true; continue; }
    if (!valueOptions.has(arg) || Object.hasOwn(opts, arg.slice(2))) return { command, opts, error: 'ARGUMENT_OPTION_INVALID' };
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) return { command, opts, error: 'ARGUMENT_VALUE_REQUIRED' };
    opts[arg.slice(2)] = value;
  }
  if (command !== 'probe' && opts.case) return { command, opts, error: 'ARGUMENT_CASE_SCOPE' };
  return { command, opts };
}

const safeText = (value) => redactHostPaths(redactSecretValue(String(value)));
function safeOutput(value) {
  if (typeof value === 'string') return safeText(value);
  if (Array.isArray(value)) return value.map(safeOutput);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeOutput(item)]));
  return value;
}
function print(payload) {
  process.stdout.write(JSON.stringify(safeOutput({ ...payload, checkedAt: new Date().toISOString() }), null, 2) + '\n');
}

const FILE_READ_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG', 'EINVAL', 'EMFILE', 'ENFILE', 'EBUSY', 'ENOSPC', 'EIO', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_ACCESS_DENIED']);
const DIAGNOSTIC_CODES = new Set([...FILE_READ_CODES, 'ETIMEDOUT', 'SOURCE_PRIVATE_ENV_FORBIDDEN', 'SOURCE_SYMLINK_FORBIDDEN', 'SOURCE_FILE_TYPE_UNSUPPORTED']);
const safeFailureCode = (error) => typeof error?.code === 'string' && DIAGNOSTIC_CODES.has(error.code) ? error.code : 'UNEXPECTED_FAILURE';
const childFailureCode = (run) => run.error ? safeFailureCode(run.error) : Number.isInteger(run.status) ? `EXIT_${run.status}` : 'EXIT_UNKNOWN';

function failInput(category, code) {
  process.stderr.write(`${category}: ${code}\n${usage()}\n`);
  return EXIT_INPUT;
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (!FILE_READ_CODES.has(error?.code)) throw error;
    return { ok: false, code: `FILE_READ_${error.code}` };
  }
  try { return { ok: true, value: JSON.parse(text), text }; }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false, code: 'JSON_INVALID' };
  }
}

function loadDomainFiles(dir) {
  const files = new Map(); const issues = [];
  for (const name of DOMAIN_FILES) {
    const result = readJson(path.join(dir, name));
    if (result.ok) files.set(name, result.text);
    else issues.push(`${name}:${result.code}`);
  }
  return { files, issues };
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
  return run.status === 0 ? { ok: true, out: run.stdout.trim() } : { ok: false, err: `GIT_EXECUTION_FAILED:${childFailureCode(run)}` };
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
function resolveMainTree(cwd = repoRoot) {
  const common = runGit(cwd, ['rev-parse', '--git-common-dir']);
  return common.ok ? { ok: true, mainTree: path.resolve(cwd, common.out, '..') }
    : { ok: false, reason: `git-common-dir unavailable: ${common.err}` };
}

function contained(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function registeredWikiTarget(policy) {
  const project = resolveMainTree();
  if (!project.ok) return project;
  const mainTree = fs.realpathSync.native(project.mainTree);
  // P4_4 owns the pending shell repair. Never pass an untrusted path to it.
  if (/[$`\r\n]/.test(mainTree)) return { ok: false, reason: 'unsafe input to pending P4_4 path authority; no invocation' };
  const env = { ...process.env, SDD_HOME: path.join(mainTree, '.sdd') };
  delete env.SDD_WIKI_HOME;
  const script = `import { getWikiHome } from ${JSON.stringify(new URL('../../lib/sdd-paths.js', import.meta.url).href)}; process.stdout.write(getWikiHome(process.argv[1]));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, '--', mainTree], { cwd: repoRoot, env, encoding: 'utf8', timeout: 15000 });
  const declared = path.resolve(mainTree, policy.canonicalWiki.root);
  if (result.status !== 0 || !path.isAbsolute(result.stdout) || declared !== path.resolve(result.stdout)) {
    return { ok: false, reason: 'ROOT_REGISTRATION_MISMATCH: policy/env cannot invent a target different from the existing project path authority under registered project-local bindings' };
  }
  let ancestor = declared;
  while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
  const realRoot = path.resolve(fs.realpathSync.native(ancestor), path.relative(ancestor, declared));
  if (!contained(mainTree, realRoot) || (fs.existsSync(declared) && !fs.statSync(declared).isDirectory())) return { ok: false, reason: 'registered wiki target escapes the project or is not a directory' };
  return { ok: true, mainTree, root: declared, realRoot, rootPresent: fs.existsSync(declared), rootLabel: `${MAIN_TREE_LABEL}/${policy.canonicalWiki.root}` };
}

function resolveCanonicalRoot(policy) {
  const registered = registeredWikiTarget(policy);
  if (!registered.ok) return registered;
  const { mainTree, root, rootLabel } = registered;
  if (path.resolve(getWikiHome(mainTree)) !== root) return { ok: false, reason: 'CLI_WIKI_BINDING_MISMATCH: environment path is not the registered project wiki target' };
  return registered;
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
  if (claimedRelative.split(path.sep).includes('..')) {
    return denied('PATH_TRAVERSAL_DENIED', 'claimed path carries a .. segment; traversal out of the canonical wiki root is refused regardless of policy flags');
  }
  let realTarget;
  try {
    realTarget = fs.realpathSync.native(target);
  } catch {
    return denied('PATH_NOT_RESOLVABLE', 'claimed path does not resolve to an existing filesystem entry');
  }
  const rel = path.relative(canonicalRootReal, realTarget);
  const inside = rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  if (!inside) {
    return denied('SYMLINK_ESCAPE_DENIED', 'realpath resolves outside the canonical wiki root (symlink escape); refusal is unconditional');
  }
  return { code: 'CONTAINED', allowed: true, flagsRecorded: { ...flags } };
}

function resolveForeignRoot(canonicalRootReal, claimedRootDir) {
  let realClaimed;
  try {
    realClaimed = fs.realpathSync.native(claimedRootDir);
  } catch (error) {
    return { code: 'FOREIGN_WIKI_ROOT_DENIED', allowed: false, reason: `claimed wiki root does not resolve: ${safeFailureCode(error)}` };
  }
  if (realClaimed !== canonicalRootReal) {
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

// Only consumed fields are typed here; descriptive/historical metadata remains inert.
const DOMAIN_TYPES = {
  'package.lock.json': {
    interface: 'string', component: 'string',
    source: { commit: 'string', treeSha256: 'string' },
    distribution: {
      launcher: { path: 'string', sha256: 'string' },
      packages: [{ name: 'string', observedVersion: 'string' }],
      requirementsLock: { sha256: 'string', bytes: 'positive integer' },
    },
    mcpSession: { toolsObserved: ['string'] }, upGate: { enabled: 'boolean' },
  },
  'project-root-policy.json': {
    interface: 'string', component: 'string', projectId: 'string', repoId: 'string',
    canonicalWiki: { root: 'string' },
    denials: { traversal: 'boolean', symlinkEscape: 'boolean', foreignWikiRoot: 'boolean', projectIdMismatch: 'boolean', uncontainedPaths: 'boolean' },
  },
  'index-policy.json': {
    interface: 'string', component: 'string',
    tiers: {
      raw: { path: 'string', isWikiFactAuthority: 'boolean' },
      staging: { path: 'string', isWikiFactAuthority: 'boolean' },
      curated: { path: 'string', isWikiFactAuthority: 'boolean' },
    },
    index: { rebuildable: 'boolean', knowledgeAuthority: 'boolean', overridesSourceRecords: 'boolean', grantsKnowledgeAuthority: 'boolean' },
    knowledgeAuthority: { wikiFactAuthorities: ['string'] },
    knowledgeWrite: { requiresApproval: 'boolean', requiresSourceAndRevision: 'boolean', independentReadbackRequired: 'boolean', requiredEntryFields: ['string'] },
    intake: { fullGitIngestWithoutApproval: 'string' },
  },
  'mcp-profile.json': {
    interface: 'string', component: 'string', registrationScope: 'string',
    hostRegistration: { thisFileDoesNotRegister: 'boolean', liveConfigDoubleWriteForbidden: 'boolean' },
    hostEntry: { command: 'string', args: ['string'], transport: 'string' }, capabilities: ['string'],
  },
};

function validateDomainTypes(docs) {
  const violations = [];
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const reject = (value, expected, at) => violations.push({ code: 'DOMAIN_SCHEMA_INVALID', at, expected,
    actual: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value });
  const visit = (value, type, at) => {
    if (Array.isArray(type)) {
      if (!Array.isArray(value)) { reject(value, 'array', at); return; }
      for (const [i, item] of value.entries()) visit(item, type[0], `${at}[${i}]`);
    } else if (isObject(type)) {
      if (!isObject(value)) { reject(value, 'object', at); return; }
      for (const [key, expected] of Object.entries(type)) visit(value[key], expected, `${at}.${key}`);
    } else if (type === 'string' ? typeof value !== 'string' || !value.trim()
      : type === 'positive integer' ? !Number.isSafeInteger(value) || value <= 0
        : typeof value !== type) reject(value, type === 'string' ? 'non-blank string' : type, at);
  };
  for (const [name, type] of Object.entries(DOMAIN_TYPES)) visit(docs.get(name), type, name);
  const profile = docs.get('mcp-profile.json');
  if (isObject(profile) && Object.hasOwn(profile, 'observation')) {
    if (!isObject(profile.observation)) reject(profile.observation, 'object', 'mcp-profile.json.observation');
    else for (const [key, type] of [['hostDiscoveryStatus', 'string'], ['hostDiscovered', 'boolean']]) {
      if (Object.hasOwn(profile.observation, key)) visit(profile.observation[key], type, `mcp-profile.json.observation.${key}`);
    }
  }
  return violations;
}

function validateDomain({ registry, refsDoc, files }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const projectId = registry?.project?.id;
  const docs = new Map(DOMAIN_FILES.map((name) => [name, JSON.parse(files.get(name))]));
  const lock = docs.get('package.lock.json');
  const rootPolicy = docs.get('project-root-policy.json');
  const indexPolicy = docs.get('index-policy.json');
  const profile = docs.get('mcp-profile.json');
  const typeViolations = validateDomainTypes(docs);
  if (typeViolations.length) return { violations: typeViolations, catalogGaps: [], docs };
  for (const name of DOMAIN_FILES) if (docs.get(name).component !== 'llmwiki') add('COMPONENT_IDENTITY_MISMATCH', name);

  // package.lock.json：接口、commit 形态、upGate 关闭、无虚构字段。
  if (lock.interface !== 'PackageLock.v1') add('LOCK_INTERFACE_INVALID', 'package.lock.json', { expected: 'PackageLock.v1' });
  if (typeof lock.source.commit !== 'string' || !/^[0-9a-f]{40}$/.test(lock.source.commit)) add('LOCK_COMMIT_FORMAT_INVALID', 'package.lock.json:source.commit', { commit: lock.source?.commit ?? null });
  if (!lock.distribution.packages.some((pkg) => pkg?.name === 'mcp' && typeof pkg.observedVersion === 'string' && /^\d+\.\d+\.\d+$/.test(pkg.observedVersion))) add('LOCK_PACKAGE_RECORD_INCOMPLETE', 'package.lock.json:distribution.packages');
  for (const [index, pkg] of (lock.distribution?.packages ?? []).entries()) {
    if (!pkg?.name || !pkg?.observedVersion) add('LOCK_PACKAGE_RECORD_INCOMPLETE', `package.lock.json:distribution.packages[${index}]`);
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
  for (const flag of ['traversal', 'symlinkEscape', 'foreignWikiRoot', 'projectIdMismatch', 'uncontainedPaths']) {
    const value = rootPolicy.denials?.[flag];
    if (value !== true) add('POLICY_DENIAL_DISABLED', `project-root-policy.json:denials.${flag}`, { reason: 'containment denial declarations must all be true; flags are records, and a false record fails validate' });
  }
  const rootClaim = rootPolicy.canonicalWiki?.root ?? '';
  if (typeof rootClaim !== 'string' || !rootClaim || path.isAbsolute(rootClaim) || rootClaim.split(path.sep).includes('..')) {
    add('CANONICAL_ROOT_NOT_CONTAINED', 'project-root-policy.json:canonicalWiki.root');
  } else {
    const registered = registeredWikiTarget(rootPolicy);
    if (!registered.ok) add('ROOT_REGISTRATION_MISMATCH', 'project-root-policy.json:canonicalWiki.root', { reason: registered.reason });
  }

  if (typeof lock.source.treeSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(lock.source.treeSha256) || typeof lock.distribution.requirementsLock.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(lock.distribution.requirementsLock.sha256) || !Number.isSafeInteger(lock.distribution?.requirementsLock?.bytes) || lock.distribution.requirementsLock.bytes <= 0) add('SOURCE_INTEGRITY_BINDING_MISSING', 'package.lock.json');

  // index-policy.json：接口、三态、索引非权威、知识权威边界、写入门禁、intake 禁令。
  if (indexPolicy.interface !== 'IndexPolicy.v1') add('INDEX_POLICY_INTERFACE_INVALID', 'index-policy.json', { expected: 'IndexPolicy.v1' });
  for (const tier of ['raw', 'staging', 'curated']) {
    if (!indexPolicy.tiers?.[tier] || indexPolicy.tiers[tier].isWikiFactAuthority !== (tier === 'curated')) add('TIER_MODEL_INCOMPLETE', `index-policy.json:tiers.${tier}`);
  }
  if (['raw','staging','curated'].some((tier) => indexPolicy.tiers[tier]?.path !== { raw: 'raw/', staging: 'staging/', curated: 'wiki/curated/' }[tier])) add('TIER_PATH_SEPARATION_INVALID', 'index-policy.json:tiers');
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

  if (indexPolicy.index?.grantsKnowledgeAuthority !== false || ['tier', 'title', 'content', 'approvedBy', 'source', 'revision'].some((field) => !indexPolicy.knowledgeWrite.requiredEntryFields.includes(field))) add('KNOWLEDGE_WRITE_GATE_DISABLED', 'index-policy.json:requiredEntryFields');

  // mcp-profile.json：接口、component-profile-only 边界（不得双写活配置）。
  if (profile.interface !== 'McpComponentProfile.v1') add('MCP_PROFILE_INTERFACE_INVALID', 'mcp-profile.json', { expected: 'McpComponentProfile.v1' });
  const observedTools = lock.mcpSession?.toolsObserved;
  if (!Array.isArray(observedTools) || !profile.capabilities.length || new Set(profile.capabilities).size !== profile.capabilities.length
      || profile.capabilities.some((tool) => typeof tool !== 'string' || !observedTools.includes(tool))
      || ['create','read','search'].some((tool) => !profile.capabilities.includes(tool))) add('MCP_CAPABILITY_MISMATCH', 'mcp-profile.json:capabilities');
  if (profile.hostRegistration?.thisFileDoesNotRegister !== true || profile.hostRegistration?.liveConfigDoubleWriteForbidden !== true) add('HOST_REGISTRATION_SCOPE_INVALID', 'mcp-profile.json:hostRegistration');
  if (profile.registrationScope !== 'component-profile-only') {
    add('HOST_REGISTRATION_SCOPE_INVALID', 'mcp-profile.json:registrationScope', { declared: profile.registrationScope, reason: 'this task produces a component profile only; host registration belongs to the P task via mcp-capabilities.yaml' });
  }
  if (profile.observation?.hostDiscoveryStatus === 'VERIFIED' && profile.observation?.hostDiscovered !== true) {
    add('HOST_DISCOVERY_CLAIM_INVALID', 'mcp-profile.json:observation', { reason: 'a VERIFIED host discovery claim must carry hostDiscovered=true' });
  }
  const launcherPath = lock.distribution?.launcher?.path ?? '';
  const entryCommand = profile.hostEntry?.command ?? '';
  if (launcherPath !== 'tools/mcp/llmwiki.sh' || entryCommand !== '${CLAUDE_PROJECT_DIR}/tools/mcp/llmwiki.sh' || !Array.isArray(profile.hostEntry?.args) || profile.hostEntry.args.length !== 0 || profile.hostEntry?.transport !== 'stdio') {
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
  const project = resolveMainTree();
  if (!project.ok) return { error: project.reason };
  const registeredHome = path.join(project.mainTree, '.sdd');
  const sddHome = process.env.SDD_HOME ? path.resolve(process.env.SDD_HOME) : registeredHome;
  const registeredPython = path.join(registeredHome, 'venvs', 'llmwiki-311', 'bin', 'python');
  return { sddHome, registeredHome, registeredPython,
    cloneDir: path.join(sddHome, 'repos', 'llmwiki'),
    mcpDir: path.join(sddHome, 'repos', 'llmwiki', 'mcp'),
    requirementsLock: path.join(sddHome, 'repos', 'llmwiki', 'mcp', 'requirements.lock'),
    venvPython: process.env.LLMWIKI_PYTHON ? path.resolve(process.env.LLMWIKI_PYTHON) : registeredPython,
    launcher: path.resolve(repoRoot, lock.distribution.launcher.path),
  };
}

function sourceTreeDigest(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (['.git', '.venv', '__pycache__'].includes(name)) continue;
      if (name === '.env' || name.startsWith('.env.local')) throw Object.assign(new Error('SOURCE_PRIVATE_ENV_FORBIDDEN'), { code: 'SOURCE_PRIVATE_ENV_FORBIDDEN' });
      const file = path.join(dir, name); const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Object.assign(new Error('SOURCE_SYMLINK_FORBIDDEN'), { code: 'SOURCE_SYMLINK_FORBIDDEN' });
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) files.push([path.relative(root, file).split(path.sep).join('/'), sha256File(file)]);
      else throw Object.assign(new Error('SOURCE_FILE_TYPE_UNSUPPORTED'), { code: 'SOURCE_FILE_TYPE_UNSUPPORTED' });
    }
  };
  visit(root); files.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return { sha256: sha256Text(files.map(([name, hash]) => `${name}\0${hash}\n`).join('')), files: files.length };
}

function inspectRuntime(lock) {
  const dist = resolveDistributionPaths(lock); const categories = {}; let runtimeExecuted = false;
  if (dist.error) return { dist, ready: false, runtimeExecuted, categories: { distribution: UNVERIFIED(dist.error) } };
  try {
    const tree = sourceTreeDigest(dist.cloneDir);
    categories['upstream-source'] = tree.sha256 === lock.source.treeSha256
      ? { status: 'VERIFIED', sourceCommit: lock.source.commit, treeSha256: tree.sha256, files: tree.files, proof: 'current byte tree equals the fixed Git-archive tree' }
      : { status: 'MISMATCH', observed: tree.sha256, expected: lock.source.treeSha256 };
    const requirements = sha256File(dist.requirementsLock);
    categories['requirements-lock-digest'] = requirements === lock.distribution.requirementsLock.sha256 && fs.statSync(dist.requirementsLock).size === lock.distribution.requirementsLock.bytes
      ? { status: 'VERIFIED', observed: requirements, bytes: fs.statSync(dist.requirementsLock).size }
      : { status: 'MISMATCH', observed: requirements };
  } catch (error) { categories['upstream-source'] = UNVERIFIED(`SOURCE_INSPECTION_FAILED:${safeFailureCode(error)}`); }
  if (dist.venvPython !== dist.registeredPython) {
    categories['venv-runtime'] = { status: 'REJECTED', reason: 'PYTHON_NOT_REGISTERED: only the existing project-local 3.11 venv may execute; arbitrary overrides are not admitted' };
  } else if (Object.values(categories).every((item) => item.status === 'VERIFIED')) {
    const run = spawnSync(dist.venvPython, ['-c', 'import sys,importlib.metadata,json; print(json.dumps({"python":sys.version.split()[0],"mcp":importlib.metadata.version("mcp")}))'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    runtimeExecuted = Number.isSafeInteger(run.pid) && run.pid > 0;
    try {
      const versions = JSON.parse(run.stdout);
      if (!versions || typeof versions !== 'object' || Array.isArray(versions) || typeof versions.python !== 'string' || typeof versions.mcp !== 'string') {
        categories['venv-runtime'] = UNVERIFIED('registered interpreter returned invalid version types');
      } else categories['venv-runtime'] = run.status === 0 && /^3\.11\./.test(versions.python) && versions.mcp === lock.distribution.packages.find((p) => p.name === 'mcp').observedVersion
        ? { status: 'VERIFIED', python: versions.python, mcp: versions.mcp } : { status: 'MISMATCH', python: versions.python, mcp: versions.mcp };
    } catch { categories['venv-runtime'] = UNVERIFIED('registered Python/SDK versions could not be read'); }
  } else categories['venv-runtime'] = UNVERIFIED('source/requirements admission failed before interpreter execution');
  return { dist, categories, runtimeExecuted, ready: Object.values(categories).every((item) => item.status === 'VERIFIED'), distributionLocationMatches: dist.sddHome === dist.registeredHome };
}

function buildQualification({ registryFile, dir, docs }) {
  const lock = docs.get('package.lock.json');
  const roots = resolveCanonicalRoot(docs.get('project-root-policy.json'));
  const runtime = roots.ok ? inspectRuntime(lock) : { dist: resolveDistributionPaths(lock), runtimeExecuted: false, categories: { 'venv-runtime': UNVERIFIED('workspace admission failed before Python execution') } };
  const categories = { ...runtime.categories };
  categories['workspace-identity'] = roots.ok ? { status: 'VERIFIED', canonicalRootLabel: roots.rootLabel, rootPresent: roots.rootPresent, grantsAuthority: false } : UNVERIFIED(roots.reason);
  try {
    fs.accessSync(runtime.dist.launcher, fs.constants.X_OK);
    const observed = sha256File(runtime.dist.launcher);
    categories['launcher-entry'] = observed === lock.distribution.launcher.sha256 ? { status: 'VERIFIED', observed, executable: true } : { status: 'MISMATCH', observed, reason: 'P4_4 must refresh the same path authority/launcher; no self-refreeze' };
  } catch { categories['launcher-entry'] = UNVERIFIED('launcher not readable or executable'); }
  categories['distribution-project-location'] = runtime.distributionLocationMatches ? { status: 'VERIFIED' } : UNVERIFIED('public source cache is a fixture runtime, not the registered main project distribution');
  categories['mcp-host-discovery'] = UNVERIFIED('read-only qualification does not start a host or trust static hostDiscovered flags; actual isolated host observation remains a separate proof');
  categories['mcp-write-channel'] = UNVERIFIED('not executed by read-only qualify; use the current real sandbox MCP probe, never historical claim fields');
  categories['index-consistency'] = UNVERIFIED('not executed by read-only qualify; the current probe must query native documents/chunks/FTS for the same MCP-created bytes');
  categories['secret-provisioned'] = UNVERIFIED('source-read reference is not resolved by I04; fixture writes do not confer source access or a managed write grant');
  const inputs = { registrySha256: sha256File(registryFile), domainFiles: Object.fromEntries(DOMAIN_FILES.map((name) => [name, sha256File(path.join(dir, name))])) };
  return { interface: 'Qualification.v1', domain: 'llmwiki', scope: 'infrastructure-observation-only', ready: Object.values(categories).every((c) => c.status === 'VERIFIED'), sourceRuntimeReady: Boolean(runtime.ready && roots.ok), runtimeExecuted: runtime.runtimeExecuted,
    unverifiedCount: Object.values(categories).filter((c) => c.status === 'UNVERIFIED').length, categories, inputs, grantsAuthority: false, knowledgeGateSigned: false };
}

// ---- probe: worktree-mcp-readback ----

const MCP_SDK_PROBE = String.raw`import asyncio, datetime, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    request = json.loads(sys.stdin.read())
    env = {"PYTHONPATH": request["mcpDir"], "PYTHONDONTWRITEBYTECODE": "1", "LLMWIKI_USER_ID": "i04-fixture-user"}
    server = StdioServerParameters(command=sys.executable, args=["-m", "local_server", "--workspace", request["workspace"]], env=env, cwd=request["mcpDir"])
    result = {"responses": {}, "steps": []}
    async with stdio_client(server) as (reader, writer):
        async with ClientSession(reader, writer, read_timeout_seconds=datetime.timedelta(seconds=20)) as session:
            async def observe(label, call):
                value = await call
                result["responses"][label] = value.model_dump(mode="json", by_alias=True)
                result["steps"].append({"method": label, "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})
                return value
            await observe("initialize", session.initialize())
            await observe("tools/list", session.list_tools())
            await observe("create", session.call_tool("create", {"knowledge_base":"wiki", "title":"i04-probe-entry.md", "content":request["body"], "tags":["fixture","curated"], "path":"/wiki/curated/"}))
            await observe("read", session.call_tool("read", {"knowledge_base":"wiki", "path":"/wiki/curated/i04-probe-entry.md"}))
            await observe("search", session.call_tool("search", {"knowledge_base":"wiki", "mode":"search", "query":request["marker"], "path":"/wiki/**"}))
    sys.stdout.write(json.dumps(result)+"\n")
    sys.stdout.flush()

asyncio.run(main())
`;

function nativeReadback(sandbox, entry, marker, python) {
  const file = path.join(sandbox, entry);
  const actual = fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null;
  const script = String.raw`import sqlite3,sys,json,hashlib
conn=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
rows=conn.execute("SELECT id,content,relative_path,status,source_kind,version FROM documents WHERE relative_path=?",(sys.argv[2],)).fetchall()
result={"rows":len(rows),"chunkCount":0,"ftsMatches":0}
if len(rows)==1:
 r=rows[0]
 result.update({"id":r[0],"contentSha256":hashlib.sha256((r[1] or "").encode()).hexdigest(),"relativePath":r[2],"status":r[3],"sourceKind":r[4],"version":r[5]})
 result["chunkCount"]=conn.execute("SELECT count(*) FROM document_chunks WHERE document_id=?",(r[0],)).fetchone()[0]
 result["ftsMatches"]=conn.execute("SELECT count(*) FROM chunks_fts JOIN document_chunks c ON c.rowid=chunks_fts.rowid WHERE chunks_fts MATCH ? AND c.document_id=?",(sys.argv[3],r[0])).fetchone()[0]
conn.close()
print(json.dumps(result))`;
  const read = spawnSync(python, ['-c', script, path.join(sandbox, '.llmwiki/index.db'), entry, marker], { encoding: 'utf8', timeout: 15000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  let index = null; try { index = JSON.parse(read.stdout); } catch { /* retained below as an actual read failure */ }
  const fileHash = actual === null ? null : sha256Text(actual);
  const consistent = read.status === 0 && index?.rows === 1 && actual !== null && index.contentSha256 === fileHash
    && index.relativePath === entry && index.status === 'ready' && index.sourceKind === 'wiki' && index.version >= 1 && index.chunkCount > 0 && index.ftsMatches > 0;
  return { status: consistent ? 'VERIFIED' : read.status === 0 ? 'MISMATCH' : 'UNVERIFIED', queryExecuted: read.status === 0, source: 'upstream-documents-and-fts',
    consistency: consistent ? 'CONSISTENT' : 'INCONSISTENT', file: { relativePath: entry, sha256: fileHash }, index,
    sqliteReadOnly: true, reason: read.status === 0 ? null : `NATIVE_INDEX_READ_FAILED:${childFailureCode(read)}` };
}

async function probeWorktreeMcpReadback(domainDir, docs) {
  const receipt = { interface: 'ProjectWikiInfra.v1', command: 'probe', case: 'worktree-mcp-readback', scope: 'component/stdio-sandbox',
    status: 'UNVERIFIED', executed: false, reason: null, knowledgeGateSigned: false, grantsAuthority: false,
    worktrees: [], worktreesCanonicalRootsConsistent: false, mcpSession: { workspace: 'sandbox' },
    nativeReadback: UNVERIFIED('no actual MCP-created entry has been read'),
    legacyFileLevelEquivalent: { status: 'HISTORICAL_COMPONENT_ONLY', acceptedForCurrentProof: false, reason: 'the former file overwrite/self-built i04_index_gate is retired; original Git evidence preserved' },
    requiredInputs: ['registered project identity and matching CLI wiki target','fixed source tree and requirements digest','registered Python 3.11 / MCP SDK version','actual host observation is separate from direct stdio'],
    plannedSteps: ['initialize/list/create/read/search through one actual SDK stdio session','read the unchanged created file and the native SQLite documents/chunks/FTS in a separate read-only process','exercise missing-index and stale-index negatives only in the disposable fixture'] };
  const finish = (reason) => { receipt.reason = reason; print(receipt); return EXIT_VERIFY; };
  const canonical = resolveCanonicalRoot(docs.get('project-root-policy.json'));
  if (!canonical.ok) return finish(canonical.reason);
  const worktreeList = listWorktrees();
  if (!worktreeList.ok) return finish(worktreeList.reason);
  for (const [i, wt] of worktreeList.worktrees.entries()) {
    const main = resolveMainTree(wt.path);
    const same = main.ok && realpathIfExists(main.mainTree) === canonical.mainTree;
    receipt.worktrees.push({ label: i === 0 ? MAIN_TREE_LABEL : `<linked-worktree:${path.basename(wt.path)}>`, canonicalRootLabel: same ? canonical.rootLabel : '<mismatch>', resolvesToCanonicalRoot: same });
  }
  receipt.worktreesCanonicalRootsConsistent = receipt.worktrees.every((wt) => wt.resolvesToCanonicalRoot);
  const runtime = inspectRuntime(docs.get('package.lock.json'));
  receipt.runtime = { categories: runtime.categories, distributionLocationMatches: runtime.distributionLocationMatches };
  if (!runtime.ready || !receipt.worktreesCanonicalRootsConsistent) return finish('runtime or project/worktree identity admission failed before MCP execution');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i04-native-'));
  try {
    receipt.executed = true;
    const marker = `i04fixtureproof${crypto.randomBytes(12).toString('hex')}`;
    const body = `---\ntier: curated\napprovedBy: fixture-owner\nsource: fixture://I04/readonly-public-source\nrevision: ${docs.get('package.lock.json').source.commit}\n---\n\n${marker}\nDisposable approved fixture knowledge only.\n`;
    const admission = admitKnowledgeEntry({ tier: 'curated', title: 'i04-probe-entry', content: body, approvedBy: 'fixture-owner', source: 'fixture://I04/readonly-public-source', revision: docs.get('package.lock.json').source.commit, factAuthority: 'approved-curated-entry' }, docs.get('index-policy.json'));
    receipt.fixtureAdmission = { ...admission, scope: 'disposable-owned-fixture-only', standingProjectGrant: false };
    if (!admission.allowed) return finish('fixture entry admission failed');
    const run = spawnSync(runtime.dist.venvPython, ['-c', MCP_SDK_PROBE], { input: JSON.stringify({ mcpDir: runtime.dist.mcpDir, workspace: sandbox, body, marker }), encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    let result = null; try { result = JSON.parse(run.stdout); } catch { /* no manufactured response */ }
    const responses = result?.responses ?? {};
    const texts = (value) => (value?.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const success = (value) => value && !value.isError && !/^Error:/i.test(texts(value));
    const tools = responses['tools/list']?.tools?.map((tool) => tool.name);
    const readVerified = success(responses.read) && texts(responses.read).includes(marker);
    const searchVerified = success(responses.search) && texts(responses.search).includes(marker);
    receipt.mcpSession = { workspace: 'sandbox', client: 'installed mcp SDK stdio_client / ClientSession', childExit: run.status,
      initialize: responses.initialize ? { status: 'VERIFIED', ...responses.initialize } : UNVERIFIED('no initialize response'),
      toolsList: tools ? { status: 'VERIFIED', tools } : UNVERIFIED('no tools/list response'),
      write: success(responses.create) ? { status: 'VERIFIED', response: texts(responses.create) } : UNVERIFIED('actual create did not succeed'),
      read: readVerified ? { status: 'VERIFIED', response: texts(responses.read) } : UNVERIFIED('MCP_READ_UNVERIFIED'),
      search: searchVerified ? { status: 'VERIFIED', response: texts(responses.search) } : UNVERIFIED('MCP_SEARCH_UNVERIFIED'),
      observedSteps: result?.steps ?? [], stderr: run.stderr ? 'MCP_STDIO_STDERR_PRESENT' : '', executionErrorCode: run.error ? safeFailureCode(run.error) : null, nativeHostDiscovery: 'NOT_PROVEN_BY_DIRECT_STDIO' };
    if (run.status !== 0 || !responses.initialize || !tools || !docs.get('mcp-profile.json').capabilities.every((name) => tools.includes(name)) || receipt.mcpSession.write.status !== 'VERIFIED') return finish('actual SDK stdio initialize/list/create failed');
    const entry = 'wiki/curated/i04-probe-entry.md';
    receipt.nativeReadback = nativeReadback(sandbox, entry, marker, runtime.dist.venvPython);
    receipt.createdPayloadSha256 = sha256Text(body);
    receipt.payloadUnchanged = receipt.nativeReadback.file.sha256 === sha256Text(body);
    const ghost = 'wiki/curated/no-native-index.md'; fs.writeFileSync(path.join(sandbox, ghost), body);
    const missingIndex = nativeReadback(sandbox, ghost, marker, runtime.dist.venvPython);
    const entryPath = path.join(sandbox, entry); const original = fs.readFileSync(entryPath);
    let stale;
    try { fs.writeFileSync(entryPath, Buffer.concat([original, Buffer.from('\ncontrolled stale-file negative\n')])); stale = nativeReadback(sandbox, entry, marker, runtime.dist.venvPython); }
    finally { fs.writeFileSync(entryPath, original); }
    receipt.negativeControls = { fileWithoutNativeIndex: missingIndex, changedFileStaleIndex: stale };
    receipt.restoredPayloadSha256 = sha256File(entryPath);
    const good = receipt.payloadUnchanged && receipt.nativeReadback.consistency === 'CONSISTENT'
      && receipt.mcpSession.read.status === 'VERIFIED' && receipt.mcpSession.search.status === 'VERIFIED'
      && missingIndex.consistency === 'INCONSISTENT' && stale.consistency === 'INCONSISTENT'
      && receipt.restoredPayloadSha256 === receipt.createdPayloadSha256;
    if (!good) return finish('same-entry actual storage/index consistency or its fault controls failed; infrastructure signs no Kp');
    receipt.status = 'VERIFIED'; receipt.reason = 'actual private fixture stdio/storage/index only; no managed write or Kp authority'; print(receipt); return EXIT_PASS;
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
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
  let outsideDir = null;
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
    for (const claim of ['release..notes.md', '..draft.md']) {
      fs.writeFileSync(path.join(canonicalRoot, claim), 'safe filename\n');
      const result = resolveContainedPath(realCanonicalRoot, claim, rootPolicy.denials ?? {});
      receipt.positiveControls.push({ claim, code: result.code, allowed: result.allowed });
    }
    fs.mkdirSync(path.join(canonicalRoot, 'subtree'));
    receipt.exactRootControl = resolveForeignRoot(realCanonicalRoot, path.join(canonicalRoot, 'subtree'));

    // 目录穿越：.. 逃出 canonical root（目标文件真实存在，穿越被几何拒绝）。
    fs.writeFileSync(path.join(sandbox, 'outside.md'), 'outside\n');
    const traversal = resolveContainedPath(realCanonicalRoot, '../../outside.md', rootPolicy.denials ?? {});
    receipt.denials.push({ code: traversal.code, allowed: traversal.allowed, reason: traversal.reason });

    // 符号链接越域：canonical root 内的 symlink 指向 sandbox 外。
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i04-outside-'));
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
    if (outsideDir) fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ---- main ----

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput('arguments invalid', error);
  if (!command) return failInput('command invalid', 'COMMAND_REQUIRED');

  if (!['validate', 'qualify', 'probe'].includes(command)) return failInput('command invalid', 'COMMAND_UNKNOWN');
  if (command === 'probe' && !['worktree-mcp-readback', 'escape-denial'].includes(opts.case)) return failInput('probe input invalid', opts.case ? 'PROBE_CASE_INVALID' : 'PROBE_CASE_REQUIRED');

  // All entrypoints share registry/domain admission before any runtime/fixture action.
  // registry 与 refs 目录必须先可读（fail-closed，绝不静默降级为空规则）。
  const registryFile = path.resolve(opts.registry ?? DEFAULT_REGISTRY);
  const refsFile = path.resolve(opts.refs ?? DEFAULT_REFS);
  const registryInput = readJson(registryFile);
  if (!registryInput.ok) return failInput('registry unreadable', registryInput.code);
  const refsInput = readJson(refsFile);
  if (!refsInput.ok) return failInput('refs catalog unreadable', refsInput.code);
  const registry = registryInput.value; const refsDoc = refsInput.value;
  // Reuse I01's current public validator rather than inventing another registry authority.
  const admission = spawnSync(process.execPath, [path.join(repoRoot, 'tools/infra/registry.mjs'), 'validate', '--registry', registryFile, '--refs', refsFile, '--json'], { cwd: repoRoot, encoding: 'utf8', timeout: 15000 });
  let registration = null; try { registration = JSON.parse(admission.stdout); } catch { /* reject below */ }
  if (admission.status !== 0 || registration?.ok !== true) {
    print({ interface: command === 'qualify' ? 'Qualification.v1' : 'ProjectWikiInfra.v1', command, ok: false, ready: false,
      status: 'REJECTED', runtimeExecuted: false, reason: 'I01 registry/identity/reference admission failed',
      violations: registration?.violations?.length ? registration.violations : [{ code: 'REGISTRY_VALIDATION_UNAVAILABLE' }] });
    return EXIT_VERIFY;
  }
  const dir = path.resolve(opts.dir ?? DEFAULT_DIR);
  const { files, issues } = loadDomainFiles(dir);
  if (issues.length > 0) return failInput('domain input invalid', issues.join('; '));

  const { violations, catalogGaps, docs } = validateDomain({ registry, refsDoc, files });
  if (violations.length > 0) {
    print({ interface: command === 'qualify' ? 'Qualification.v1' : 'ProjectWikiInfra.v1', command,
      case: opts.case ?? null, ready: false, ok: false, status: 'REJECTED', violations, catalogGaps,
      executed: false, runtimeExecuted: false, reason: 'domain admission failed before summaries, runtime or sandbox execution' });
    return EXIT_VERIFY;
  }
  if (command === 'validate') {
    print({
      interface: 'ProjectWikiInfra.v1',
      command: 'validate',
      runtimeExecuted: false,
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

  if (command === 'probe') {
    if (opts.case === 'worktree-mcp-readback') return await probeWorktreeMcpReadback(dir, docs);
    const target = resolveCanonicalRoot(docs.get('project-root-policy.json'));
    if (!target.ok) {
      print({ interface: 'ProjectWikiInfra.v1', command, case: opts.case, status: 'UNVERIFIED', runtimeExecuted: false, executed: false, reason: target.reason, nativeReadback: UNVERIFIED(target.reason), grantsAuthority: false, knowledgeGateSigned: false });
      return EXIT_VERIFY;
    }
    return probeEscapeDenial(dir, docs);
  }
  if (command === 'qualify') {
    const qualification = buildQualification({ registryFile, dir, docs });
    qualification.violations = violations;
    qualification.catalogGaps = catalogGaps;
    print(qualification);
    return qualification.ready ? EXIT_PASS : EXIT_VERIFY;
  }

  return failInput('command invalid', 'COMMAND_UNKNOWN');
}

// 管道下 process.exit 不等 stdout flush 会截断回执（实测 8427B 收 8190B）；
// exit 前显式 drain。stdout.write 空串回调即代表写队列已清空。
async function exitAfterDrain(code) {
  await new Promise((resolve) => process.stdout.write('', resolve));
  process.exit(code);
}
main(process.argv.slice(2)).then(
  (code) => exitAfterDrain(code),
  (error) => { process.stderr.write(`internal failure: INTERNAL_FAILURE (${safeFailureCode(error)})\n`); exitAfterDrain(1); },
);
