// P4_8 delivery case: knowledge revocation & restoration journey (acceptance
// L01–L11, spec "已发布知识的授权失效、访问隔离与恢复"). One knowledge
// object travels the whole lifecycle through the real entrances available in
// this sandbox:
//
//   - the REAL P4_7 KnowledgeAuthz.v1 CLI (decide → revoke → recheck) for the
//     source-permission shrink (the old publish receipt stales),
//   - the REAL file-system wiki channel and a REAL stdio MCP handshake
//     process (isolated config; the llmwiki venv is absent here) for
//     resource-side narrowing and independent readback,
//   - a REAL fault-injected maintenance worker (real SIGKILL, real wall
//     clock) for the L09/L10/L11 failure economics.
//
// G14 A (event + periodic reconciliation) and G15 A (5-minute target under
// normal dependencies; fault overrun recorded, never paused) are the frozen
// posture. External Outline Web/share/search/attachment channels have no
// credentials and no network here: the adapter's real request shapes are
// exercised and reported UNVERIFIED with the successor — the managed Outline
// object honestly never reaches "isolated" locally (L02 discipline), while
// the local wiki object does.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const authzCli = path.join(projectRoot, 'tools', 'infra', 'knowledge-authz.mjs');
const knowledgeDir = path.join(projectRoot, 'infra', 'delivery', 'knowledge');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const ISOLATOR = 'svc:sdd-harness-pilot/outline-isolator';
const PUBLISHER = 'svc:sdd-harness-pilot/outline-publisher';
const OWNER_PRINCIPAL = 'human:ql-wade#262266039';
const REVIEWER = 'svc:sdd-harness-pilot/worker-reviewer';
const FIXTURE_GROUP = 'group:sdd-harness-pilot/engineering';
const OFFBOARDED_GROUP = 'group:sdd-harness-pilot/community';

// --- journey world ----------------------------------------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p48-journey-'));
const wikiDir = path.join(scratch, 'wiki');
const quarantineDir = path.join(scratch, 'quarantine');
fs.mkdirSync(wikiDir, { recursive: true });
fs.mkdirSync(quarantineDir, { recursive: true });
const entryId = 'journey-revocation-entry';
const entryContent = 'published knowledge: delivery-foundation L01-L11 journey';
fs.writeFileSync(path.join(wikiDir, `${entryId}.md`), entryContent);

const mcpServerPath = path.join(scratch, 'journey-mcp-server.mjs');
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
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p48-journey-wiki', version: '0.1.0' } } });
  if (msg.method !== 'tools/call') return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unknown method' } });
  if (mode === 'hang') return;
  const { name, arguments: args } = msg.params;
  if (name === 'read') {
    let content; try { content = fs.readFileSync(path.join(wikiDir, args.id + '.md'), 'utf8'); } catch { return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ found: false }) }] } }); }
    return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ found: true, digest: sha(content) }) }] } });
  }
  if (name === 'search') {
    const hits = fs.readdirSync(wikiDir).filter((f) => f.endsWith('.md') && f.includes(args.query)).map((f) => f.replace(/\\.md$/, ''));
    return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ hits }) }] } });
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown tool' } });
});
`);

const workerPath = path.join(scratch, 'journey-worker.mjs');
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

const mcpServer = (mode) => ({ command: process.execPath, args: [mcpServerPath, wikiDir, mode].filter(Boolean) });
const runCli = (args) => spawnSync(process.execPath, [authzCli, ...args], { cwd: projectRoot, encoding: 'utf8', timeout: 60_000 });

const isolationGrant = {
  id: 'grant-iso-journey', kind: 'isolation', issuer: 'issuer-pilot-owner', owner: 'ql-wade',
  executor: ISOLATOR, actions: ['shares.revoke', 'documents.remove_user', 'documents.remove_group', 'documents.move', 'documents.unpublish'],
  targets: ['outline-managed-collection', 'local-wiki'],
  issuedAt: '2026-10-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', revocation: null,
};

// --- J1: L01 + L03 + L04 — the full revocation path on the local object --------------

test('J1 (L01+L03+L04): real shrink → event → acceptance → closure → two deadlines → preauthorized narrowing → real readback → isolated, with the real exposure window', async () => {
  const rev = await import('../../lib/adapters/knowledge-revocation.js');

  // (1) The publication existed: a real allow decision from the real CLI.
  const model = JSON.parse(fs.readFileSync(path.join(knowledgeDir, 'authorization-model.json'), 'utf8'));
  const policy = structuredClone(JSON.parse(fs.readFileSync(path.join(knowledgeDir, 'preauthorization-policy.json'), 'utf8')));
  policy.target.allowedAudience = { readers: [FIXTURE_GROUP], status: 'LOCAL_FIXTURE', reason: 'operator-declared audience for the local structural proof only' };
  const ledger = JSON.parse(fs.readFileSync(path.join(knowledgeDir, 'grant-ledger.example.json'), 'utf8'));
  for (const grant of ledger.grants) {
    if (grant.revocation === null) grant.purpose.disclosureAudience = [FIXTURE_GROUP];
  }
  const tmpFile = (name, value) => {
    const file = path.join(scratch, name);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  };
  const world = { model: tmpFile('j1-model.json', model), policy: tmpFile('j1-policy.json', policy), ledger: tmpFile('j1-ledger.json', ledger) };
  const payloadDigest = sha256('j1 journey candidate');
  const request = tmpFile('j1-request.json', {
    schemaVersion: 1, requestedBy: PUBLISHER, execution: 'exec-j1', payloadDigest,
    operation: {
      knowledgeId: 'k-journey', knowledgeType: 'project-knowledge',
      documentId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', action: 'documents.create',
      target: { collection: 'outline-managed-collection', audienceSource: 'collection-default', effectiveAudience: { readers: [FIXTURE_GROUP], incompletePagination: false, unmappedPrincipals: [] } },
    },
    sources: [{ domain: 'sdd-harness-repo', permissionEvidence: { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] } }],
    review: { execution: 'review-j1', reviewerPrincipal: REVIEWER, verdict: 'pass', boundPayloadDigest: payloadDigest, reviewedAt: new Date().toISOString() },
  });
  const decided = runCli(['decide', '--request', request, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(decided.status, 0, `the journey starts from a real allow decision: ${decided.stderr}${decided.stdout}`);
  const decisionFile = tmpFile('j1-decision.json', JSON.parse(decided.stdout));

  // (2) L03 first: publish_until expiry alone blocks only NEW publication —
  // the existing content keeps serving while content_use_until is valid.
  const now = Date.now();
  const l03 = rev.judgeTwoDeadlines({ publishUntil: new Date(now - 86_400_000).toISOString(), contentUseUntil: new Date(now + 86_400_000).toISOString(), now, audienceWithinIntersection: true });
  assert.equal(l03.newPublish, 'blocked');
  assert.equal(l03.existingContent, 'may-continue');

  // (3) L04: the real source shrink — the owner revokes the source grant
  // through the real CLI; the old receipt stops counting (recheck exit 2).
  const sourceChangedAt = Date.now();
  const revoked = runCli(['revoke', '--grant', 'grant-pilot-001', '--ledger', world.ledger, '--model', world.model, '--as', OWNER_PRINCIPAL, '--reason', 'J1 source permission shrink', '--json']);
  assert.equal(revoked.status, 0);
  const rechecked = runCli(['recheck', '--decision', decisionFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(rechecked.status, 2);
  assert.ok(JSON.parse(rechecked.stdout).reasons.some((r) => r.code === 'GRANT_NO_LONGER_VALID'));
  const l04 = rev.judgeTwoDeadlines({ publishUntil: new Date(now + 86_400_000).toISOString(), contentUseUntil: new Date(now + 86_400_000).toISOString(), now, audienceWithinIntersection: true, sourceRevoked: true });
  assert.equal(l04.existingContent, 'must-isolate', 'a source revocation recomputes disclosure even under unexpired grants');

  // (4) L01: the collector reports the fact; Comet accepts, stales receipts,
  // pauses managed reads/publishing and schedules impact-closure maintenance.
  const event = rev.buildRevocationEvent({
    kind: 'source-permission-shrunk', source: 'sdd-harness-repo',
    observedAt: new Date().toISOString(), reporter: 'collector:periodic-scan',
    evidence: { basis: 'ledger-revocation', grant: 'grant-pilot-001', revokedBy: OWNER_PRINCIPAL },
  });
  const registry = { mappings: [{ knowledgeId: 'k-journey', sources: ['sdd-harness-repo'], documentId: entryId, derived: [], attachments: [], caches: [] }] };
  const closure = rev.computeImpactClosure({ registry, event });
  assert.deepEqual(closure.affected, ['k-journey']);
  const state = {
    knowledge: [{ id: 'k-journey', epoch: 2, status: 'active' }],
    receipts: [{ knowledgeId: 'k-journey', kind: 'publish', receiptId: 'rc-j1', state: 'valid' }],
    operations: [],
  };
  const accepted = rev.acceptRevocationEvent({ state, event, closure, now: Date.now() });
  assert.equal(accepted.operation.status, 'needs-revalidation');
  assert.equal(accepted.operation.epoch, 3);
  assert.ok(accepted.staledReceipts.some((r) => r.receiptId === 'rc-j1'));
  assert.deepEqual(accepted.pauses.managedReads, ['k-journey']);
  assert.equal(accepted.operation.status !== 'isolated', true, 'no isolated claim before resource-side verification');

  // (5) The preauthorized narrowing: the isolation grant check passes and the
  // real local channels are narrowed (move into the quarantine domain).
  const preauth = rev.evaluateIsolationPreauthorization({ grant: isolationGrant, executorPrincipal: ISOLATOR, target: 'local-wiki', now: Date.now() });
  assert.equal(preauth.ok, true, JSON.stringify(preauth));
  const probeOpts = { server: mcpServer(), timeoutMs: 2_000 };
  const pre = {
    file: await rev.probeChannelAccess({ ...probeOpts, channel: 'file-wiki', target: { path: path.join(wikiDir, `${entryId}.md`) } }),
    read: await rev.probeChannelAccess({ ...probeOpts, channel: 'controlled-mcp', target: { tool: 'read', arguments: { id: entryId } } }),
    search: await rev.probeChannelAccess({ ...probeOpts, channel: 'controlled-mcp', target: { tool: 'search', arguments: { query: 'journey' } } }),
  };
  assert.equal(pre.file.status, 'readable');
  assert.equal(pre.read.status, 'readable');
  assert.equal(pre.search.status, 'readable');
  const isolatedAtStart = rev.evaluateIsolationCompletion({
    requiredChannels: ['file-wiki', 'mcp-read', 'mcp-search'],
    channelEvidence: [
      { ...pre.file, channel: 'file-wiki' },
      { ...pre.read, channel: 'mcp-read' },
      { ...pre.search, channel: 'mcp-search' },
    ],
  });
  assert.equal(isolatedAtStart.isolated, false, 'readable channels keep the object non-isolated');

  fs.renameSync(path.join(wikiDir, `${entryId}.md`), path.join(quarantineDir, `${entryId}.md`));
  const post = {
    file: await rev.probeChannelAccess({ ...probeOpts, channel: 'file-wiki', target: { path: path.join(wikiDir, `${entryId}.md`) } }),
    read: await rev.probeChannelAccess({ ...probeOpts, channel: 'controlled-mcp', target: { tool: 'read', arguments: { id: entryId } } }),
    search: await rev.probeChannelAccess({ ...probeOpts, channel: 'controlled-mcp', target: { tool: 'search', arguments: { query: 'journey' } } }),
  };
  assert.equal(post.file.status, 'unreadable');
  assert.equal(post.file.errorCode, 'ENOENT');
  assert.equal(post.read.status, 'unreadable');
  assert.equal(post.search.status, 'unreadable');
  const completion = rev.evaluateIsolationCompletion({
    requiredChannels: ['file-wiki', 'mcp-read', 'mcp-search'],
    channelEvidence: [
      { ...post.file, channel: 'file-wiki' },
      { ...post.read, channel: 'mcp-read' },
      { ...post.search, channel: 'mcp-search' },
    ],
  });
  assert.equal(completion.isolated, true, 'every required local channel is really unreadable');
  assert.equal(completion.status, 'isolated');

  // (6) The real exposure window over the real wall clock.
  const isolatedAt = Date.now();
  const window = rev.computeExposureWindow({ sourceChangedAt, isolatedAt, faults: [], budgets: { endToEndTargetMs: 300_000, isolationBudgetMs: 120_000 } });
  assert.ok(window.exposureMs > 0 && window.exposureMs < 300_000, 'the real local journey sits inside the frozen 5-minute target');
  assert.equal(window.violations.length, 0);

  // (7) The Outline-managed object over web channels honestly stays
  // non-isolated: UNVERIFIED channels never satisfy completion.
  const shareProbe = await rev.probeChannelAccess({ channel: 'outline-share', target: { shareId: 'shr_j1' } });
  assert.equal(shareProbe.status, 'UNVERIFIED');
  const outlineObject = rev.evaluateIsolationCompletion({
    requiredChannels: ['outline-direct-link', 'outline-share', 'outline-search', 'outline-attachment'],
    channelEvidence: [shareProbe],
  });
  assert.equal(outlineObject.isolated, false);
  assert.equal(outlineObject.uncoveredChannels.length, 4);
});

// --- J2: L02 — labels are never isolation -------------------------------------------

test('J2 (L02): a stale label with still-readable channels keeps the same operation isolating with an alert — the label is not evidence', async () => {
  const rev = await import('../../lib/adapters/knowledge-revocation.js');
  fs.writeFileSync(path.join(wikiDir, `${entryId}.md`), entryContent); // restore for this scenario
  const probeOpts = { server: mcpServer(), timeoutMs: 2_000 };
  const still = {
    file: await rev.probeChannelAccess({ ...probeOpts, channel: 'file-wiki', target: { path: path.join(wikiDir, `${entryId}.md`) } }),
    read: await rev.probeChannelAccess({ ...probeOpts, channel: 'controlled-mcp', target: { tool: 'read', arguments: { id: entryId } } }),
  };
  assert.equal(still.file.status, 'readable');
  const judged = rev.evaluateIsolationCompletion({
    requiredChannels: ['file-wiki', 'mcp-read'],
    labelStatus: 'stale-and-renamed-to-.isolated',
    channelEvidence: [
      { channel: 'file-wiki', ...still.file },
      { channel: 'mcp-read', ...still.read },
    ],
  });
  assert.equal(judged.isolated, false);
  assert.equal(judged.status, 'isolating');
  assert.ok(judged.alerts.some((a) => a.code === 'CHANNEL_STILL_READABLE'));
  assert.equal(judged.sameOperationContinues, true);
});

// --- J3: L05 + L06 — post-completion maintenance and re-proven restoration ----------

test('J3 (L05+L06): the delivered history is preserved by a same-engine maintenance job; restoration re-proves with a new epoch and never re-adds the offboarded group', async () => {
  const rev = await import('../../lib/adapters/knowledge-revocation.js');
  const event = rev.buildRevocationEvent({
    kind: 'target-audience-widened', source: 'sdd-harness-repo',
    observedAt: new Date().toISOString(), reporter: 'collector:webhook', evidence: { shareCreated: 'shr_j3' },
  });
  // L05: the original delivery run is completed; maintenance rides the same
  // engine and links the original publish receipt.
  const completed = rev.evaluatePostCompletionMaintenance({
    originalRun: { id: 'run-j3-delivery', state: 'completed', publishReceiptId: 'rc-j3' },
    event,
  });
  assert.equal(completed.mode, 'maintenance-run');
  assert.equal(completed.maintenance.engine, 'Comet.Run.managedDelivery.v1');
  assert.equal(completed.maintenance.linkedReceipt, 'rc-j3');
  assert.equal(completed.originalRun.state, 'completed');
  assert.ok(!('currentPhase' in completed.maintenance));
  // L06: the offboarded group must not come back through an old snapshot.
  const base = {
    knowledge: { id: 'k-j3', epoch: 7, status: 'isolated' },
    authorization: { grantsValid: true, contentUseUntil: new Date(Date.now() + 86_400_000).toISOString(), audienceWithinIntersection: true, offboardedSinceIsolation: [OFFBOARDED_GROUP] },
    review: { verdict: 'pass', boundDigest: sha256('j3 candidate v2'), reviewedAt: new Date().toISOString(), reviewerPrincipal: REVIEWER },
    allowedAudience: [FIXTURE_GROUP],
    channelEvidence: [{ channel: 'file-wiki', status: 'readable', basis: 'independent-readback' }],
  };
  const replay = rev.evaluateRestoration({ ...base, plan: { audience: [FIXTURE_GROUP, OFFBOARDED_GROUP] } });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'OFFBOARDED_PRINCIPAL_READD');
  const ok = rev.evaluateRestoration({ ...base, plan: { audience: [FIXTURE_GROUP] } });
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 'active');
  assert.equal(ok.newEpoch, 8, 'the restoration records its own new generation first');
});

// --- J4: L07 + L08 — duplicates, late restores and the missed-event full scan --------

test('J4 (L07+L08): duplicate events recover the same operation; the full scan catches the missed change from the real change time and refuses cursor replay', async () => {
  const rev = await import('../../lib/adapters/knowledge-revocation.js');
  const mkEvent = (reporter, at) => rev.buildRevocationEvent({
    kind: 'grant-expired', source: 'comet-source', observedAt: at, reporter, evidence: { grant: 'grant-pilot-002' },
  });
  const registry = { mappings: [{ knowledgeId: 'k-j4', sources: ['comet-source'], documentId: 'doc-j4', derived: [], attachments: [], caches: [] }] };
  const closure = rev.computeImpactClosure({ registry, event: mkEvent('collector:expiry-tick', '2026-10-21T11:00:00Z') });
  const state = { knowledge: [{ id: 'k-j4', epoch: 1, status: 'active' }], receipts: [], operations: [] };
  const first = rev.acceptRevocationEvent({ state, event: mkEvent('collector:expiry-tick', '2026-10-21T11:00:00Z'), closure, now: Date.parse('2026-10-21T11:00:03Z') });
  const dupe = rev.acceptRevocationEvent({ state: first.state, event: mkEvent('collector:webhook-retry', '2026-10-21T11:04:00Z'), closure, now: Date.parse('2026-10-21T11:04:02Z') });
  assert.equal(dupe.duplicate, true);
  assert.equal(dupe.state.operations.length, 1);
  // A late restore callback planned two generations ago is refused.
  const late = rev.evaluateRestoration({
    knowledge: { id: 'k-j4', epoch: first.operation.epoch, status: 'isolating' },
    authorization: { grantsValid: true, contentUseUntil: '2027-01-01T00:00:00Z', audienceWithinIntersection: true, offboardedSinceIsolation: [] },
    review: { verdict: 'pass', boundDigest: sha256('j4'), reviewedAt: '2026-10-21T10:00:00Z', reviewerPrincipal: REVIEWER },
    plan: { audience: [FIXTURE_GROUP] }, allowedAudience: [FIXTURE_GROUP],
    callbackEpoch: 1,
  });
  assert.equal(late.code, 'STALE_CALLBACK_REFUSED');
  // L08: the missed event — the real permission changed at 11:00; the scan at
  // 11:01:30 registers the SAME idempotent maintenance action, and detection
  // time is measured from the change, not the scan.
  const scan = rev.reconcileFullScan({
    registered: [{ knowledgeId: 'k-j4', sources: [{ domain: 'comet-source', expectedReaders: [FIXTURE_GROUP] }] }],
    observed: [{ knowledgeId: 'k-j4', domain: 'comet-source', currentReaders: [], changedAt: '2026-10-21T11:00:00Z' }],
    scanStartedAt: Date.parse('2026-10-21T11:01:30Z'),
  });
  assert.equal(scan.maintenanceActions.length, 1);
  assert.equal(scan.maintenanceActions[0].operationKey, first.operation.operationKey, 'the scan registers the SAME idempotent operation');
  assert.equal(scan.detection.latencyMs, 90_000, 'measured from the real source change');
  const cursorOnly = rev.reconcileFullScan({ registered: [], observed: [], scanStartedAt: 0, cursorOnly: true });
  assert.equal(cursorOnly.code, 'CURSOR_REPLAY_NOT_RECONCILIATION');
});

// --- J5: L09 + L10 + L11 — monitor, failure economics and the real fault injection ----

test('J5 (L09+L10+L11): independent alerts, first-failure economics, separated watermarks — and a real SIGKILL whose downtime stays inside the recorded exposure window', async () => {
  const rev = await import('../../lib/adapters/knowledge-revocation.js');
  // L09: heartbeat 95s stale alerts; a fresh heartbeat with a stalled scan
  // watermark alerts too; only restart-original is a supervisor action.
  const now = Date.parse('2026-10-21T12:00:00Z');
  const stale = rev.judgeMonitorThresholds({ heartbeatAt: now - 95_000, lastFullScanAt: now - 30_000, now });
  assert.ok(stale.alerts.some((a) => a.code === 'RUNNER_HEARTBEAT_STALE'));
  assert.equal(stale.isolated, false);
  const stall = rev.judgeMonitorThresholds({ heartbeatAt: now - 5_000, lastFullScanAt: now - 125_000, now });
  assert.ok(stall.alerts.some((a) => a.code === 'SCAN_WATERMARK_STALLED'));
  // L10: the first failure alerts at once; a permission denial escalates.
  const t0 = Date.parse('2026-10-21T12:00:00Z');
  const budgets = { isolationBudgetMs: 120_000, alertDeliveryMs: 30_000, fastMaxAttempts: 3, lowFrequencyRetryMs: 300_000 };
  const first = rev.judgeIsolationFailure({ failures: [{ at: t0 + 2_000, code: 'API_TIMEOUT' }], now: t0 + 3_000, budgets });
  assert.equal(first.alert.at, t0 + 2_000);
  assert.equal(first.owner, 'comet');
  const denied = rev.judgeIsolationFailure({ failures: [{ at: t0 + 2_000, code: 'PERMISSION_DENIED' }], now: t0 + 3_000, budgets });
  assert.equal(denied.retry, false);
  assert.equal(denied.escalate, 'owner');
  // L11: the recovery plan keeps the three watermarks separate and the
  // violations survive closure.
  const plan = rev.evaluateRecoveryReconciliation({
    proposedOrder: ['freeze-new-publish', 'reconcile-unknown-writes', 'full-snapshot-reconciliation', 'isolation-first-maintenance'],
    state: {
      eventReceiveCursor: 99, fullScanWatermark: '2026-10-21T11:30:00Z', isolationEvidenceCursor: 12,
      failedIsolations: [{ knowledgeId: 'k-j5' }],
      unknownWrites: [{ knowledgeId: 'k-j5', operation: 'shares.revoke', at: '2026-10-21T11:45:00Z' }],
    },
    violations: [{ code: 'END_TO_END_DEADLINE_VIOLATED', at: '2026-10-21T11:55:00Z' }],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.watermarks.eventReceiveCursor, 99);
  assert.equal(plan.watermarks.isolationEvidenceCursor, 12);
  assert.ok(plan.incident.violations.length === 1);

  // The real fault injection: a real worker mid-isolation, real SIGKILL,
  // confirmed termination, supervisor restart of the SAME instance, real
  // exposure window that keeps the downtime.
  const stateFile = path.join(scratch, 'j5-worker-state.json');
  const heartbeatFile = path.join(scratch, 'j5-worker-heartbeat.json');
  fs.writeFileSync(stateFile, JSON.stringify({ operationKey: 'km-j5-real', progress: 0, attempts: 0, status: 'isolating' }));
  const sourceChangedAt = Date.now();
  const worker = spawn(process.execPath, [workerPath, stateFile, heartbeatFile], { stdio: 'ignore' });
  const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const waitUntil = async (pred, ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return pred();
  };
  assert.equal(await waitUntil(() => readState().progress >= 1, 5_000), true);
  const exited = new Promise((resolve) => worker.on('exit', resolve));
  worker.kill('SIGKILL');
  await exited;
  const killedAt = Date.now();
  await new Promise((r) => setTimeout(r, 150));
  const staleHeartbeatAge = Date.now() - JSON.parse(fs.readFileSync(heartbeatFile, 'utf8')).at;
  assert.ok(staleHeartbeatAge >= 100, 'the heartbeat really went stale during the outage');
  const replacement = spawn(process.execPath, [workerPath, stateFile, heartbeatFile], { stdio: 'ignore' });
  const restartedAt = Date.now();
  try {
    assert.equal(await waitUntil(() => readState().status === 'completed', 10_000), true);
    const final = readState();
    assert.equal(final.operationKey, 'km-j5-real');
    const window = rev.computeExposureWindow({
      sourceChangedAt, isolatedAt: final.completedAt,
      faults: [{ from: killedAt, to: restartedAt, kind: 'runner-down' }],
      budgets: { endToEndTargetMs: 300_000, isolationBudgetMs: 120_000 },
    });
    assert.ok(window.exposureMs >= restartedAt - killedAt, 'the real downtime is inside the recorded window');
    assert.equal(window.pausedMs, 0);
  } finally {
    replacement.kill('SIGKILL');
  }
});
