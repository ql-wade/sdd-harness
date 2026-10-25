#!/usr/bin/env node
// foundation-export.mjs — asset exporter + FoundationLock + old-run pinning
// (delivery-foundation-rearchitecture P1_2; semantics: F01/F02/F04/B09).
//
// 唯一源（single sources of truth）：
//   .agents/skills/            — 技能正文（P1_6 快照）
//   hooks.yaml                 — 控制平面策略源
//   mcp-capabilities.yaml      — MCP 能力清单；.mcp.json 是其生成产物（注册视图）
//   method-profile-manifest    — 方法 profile（P1_6）
// exporter 只读这些源，生成发布视图（产物）与 FoundationLock；产物不回写源，
// 双向手改都会被 verify 检出（避免分发目录成为第二源）。
//
// 用法：
//   node tools/foundation-export.mjs export  --root DIR --out DIR
//        [--release-commit SHA] [--skills-copy] [--profile P]
//        [--teamai-view DIR --teamai-expected FILE --teamai-repo HTTPS_URL]
//   node tools/foundation-export.mjs verify  --root DIR --lock FILE
//   node tools/foundation-export.mjs check-run --run-dir DIR --root DIR
//        [--acquire --owner ID] [--migrate --owner ID]
//
// run 目录布局（check-run 消费）：
//   <runDir>/foundation-lock.json — run 启动时冻结的锁（复制）
//   <runDir>/run-state.json       — {schemaVersion,runId,status,owner,...}

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContract } from '../contracts/delivery/index.js';

const PROFILE_REL = 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json';
const PROFILE_DATA_REL = 'foundation/profiles/comet-managed.json';
const retiredName = (name) => /^(sdd-|trinity-|source-command-sdd-)|^superpowers$/.test(name);
const COMET_LOCK_REL = 'integrations/comet/upstream.lock.json';
const MANAGED_SCRIPT_RE = /hooks\/(pre-tool-gate|session-context|stop-reminder)\.sh/;
const MACHINE_PATH_RE = /\/Users\/|\/home\/|\$HOME|%USERPROFILE%/;
const FLOATING_RE = /@latest|unpinned/i;

export const sha256Bytes = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Filesystem names are data: prototype keys must remain enumerable own keys.
const assetDictionary = (entries = []) => Object.assign(Object.create(null), Object.fromEntries(entries));

// Canonical JSON: recursively sorted keys — the digest basis for everything
// the lock freezes (deterministic across machines and runs).
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

// P1_6 digest basis: sha256 over the sorted "sha256  relative-path" lines.
function aggregateDigest(lines) {
  return sha256Bytes(lines.slice().sort().join('\n'));
}

function rejectLinkedPath(root, relative = '') {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('STATE_SYNC_REQUIRED: asset path escape');
  const absolute = path.resolve(root, relative);
  let at = path.parse(absolute).root;
  const parts = absolute.slice(at.length).split(path.sep).filter(Boolean);
  let info = fs.lstatSync(at);
  for (const [index, part] of parts.entries()) {
    at = path.join(at, part);
    try { info = fs.lstatSync(at); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (info.isSymbolicLink()) {
      // Darwin's root namespace aliases are OS-owned, not package redirects.
      const systemAlias = process.platform === 'darwin' && ({'/var':'/private/var','/tmp':'/private/tmp','/etc':'/private/etc'})[at];
      if (!systemAlias || fs.realpathSync(at) !== systemAlias) throw new Error(`STATE_SYNC_REQUIRED: symlink asset path: ${at}`);
      at = systemAlias;
      info = fs.lstatSync(at);
    }
    if ((!info.isDirectory() && !info.isFile()) || (index < parts.length - 1 && !info.isDirectory())) throw new Error(`STATE_SYNC_REQUIRED: unsafe asset path type: ${at}`);
  }
  return info;
}
function outputFile(file) {
  const info = rejectLinkedPath(path.dirname(file), path.basename(file));
  if (info && (!info.isFile() || info.nlink !== 1)) throw new Error(`STATE_SYNC_REQUIRED: unsafe output file: ${file}`);
  return info;
}
function readOutputFile(file, encoding) {
  outputFile(file);
  return fs.readFileSync(file, {encoding,flag:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK});
}
// Explicit project call closure, audited in the P1_2 rework dependency inventory.
// Host runtimes, npm modules and generated/user state are never recursively packed.
const CODE_ASSETS = [
  'tools/foundation-export.mjs', 'tools/bootstrap.sh', 'tools/adapters/claude-code.sh',
  'foundation/managed_io.py',
  'hooks/pre-tool-gate.sh', 'hooks/session-context.sh', 'hooks/stop-reminder.sh', 'hooks/_resolve-project-dir.sh',
  'tools/register-mcps.mjs', 'tools/mcp/llmwiki.sh',
  'scripts/agent-instructions-check.sh', 'scripts/agent-skill-check.sh',
  'contracts/delivery/index.js', 'contracts/delivery/schema-kernel.js',
  'contracts/delivery/foundation-lock.schema.js', 'contracts/delivery/baseline-ref.schema.js',
  'contracts/delivery/test-contract.schema.js', 'contracts/delivery/plan-bundle.schema.js',
  'contracts/delivery/candidate-ref.schema.js', 'contracts/delivery/evidence-envelope.schema.js',
  'contracts/delivery/gate-receipt.schema.js', 'contracts/delivery/release-receipt.schema.js',
  'contracts/delivery/action-binding.schema.js',
];
const DEPENDENCY_METADATA = ['package.json', 'package-lock.json', COMET_LOCK_REL];
function sourceFile(root, relative) {
  const info = rejectLinkedPath(root, relative);
  if (!info?.isFile()) throw new Error(`not a regular asset: ${relative}`);
  return path.resolve(root, relative);
}
const EXCLUDED = new Set(['__pycache__', '.DS_Store', '.git']);

function walkFiles(dir, prefix = '', out = [], excludeGenerated = true) {
  if (!rejectLinkedPath(dir)?.isDirectory()) throw new Error(`not a real asset directory: ${dir}`);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink asset refused: ${rel}`);
    if (!entry.isDirectory() && !entry.isFile()) throw new Error(`special asset refused: ${rel}`);
    if (!excludeGenerated && entry.isFile()) outputFile(abs);
    if (excludeGenerated && EXCLUDED.has(entry.name)) continue;
    if (entry.isDirectory()) walkFiles(abs, rel, out, excludeGenerated);
    else out.push({ rel, abs });
  }
  return out;
}
// Aggregate digest of one skill directory (identical basis to the P1_6
// method-profile manifest, so both can be cross-checked).
function isGitWorkTree(root) {
  const probe = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {encoding:'utf8'});
  return probe.status === 0 && fs.realpathSync(probe.stdout.trim()) === fs.realpathSync(root);
}

// Enumerate a skill's distributable files. In a git work tree the basis is
// the TRACKED file set (what the repo actually distributes; matches git
// history resolution and the P1_6 manifest basis). Outside git (fixtures),
// fall back to a filesystem walk.
function skillFiles(root, name) {
  const dir = path.join(root, '.agents/skills', name);
  if (!fs.existsSync(dir)) throw new Error(`skill source missing: .agents/skills/${name}`);
  if (isGitWorkTree(root)) {
    const ls = spawnSync('git', ['-C', root, 'ls-files', '--', `.agents/skills/${name}`], { encoding: 'utf8' });
    if (ls.status !== 0) throw new Error(`git ls-files failed for ${name}: ${ls.stderr}`);
    return ls.stdout.split('\n').filter(Boolean).map((rel) => ({ rel: rel.slice(`.agents/skills/${name}/`.length), abs: path.join(root, rel) }));
  }
  // Prefix siblings must use Git file order, rather than directory traversal order.
  return walkFiles(dir).sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
}

export function skillDigest(root, name) {
  const files = skillFiles(root, name);
  if (files.length === 0) throw new Error(`skill ${name} has no files — refusing to freeze an empty asset`);
  const lines = [];
  const byRel = assetDictionary();
  for (const f of files) {
    const digest = sha256Bytes(fs.readFileSync(sourceFile(root,path.relative(root,f.abs))));
    byRel[f.rel] = digest;
    // Line path includes the skill name — the exact P1_6 manifest basis.
    lines.push(`${digest}  ${name}/${f.rel}`);
  }
  return { name, digest: aggregateDigest(lines), fileCount: files.length, files: byRel };
}

// ---- emission gates (machine paths / floating versions / MCP pins) ----

function versionLooksPinned(version) {
  return /^[0-9A-Za-z][0-9A-Za-z.\-+_.]*$/.test(version) && !FLOATING_RE.test(version) && !/^(HEAD|master|main|develop|dev)$/i.test(version);
}

export function guardLock(lock, { mcpRaw } = {}) {
  const errors = [];
  const contract = parseContract('SDD.Delivery.FoundationLock', lock);
  if (!contract.ok) errors.push(...contract.errors.map((e) => `contract: ${e}`));

  const serialized = canonicalJson(lock);
  if (!/^[a-f0-9]{40}$/.test(lock.release?.commit ?? '')) errors.push('release.commit must be a fixed Git SHA');
  if (MACHINE_PATH_RE.test(serialized)) errors.push('machine absolute path found in lock (must contain no host-specific paths)');

  for (const [label, version] of [
    ['toolchain.cli.version', lock.toolchain?.cli?.version],
    ['toolchain.runner.version', lock.toolchain?.runner?.version],
    ['toolchain.node', lock.toolchain?.node],
  ]) {
    if (typeof version !== 'string' || !versionLooksPinned(version)) {
      errors.push(`floating version refused at ${label}: ${JSON.stringify(version ?? null)} (no @latest/HEAD/branch names/unpinned)`);
    }
  }

  if (mcpRaw !== undefined && mcpRaw !== null) {
    const raw = String(mcpRaw);
    if (FLOATING_RE.test(raw)) errors.push('floating version found in MCP registrations (@latest/unpinned)');
    if (MACHINE_PATH_RE.test(raw)) errors.push('machine absolute path found in MCP registrations');
    let mcpJson;
    try {
      mcpJson = JSON.parse(raw);
    } catch (err) {
      errors.push(`MCP registration artifact is not valid JSON: ${err.message}`);
      mcpJson = null;
    }
    for (const [name, entry] of Object.entries(mcpJson?.mcpServers ?? {})) {
      const args = Array.isArray(entry?.args) ? entry.args.map(String) : [];
      for (const [key,value] of Object.entries(entry.env ?? {})) if (/token|password|secret|api.?key/i.test(key) && value && !/^\$\{[^}]+\}$/.test(String(value))) errors.push(`MCP ${name}: literal credential refused at env.${key}`);
      const isNpx = entry?.command === 'npx';
      const hasWrapper = args.some((a) => a.includes('${') || a.includes('}'));
      if (isNpx && !hasWrapper) {
        const packageArgs = args.filter((a) => !a.startsWith('-'));
        const pinned = packageArgs.some((a) => /@[0-9v][0-9A-Za-z.\-+_.]*$/.test(a));
        if (!pinned) errors.push(`MCP ${name}: npx args ${JSON.stringify(packageArgs)} carry no pinned package version`);
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors };
}

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function gitRevParseHead(root) {
  const run = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`--release-commit not given and root is not a git work tree: ${run.stderr}`);
  }
  return run.stdout.trim();
}

// Collect the full asset set from the unique sources and build the lock
// payload. options: { releaseCommit?, profile?, mcpRaw? } (mcpRaw override is
// for fixtures; default reads <root>/.mcp.json).
export async function buildLock(root, options = {}) {
  const skillsDir = path.join(root, '.agents/skills');
  if (!fs.existsSync(skillsDir)) throw new Error(`unique skill source missing: ${skillsDir}`);
  const manifestPath = path.join(root, PROFILE_REL);
  const manifest = readJsonIfExists(manifestPath);
  const directories = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  const retired = directories.filter(retiredName);
  if (retired.length) throw new Error(`retired workflow sources refuse distribution: ${retired.join(', ')}`);
  const names = manifest?.snapshots?.map((s) => s.name).sort() ?? directories;
  if (new Set(names).size !== names.length || names.some((n) => !/^[a-z0-9][a-z0-9-]*$/.test(n))) throw new Error('invalid selected method names');
  const skills = names.map((name) => {
    const d = skillDigest(root, name);
    const expected = manifest?.snapshots?.find((s) => s.name === name);
    if (expected && (d.digest !== expected.content_sha256 || Object.keys(d.files).length !== expected.file_count)) throw new Error(`selected source drift: ${name}`);
    return { name, digest: d.digest, fileCount: d.fileCount, files: d.files };
  });

  const hooksPath = path.join(root, 'hooks.yaml');
  const hooksRaw = fs.readFileSync(hooksPath, 'utf8');
  // 注册分工门（V_P1_2_PLUGIN_REGISTRATION_DIVISION，契约 §7.2）：插件生命周期
  // Hook 由 Ponytail 插件入口注册；项目策略源不得携带插件来源脚本，否则发布
  // 视图会把插件 Hook 分发进每个成员的项目受管块。与 adapter 侧
  // PLUGIN_SOURCE_RE 同义（宿主语言不同，模式成对维护）。
  const pluginScripts = [...hooksRaw.matchAll(/^\s*script:\s*(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((value) => /CLAUDE_PLUGIN_ROOT|\.claude\/plugins\//.test(value));
  if (pluginScripts.length > 0) {
    throw new Error(`hooks.yaml carries plugin-managed lifecycle scripts (registration division §7.2 — plugin hooks are registered by the plugin entry, never distributed through the project policy source): ${pluginScripts.join('; ')}`);
  }
  const policy = { schemaRef: 'hooks.yaml', digest: sha256Bytes(Buffer.from(hooksRaw, 'utf8')) };

  const mcpJsonPath = path.join(root, '.mcp.json');
  const mcpRaw = options.mcpRaw !== undefined ? options.mcpRaw : (fs.existsSync(mcpJsonPath) ? fs.readFileSync(mcpJsonPath, 'utf8') : undefined);
  const mcpJson = mcpRaw !== undefined ? JSON.parse(mcpRaw) : { mcpServers: {} };
  const mcps = Object.entries(mcpJson.mcpServers ?? {})
    .map(([name, entry]) => ({ name, digest: sha256Bytes(canonicalJson({ command: entry.command ?? '', args: entry.args ?? [], env: entry.env ?? {} })) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  const profile = options.profile ?? manifest?.current_profile_id ?? manifest?.method_profile?.controller;
  let profileBinding = null;
  if (manifest?.current_profile_id) {
    const data = readJsonIfExists(path.join(root, PROFILE_DATA_REL));
    if (!data || data.id !== manifest.current_profile_id || profile !== data.id) throw new Error('current profile data/id mismatch');
    profileBinding = { schemaVersion: 1, id: data.id, manifest: { path: PROFILE_REL, sha256: sha256Bytes(fs.readFileSync(manifestPath)) }, data: { path: PROFILE_DATA_REL, sha256: sha256Bytes(fs.readFileSync(path.join(root, PROFILE_DATA_REL))) } };
  }
  if (!profile) throw new Error(`method profile missing (no controller in ${PROFILE_REL}); pass --profile explicitly`);
  const methodProfile = {
    path: PROFILE_REL,
    digest: profileBinding ? sha256Bytes(canonicalJson(profileBinding)) : manifest ? sha256Bytes(fs.readFileSync(manifestPath)) : sha256Bytes(canonicalJson({})),
    profile,
  };

  const cometLock = readJsonIfExists(path.join(root, COMET_LOCK_REL));
  if (!cometLock?.package?.version || !cometLock?.toolchain?.node) {
    throw new Error(`${COMET_LOCK_REL} must pin package.version and toolchain.node — refusing to freeze an unpinned runner`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const toolchain = {
    cli: { name: 'sdd', version: pkg.version },
    runner: { name: 'comet', version: cometLock.package.version },
    node: cometLock.toolchain.node,
    platforms: ['darwin', 'linux'],
  };

  const assetCode = profileBinding ? assetDictionary(CODE_ASSETS.map((rel)=>[rel,sha256Bytes(fs.readFileSync(sourceFile(root,rel)))])) : null;
  const assetData = profileBinding ? assetDictionary(DEPENDENCY_METADATA.map((rel)=>[rel,sha256Bytes(fs.readFileSync(sourceFile(root,rel)))])) : null;
  const commit = options.releaseCommit ?? gitRevParseHead(root);

  const lock = {
    schemaVersion: 1,
    release: {
      commit,
      exportDigest: sha256Bytes(canonicalJson({
        skills: skills.map(({ name, digest }) => ({ name, digest })),
        policy,
        mcps,
        methodProfile,
        toolchain,
        ...(profileBinding ? { assetCode, assetData, capabilities: fs.existsSync(path.join(root, 'mcp-capabilities.yaml')) ? sha256Bytes(fs.readFileSync(path.join(root, 'mcp-capabilities.yaml'))) : null } : {}),
      })),
    },
    skills: skills.map(({ name, digest }) => ({ name, digest })),
    policy,
    toolchain,
    profile,
    mcps,
    methodProfile,
  };

  const gate = guardLock(lock, { mcpRaw });
  if (!gate.ok) {
    throw new Error(`foundation export refused by emission gates:\n  - ${gate.errors.join('\n  - ')}`);
  }
  // Non-enumerable carrier for view writers; excluded from JSON and digests.
  Object.defineProperty(lock, '__sources', { enumerable: false, value: { skills, profileBinding, assetCode, assetData } });
  return lock;
}

function writeIfChanged(file, content) {
  const before = outputFile(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  outputFile(file);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const prior = before ? readOutputFile(file) : null;
  if (prior?.equals(bytes)) return false;
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.sdd-${crypto.randomBytes(12).toString('hex')}`);
  let fd, created = false;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, before ? before.mode & 0o777 : 0o644);
    created = true;
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    if (before) fs.fchmodSync(fd, before.mode & 0o777);
    fs.closeSync(fd); fd = undefined;
    const current = outputFile(file);
    if (before?.ino !== current?.ino || before?.mtimeMs !== current?.mtimeMs || before?.size !== current?.size) throw new Error('STATE_SYNC_REQUIRED: output changed during export');
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return true;
}
function skillsManifest(skills, bodyCopies = false) {
  return JSON.stringify({
    schemaVersion: 1,
    generatedBy: 'tools/foundation-export.mjs',
    bodyCopies,
    digestBasis: 'sha256 over the sorted "sha256  relative-path" lines of every file under .agents/skills/<name> (matches method-profile-manifest.json)',
    skills: assetDictionary(skills.map((s) => [s.name, { fileCount: s.fileCount, digest: s.digest, files: s.files }])),
  }, null, 2) + '\n';
}

function codeSources(lock) {
  return assetDictionary([...Object.entries(lock.__sources.assetCode ?? {}), ...Object.entries(lock.__sources.assetData ?? {})]);
}
function codeManifest(lock) {
  return JSON.stringify({schemaVersion:1, files:codeSources(lock)}, null, 2) + '\n';
}

// Generate the release view (产物) + foundation-lock.json under outDir.
// options: { releaseCommit?, profile?, skillsCopy? }
export async function exportRelease(root, outDir, options = {}) {
  const lock = await buildLock(root, options);
  const { skills } = lock.__sources;
  const emissions = [];
  const emit = (file, bytes) => emissions.push([file, bytes]);

  emit(path.join(outDir, 'foundation-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  const viewFiles = ['foundation-lock.json'];

  const hooksSrc = path.join(root, 'hooks.yaml');
  emit(path.join(outDir, 'release/hooks/hooks.yaml'), fs.readFileSync(hooksSrc, 'utf8'));
  viewFiles.push('release/hooks/hooks.yaml');

  const capsPath = path.join(root, 'mcp-capabilities.yaml');
  if (fs.existsSync(capsPath)) {
    emit(path.join(outDir, 'release/mcp/mcp-capabilities.yaml'), fs.readFileSync(capsPath, 'utf8'));
    viewFiles.push('release/mcp/mcp-capabilities.yaml');
  }
  const mcpJsonPath = path.join(root, '.mcp.json');
  if (fs.existsSync(mcpJsonPath)) {
    const view = { mcpServers: JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8')).mcpServers ?? {} };
    emit(path.join(outDir, 'release/mcp/mcp.json'), JSON.stringify(view, null, 2) + '\n');
    viewFiles.push('release/mcp/mcp.json');
  }

  emit(path.join(outDir, 'release/skills/MANIFEST.json'), skillsManifest(skills, options.skillsCopy === true));
  viewFiles.push('release/skills/MANIFEST.json');

  if (options.skillsCopy) {
    for (const skill of skills) {
      for (const [rel, abs] of Object.entries(fileMapFor(root, skill.name))) {
        emit(path.join(outDir, 'release/skills', skill.name, rel), fs.readFileSync(abs));
        viewFiles.push(`release/skills/${skill.name}/${rel}`);
      }
    }
  }

  if (lock.__sources.profileBinding) {
    for (const relative of Object.keys(codeSources(lock))) {
      const dest = `release/code/${relative}`;
      emit(path.join(outDir, dest), fs.readFileSync(sourceFile(root,relative)));
      viewFiles.push(dest);
    }
    emit(path.join(outDir,'release/code/MANIFEST.json'),codeManifest(lock));
    viewFiles.push('release/code/MANIFEST.json');
    for (const [dest, source] of [['release/profile/manifest.json', PROFILE_REL], ['release/profile/comet-managed.json', PROFILE_DATA_REL]]) {
      emit(path.join(outDir, dest), fs.readFileSync(path.join(root, source)));
      viewFiles.push(dest);
    }
    emit(path.join(outDir, 'release/profile/binding.json'), JSON.stringify(lock.__sources.profileBinding, null, 2) + '\n');
    viewFiles.push('release/profile/binding.json');
  }
  rejectLinkedPath(outDir);
  const releaseRoot = path.join(outDir, 'release');
  if (rejectLinkedPath(releaseRoot)) walkFiles(releaseRoot, '', [], false);
  for (const [file] of emissions) outputFile(file);
  if (options.freezeBaseline) await freezeBaseline(root, outDir, lock);
  for (const [file, bytes] of emissions) writeIfChanged(file, bytes);
  return { lock, outDir, files: viewFiles };
}

function fileMapFor(root, skillName) {
  return assetDictionary(skillFiles(root, skillName).map((f) => [f.rel, f.abs]));
}

// Content-addressed pure asset store; no Run, user settings, credentials or knowledge.
function pureAssets(root, lock) {
  const result = assetDictionary();
  for (const skill of lock.__sources.skills) for (const relative of Object.keys(skill.files)) {
    const rel = `.agents/skills/${skill.name}/${relative}`;
    result[rel] = fs.readFileSync(sourceFile(root, rel));
  }
  const metadata = ['hooks.yaml','package.json',COMET_LOCK_REL,PROFILE_REL,PROFILE_DATA_REL,'mcp-capabilities.yaml',...CODE_ASSETS,...DEPENDENCY_METADATA];
  for (const rel of metadata) if (fs.existsSync(path.join(root,rel))) result[rel] = fs.readFileSync(sourceFile(root,rel));
  if (fs.existsSync(path.join(root,'.mcp.json'))) result['.mcp.json'] = Buffer.from(JSON.stringify({mcpServers:JSON.parse(fs.readFileSync(sourceFile(root,'.mcp.json'),'utf8')).mcpServers??{}},null,2)+'\n');
  return result;
}
function cacheTree(root, prefix='') {
  if (!rejectLinkedPath(root)?.isDirectory()) throw new Error('not a real cache directory');
  const found = assetDictionary();
  if (!fs.readdirSync(root).length) throw new Error('unregistered empty cache directory');
  for (const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const rel=prefix?`${prefix}/${entry.name}`:entry.name;const abs=path.join(root,entry.name);
    if (entry.isSymbolicLink()) throw new Error('symlink in sealed asset cache');
    if (entry.isDirectory()) Object.assign(found,cacheTree(abs,rel));
    else if (entry.isFile()) found[rel]=sha256Bytes(readOutputFile(abs));
    else throw new Error('special file in sealed asset cache');
  }
  return found;
}
async function verifyCache(cache, expected) {
  if (fs.lstatSync(cache).isSymbolicLink()) throw new Error('symlink cache root');
  const source=path.join(cache,'source');
  // Inspect first, before a source reader may follow a nested link.
  const actual=cacheTree(cache);
  const pinned=JSON.parse(readOutputFile(path.join(cache,'foundation-lock.json'),'utf8'));
  if (canonicalJson(pinned)!==canonicalJson(expected)) throw new Error('frozen lock mismatch');
  const rebuilt=await buildLock(source,{releaseCommit:pinned.release.commit});
  if (canonicalJson(rebuilt)!==canonicalJson(pinned)) throw new Error('whole exportDigest or asset binding mismatch');
  const files=assetDictionary(Object.entries(pureAssets(source,rebuilt)).map(([p,b])=>['source/'+p,sha256Bytes(b)]));
  files['foundation-lock.json']=sha256Bytes(readOutputFile(path.join(cache,'foundation-lock.json')));
  const seal=JSON.parse(readOutputFile(path.join(cache,'manifest.json'),'utf8'));
  if (seal.exportDigest!==pinned.release.exportDigest || canonicalJson(seal.files)!==canonicalJson(files)) throw new Error('per-file sealed bytes mismatch');
  delete actual['manifest.json'];
  if (canonicalJson(actual)!==canonicalJson(files)) throw new Error('unexpected or missing sealed asset');
  return rebuilt;
}
async function freezeBaseline(root,outDir,lock) {
  const parent=path.join(outDir,'baselines');
  rejectLinkedPath(parent);
  fs.mkdirSync(parent,{recursive:true});rejectLinkedPath(parent);
  const cache=path.join(parent,lock.release.exportDigest);rejectLinkedPath(cache);
  if (fs.existsSync(cache)) {try {await verifyCache(cache,lock);return;} catch(error) {throw new Error(`STATE_SYNC_REQUIRED: old cache preserved: ${error.message}`);}}
  const temporary=fs.mkdtempSync(path.join(parent,'.pending-'));
  try {
    const files=assetDictionary();
    for (const [rel,bytes] of Object.entries(pureAssets(root,lock))) {const dest=path.join(temporary,'source',rel);fs.mkdirSync(path.dirname(dest),{recursive:true});writeIfChanged(dest,bytes);files['source/'+rel]=sha256Bytes(bytes);}
    const bytes=Buffer.from(JSON.stringify(lock,null,2)+'\n');writeIfChanged(path.join(temporary,'foundation-lock.json'),bytes);files['foundation-lock.json']=sha256Bytes(bytes);
    writeIfChanged(path.join(temporary,'manifest.json'),JSON.stringify({schemaVersion:1,exportDigest:lock.release.exportDigest,files},null,2)+'\n');
    await verifyCache(temporary,lock);fs.renameSync(temporary,cache);
  } finally {if(fs.existsSync(temporary))fs.rmSync(temporary,{recursive:true,force:true});}
}

// Verify: lock vs live sources, and release view vs sources/lock. Read-only.
export async function verifyLock(lockPath, root, { requireBodies = false } = {}) {
  const drifts = [];
  const outDir = path.dirname(lockPath);
  let lock;
  try {
    rejectLinkedPath(outDir);
    outputFile(lockPath);
    const releaseRoot = path.join(outDir, 'release');
    if (rejectLinkedPath(releaseRoot)) walkFiles(releaseRoot, '', [], false);
    lock = JSON.parse(readOutputFile(lockPath,'utf8'));
  } catch (err) {
    return { ok: false, error: `lock unreadable: ${err.message}`, drifts };
  }

  const gate = guardLock(lock, { mcpRaw: fs.existsSync(path.join(root, '.mcp.json')) ? fs.readFileSync(path.join(root, '.mcp.json'), 'utf8') : undefined });
  if (!gate.ok) return { ok: false, error: `lock fails emission gates: ${gate.errors.join('; ')}`, drifts };

  let current;
  try {
    // Recompute with the PINNED commit/profile so only content digests drive drift.
    current = await buildLock(root, { releaseCommit: lock.release.commit });
  } catch (err) {
    return { ok: false, error: `sources no longer produce a lock: ${err.message}`, drifts };
  }

  const byName = new Map(current.skills.map((s) => [s.name, s.digest]));
  for (const pinned of lock.skills ?? []) {
    if (byName.get(pinned.name) !== pinned.digest) {
      drifts.push({ kind: 'lock', item: pinned.name, expected: pinned.digest, actual: byName.get(pinned.name) ?? '(missing)', detail: 'skill digest drifted from the pinned lock' });
    }
  }
  if (lock.policy?.digest !== current.policy.digest) {
    drifts.push({ kind: 'lock', item: 'hooks.yaml', expected: lock.policy?.digest, actual: current.policy.digest, detail: 'policy digest drifted' });
  }
  const curMcp = new Map(current.mcps.map((m) => [m.name, m.digest]));
  const pinnedMcp = lock.mcps ?? [];
  for (const m of pinnedMcp) {
    if (curMcp.get(m.name) !== m.digest) {
      drifts.push({ kind: 'lock', item: `mcp:${m.name}`, expected: m.digest, actual: curMcp.get(m.name) ?? '(missing)', detail: 'MCP registration drifted' });
    }
  }
  if (lock.methodProfile?.digest !== current.methodProfile.digest) {
    drifts.push({ kind: 'lock', item: 'method-profile', expected: lock.methodProfile?.digest, actual: current.methodProfile.digest, detail: 'method profile drifted' });
  }
  if (JSON.stringify(lock.toolchain ?? {}) !== JSON.stringify(current.toolchain)) {
    drifts.push({ kind: 'lock', item: 'toolchain', expected: JSON.stringify(lock.toolchain ?? {}), actual: JSON.stringify(current.toolchain), detail: 'toolchain versions drifted' });
  }

  if (lock.release.exportDigest !== current.release.exportDigest) drifts.push({kind: 'lock', item: 'exportDigest', detail: 'complete asset set drifted'});
  const required = [['release/hooks/hooks.yaml', 'hooks.yaml'], ['release/skills/MANIFEST.json', null]];
  if (fs.existsSync(path.join(root, '.mcp.json'))) required.push(['release/mcp/mcp.json', null]);
  if (fs.existsSync(path.join(root, 'mcp-capabilities.yaml'))) required.push(['release/mcp/mcp-capabilities.yaml', 'mcp-capabilities.yaml']);
  if (current.__sources.profileBinding) required.push(['release/profile/manifest.json', PROFILE_REL], ['release/profile/comet-managed.json', PROFILE_DATA_REL], ['release/profile/binding.json', null]);
  for (const [view, source] of required) {
    const file = path.join(outDir, view);
    if (!fs.existsSync(file) || (source && !readOutputFile(file).equals(fs.readFileSync(path.join(root, source))))) drifts.push({kind:'release', item:view, detail:'required distribution file missing or drifted'});
  }
  if (current.__sources.profileBinding) {
    const codeRoot = path.join(outDir,'release/code');
    try {
      if (fs.lstatSync(codeRoot).isSymbolicLink()) throw new Error('symlink code release');
      const actual = cacheTree(codeRoot);
      const expected = codeSources(current);
      expected['MANIFEST.json'] = sha256Bytes(codeManifest(current));
      if (canonicalJson(actual)!==canonicalJson(expected)) drifts.push({kind:'release',item:'code',detail:'project code closure bytes or complete file set differs'});
    } catch(error) {drifts.push({kind:'release',item:'code',detail:error.message});}
    const bindingFile = path.join(outDir, 'release/profile/binding.json');
    if (fs.existsSync(bindingFile) && readOutputFile(bindingFile, 'utf8') !== JSON.stringify(current.__sources.profileBinding, null, 2) + '\n') drifts.push({kind:'release',item:'profile-binding',detail:'profile binding drifted'});
  }

  // Release view vs sources (second-source detection).
  const hooksView = path.join(outDir, 'release/hooks/hooks.yaml');
  if (fs.existsSync(hooksView)) {
    if (readOutputFile(hooksView, 'utf8') !== fs.readFileSync(path.join(root, 'hooks.yaml'), 'utf8')) {
      drifts.push({ kind: 'release', item: 'release/hooks/hooks.yaml', detail: 'hand-edited release view or drifted source — the view is a product, regenerate via export' });
    }
  }
  const mcpView = path.join(outDir, 'release/mcp/mcp.json');
  if (fs.existsSync(mcpView) && fs.existsSync(path.join(root, '.mcp.json'))) {
    const expected = JSON.stringify({ mcpServers: JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')).mcpServers ?? {} }, null, 2) + '\n';
    if (readOutputFile(mcpView, 'utf8') !== expected) {
      drifts.push({ kind: 'release', item: 'release/mcp/mcp.json', detail: 'release MCP view drifted from the generated registration artifact' });
    }
  }
  const manifestView = path.join(outDir, 'release/skills/MANIFEST.json');
  let bodyCopies = false;
  try { bodyCopies = JSON.parse(readOutputFile(manifestView, 'utf8')).bodyCopies === true; } catch {}
  if (fs.existsSync(manifestView)) {
    if (readOutputFile(manifestView, 'utf8') !== skillsManifest(current.__sources.skills, bodyCopies)) {
      drifts.push({ kind: 'release', item: 'release/skills/MANIFEST.json', detail: 'release skill manifest drifted from sources' });
    }
  }
  if (requireBodies && !bodyCopies) drifts.push({kind:'release',item:'bodyCopies',detail:'consumer requires complete method bodies'});
  // Full-body copies, when the view was exported with --skills-copy.
  const skillsCopyRoot = path.join(outDir, 'release/skills');
  if (fs.existsSync(skillsCopyRoot)) {
    for (const skill of current.__sources.skills) {
      const copyDir = path.join(skillsCopyRoot, skill.name);
      if (!fs.existsSync(copyDir)) { if (bodyCopies || requireBodies) drifts.push({kind:'release',item:skill.name,detail:'complete method directory missing'}); continue; }
      const actualFiles = walkFiles(copyDir,'',[],false).map((f)=>f.rel).sort();
      const expectedFiles = Object.keys(skill.files).sort();
      if (JSON.stringify(actualFiles)!==JSON.stringify(expectedFiles)) drifts.push({kind:'release',item:skill.name,detail:'copied method file set differs from selected source'});
      for (const [rel, abs] of Object.entries(fileMapFor(root, skill.name))) {
        const copy = path.join(copyDir, rel);
        if (!fs.existsSync(copy) || !readOutputFile(copy).equals(fs.readFileSync(abs))) {
          drifts.push({ kind: 'release', item: `release/skills/${skill.name}/${rel}`, detail: 'release skill body differs from the unique source (hand-edited distribution copy)' });
        }
      }
    }
  }

  if (fs.existsSync(skillsCopyRoot)) for (const entry of fs.readdirSync(skillsCopyRoot,{withFileTypes:true})) { if (entry.isDirectory() && !current.skills.some((s)=>s.name===entry.name)) drifts.push({kind:'release',item:entry.name,detail:'unselected method in release view'}); }
  return drifts.length > 0 ? { ok: false, drifts } : { ok: true, drifts };
}

// Resolve a pinned baseline from git history at lock.release.commit: every
// pinned digest must be re-derivable from the frozen commit (F04 keep-old-
// baseline). Read-only.
export async function resolveBaseline(root, lock) {
  try {rejectLinkedPath(root,`foundation/baselines/${lock.release.exportDigest}`);} catch(error) {return {ok:false,resolvable:false,reason:error.message,resolvedSkills:[],missing:['unsafe-cache-path']};}
  const cache=path.join(root,'foundation/baselines',lock.release.exportDigest);
  if (fs.existsSync(cache)) {try {await verifyCache(cache,lock);return {ok:true,resolvable:true,reason:'sealed pure assets verified byte-for-byte and whole exportDigest',resolvedSkills:lock.skills.map((s)=>s.name),missing:[],source:'sealed-assets'};} catch(error) {return {ok:false,resolvable:false,reason:`STATE_SYNC_REQUIRED: ${error.message}`,resolvedSkills:[],missing:['sealed-assets']};}}
  const resolvedSkills = [];
  const missing = [];
  const commit = lock?.release?.commit;
  // No encoding: content must be hashed byte-exact (binary assets included).
  const git = (args) => {
    const run = spawnSync('git', ['-C', root, ...args]);
    return { status: run.status, out: run.stdout ?? Buffer.alloc(0), err: (run.stderr ?? Buffer.alloc(0)).toString('utf8') };
  };
  const exists = git(['cat-file', '-e', `${commit}^{commit}`]);
  if (exists.status !== 0) {
    return { ok: false, resolvable: false, reason: `release commit ${commit} not reachable in this repository`, resolvedSkills, missing };
  }
  const show = (rel) => git(['show', `${commit}:${rel}`]);

  for (const skill of lock.skills ?? []) {
    const ls = git(['ls-tree', '-r', '--name-only', commit, '--', `.agents/skills/${skill.name}`]);
    if (ls.status !== 0 || !ls.out.toString('utf8').trim()) {
      missing.push(`${skill.name} (no files at ${commit.slice(0, 8)})`);
      continue;
    }
    const lines = [];
    for (const rel of ls.out.toString('utf8').trim().split('\n')) {
      const content = git(['show', `${commit}:${rel}`]);
      if (content.status !== 0) {
        missing.push(`${skill.name}/${path.basename(rel)} (unreadable at commit)`);
        continue;
      }
      const digest = sha256Bytes(content.out);
      lines.push(`${digest}  ${path.relative('.agents/skills', rel)}`);
    }
    if (aggregateDigest(lines) === skill.digest) resolvedSkills.push(skill.name);
    else missing.push(`${skill.name} (digest mismatch at ${commit.slice(0, 8)})`);
  }

  const policy = show('hooks.yaml');
  const policyOk = policy.status === 0 && sha256Bytes(policy.out) === lock.policy?.digest;
  if (!policyOk) missing.push('hooks.yaml (policy digest mismatch or missing at commit)');

  const manifest = show(PROFILE_REL);
  if (lock.methodProfile) {
    let expected = manifest.status === 0 ? sha256Bytes(manifest.out) : null;
    try {
      const data = JSON.parse(manifest.out);
      if (data.current_profile_id && lock.profile === data.current_profile_id) {
        const profileData = show(PROFILE_DATA_REL);
        if (profileData.status !== 0 || JSON.parse(profileData.out).id !== lock.profile) throw new Error('profile unavailable');
        expected = sha256Bytes(canonicalJson({schemaVersion:1,id:lock.profile,manifest:{path:PROFILE_REL,sha256:sha256Bytes(manifest.out)},data:{path:PROFILE_DATA_REL,sha256:sha256Bytes(profileData.out)}}));
      }
    } catch { expected = null; }
    if (lock.methodProfile.digest !== expected) missing.push('method profile (historical manifest/data mismatch)');
  }
  try {
    const registrations = JSON.parse(show('.mcp.json').out);
    const mcps = Object.entries(registrations.mcpServers ?? {}).map(([name,e])=>({name,digest:sha256Bytes(canonicalJson({command:e.command??'',args:e.args??[],env:e.env??{}}))})).sort((a,b)=>a.name.localeCompare(b.name));
    if (canonicalJson(mcps)!==canonicalJson(lock.mcps??[])) missing.push('MCP registrations (historical mismatch)');
    const pkg = JSON.parse(show('package.json').out);const upstream = JSON.parse(show(COMET_LOCK_REL).out);
    if (lock.toolchain.cli.version!==pkg.version || lock.toolchain.runner.version!==upstream.package.version || lock.toolchain.node!==upstream.toolchain.node) missing.push('toolchain (historical mismatch)');
    const fields={skills:lock.skills,policy:lock.policy,mcps:lock.mcps,methodProfile:lock.methodProfile,toolchain:lock.toolchain};
    const sourceManifest=JSON.parse(manifest.out);
    if (sourceManifest.current_profile_id && lock.profile===sourceManifest.current_profile_id) { const caps=show('mcp-capabilities.yaml');fields.capabilities=caps.status===0?sha256Bytes(caps.out):null;fields.assetCode=assetDictionary(CODE_ASSETS.map((rel)=>{const file=show(rel);if(file.status!==0)throw new Error('historical code asset missing');return [rel,sha256Bytes(file.out)];}));fields.assetData=assetDictionary(DEPENDENCY_METADATA.map((rel)=>{const file=show(rel);if(file.status!==0)throw new Error('historical dependency metadata missing');return [rel,sha256Bytes(file.out)];})); }
    if (sha256Bytes(canonicalJson(fields))!==lock.release.exportDigest) missing.push('complete export digest (historical mismatch)');
  } catch { missing.push('historical asset metadata unavailable'); }

  if (missing.length === 0) return { ok: true, resolvable: true, reason: 'all pinned digests resolve from the frozen release commit', resolvedSkills, missing };
  return { ok: false, resolvable: false, reason: `pinned baseline not resolvable: ${missing.join('; ')}`, resolvedSkills, missing };
}

function readRunDir(runDir) {
  const lockFile = path.join(runDir, 'foundation-lock.json');
  if (!fs.existsSync(lockFile)) throw new Error(`run dir has no foundation-lock.json: ${runDir}`);
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const stateFile = path.join(runDir, 'run-state.json');
  const state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    : { schemaVersion: 1, runId: path.basename(runDir), status: 'unclaimed', owner: null };
  return { lock, state, stateFile };
}

// check-run — F04 (old-run baseline keep/migrate) + B09 (single writer).
// Read-only unless options.acquire or options.migrate.
export async function checkRun(runDir, root, options = {}) {
  let material;try {material=readRunDir(runDir);} catch(error) {return {ok:false,action:'check',reason:'baseline-unresolvable',status:'STATE_SYNC_REQUIRED',detail:error.message};}
  const {lock,state,stateFile}=material;
  const native = (typeof state.skill === 'string' && typeof state.skillHash === 'string') || path.basename(runDir)==='.comet' || fs.existsSync(path.join(runDir,'../.comet.yaml'));
  if (native && (options.acquire || options.migrate)) return {ok:false,action:'check',reason:'native-run-readonly',status:'STATE_SYNC_REQUIRED',detail:'Foundation helpers cannot acquire or mutate a native Comet Run; use the same Comet kernel'};
  const current = await buildLock(root, { releaseCommit: lock.release.commit });
  const drift = current.release.exportDigest !== lock.release.exportDigest;
  const baseline = await resolveBaseline(root, lock);

  const migrationHint = `explicit paths: (1) rerun with --migrate --owner <run-owner> after review, or (2) close this run and start a new run against commit ${current.release.commit.slice(0, 8)} — a run is never silently re-baselined`;

  if (options.acquire) {
    const owner = options.owner;
    if (!owner) return { ok: false, action: 'acquire', reason: 'owner-required', drift, baseline };
    if (state.status === 'active' && state.owner && state.owner !== owner) {
      return { ok: false, action: 'acquire', reason: 'second-writer-refused', detail: `active run is owned by ${state.owner} (B09: no second writer)`, drift, baseline };
    }
    if (!baseline.ok) return {ok:false,action:'acquire',reason:'baseline-unresolvable',status:'STATE_SYNC_REQUIRED',baseline,drift};
    const next = { ...state, status: 'active', owner, pinnedCommit: lock.release.commit, baselineLock: 'foundation-lock.json' };
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n');
    return { ok: true, action: 'acquire', owner, drift, baseline, runId: next.runId };
  }

  if (options.migrate) {
    const owner = options.owner;
    if (state.status !== 'active') {
      return { ok: false, action: 'migrate', reason: 'nothing-to-migrate', detail: `run status is ${state.status}; only active runs migrate`, drift, baseline };
    }
    if (!owner || owner !== state.owner) {
      return { ok: false, action: 'migrate', reason: 'second-writer-refused', detail: `migration requires the run owner (${state.owner ?? 'unclaimed'}), got ${owner ?? 'none'}`, drift, baseline };
    }
    if (!baseline.ok) {
      return { ok: false, action: 'migrate', reason: 'baseline-unresolvable', detail: 'old baseline cannot be proven resolvable — manual re-verification required before any migration', migration: 're-run the affected acceptance checks against the new assets, then start a new run; the old pinned lock is preserved as-is', drift, baseline };
    }
    const migrations = state.migrations ?? [];
    migrations.push({ from: { commit: lock.release.commit, exportDigest: lock.release.exportDigest }, to: { commit: current.release.commit, exportDigest: current.release.exportDigest } });
    const next = { ...state, migrations, pinnedCommit: current.release.commit };
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n');
    fs.writeFileSync(path.join(runDir, 'foundation-lock.json'), JSON.stringify(current, null, 2) + '\n');
    return { ok: true, action: 'migrate', drift, baseline, migrations };
  }

  if (!baseline.ok) return {ok:false,action:'check',reason:'baseline-unresolvable',status:'STATE_SYNC_REQUIRED',baseline,drift,migration:migrationHint};
  if (native) return {ok:!drift,action:'check',reason:drift?'silent-rebaseline-blocked':'native-assets-resolvable',status:drift?'STATE_SYNC_REQUIRED':'ASSETS_ONLY',baseline,drift,runId:state.runId,detail:'read-only asset observation; no Run or role authority granted'};
  if (!drift) {
    if (!baseline.ok) {
      return { ok: false, action: 'check', reason: 'baseline-unresolvable', drift, baseline, migration: migrationHint };
    }
    return { ok: true, action: 'check', reason: 'baseline-current', drift, baseline, report: 'run baseline matches current sources and resolves from the frozen release commit' };
  }

  if (state.status === 'active') {
    return { ok: false, action: 'check', reason: 'silent-rebaseline-blocked', drift, baseline, migration: migrationHint };
  }
  return { ok: true, action: 'check', reason: 'drift-noted', drift, baseline, report: 'run is not active; asset drift recorded as informational (no silent re-baseline possible)' };
}

// TeamAI is a transport, not a second source or controller. Its native docs
// copier filters dotfiles; one top-level JSON packet carries every original byte.
const TEAMAI_PACKET = 'foundation-assets.json';
const PACKET_LIMIT = 96 * 1024 * 1024;
const ASSET_LIMIT = 64 * 1024 * 1024;
const FILE_LIMIT = 16 * 1024 * 1024;
const exactFields = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === fields.slice().sort().join('\0');
function assetPath(relative) {
  if (typeof relative !== 'string' || !relative || /^[A-Za-z]:/.test(relative) || /[\\\x00-\x1f]/.test(relative)
      || path.posix.isAbsolute(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('STATE_SYNC_REQUIRED: invalid asset path');
  }
  return relative;
}
function metadataFile(item, body = false) {
  const fields = ['path','bytes','sha256','mode', ...(body ? ['base64'] : [])];
  if (!exactFields(item, fields)) throw new Error('STATE_SYNC_REQUIRED: invalid asset fields');
  assetPath(item.path);
  if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > FILE_LIMIT
      || !/^[a-f0-9]{64}$/.test(item.sha256) || ![0o644,0o755].includes(item.mode)) {
    throw new Error('STATE_SYNC_REQUIRED: invalid asset metadata or mode');
  }
  return {path:item.path,bytes:item.bytes,sha256:item.sha256,mode:item.mode};
}
function metadataSet(items, body = false) {
  if (!Array.isArray(items) || !items.length || items.length > 4096) throw new Error('STATE_SYNC_REQUIRED: asset count limit');
  const seen = new Set(); let total = 0;
  return items.map(item => {
    const meta = metadataFile(item, body);
    if (seen.has(meta.path)) throw new Error('STATE_SYNC_REQUIRED: duplicate asset path');
    seen.add(meta.path); total += meta.bytes;
    if (total > ASSET_LIMIT) throw new Error('STATE_SYNC_REQUIRED: asset byte limit');
    return meta;
  });
}
function inputDigest(sourceCommit, exportDigest, files) {
  return sha256Bytes(canonicalJson({sourceCommit,exportDigest,files}));
}
function sourceIdentity(value) {
  if (value.format !== 1 || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !/^[a-f0-9]{64}$/.test(value.exportDigest)
      || !/^[a-f0-9]{64}$/.test(value.inputDigest)) throw new Error('STATE_SYNC_REQUIRED: invalid packet source');
}

export async function exportTeamaiView(foundationRoot, viewRoot, expectedFile, {repo} = {}) {
  if (!/^https:\/\/[^/?#@]+\/[^?#]+$/.test(repo ?? '')) throw new Error('registered TeamAI Git URL required');
  foundationRoot = path.resolve(foundationRoot); viewRoot = path.resolve(viewRoot); expectedFile = path.resolve(expectedFile);
  for (const parent of [foundationRoot,viewRoot]) {
    const relative = path.relative(parent,expectedFile);
    if (!relative || (!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative))) throw new Error('expected descriptor must remain outside supplier views');
  }
  if (viewRoot === foundationRoot || !path.relative(foundationRoot,viewRoot).startsWith('..'+path.sep)) throw new Error('TeamAI view must be separate from Foundation source');
  const lock = JSON.parse(readOutputFile(path.join(foundationRoot,'foundation-lock.json'),'utf8'));
  const sourceRoot = path.join(foundationRoot,'baselines',lock.release.exportDigest,'source');
  const verified = await verifyLock(path.join(foundationRoot,'foundation-lock.json'),sourceRoot,{requireBodies:true});
  if (!verified.ok) throw new Error('STATE_SYNC_REQUIRED: Foundation source is not verified');
  const files = walkFiles(foundationRoot,'',[],false).map(({rel,abs}) => {
    const bytes = readOutputFile(abs); const mode = fs.statSync(abs).mode & 0o777;
    return {path:rel,bytes:bytes.length,sha256:sha256Bytes(bytes),mode,base64:bytes.toString('base64')};
  }).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const metadata = metadataSet(files,true);
  const packet = {format:1,sourceCommit:lock.release.commit,exportDigest:lock.release.exportDigest,
    inputDigest:inputDigest(lock.release.commit,lock.release.exportDigest,metadata),files};
  const packetBytes = Buffer.from(JSON.stringify(packet)+'\n');
  if (packetBytes.length > PACKET_LIMIT) throw new Error('STATE_SYNC_REQUIRED: packet byte limit');
  const expected = {format:1,sourceCommit:packet.sourceCommit,exportDigest:packet.exportDigest,inputDigest:packet.inputDigest,
    packetSha256:sha256Bytes(packetBytes),files:metadata};
  const stage = '.teamai/distribution-staging';
  const config = {team:'foundation',repo,provider:'git',reviewers:[],autoUpdate:false,
    sharing:{docs:{localDir:'./'+stage+'/docs'},env:{injectShellProfile:false},recall:{enabled:false},coAuthor:{enabled:false},hooks:{autoApply:false},mcp:{autoApply:false}},
    toolPaths:{claude:{skills:stage+'/claude/skills',rules:stage+'/claude/rules',settings:stage+'/claude/settings.json',claudemd:stage+'/claude/CLAUDE.md',agents:stage+'/claude/agents',mcpProject:stage+'/claude/mcp.json'}}};
  const disabled = ['Hook dispatch session-start','Hook dispatch stop','Hook dispatch post-tool-use wildcard','Hook dispatch post-tool-use Skill','Hook dispatch post-tool-use TodoWrite','Hook dispatch prompt-submit'];
  const outputs = new Map([['teamai.yaml',Buffer.from(JSON.stringify(config,null,2)+'\n')],['hooks/hooks.yaml',Buffer.from(JSON.stringify({hooks:[],builtin:{disabled,overrides:{}}})+'\n')],['docs/'+TEAMAI_PACKET,packetBytes]]);
  for (const item of files) if (item.path.startsWith('release/skills/') && item.path !== 'release/skills/MANIFEST.json') {
    outputs.set('skills/'+item.path.slice('release/skills/'.length),Buffer.from(item.base64,'base64'));
  }
  const present = rejectLinkedPath(viewRoot);
  if (present) {
    if (!present.isDirectory()) throw new Error('STATE_SYNC_REQUIRED: unsafe TeamAI view');
    const actual = walkFiles(viewRoot,'',[],false);
    if (actual.length !== outputs.size || actual.some(({rel,abs}) => !outputs.has(rel) || !readOutputFile(abs).equals(outputs.get(rel)))) {
      throw new Error('STATE_SYNC_REQUIRED: existing supplier view preserved; publish into a fresh directory');
    }
  }
  const expectedBytes = Buffer.from(JSON.stringify(expected,null,2)+'\n');
  if (outputFile(expectedFile) && !readOutputFile(expectedFile).equals(expectedBytes)) throw new Error('STATE_SYNC_REQUIRED: existing expected descriptor preserved');
  for (const rel of outputs.keys()) outputFile(path.join(viewRoot,assetPath(rel)));
  for (const [rel,bytes] of outputs) writeIfChanged(path.join(viewRoot,rel),bytes);
  writeIfChanged(expectedFile,expectedBytes);
  return {expectedSha256:sha256Bytes(expectedBytes),packetSha256:expected.packetSha256,inputDigest:expected.inputDigest,files:files.length};
}

export async function receiveTeamaiPacket(packetFile, expectedFile, expectedSha256, stageRoot) {
  // The descriptor and its exact byte hash come from the external controller's
  // frozen source, never from the supplier packet or its embedded lock.
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw new Error('external expected descriptor hash required');
  const expectedInfo = outputFile(expectedFile);
  if (!expectedInfo || expectedInfo.size > PACKET_LIMIT) throw new Error('STATE_SYNC_REQUIRED: external expected descriptor byte limit');
  const expectedBytes = readOutputFile(expectedFile);
  if (expectedBytes.length > PACKET_LIMIT || sha256Bytes(expectedBytes) !== expectedSha256) throw new Error('STATE_SYNC_REQUIRED: external expected descriptor mismatch');
  const expected = JSON.parse(expectedBytes);
  if (!exactFields(expected,['format','sourceCommit','exportDigest','inputDigest','packetSha256','files'])) throw new Error('STATE_SYNC_REQUIRED: invalid expected fields');
  sourceIdentity(expected); const wanted = metadataSet(expected.files);
  if (!/^[a-f0-9]{64}$/.test(expected.packetSha256) || inputDigest(expected.sourceCommit,expected.exportDigest,wanted) !== expected.inputDigest) throw new Error('STATE_SYNC_REQUIRED: inconsistent external source');
  const info = outputFile(packetFile);
  if (!info || info.size > PACKET_LIMIT) throw new Error('STATE_SYNC_REQUIRED: packet byte limit or missing packet');
  const bytes = readOutputFile(packetFile);
  // Exact external binding also rejects ambiguous/duplicate JSON object keys.
  if (sha256Bytes(bytes) !== expected.packetSha256) throw new Error('STATE_SYNC_REQUIRED: supplier packet differs from frozen source');
  const packet = JSON.parse(bytes);
  if (!exactFields(packet,['format','sourceCommit','exportDigest','inputDigest','files'])) throw new Error('STATE_SYNC_REQUIRED: invalid packet fields');
  sourceIdentity(packet); const metadata = metadataSet(packet.files,true);
  if (packet.sourceCommit !== expected.sourceCommit || packet.exportDigest !== expected.exportDigest || packet.inputDigest !== expected.inputDigest
      || canonicalJson(metadata) !== canonicalJson(wanted)) throw new Error('STATE_SYNC_REQUIRED: incomplete or stale supplier source');
  const decoded = packet.files.map(item => {
    if (typeof item.base64 !== 'string' || item.base64.length > Math.ceil(FILE_LIMIT/3)*4) throw new Error('STATE_SYNC_REQUIRED: invalid base64 size');
    const body = Buffer.from(item.base64,'base64');
    if (body.toString('base64') !== item.base64 || body.length !== item.bytes || sha256Bytes(body) !== item.sha256) throw new Error('STATE_SYNC_REQUIRED: invalid base64 or file digest');
    return {path:item.path,body,mode:item.mode};
  });
  // Validate every byte/path before creating a new private stage; never merge
  // into a user tree or replace a link. Stage has no authority until verifyLock.
  stageRoot = path.resolve(stageRoot); const present = rejectLinkedPath(stageRoot);
  if (present) throw new Error('STATE_SYNC_REQUIRED: receiver requires a fresh private stage');
  for (const item of decoded) outputFile(path.join(stageRoot,item.path));
  fs.mkdirSync(stageRoot,{recursive:true,mode:0o700});
  for (const item of decoded) { const dest = path.join(stageRoot,item.path);writeIfChanged(dest,item.body);fs.chmodSync(dest,item.mode); }
  const sourceRoot = path.join(stageRoot,'baselines',expected.exportDigest,'source');
  const verified = await verifyLock(path.join(stageRoot,'foundation-lock.json'),sourceRoot,{requireBodies:true});
  if (!verified.ok) throw new Error('STATE_SYNC_REQUIRED: decoded FoundationLock verification failed');
  return {foundationRoot:stageRoot,sourceRoot,inputDigest:expected.inputDigest,files:decoded.length,scope:'verified asset bytes only; runtime/profile qualification unchanged'};
}

// ---- CLI ----

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'export') {
    const root = path.resolve(argValue(rest, '--root') ?? process.cwd());
    const out = path.resolve(argValue(rest, '--out') ?? path.join(root, 'foundation'));
    const teamaiView = argValue(rest, '--teamai-view');
    const teamaiExpected = argValue(rest, '--teamai-expected');
    const teamaiRepo = argValue(rest, '--teamai-repo');
    if (rest.some(flag => ['--teamai-view','--teamai-expected','--teamai-repo'].includes(flag)) && ![teamaiView,teamaiExpected,teamaiRepo].every(Boolean)) throw new Error('TeamAI export requires view, external expected file and Git URL');
    const { lock, files } = await exportRelease(root, out, {
      releaseCommit: argValue(rest, '--release-commit'),
      profile: argValue(rest, '--profile'),
      skillsCopy: rest.includes('--skills-copy'),
      freezeBaseline: rest.includes('--freeze-baseline') || !!teamaiView,
    });
    if (teamaiView) await exportTeamaiView(out,path.resolve(teamaiView),path.resolve(teamaiExpected),{repo:teamaiRepo});
    process.stdout.write(`✅ foundation export: ${files.length} files under ${out} (release commit ${lock.release.commit.slice(0, 8)}, exportDigest ${lock.release.exportDigest.slice(0, 12)})\n`);
    return 0;
  }
  if (cmd === 'verify') {
    const packet = argValue(rest,'--teamai-packet');
    if (packet) {
      const expected = argValue(rest,'--teamai-expected'), expectedSha = argValue(rest,'--teamai-expected-sha256'), stage = argValue(rest,'--teamai-stage');
      if (![expected,expectedSha,stage].every(Boolean)) throw new Error('TeamAI receive requires external expected file/hash and private stage');
      const result = await receiveTeamaiPacket(path.resolve(packet),path.resolve(expected),expectedSha,path.resolve(stage));
      process.stdout.write(`✅ foundation TeamAI receive: ${result.files} verified assets; runtime qualification unchanged\n`);
      return 0;
    }
    const root = path.resolve(argValue(rest, '--root') ?? process.cwd());
    const lockPath = path.resolve(argValue(rest, '--lock') ?? path.join(root, 'foundation/foundation-lock.json'));
    const verdict = await verifyLock(lockPath, root, {requireBodies: rest.includes('--require-bodies')});
    if (!verdict.ok) {
      process.stderr.write(`❌ foundation verify failed: ${verdict.error ?? 'drift detected'}\n`);
      for (const d of verdict.drifts ?? []) process.stderr.write(`  - [${d.kind}] ${d.item}: ${d.detail}${d.expected ? ` (expected ${String(d.expected).slice(0, 12)}, actual ${String(d.actual).slice(0, 12)})` : ''}\n`);
      return 1;
    }
    process.stdout.write('✅ foundation verify: lock, sources and release view are consistent\n');
    return 0;
  }
  if (cmd === 'check-run') {
    const runDir = path.resolve(argValue(rest, '--run-dir') ?? '');
    const root = path.resolve(argValue(rest, '--root') ?? process.cwd());
    const verdict = await checkRun(runDir, root, {
      acquire: rest.includes('--acquire'),
      migrate: rest.includes('--migrate'),
      owner: argValue(rest, '--owner'),
    });
    if (!verdict.ok) {
      process.stderr.write(`❌ check-run ${verdict.action ?? ''}: ${verdict.reason}\n`);
      if (verdict.detail) process.stderr.write(`  ${verdict.detail}\n`);
      if (verdict.migration) process.stderr.write(`  migration: ${verdict.migration}\n`);
      if (verdict.baseline && !verdict.baseline.ok) process.stderr.write(`  baseline: ${verdict.baseline.reason}\n`);
      return 1;
    }
    process.stdout.write(`✅ check-run ${verdict.action}: ${verdict.reason ?? 'ok'}${verdict.report ? ` — ${verdict.report}` : ''}\n`);
    return 0;
  }
  process.stderr.write('usage: foundation-export.mjs export|verify|check-run ...\n');
  return 2;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`❌ ${err.message}\n`);
      process.exit(1);
    },
  );
}
