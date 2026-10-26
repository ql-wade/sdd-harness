// P2_4-r3 minimal live driver: three blocker legs on ONE real composition Run
// (plus a throwaway null-isolation start micro-negative). Every step is a
// REAL `comet runtime dispatch`; the start/evidence requests come from the
// repo adapter constructors (lib/adapters/comet.js) — live use, not a copy.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const WORLD = fs.readFileSync('/tmp/p24r3-world-path.txt', 'utf8').trim();
const PROJ = path.join(WORLD, 'project');
const CHANGE = 'p24r3-live';
const CR = `openspec/changes/${CHANGE}`;
const REPO = '/Users/mac/Code/sdd-harness';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const { classicCompositionStartRequest, classicCompositionRecordEvidenceRequest } = await import(path.join(REPO, 'lib/adapters/comet.js'));
// the OFFICIAL plan receipt algorithm (pinned build) — same source the runtime uses
const { classicPlanEvidenceReceipt } = await import('/Users/mac/Code/sdd-harness/.sdd/vendor/comet/aeb1a6598034e28ce46b8422d4dbd8785e607bd7/builds/de39629a80fb32f16f3fa12515523988d775f957a62e16941542438c3b61908a/work/dist/domains/comet-classic/classic-sdk-application.js');

let SEQ = 0;
function dispatch(op, extra = {}) {
  const req = path.join(WORLD, `req-${Date.now()}-${SEQ++}.json`);
  fs.writeFileSync(req, JSON.stringify({ operation: op, runId: CHANGE, ...extra }, null, 1));
  const res = spawnSync(path.join(WORLD, 'run.sh'), ['--request', req, '--json'], { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  const raw = res.stdout ?? '';
  let d;
  try { d = JSON.parse(raw.slice(raw.indexOf('{'))); } catch { throw new Error(`${op} non-JSON: ${raw.slice(0, 300)} ${res.stderr}`); }
  return d;
}
const ok = (d) => d.status === 'succeeded';
const must = (d, op) => { if (!ok(d)) throw new Error(`${op} FAILED: ${JSON.stringify(d.error ?? {}).slice(0, 600)}`); return d.data; };
const cur = (d) => d.current ?? d;
const act = (d, step) => { const a = (cur(d).actions ?? []).find(x => x.stepId === step); if (!a) throw new Error(`no ${step}: ${JSON.stringify((cur(d).actions ?? []).map(x => [x.stepId, x.status]))}`); return a; };
const wait = (d, step) => (cur(d).waits ?? []).find(w => w.stepId === step && w.status === 'pending');
const evwait = (d, step) => (cur(d).evidenceWaits ?? []).find(e => e.stepId === step && e.status === 'pending');
function claimRecord(d, step, output, oid) {
  const cr = act(d, step).claimRequest;
  d = must(dispatch('claim', { expectedRevision: cr.expectedRevision, actionId: cr.actionId, attempt: cr.attempt, inputHash: cr.inputHash, executorId: cr.executorId, sessionId: 'p24r3-live-host-session', capabilities: ['skill-host'] }), 'claim:' + step);
  const a = act(d, step);
  return must(dispatch('record-outcome', { expectedRevision: a.outcomeRequest.expectedRevision, outcome: { actionId: a.id, attempt: a.attempt, inputHash: a.inputHash, claimToken: a.claim.token, outcomeId: oid, status: 'succeeded', output } }), 'record:' + step);
}
function claimOnly(d, step) {
  const cr = act(d, step).claimRequest;
  return must(dispatch('claim', { expectedRevision: cr.expectedRevision, actionId: cr.actionId, attempt: cr.attempt, inputHash: cr.inputHash, executorId: cr.executorId, sessionId: 'p24r3-live-host-session', capabilities: ['skill-host'] }), 'claim:' + step);
}
function rawDispatch(requestBody) {
  const req = path.join(WORLD, `req-raw-${Date.now()}-${SEQ++}.json`);
  fs.writeFileSync(req, JSON.stringify(requestBody, null, 1));
  const res = spawnSync(path.join(WORLD, 'run.sh'), ['--request', req, '--json'], { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  const raw = res.stdout ?? '';
  return JSON.parse(raw.slice(raw.indexOf('{')));
}
const resolveW = (d, step, choice, id) => { const w = wait(d, step); if (!w) throw new Error(`no wait ${step}`); return must(dispatch('resolve-wait', { expectedRevision: d.revision, waitId: w.id, proposalHash: w.proposalHash, decisionId: id, choice }), 'resolve:' + step); };
function openReceipt() {
  const files = ['proposal.md', 'design.md', 'tasks.md'].map(n => `${CR}/${n}`).sort().map(rel => [rel, sha256(fs.readFileSync(path.join(PROJ, rel)))]);
  return { ref: CR, contentHash: sha256(JSON.stringify(files)) };
}
const taskReqs = (src) => src.split(/(?<=\n)/).map(l => l.replace(/^(\s*[-*]\s+\[)[ xX](\])/u, '$1 $2')).join('');
function handoffPack() {
  const dir = path.join(PROJ, CR);
  const sources = ['proposal.md', 'design.md', 'tasks.md'].map(n => { const c = fs.readFileSync(path.join(dir, n), 'utf8'); return { reference: `${CR}/${n}`, content: c, sha256: n === 'tasks.md' ? sha256(taskReqs(c)) : sha256(c) }; });
  const handoffHash = sha256(sources.flatMap(s => [`path:${s.reference}`, `sha256:${s.sha256}`]).join('\n'));
  const lc = (c) => (c.match(/\n/g) ?? []).length;
  const md = ['# Comet Design Handoff', '', `- Change: ${CHANGE}`, '- Phase: design', '- Mode: compact', `- Context hash: ${handoffHash}`, '', 'Generated-by: comet-handoff.sh', 'Task hash policy: task-content-v1.', '', 'OpenSpec remains the canonical capability spec.', ''];
  for (const s of sources) { const t = lc(s.content); md.push(`## ${s.reference}`, '', `- Source: ${s.reference}`, `- Lines: 1-${t}`, `- SHA256: ${s.sha256}`, ''); if (t <= 80) md.push('```md', s.content, '```'); else md.push('[TRUNCATED]', '', '```md', s.content.split(/(?<=\n)/).slice(0, 80).join(''), '```', '', `Full source: ${s.reference}`); md.push(''); }
  fs.mkdirSync(path.join(dir, '.comet/handoff'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.comet/handoff/design-context.md'), md.join('\n'));
  const esc = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  fs.writeFileSync(path.join(dir, '.comet/handoff/design-context.json'), ['{', `  "change": "${esc(CHANGE)}",`, '  "phase": "design",', '  "mode": "compact",', '  "canonical_spec": "openspec",', '  "task_hash_policy": "task-content-v1",', '  "generated_by": "comet-handoff.sh",', `  "context_hash": "${handoffHash}",`, '  "files": [', sources.map(s => `    { "path": "${esc(s.reference)}", "sha256": "${s.sha256}" }`).join(',\n'), '  ]', '}', ''].join('\n'));
  const raw = (rel) => sha256(fs.readFileSync(path.join(PROJ, rel), 'utf8'));
  const fullE = ['proposal.md', 'design.md', 'tasks.md'].map(n => `${CR}/${n}`).sort().map(rel => [rel, raw(rel)]);
  const reqE = [`${CR}/proposal.md`, `${CR}/tasks.md`].sort().map(rel => [rel, rel.endsWith('tasks.md') ? sha256(taskReqs(fs.readFileSync(path.join(PROJ, rel), 'utf8'))) : raw(rel)]);
  return { output: { proposal: 'Design proposal: three blocker legs on one composition Run; managed start isolation current; epoch-qualified evidence ids; content-address-stable gate bundles.', handoffContext: `${CR}/.comet/handoff/design-context.json`, handoffHash, sourceEvidence: { ref: CR, contentHash: sha256(JSON.stringify(fullE)) }, requirementsEvidence: { ref: CR, contentHash: sha256(JSON.stringify(reqE)) } } };
}
function gateOutput(gate, activation, divergeNote) {
  const file = path.join(WORLD, `activation-${gate}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(activation, null, 1));
  const res = spawnSync('/Users/mac/.nvm/versions/node/v24.15.0/bin/node', [path.join(WORLD, 'gate-builder.mjs'), PROJ, gate, file, divergeNote ?? ''], { cwd: PROJ, encoding: 'utf8', timeout: 120_000 });
  if (res.status !== 0) throw new Error(`gate ${gate} builder failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// ============ LEG 0 — B-① negative micro: null isolation STARTS silently ====
const nullStart = rawDispatch({
  operation: 'start', runId: 'p24r3-null-probe',
  workflow: { id: 'comet-classic-full', version: '1' },
  input: { change: 'p24r3-null-probe', changeDir: 'openspec/changes/p24r3-null-probe' },
  initialState: {
    workflow: 'full', language: 'en', phase: 'open', contextCompression: 'off',
    buildMode: null, buildPause: null, subagentDispatch: null, tddMode: null,
    reviewMode: 'standard', isolation: null, boundBranch: null, verifyMode: null,
    autoTransition: true, baseRef: null, designDoc: null, plan: null,
    verifyResult: 'pending', verifyFailures: 0, verificationReport: null,
    branchStatus: 'pending', createdAt: '2026-10-27', verifiedAt: null,
    archiveConfirmation: null, archived: false, directOverride: null,
    handoffContext: null, handoffHash: null, classicProfile: 'full', classicMigration: 1,
  },
});
fs.writeFileSync(path.join(WORLD, 'leg-b1-null-start.json'), JSON.stringify({ status: nullStart.status }, null, 1));
console.log('B1-NEG null-isolation start status:', nullStart.status, '(schema-legal => the deadlock is silent at start; frozen P3_2 Run#1 + pristine three-sided proof cover the unpassable configure)');

// ============ LEG 1 — B-① positive: adapter start → past configure ==========
const BASE_REF = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: PROJ, encoding: 'utf8' }).stdout.trim();
const startRequest = classicCompositionStartRequest({ change: CHANGE, changeDir: CR, workflowId: 'comet-classic-full', workflowVersion: '1', baseRef: BASE_REF, createdAt: '2026-10-27' });
fs.writeFileSync(path.join(WORLD, 'leg-b1-start-request.json'), JSON.stringify(startRequest, null, 1));
const preInspect = rawDispatch({ operation: 'inspect', runId: CHANGE });
if (preInspect.status === 'succeeded') {
  console.log('B1 run already exists (idempotent resume), revision', preInspect.data.revision);
} else {
  const started = rawDispatch(structuredClone(startRequest));
  must(started, 'start');
  console.log('B1 start via adapter request: status', started.status);
}
let d = dispatch('inspect');
for (let attempt = 0; d.status !== 'succeeded' && attempt < 4; attempt += 1) {
  must(rawDispatch({ operation: 'next', runId: CHANGE }), `recovery-next-${attempt}`);
  d = dispatch('inspect');
}
d = must(d, 'inspect:initial');
console.log('B1 run state via inspect: isolation', d.state.isolation, '| entry action', (d.current.actions ?? [])[0]?.stepId);

function drivePrefix(d, epoch) {
  const tag = `e${epoch}`;
  const rev = (cur(d).actions ?? []).find(x => x.stepId === 'classic.composition.revise');
  if (rev) {
    d = must(dispatch('execute', { expectedRevision: rev.executeRequests[0].expectedRevision, actionId: rev.id, executorId: rev.executeRequests[0].executorId }), 'revise-execute');
    d = must(dispatch('inspect'), 'inspect');
  }
  const prep = (cur(d).actions ?? []).find(x => x.stepId === 'classic.composition.prepare');
  if (prep) {
    d = must(dispatch('execute', { expectedRevision: prep.executeRequests[0].expectedRevision, actionId: prep.id, executorId: prep.executeRequests[0].executorId }), 'prepare');
    d = resolveW(d, 'classic.composition.confirm', 'approved', `p24r3-${tag}-mandate`);
    d = must(dispatch('inspect'), 'inspect');
  }
  if ((cur(d).actions ?? []).some(x => x.stepId === 'full.open'))
    d = claimRecord(d, 'full.open', { event: 'open-complete', change: CHANGE, artifacts: [`${CR}/proposal.md`, `${CR}/tasks.md`], confirmed: { goal: 'clear the three pilot blockers on this Run', scope: ['run mechanics'], acceptanceCriteria: ['B1', 'B2', 'B3'], nonGoals: ['gate semantic sufficiency'] }, grill: { skill: 'grill-me', contentHash: sha256('p24r3-grill-record'), questionsResolved: 6, record: `${CR}/proposal.md#grill-record` } }, `open-${tag}`);
  const rec = openReceipt();
  let e = evwait(d, 'full.open.evidence');
  if (e) {
    const evidenceReq = classicCompositionRecordEvidenceRequest({ change: CHANGE, expectedRevision: e.recordRequest.expectedRevision, evidenceId: e.id, kind: e.kind, ref: rec.ref, contentHash: rec.contentHash, checkEpoch: Number.isInteger(d.state?.checkEpoch) ? d.state.checkEpoch : epoch });
    d = must(rawDispatch(structuredClone(evidenceReq)), 'open-evidence:' + tag);
    d = must(dispatch('inspect'), 'inspect');
  }
  if ((cur(d).actions ?? []).some(x => x.stepId === 'classic.extension.requirements-open')) {
    const ra = act(d, 'classic.extension.requirements-open');
    const built = gateOutput('R', ra.input.activation);
    d = claimRecord(d, 'classic.extension.requirements-open', built.output, `r-gate-${tag}`);
  }
  { const w = wait(d, 'full.open.confirm'); if (w) { d = resolveW(d, 'full.open.confirm', 'approved', `p24r3-${tag}-open-approved`); d = must(dispatch('inspect'), 'inspect'); } }
  { const a2 = (cur(d).actions ?? []).find(x => x.stepId === 'full.open.revalidate'); if (a2) { d = must(dispatch('execute', { expectedRevision: a2.executeRequests[0].expectedRevision, actionId: a2.id, executorId: a2.executeRequests[0].executorId }), 'revalidate'); d = must(dispatch('inspect'), 'inspect'); } }
  if ((cur(d).actions ?? []).some(x => x.stepId === 'full.design.handoff'))
    d = claimRecord(d, 'full.design.handoff', handoffPack().output, `design-handoff-${tag}`);
  { const w = wait(d, 'full.design.confirm'); if (w) { d = resolveW(d, 'full.design.confirm', 'approved', `p24r3-${tag}-design-approved`); d = must(dispatch('inspect'), 'inspect'); } }
  if ((cur(d).actions ?? []).some(x => x.stepId === 'full.design.document'))
    d = claimRecord(d, 'full.design.document', { designDoc: `${CR}/design.md` }, `design-document-${tag}`);
  { const e2 = evwait(d, 'full.design.evidence'); if (e2) {
      const evidenceReq = classicCompositionRecordEvidenceRequest({ change: CHANGE, expectedRevision: e2.recordRequest.expectedRevision, evidenceId: e2.id, kind: e2.kind, ref: `${CR}/design.md`, contentHash: sha256(fs.readFileSync(path.join(PROJ, CR, 'design.md'))), checkEpoch: Number.isInteger(d.state?.checkEpoch) ? d.state.checkEpoch : epoch });
      d = must(rawDispatch(structuredClone(evidenceReq)), 'design-evidence:' + tag);
      d = must(dispatch('inspect'), 'inspect');
  } }
  for (const [gate, step] of [['A', 'classic.extension.architecture-consensus'], ['T', 'classic.extension.test-design-review']]) {
    if ((cur(d).actions ?? []).some(x => x.stepId === step)) {
      const ga = act(d, step);
      const built = gateOutput(gate, ga.input.activation);
      d = claimRecord(d, step, built.output, `${gate.toLowerCase()}-gate-${tag}`);
    }
  }
  return d;
}
async function driveConfigurePlan(d, epoch, stopBeforePlanEvidence = false) {
  const tag = `e${epoch}`;
  d = must(dispatch('inspect'), 'inspect:configure');
  const configureOutput = (st) => ({ buildMode: 'executing-plans', tddMode: 'tdd', reviewMode: 'standard', isolation: st.isolation, boundBranch: st.boundBranch, subagentDispatch: null, directOverride: false });
  const cfgPending = (cur(d).actions ?? []).find(x => x.stepId === 'full.build.configure' && x.status === 'pending');
  const cfgRunning = (cur(d).actions ?? []).find(x => x.stepId === 'full.build.configure' && x.status === 'running');
  if (cfgPending) {
    d = claimRecord(d, 'full.build.configure', configureOutput(d.state ?? {}), `build-configure-${tag}`);
  } else if (cfgRunning) {
    d = must(dispatch('record-outcome', { expectedRevision: cfgRunning.outcomeRequest.expectedRevision, outcome: { actionId: cfgRunning.id, attempt: cfgRunning.attempt, inputHash: cfgRunning.inputHash, claimToken: cfgRunning.claim.token, outcomeId: `build-configure-${tag}-r`, status: 'succeeded', output: configureOutput(d.state ?? {}) } }), 'record:configure-running');
  }
  { const w = wait(d, 'full.build.confirm'); if (w) { d = resolveW(d, 'full.build.confirm', 'approved', `p24r3-${tag}-build-approved`); d = must(dispatch('inspect'), 'inspect'); } }
  console.log(`configure PASSED at epoch ${epoch}: phase=${d.state.phase} checkEpoch=${d.state.checkEpoch} isolation=${d.state.isolation} buildMode=${d.state.buildMode} tddMode=${d.state.tddMode} next=${JSON.stringify((cur(d).actions ?? []).map(x => [x.stepId, x.status]))}`);
  if ((cur(d).actions ?? []).some(x => x.stepId === 'full.build.plan' && x.status === 'pending'))
    d = claimRecord(d, 'full.build.plan', { plan: 'docs/superpowers/plans/p24r3-live.md', buildPause: 'plan-ready' }, `build-plan-${tag}`);
  if (stopBeforePlanEvidence) return d;
  let e = evwait(d, 'full.build.plan.evidence');
  if (e) {
    const planReceipt = await classicPlanEvidenceReceipt(PROJ, 'docs/superpowers/plans/p24r3-live.md', CR);
    const evidenceReq = classicCompositionRecordEvidenceRequest({ change: CHANGE, expectedRevision: e.recordRequest.expectedRevision, evidenceId: e.id, kind: e.kind, ref: planReceipt.ref, contentHash: planReceipt.contentHash, checkEpoch: Number.isInteger(d.state?.checkEpoch) ? d.state.checkEpoch : epoch });
    d = must(rawDispatch(structuredClone(evidenceReq)), 'plan-evidence:' + tag);
    d = must(dispatch('inspect'), 'inspect');
  }
  return d;
}
function pGateOutcome(d, divergeNote, oid) {
  const pa = act(d, 'classic.extension.build-plan-unique');
  const built = gateOutput('P', pa.input.activation, divergeNote);
  const outcome = { actionId: pa.id, attempt: pa.attempt, inputHash: pa.inputHash, claimToken: pa.claim.token, outcomeId: oid, status: 'succeeded', output: built.output };
  let res = dispatch('record-outcome', { expectedRevision: pa.outcomeRequest.expectedRevision, outcome });
  if (res.status !== 'succeeded' && String(res.error?.message ?? '').includes('REVISION_CONFLICT')) {
    // a refused attempt bumps the run revision; re-read and retry once with
    // the CURRENT outcomeRequest revision (same claim, same outcome)
    const fresh = must(dispatch('inspect'), 'inspect:p-retry');
    const fa = act(fresh, 'classic.extension.build-plan-unique');
    res = dispatch('record-outcome', { expectedRevision: fa.outcomeRequest.expectedRevision, outcome: { ...outcome, claimToken: fa.claim.token } });
  }
  return { res, built };
}
function planSubmissionIds() {
  const files = fs.readdirSync(WORLD).filter(f => f.startsWith('req-raw-')).sort().map(f => path.join(WORLD, f));
  const candidates = [];
  for (const f of files) { try { const body = JSON.parse(fs.readFileSync(f, 'utf8')); if (body.operation === 'record-evidence' && body.ref === 'docs/superpowers/plans/p24r3-live.md' && body.submissionId) candidates.push(body.submissionId); } catch {} }
  return candidates;
}

// ---------------- epoch 0: B-① leg (past configure) + P round-1 ----------------
const round1Done = () => fs.existsSync(path.join(WORLD, 'leg-b3-round1-hash.json'));
d = drivePrefix(d, 0);
d = await driveConfigurePlan(d, 0);
if (!round1Done() && (cur(d).actions ?? []).some(x => x.stepId === 'classic.extension.build-plan-unique')) {
  const pa = act(d, 'classic.extension.build-plan-unique');
  console.log('P epoch0 activation: checkEpoch', pa.input.activation.source.checkEpoch, '| submissionId', pa.input.activation.source.event.submissionId, '| sequence', pa.input.activation.source.sequence);
  const pending0 = (cur(d).actions ?? []).some(x => x.stepId === 'classic.extension.build-plan-unique' && x.status === 'pending');
  if (pending0) d = claimOnly(d, 'classic.extension.build-plan-unique');
  const { res, built } = pGateOutcome(d, null, 'p-gate-epoch0-pass');
  must(res, 'record:P-epoch0');
  const pHash = built.output.artifactHashes['.sdd/delivery/gates/p/receipt-bundle.json'];
  console.log('P epoch0 PASS accepted; canonical bundle hash', pHash.slice(0, 16));
  fs.writeFileSync(path.join(WORLD, 'leg-b3-round1-hash.json'), JSON.stringify({ epoch: 0, hash: pHash }, null, 1));
  d = must(dispatch('inspect'), 'inspect');
}
{ const w = wait(d, 'full.build.plan-ready'); if (w) { d = resolveW(d, 'full.build.plan-ready', 'continue', 'p24r3-plan-ready-e0'); d = must(dispatch('inspect'), 'inspect'); } }
console.log('EPOCH0 done: phase', d.state.phase, '| actions', JSON.stringify((cur(d).actions ?? []).map(x => [x.stepId, x.status])));
fs.writeFileSync(path.join(WORLD, 'leg-b1-past-configure.json'), JSON.stringify({ phase: d.state.phase, checkEpoch: d.state.checkEpoch, isolation: d.state.isolation, buildMode: d.state.buildMode, tddMode: d.state.tddMode, reviewMode: d.state.reviewMode, next: (cur(d).actions ?? []).map(x => x.stepId) }, null, 1));

// ---------------- epoch 1: revise → B-② positive + B-③ negative→positive ------
const epoch1Done = () => fs.existsSync(path.join(WORLD, 'leg-b3-stable-repass.json'));
if (!epoch1Done()) d = must(dispatch('dispatch-command', { expectedRevision: d.revision, commandId: 'p24r3-revise-1', name: 'revise-requirements', input: { reason: 'epoch-1 revise to re-arm the P gate for the B-②/B-③ legs' } }), 'revise-1');
d = must(dispatch('inspect'), 'inspect:post-revise-1');
if (!epoch1Done()) { d = must(dispatch('inspect'), 'inspect:post-revise-1'); console.log('revised: checkEpoch', d.state.checkEpoch); }
if (!epoch1Done()) d = drivePrefix(d, 1);
if (!epoch1Done()) d = await driveConfigurePlan(d, 1);
if (!epoch1Done()) {
  { // remember THIS epoch's plan-evidence submissionId for the epoch-2 collision leg
    const ids = planSubmissionIds();
    fs.writeFileSync(path.join(WORLD, 'leg-b2-epoch1-plan-id.json'), JSON.stringify({ id: ids[ids.length - 1] }, null, 1));
  }
  const pa = act(d, 'classic.extension.build-plan-unique');
  console.log('P epoch1 activation: checkEpoch', pa.input.activation.source.checkEpoch, '| submissionId', pa.input.activation.source.event.submissionId, '| sequence', pa.input.activation.source.sequence, '(fresh epoch-qualified => B2 positive binding)');
  const pending1 = (cur(d).actions ?? []).some(x => x.stepId === 'classic.extension.build-plan-unique' && x.status === 'pending');
  if (pending1) d = claimOnly(d, 'classic.extension.build-plan-unique');
  const neg = pGateOutcome(d, 'epoch-1-rebuild', 'p-gate-epoch1-diverging');
  fs.writeFileSync(path.join(WORLD, 'leg-b3-diverging-refusal.json'), JSON.stringify({ status: neg.res.status, error: neg.res.error }, null, 1));
  console.log('B3-NEG diverging rewrite:', neg.res.status, '|', (neg.res.error?.message ?? '').slice(0, 240));
  const pos = pGateOutcome(d, null, 'p-gate-epoch1-stable');
  must(pos.res, 'record:P-epoch1-stable');
  const stableHash = pos.built.output.artifactHashes['.sdd/delivery/gates/p/receipt-bundle.json'];
  const round1 = JSON.parse(fs.readFileSync(path.join(WORLD, 'leg-b3-round1-hash.json'), 'utf8'));
  console.log('B3-POS byte-stable re-pass ACCEPTED; hash', stableHash.slice(0, 16), '| identical to round-1:', stableHash === round1.hash);
  fs.writeFileSync(path.join(WORLD, 'leg-b3-stable-repass.json'), JSON.stringify({ epoch1Hash: stableHash, identicalToRound1: stableHash === round1.hash }, null, 1));
  d = must(dispatch('inspect'), 'inspect');
}
{ const w = wait(d, 'full.build.plan-ready'); if (w) { d = resolveW(d, 'full.build.plan-ready', 'continue', 'p24r3-plan-ready-e1'); d = must(dispatch('inspect'), 'inspect'); } }
console.log('EPOCH1 done: phase', d.state.phase, '| actions', JSON.stringify((cur(d).actions ?? []).map(x => [x.stepId, x.status])));

// ---------------- epoch 2: B-② negative — REUSED submissionId binds stale ------
const epoch2Done = () => fs.existsSync(path.join(WORLD, 'leg-b2-stale-refusal.json'));
if (!epoch2Done()) d = must(dispatch('dispatch-command', { expectedRevision: d.revision, commandId: 'p24r3-revise-2', name: 'revise-requirements', input: { reason: 'epoch-2 revise for the reused-submissionId negative leg' } }), 'revise-2');
if (!epoch2Done()) d = drivePrefix(d, 2);
if (!epoch2Done()) d = await driveConfigurePlan(d, 2, true); // leave the plan-evidence wait PENDING for the collision leg
if (!epoch2Done()) {
  const e = evwait(d, 'full.build.plan.evidence');
  if (e) {
    const epoch1Id = JSON.parse(fs.readFileSync(path.join(WORLD, 'leg-b2-epoch1-plan-id.json'), 'utf8')).id;
    const planReceipt2 = await classicPlanEvidenceReceipt(PROJ, 'docs/superpowers/plans/p24r3-live.md', CR);
    const epoch2Req = classicCompositionRecordEvidenceRequest({ change: CHANGE, expectedRevision: e.recordRequest.expectedRevision, evidenceId: e.id, kind: e.kind, ref: planReceipt2.ref, contentHash: planReceipt2.contentHash, checkEpoch: Number.isInteger(d.state?.checkEpoch) ? d.state.checkEpoch : 2 });
    const colliding = { ...epoch2Req, submissionId: epoch1Id };
    const res = rawDispatch(colliding);
    must(res, 'record-evidence:colliding');
    d = must(dispatch('inspect'), 'inspect');
    console.log('B2-NEG plan evidence re-recorded with REUSED epoch-1 id', epoch1Id, '=> runtime accepted (no uniqueness check)');
  }
  const pa = act(d, 'classic.extension.build-plan-unique');
  console.log('P epoch2 activation bound: submissionId', pa.input.activation.source.event.submissionId, '| sequence', pa.input.activation.source.sequence, '(STALE: the epoch-1 wait)');
  d = claimOnly(d, 'classic.extension.build-plan-unique');
  const attempt = pGateOutcome(d, null, 'p-gate-epoch2-stalebinding');
  fs.writeFileSync(path.join(WORLD, 'leg-b2-stale-refusal.json'), JSON.stringify({ status: attempt.res.status, error: attempt.res.error, activation: { submissionId: pa.input.activation.source.event.submissionId, sequence: pa.input.activation.source.sequence, checkEpoch: pa.input.activation.source.checkEpoch } }, null, 1));
  console.log('B2-NEG stale-bound pass:', attempt.res.status, '|', (attempt.res.error?.message ?? '').slice(0, 280));
}
d = must(dispatch('inspect'), 'inspect:final');
fs.writeFileSync(path.join(WORLD, 'final-run-state.json'), JSON.stringify({ status: d.status, revision: d.revision, checkEpoch: d.state.checkEpoch, phase: d.state.phase, actions: (cur(d).actions ?? []).map(x => [x.stepId, x.status]) }, null, 1));
console.log('FINAL: status', d.status, 'checkEpoch', d.state.checkEpoch, 'actions', JSON.stringify((cur(d).actions ?? []).map(x => [x.stepId, x.status])));
console.log('ALL LEGS DONE');
