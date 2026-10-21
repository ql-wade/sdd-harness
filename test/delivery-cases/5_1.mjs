// P5_1 delivery case — (5.1.a) multi-worktree/DAG ordered integration over the
// REAL run data, and (5.1.b) the per-host capability matrix integrity.
//
// 5.1.a mechanically verifies three points from real sources only — the
// committed execution-ledger.jsonl event stream and the live `git worktree
// list` (this repository IS the living example: the run it documents used 26
// singular task dispatches across 26 distinct worktrees plus one 2-task wave):
//   (1) parallel isolation — every TASK_DISPATCHED carries its own worktree +
//       branch, no worktree ever hosts two branches, no dispatch targets the
//       main checkout, dispatch intervals genuinely overlap (parallel work),
//       and the live worktree set corroborates the ledger;
//   (2) serial integration — TASK_INTEGRATED events are time-ordered and every
//       integration is preceded by its task's independent-review verdict
//       (APPROVED / CHANGES_REQUESTED_RESOLVED, or CHANGES_REQUESTED followed
//       by REVIEW_FIX_DONE before the merge);
//   (3) parent-goal re-validation — a child's green NEVER closes the parent
//       goal: the real P1_1 chain (WORKER_COMPLETED DONE -> verdict ->
//       repair -> integration -> checkbox flip -> INTEGRATION_DEFECT found on
//       fresh checkout AFTER the flip -> AMENDMENT_INTEGRATED) is asserted in
//       order, every INTEGRATION_DEFECT is followed by a repair event, and the
//       lost-worker redispatch (no duplicate side effects) is on record.
//
// 5.1.b verifies the matrix at openspec/changes/delivery-foundation-
// rearchitecture/team-host-matrix/matrix.json: completeness (every host ×
// capability cell present, fixed status enum), every evidence pointer resolves
// on disk, UNSUPPORTED cells carry a note and UNVERIFIED cells carry a holder,
// no cell cites another host's host-specific evidence (no cross-platform
// inference), and the matrix does not contradict acceptance-index.json
// (F03/F08 semantics).
//
// Negative cases (forged inputs fed to the same validators, never mocks of the
// tested objects): dispatch targeting the main checkout is rejected; "child
// green = parent pass" (flip without the defect-aware chain) is rejected;
// integrate-before-review is rejected; a cell citing another host's adapter is
// rejected; a missing cell is rejected; an UNVERIFIED cell without holder is
// rejected.
//
// Read-only over live configuration: ledger/spec/index/matrix are read, git
// worktree list is queried; nothing outside $TMPDIR is written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHANGE_DIR = path.join(projectRoot, 'openspec', 'changes', 'delivery-foundation-rearchitecture');
const LEDGER = path.join(CHANGE_DIR, 'execution-ledger.jsonl');
const MATRIX = path.join(CHANGE_DIR, 'team-host-matrix', 'matrix.json');
const ACCEPTANCE_INDEX = path.join(CHANGE_DIR, 'acceptance-index.json');

// ---------------------------------------------------------------- ledger ---
function loadLedger() {
  return fs.readFileSync(LEDGER, 'utf8').trim().split('\n').map((line) => {
    const e = JSON.parse(line);
    e.kind = e.event ?? e.type;
    e.at = e.ts ?? e.at;
    return e;
  });
}
const ts = (e) => Date.parse(e.at);

function dispatches(events) {
  return events.filter((e) => e.kind === 'TASK_DISPATCHED');
}
function singularDispatches(events) {
  return dispatches(events).filter((e) => typeof e.task === 'string');
}
function waveDispatches(events) {
  return dispatches(events).filter((e) => Array.isArray(e.tasks) && e.tasks.length >= 2);
}
function ofKind(events, kind) {
  return events.filter((e) => e.kind === kind);
}
function forTask(events, kind, task) {
  return ofKind(events, kind).filter((e) => e.task === task);
}

// (1) parallel isolation -----------------------------------------------------
function checkIsolation({ events, worktrees }) {
  const v = [];
  const main = worktrees[0];
  // ledger worktree paths are relative to the MAIN checkout (worktrees[0])
  const repoRoot = main.path;
  const singular = singularDispatches(events);
  if (singular.length < 20) v.push(`expected >=20 singular dispatches, got ${singular.length}`);
  const byWorktree = new Map();
  for (const d of singular) {
    if (!d.worktree || !d.branch) v.push(`dispatch ${d.task}: missing worktree/branch`);
    const abs = path.isAbsolute(d.worktree)
      ? path.normalize(d.worktree)
      : path.normalize(path.join(repoRoot, d.worktree));
    if (abs === main.path) v.push(`dispatch ${d.task}: targets the main checkout`);
    if (!byWorktree.has(abs)) byWorktree.set(abs, new Set());
    byWorktree.get(abs).add(d.branch);
  }
  for (const [abs, branches] of byWorktree) if (branches.size > 1) {
    v.push(`worktree ${abs} hosted ${branches.size} branches (no isolation)`);
  }
  if (waveDispatches(events).length < 1) v.push('no parallel wave dispatch (>=2 tasks) on record');
  // genuine concurrency: two distinct tasks in flight at the same time
  const integrated = new Map();
  for (const e of ofKind(events, 'TASK_INTEGRATED')) {
    if (typeof e.task === 'string' && !integrated.has(e.task)) integrated.set(e.task, ts(e));
  }
  let overlaps = 0;
  for (const a of singular) for (const b of singular) {
    if (a.task === b.task) continue;
    const aEnd = integrated.get(a.task) ?? Number.POSITIVE_INFINITY;
    const bEnd = integrated.get(b.task) ?? Number.POSITIVE_INFINITY;
    if (ts(a) < bEnd && ts(b) < aEnd) overlaps++;
  }
  if (overlaps < 10) v.push(`expected >=10 overlapping in-flight task pairs, got ${overlaps}`);
  // live corroboration
  const nonMain = worktrees.slice(1);
  if (nonMain.length < 25) {
    v.push(`live worktree corroboration too weak: ${nonMain.length} non-main worktrees`);
  }
  const byPath = new Map(worktrees.map((w) => [w.path, w]));
  for (const d of singular) {
    const abs = path.isAbsolute(d.worktree)
      ? path.normalize(d.worktree)
      : path.normalize(path.join(repoRoot, d.worktree));
    const live = byPath.get(abs);
    if (!live) { v.push(`dispatch ${d.task}: worktree absent from live list`); continue; }
    if (live.detached) continue;
    if (!`${live.branch ?? ''}`.endsWith(d.branch)) {
      v.push(`dispatch ${d.task}: live branch ${live.branch} != ledger branch ${d.branch}`);
    }
  }
  return { ok: v.length === 0, violations: v };
}

// (2) serial integration -----------------------------------------------------
function reviewTrailOk(events, task, integrateTs) {
  const verdicts = forTask(events, 'INDEPENDENT_REVIEW_VERDICT', task);
  if (verdicts.some((x) => ['APPROVED', 'CHANGES_REQUESTED_RESOLVED'].includes(x.verdict) && ts(x) <= integrateTs)) {
    return true;
  }
  return verdicts.some((x) => x.verdict === 'CHANGES_REQUESTED' && ts(x) <= integrateTs
    && forTask(events, 'REVIEW_FIX_DONE', task).some((f) => ts(x) <= ts(f) && ts(f) <= integrateTs));
}
function checkSerialIntegration(events) {
  const v = [];
  const integrations = ofKind(events, 'TASK_INTEGRATED');
  if (integrations.length < 20) v.push(`expected >=20 TASK_INTEGRATED, got ${integrations.length}`);
  let prev = Number.NEGATIVE_INFINITY;
  for (const e of integrations) {
    if (ts(e) < prev) v.push(`TASK_INTEGRATED out of order in file: ${e.at}`);
    prev = ts(e);
    if (typeof e.task !== 'string') continue;
    if (!reviewTrailOk(events, e.task, ts(e))) {
      v.push(`integration of ${e.task} lacks a prior independent-review verdict trail`);
    }
  }
  return { ok: v.length === 0, violations: v };
}

// (3) parent-goal re-validation ----------------------------------------------
function checkParentRevalidation(events) {
  const v = [];
  const defects = ofKind(events, 'INTEGRATION_DEFECT');
  if (defects.length < 1) v.push('no INTEGRATION_DEFECT on record — cannot prove child-green != parent-pass');
  const repairs = ['REPAIR_REQUESTED', 'INTEGRATION_FIX_REQUESTED', 'INTEGRATION_FIX_DONE',
    'AMENDMENT_INTEGRATED', 'REVIEW_FIX_DONE']
    .flatMap((k) => ofKind(events, k).map(ts));
  for (const d of defects) {
    if (!repairs.some((r) => r >= ts(d))) v.push(`defect ${d.id ?? d.at}: no repair event after it`);
  }
  // The P1_1 chain is the live proof: child DONE + flipped, THEN the defect,
  // THEN the amendment — a green child never closed the parent goal by itself.
  const wc = forTask(events, 'WORKER_COMPLETED', 'P1_1');
  const flips = forTask(events, 'CHECKBOX_FLIP', 'P1_1');
  const defect = defects.find((d) => `${d.id ?? ''}${d.detail ?? ''}`.includes('P1_1'));
  if (!defect) v.push('P1_1 INTEGRATION_DEFECT not found');
  if (wc.length < 1 || flips.length < 1 || !defect) {
    v.push('P1_1 chain incomplete (worker completion / flip / defect)');
  } else {
    const amendment = ofKind(events, 'AMENDMENT_INTEGRATED').some((a) => ts(a) > ts(defect));
    if (!(ts(wc[0]) < ts(flips[0]) && ts(flips[0]) < ts(defect) && amendment)) {
      v.push('P1_1 chain not ordered worker-green < flip < defect < amendment');
    }
  }
  if (ofKind(events, 'WORKER_LOST_REDISPATCH').length < 1) {
    v.push('no WORKER_LOST_REDISPATCH on record (lost-worker recovery unproven)');
  }
  return { ok: v.length === 0, violations: v };
}

// ------------------------------------------------------------------ matrix ---
const STATUS_ENUM = ['VERIFIED', 'SUPPORTED', 'UNSUPPORTED', 'UNVERIFIED'];
// Host-specific evidence roots: a pointer under another host's roots is
// cross-host inference and is rejected. Everything else (hooks.yaml,
// mcp-capabilities.yaml, acceptance-index.json, specs, ledger, 3_2.mjs F08
// contract case, own report) is shared and allowed for all hosts.
const HOST_SPECIFIC_EVIDENCE = {
  'claude-code': [
    'tools/adapters/claude-code.sh',
    'test/lifecycle-hook.test.js',
    'test/adapter-quoting.test.js',
    'test/delivery-cases/1_1.mjs',
    'test/delivery-cases/4_5.mjs',
    'openspec/changes/delivery-foundation-rearchitecture/worker-reports/P1_1.json',
  ],
  'comet-classic': [
    'lib/adapters/comet.js',
    'openspec/changes/delivery-foundation-rearchitecture/host-probes/',
    'test/delivery-cases/1_3.mjs',
    'openspec/changes/delivery-foundation-rearchitecture/worker-reports/P1_3.json',
  ],
  llmwiki: [
    'lib/adapters/llmwiki.js',
    'openspec/changes/delivery-foundation-rearchitecture/worker-reports/I04.json',
    'test/knowledge-closeout.test.js',
    'test/delivery-cases/4_4.mjs',
  ],
  outline: [
    'lib/adapters/outline.js',
    'test/knowledge-closeout.test.js',
    'test/delivery-cases/4_4.mjs',
  ],
  'code-wiki': [
    'lib/adapters/code-wiki.js',
  ],
};

function loadMatrix() {
  assert.ok(fs.existsSync(MATRIX), `matrix missing: team-host-matrix/matrix.json (GREEN artifact) — ${MATRIX}`);
  return JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
}
const pointerPath = (ptr) => ptr.split(' :: ')[0].trim();

function checkCompleteness(matrix) {
  const v = [];
  for (const key of ['hosts', 'capabilities', 'cells']) {
    if (!Array.isArray(matrix[key]) || matrix[key].length === 0) v.push(`matrix.${key} missing/empty`);
  }
  if (v.length) return { ok: false, violations: v };
  const expected = new Set(matrix.hosts.flatMap((h) => matrix.capabilities.map((c) => `${h}|${c}`)));
  const seen = new Set();
  for (const cell of matrix.cells) {
    const id = `${cell.host}|${cell.capability}`;
    if (!expected.has(id)) { v.push(`unexpected cell ${id}`); continue; }
    if (seen.has(id)) v.push(`duplicate cell ${id}`);
    seen.add(id);
    if (!STATUS_ENUM.includes(cell.status)) v.push(`${id}: status "${cell.status}" outside fixed enum`);
    if (!Array.isArray(cell.evidence) || cell.evidence.length === 0) v.push(`${id}: empty evidence`);
  }
  for (const id of expected) if (!seen.has(id)) v.push(`missing cell ${id}`);
  return { ok: v.length === 0, violations: v };
}
function checkEvidenceResolves(matrix, root) {
  const v = [];
  for (const cell of matrix.cells) {
    for (const ptr of cell.evidence) {
      const rel = pointerPath(ptr);
      if (rel.startsWith('/') || rel.includes('..')) { v.push(`${cell.host}/${cell.capability}: non-repo-relative pointer ${rel}`); continue; }
      if (!fs.existsSync(path.join(root, rel))) v.push(`${cell.host}/${cell.capability}: pointer does not resolve: ${rel}`);
    }
  }
  return { ok: v.length === 0, violations: v };
}
function checkStatusObligations(matrix) {
  const v = [];
  for (const cell of matrix.cells) {
    if (cell.status === 'UNSUPPORTED' && !cell.note) v.push(`${cell.host}/${cell.capability}: UNSUPPORTED without note`);
    if (cell.status === 'UNVERIFIED' && !cell.holder) v.push(`${cell.host}/${cell.capability}: UNVERIFIED without holder`);
  }
  return { ok: v.length === 0, violations: v };
}
function checkNoCrossHostEvidence(matrix) {
  const v = [];
  for (const cell of matrix.cells) {
    // roots also listed for this cell's own host are SHARED with that host
    // (e.g. 4_4.mjs covers both llmwiki and outline) and are not a violation
    const ownRoots = new Set(HOST_SPECIFIC_EVIDENCE[cell.host] ?? []);
    for (const other of Object.keys(HOST_SPECIFIC_EVIDENCE)) {
      if (other === cell.host) continue;
      for (const root of HOST_SPECIFIC_EVIDENCE[other]) {
        if (ownRoots.has(root)) continue;
        for (const ptr of cell.evidence) {
          if (pointerPath(ptr) === root || pointerPath(ptr).startsWith(`${root}/`) || pointerPath(ptr).startsWith(root)) {
            v.push(`${cell.host}/${cell.capability}: cites ${other}-specific evidence ${ptr}`);
          }
        }
      }
    }
  }
  return { ok: v.length === 0, violations: v };
}
function checkAcceptanceIndexConsistency(matrix, index) {
  const v = [];
  const f08 = index.entries.F08;
  const f03 = index.entries.F03;
  if (f08.status !== 'ENVIRONMENT_GATED' || !f08.holder) v.push('acceptance-index F08 not ENVIRONMENT_GATED+holder (source changed?)');
  const browser = matrix.cells.filter((c) => c.capability === 'browser-evidence');
  if (browser.some((c) => c.status !== 'UNVERIFIED' || !c.holder)) {
    v.push('browser-evidence cells must stay UNVERIFIED with holder (no native-browser pilot in this environment)');
  }
  const ccDiscovery = matrix.cells.find((c) => c.host === 'claude-code' && c.capability === 'discovery');
  if (f03.status === 'VERIFIED' && ccDiscovery && ['UNSUPPORTED', 'UNVERIFIED'].includes(ccDiscovery.status)) {
    v.push('claude-code discovery contradicts acceptance-index F03 VERIFIED');
  }
  const cometWrite = matrix.cells.find((c) => c.host === 'comet-classic' && c.capability === 'write-protection');
  if (cometWrite) {
    const citesProbes = cometWrite.evidence.some((p) => pointerPath(p).includes('1_3-channel-probes.json'));
    const namesGap = /gap|缺口/i.test(`${cometWrite.note ?? ''}`);
    if (!citesProbes || !namesGap) {
      v.push('comet write-protection must cite the channel probes and name the shell/mcp gap (A09: gap is never blocked)');
    }
  }
  return { ok: v.length === 0, violations: v };
}

// ------------------------------------------------------------ real fixtures --
function liveWorktrees() {
  const out = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(out.status, 0, `git worktree list failed: ${out.stderr}`);
  const entries = [];
  let cur = null;
  for (const line of out.stdout.trim().split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice('worktree '.length) }; entries.push(cur); }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice('branch '.length);
    else if (line === 'detached' && cur) cur.detached = true;
  }
  return entries;
}

test('5.1.a-1 parallel isolation: real ledger dispatches + live worktree set', () => {
  const res = checkIsolation({ events: loadLedger(), worktrees: liveWorktrees() });
  assert.deepStrictEqual(res.violations, [], `isolation violations: ${res.violations.join('; ')}`);
});

test('5.1.a-2 serial integration: review-before-integrate, ordered merges', () => {
  const res = checkSerialIntegration(loadLedger());
  assert.deepStrictEqual(res.violations, [], `integration violations: ${res.violations.join('; ')}`);
});

test('5.1.a-3 parent re-validation: child green never closes the parent goal', () => {
  const res = checkParentRevalidation(loadLedger());
  assert.deepStrictEqual(res.violations, [], `parent-revalidation violations: ${res.violations.join('; ')}`);
});

test('5.1.a negatives: forged isolation / child-green-as-parent-pass / integrate-before-review are rejected', () => {
  const real = loadLedger();
  const worktrees = liveWorktrees();
  // N1: a dispatch that writes directly into the main checkout must be rejected.
  const forgedDispatch = {
    kind: 'TASK_DISPATCHED', task: 'X9', at: '2026-10-21T00:00:00.000000+00:00',
    worktree: '.', branch: 'impl/x9-direct-main', base: '0000000',
  };
  const n1 = checkIsolation({ events: [...real, forgedDispatch], worktrees });
  assert.equal(n1.ok, false, 'forged main-checkout dispatch must be rejected');
  assert.ok(n1.violations.some((x) => x.includes('main checkout')), n1.violations.join('; '));

  // N2: "child green = parent pass" — a stream where the only signal is a
  // worker's DONE (no verdict, no integration, no defect-aware chain) must
  // never satisfy the parent gate.
  const childGreenOnly = real.filter((e) => e.kind !== 'INTEGRATION_DEFECT'
    && e.kind !== 'AMENDMENT_INTEGRATED' && e.kind !== 'REPAIR_REQUESTED');
  const n2 = checkParentRevalidation(childGreenOnly);
  assert.equal(n2.ok, false, 'child-green-only stream must not close the parent goal');
  assert.ok(n2.violations.some((x) => x.includes('INTEGRATION_DEFECT')), n2.violations.join('; '));

  // N3: an integration recorded BEFORE its independent-review verdict must be
  // rejected (verdict trail is mandatory).
  const early = {
    kind: 'TASK_INTEGRATED', task: 'X9', at: '2026-10-19T00:00:00.000000+00:00', merge: 'dead00f (--no-ff)',
  };
  const withEarly = [...real, early];
  const n3 = checkSerialIntegration(withEarly);
  assert.equal(n3.ok, false, 'integrate-before-review must be rejected');
  assert.ok(n3.violations.some((x) => x.includes('X9')), n3.violations.join('; '));
});

test('5.1.b-1 matrix completeness: hosts x capabilities, no empty cells, fixed enum', () => {
  const res = checkCompleteness(loadMatrix());
  assert.deepStrictEqual(res.violations, [], `completeness violations: ${res.violations.join('; ')}`);
});

test('5.1.b-2 every matrix evidence pointer resolves on disk', () => {
  const res = checkEvidenceResolves(loadMatrix(), projectRoot);
  assert.deepStrictEqual(res.violations, [], `evidence violations: ${res.violations.join('; ')}`);
});

test('5.1.b-3 status obligations: UNSUPPORTED note, UNVERIFIED holder', () => {
  const res = checkStatusObligations(loadMatrix());
  assert.deepStrictEqual(res.violations, [], `obligation violations: ${res.violations.join('; ')}`);
});

test('5.1.b-4 no cross-host evidence inference', () => {
  const res = checkNoCrossHostEvidence(loadMatrix());
  assert.deepStrictEqual(res.violations, [], `cross-host violations: ${res.violations.join('; ')}`);
});

test('5.1.b-5 acceptance-index consistency (F03/F08/A09 semantics)', () => {
  const index = JSON.parse(fs.readFileSync(ACCEPTANCE_INDEX, 'utf8'));
  const res = checkAcceptanceIndexConsistency(loadMatrix(), index);
  assert.deepStrictEqual(res.violations, [], `index-consistency violations: ${res.violations.join('; ')}`);
});

test('5.1.b negatives: cross-host cell / missing cell / holderless UNVERIFIED are rejected', () => {
  const matrix = loadMatrix();
  // N4: a comet cell citing llmwiki's adapter is cross-platform inference.
  const forged = structuredClone(matrix);
  const cometCell = forged.cells.find((c) => c.host === 'comet-classic' && c.capability === 'discovery');
  cometCell.evidence.push('lib/adapters/llmwiki.js :: llmwiki supports discovery so comet should too');
  const n4 = checkNoCrossHostEvidence(forged);
  assert.equal(n4.ok, false, 'cross-host evidence must be rejected');
  assert.ok(n4.violations.some((x) => x.includes('llmwiki-specific')), n4.violations.join('; '));

  // N5: a removed cell leaves a hole.
  const holed = structuredClone(matrix);
  holed.cells = holed.cells.filter((c) => !(c.host === 'outline' && c.capability === 'browser-evidence'));
  const n5 = checkCompleteness(holed);
  assert.equal(n5.ok, false, 'missing cell must be rejected');
  assert.ok(n5.violations.some((x) => x.includes('missing cell')), n5.violations.join('; '));

  // N6: UNVERIFIED without a holder hides who owns the gap.
  const holderless = structuredClone(matrix);
  const unv = holderless.cells.find((c) => c.status === 'UNVERIFIED' && c.holder);
  delete unv.holder;
  const n6 = checkStatusObligations(holderless);
  assert.equal(n6.ok, false, 'holderless UNVERIFIED must be rejected');
  assert.ok(n6.violations.some((x) => x.includes('without holder')), n6.violations.join('; '));
});
