// Spec Adapter (P3_4): pure OpenSpec inspection plus one thin Comet write seam.
// createManagedSpecAdapter binds the trusted bootstrap's original aggregate;
// only Native owns gates, locks, transactions, archive preview and recovery.
// The old filesystem writer below is component-only compatibility for projects
// with no Comet ownership metadata. Every mutating legacy helper rejects a
// Comet-owned project, including malformed/partial control documents.
// Neither an injected function nor a caller's Kp {id,digest} proves identity,
// method execution, source qualification, a managed gate or overall completion.
// OpenSpec archive already syncs; no adapter path performs a second sync.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI_TIMEOUT_MS = 120_000;
const LOCK_FILE = '.spec-closeout.lock';
const STATE_FILE = '.spec-closeout-state.json';
const SHA256_RE = /^[a-f0-9]{64}$/;
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
function closeoutScopeDigest({ projectRoot, change }) {
  const specsFiles = listFiles(projectRoot, path.join(projectRoot, 'openspec/specs')).map((abs) => ['specs', abs]);
  const changeDir = path.join(projectRoot, 'openspec/changes', change);
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
export function computeTargetSummary({ projectRoot, change }) {
  pathComponent(change);
  const deltaDir = path.join(projectRoot, 'openspec/changes', change, 'specs');
  if (!projectEntry(projectRoot,deltaDir,{kind:'directory',optional:true}))
    coded('CHANGE_MISSING', 'The change spec directory is unavailable');
  const capabilities = readDeltaCapabilities(projectRoot,deltaDir);
  return {
    summary: { change, capabilities },
    digest: sha256(canonicalJson({ change, capabilities, scope: closeoutScopeDigest({ projectRoot, change }) })),
  };
}

// --- scenario preservation (MODIFIED keeps every existing scenario) -----------

export function verifyScenarioPreservation({ projectRoot, change }) {
  const { summary } = computeTargetSummary({ projectRoot, change });
  const violations = [];
  for (const [capability, delta] of Object.entries(summary.capabilities)) {
    const mainPath = path.join(projectRoot, 'openspec/specs', capability, 'spec.md');
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

export function rehearseArchive({ projectRoot, change, openspecCli = 'openspec', timeoutMs = CLI_TIMEOUT_MS, cleanup = true }) {
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

export function readBackMainSpecs({ projectRoot, summary, expectedMainSpecs }) {
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
    const mainPath = path.join(projectRoot, 'openspec/specs', capability, 'spec.md');
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
    const abs = path.join(projectRoot, 'openspec/specs', rel);
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

export function closeoutSpecs({ projectRoot, change, openspecCli = 'openspec', rehearsal, knowledgeCloseout, execution, timeoutMs = CLI_TIMEOUT_MS }) {
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

export function recoverCloseout({ projectRoot, change, openspecCli = 'openspec', execution = 'spec-closeout-recovery', timeoutMs = CLI_TIMEOUT_MS }) {
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


// Trusted bootstrap code seam. There is no CLI/env/module loader here. The
// installed aggregate retains all authority, gates, locks and transaction
// recovery. Passing a function is wiring only, never a source qualification.
export function createManagedSpecAdapter(options = {}) {
  if (!isRecord(options)) coded('MANAGED_RUNTIME_REQUIRED', 'A fixed Runtime binding is required');
  const {runtime,projectRoot} = options;
  if (!runtime || typeof runtime.runClassicCli !== 'function')
    coded('MANAGED_RUNTIME_REQUIRED', 'The fixed original Comet aggregate is required');
  const root = projectRootPath(projectRoot);
  const runClassicCli = runtime.runClassicCli.bind(runtime);
  const nameOf = (change) => {
    if (typeof change !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change))
      coded('CHANGE_INVALID', 'A canonical change name is required');
    return change;
  };
  const location = (change) => {
    nameOf(change);
    const active = path.join(root, 'openspec/changes', change);
    const archives = archiveDirsFor(root, change);
    const activeEntry = projectEntry(root,active,{kind:'directory',optional:true});
    if (archives.length > 1 || (activeEntry && archives.length))
      coded('AMBIGUOUS_ARCHIVE', 'The original change has ambiguous active/archive locations');
    const directory = activeEntry ? activeEntry.file : archives.length === 1
      ? path.join(root, 'openspec/changes/archive', archives[0]) : null;
    if (!directory) coded('CHANGE_MISSING', 'The original change does not exist');
    // Native is the parser/authority. This is independent identity readback,
    // not permission to alter the document or synthesize a Runtime state.
    let run;
    try { run = JSON.parse(readProjectText(root,path.join(directory,'.comet/run-state.json'))); }
    catch (error) {
      if (error instanceof CodedError) throw error;
      coded('MANAGED_RUNTIME_REQUIRED', 'The original Comet Run is unavailable');
    }
    if (!isRecord(run) || typeof run.runId !== 'string' || !run.runId.trim() ||
      !['running','waiting','completed','failed'].includes(run.status))
      coded('MANAGED_RUNTIME_REQUIRED', 'The original Comet Run identity is unavailable');
    return { directory, run, archived: directory !== active };
  };
  const summaryAt = (directory, change) => {
    return {change,capabilities:readDeltaCapabilities(root,path.join(directory,'specs'))};
  };
  const invoke = async (change, command) => {
    const before = location(change);
    listFiles(root,path.join(before.directory,'specs'));
    listFiles(root,path.join(root,'openspec/specs'));
    const argv = command === 'archive' ? ['--json', 'archive', change] : ['--json', 'state', 'next', change];
    const result = await runClassicCli(argv, undefined,
      { projectRoot: root, invocationCwd: root });
    if (!isRecord(result) || !Number.isInteger(result.exitCode))
      coded('MANAGED_RUNTIME_REQUIRED', 'The original Runtime result is unavailable');
    const after = location(change);
    if (after.run.runId !== before.run.runId)
      coded('RUN_MISMATCH', 'Closeout must preserve the original Comet Run');
    const readback = after.archived ? readBackMainSpecs({ projectRoot: root,
      summary: summaryAt(after.directory, change) }) : null;
    // Preserve the native result verbatim. An archive operation is never a
    // receipt for Kt, actual source qualification or overall delivery.
    return { ok: result.exitCode === 0 && (command !== 'archive' || after.archived) && (!readback || readback.ok),
      scope: 'original-comet-spec-operation', overallCompletionEligible: false,
      runId: after.run.runId, status: after.run.status, archived: after.archived,
      readback, native: result };
  };
  return Object.freeze({
    inspect(request = {}) {
      if (!isRecord(request)) coded('CHANGE_INVALID', 'A change request is required');
      const {change} = request;
      const current = location(change);
      if (current.archived) return {runId:current.run.runId, archived:true,
        summary:summaryAt(current.directory,change)};
      return {runId:current.run.runId, archived:false,
        ...computeTargetSummary({projectRoot:root,change}),
        preservation:verifyScenarioPreservation({projectRoot:root,change})};
    },
    async closeout(request = {}) {
      if (!isRecord(request)) coded('CHANGE_INVALID', 'A change request is required');
      const {change,expectedSummaryDigest} = request;
      const current = location(change);
      if (!current.archived) {
        const preservation = verifyScenarioPreservation({projectRoot:root,change});
        if (!preservation.ok) coded('SCENARIO_PRESERVATION_VIOLATION', 'MODIFIED requirements must preserve all existing scenarios');
        if (expectedSummaryDigest !== undefined &&
          computeTargetSummary({projectRoot:root,change}).digest !== expectedSummaryDigest)
          coded('SPEC_DRIFT', 'Specs or change changed after the supplied inspection');
      }
      return invoke(change, 'archive');
    },
    recover(request = {}) {
      if (!isRecord(request)) coded('CHANGE_INVALID', 'A change request is required');
      return invoke(request.change, 'next');
    },
  });
}
