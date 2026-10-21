// Knowledge revocation & restoration tests (task P4_8, acceptance L01–L11,
// spec "已发布知识的授权失效、访问隔离与恢复" per
// knowledge-revocation-and-restoration.md — G14 A event + periodic
// reconciliation, G15 A 5-minute target under normal dependencies with fault
// timeouts recorded, never paused).
//
// The tested object is lib/adapters/knowledge-revocation.js — the judgment
// and protocol layer of KnowledgeRevocation.v1. Like the P4_4 adapters it
// owns no phase, no ledger and no retry loop: the single Comet engine keeps
// RunState/lock/transaction and the only currentPhase; collectors submit
// facts; the isolation executor narrows only what a separate owner-issued
// isolation grant covers; monitors alert but never dispatch.
//
// Real entrances, zero mocks of tested behavior:
//   - the REAL file-system wiki channel (real bytes, real narrowing),
//   - a REAL stdio MCP handshake process (isolated config; the llmwiki venv
//     is unavailable in this sandbox — recorded honestly),
//   - the REAL P4_7 KnowledgeAuthz.v1 CLI (decide/revoke/recheck) over tmp
//     fixture worlds,
//   - a REAL fault-injected maintenance worker (real SIGKILL, real clock).
// External Outline Web/share/search/attachment channels have no credentials
// and no network here: the adapter builds the real request shape and reports
// UNVERIFIED with the successor — a label or a stale/unpublish flag is never
// "unreadable", and no remote readback is fabricated.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authzCli = path.join(projectRoot, 'tools', 'infra', 'knowledge-authz.mjs');
const knowledgeDir = path.join(projectRoot, 'infra', 'delivery', 'knowledge');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const ISOLATOR = 'svc:sdd-harness-pilot/outline-isolator';
const PUBLISHER = 'svc:sdd-harness-pilot/outline-publisher';
const OWNER_PRINCIPAL = 'human:ql-wade#262266039';
const REVIEWER = 'svc:sdd-harness-pilot/worker-reviewer';
const FIXTURE_GROUP = 'group:sdd-harness-pilot/engineering';
const OFFBOARDED_GROUP = 'group:sdd-harness-pilot/community';

// --- scratch world (stateless fixtures; everything under $TMPDIR) ---------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p48-revocation-'));
const wikiDir = path.join(scratch, 'wiki');
fs.mkdirSync(wikiDir, { recursive: true });
const quarantineDir = path.join(scratch, 'quarantine');
fs.mkdirSync(quarantineDir, { recursive: true });

// A real stdio JSON-RPC MCP server over the scratch wiki (real process, real
// protocol, real fs effects — the isolated-config substitute for the absent
// llmwiki venv launcher; mode "hang" reproduces a real timeout).
const mcpServerPath = path.join(scratch, 'mcp-wiki-server.mjs');
fs.writeFileSync(mcpServerPath, `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
const [wikiDir, mode] = process.argv.slice(2);
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p48-fixture-wiki', version: '0.1.0' } } });
  }
  if (msg.method !== 'tools/call') {
    return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown method ' + msg.method } });
  }
  if (mode === 'hang') return; // real non-responding server for the timeout path
  const { name, arguments: args } = msg.params;
  if (name === 'read') {
    const file = path.join(wikiDir, args.id + '.md');
    let content; try { content = fs.readFileSync(file, 'utf8'); } catch { return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ found: false }) }] } }); }
    return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ found: true, digest: sha(content) }) }] } });
  }
  if (name === 'search') {
    const hits = fs.readdirSync(wikiDir).filter((f) => f.endsWith('.md') && f.includes(args.query)).map((f) => f.replace(/\\.md$/, ''));
    return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ hits }) }] } });
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown tool ' + name } });
});
`);

// A real maintenance worker for fault injection: heartbeats + idempotent
// resume of the SAME operation from the recorded state file.
const workerPath = path.join(scratch, 'maintenance-worker.mjs');
fs.writeFileSync(workerPath, `import fs from 'node:fs';
const [stateFile, heartbeatFile] = process.argv.slice(2);
const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const write = (next) => { const tmp = stateFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(next)); fs.renameSync(tmp, stateFile); };
const beat = () => fs.writeFileSync(heartbeatFile, JSON.stringify({ at: Date.now(), pid: process.pid, op: read().operationKey }));
const tick = async () => {
  const s = read();
  if (s.status === 'completed') return;
  await new Promise((r) => setTimeout(r, 20));
  const next = { ...s, progress: s.progress + 1, attempts: s.attempts + 1 };
  write(next);
  beat();
  if (next.progress >= 5) write({ ...next, status: 'completed', completedAt: Date.now() });
};
beat();
setInterval(beat, 40);
setInterval(() => { tick().catch(() => {}); }, 15);
`);

const wikiEntry = { id: 'revocation-capability', content: 'L01-L11 revocation journey fixture entry' };
fs.writeFileSync(path.join(wikiDir, `${wikiEntry.id}.md`), wikiEntry.content);
const mcpServer = (mode) => ({ command: process.execPath, args: [mcpServerPath, wikiDir, mode].filter(Boolean) });

async function probe(rev, channel, tool, args, timeoutMs = 2_000) {
  return rev.probeChannelAccess({
    channel,
    target: tool ? { tool, arguments: args } : { path: args?.path },
    server: mcpServer(),
    timeoutMs,
  });
}

// Isolation-grant fixtures (LOCAL_FIXTURE worlds — live issuance stays
// UNREGISTERED per the P4_7 model; the structural judgment is the object).
const baseIsolationGrant = {
  id: 'grant-iso-001', kind: 'isolation', issuer: 'issuer-pilot-owner', owner: 'ql-wade',
  executor: ISOLATOR, actions: ['shares.revoke', 'documents.remove_user', 'documents.remove_group', 'documents.move', 'documents.unpublish'],
  targets: ['outline-managed-collection', 'local-wiki'],
  issuedAt: '2026-10-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', revocation: null,
};

const registry = {
  mappings: [
    { knowledgeId: 'k-arch', sources: ['sdd-harness-repo'], documentId: 'doc-arch', derived: ['k-arch-derived'], attachments: ['att-arch'], caches: ['cache-arch'] },
    { knowledgeId: 'k-multi', sources: ['sdd-harness-repo', 'comet-source'], documentId: 'doc-multi', derived: [], attachments: [], caches: [] },
    { knowledgeId: 'k-comet-only', sources: ['comet-source'], documentId: 'doc-comet', derived: [], attachments: [], caches: [] },
  ],
};

// --- 4.8.a -----------------------------------------------------------------------

test('4.8.a: the frozen G15 A budget set judges clean — fault tolerance is recorded as violation, never a clock pause', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const frozen = rev.judgeDeadlineBudgets({ budgets: rev.G15A_DEADLINES });
  assert.equal(frozen.ok, true, JSON.stringify(frozen));
  assert.equal(frozen.target.policy, 'G15-A');
  assert.equal(frozen.target.endToEndTargetSeconds, 300);
  assert.equal(frozen.faultPolicy, 'alert-and-record', 'G15 A accepts overrun with records, it does not pause the clock');
  // A 6-minute "target" is not the confirmed 5-minute goal.
  const stretched = rev.judgeDeadlineBudgets({ budgets: { ...rev.G15A_DEADLINES, endToEndTargetSeconds: 360 } });
  assert.equal(stretched.ok, false);
  assert.ok(stretched.violations.some((v) => v.code === 'END_TO_END_BUDGET_EXCEEDED'));
  // Pausing the clock on fault is the forbidden posture; so is claiming a hard
  // bound under fault (that is G15 B, not the confirmed A).
  for (const bad of ['pause-clock-on-fault', 'hard-bound-under-fault']) {
    const judged = rev.judgeDeadlineBudgets({ budgets: { ...rev.G15A_DEADLINES, faultPolicy: bad } });
    assert.equal(judged.ok, false, bad);
    assert.ok(judged.violations.some((v) => v.code === 'FAULT_POLICY_INVALID'));
  }
});

test('4.8.a: ISOLATION_GRANT_REQUIRED — a separate owner-issued isolation grant is the only path to narrowing; publish grants, expiry, revocation, scope and executor identity are each refused', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const now = Date.parse('2026-10-21T00:00:00Z');
  const run = (grant, over = {}) => rev.evaluateIsolationPreauthorization({
    grant, executorPrincipal: over.executorPrincipal ?? ISOLATOR,
    target: over.target ?? 'outline-managed-collection', now: over.now ?? now,
  });
  // No grant registered at all.
  const missing = rev.evaluateIsolationPreauthorization({ grant: null, executorPrincipal: ISOLATOR, target: 'outline-managed-collection', now });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'ISOLATION_GRANT_REQUIRED');
  // A publish grant never authorizes ACL narrowing.
  const publishGrant = { ...baseIsolationGrant, kind: 'publication' };
  assert.equal(run(publishGrant).code, 'PUBLISH_GRANT_NOT_ISOLATION_AUTH');
  // Narrowing-only scope: delete/restore/share-create are out.
  const deleter = { ...baseIsolationGrant, actions: [...baseIsolationGrant.actions, 'documents.delete'] };
  assert.equal(run(deleter).code, 'ISOLATION_SCOPE_INVALID');
  const restorer = { ...baseIsolationGrant, actions: [...baseIsolationGrant.actions, 'documents.restore'] };
  assert.equal(run(restorer).code, 'ISOLATION_SCOPE_INVALID');
  // Real-clock expiry and revocation.
  assert.equal(run(baseIsolationGrant, { now: Date.parse('2027-06-01T00:00:00Z') }).code, 'ISOLATION_GRANT_EXPIRED');
  assert.equal(run({ ...baseIsolationGrant, revocation: { revokedAt: '2026-10-20T00:00:00Z', revokedBy: OWNER_PRINCIPAL } }).code, 'ISOLATION_GRANT_REVOKED');
  // Target outside the granted objects.
  assert.equal(run(baseIsolationGrant, { target: 'someone-elses-collection' }).code, 'ISOLATION_TARGET_OUT_OF_SCOPE');
  // The publisher (who holds publish power) is not the isolator.
  assert.equal(run(baseIsolationGrant, { executorPrincipal: PUBLISHER }).code, 'ISOLATOR_PRINCIPAL_REQUIRED');
  // Positive: the owner-issued narrowing grant covers exactly its targets.
  const ok = run(baseIsolationGrant);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.actions, baseIsolationGrant.actions);
  assert.equal(ok.executor, ISOLATOR);
});

// --- 4.8.b -----------------------------------------------------------------------

test('4.8.b/L01: a trusted source-shrink event stales current receipts, pauses managed reads and publishing, and schedules impact-closure maintenance — isolated is never shown before resource-side verification', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const event = rev.buildRevocationEvent({
    kind: 'source-permission-shrunk', source: 'sdd-harness-repo',
    observedAt: '2026-10-21T10:00:00Z', reporter: 'collector:periodic-scan',
    evidence: { basis: 'permission-export', readersBefore: [FIXTURE_GROUP], readersNow: [] },
  });
  assert.equal(event.interface, 'KnowledgeRevocation.v1');
  assert.equal(event.kind, 'source-permission-shrunk');
  assert.equal('action' in event, false, 'the collector submits facts, never business actions');
  // The collector cannot smuggle a business action into the event.
  const overstep = rev.buildRevocationEvent({
    kind: 'source-permission-shrunk', source: 'sdd-harness-repo',
    observedAt: '2026-10-21T10:00:00Z', reporter: 'collector:periodic-scan',
    evidence: {}, action: 'isolate-now',
  });
  assert.equal(overstep.code, 'COLLECTOR_OVERSTEP_REFUSED');
  // Comet accepts: current receipts of the closure go stale, managed reads and
  // publishing pause, maintenance is scheduled — and the state is NOT isolated.
  const closure = rev.computeImpactClosure({ registry, event });
  assert.ok(closure.affected.includes('k-arch'));
  assert.ok(closure.affected.includes('k-multi'), 'a multi-source object is affected by ANY failed source');
  assert.ok(!closure.affected.includes('k-comet-only'));
  assert.deepEqual(closure.derivedArtifacts, ['k-arch-derived', 'att-arch', 'cache-arch']);
  const state = {
    knowledge: [
      { id: 'k-arch', epoch: 3, status: 'active' },
      { id: 'k-multi', epoch: 1, status: 'active' },
    ],
    receipts: [{ knowledgeId: 'k-arch', kind: 'publish', receiptId: 'rc-1', state: 'valid' }],
    operations: [],
  };
  const accepted = rev.acceptRevocationEvent({ state, event, closure, now: Date.parse('2026-10-21T10:00:05Z') });
  assert.equal(accepted.operation.status, 'needs-revalidation');
  assert.ok(accepted.operation.status !== 'isolated', 'resource-side verification has not happened');
  assert.ok(accepted.staledReceipts.some((r) => r.receiptId === 'rc-1'));
  assert.deepEqual(accepted.pauses.managedReads.sort(), ['k-arch', 'k-multi']);
  assert.deepEqual(accepted.pauses.publishing, ['sdd-harness-repo']);
  assert.equal(accepted.operation.epoch, 4, 'a new maintenance generation is recorded');
  assert.match(accepted.operation.operationKey, /^km-/);
});

test('4.8.b/L01: an unprovable impact boundary conservatively pauses the managed domain — partial coverage is never reported as complete', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const event = rev.buildRevocationEvent({
    kind: 'source-permission-shrunk', source: 'sdd-harness-repo',
    observedAt: '2026-10-21T10:00:00Z', reporter: 'collector:webhook', evidence: {},
  });
  // A registry with an object whose source mapping is unknown.
  const gap = rev.computeImpactClosure({
    registry: { mappings: [...registry.mappings, { knowledgeId: 'k-unknown-sources', sources: null, documentId: 'doc-x' }] },
    event,
  });
  assert.equal(gap.conservativePause, true);
  assert.ok(gap.unmapped.includes('k-unknown-sources'));
  assert.equal(gap.complete, false, 'the closure must not claim completeness over an unprovable boundary');
});

test('4.8.b/L07: duplicate and out-of-order events recover the SAME operation and a late restore never overrides a newer isolation epoch', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const mk = (reporter) => rev.buildRevocationEvent({
    kind: 'source-permission-shrunk', source: 'sdd-harness-repo',
    observedAt: '2026-10-21T10:00:00Z', reporter, evidence: {},
  });
  const closure = rev.computeImpactClosure({ registry, event: mk('collector:a') });
  const state = { knowledge: [{ id: 'k-arch', epoch: 3, status: 'active' }], receipts: [], operations: [] };
  const first = rev.acceptRevocationEvent({ state, event: mk('collector:a'), closure, now: Date.parse('2026-10-21T10:00:05Z') });
  const again = rev.acceptRevocationEvent({ state: first.state, event: mk('collector:b'), closure, now: Date.parse('2026-10-21T10:07:00Z') });
  assert.equal(again.operation.operationKey, first.operation.operationKey, 'a duplicate recovers the same operation');
  assert.equal(again.state.operations.length, 1, 'no second operation is minted');
  assert.equal(again.duplicate, true);
  // A restore planned against generation 3 arrives after isolation moved the
  // object to generation 4: revocation precedes the old restore.
  const lateRestore = rev.evaluateRestoration({
    knowledge: { id: 'k-arch', epoch: 4, status: 'isolating' },
    authorization: { grantsValid: true, contentUseUntil: '2027-01-01T00:00:00Z', audienceWithinIntersection: true, offboardedSinceIsolation: [] },
    review: { verdict: 'pass', boundDigest: sha256('v1'), reviewedAt: '2026-10-21T09:00:00Z', reviewerPrincipal: REVIEWER },
    plan: { audience: [FIXTURE_GROUP] }, allowedAudience: [FIXTURE_GROUP],
    callbackEpoch: 3,
  });
  assert.equal(lateRestore.ok, false);
  assert.equal(lateRestore.code, 'STALE_CALLBACK_REFUSED');
});

test('4.8.b/L08: the periodic full scan catches a missed permission change from the source-change timestamp — cursor replay alone is refused and a successful scan never clears failed objects', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const scan = rev.reconcileFullScan({
    registered: [
      { knowledgeId: 'k-arch', sources: [{ domain: 'sdd-harness-repo', expectedReaders: [FIXTURE_GROUP] }, { domain: 'comet-source', expectedReaders: [FIXTURE_GROUP] }] },
      { knowledgeId: 'k-clean', sources: [{ domain: 'comet-source', expectedReaders: [FIXTURE_GROUP] }] },
    ],
    observed: [
      // The missed event: the real permission changed 2 minutes ago.
      { knowledgeId: 'k-arch', domain: 'sdd-harness-repo', currentReaders: [], changedAt: '2026-10-21T10:00:00Z' },
      { knowledgeId: 'k-arch', domain: 'comet-source', currentReaders: [FIXTURE_GROUP], changedAt: '2026-10-20T00:00:00Z' },
      { knowledgeId: 'k-clean', domain: 'comet-source', currentReaders: [FIXTURE_GROUP], changedAt: '2026-10-20T00:00:00Z' },
    ],
    scanStartedAt: Date.parse('2026-10-21T10:02:00Z'),
    failedIsolations: [{ knowledgeId: 'k-failed-earlier' }],
  });
  assert.equal(scan.maintenanceActions.length, 1);
  assert.equal(scan.maintenanceActions[0].knowledgeId, 'k-arch');
  assert.match(scan.maintenanceActions[0].operationKey, /^km-/);
  assert.equal(scan.detection.sourceChangedAt, Date.parse('2026-10-21T10:00:00Z'), 'detection is measured from the real permission change, not notification arrival');
  assert.equal(scan.detection.acceptedAt, Date.parse('2026-10-21T10:02:00Z'));
  assert.equal(scan.detection.latencyMs, 120_000);
  // A registered source that the scan could not observe is unknown, not fine.
  const partial = rev.reconcileFullScan({
    registered: [{ knowledgeId: 'k-arch', sources: [{ domain: 'sdd-harness-repo', expectedReaders: [] }] }],
    observed: [],
    scanStartedAt: Date.parse('2026-10-21T10:02:00Z'),
  });
  assert.ok(partial.unknown.some((u) => u.knowledgeId === 'k-arch'));
  // Replaying the event cursor is not reconciliation.
  const cursorOnly = rev.reconcileFullScan({ registered: [], observed: [], scanStartedAt: 0, cursorOnly: true });
  assert.equal(cursorOnly.code, 'CURSOR_REPLAY_NOT_RECONCILIATION');
  // A successful scan does not clear failed isolation objects.
  assert.ok(scan.carriedFailures.some((f) => f.knowledgeId === 'k-failed-earlier'));
});

test('4.8.b: the exposure window is real wall-clock arithmetic — fault downtime stays inside the window and deadline violations are kept, not paused away', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const from = Date.parse('2026-10-21T10:00:00Z');
  const faults = [{ from: Date.parse('2026-10-21T10:01:00Z'), to: Date.parse('2026-10-21T10:06:00Z'), kind: 'runner-down' }];
  const window = rev.computeExposureWindow({
    sourceChangedAt: from,
    isolatedAt: Date.parse('2026-10-21T10:08:00Z'),
    faults,
    budgets: { endToEndTargetMs: 300_000, isolationBudgetMs: 120_000 },
  });
  assert.equal(window.exposureMs, 8 * 60_000, 'the 5-minute outage stays inside the 8-minute window');
  assert.equal(window.pausedMs, 0, 'the clock is never paused');
  assert.ok(window.violations.some((v) => v.code === 'END_TO_END_DEADLINE_VIOLATED'));
  assert.equal(window.faults.length, 1);
});

// --- 4.8.c -----------------------------------------------------------------------

test('4.8.c/L02: labels never count as isolation — stale/unpublish/archive/move and admin-can-read leave the object isolating under the same operation with alerts', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const required = ['direct-link', 'search-summary', 'single-page-share', 'attachments-preview'];
  // The page is flagged stale and archived — but a required channel is still
  // readable by a no-longer-authorized identity.
  const judged = rev.evaluateIsolationCompletion({
    requiredChannels: required,
    labelStatus: 'stale+archived+moved-to-private-collection',
    channelEvidence: [
      { channel: 'direct-link', status: 'readable', basis: 'independent-readback' },
      { channel: 'search-summary', status: 'unreadable', basis: 'independent-readback' },
      { channel: 'single-page-share', status: 'unreadable', basis: 'independent-readback' },
      { channel: 'attachments-preview', status: 'unreadable', basis: 'independent-readback' },
    ],
  });
  assert.equal(judged.status, 'isolating');
  assert.equal(judged.isolated, false);
  assert.ok(judged.alerts.some((a) => a.code === 'CHANNEL_STILL_READABLE' && a.channel === 'direct-link'));
  assert.equal(judged.sameOperationContinues, true);
  // No evidence for a required channel => unknown, not isolated.
  const unknown = rev.evaluateIsolationCompletion({
    requiredChannels: required,
    labelStatus: 'unpublished',
    channelEvidence: [{ channel: 'direct-link', status: 'unreadable', basis: 'independent-readback' }],
  });
  assert.equal(unknown.status, 'isolating');
  assert.ok(unknown.uncoveredChannels.includes('search-summary'));
  // Admin visibility proves existence, never inaccessibility.
  const adminOnly = rev.evaluateIsolationCompletion({
    requiredChannels: ['direct-link'],
    labelStatus: null,
    channelEvidence: [{ channel: 'direct-link', status: 'unreadable', basis: 'admin-observation', note: 'admin still sees the doc; members presumably cannot' }],
  });
  assert.equal(adminOnly.status, 'isolating');
  assert.ok(adminOnly.alerts.some((a) => a.code === 'ADMIN_READ_IS_NOT_ISOLATION'));
  // Positive: every required channel independently read back unreadable.
  const clean = rev.evaluateIsolationCompletion({
    requiredChannels: required,
    labelStatus: null,
    channelEvidence: required.map((channel) => ({ channel, status: 'unreadable', basis: 'independent-readback' })),
  });
  assert.equal(clean.status, 'isolated');
  assert.equal(clean.isolated, true);
});

test('4.8.c: real local channel readback — file-wiki narrowing and a real stdio MCP handshake prove unreadable; a real timeout is unknown, never unreadable; Outline web channels stay honestly UNVERIFIED', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  // Pre-isolation: the real file and the real MCP server both read the entry.
  const fileBefore = await probe(rev, 'file-wiki', null, { path: path.join(wikiDir, `${wikiEntry.id}.md`) });
  assert.equal(fileBefore.status, 'readable');
  assert.equal(fileBefore.basis, 'independent-readback');
  assert.equal(fileBefore.digest, sha256(wikiEntry.content));
  const readBefore = await probe(rev, 'controlled-mcp', 'read', { id: wikiEntry.id });
  assert.equal(readBefore.status, 'readable');
  const searchBefore = await probe(rev, 'controlled-mcp', 'search', { query: 'revocation' });
  assert.equal(searchBefore.status, 'readable');
  assert.deepEqual(searchBefore.hits, [wikiEntry.id]);
  // Resource-side narrowing: move the entry into the quarantine domain (the
  // preauthorized documents.move analog — no deletion).
  fs.renameSync(path.join(wikiDir, `${wikiEntry.id}.md`), path.join(quarantineDir, `${wikiEntry.id}.md`));
  const fileAfter = await probe(rev, 'file-wiki', null, { path: path.join(wikiDir, `${wikiEntry.id}.md`) });
  assert.equal(fileAfter.status, 'unreadable', `real narrowing must be observed: ${JSON.stringify(fileAfter)}`);
  assert.equal(fileAfter.errorCode, 'ENOENT');
  const readAfter = await probe(rev, 'controlled-mcp', 'read', { id: wikiEntry.id });
  assert.equal(readAfter.status, 'unreadable');
  const searchAfter = await probe(rev, 'controlled-mcp', 'search', { query: 'revocation' });
  assert.equal(searchAfter.status, 'unreadable');
  assert.deepEqual(searchAfter.hits, []);
  // The judgment turns isolated only with every required local channel
  // unreadable from real probes.
  const judged = rev.evaluateIsolationCompletion({
    requiredChannels: ['file-wiki', 'mcp-read', 'mcp-search'],
    channelEvidence: [
      { ...fileAfter, channel: 'file-wiki' },
      { ...readAfter, channel: 'mcp-read' },
      { ...searchAfter, channel: 'mcp-search' },
    ],
  });
  assert.equal(judged.isolated, true);
  // A real non-responding server is a timeout: unknown, never unreadable.
  const hangServer = { command: process.execPath, args: [mcpServerPath, wikiDir, 'hang'] };
  const timedOut = await rev.probeChannelAccess({ channel: 'controlled-mcp', target: { tool: 'read', arguments: { id: wikiEntry.id } }, server: hangServer, timeoutMs: 300 });
  assert.equal(timedOut.status, 'unknown');
  assert.equal(timedOut.code, 'MCP_TIMEOUT');
  const judgedUnknown = rev.evaluateIsolationCompletion({
    requiredChannels: ['mcp-read'],
    channelEvidence: [{ ...timedOut, channel: 'mcp-read' }],
  });
  assert.equal(judgedUnknown.status, 'isolating');
  // External web channels: real request shape, honest UNVERIFIED + successor.
  const web = await rev.probeChannelAccess({ channel: 'outline-direct-link', target: { url: 'https://outline.example/s/token' } });
  assert.equal(web.status, 'UNVERIFIED');
  assert.equal(web.request.method, 'GET');
  assert.ok(web.successor.includes('Outline owner'), 'the successor must be named');
  const share = await rev.probeChannelAccess({ channel: 'outline-share', target: { shareId: 'shr_1' } });
  assert.equal(share.status, 'UNVERIFIED');
  assert.equal(share.request.path, '/api/shares.info');
  // An UNVERIFIED channel blocks the isolated verdict and is listed.
  const mixed = rev.evaluateIsolationCompletion({
    requiredChannels: ['file-wiki', 'outline-share'],
    channelEvidence: [
      { channel: 'file-wiki', ...fileAfter },
      { channel: 'outline-share', ...share },
    ],
  });
  assert.equal(mixed.isolated, false);
  assert.deepEqual(mixed.uncoveredChannels, ['outline-share']);
});

test('4.8.c/L03+L04: the two deadlines — publish_until expiry blocks only new publication, content_use_until expiry or an escaped audience forces isolation, unclear semantics never auto-publish and a source revocation overrides an unexpired grant', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const now = Date.parse('2026-10-21T00:00:00Z');
  // L03: publish_until expired, content_use_until still valid, audiences legal.
  const l03 = rev.judgeTwoDeadlines({ publishUntil: '2026-10-20T00:00:00Z', contentUseUntil: '2026-12-01T00:00:00Z', now, audienceWithinIntersection: true });
  assert.equal(l03.newPublish, 'blocked');
  assert.equal(l03.existingContent, 'may-continue', 'past legitimate content is not auto-revoked');
  // L03: unclear continuous-use semantics => no auto-publish, no default forever.
  const unclear = rev.judgeTwoDeadlines({ publishUntil: '2026-12-01T00:00:00Z', contentUseUntil: undefined, now });
  assert.equal(unclear.autoPublish, 'blocked');
  assert.equal(unclear.code, 'NO_CONTINUOUS_USE_SEMANTICS');
  // L04: content_use_until expired => old receipts stop counting; isolate.
  const l04a = rev.judgeTwoDeadlines({ publishUntil: '2026-12-01T00:00:00Z', contentUseUntil: '2026-10-01T00:00:00Z', now, audienceWithinIntersection: true });
  assert.equal(l04a.existingContent, 'must-isolate');
  assert.equal(l04a.newPublish, 'blocked');
  assert.equal(l04a.code, 'CONTENT_USE_EXPIRED');
  // L04: audience escaped the intersection.
  const l04b = rev.judgeTwoDeadlines({ publishUntil: '2026-12-01T00:00:00Z', contentUseUntil: '2026-12-01T00:00:00Z', now, audienceWithinIntersection: false });
  assert.equal(l04b.existingContent, 'must-isolate');
  assert.equal(l04b.code, 'AUDIENCE_OUTSIDE_INTERSECTION');
  // A source revocation recomputes disclosure even under an unexpired grant.
  const revoked = rev.judgeTwoDeadlines({ publishUntil: '2026-12-01T00:00:00Z', contentUseUntil: '2026-12-01T00:00:00Z', now, audienceWithinIntersection: true, sourceRevoked: true });
  assert.equal(revoked.existingContent, 'must-isolate');
  assert.equal(revoked.code, 'SOURCE_REVOKED_RECOMPUTE');
});

test('4.8.c/L06: restoration re-proves everything — new epoch first, a current-audience plan, offboarded principals never re-added and stale callbacks refused', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const base = {
    knowledge: { id: 'k-arch', epoch: 4, status: 'isolated' },
    authorization: { grantsValid: true, contentUseUntil: '2027-01-01T00:00:00Z', audienceWithinIntersection: true, offboardedSinceIsolation: [OFFBOARDED_GROUP] },
    review: { verdict: 'pass', boundDigest: sha256('candidate-v2'), reviewedAt: '2026-10-21T09:00:00Z', reviewerPrincipal: REVIEWER },
    allowedAudience: [FIXTURE_GROUP],
    channelEvidence: [{ channel: 'file-wiki', status: 'readable', basis: 'independent-readback' }],
  };
  // The old ACL snapshot replay: the plan re-adds the offboarded group.
  const replay = rev.evaluateRestoration({ ...base, plan: { audience: [FIXTURE_GROUP, OFFBOARDED_GROUP] } });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'OFFBOARDED_PRINCIPAL_READD');
  // A plan outside the current intersection.
  const wide = rev.evaluateRestoration({ ...base, plan: { audience: [FIXTURE_GROUP, 'group:sdd-harness-pilot/guests'] } });
  assert.equal(wide.code, 'RESTORE_AUDIENCE_OUTSIDE_INTERSECTION');
  // Grants no longer valid / content use expired / review missing.
  assert.equal(rev.evaluateRestoration({ ...base, plan: { audience: [FIXTURE_GROUP] }, authorization: { ...base.authorization, grantsValid: false } }).code, 'RESTORE_AUTHZ_INVALID');
  assert.equal(rev.evaluateRestoration({ ...base, plan: { audience: [FIXTURE_GROUP] }, authorization: { ...base.authorization, contentUseUntil: '2026-10-01T00:00:00Z' } }).code, 'RESTORE_CONTENT_USE_EXPIRED');
  assert.equal(rev.evaluateRestoration({ ...base, plan: { audience: [FIXTURE_GROUP] }, review: null }).code, 'RESTORE_REVIEW_REQUIRED');
  // A successful restoration: fresh review, current audience, readback done.
  const ok = rev.evaluateRestoration({ ...base, plan: { audience: [FIXTURE_GROUP] } });
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 'active');
  assert.equal(ok.newEpoch, 5, 'the new generation is recorded before execution');
  assert.equal(ok.newEpoch > base.knowledge.epoch, true);
});

test('4.8.c/L05: post-completion maintenance preserves the delivered history through the same single engine; an open run blocks closeout instead', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const event = rev.buildRevocationEvent({
    kind: 'grant-expired', source: 'sdd-harness-repo',
    observedAt: '2026-10-21T10:00:00Z', reporter: 'collector:expiry-tick', evidence: {},
  });
  const completed = rev.evaluatePostCompletionMaintenance({
    originalRun: { id: 'run-delivery-1', state: 'completed', publishReceiptId: 'rc-arch-9' },
    event,
  });
  assert.equal(completed.mode, 'maintenance-run');
  assert.equal(completed.maintenance.engine, 'Comet.Run.managedDelivery.v1');
  assert.equal(completed.maintenance.linkedReceipt, 'rc-arch-9');
  assert.equal(completed.originalRunPreserved, true);
  assert.equal(completed.originalRun.state, 'completed', 'the delivered history is never rewritten');
  assert.ok(!('currentPhase' in completed.maintenance), 'no second currentPhase exists anywhere');
  assert.equal(completed.maintenance.reopensProductRequirement, false);
  const open = rev.evaluatePostCompletionMaintenance({
    originalRun: { id: 'run-delivery-2', state: 'build', publishReceiptId: 'rc-2' },
    event,
  });
  assert.equal(open.mode, 'same-run');
  assert.deepEqual(open.blocked, ['K_RECEIPT_STALE_BLOCKS_CLOSEOUT']);
});

test('4.8.c/L04: a real source-permission shrink through the P4_7 KnowledgeAuthz.v1 CLI stales the publish decision', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const scratchCli = fs.mkdtempSync(path.join(scratch, 'cli-'));
  const tmp = (name, value) => {
    const file = path.join(scratchCli, name);
    fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    return file;
  };
  const model = JSON.parse(fs.readFileSync(path.join(knowledgeDir, 'authorization-model.json'), 'utf8'));
  const policy = structuredClone(JSON.parse(fs.readFileSync(path.join(knowledgeDir, 'preauthorization-policy.json'), 'utf8')));
  policy.target.allowedAudience = { readers: [FIXTURE_GROUP], status: 'LOCAL_FIXTURE', reason: 'operator-declared audience for the local structural proof only' };
  const ledger = JSON.parse(fs.readFileSync(path.join(knowledgeDir, 'grant-ledger.example.json'), 'utf8'));
  for (const grant of ledger.grants) {
    if (grant.revocation === null) grant.purpose.disclosureAudience = [FIXTURE_GROUP];
  }
  const world = { model: tmp('model.json', model), policy: tmp('policy.json', policy), ledger: tmp('ledger.json', ledger) };
  const runCli = (args) => spawnSync(process.execPath, [authzCli, ...args], { cwd: projectRoot, encoding: 'utf8', timeout: 60_000 });
  const payloadDigest = sha256('p48 revocation case candidate');
  const request = tmp('request.json', {
    schemaVersion: 1, requestedBy: PUBLISHER, execution: 'exec-p48-1', payloadDigest,
    operation: {
      knowledgeId: 'k-p48', knowledgeType: 'project-knowledge',
      documentId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', action: 'documents.create',
      target: { collection: 'outline-managed-collection', audienceSource: 'collection-default', effectiveAudience: { readers: [FIXTURE_GROUP], incompletePagination: false, unmappedPrincipals: [] } },
    },
    sources: [{ domain: 'sdd-harness-repo', permissionEvidence: { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] } }],
    review: { execution: 'review-p48', reviewerPrincipal: REVIEWER, verdict: 'pass', boundPayloadDigest: payloadDigest, reviewedAt: new Date().toISOString() },
  });
  const decided = runCli(['decide', '--request', request, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(decided.status, 0, `decide must pass first: ${decided.stderr}${decided.stdout}`);
  const decisionFile = tmp('decision.json', JSON.parse(decided.stdout));
  // The real revocation entrance: the owner shrinks the source permission.
  const revoked = runCli(['revoke', '--grant', 'grant-pilot-001', '--ledger', world.ledger, '--model', world.model, '--as', OWNER_PRINCIPAL, '--reason', 'L04 source permission shrink', '--json']);
  assert.equal(revoked.status, 0);
  const rechecked = runCli(['recheck', '--decision', decisionFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(rechecked.status, 2, 'the old publish receipt no longer counts for the current authorization');
  const reasons = JSON.parse(rechecked.stdout).reasons.map((r) => r.code);
  assert.ok(reasons.includes('GRANT_NO_LONGER_VALID'));
  // The module maps that real fact onto the maintenance posture.
  const judged = rev.judgeTwoDeadlines({ publishUntil: '2026-12-01T00:00:00Z', contentUseUntil: '2026-12-01T00:00:00Z', now: Date.now(), audienceWithinIntersection: true, sourceRevoked: true });
  assert.equal(judged.existingContent, 'must-isolate');
});

// --- 4.8.d -----------------------------------------------------------------------

test('4.8.d/L10: the first isolation failure alerts immediately, retries stay bounded inside the same operation, permission denial escalates instead of retrying and the exposure stays unresolved', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const t0 = Date.parse('2026-10-21T10:00:00Z');
  const budgets = { isolationBudgetMs: 120_000, alertDeliveryMs: 30_000, fastMaxAttempts: 3, lowFrequencyRetryMs: 300_000 };
  const judged = rev.judgeIsolationFailure({
    failures: [
      { at: t0 + 5_000, code: 'API_TIMEOUT' },
      { at: t0 + 30_000, code: 'API_TIMEOUT' },
    ],
    now: t0 + 35_000,
    budgets,
  });
  assert.equal(judged.alert.code, 'ISOLATION_FAILED');
  assert.equal(judged.alert.at, t0 + 5_000, 'the FIRST failure alerts — not after the budget is exhausted');
  assert.equal(judged.nextAttempt.at > t0 + 35_000, true);
  assert.equal(judged.nextAttempt.sameOperation, true, 'retries live inside the same Comet operation');
  assert.equal(judged.owner, 'comet', 'the executor never owns a retry loop');
  assert.equal(judged.exposureUnresolved, true);
  // A permission denial is escalated to the owner, not retried.
  const denied = rev.judgeIsolationFailure({
    failures: [{ at: t0 + 5_000, code: 'PERMISSION_DENIED' }],
    now: t0 + 6_000,
    budgets,
  });
  assert.equal(denied.retry, false);
  assert.equal(denied.escalate, 'owner');
  // 429 honors Retry-After even past the deadline — the violation is recorded.
  const limited = rev.judgeIsolationFailure({
    failures: [{ at: t0 + 5_000, code: 'RATE_LIMITED', retryAfterMs: 300_000 }],
    now: t0 + 6_000,
    budgets,
  });
  assert.equal(limited.nextAttempt.respectsRetryAfter, true);
  assert.ok(limited.violations.some((v) => v.code === 'ISOLATION_BUDGET_EXCEEDED'));
  // Past the fast budget: low-frequency retry under the SAME operation, alert not cleared.
  const exhausted = rev.judgeIsolationFailure({
    failures: [{ at: t0, code: 'API_TIMEOUT' }],
    now: t0 + 200_000,
    budgets,
  });
  assert.equal(exhausted.lowFrequency.everyMs, 300_000);
  assert.equal(exhausted.lowFrequency.sameOperation, true);
  assert.equal(exhausted.alert.cleared, false);
});

test('4.8.d/L09: a stale heartbeat and a stalled scan watermark each alert within the approved thresholds, the supervisor may only restart the original instance and an alert is never an isolation', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const now = Date.parse('2026-10-21T10:05:00Z');
  // Heartbeat 100s old (> 90s) alerts.
  const stale = rev.judgeMonitorThresholds({ heartbeatAt: now - 100_000, lastFullScanAt: now - 20_000, now });
  assert.ok(stale.alerts.some((a) => a.code === 'RUNNER_HEARTBEAT_STALE'));
  // Heartbeat fresh but the full-scan watermark stalled 130s (> 120s).
  const stalled = rev.judgeMonitorThresholds({ heartbeatAt: now - 5_000, lastFullScanAt: now - 130_000, now });
  assert.ok(stalled.alerts.some((a) => a.code === 'SCAN_WATERMARK_STALLED'));
  assert.ok(!stalled.alerts.some((a) => a.code === 'RUNNER_HEARTBEAT_STALE'), 'a fresh heartbeat must not silence the scan-stall alert');
  // Healthy.
  const healthy = rev.judgeMonitorThresholds({ heartbeatAt: now - 5_000, lastFullScanAt: now - 30_000, now });
  assert.equal(healthy.alerts.length, 0);
  // The supervisor may only restart the original Comet instance.
  assert.equal(rev.judgeMonitorThresholds({ heartbeatAt: now - 100_000, lastFullScanAt: now, now, supervisorAction: 'restart-original' }).supervisor.allowed, true);
  for (const action of ['copy-state-to-member', 'start-second-owner', 'change-phase']) {
    const over = rev.judgeMonitorThresholds({ heartbeatAt: now - 100_000, lastFullScanAt: now, now, supervisorAction: action });
    assert.equal(over.supervisor.allowed, false);
    assert.equal(over.supervisor.code, 'SUPERVISOR_OVERSTEP_REFUSED');
  }
  // An alert delivered is never an isolation.
  assert.equal(stale.isolated, false);
  assert.match(stale.note, /alert/i);
});

test('4.8.d/L11: recovery freezes new publishing, reconciles unknown writes first, keeps three separate watermarks — conflation and scan-clears-failure are refused and violations survive closure', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const goodOrder = ['freeze-new-publish', 'reconcile-unknown-writes', 'full-snapshot-reconciliation', 'isolation-first-maintenance'];
  const state = {
    eventReceiveCursor: 4102,
    fullScanWatermark: '2026-10-21T09:00:00Z',
    isolationEvidenceCursor: 17,
    failedIsolations: [{ knowledgeId: 'k-failed-earlier' }],
    unknownWrites: [{ knowledgeId: 'k-arch', operation: 'shares.revoke', at: '2026-10-21T09:40:00Z' }],
  };
  const plan = rev.evaluateRecoveryReconciliation({
    proposedOrder: goodOrder, state,
    violations: [{ code: 'END_TO_END_DEADLINE_VIOLATED', at: '2026-10-21T09:50:00Z' }],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.newPublishPaused, true);
  assert.deepEqual(plan.reconcilesUnknownWritesFirst, state.unknownWrites);
  assert.equal(plan.watermarks.eventReceiveCursor, 4102);
  assert.equal(plan.watermarks.isolationEvidenceCursor, 17, 'the scan watermark never substitutes for isolation evidence');
  assert.ok(plan.carriedFailures.some((f) => f.knowledgeId === 'k-failed-earlier'));
  assert.ok(plan.incident.violations.some((v) => v.code === 'END_TO_END_DEADLINE_VIOLATED'), 'closure keeps the violation');
  // Wrong order: reconciling the snapshot before the unknown writes.
  const wrong = rev.evaluateRecoveryReconciliation({
    proposedOrder: ['freeze-new-publish', 'full-snapshot-reconciliation', 'reconcile-unknown-writes', 'isolation-first-maintenance'], state,
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'RECOVERY_ORDER_INVALID');
  // One shared cursor for all three facts is conflation.
  const conflated = rev.evaluateRecoveryReconciliation({
    proposedOrder: goodOrder, state: { ...state, sharedCursor: 4102 },
  });
  assert.equal(conflated.code, 'CURSOR_CONFLATION_REFUSED');
});

test('4.8.d: real fault injection — a real maintenance worker is SIGKILLed mid-isolation, the exposure window keeps the downtime and the restarted original instance resumes the SAME operation', async () => {
  const rev = await import('../lib/adapters/knowledge-revocation.js');
  const stateFile = path.join(scratch, 'worker-state.json');
  const heartbeatFile = path.join(scratch, 'worker-heartbeat.json');
  const operationKey = 'km-real-fault-injection';
  fs.writeFileSync(stateFile, JSON.stringify({ operationKey, progress: 0, attempts: 0, status: 'isolating' }));
  const sourceChangedAt = Date.now();
  const child = spawn(process.execPath, [workerPath, stateFile, heartbeatFile], { stdio: 'ignore' });
  // Wait until the worker is really alive and mid-operation.
  const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const waitUntil = async (pred, ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return pred();
  };
  assert.equal(await waitUntil(() => readState().progress >= 1, 5_000), true, 'worker must make progress');
  // Real SIGKILL; confirm termination before any restart (old-writer fencing).
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGKILL');
  const killResult = await exited;
  assert.ok(killResult.signal === 'SIGKILL' || killResult.code !== null, 'the old writer is confirmed terminated before any restart');
  const killedAt = Date.now();
  // Real downtime: the heartbeat goes genuinely stale on the wall clock.
  await new Promise((r) => setTimeout(r, 150));
  const staleAge = Date.now() - JSON.parse(fs.readFileSync(heartbeatFile, 'utf8')).at;
  assert.ok(staleAge >= 100, `the heartbeat must really go stale during downtime (age ${staleAge}ms)`);
  const progressAtKill = readState().progress;
  // The supervisor restarts the ORIGINAL instance (same command, same state).
  const restarted = spawn(process.execPath, [workerPath, stateFile, heartbeatFile], { stdio: 'ignore' });
  const restartedAt = Date.now();
  try {
    assert.equal(await waitUntil(() => readState().status === 'completed', 10_000), true, 'the restarted original instance must finish the SAME operation');
    const final = readState();
    assert.equal(final.operationKey, operationKey, 'idempotent resume: no second operation is minted');
    assert.ok(final.attempts > progressAtKill, 'the resume continues from recorded progress');
    const isolatedAt = final.completedAt;
    const window = rev.computeExposureWindow({
      sourceChangedAt, isolatedAt,
      faults: [{ from: killedAt, to: restartedAt, kind: 'runner-down' }],
      budgets: { endToEndTargetMs: 300_000, isolationBudgetMs: 120_000 },
    });
    const downtime = restartedAt - killedAt;
    assert.ok(window.exposureMs >= downtime, 'the downtime stays inside the exposure window — the clock is never paused');
    assert.equal(window.pausedMs, 0);
    assert.equal(window.violations.length, 0, 'the real sub-second window violates no frozen budget');
    // Judged against an impossible budget the SAME real window records its
    // violation — the arithmetic does not hide it.
    const tiny = rev.computeExposureWindow({
      sourceChangedAt, isolatedAt,
      faults: [{ from: killedAt, to: restartedAt, kind: 'runner-down' }],
      budgets: { endToEndTargetMs: 1, isolationBudgetMs: 1 },
    });
    assert.ok(tiny.violations.some((v) => v.code === 'END_TO_END_DEADLINE_VIOLATED'));
  } finally {
    restarted.kill('SIGKILL');
  }
});
