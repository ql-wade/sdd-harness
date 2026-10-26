// Spec Adapter (P3_4): pure OpenSpec inspection plus one thin Comet write seam.
// createManagedSpecAdapter binds the trusted bootstrap's original aggregate
// (Comet 0.5.0 face: upstream aeb1a659 + the 0005 Kt closeout patch, build
// de39629a…); only Native owns gates, locks, transactions, archive preview and
// recovery. The openspec CLI — pinned 1.11.0 through the same COMET_OPENSPEC
// seam Native reads (classic-openspec-command.ts: process.env.COMET_OPENSPEC
// || 'openspec') — is the ONLY archive writer; Native's `comet archive` is the
// single command that invokes it, and no adapter path performs a second sync
// or archive. The old filesystem writer below is component-only compatibility
// for projects with no Comet ownership metadata. Every mutating legacy helper
// rejects a Comet-owned project, including malformed/partial control documents.
// Neither an injected function nor a caller's Kp {id,digest} proves identity,
// method execution, source qualification, a managed gate or overall completion.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI_TIMEOUT_MS = 120_000;
const LOCK_FILE = '.spec-closeout.lock';
const STATE_FILE = '.spec-closeout-state.json';
const SHA256_RE = /^[a-f0-9]{64}$/;
// The pinned openspec CLI is resolved exactly where Native resolves it
// (classic-openspec-command.ts): one seam, one pinned writer binary.
const resolveOpenspecCli = (openspecCli) =>
  openspecCli !== undefined ? openspecCli : process.env.COMET_OPENSPEC || 'openspec';
// Comet 0.5.0 change-state file names (classic-state-file.ts) and the two
// Classic artifact layouts (classic-layout.ts), mirrored read-only.
const CLASSIC_STATE_FILE_NAMES = Object.freeze(['comet-state.yaml', '.comet.yaml']);
const OPENSPEC_LAYOUT_DIRS = Object.freeze(['openspec', path.join('docs', 'openspec')]);
const CLASSIC_PHASES = Object.freeze(['open', 'design', 'build', 'verify', 'archive']);
// The adapter's own bookkeeping travels inside the change directory; it is
// never part of the drift scope (only specs and change content are).
const ADAPTER_STATE_FILES = new Set([LOCK_FILE, STATE_FILE]);

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Deterministic JSON (same discipline as lib/delivery/evidence.js): sorted
// object keys, arrays in order, so digests are stable across processes.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonicalize(value));

export class CodedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpecCloseoutError';
    this.code = code;
  }
}

const coded = (code, message) => {
  throw new CodedError(code, message);
};

// One project-bound reader for every adapter projection and preview. Native
// validation happens later and cannot undo an out-of-project read here.
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
function projectRootPath(root) {
  try {
    if (typeof root !== 'string' || !root || fs.lstatSync(root).isSymbolicLink()) throw new Error();
    const resolved = fs.realpathSync(root);
    if (!fs.statSync(resolved).isDirectory()) throw new Error();
    return resolved;
  } catch { coded('PROJECT_PATH_UNSAFE', 'A real project directory is required'); }
}
function projectEntry(projectRoot, target, { kind = 'any', optional = false } = {}) {
  const root = projectRootPath(projectRoot);
  if (typeof target !== 'string' || target.includes('\0')) coded('PROJECT_PATH_UNSAFE', 'Project path is invalid');
  const absolute = path.resolve(target);
  const relative = path.relative(inside(root,absolute) ? root : path.resolve(projectRoot), absolute);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep))
    coded('PROJECT_PATH_UNSAFE', 'Project path escapes its fixed root');
  let current = root;
  try {
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !inside(root, fs.realpathSync(current)))
        coded('PROJECT_PATH_UNSAFE', 'Project paths must not contain symbolic links');
    }
    const stat = fs.lstatSync(current);
    if ((!stat.isFile() && !stat.isDirectory()) || (kind === 'file' && !stat.isFile()) ||
      (kind === 'directory' && !stat.isDirectory()))
      coded('PROJECT_PATH_UNSAFE', 'Project path has an unsupported file type');
    return { file: current, stat };
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    if (error instanceof CodedError) throw error;
    coded('PROJECT_PATH_UNSAFE', 'Project path cannot be safely accessed');
  }
}
function readProjectBytes(root, target, optional = false) {
  const entry = projectEntry(root, target, {kind:'file',optional});
  if (!entry) return null;
  let fd;
  try {
    fd = fs.openSync(entry.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const current = projectEntry(root, target, {kind:'file'});
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== current.stat.dev || opened.ino !== current.stat.ino)
      coded('PROJECT_PATH_UNSAFE', 'Project file changed before its read');
    return fs.readFileSync(fd);
  } catch (error) {
    if (error instanceof CodedError) throw error;
    coded('PROJECT_PATH_UNSAFE', 'Project file cannot be safely read');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
const readProjectText = (root, file, optional = false) => readProjectBytes(root, file, optional)?.toString('utf8') ?? null;
function pathComponent(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\0]/u.test(value))
    coded('PROJECT_PATH_UNSAFE', 'A single project path component is required');
  return value;
}
function relativeSpecPath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /^[A-Za-z]:/u.test(value) ||
    value.split(/[\\/]/u).some((part) => !part || part === '.' || part === '..') || value.includes('\0'))
    coded('PROJECT_PATH_UNSAFE', 'Spec paths must stay relative to the main specs directory');
  return value;
}
function readDeltaCapabilities(projectRoot, directory) {
  const entry = projectEntry(projectRoot, directory, {kind:'directory',optional:true});
  const capabilities = Object.create(null);
  if (!entry) return capabilities;
  for (const item of fs.readdirSync(entry.file, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const child = projectEntry(projectRoot, path.join(directory,item.name));
    if (!child.stat.isDirectory()) continue;
    const text = readProjectText(projectRoot,path.join(child.file,'spec.md'),true);
    if (text !== null) capabilities[pathComponent(item.name)] = parseDeltaSpec(text);
  }
  return capabilities;
}

// --- openspec CLI (the only archive writer underneath this adapter) -----------

function runCli({ openspecCli, args, cwd, timeoutMs = CLI_TIMEOUT_MS }) {
  // Isolated HOME per call: the CLI never reads or writes user-level config,
  // telemetry is off, and neither the real profile nor the project is touched
  // by CLI-internal caches.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-adapter-home-'));
  try {
    return spawnSync(openspecCli, args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        CI: 'true',
        DO_NOT_TRACK: '1',
        OPENSPEC_TELEMETRY: '0',
      },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function cliVersion(openspecCli, cwd, timeoutMs) {
  const result = runCli({ openspecCli, args: ['--version'], cwd, timeoutMs });
  return result.status === 0 ? String(result.stdout ?? '').trim() : null;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateChange({ projectRoot, change, openspecCli, timeoutMs }) {
  const result = runCli({ openspecCli, args: ['validate', change, '--type', 'change', '--strict', '--json'], cwd: projectRoot, timeoutMs });
  const parsed = safeJson(result.stdout ?? '');
  const item = parsed?.items?.[0] ?? null;
  return {
    ok: result.status === 0 && item?.valid === true,
    issues: item?.issues ?? [],
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

// --- markdown parsing (spec deltas and main specs) ----------------------------

const REQUIREMENT_RE = /^### Requirement: (.+?)\s*$/;
const SCENARIO_RE = /^#### Scenario: (.+?)\s*$/;
const DELTA_SECTIONS = ['ADDED Requirements', 'MODIFIED Requirements', 'REMOVED Requirements'];

function requirementBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of String(text ?? '').split('\n')) {
    const requirement = line.match(REQUIREMENT_RE);
    if (requirement) {
      current = { name: requirement[1], descriptionLines: [], scenarios: [] };
      blocks.push(current);
      continue;
    }
    const scenario = line.match(SCENARIO_RE);
    if (scenario && current) {
      current.scenarios.push(scenario[1]);
      continue;
    }
    if (current && current.scenarios.length === 0) current.descriptionLines.push(line);
  }
  return blocks.map((block) => ({
    name: block.name,
    description: block.descriptionLines.join('\n').trim(),
    scenarios: block.scenarios,
  }));
}

// Delta file sections: { added: [req], modified: [req], removed: [names] }.
function parseDeltaSpec(text) {
  const delta = { added: [], modified: [], removed: [] };
  let section = null;
  let buffer = [];
  const flush = () => {
    if (!section || buffer.length === 0) {
      buffer = [];
      return;
    }
    const blocks = requirementBlocks(buffer.join('\n'));
    if (section === 'ADDED Requirements') delta.added.push(...blocks);
    else if (section === 'MODIFIED Requirements') delta.modified.push(...blocks);
    else if (section === 'REMOVED Requirements') delta.removed.push(...blocks.map((block) => block.name));
    buffer = [];
  };
  for (const line of String(text ?? '').split('\n')) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading && DELTA_SECTIONS.includes(heading[1])) {
      flush();
      section = heading[1];
      continue;
    }
    if (heading && section) {
      flush();
      section = null;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return delta;
}

// Main spec: requirements by name.
function parseMainSpec(text) {
  const requirements = Object.create(null);
  for (const block of requirementBlocks(text)) {
    requirements[block.name] = block;
  }
  return { requirements };
}

// --- summary (the "target summary" the whole closeout is gated on) ------------

function listFiles(projectRoot, directory) {
  const out = [];
  const walk = (dir) => {
    const entry = projectEntry(projectRoot, dir, {kind:'directory',optional:true});
    if (!entry) return;
    for (const item of fs.readdirSync(entry.file,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const child = projectEntry(projectRoot,path.join(dir,item.name));
      if (child.stat.isDirectory()) walk(child.file);
      else out.push(child.file);
    }
  };
  walk(directory);
  return out;
}

// Digest over the whole main-specs tree + the change directory: any edit by
// another Change on either side flips it (the drift signal for B08/A11).
// `openspecDir` selects the Classic artifact layout root ('openspec' for
// legacy, 'docs/openspec' for docs) and defaults to the component layout.
function closeoutScopeDigest({ projectRoot, change, openspecDir = 'openspec' }) {
  const specsFiles = listFiles(projectRoot, path.join(projectRoot, openspecDir, 'specs')).map((abs) => ['specs', abs]);
  const changeDir = path.join(projectRoot, openspecDir, 'changes', change);
  const changeFiles = listFiles(projectRoot, changeDir)
    .filter((abs) => !ADAPTER_STATE_FILES.has(path.basename(abs)))
    .map((abs) => ['change', abs]);
  const lines = [...specsFiles, ...changeFiles]
    .map(([scope, abs]) => `${scope}:${path.relative(projectRootPath(projectRoot), abs)}:${sha256(readProjectBytes(projectRoot, abs))}`)
    .sort();
  return sha256(lines.join('\n'));
}

// The target summary: what the archive will do to which capabilities, bound to
// the exact current state of the main specs and the change files.
export function computeTargetSummary({ projectRoot, change, openspecDir = 'openspec' }) {
  pathComponent(change);
  const deltaDir = path.join(projectRoot, openspecDir, 'changes', change, 'specs');
  if (!projectEntry(projectRoot,deltaDir,{kind:'directory',optional:true}))
    coded('CHANGE_MISSING', 'The change spec directory is unavailable');
  const capabilities = readDeltaCapabilities(projectRoot,deltaDir);
  return {
    summary: { change, capabilities },
    digest: sha256(canonicalJson({ change, capabilities, scope: closeoutScopeDigest({ projectRoot, change, openspecDir }) })),
  };
}

// --- scenario preservation (MODIFIED keeps every existing scenario) -----------

export function verifyScenarioPreservation({ projectRoot, change, openspecDir = 'openspec' }) {
  const { summary } = computeTargetSummary({ projectRoot, change, openspecDir });
  const violations = [];
  for (const [capability, delta] of Object.entries(summary.capabilities)) {
    const mainPath = path.join(projectRoot, openspecDir, 'specs', capability, 'spec.md');
    const mainText = readProjectText(projectRoot,mainPath,true);
    const main = mainText !== null ? parseMainSpec(mainText) : {requirements:{}};
    for (const requirement of delta.modified) {
      const existing = main.requirements[requirement.name];
      if (!existing) {
        violations.push({ type: 'MODIFIED_TARGET_MISSING', capability, requirement: requirement.name });
        continue;
      }
      const missing = existing.scenarios.filter((scenario) => !requirement.scenarios.includes(scenario));
      if (missing.length > 0) {
        violations.push({ type: 'SCENARIO_DROPPED', capability, requirement: requirement.name, missing });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// --- sole-writer lock ----------------------------------------------------------

const lockPathIn = (projectRoot, change) => path.join(projectRoot, 'openspec/changes', change, LOCK_FILE);

function holderIsAlive(holder) {
  const value = holder?.pid;
  const pid = typeof value === 'number' ? value : typeof value === 'string' && /^[0-9]+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(pid) || pid <= 0) return false; // legacy/corrupt holder: reclaimable
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM'; // exists but owned by someone else
  }
}

export function acquireArchiveLock({ projectRoot, change, writerId }) {
  requireComponentProject(projectRoot, change);
  if (!writerId || typeof writerId !== 'string') coded('CLOSEOUT_EXECUTION_REQUIRED', 'acquireArchiveLock requires a non-empty writerId');
  const lockPath = lockPathIn(projectRoot, change);
  projectEntry(projectRoot,path.dirname(lockPath),{kind:'directory',optional:true});
  projectEntry(projectRoot,lockPath,{kind:'file',optional:true});
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = `${JSON.stringify({ writerId, pid: process.pid, change, acquiredAt: new Date().toISOString() })}\n`;
  try {
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      coded('ARCHIVE_WRITER_EXISTS', `change ${change} already has an archive writer (${lockPath}); the spec archive is single-owner`);
    }
    throw error;
  }
  return { ok: true, lockPath, writerId };
}

// Release wherever the lock ended up (the CLI moves the whole change
// directory — lock included — into changes/archive/<date>-<change>/).
export function releaseArchiveLock({ projectRoot, change }) {
  requireComponentProject(projectRoot, change);
  const candidates = [lockPathIn(projectRoot, change)];
  for (const dir of archiveDirsFor(projectRoot, change)) {
    candidates.push(path.join(projectRoot, 'openspec/changes/archive', dir, LOCK_FILE));
  }
  let released = false;
  for (const candidate of candidates) {
    if (projectEntry(projectRoot,candidate,{kind:'file',optional:true})) {
      fs.rmSync(candidate, { force: true });
      released = true;
    }
  }
  return { ok: true, released };
}

function archiveDirsFor(projectRoot, change) {
  pathComponent(change);
  const archive = path.join(projectRoot, 'openspec/changes/archive');
  const entry = projectEntry(projectRoot, archive, {kind:'directory',optional:true});
  if (!entry) return [];
  const suffix = `-${change}`;
  return fs.readdirSync(entry.file).filter((name) => {
    const child = projectEntry(projectRoot,path.join(archive,name));
    return name.endsWith(suffix) && child.stat.isDirectory();
  }).sort();
}

// --- closeout state journal (travels with the change directory) ----------------

const statePathIn = (dir) => path.join(dir, STATE_FILE);

function writeCloseoutState(projectRoot, dir, state) {
  projectEntry(projectRoot,dir,{kind:'directory'});
  const file = statePathIn(dir);
  projectEntry(projectRoot,file,{kind:'file',optional:true});
  const tmp = `${file}.tmp-${process.pid}`;
  projectEntry(projectRoot,tmp,{kind:'file',optional:true});
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

function readCloseoutState(projectRoot, dir) {
  try {
    return JSON.parse(readProjectText(projectRoot,statePathIn(dir),true));
  } catch (error) {
    if (error instanceof CodedError) throw error;
    return null;
  }
}

// --- rehearsal (dry-run against a full clone in $TMPDIR) -----------------------

function digestSpecTree(projectRoot, specsDir) {
  const expected = {};
  for (const abs of listFiles(projectRoot, specsDir)) {
    expected[path.relative(projectRootPath(specsDir), abs)] = sha256(readProjectBytes(projectRoot, abs));
  }
  return expected;
}

export function rehearseArchive({ projectRoot, change, openspecCli, timeoutMs = CLI_TIMEOUT_MS, cleanup = true }) {
  openspecCli = resolveOpenspecCli(openspecCli);
  requireComponentProject(projectRoot, change);
  // The summary is computed against the REAL project (that is what will be
  // archived), then the clone proves the archive is applicable at all. A
  // change that cannot be summarized at all (missing deltas — e.g. it is
  // already archived) is a rehearsal RESULT, never a pass.
  let computed;
  try {
    computed = computeTargetSummary({ projectRoot, change });
  } catch (error) {
    return { ok: false, stage: 'summary', error: error?.code ?? 'SUMMARY_FAILED', cliVersion: null };
  }
  const { summary, digest } = computed;
  const cli = cliVersion(openspecCli, projectRoot, timeoutMs);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-rehearsal-'));
  try {
    listFiles(projectRoot, path.join(projectRoot, 'openspec')); // check every copied source, not just selected deltas
    fs.cpSync(path.join(projectRoot, 'openspec'), path.join(tempRoot, 'openspec'), { recursive: true });
    const validation = validateChange({ projectRoot: tempRoot, change, openspecCli, timeoutMs });
    if (!validation.ok) {
      return { ok: false, stage: 'validate', error: 'SPEC_VALIDATION_FAILED', issues: validation.issues, archiveOutput: validation.output, cliVersion: cli, summary, summaryDigest: digest };
    }
    const archive = runCli({ openspecCli, args: ['archive', change, '-y'], cwd: tempRoot, timeoutMs });
    const output = `${archive.stdout ?? ''}${archive.stderr ?? ''}`;
    // Exit 0 is not proof: the CLI aborts invalid rebuilds with exit 0 and
    // "Aborted. No files were changed." — verify the clone on disk.
    const cloneArchiveDirs = archiveDirsFor(tempRoot, change);
    const applied = archive.status === 0
      && cloneArchiveDirs.length === 1
      && !fs.existsSync(path.join(tempRoot, 'openspec/changes', change));
    if (!applied) {
      return {
        ok: false,
        stage: 'archive',
        error: archive.status !== 0 ? 'ARCHIVE_CLI_FAILED' : 'ARCHIVE_NOT_APPLIED',
        archiveOutput: output,
        cliVersion: cli,
        summary,
        summaryDigest: digest,
      };
    }
    // Byte-level preview of the post-archive main specs, produced by the real
    // CLI on the clone — the readback expectation for the real archive.
    return {
      ok: true,
      change,
      cliVersion: cli,
      summary,
      summaryDigest: digest,
      expectedMainSpecs: digestSpecTree(tempRoot, path.join(tempRoot, 'openspec/specs')),
      archiveOutput: output,
    };
  } finally {
    if (cleanup) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

// --- main specs readback --------------------------------------------------------

const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

function requirementPresent(mainText, requirement) {
  const main = parseMainSpec(mainText);
  const block = main.requirements[requirement.name];
  if (!block) return { ok: false, mismatch: { type: 'REQUIREMENT_MISSING', requirement: requirement.name } };
  for (const scenario of requirement.scenarios) {
    if (!block.scenarios.includes(scenario)) {
      return { ok: false, mismatch: { type: 'SCENARIO_MISSING', requirement: requirement.name, scenario } };
    }
  }
  if (normalize(block.description) !== normalize(requirement.description)) {
    return { ok: false, mismatch: { type: 'DESCRIPTION_MISMATCH', requirement: requirement.name, expected: normalize(requirement.description), actual: normalize(block.description) } };
  }
  return { ok: true };
}

// `specsDir` selects the Classic artifact layout's main specs directory; it
// defaults to the component layout (<root>/openspec/specs).
export function readBackMainSpecs({ projectRoot, summary, expectedMainSpecs, specsDir }) {
  const mainSpecsDir = specsDir !== undefined ? specsDir : path.join(projectRoot, 'openspec/specs');
  if (!isRecord(summary) || !isRecord(summary.capabilities) ||
    (expectedMainSpecs !== undefined && !isRecord(expectedMainSpecs)))
    coded('SUMMARY_INVALID', 'A structured spec summary is required');
  for (const [capability,delta] of Object.entries(summary.capabilities)) {
    pathComponent(capability);
    if (!isRecord(delta) || !['added','modified','removed'].every((key)=>Array.isArray(delta[key])) ||
      delta.removed.some((name)=>typeof name !== 'string') ||
      [...delta.added,...delta.modified].some((requirement)=>!isRecord(requirement) ||
        typeof requirement.name !== 'string' || typeof requirement.description !== 'string' ||
        !Array.isArray(requirement.scenarios) || requirement.scenarios.some((name)=>typeof name !== 'string')))
      coded('SUMMARY_INVALID', 'Spec summary entries are invalid');
  }
  for (const [relative,digest] of Object.entries(expectedMainSpecs ?? {})) {
    relativeSpecPath(relative);
    if (typeof digest !== 'string' || !SHA256_RE.test(digest)) coded('SUMMARY_INVALID', 'Expected spec digest is invalid');
  }
  const mismatches = [];
  let checked = 0;
  for (const [capability, delta] of Object.entries(summary?.capabilities ?? {})) {
    const mainPath = path.join(mainSpecsDir, capability, 'spec.md');
    const mainText = readProjectText(projectRoot,mainPath,true);
    for (const requirement of delta.added) {
      checked += 1;
      if (mainText === null) mismatches.push({ type: 'SPEC_FILE_MISSING', capability });
      else {
        const present = requirementPresent(mainText, requirement);
        if (!present.ok) mismatches.push({ capability, ...present.mismatch });
      }
    }
    for (const requirement of delta.modified) {
      checked += 1;
      if (mainText === null) mismatches.push({ type: 'SPEC_FILE_MISSING', capability });
      else {
        const present = requirementPresent(mainText, requirement);
        if (!present.ok) mismatches.push({ capability, ...present.mismatch });
      }
    }
    for (const name of delta.removed) {
      checked += 1;
      if (mainText !== null && parseMainSpec(mainText).requirements[name]) {
        mismatches.push({ capability, type: 'REQUIREMENT_STILL_PRESENT', requirement: name });
      }
    }
  }
  // Byte-level identity against the rehearsal preview: the real archive must
  // leave the main specs exactly as the rehearsed clone did.
  for (const [rel, expectedDigest] of Object.entries(expectedMainSpecs ?? {})) {
    checked += 1;
    const abs = path.join(mainSpecsDir, rel);
    const bytes = readProjectBytes(projectRoot,abs,true);
    if (bytes === null) {
      mismatches.push({ type: 'EXPECTED_SPEC_MISSING', path: rel });
      continue;
    }
    const observed = sha256(bytes);
    if (observed !== expectedDigest) {
      mismatches.push({ type: 'SPEC_BYTES_DRIFT', path: rel, expected: expectedDigest, observed });
    }
  }
  return { ok: mismatches.length === 0, checked, mismatches };
}

// --- closeout (the one archive execution) ---------------------------------------

function requireKnowledgeCloseout(knowledgeCloseout) {
  // Knowledge.Closeout.v1: the Kp obligation is a precondition of the archive
  // seal, not a follow-up.
  if (!knowledgeCloseout
    || typeof knowledgeCloseout.id !== 'string'
    || knowledgeCloseout.id.length === 0
    || typeof knowledgeCloseout.digest !== 'string'
    || !SHA256_RE.test(knowledgeCloseout.digest)) {
    coded('KNOWLEDGE_CLOSEOUT_REQUIRED', 'Knowledge.Closeout.v1: a recorded Kp knowledge obligation ({ id, digest: sha256 }) is required before the archive');
  }
}

// A Comet-owned project must use its original Runtime even when its control
// document is malformed or partially moved. Do not infer an unmanaged escape
// from a caller flag, an unreadable YAML field, or a missing gate receipt.
function requireComponentProject(projectRoot, change) {
  pathComponent(change);
  projectEntry(projectRoot,path.join(projectRoot,'openspec/changes',change),{kind:'directory',optional:true});
  const locations = [path.join(projectRoot, '.comet/config.yaml'),
    path.join(projectRoot, 'openspec/changes', change, '.comet.yaml'),
    path.join(projectRoot, 'openspec/changes', change, '.comet')];
  for (const name of archiveDirsFor(projectRoot, change)) {
    locations.push(path.join(projectRoot, 'openspec/changes/archive', name, '.comet.yaml'),
      path.join(projectRoot, 'openspec/changes/archive', name, '.comet'));
  }
  if (locations.some((file) => projectEntry(projectRoot,file,{optional:true}))) {
    coded('MANAGED_RUNTIME_REQUIRED', 'Comet-owned closeout requires its fixed original Runtime; component knowledge claims cannot authorize archive or recovery');
  }
}

export function closeoutSpecs({ projectRoot, change, openspecCli, rehearsal, knowledgeCloseout, execution, timeoutMs = CLI_TIMEOUT_MS }) {
  openspecCli = resolveOpenspecCli(openspecCli);
  requireComponentProject(projectRoot, change);
  if (!execution || typeof execution !== 'string') {
    coded('CLOSEOUT_EXECUTION_REQUIRED', 'closeoutSpecs requires the closing execution identity');
  }
  requireKnowledgeCloseout(knowledgeCloseout);
  if (!rehearsal?.ok || !rehearsal.summaryDigest) {
    coded('REHEARSAL_NOT_OK', 'closeoutSpecs requires a successful rehearseArchive result for the same change (dry-run first, archive second)');
  }

  const changeDir = path.join(projectRoot, 'openspec/changes', change);
  if (!fs.existsSync(changeDir)) {
    if (archiveDirsFor(projectRoot, change).length > 0) {
      coded('ARCHIVE_ALREADY_SEALED', `change ${change} is already archived; the spec archive is single-owner and a second closeout execution (${execution}) is refused`);
    }
    coded('CHANGE_MISSING', `change directory ${changeDir} does not exist`);
  }

  // Sole writer: from here on this execution owns the closeout.
  acquireArchiveLock({ projectRoot, change, writerId: execution });
  let archivedDir = null;
  try {
    // Layer 2: full scenario preservation over the CURRENT main specs.
    const preservation = verifyScenarioPreservation({ projectRoot, change });
    if (!preservation.ok) {
      coded('SCENARIO_PRESERVATION_VIOLATION', `MODIFIED requirements must keep every existing scenario: ${JSON.stringify(preservation.violations)}`);
    }
    // Layer 1: native structural validation through the real CLI.
    const validation = validateChange({ projectRoot, change, openspecCli, timeoutMs });
    if (!validation.ok) {
      coded('SPEC_VALIDATION_FAILED', `openspec validate --strict refused the change: ${JSON.stringify(validation.issues)} ${validation.output.slice(0, 400)}`);
    }
    // Drift gate: rehearsal vs now, on both sides (delta files AND main specs).
    const current = computeTargetSummary({ projectRoot, change });
    if (current.digest !== rehearsal.summaryDigest) {
      coded('SPEC_DRIFT', `specs or change drifted between rehearsal and closeout (B08): rehearsed ${rehearsal.summaryDigest}, current ${current.digest}; re-rehearse before archiving`);
    }

    const baseState = {
      change,
      execution,
      summaryDigest: rehearsal.summaryDigest,
      knowledgeCloseout: { ...knowledgeCloseout },
      startedAt: new Date().toISOString(),
    };
    writeCloseoutState(projectRoot, changeDir, { ...baseState, stage: 'archiving', archived: false });

    // The archive call — the only archive write in this module. It contains
    // the sync (specs update + change move), so nothing here re-syncs.
    const archive = runCli({ openspecCli, args: ['archive', change, '-y'], cwd: projectRoot, timeoutMs });
    const output = `${archive.stdout ?? ''}${archive.stderr ?? ''}`;
    // Exit 0 is not proof (the CLI aborts invalid rebuilds with exit 0):
    // verify the authoritative state on disk.
    if (archive.status !== 0) {
      if (fs.existsSync(changeDir)) writeCloseoutState(projectRoot, changeDir, { ...baseState, stage: 'archive-failed', archived: false, archiveOutput: output.slice(0, 4000) });
      coded('ARCHIVE_CLI_FAILED', `openspec archive failed (exit ${archive.status}): ${output.slice(0, 400)}`);
    }
    // Authoritative-state verification over journal text: exit 0 with an
    // already-consumed change and exactly one archive is the only accepted
    // outcome. Any other shape (silent abort, ambiguous same-name archives)
    // refuses — the journal is written only where its directory still exists.
    const dirs = archiveDirsFor(projectRoot, change);
    const changeConsumed = !fs.existsSync(changeDir);
    if (!changeConsumed || dirs.length !== 1) {
      if (fs.existsSync(changeDir)) writeCloseoutState(projectRoot, changeDir, { ...baseState, stage: 'archive-not-applied', archived: false, archiveOutput: output.slice(0, 4000) });
      coded('ARCHIVE_NOT_APPLIED', `openspec archive reported success but the authoritative state is not one consumed change and one archive (changeConsumed=${changeConsumed}, archives=${dirs.length}): ${output.slice(0, 400)}`);
    }
    archivedDir = path.join(projectRoot, 'openspec/changes/archive', dirs[0]);
    writeCloseoutState(projectRoot, archivedDir, { ...baseState, stage: 'archived', archived: true, archiveName: dirs[0], archiveOutput: output.slice(0, 4000) });

    // External readback: main specs must match the rehearsed expectation.
    const readback = readBackMainSpecs({ projectRoot, summary: rehearsal.summary, expectedMainSpecs: rehearsal.expectedMainSpecs });
    if (!readback.ok) {
      writeCloseoutState(projectRoot, archivedDir, { ...baseState, stage: 'readback-failed', archived: true, archiveName: dirs[0], readback });
      releaseArchiveLock({ projectRoot, change });
      coded('READBACK_MISMATCH', `main specs readback failed after archive: ${JSON.stringify(readback.mismatches)}`);
    }

    writeCloseoutState(projectRoot, archivedDir, { ...baseState, stage: 'complete', archived: true, archiveName: dirs[0], readback });
    releaseArchiveLock({ projectRoot, change });
    return {
      ok: true,
      change,
      execution,
      scope: 'component-only',
      overallCompletionEligible: false,
      archiveName: dirs[0],
      archiveDir: archivedDir,
      summaryDigest: rehearsal.summaryDigest,
      readback,
    };
  } catch (error) {
    // A refusal must never wedge the change: release the lock this execution
    // holds (the archive dir, when the archive already moved it).
    if (archivedDir === null) releaseArchiveLock({ projectRoot, change });
    throw error;
  }
}

// --- interruption recovery (A11) -------------------------------------------------

export function recoverCloseout({ projectRoot, change, openspecCli, execution = 'spec-closeout-recovery', timeoutMs = CLI_TIMEOUT_MS }) {
  openspecCli = resolveOpenspecCli(openspecCli);
  if (!change || typeof change !== 'string') coded('CHANGE_INVALID', 'recoverCloseout requires a change name');
  requireComponentProject(projectRoot, change);
  const changeDir = path.join(projectRoot, 'openspec/changes', change);
  const dirs = archiveDirsFor(projectRoot, change);
  if (dirs.length > 1) {
    // Same-name ambiguity: block instead of guessing the newest archive.
    coded('AMBIGUOUS_ARCHIVE', `multiple archives match change ${change}: ${dirs.join(', ')}; resolve the ambiguity before recovering`);
  }

  if (fs.existsSync(changeDir)) {
    // Nothing irreversible happened yet. A dead writer's lock is reclaimable;
    // a live writer means recovery must not touch the closeout.
    const lockPath = lockPathIn(projectRoot, change);
    let holder = null;
    try {
      holder = JSON.parse(readProjectText(projectRoot,lockPath,true));
    } catch (error) {
      if (error instanceof CodedError) throw error;
      holder = null;
    }
    let lockReclaimed = false;
    if (holder) {
      if (holderIsAlive(holder)) {
        coded('ARCHIVE_WRITER_EXISTS', `writer ${holder.writerId ?? '<unknown>'} (pid ${holder.pid}) is still alive; recovery refused`);
      }
      fs.rmSync(lockPath, { force: true });
      lockReclaimed = true;
    }
    return { scope: 'component-only', overallCompletionEligible: false, resumed: 'pre-archive', lockReclaimed, state: readCloseoutState(projectRoot, changeDir) };
  }

  if (dirs.length === 1) {
    // The CLI archive DID complete (it moves the change directory): the sync
    // already happened inside it. Recovery must not re-archive or re-sync —
    // it reads the main specs back and finishes the closeout.
    const archiveDir = path.join(projectRoot, 'openspec/changes/archive', dirs[0]);
    const priorState = readCloseoutState(projectRoot, archiveDir);
    // The archived copy carries the deltas; rebuild the summary from it.
    const summary = {change, capabilities:readDeltaCapabilities(projectRoot,path.join(archiveDir,'specs'))};
    const readback = readBackMainSpecs({ projectRoot, summary });
    // Reclaim the moved lock of a dead writer; a live writer keeps it.
    const lockPath = path.join(archiveDir, LOCK_FILE);
    let holder = null;
    try {
      holder = JSON.parse(readProjectText(projectRoot,lockPath,true));
    } catch (error) {
      if (error instanceof CodedError) throw error;
      holder = null;
    }
    if (holder && holderIsAlive(holder)) {
      coded('ARCHIVE_WRITER_EXISTS', `writer ${holder.writerId ?? '<unknown>'} (pid ${holder.pid}) is still alive; recovery refused`);
    }
    if (holder) fs.rmSync(lockPath, { force: true });

    const state = {
      change,
      execution: priorState?.execution ?? execution,
      recoveredBy: execution,
      summaryDigest: priorState?.summaryDigest ?? null,
      knowledgeCloseout: priorState?.knowledgeCloseout ?? null,
      stage: readback.ok ? 'complete' : 'readback-failed',
      archived: true,
      archiveName: dirs[0],
      resumed: 'post-archive',
      readback,
      recoveredAt: new Date().toISOString(),
    };
    writeCloseoutState(projectRoot, archiveDir, state);
    return { scope: 'component-only', overallCompletionEligible: false, resumed: 'post-archive', reArchived: false, lockReclaimed: Boolean(holder), archiveName: dirs[0], readback, state };
  }

  coded('CHANGE_MISSING', `change ${change} neither exists as an active change nor as an archive; nothing to recover`);
}


// Trusted bootstrap code seam for the Comet 0.5.0 face. There is no CLI/env/
// module loader here: the binding carries the pinned aggregate's own exports
// (runClassicCli from work/assets/skills/comet/scripts/comet-runtime.mjs,
// optionally ensureClassicRuntimeRun from
// work/dist/domains/comet-classic/classic-runtime-run.js). The installed
// aggregate retains all authority, gates, locks and transaction recovery.
// Passing functions is wiring only, never a source qualification.
//
// 0.5.0 on-disk contract this adapter reads back (never writes):
//   - change state file: comet-state.yaml (new) or .comet.yaml (legacy) —
//     exactly one of the two, both present is a conflict (upstream
//     ClassicStateFileConflictError), symlinks refused. The file carries the
//     change_id / run_id / phase / archived projection used for the
//     independent same-Run identity readback.
//   - artifact layout: legacy -> <root>/openspec, docs -> <root>/docs/openspec
//     (classic-layout.ts); both roots carrying the change is structural
//     ambiguity and is refused rather than guessed.
//   - archive writer: ONLY the openspec CLI (pinned 1.11.0 via COMET_OPENSPEC),
//     invoked exactly once by Native's `comet archive` (openspec archive
//     --yes). No adapter path syncs or archives; a repeated closeout on an
//     already-archived Run reconciles from the archived projection and never
//     dispatches a second archive (native re-archive is itself idempotent —
//     verified against the pinned build; the adapter does not rely on it).
//   - Kp (project knowledge closeout) is a Native composition obligation
//     (P2_4 extension at full.verify.check.evidence, re-verified at archive
//     time). This adapter forwards the native refusal verbatim: ok=false with
//     the native exit code and output, the active position untouched, the
//     same Run preserved. It never retries, masks, or substitutes a receipt.
export function createManagedSpecAdapter(options = {}) {
  if (!isRecord(options)) coded('MANAGED_RUNTIME_REQUIRED', 'A fixed Runtime binding is required');
  const {runtime,projectRoot} = options;
  if (!runtime || typeof runtime.runClassicCli !== 'function')
    coded('MANAGED_RUNTIME_REQUIRED', 'The fixed original Comet aggregate is required');
  const root = projectRootPath(projectRoot);
  const runClassicCli = runtime.runClassicCli.bind(runtime);
  const ensureClassicRuntimeRun = typeof runtime.ensureClassicRuntimeRun === 'function'
    ? runtime.ensureClassicRuntimeRun.bind(runtime) : null;
  const nameOf = (change) => {
    // Native 0.5.0 change-name rule (classic-paths.ts openSpecChangeNameError).
    if (typeof change !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(change) || change.includes('..'))
      coded('CHANGE_INVALID', 'A canonical change name is required');
    return change;
  };
  // Dual-name change state file (classic-state-file.ts): exactly one of
  // comet-state.yaml / .comet.yaml; both present is a conflict; anything but a
  // regular file is refused. Returns null when neither exists.
  const stateFileAt = (directory) => {
    const found = [];
    for (const name of CLASSIC_STATE_FILE_NAMES) {
      const entry = projectEntry(root,path.join(directory,name),{optional:true});
      if (entry) found.push(entry);
    }
    if (found.length > 1)
      coded('STATE_FILE_CONFLICT', 'Classic state files are ambiguous (comet-state.yaml and .comet.yaml both exist); resolve the conflict before continuing');
    if (found.length === 0) return null;
    return found[0];
  };
  // Independent minimal projection of the change state document: only the flat
  // scalar keys this adapter needs for identity readback. Native stays the
  // parser/authority; this is not permission to alter the document or to
  // synthesize a Runtime state.
  const stateProjectionAt = (directory) => {
    const entry = stateFileAt(directory);
    if (!entry) return null;
    const text = readProjectText(root,entry.file);
    const fields = {};
    for (const line of String(text ?? '').split('\n')) {
      const match = line.match(/^([a-z_]+):\s*(\S.*)$/u);
      if (match) fields[match[1]] = match[2].trim();
    }
    const changeId = fields.change_id;
    const runId = fields.run_id;
    const phase = fields.phase;
    if (fields.archived !== undefined && !['true','false'].includes(fields.archived))
      coded('MANAGED_RUNTIME_REQUIRED', 'The archived projection must be a boolean');
    const archived = fields.archived === 'true';
    if (typeof changeId !== 'string' || !changeId.trim() ||
      typeof runId !== 'string' || !runId.trim() ||
      !CLASSIC_PHASES.includes(phase))
      coded('MANAGED_RUNTIME_REQUIRED', 'The original Comet Run identity is unavailable from the change state file');
    // Upstream invariant (classic-resolver.ts): archived=true requires
    // phase=archive — refuse a torn or hand-edited projection.
    if (archived && phase !== 'archive')
      coded('MANAGED_RUNTIME_REQUIRED', 'An archived change must sit in phase=archive (upstream invariant)');
    return { file: entry.file, stat: entry.stat, changeId, runId, phase, archived };
  };
  const archiveNamesAt = (changesDir, change) => {
    const archive = path.join(changesDir, 'archive');
    const entry = projectEntry(root,archive,{kind:'directory',optional:true});
    if (!entry) return [];
    const suffix = `-${change}`;
    return fs.readdirSync(entry.file,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).filter((item) => {
      if (!item.isDirectory()) return false;
      // Native accepts a dated <YYYY-MM-DD>-<change> archive name and the
      // historical compat exact-<change> name (classic-paths.ts).
      if (item.name !== change && !(item.name.endsWith(suffix) && /^\d{4}-\d{2}-\d{2}-/u.test(item.name)))
        return false;
      return Boolean(stateFileAt(path.join(archive,item.name)));
    }).map((item) => item.name);
  };
  const location = (change) => {
    nameOf(change);
    // Discover the change across both Classic artifact layouts; more than one
    // location (active+archive, several archives, or dual roots) is refused.
    const candidates = [];
    let bareActive = false;
    let activePresent = false;
    const collisions = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const openspecDir of OPENSPEC_LAYOUT_DIRS) {
      const changesDir = path.join(root, openspecDir, 'changes');
      const activeDir = path.join(changesDir, change);
      const activeEntry = projectEntry(root,activeDir,{kind:'directory',optional:true});
      if (activeEntry) activePresent = true;
      if (activeEntry && stateFileAt(activeDir)) candidates.push({ directory: activeDir, archived: false, openspecDir });
      else if (activeEntry) bareActive = true;
      // Native's before-move conflict rule (classic-archive.ts): an active
      // change refuses when its today-named archive target already exists —
      // directory presence alone, with or without a state file inside.
      const archiveRoot = path.join(changesDir, 'archive');
      const archiveEntry = projectEntry(root,archiveRoot,{kind:'directory',optional:true});
      if (archiveEntry && activePresent) {
        for (const item of fs.readdirSync(archiveEntry.file,{withFileTypes:true})) {
          if (!item.isDirectory()) continue;
          if (item.name === `${today}-${change}` || item.name === change) collisions.push(path.join(archiveRoot,item.name));
        }
      }
      for (const name of archiveNamesAt(changesDir, change))
        candidates.push({ directory: path.join(changesDir, 'archive', name), archived: true, openspecDir, archiveName: name });
    }
    if (collisions.length)
      coded('AMBIGUOUS_ARCHIVE', `an active change refuses an already-existing archive target: ${collisions.map((c) => path.relative(root,c)).join(', ')}`);
    if (candidates.length > 1)
      coded('AMBIGUOUS_ARCHIVE', `The original change has ambiguous active/archive locations: ${candidates.map((c) => path.relative(root,c.directory)).join(', ')}`);
    if (candidates.length === 0) {
      // A change directory without its (native-owned) state document is not a
      // missing change: the Run projection is unavailable until Native writes it.
      if (bareActive) coded('MANAGED_RUNTIME_REQUIRED', 'The original Comet change state is unavailable');
      coded('CHANGE_MISSING', 'The original change does not exist');
    }
    const spot = candidates[0];
    const projection = stateProjectionAt(spot.directory);
    if (!projection) coded('MANAGED_RUNTIME_REQUIRED', 'The original Comet change state is unavailable');
    return { ...spot, projection, directoryStat: projectEntry(root,spot.directory,{kind:'directory'}).stat };
  };
  const mainSpecsDirOf = (openspecDir) => path.join(root, openspecDir, 'specs');
  const invoke = async (change, command) => {
    const before = location(change);
    const openspecDir = before.openspecDir;
    listFiles(root,path.join(before.directory,'specs'));
    listFiles(root,mainSpecsDirOf(openspecDir));
    const argv = command === 'archive' ? ['--json', 'archive', change] : ['--json', 'state', 'next', change];
    const result = await runClassicCli(argv, undefined,
      { projectRoot: root, invocationCwd: root });
    if (!isRecord(result) || !Number.isInteger(result.exitCode))
      coded('MANAGED_RUNTIME_REQUIRED', 'The original Runtime result is unavailable');
    const after = location(change);
    if (after.projection.runId !== before.projection.runId)
      coded('RUN_MISMATCH', 'Closeout must preserve the original Comet Run');
    const readback = after.archived ? readBackMainSpecs({ projectRoot: root,
      specsDir: mainSpecsDirOf(after.openspecDir),
      summary: {change, capabilities: readDeltaCapabilities(root,path.join(after.directory,'specs'))} }) : null;
    // Preserve the native result verbatim. An archive operation is never a
    // receipt for Kt, actual source qualification or overall delivery.
    return { ok: result.exitCode === 0 && (command !== 'archive' || after.archived) && (!readback || readback.ok),
      scope: 'original-comet-spec-operation', overallCompletionEligible: false,
      runId: after.projection.runId, phase: after.projection.phase,
      archived: after.archived, archiveName: after.archiveName ?? null,
      readback, native: result };
  };
  return Object.freeze({
    // Same-Run context read, 0.5.0 face. Semantics reused from the 0.4.5-era
    // candidate (ab90cc2+74607cc, worker-reports/Root-handoff-20261026):
    // fixed location/stat identity closure, synchronous assertCurrent at the
    // native boundary, native runId equality. The identity source is now the
    // dual-name change state file plus the pinned build's
    // ensureClassicRuntimeRun instead of the retired .comet/run-state.json.
    async readRunContext(request = {}) {
      if (!isRecord(request) || Object.keys(request).some((key) => !['change','expectedRunId'].includes(key)))
        coded('CHANGE_INVALID', 'A fixed Run context request is required');
      const {change,expectedRunId} = request;
      if (typeof expectedRunId !== 'string' || !expectedRunId.trim())
        coded('RUN_MISMATCH', 'An original Comet Run identity is required');
      const before = location(change);
      if (before.projection.runId !== expectedRunId) coded('RUN_MISMATCH', 'The original Comet Run must match');
      if (!ensureClassicRuntimeRun)
        coded('MANAGED_RUNTIME_REQUIRED', 'The original Comet Run reader is required');
      const directory = before.directory,
        device = before.projection.stat.dev, inode = before.projection.stat.ino;
      // Native signs synchronously; recheck the same protected location at that boundary.
      const assertCurrent = () => {
        const current = location(change);
        if (current.directory !== directory || current.projection.file !== before.projection.file ||
          current.projection.stat.dev !== device || current.projection.stat.ino !== inode)
          coded('RUN_LOCATION_CHANGED', 'The original Comet Run location changed during readback');
        if (current.projection.runId !== expectedRunId) coded('RUN_MISMATCH', 'The original Comet Run must match');
        return current;
      };
      const context = await ensureClassicRuntimeRun(directory);
      assertCurrent();
      if (!isRecord(context) || !isRecord(context.run) || context.run.runId !== expectedRunId)
        coded('RUN_MISMATCH', 'Native must retain the original Comet Run');
      return Object.freeze({...context, changeDir:directory, archived:before.archived, assertCurrent});
    },
    inspect(request = {}) {
      if (!isRecord(request)) coded('CHANGE_INVALID', 'A change request is required');
      const {change} = request;
      const current = location(change);
      if (current.archived) return {runId:current.projection.runId, archived:true, phase:current.projection.phase,
        archiveName:current.archiveName ?? null,
        summary:{change,capabilities:readDeltaCapabilities(root,path.join(current.directory,'specs'))}};
      return {runId:current.projection.runId, archived:false, phase:current.projection.phase,
        ...computeTargetSummary({projectRoot:root,change,openspecDir:current.openspecDir}),
        preservation:verifyScenarioPreservation({projectRoot:root,change,openspecDir:current.openspecDir})};
    },
    async closeout(request = {}) {
      if (!isRecord(request)) coded('CHANGE_INVALID', 'A change request is required');
      const {change,expectedSummaryDigest} = request;
      const current = location(change);
      if (current.archived) {
        // Archive-conflict reconciliation (A11/P4_6 prerequisite): the Run is
        // already archived — report its projection and read the main specs
        // back from the authoritative state. No second archive, no sync, no
        // native dispatch from this path.
        const readback = readBackMainSpecs({ projectRoot: root,
          specsDir: mainSpecsDirOf(current.openspecDir),
          summary: {change, capabilities: readDeltaCapabilities(root,path.join(current.directory,'specs'))} });
        return { ok: readback.ok, reconciled: 'already-archived',
          scope: 'original-comet-spec-operation', overallCompletionEligible: false,
          runId: current.projection.runId, phase: current.projection.phase,
          archived: true, archiveName: current.archiveName ?? null,
          readback, native: null };
      }
      const preservation = verifyScenarioPreservation({projectRoot:root,change,openspecDir:current.openspecDir});
      if (!preservation.ok) coded('SCENARIO_PRESERVATION_VIOLATION', 'MODIFIED requirements must preserve all existing scenarios');
      if (expectedSummaryDigest !== undefined &&
        computeTargetSummary({projectRoot:root,change,openspecDir:current.openspecDir}).digest !== expectedSummaryDigest)
        coded('SPEC_DRIFT', 'Specs or change changed after the supplied inspection');
      // The single native archive command. Kp refusal (or any native refusal)
      // is forwarded verbatim by invoke(); a refused closeout leaves the
      // active position untouched with the same Run.
      return invoke(change, 'archive');
    },
    recover(request = {}) {
      if (!isRecord(request)) coded('CHANGE_INVALID', 'A change request is required');
      return invoke(request.change, 'next');
    },
  });
}
