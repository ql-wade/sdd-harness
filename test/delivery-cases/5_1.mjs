// P5_1 delivery case — rework (rework-seven-p1-r1), branch rework/p5-1, base 2b1e145.
//
// 5.1.a multi-worktree/DAG ordered integration over REAL run data, and 5.1.b the
// per-host capability matrix, including the reworked additions:
//   - 5.1.a: the ledger documents TWO runs. The prior run (impl-dfr-20261020-r1)
//     integrated everything — including an acceptance integration ("VERIFY")
//     that never had an independent-review verdict — and declared RUN_COMPLETED.
//     The parent goal was then reopened by an authorized replan
//     (SEVEN_P1_REPLAN_AUTHORIZED / SEVEN_P1_HANDOFF_VALIDATED / CONSENSUS_PASSED)
//     and re-dispatched as rework-seven-p1-r1. That chain is the live proof of
//     A12: child green (even a fully integrated, completed run) never closes the
//     parent goal. The reworked checks encode this at run granularity:
//       * every delivery-task integration still requires a prior review verdict;
//       * an acceptance integration (VERIFY) closes a run only with a review
//         trail, otherwise an authorized reopen event must follow — a completed
//         green run without either is rejected;
//       * parent-goal re-validation has a real instrument: the regenerated
//         four-layer acceptance-index (92 scenarios / 118 required checks), whose
//         structure, status vocabulary, summary consistency and evidence pointers
//         (file paths on disk, commit locators via git cat-file) must resolve.
//   - 5.1.b: the platform matrix (claude-code / comet-classic / llmwiki / outline
//     / code-wiki) keeps its per-platform cells, and the matrix gains a MACHINE
//     dimension (team-host-matrix/matrix.json machine_dimension): each machine
//     host is identified by real discovery commands, its capabilities carry
//     measured evidence pointers into this repo, an enablement gate field
//     (enabled true ONLY with a resolvable adjudication record — amendment 3,
//     env-capability-20261022 — for this machine), and default-deny refusal
//     semantics (refuse_start / refuse_release, statuses NOT_ENABLED) for every
//     host that was never explicitly enabled. Capabilities are never inferred
//     across machines: a disabled host may not cite an enabled host's
//     machine-measured evidence, and every cross-host/cross-machine inference
//     feed is rejected by negative mutation.
//
// F10 is owned by P5_2 and is not judged here. Positive isolation-recovery
// authorization that was not executed stays UNVERIFIED with a holder.
//
// Negative cases (forged inputs fed to the same validators, never mocks of the
// tested objects): dispatch targeting the main checkout; child-green-as-parent-
// pass streams; integrate-before-review; a completed run with neither review
// trail nor reopen; a hand-edited index summary; a wildcard host flipped to
// enabled without a record; a disabled host stripped of refusals; a disabled
// host claiming a capability; a disabled host citing this machine's measured
// evidence; a missing cell; a holderless UNVERIFIED.
//
// Read-only over live configuration: ledger/spec/index/matrix are read, git
// worktree list / git cat-file are queried; nothing outside $TMPDIR is written.
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
// Authorized reopen chain kinds on record (real events, real vocabulary).
const REOPEN_KINDS = ['SEVEN_P1_REPLAN_AUTHORIZED', 'SEVEN_P1_HANDOFF_VALIDATED', 'HALT_AND_REPLAN'];
const ACCEPTANCE_TASK = 'VERIFY';

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
function reopenExistsAfter(events, atTs) {
  return events.some((e) => REOPEN_KINDS.includes(e.kind) && ts(e) >= atTs);
}
function acceptanceIntegrationOk(events, integration) {
  // The acceptance integration closes a run only via a real independent-review
  // trail; an unreviewed acceptance integration is child-green-as-parent-pass
  // UNLESS an authorized reopen chain follows it (the prior run's live case).
  if (reviewTrailOk(events, ACCEPTANCE_TASK, ts(integration))) return true;
  return reopenExistsAfter(events, ts(integration));
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
    if (e.task === ACCEPTANCE_TASK) {
      if (!acceptanceIntegrationOk(events, e)) {
        v.push(`acceptance integration of ${e.task} (${e.at}) has neither a review trail nor a following reopen — parent goal must not close`);
      }
      continue;
    }
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
  // Run-granularity closure (A12): a run that declared completion holds the
  // parent goal closed ONLY if its acceptance integration carries a review
  // trail; otherwise an authorized reopen must follow the completion. Green
  // children (even all of them) never close the parent goal by themselves.
  for (const done of ofKind(events, 'RUN_COMPLETED')) {
    const runId = done.run_id;
    const acceptance = ofKind(events, 'TASK_INTEGRATED')
      .find((e) => e.task === ACCEPTANCE_TASK && e.run_id === runId);
    if (!acceptance) {
      v.push(`RUN_COMPLETED (${runId ?? 'unknown run'}, ${done.at}) without any ${ACCEPTANCE_TASK} integration`);
      continue;
    }
    if (!reviewTrailOk(events, ACCEPTANCE_TASK, ts(acceptance))
      && !reopenExistsAfter(events, ts(done))) {
      v.push(`completed run ${runId} has an unreviewed acceptance integration and no authorized reopen — child-green must not stand as parent pass`);
    }
  }
  return { ok: v.length === 0, violations: v };
}

// (3b) parent re-validation instrument: the regenerated four-layer index -----
const LAYERS = ['component_pass', 'env_qualification', 'same_run_finality'];
const DENOMINATORS = { scenarios: 92, requiredChecks: 118 };
function checkParentInstrument(index) {
  const v = [];
  if (index.schema_version !== 2) v.push(`index schema_version ${index.schema_version} != 2 (regenerated four-layer index required)`);
  const scenarios = index.scenarios ?? {};
  const ids = Object.keys(scenarios);
  if (ids.length !== DENOMINATORS.scenarios) {
    v.push(`index holds ${ids.length} scenarios, denominator is ${DENOMINATORS.scenarios}`);
  }
  const checks = Object.keys(index.required_checks ?? {});
  if (checks.length !== DENOMINATORS.requiredChecks) {
    v.push(`index holds ${checks.length} required checks, denominator is ${DENOMINATORS.requiredChecks}`);
  }
  // status vocabulary comes from the index's own status_rule keys — the
  // artifact adjudicates itself; hand-edited statuses fall outside it.
  const vocab = new Set(Object.keys(index.status_rule ?? {}));
  if (vocab.size === 0) v.push('index.status_rule missing — no self-adjudicating vocabulary');
  for (const [id, entry] of Object.entries(scenarios)) {
    for (const layer of LAYERS) {
      const l = entry?.[layer];
      if (!l || typeof l !== 'object') { v.push(`${id}: layer ${layer} missing`); continue; }
      if (!vocab.has(l.status)) v.push(`${id}/${layer}: status "${l.status}" outside status_rule vocabulary`);
    }
    if (!vocab.has(entry.deployment_status)) v.push(`${id}/deployment_status: "${entry.deployment_status}" outside status_rule vocabulary`);
    if (!vocab.has(entry.scenario_status)) v.push(`${id}/scenario_status: "${entry.scenario_status}" outside status_rule vocabulary`);
  }
  // summary must be consistent with the scenarios it summarizes
  const summary = index.summary ?? {};
  if (summary.scenarios !== ids.length) v.push(`summary.scenarios ${summary.scenarios} != scenario count ${ids.length}`);
  for (const layer of LAYERS) {
    const counted = {};
    for (const entry of Object.values(scenarios)) {
      const s = entry?.[layer]?.status;
      if (s) counted[s] = (counted[s] ?? 0) + 1;
    }
    const declared = summary.layer_statuses?.[layer] ?? {};
    for (const [status, n] of Object.entries(declared)) {
      if (counted[status] !== n) v.push(`summary.layer_statuses.${layer}.${status}=${n} but scenarios hold ${counted[status] ?? 0}`);
    }
    const declaredTotal = Object.values(declared).reduce((a, b) => a + b, 0);
    if (declaredTotal !== ids.length) v.push(`summary.layer_statuses.${layer} totals ${declaredTotal} != ${ids.length}`);
  }
  // the completion judge must exist and be coherent
  const rw = index.rw_completion ?? {};
  if (rw.rule !== 'RW_COMPLETION_REQUIRED') v.push(`rw_completion.rule "${rw.rule}" != RW_COMPLETION_REQUIRED`);
  if (typeof rw.complete !== 'boolean') v.push('rw_completion.complete is not a boolean');
  for (const [k, n] of Object.entries(rw.blocking ?? {})) {
    if (typeof n !== 'number' || n < 0) v.push(`rw_completion.blocking.${k} is not a non-negative number`);
  }
  return { ok: v.length === 0, violations: v };
}
function indexPointersResolve(index, root) {
  const v = [];
  const sha = /^[0-9a-f]{7,40}$/;
  for (const [id, entry] of Object.entries(index.scenarios ?? {})) {
    for (const layer of LAYERS) {
      const evs = entry?.[layer]?.evidence ?? [];
      for (const ptr of (Array.isArray(evs) ? evs : [evs])) {
        const rel = String(ptr).split(' :: ')[0].trim();
        if (rel.startsWith('/') || rel.includes('..')) { v.push(`${id}: non-repo-relative pointer ${rel}`); continue; }
        const m = rel.match(/^commit:([0-9a-f]{7,40})$/);
        if (m) {
          const out = spawnSync('git', ['cat-file', '-t', m[1]], { cwd: root, encoding: 'utf8' });
          if (out.status !== 0 || !sha.test(m[1])) v.push(`${id}: commit locator does not resolve: ${m[1]}`);
          continue;
        }
        if (!fs.existsSync(path.join(root, rel))) v.push(`${id}: pointer does not resolve: ${rel}`);
      }
    }
  }
  return { ok: v.length === 0, violations: v };
}

// ------------------------------------------------------------------ matrix ---
const STATUS_ENUM = ['VERIFIED', 'SUPPORTED', 'UNSUPPORTED', 'UNVERIFIED'];
const MACHINE_STATUS_ENUM = [...STATUS_ENUM, 'NOT_ENABLED'];
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
// Machine-measured evidence roots: only the machine that produced them may
// cite them. A disabled host citing these is cross-machine inference.
const MACHINE_MEASURED_EVIDENCE_ROOTS = [
  'worker-reports/P5_1-rework/evidence/',
  'worker-reports/I02-rework/',
];
const ENABLEMENT_MARKER = '环境能力裁决';
const ENABLEMENT_LEDGER_TOKEN = 'env-capability-20261022';

function loadMatrix() {
  assert.ok(fs.existsSync(MATRIX), `matrix missing: team-host-matrix/matrix.json (GREEN artifact) — ${MATRIX}`);
  return JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
}
const pointerPath = (ptr) => String(ptr).split(' :: ')[0].trim();

function resolvesRel(root, rel) {
  if (path.isAbsolute(rel) || rel.includes('..')) return false;
  return fs.existsSync(path.join(root, rel));
}
function fileContains(root, rel, needle) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8').includes(needle); } catch { return false; }
}

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
  const byId = new Map(Object.entries(index.scenarios ?? {}));
  const f08 = byId.get('F08');
  if (!f08 || f08.scenario_status !== 'UNVERIFIED') {
    v.push('acceptance-index F08 scenario_status must stay UNVERIFIED (native positive not executed)');
  }
  const browser = matrix.cells.filter((c) => c.capability === 'browser-evidence');
  if (browser.some((c) => c.status !== 'UNVERIFIED' || !c.holder)) {
    v.push('browser-evidence cells must stay UNVERIFIED with holder (no native-browser pilot in this environment)');
  }
  const ccDiscovery = matrix.cells.find((c) => c.host === 'claude-code' && c.capability === 'discovery');
  if (ccDiscovery && ['UNSUPPORTED', 'UNVERIFIED'].includes(ccDiscovery.status)) {
    v.push('claude-code discovery contradicts acceptance-index F03 mechanism delivery');
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

// ------------------------------------------------------------ machine gate ---
function machinePointersOf(host) {
  const ptrs = [];
  for (const p of host.discovery?.evidence ?? []) ptrs.push(p);
  for (const cap of Object.values(host.capabilities ?? {})) for (const p of cap.evidence ?? []) ptrs.push(p);
  for (const ch of Object.values(host.write_protection?.channels ?? {})) for (const p of ch.evidence ?? []) ptrs.push(p);
  if (host.recovery?.evidence) for (const p of host.recovery.evidence) ptrs.push(p);
  return ptrs;
}
function checkMachineDimension(matrix, root) {
  const v = [];
  const md = matrix.machine_dimension;
  if (!md || typeof md !== 'object') return { ok: false, violations: ['matrix.machine_dimension missing — per-machine hosts, enablement gate and refusal semantics are required'] };
  const hosts = md.hosts;
  if (!Array.isArray(hosts) || hosts.length < 2) {
    v.push('machine_dimension.hosts must list at least one concrete host plus the default-deny wildcard');
  }
  const wildcards = hosts.filter((h) => h.kind === 'default-deny-wildcard');
  if (wildcards.length !== 1 || wildcards[0].host !== '*') {
    v.push('machine_dimension must carry exactly one default-deny wildcard host "*" (never-enabled default)');
  }
  if (hosts.filter((h) => h.kind !== 'default-deny-wildcard').length < 1) v.push('no concrete machine host measured');
  for (const h of hosts) {
    const id = h.host;
    if (typeof h.enabled !== 'boolean') v.push(`${id}: enabled gate field missing/not boolean`);
    // discovery fields: every host must say HOW it was identified
    if (!h.discovery || typeof h.discovery !== 'object') { v.push(`${id}: discovery fields missing`); continue; }
    if (!h.discovery.anchor && h.kind !== 'default-deny-wildcard') v.push(`${id}: discovery.anchor missing (identity not anchored in a real command)`);
    for (const ptr of h.discovery.evidence ?? []) {
      if (!resolvesRel(root, pointerPath(ptr))) v.push(`${id}: discovery evidence does not resolve: ${ptr}`);
    }
    if (h.enabled) {
      // enablement gate: TRUE requires a resolvable adjudication record
      const rec = h.enablement?.decision_record;
      if (!rec) { v.push(`${id}: enabled without enablement.decision_record`); continue; }
      const rel = pointerPath(rec);
      if (!resolvesRel(root, rel)) v.push(`${id}: enablement decision record does not resolve: ${rel}`);
      else if (!fileContains(root, rel, ENABLEMENT_MARKER)) v.push(`${id}: decision record lacks the adjudication marker (${ENABLEMENT_MARKER}): ${rel}`);
      const led = h.enablement?.ledger;
      if (!led || !pointerPath(led).endsWith('execution-ledger.jsonl')) v.push(`${id}: enablement ledger event pointer missing`);
      else if (!fileContains(root, pointerPath(led), ENABLEMENT_LEDGER_TOKEN)) v.push(`${id}: ledger lacks enablement token ${ENABLEMENT_LEDGER_TOKEN}`);
      if (!h.enablement?.scope) v.push(`${id}: enablement.scope missing (scope of the granted enablement must be stated)`);
    } else {
      // refusal semantics: before enablement, refuse start AND refuse release
      const r = h.refusals ?? {};
      for (const key of ['refuse_start', 'refuse_release']) {
        const x = r[key];
        if (!x || typeof x !== 'object') { v.push(`${id}: ${key} refusal semantics missing`); continue; }
        if (x.status !== 'NOT_ENABLED') v.push(`${id}: ${key}.status must be NOT_ENABLED, got "${x.status}"`);
        if (!x.semantics) v.push(`${id}: ${key}.semantics missing`);
      }
    }
    // capability cells: status vocabulary + measured evidence pointers
    for (const [cap, cell] of Object.entries(h.capabilities ?? {})) {
      if (!MACHINE_STATUS_ENUM.includes(cell.status)) v.push(`${id}/${cap}: machine status "${cell.status}" outside enum`);
      const evs = cell.evidence ?? [];
      if (h.kind !== 'default-deny-wildcard' && evs.length === 0) v.push(`${id}/${cap}: no measured evidence pointers`);
      for (const ptr of evs) {
        if (!resolvesRel(root, pointerPath(ptr))) v.push(`${id}/${cap}: evidence pointer does not resolve: ${ptr}`);
      }
      if (cell.status === 'UNVERIFIED' && !cell.holder && h.kind !== 'default-deny-wildcard') {
        v.push(`${id}/${cap}: UNVERIFIED without holder`);
      }
    }
    // write protection measured per channel; a gap is a gap, never "blocked"
    for (const [ch, cell] of Object.entries(h.write_protection?.channels ?? {})) {
      if (!cell.outcome) v.push(`${id}/write-protection/${ch}: outcome missing`);
      for (const ptr of cell.evidence ?? []) {
        if (!resolvesRel(root, pointerPath(ptr))) v.push(`${id}/write-protection/${ch}: evidence pointer does not resolve: ${ptr}`);
      }
    }
  }
  return { ok: v.length === 0, violations: v };
}
function checkMachineNoInference(matrix) {
  const v = [];
  const md = matrix.machine_dimension;
  if (!md) return { ok: false, violations: ['machine_dimension missing'] };
  const disabled = md.hosts.filter((h) => !h.enabled);
  for (const h of disabled) {
    for (const ptr of machinePointersOf(h)) {
      const rel = pointerPath(ptr);
      for (const root of MACHINE_MEASURED_EVIDENCE_ROOTS) {
        if (rel === root || rel.startsWith(root)) {
          v.push(`${h.host}: cites machine-measured evidence of an enabled host (${root}) — cross-machine inference: ${rel}`);
        }
      }
    }
    // a disabled host must not claim support by naming another host's channel
    for (const [cap, cell] of Object.entries(h.capabilities ?? {})) {
      if (cell.via_host) v.push(`${h.host}/${cap}: capability derived via_host ${cell.via_host} — cross-machine inference`);
    }
  }
  if (md.hosts.some((h) => h.enabled) && disabled.length === 0) {
    v.push('no disabled host entries: without a default-deny wildcard the matrix implies every machine is enabled');
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
function loadIndex() {
  return JSON.parse(fs.readFileSync(ACCEPTANCE_INDEX, 'utf8'));
}

// ------------------------------------------------------------------- 5.1.a ---
test('5.1.a-1 parallel isolation: real ledger dispatches + live worktree set', () => {
  const res = checkIsolation({ events: loadLedger(), worktrees: liveWorktrees() });
  assert.deepStrictEqual(res.violations, [], `isolation violations: ${res.violations.join('; ')}`);
});

test('5.1.a-2 serial integration: review-before-integrate, ordered merges, acceptance-integration rule', () => {
  const res = checkSerialIntegration(loadLedger());
  assert.deepStrictEqual(res.violations, [], `integration violations: ${res.violations.join('; ')}`);
});

test('5.1.a-3 parent re-validation: child green never closes the parent goal (task and run granularity)', () => {
  const res = checkParentRevalidation(loadLedger());
  assert.deepStrictEqual(res.violations, [], `parent-revalidation violations: ${res.violations.join('; ')}`);
});

test('5.1.a-4 parent re-validation instrument: four-layer index consistent, denominators held, pointers resolve', () => {
  const index = loadIndex();
  const res = checkParentInstrument(index);
  assert.deepStrictEqual(res.violations, [], `instrument violations: ${res.violations.join('; ')}`);
  const res2 = indexPointersResolve(index, projectRoot);
  assert.deepStrictEqual(res2.violations, [], `instrument pointer violations: ${res2.violations.join('; ')}`);
});

test('5.1.a negatives: forged isolation / child-green-as-parent-pass / integrate-before-review / unclosable run are rejected', () => {
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
  const n3 = checkSerialIntegration([...real, early]);
  assert.equal(n3.ok, false, 'integrate-before-review must be rejected');
  assert.ok(n3.violations.some((x) => x.includes('X9')), n3.violations.join('; '));

  // N4: a completed green run with NO reopen chain (the prior run's completion
  // without the authorized replan) must be rejected — run-level
  // child-green-as-parent-pass.
  const noReopen = real.filter((e) => !REOPEN_KINDS.includes(e.kind));
  const n4 = checkParentRevalidation(noReopen);
  assert.equal(n4.ok, false, 'completed run without reopen must be rejected');
  assert.ok(
    n4.violations.some((x) => x.includes('unreviewed acceptance integration and no authorized reopen')),
    n4.violations.join('; '),
  );

  // N5: a fresh acceptance integration in the live run with neither review
  // trail nor reopen must be rejected at integration time, not after
  // completion.
  const forgedAcceptance = {
    kind: 'TASK_INTEGRATED', task: 'VERIFY', run_id: 'rework-seven-p1-r1',
    at: '2026-10-23T00:00:00.000000+00:00', merge: 'dead00a (--no-ff)',
  };
  const n5 = checkSerialIntegration([...real, forgedAcceptance]);
  assert.equal(n5.ok, false, 'unreviewed acceptance integration without reopen must be rejected');
  assert.ok(
    n5.violations.some((x) => x.includes('neither a review trail nor a following reopen')),
    n5.violations.join('; '),
  );
});

// ------------------------------------------------------------------- 5.1.b ---
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
  const index = loadIndex();
  const res = checkAcceptanceIndexConsistency(loadMatrix(), index);
  assert.deepStrictEqual(res.violations, [], `index-consistency violations: ${res.violations.join('; ')}`);
});

test('5.1.b-6 machine dimension: discovery anchors, enablement gate, refusal semantics, measured evidence', () => {
  const res = checkMachineDimension(loadMatrix(), projectRoot);
  assert.deepStrictEqual(res.violations, [], `machine-dimension violations: ${res.violations.join('; ')}`);
});

test('5.1.b-7 no cross-machine inference: disabled hosts never cite enabled-host measured evidence', () => {
  const res = checkMachineNoInference(loadMatrix());
  assert.deepStrictEqual(res.violations, [], `cross-machine violations: ${res.violations.join('; ')}`);
});

test('5.1.b platform negatives: cross-host cell / missing cell / holderless UNVERIFIED are rejected', () => {
  const matrix = loadMatrix();
  // N6: a comet cell citing llmwiki's adapter is cross-platform inference.
  const forged = structuredClone(matrix);
  const cometCell = forged.cells.find((c) => c.host === 'comet-classic' && c.capability === 'discovery');
  cometCell.evidence.push('lib/adapters/llmwiki.js :: llmwiki supports discovery so comet should too');
  const n6 = checkNoCrossHostEvidence(forged);
  assert.equal(n6.ok, false, 'cross-host evidence must be rejected');
  assert.ok(n6.violations.some((x) => x.includes('llmwiki-specific')), n6.violations.join('; '));

  // N7: a removed cell leaves a hole.
  const holed = structuredClone(matrix);
  holed.cells = holed.cells.filter((c) => !(c.host === 'outline' && c.capability === 'browser-evidence'));
  const n7 = checkCompleteness(holed);
  assert.equal(n7.ok, false, 'missing cell must be rejected');
  assert.ok(n7.violations.some((x) => x.includes('missing cell')), n7.violations.join('; '));

  // N8: UNVERIFIED without a holder hides who owns the gap.
  const holderless = structuredClone(matrix);
  const unv = holderless.cells.find((c) => c.status === 'UNVERIFIED' && c.holder);
  delete unv.holder;
  const n8 = checkStatusObligations(holderless);
  assert.equal(n8.ok, false, 'holderless UNVERIFIED must be rejected');
  assert.ok(n8.violations.some((x) => x.includes('without holder')), n8.violations.join('; '));
});

test('5.1.b machine negatives: unrecorded enable / stripped refusals / claimed capability / cited evidence are rejected', () => {
  const matrix = loadMatrix();
  // M1: flipping the wildcard host to enabled without any decision record must
  // be rejected — enablement is never implied.
  const m1 = structuredClone(matrix);
  m1.machine_dimension.hosts.find((h) => h.host === '*').enabled = true;
  const r1 = checkMachineDimension(m1, projectRoot);
  assert.equal(r1.ok, false, 'wildcard enabled without decision record must be rejected');
  assert.ok(r1.violations.some((x) => x.includes('enabled without enablement.decision_record')), r1.violations.join('; '));

  // M2: stripping refusal semantics from a disabled host must be rejected.
  const m2 = structuredClone(matrix);
  const wild = m2.machine_dimension.hosts.find((h) => h.host === '*');
  delete wild.refusals.refuse_release;
  const r2 = checkMachineDimension(m2, projectRoot);
  assert.equal(r2.ok, false, 'disabled host without refuse_release must be rejected');
  assert.ok(r2.violations.some((x) => x.includes('refuse_release refusal semantics missing')), r2.violations.join('; '));

  // M3: a disabled host claiming a capability (A10/A11/A12 family) must be
  // rejected — not-enabled is never support, never PASS.
  const m3 = structuredClone(matrix);
  const wild3 = m3.machine_dimension.hosts.find((h) => h.host === '*');
  wild3.capabilities['a11-cross-machine-recovery'].status = 'SUPPORTED';
  const r3 = checkMachineDimension(m3, projectRoot);
  assert.equal(r3.ok, false, 'disabled host claiming a capability must be rejected');
  assert.ok(
    r3.violations.some((x) => x.includes('machine status "SUPPORTED" outside enum')),
    r3.violations.join('; '),
  );

  // M4: a disabled host citing this machine's measured evidence is
  // cross-machine inference and must be rejected.
  const m4 = structuredClone(matrix);
  const wild4 = m4.machine_dimension.hosts.find((h) => h.host === '*');
  wild4.discovery.evidence.push('worker-reports/P5_1-rework/evidence/host-probes-20261023.txt :: inferred from the run host');
  const r4 = checkMachineNoInference(m4);
  assert.equal(r4.ok, false, 'disabled host citing enabled-host measured evidence must be rejected');
  assert.ok(r4.violations.some((x) => x.includes('cross-machine inference')), r4.violations.join('; '));

  // M5: an enabled host whose decision record was swapped out must be
  // rejected — the gate reads the real adjudication, not the flag alone.
  const m5 = structuredClone(matrix);
  const concrete = m5.machine_dimension.hosts.find((h) => h.kind !== 'default-deny-wildcard');
  concrete.enablement.decision_record = 'openspec/changes/delivery-foundation-rearchitecture/proposal.md :: not an adjudication';
  const r5 = checkMachineDimension(m5, projectRoot);
  assert.equal(r5.ok, false, 'enablement flag without the real adjudication content must be rejected');
  assert.ok(r5.violations.some((x) => x.includes(ENABLEMENT_MARKER)), r5.violations.join('; '));
});
