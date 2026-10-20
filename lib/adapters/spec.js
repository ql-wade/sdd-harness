// Spec Adapter — the SOLE archive writer for change spec closeout
// (task P3_4, A11/B08).
//
// This module is the only place that turns an accepted OpenSpec change into an
// archive: it wraps the real `openspec` CLI and owns the closeout sequence
// rehearse -> preserve-check -> validate -> drift-gate -> archive -> readback.
// It never re-applies spec deltas itself — `openspec archive` already contains
// the sync (specs update + change move in one CLI operation), so a completed
// archive is final and nothing here syncs a second time. There is no phase,
// no currentPhase and no run state in this module: the closeout stage journal
// below describes one idempotent closeout, not a second control plane
// (Comet.Run.managedDelivery.v1 boundary).
//
// Semantics proven by test/spec-closeout.test.js and test/delivery-cases/3_4.mjs:
//   Sole writer     O_EXCL lock inside the change directory; a second writer
//                   (in-process or a real child process) is refused
//                   (ARCHIVE_WRITER_EXISTS); a completed archive refuses a
//                   second closeout (ARCHIVE_ALREADY_SEALED).
//   Rehearsal       the complete real change structure is cloned into a
//                   throwaway $TMPDIR project and the REAL CLI archives the
//                   clone; the target summary (parsed deltas + current main
//                   specs digest + expected post-archive spec bytes) is
//                   previewed without touching the real project.
//   Preservation    every scenario of every MODIFIED requirement in the
//                   current main specs must be present in the delta. The host
//                   CLI 1.3.1 passes such truncated deltas through validate
//                   --strict AND archives them silently (verified: the
//                   dropped scenario disappears from main specs) — the
//                   adapter pre-check is the layer that refuses it.
//   Drift blocking  the summary digest binds the deltas AND the current main
//                   specs; anything another Change does between rehearsal and
//                   execution flips the digest and the closeout is refused
//                   (SPEC_DRIFT) until it is re-rehearsed (B08).
//   Recovery        the authoritative state is the files on disk, never the
//                   journal: pre-archive interruption reclaims the stale lock
//                   of a dead writer; post-archive interruption detects the
//                   completed CLI archive from the moved directory, reads the
//                   main specs back and completes WITHOUT re-archiving or
//                   re-syncing (A11). Ambiguous double archives refuse
//                   instead of guessing the newest.
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
  const requirements = {};
  for (const block of requirementBlocks(text)) {
    requirements[block.name] = block;
  }
  return { requirements };
}

// --- summary (the "target summary" the whole closeout is gated on) ------------

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(abs);
    }
  };
  walk(root);
  return out;
}

// Digest over the whole main-specs tree + the change directory: any edit by
// another Change on either side flips it (the drift signal for B08/A11).
function closeoutScopeDigest({ projectRoot, change }) {
  const specsFiles = listFiles(path.join(projectRoot, 'openspec/specs')).map((abs) => ['specs', abs]);
  const changeDir = path.join(projectRoot, 'openspec/changes', change);
  const changeFiles = listFiles(changeDir)
    .filter((abs) => !ADAPTER_STATE_FILES.has(path.basename(abs)))
    .map((abs) => ['change', abs]);
  const lines = [...specsFiles, ...changeFiles]
    .map(([scope, abs]) => `${scope}:${path.relative(projectRoot, abs)}:${sha256(fs.readFileSync(abs))}`)
    .sort();
  return sha256(lines.join('\n'));
}

// The target summary: what the archive will do to which capabilities, bound to
// the exact current state of the main specs and the change files.
export function computeTargetSummary({ projectRoot, change }) {
  if (!change || typeof change !== 'string') coded('CHANGE_INVALID', 'computeTargetSummary requires a change name');
  const deltaDir = path.join(projectRoot, 'openspec/changes', change, 'specs');
  if (!fs.existsSync(deltaDir)) coded('CHANGE_MISSING', `no spec deltas for change ${change} under ${deltaDir}`);
  const capabilities = {};
  for (const entry of fs.readdirSync(deltaDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const specFile = path.join(deltaDir, entry.name, 'spec.md');
    if (entry.isDirectory() && fs.existsSync(specFile)) {
      capabilities[entry.name] = parseDeltaSpec(fs.readFileSync(specFile, 'utf8'));
    }
  }
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
    const main = fs.existsSync(mainPath) ? parseMainSpec(fs.readFileSync(mainPath, 'utf8')) : { requirements: {} };
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
  const pid = Number(holder?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false; // legacy/corrupt holder: reclaimable
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM'; // exists but owned by someone else
  }
}

export function acquireArchiveLock({ projectRoot, change, writerId }) {
  if (!writerId || typeof writerId !== 'string') coded('CLOSEOUT_EXECUTION_REQUIRED', 'acquireArchiveLock requires a non-empty writerId');
  const lockPath = lockPathIn(projectRoot, change);
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
  const candidates = [lockPathIn(projectRoot, change)];
  for (const dir of archiveDirsFor(projectRoot, change)) {
    candidates.push(path.join(projectRoot, 'openspec/changes/archive', dir, LOCK_FILE));
  }
  let released = false;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      fs.rmSync(candidate, { force: true });
      released = true;
    }
  }
  return { ok: true, released };
}

function archiveDirsFor(projectRoot, change) {
  const archive = path.join(projectRoot, 'openspec/changes/archive');
  if (!fs.existsSync(archive)) return [];
  const suffix = `-${change}`;
  return fs.readdirSync(archive)
    .filter((name) => name.endsWith(suffix) && fs.statSync(path.join(archive, name)).isDirectory())
    .sort();
}

// --- closeout state journal (travels with the change directory) ----------------

const statePathIn = (dir) => path.join(dir, STATE_FILE);

function writeCloseoutState(dir, state) {
  const file = statePathIn(dir);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

function readCloseoutState(dir) {
  try {
    return JSON.parse(fs.readFileSync(statePathIn(dir), 'utf8'));
  } catch {
    return null;
  }
}

// --- rehearsal (dry-run against a full clone in $TMPDIR) -----------------------

function digestSpecTree(specsDir) {
  const expected = {};
  for (const abs of listFiles(specsDir)) {
    expected[path.relative(specsDir, abs)] = sha256(fs.readFileSync(abs));
  }
  return expected;
}

export function rehearseArchive({ projectRoot, change, openspecCli = 'openspec', timeoutMs = CLI_TIMEOUT_MS, cleanup = true }) {
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
      expectedMainSpecs: digestSpecTree(path.join(tempRoot, 'openspec/specs')),
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
  const mismatches = [];
  let checked = 0;
  for (const [capability, delta] of Object.entries(summary?.capabilities ?? {})) {
    const mainPath = path.join(projectRoot, 'openspec/specs', capability, 'spec.md');
    const mainText = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf8') : null;
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
    if (!fs.existsSync(abs)) {
      mismatches.push({ type: 'EXPECTED_SPEC_MISSING', path: rel });
      continue;
    }
    const observed = sha256(fs.readFileSync(abs));
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

export function closeoutSpecs({ projectRoot, change, openspecCli = 'openspec', rehearsal, knowledgeCloseout, execution, timeoutMs = CLI_TIMEOUT_MS }) {
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
    writeCloseoutState(changeDir, { ...baseState, stage: 'archiving', archived: false });

    // The archive call — the only archive write in this module. It contains
    // the sync (specs update + change move), so nothing here re-syncs.
    const archive = runCli({ openspecCli, args: ['archive', change, '-y'], cwd: projectRoot, timeoutMs });
    const output = `${archive.stdout ?? ''}${archive.stderr ?? ''}`;
    // Exit 0 is not proof (the CLI aborts invalid rebuilds with exit 0):
    // verify the authoritative state on disk.
    if (archive.status !== 0) {
      if (fs.existsSync(changeDir)) writeCloseoutState(changeDir, { ...baseState, stage: 'archive-failed', archived: false, archiveOutput: output.slice(0, 4000) });
      coded('ARCHIVE_CLI_FAILED', `openspec archive failed (exit ${archive.status}): ${output.slice(0, 400)}`);
    }
    // Authoritative-state verification over journal text: exit 0 with an
    // already-consumed change and exactly one archive is the only accepted
    // outcome. Any other shape (silent abort, ambiguous same-name archives)
    // refuses — the journal is written only where its directory still exists.
    const dirs = archiveDirsFor(projectRoot, change);
    const changeConsumed = !fs.existsSync(changeDir);
    if (!changeConsumed || dirs.length !== 1) {
      if (fs.existsSync(changeDir)) writeCloseoutState(changeDir, { ...baseState, stage: 'archive-not-applied', archived: false, archiveOutput: output.slice(0, 4000) });
      coded('ARCHIVE_NOT_APPLIED', `openspec archive reported success but the authoritative state is not one consumed change and one archive (changeConsumed=${changeConsumed}, archives=${dirs.length}): ${output.slice(0, 400)}`);
    }
    archivedDir = path.join(projectRoot, 'openspec/changes/archive', dirs[0]);
    writeCloseoutState(archivedDir, { ...baseState, stage: 'archived', archived: true, archiveName: dirs[0], archiveOutput: output.slice(0, 4000) });

    // External readback: main specs must match the rehearsed expectation.
    const readback = readBackMainSpecs({ projectRoot, summary: rehearsal.summary, expectedMainSpecs: rehearsal.expectedMainSpecs });
    if (!readback.ok) {
      writeCloseoutState(archivedDir, { ...baseState, stage: 'readback-failed', archived: true, archiveName: dirs[0], readback });
      releaseArchiveLock({ projectRoot, change });
      coded('READBACK_MISMATCH', `main specs readback failed after archive: ${JSON.stringify(readback.mismatches)}`);
    }

    writeCloseoutState(archivedDir, { ...baseState, stage: 'complete', archived: true, archiveName: dirs[0], readback });
    releaseArchiveLock({ projectRoot, change });
    return {
      ok: true,
      change,
      execution,
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
      holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
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
    return { resumed: 'pre-archive', lockReclaimed, state: readCloseoutState(changeDir) };
  }

  if (dirs.length === 1) {
    // The CLI archive DID complete (it moves the change directory): the sync
    // already happened inside it. Recovery must not re-archive or re-sync —
    // it reads the main specs back and finishes the closeout.
    const archiveDir = path.join(projectRoot, 'openspec/changes/archive', dirs[0]);
    const priorState = readCloseoutState(archiveDir);
    // The archived copy carries the deltas; rebuild the summary from it.
    const summary = { change, capabilities: {} };
    const deltaDir = path.join(archiveDir, 'specs');
    for (const entry of fs.existsSync(deltaDir) ? fs.readdirSync(deltaDir, { withFileTypes: true }) : []) {
      const specFile = path.join(deltaDir, entry.name, 'spec.md');
      if (entry.isDirectory() && fs.existsSync(specFile)) {
        summary.capabilities[entry.name] = parseDeltaSpec(fs.readFileSync(specFile, 'utf8'));
      }
    }
    const readback = readBackMainSpecs({ projectRoot, summary });
    // Reclaim the moved lock of a dead writer; a live writer keeps it.
    const lockPath = path.join(archiveDir, LOCK_FILE);
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
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
    writeCloseoutState(archiveDir, state);
    return { resumed: 'post-archive', reArchived: false, lockReclaimed: Boolean(holder), archiveName: dirs[0], readback, state };
  }

  coded('CHANGE_MISSING', `change ${change} neither exists as an active change nor as an archive; nothing to recover`);
}
