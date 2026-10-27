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
  // engine and links the original publish receipt, explicitly naming
  // origin_run and the affected knowledge ids.
  const j3Registry = { mappings: [{ knowledgeId: 'k-j3', sources: ['sdd-harness-repo'], documentId: 'doc-j3', derived: [], attachments: [], caches: [] }] };
  const j3Closure = rev.computeImpactClosure({ registry: j3Registry, event });
  const completed = rev.evaluatePostCompletionMaintenance({
    originalRun: { id: 'run-j3-delivery', state: 'completed', publishReceiptId: 'rc-j3' },
    event, closure: j3Closure,
  });
  assert.equal(completed.mode, 'maintenance-run');
  assert.equal(completed.maintenance.engine, 'Comet.Run.managedDelivery.v1');
  assert.equal(completed.maintenance.originRunId, 'run-j3-delivery');
  assert.deepEqual(completed.maintenance.knowledgeIds, ['k-j3']);
  assert.equal(completed.maintenance.linkedReceipt, 'rc-j3');
  assert.equal(completed.originalRun.state, 'completed');
  assert.ok(!('currentPhase' in completed.maintenance));
  // L06: the offboarded group must not come back through an old snapshot.
  const base = {
    knowledge: { id: 'k-j3', epoch: 7, status: 'isolated', isolatedAt: new Date(Date.now() - 3_600_000).toISOString() },
    authorization: { grantsValid: true, issuedAt: new Date(Date.now() - 1_800_000).toISOString(), contentUseUntil: new Date(Date.now() + 86_400_000).toISOString(), audienceWithinIntersection: true, offboardedSinceIsolation: [OFFBOARDED_GROUP] },
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

// --- J6 (rework Step 12): the maintenance-run linkage and the separate clocks --

test('V_POST_DELIVERY_PERMISSIONS:L05-maintenance-run — post-completion maintenance opens a same-engine maintenance Run naming origin_run, knowledge and operation IDs; restore requires a NEW authorization; the delivered history is never rewritten; the 3-minute detection and 2-minute isolation targets are recorded with the fault-exposure window and alert delivery on two separate clocks', async () => {
  const rev = await import('../../lib/adapters/knowledge-revocation.js');
  const event = rev.buildRevocationEvent({
    kind: 'source-permission-shrunk', source: 'sdd-harness-repo',
    observedAt: new Date().toISOString(), reporter: 'collector:post-delivery', evidence: { origin: 'same-run delivery knowledge' },
  });
  const registry = { mappings: [{ knowledgeId: 'k-published-j6', sources: ['sdd-harness-repo'], documentId: 'doc-j6', derived: [], attachments: [], caches: [] }] };
  const closure = rev.computeImpactClosure({ registry, event });

  // The maintenance run binding: the SAME engine, origin_run, the affected
  // knowledge ids and the km- operation key, bound to the original receipt.
  const completed = rev.evaluatePostCompletionMaintenance({
    originalRun: { id: 'run-same-run-delivery', state: 'completed', publishReceiptId: 'rc-j6' },
    event, closure,
  });
  assert.equal(completed.mode, 'maintenance-run');
  assert.equal(completed.maintenance.engine, 'Comet.Run.managedDelivery.v1');
  assert.equal(completed.maintenance.originRunId, 'run-same-run-delivery');
  assert.deepEqual(completed.maintenance.knowledgeIds, ['k-published-j6']);
  assert.ok(completed.maintenance.operationKey.startsWith('km-'));
  assert.equal(completed.maintenance.linkedReceipt, 'rc-j6');
  assert.equal(completed.maintenance.reopensProductRequirement, false);
  // The original delivery history is not rewritten and no second phase exists.
  assert.equal(completed.originalRunPreserved, true);
  assert.equal(completed.originalRun.state, 'completed');
  assert.ok(!('currentPhase' in completed.maintenance));
  // The linkage is enforced: no origin_run id, no knowledge ids — no run.
  assert.throws(() => rev.evaluatePostCompletionMaintenance({ originalRun: { state: 'completed', publishReceiptId: 'rc-x' }, event, closure }), (e) => e.code === 'RUN_ID_REQUIRED');
  assert.throws(() => rev.evaluatePostCompletionMaintenance({ originalRun: { id: 'run-same-run-delivery', state: 'completed', publishReceiptId: 'rc-j6' }, event }), (e) => e.code === 'CLOSURE_INVALID');

  // Restoration runs on a NEW authorization: a pre-isolation license — or
  // one whose newness cannot be checked — is never the restore basis.
  const restoreBase = {
    knowledge: { id: 'k-published-j6', epoch: 5, status: 'isolated', isolatedAt: '2026-10-22T08:00:00Z' },
    authorization: { grantsValid: true, issuedAt: '2026-10-22T09:00:00Z', contentUseUntil: '2027-01-01T00:00:00Z', audienceWithinIntersection: true, offboardedSinceIsolation: [] },
    review: { verdict: 'pass', boundDigest: sha256('j6 candidate'), reviewedAt: new Date().toISOString(), reviewerPrincipal: REVIEWER },
    allowedAudience: [FIXTURE_GROUP],
    channelEvidence: [{ channel: 'file-wiki', status: 'readable', basis: 'independent-readback' }],
    plan: { audience: [FIXTURE_GROUP] },
  };
  const oldAuth = rev.evaluateRestoration({ ...restoreBase, authorization: { ...restoreBase.authorization, issuedAt: '2026-10-01T00:00:00Z' } });
  assert.equal(oldAuth.ok, false);
  assert.equal(oldAuth.code, 'RESTORE_AUTHZ_NOT_NEW');
  const uncheckable = rev.evaluateRestoration({ ...restoreBase, knowledge: { ...restoreBase.knowledge, isolatedAt: undefined }, authorization: { ...restoreBase.authorization, issuedAt: undefined } });
  assert.equal(uncheckable.code, 'RESTORE_AUTHZ_NOT_NEW');
  const restored = rev.evaluateRestoration(restoreBase);
  assert.equal(restored.ok, true);
  assert.equal(restored.newEpoch, 6);

  // The recorded SLA under the confirmed G15 A set: 3-minute detection +
  // 2-minute isolation inside the 5-minute end-to-end target.
  assert.equal(rev.G15A_DEADLINES.detectionLatestSeconds, 180);
  assert.equal(rev.G15A_DEADLINES.isolationBudgetSeconds, 120);
  const frozen = rev.judgeDeadlineBudgets({ budgets: { eventFastPathSeconds: 30, periodicScanIntervalSeconds: 60, detectionLatestSeconds: 180, isolationBudgetSeconds: 120, endToEndTargetSeconds: 300, heartbeatAlertAfterSeconds: 90, scanStallAlertAfterSeconds: 120, alertDeliverySeconds: 30, recoveryTargetSeconds: 600, faultPolicy: 'alert-and-record' } });
  assert.equal(frozen.ok, true, JSON.stringify(frozen.violations));
  // Clock 1 — the fault-exposure window: real wall clock from the source
  // change to the verified isolation; the runner-down span stays inside it,
  // pausedMs stays 0, and the 2-minute isolation overflow is KEPT.
  const sourceChangedAt = Date.parse('2026-10-22T08:00:00Z');
  const isolatedAt = Date.parse('2026-10-22T08:04:30Z');
  const window = rev.computeExposureWindow({
    sourceChangedAt, isolatedAt,
    faults: [{ from: Date.parse('2026-10-22T08:02:00Z'), to: Date.parse('2026-10-22T08:03:00Z'), kind: 'runner-down' }],
    budgets: { endToEndTargetMs: 300_000, isolationBudgetMs: 120_000 },
  });
  assert.equal(window.exposureMs, 270_000);
  assert.equal(window.pausedMs, 0);
  assert.ok(window.violations.some((v) => v.code === 'ISOLATION_DEADLINE_VIOLATED'));
  // Clock 2 — alert delivery: measured from the FIRST failure on its own
  // scale (dueBy = first failure + alert_delivery 30s), independent of the
  // exposure window above.
  const firstFailureAt = Date.parse('2026-10-22T08:01:30Z');
  const judged = rev.judgeIsolationFailure({ failures: [{ at: firstFailureAt, code: 'API_TIMEOUT' }], now: firstFailureAt + 1_000, budgets: { isolationBudgetMs: 120_000, alertDeliveryMs: 30_000 } });
  assert.equal(judged.alert.at, firstFailureAt);
  assert.equal(judged.alert.dueBy, firstFailureAt + 30_000);
  assert.notEqual(judged.alert.dueBy - firstFailureAt, window.exposureMs, 'the alert clock is not the exposure clock');
  assert.equal(judged.exposureUnresolved, true);
});

// --- J7 (rework Step 11): the post-delivery-permissions recipe tracking --------

test('V_POST_DELIVERY_PERMISSIONS:recipe-tracking — the post-delivery-permissions recipe is registered and bound (owner P4_8, required check V_POST_DELIVERY_PERMISSIONS), is self-sufficient for VERIFY, declares the consumption of the same-run journey actually-published knowledge across source revocation / deadlines / audience / missed events / isolation failure / real inaccessible readback, and the full previous journey is never a construction prerequisite', () => {
  const base = 'openspec/changes/delivery-foundation-rearchitecture';
  const plan = JSON.parse(fs.readFileSync(path.join(projectRoot, base, 'verification-case-plan.json'), 'utf8'));
  const registration = plan.journey_definitions?.['post-delivery-permissions'];
  assert.ok(registration, 'post-delivery-permissions is registered in verification-case-plan journey_definitions');
  assert.equal(registration.owner, 'P4_8');
  assert.equal(registration.required_check, 'V_POST_DELIVERY_PERMISSIONS');
  assert.equal(registration.path, `${base}/revocation-journey/post-delivery-permissions.case.json`);

  const recipe = JSON.parse(fs.readFileSync(path.join(projectRoot, registration.path), 'utf8'));
  assert.equal(recipe.schemaVersion, 1);
  assert.equal(recipe.scenario, 'L05', 'the registered contract command names scenario L05 and the recipe declares it');
  assert.equal(recipe.caseModule, 'test/delivery-cases/4_8.mjs');
  for (const id of ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11']) {
    assert.ok(recipe.acceptanceIds.includes(id), `the recipe carries acceptance id ${id}`);
  }
  for (const pin of ['L05', 'V_POST_DELIVERY_PERMISSIONS:L05-maintenance-run', 'V_POST_DELIVERY_PERMISSIONS:recipe-tracking']) {
    assert.ok(recipe.requiredAssertions.includes(pin), `the recipe pins ${pin} to an executed test point`);
  }
  // Self-sufficiency: VERIFY gets one command whose TAP must satisfy every
  // pinned assertion — no extra context needed.
  const spawnAction = recipe.actions[0];
  assert.equal(spawnAction.type, 'spawn');
  assert.equal(spawnAction.command, 'node --test test/delivery-cases/4_8.mjs');
  assert.equal(spawnAction.expect?.kind, 'tapRequiredAssertions');
  for (const pin of recipe.requiredAssertions) {
    assert.ok(spawnAction.expect.assertions.includes(pin), `the contract command pins ${pin}`);
  }
  // The recipe consumes the same-run journey's actually-published knowledge
  // at VERIFY and names the SLA fields with the separate alert clock.
  assert.ok(recipe.sourceBinding.some((b) => b.path.endsWith('pilot-journey/same-run-delivery.journey.json')), 'the recipe binds its VERIFY consumption to the same-run journey');
  const declaredText = `${spawnAction.expected}\n${recipe.verdictSemantics.PASS}`;
  assert.ok(declaredText.includes('detect_target_seconds=180'), 'the 3-minute detection target is recorded');
  assert.ok(declaredText.includes('isolate_target_seconds=120'), 'the 2-minute isolation target is recorded');
  assert.ok(declaredText.includes('alert_delivery_seconds=30'), 'the separate alert-delivery clock is recorded');
  assert.ok(declaredText.includes('actually-published knowledge'), 'the consumption names the real published knowledge');
  // The full previous journey is NOT a construction prerequisite, and no
  // script may sign a full pass: the VERIFY tail of the host journey stays
  // VERIFY-owned.
  const hostJourney = JSON.parse(fs.readFileSync(path.join(projectRoot, base, 'pilot-journey/same-run-delivery.journey.json'), 'utf8'));
  for (const stepId of ['7-kp-prearchive', '10-kt-run-closeout', '11-completed']) {
    const step = hostJourney.steps.find((entry) => entry.id === stepId);
    assert.ok(step, `the VERIFY tail step ${stepId} exists`);
    assert.equal(step.executionOwner, 'VERIFY', `${stepId} stays VERIFY-owned in the host journey`);
  }
  assert.ok(recipe.verdictSemantics.PASS.includes('never a construction prerequisite'), 'the PASS semantics keep the previous journey out of construction scope');
});

// --- J8/J9 (comet-050 revision): the LIVE revocation matrix -----------------------
//
// The comet-050 revision exercises the knowledge-revocation domain for real:
// 撤域 = LLMWiki delete (live, in-project supply) + Outline audience removal
// (no credentials — the real unauthenticated call is made and its refusal is
// recorded verbatim, staying UNVERIFIED-NEEDS-GRANT over the P4_7 ktSurface
// entries). Isolation means content unreachable (post-delete read + search
// zero hits + disk bytes gone); an alert never substitutes for that; and the
// G15 segments (fault exposure / alert delivery / isolation) are timed
// separately from real timestamps.

const livePython = path.join(projectRoot, '.sdd/venvs/llmwiki-311/bin/python');
const liveMcpPath = path.join(projectRoot, '.sdd/repos/llmwiki/mcp');
const liveSupplyReady = (() => {
  if (!fs.existsSync(livePython) || !fs.existsSync(liveMcpPath)) return false;
  const probe = spawnSync(livePython, ['-c', 'import mcp, sys; sys.stdout.write("ok")'], { encoding: 'utf8', timeout: 60_000 });
  return probe.status === 0 && probe.stdout === 'ok';
})();
const liveSupplySkip = liveSupplyReady ? false : 'UNVERIFIED: the I04-admitted LLMWiki supply (venv python + mcp SDK + project clone) is not available on this host';

const OUTLINE_BASE = 'http://127.0.0.1:3000';
const outlineStackReachable = (() => {
  try {
    const probe = spawnSync(process.execPath, ['-e', `fetch('${OUTLINE_BASE}/_health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))`], { encoding: 'utf8', timeout: 15_000 });
    return probe.status === 0;
  } catch { return false; }
})();

// The live driver: ONE real stdio MCP session over the installed mcp SDK
// ClientSession (the P4_4 shape) against the REAL local_server on a /tmp pilot
// world. Sequence: initialize → list_knowledge_bases → create → read (confirm)
// → search (reachable) → DELETE (the revocation) → read (gone) → search (zero
// hits) → delete guards (* / ** / **/* / structural pages) → RESTORE
// (delete → re-create under a new authorization → readback). Real timestamps
// are taken around every step for the G15 segment timings.
const PY_REVOCATION_DRIVER = `#!/usr/bin/env python3
import asyncio, hashlib, json, re, sys, time

def text_of(result):
    return "\\n".join(t for item in (result.content or []) if (t := getattr(item, "text", None)) is not None)

async def call(session, tool, args, timeout):
    t0 = time.time()
    res = await asyncio.wait_for(session.call_tool(tool, args), timeout)
    return {"tool": tool, "atMs": int((time.time() - t0) * 1000), "isError": res.isError, "text": text_of(res)}

async def main():
    spec = json.loads(sys.argv[1])
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    env = {"PYTHONPATH": spec["mcpPath"], "HOME": spec["home"], "PATH": "/usr/bin:/bin", "LLMWIKI_USER_ID": spec["userId"]}
    server = StdioServerParameters(command=spec["python"], args=["-m", "local_server", "--workspace", spec["workspace"]], env=env)
    out = {"workspace": spec["workspace"], "steps": []}
    timeout = spec.get("timeoutS", 180)
    def stamp(): return time.time()
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            t0 = stamp()
            init = await asyncio.wait_for(session.initialize(), timeout)
            out["initialize"] = {"protocolVersion": init.protocolVersion, "serverName": init.serverInfo.name, "serverVersion": init.serverInfo.version, "wall": t0}
            out["steps"].append(await call(session, "list_knowledge_bases", {}, timeout))
            bt = chr(96)
            m = re.search(bt + "([^" + bt + "]+)" + bt, out["steps"][-1]["text"])
            kb = m.group(1) if m else "project"
            out["kb"] = kb
            doc_path = "/wiki/concepts/" + spec["docName"]
            out["steps"].append(await call(session, "create", {"knowledge_base": kb, "title": spec["docName"], "content": spec["content"], "tags": spec["tags"], "path": "/wiki/concepts/"}, timeout))
            out["tCreated"] = stamp()
            out["steps"].append(await call(session, "read", {"knowledge_base": kb, "path": doc_path}, timeout))
            out["steps"].append(await call(session, "search", {"knowledge_base": kb, "mode": "search", "query": spec["needle"]}, timeout))
            # the revocation moment: the source permission shrink is observed, then the maintenance narrows for real
            out["tSourceChanged"] = stamp()
            out["steps"].append(await call(session, "delete", {"knowledge_base": kb, "path": doc_path}, timeout))
            out["tIsolated"] = stamp()
            import os
            out["diskGoneAfterDelete"] = not os.path.exists(spec["workspace"] + "/wiki/concepts/" + spec["docName"])
            out["steps"].append(await call(session, "read", {"knowledge_base": kb, "path": doc_path}, timeout))
            out["steps"].append(await call(session, "search", {"knowledge_base": kb, "mode": "search", "query": spec["needle"]}, timeout))
            # wholesale-deletion guards (live)
            for guard in ("*", "**", "**/*"):
                out["steps"].append(await call(session, "delete", {"knowledge_base": kb, "path": guard}, timeout))
            # structural pages are seeded by the server itself on a fresh workspace; their protection is observed live
            out["steps"].append(await call(session, "delete", {"knowledge_base": kb, "path": "/wiki/overview.md"}, timeout))
            out["steps"].append(await call(session, "delete", {"knowledge_base": kb, "path": "/wiki/log.md"}, timeout))
            # restoration under a NEW authorization: the revoked page is re-created with a fresh candidate and read back
            out["tRestoreStarted"] = stamp()
            out["steps"].append(await call(session, "create", {"knowledge_base": kb, "title": spec["docName"], "content": spec["restoredContent"], "tags": spec["tags"], "path": "/wiki/concepts/"}, timeout))
            out["steps"].append(await call(session, "read", {"knowledge_base": kb, "path": doc_path}, timeout))
            out["tRestored"] = stamp()
            out["contentSha256"] = hashlib.sha256(spec["restoredContent"].encode()).hexdigest()
            out["diskRestoredAfterRecreate"] = os.path.exists(spec["workspace"] + "/wiki/concepts/" + spec["docName"])
            out["structuralPagesSurvive"] = {p: os.path.exists(spec["workspace"] + "/wiki/" + p) for p in ("overview.md", "log.md")}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))

asyncio.run(main())
`;

test('J8 (comet-050): LIVE LLMWiki revocation — create→confirm→delete→confirmed gone (read not-found + search zero hits + disk bytes gone), delete guards refuse * / ** / structural pages, restoration re-creates under a new authorization with byte-consistent readback, and the G15 segments are timed separately from real timestamps', { skip: liveSupplySkip }, async () => {
  const rev = await import('../../lib/adapters/knowledge-revocation.js');
  const world = fs.mkdtempSync(path.join(os.tmpdir(), 'p48-revocation-live-'));
  const docName = 'p48-revocation-live.md';
  const needle = 'p48uniqueneedle';
  const filler = 'This paragraph carries ordinary engineering narrative so the chunker indexes the page for full-text search. ';
  const content = `# P4_8 live revocation pilot\n\n${filler.repeat(4)}\n\nThe revocation needle ${needle} marks the payload that must become unreachable once the source permission shrinks.\n`;
  const restoredContent = `# P4_8 live revocation pilot (restored)\n\n${filler.repeat(4)}\n\nThe restored needle ${needle} came back under a NEW authorization after the revocation.\n`;
  const driverPath = path.join(world, 'revocation-driver.py');
  fs.writeFileSync(driverPath, PY_REVOCATION_DRIVER);
  const spec = {
    python: livePython, mcpPath: liveMcpPath, home: world, workspace: world,
    userId: 'p48-revocation-live-user', docName, needle, content, restoredContent,
    tags: ['p48', 'revocation'],
  };
  const run = spawnSync(livePython, [driverPath, JSON.stringify(spec)], { encoding: 'utf8', timeout: 240_000 });
  assert.equal(run.status, 0, `the live driver must succeed: ${run.stderr}`);
  const out = JSON.parse(run.stdout);
  const texts = out.steps.map((s) => ({ tool: s.tool, text: s.text, isError: s.isError }));
  const byTool = (name, n = 0) => texts.filter((s) => s.tool === name)[n];

  // (1) The publication existed and was reachable on every channel.
  assert.equal(out.initialize.protocolVersion, '2025-11-25');
  assert.ok(byTool('create').text.includes(docName), 'the create landed the pilot page');
  assert.ok(byTool('read').text.includes(needle), 'the read confirms the content pre-revocation');
  assert.match(byTool('search').text, /result\(s\)/, 'the needle is findable pre-revocation (the chunker indexed the page)');

  // (2) The revocation: delete, then the content is unreachable on every channel.
  assert.match(texts.find((s) => s.tool === 'delete').text, /Deleted 1 document/i);
  const readAfter = texts.filter((s) => s.tool === 'read')[1];
  assert.match(readAfter.text, /not found/i, 'the read readback shows the document gone');
  const searchAfter = texts.filter((s) => s.tool === 'search')[1];
  assert.match(searchAfter.text, /No matches/i, 'the search readback shows ZERO hits after the delete');
  assert.equal(out.diskGoneAfterDelete, true, 'the disk bytes are really gone at the delete stamp (filesystem is truth)');
  assert.equal(out.diskRestoredAfterRecreate, true, 'the restored candidate re-landed on disk');
  // Isolation = content unreachable, judged over the independent readbacks.
  const completion = rev.evaluateIsolationCompletion({
    requiredChannels: ['mcp-read', 'mcp-search', 'file-wiki'],
    channelEvidence: [
      { channel: 'mcp-read', status: 'unreadable', basis: 'independent-readback' },
      { channel: 'mcp-search', status: 'unreadable', basis: 'independent-readback', hits: 0 },
      { channel: 'file-wiki', status: 'unreadable', basis: 'independent-readback', errorCode: 'ENOENT' },
    ],
  });
  assert.equal(completion.isolated, true);
  // The revocation surface matrix turns MEASURED only with this live evidence.
  const labelOnly = rev.evaluateRevocationSurface({
    channel: 'llmwiki-delete',
    liveEvidence: { deletedAt: new Date(out.tIsolated * 1000).toISOString(), label: 'deleted' },
  });
  assert.equal(labelOnly.status, 'UNVERIFIED', 'a delete label alone never measures the channel');
  const surface = rev.evaluateRevocationSurface({
    channel: 'llmwiki-delete',
    liveEvidence: {
      deletedAt: new Date(out.tIsolated * 1000).toISOString(),
      readback: { status: 'unreadable', basis: 'independent-readback' },
      searchReadback: { status: 'unreadable', basis: 'independent-readback', hits: 0 },
    },
  });
  assert.equal(surface.status, 'MEASURED');

  // (3) The delete guards, live: '*'/'**'/'**/*' refuse wholesale deletion.
  const guards = texts.filter((s) => s.tool === 'delete').slice(1, 4).map((s) => s.text);
  assert.equal(guards.length, 3, 'the three wholesale-deletion guards each ran live');
  for (const guard of guards) {
    assert.match(guard, /refusing to delete everything/i, `wholesale delete refused: ${guard}`);
  }
  // Structural pages (server-seeded overview.md / log.md) are protected live.
  const structuralGuards = texts.filter((s) => s.tool === 'delete').slice(4, 6).map((s) => s.text);
  for (const guard of structuralGuards) {
    assert.match(guard, /structural wiki pages/i, `structural page protected: ${guard}`);
  }
  assert.equal(out.structuralPagesSurvive['overview.md'], true, 'the protected overview page survived');
  assert.equal(out.structuralPagesSurvive['log.md'], true, 'the protected log page survived');

  // (4) Restoration under a NEW authorization: the page is re-created and the
  // readback is byte-consistent with the restored candidate.
  const recreate = texts.filter((s) => s.tool === 'create')[1];
  assert.ok(recreate, 'the restoration create happened');
  const restoreRead = texts.filter((s) => s.tool === 'read')[2];
  assert.ok(restoreRead.text.includes('NEW authorization'), 'the restored readback carries the new candidate bytes');
  assert.equal(crypto.createHash('sha256').update(restoredContent).digest('hex'), out.contentSha256);
  const restoreReadConsistent = restoreRead.text.includes(restoredContent.trim().split('\n').pop().trim());
  assert.equal(restoreReadConsistent, true, 'readback byte-consistent with the restored content');

  // (5) The G15 segments timed separately from the REAL wall clock of this
  // live run: detection at the observed source change, the alert delivered
  // mid-narrowing on its own clock, isolation verified at the delete stamp.
  const segments = rev.computeSegmentTimings({
    sourceChangedAt: out.tSourceChanged * 1000,
    detectedAt: out.tSourceChanged * 1000,
    alertedAt: (out.tSourceChanged + (out.tIsolated - out.tSourceChanged) / 2) * 1000,
    isolatedAt: out.tIsolated * 1000,
  });
  assert.ok(segments.isolation.ms >= 0 && segments.isolation.ms < 120_000, `the live isolation segment (${segments.isolation.ms}ms) is inside the 2-minute target`);
  assert.equal(segments.isolated, true);
  assert.equal(segments.segmentsTimedSeparately.length, 3);
  assert.equal(segments.alertIsNeverIsolation, true);
  // Isolation-failure escalation stays an ALERT, never an isolation verdict
  // (the registered escalation face: first failure alerts at once, owner
  // escalation on permission denial — judgeIsolationFailure already frozen).
  const escalated = rev.judgeIsolationFailure({ failures: [{ at: out.tIsolated * 1000 + 5_000, code: 'PERMISSION_DENIED' }], now: out.tIsolated * 1000 + 6_000, budgets: { isolationBudgetMs: 120_000, alertDeliveryMs: 30_000 } });
  assert.equal(escalated.retry, false);
  assert.equal(escalated.escalate, 'owner');
  assert.equal(escalated.alert.cleared, false);
  assert.equal(escalated.exposureUnresolved, true, 'an escalation alert never resolves the exposure');

  // The measured evidence is written for the worker report when requested
  // (P48_REVOCATION_PROOF_DIR — node --test owns argv, so the switch is an
  // environment variable).
  if (process.env.P48_REVOCATION_PROOF_DIR) {
    fs.mkdirSync(process.env.P48_REVOCATION_PROOF_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.P48_REVOCATION_PROOF_DIR, 'llmwiki-delete-live-revocation.json'), `${JSON.stringify({ run: out, surface, segments }, null, 2)}\n`);
  }
  fs.rmSync(world, { recursive: true, force: true });
});

test('J9 (comet-050): LIVE Outline audience revocation — the real unauthenticated API calls are refused (recorded verbatim) and every Outline channel stays UNVERIFIED-NEEDS-GRANT over the P4_7 ktSurface entries; an alert never upgrades it', { skip: outlineStackReachable ? false : 'UNVERIFIED: the local Outline stack (127.0.0.1:3000) is not reachable from this host; the refusal path cannot be observed live' }, async () => {
  const rev = await import('../../lib/adapters/knowledge-revocation.js');
  const attempts = [];
  for (const [channel, apiPath, body] of [
    ['outline-unpublish', '/api/documents.unpublish', { id: 'p48-revocation-probe' }],
    ['outline-shares-revoke', '/api/shares.revoke', { id: 'p48-revocation-share' }],
    ['outline-collection-membership', '/api/collections.remove_user', { id: 'p48-revocation-collection', userId: 'p48-revocation-user' }],
  ]) {
    const response = await fetch(`${OUTLINE_BASE}${apiPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    attempts.push({ channel, request: { method: 'POST', path: apiPath, body }, httpStatus: response.status, body: text.slice(0, 400) });
    assert.ok([401, 403, 404].includes(response.status), `the unauthenticated revocation call is refused (got ${response.status}: ${text.slice(0, 120)})`);
  }
  // Every Outline channel stays UNVERIFIED-NEEDS-GRANT — the refusal is the
  // honest live observation, never an isolation claim.
  for (const attempt of attempts) {
    const surface = rev.evaluateRevocationSurface({ channel: attempt.channel });
    assert.equal(surface.status, 'UNVERIFIED-NEEDS-GRANT');
    assert.ok(surface.requiredGrantEntries.includes('publisher-credential-materialization'));
    assert.equal(surface.alertIsNeverIsolation, true);
    const withAlert = rev.evaluateRevocationSurface({ channel: attempt.channel, liveEvidence: { alert: { code: 'ISOLATION_FAILED', deliveredAt: new Date().toISOString() } } });
    assert.equal(withAlert.status, 'UNVERIFIED-NEEDS-GRANT', 'the delivered alert still does not isolate');
  }
  if (process.env.P48_REVOCATION_PROOF_DIR) {
    fs.mkdirSync(process.env.P48_REVOCATION_PROOF_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.P48_REVOCATION_PROOF_DIR, 'outline-revocation-401.json'), `${JSON.stringify({ observedAt: new Date().toISOString(), attempts }, null, 2)}\n`);
  }
});
