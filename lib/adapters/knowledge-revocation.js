// Knowledge revocation & restoration adapter (task P4_8, acceptance L01–L11,
// spec knowledge-revocation-and-restoration.md — G14 A event + periodic
// reconciliation chosen, G15 A confirmed: 5-minute resource-side isolation
// target under normal dependencies, fault overrun recorded with the exposure
// window, never a paused clock).
//
// Judgment + protocol layer only, in the P4_4 adapter shape (llmwiki.js /
// outline.js): this module owns no phase, no ledger and no retry loop. The
// single Comet engine (Comet.Run.managedDelivery.v1) keeps RunState/lock/
// transaction and the only currentPhase; collectors submit facts and never
// actions; the isolation executor narrows only what a separately
// preauthorized owner-issued isolation grant covers (ISOLATION_GRANT_REQUIRED
// — a publish grant never implies ACL power, P4_7 authorization-model.json
// isolator role); the independent monitor (I07 semantics, same frozen
// deadlines) alerts but never dispatches; the supervisor only restarts the
// original instance (I08 fencing: confirm the old writer is gone first).
//
// Reused, not rebuilt: the P4_7 KnowledgeAuthz.v1 CLI stays the real
// grant/revocation entrance (the journey drives decide → revoke → recheck);
// the deadline set below mirrors I07 monitor CONTRACT_DEADLINES; exposure
// arithmetic follows the I08 real-clock discipline.
//
// Environment facts, honestly: no live Outline instance, no web credentials,
// no network egress in this sandbox. The local channels are REAL (file-system
// wiki bytes, a real stdio JSON-RPC MCP handshake process in isolated
// config — the llmwiki venv launcher is absent here). The Outline
// web/share/search/attachment channels are contract-level only: the adapter
// builds the real request shape and reports UNVERIFIED with the successor;
// a stale/unpublish/archive label is never evidence of unreadability and no
// remote readback is fabricated (L02).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export const REVOCATION_INTERFACE = 'KnowledgeRevocation.v1';

export class KnowledgeRevocationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KnowledgeRevocationError';
    this.code = code;
  }
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

// G15 A frozen budgets (knowledge-revocation-and-restoration.md §8). These
// mirror tools/infra/monitor.mjs CONTRACT_DEADLINES — one deadline set, not
// two. They are the confirmed TARGET under normal dependencies, not a
// guaranteed bound under fault: faults are recorded as violations with the
// exposure window kept open (faultPolicy: alert-and-record).
export const G15A_DEADLINES = Object.freeze({
  policy: 'G15-A',
  faultPolicy: 'alert-and-record',
  eventFastPathSeconds: 30,
  periodicScanIntervalSeconds: 60,
  periodicScanMaxSeconds: 60,
  detectionLatestSeconds: 180,
  sourceQueryVisibilitySeconds: 60,
  scanWaitSeconds: 60,
  fullScanSeconds: 60,
  isolationBudgetSeconds: 120,
  endToEndTargetSeconds: 300,
  heartbeatIntervalSeconds: 30,
  monitorCheckIntervalSeconds: 30,
  heartbeatAlertAfterSeconds: 90,
  scanStallAlertAfterSeconds: 120,
  runnerFaultDetectionLatestSeconds: 120,
  alertDeliverySeconds: 30,
  restartWindowSeconds: 300,
  restartMax: 3,
  recoveryTargetSeconds: 600,
});

// The isolation capability covers narrowing ONLY (spec §2): revoke shares,
// remove users/groups, move into an approved isolation domain, unpublish or
// archive. Never delete, never restore, never enlarge, never re-share.
const NARROWING_ACTION_CEILING = Object.freeze(['shares.revoke', 'documents.remove_user', 'documents.remove_group', 'documents.move', 'documents.unpublish', 'documents.archive']);
const FORBIDDEN_ISOLATION_ACTIONS = Object.freeze(['documents.delete', 'documents.restore', 'documents.share', 'shares.create', 'acl.change', 'membership.change', 'collection.create', 'documents.publish']);

// The three event classes of spec §1 (source shrink / target widening /
// preauthorization expiry) map onto two idempotent maintenance classes: one
// operation per (source domain, maintenance class).
const EVENT_KINDS = Object.freeze(['source-permission-shrunk', 'target-audience-widened', 'grant-expired', 'grant-revoked', 'content-use-expired']);
const MAINTENANCE_CLASS = Object.freeze({
  'source-permission-shrunk': 'source-revocation',
  'grant-expired': 'source-revocation',
  'grant-revoked': 'source-revocation',
  'content-use-expired': 'source-revocation',
  'target-audience-widened': 'target-widening',
});

const maintenanceOperationKey = (sourceDomain, maintenanceClass) => `km-${sha256Hex(`${sourceDomain}\u0000${maintenanceClass}`).slice(0, 16)}`;

// --- 4.8.a: G15 A freezing and the isolation preauthorization ---------------------

// Judges a proposed budget set against the confirmed G15 A ceilings. A budget
// that pauses the clock on fault — or claims a hard bound under fault (G15 B)
// — is invalid: overrun must surface as a recorded violation instead.
export function judgeDeadlineBudgets({ budgets } = {}) {
  const violations = [];
  const add = (code, field, extra) => violations.push({ code, at: field, ...(extra ?? {}) });
  if (!budgets || typeof budgets !== 'object') {
    return { ok: false, violations: [{ code: 'BUDGETS_REQUIRED', at: 'budgets' }] };
  }
  const ceilings = [
    ['eventFastPathSeconds', 30, 'FASTPATH_BUDGET_EXCEEDED'],
    ['periodicScanIntervalSeconds', 60, 'SCAN_INTERVAL_EXCEEDED'],
    ['detectionLatestSeconds', 180, 'DETECTION_BUDGET_EXCEEDED'],
    ['isolationBudgetSeconds', 120, 'ISOLATION_BUDGET_EXCEEDED'],
    ['endToEndTargetSeconds', 300, 'END_TO_END_BUDGET_EXCEEDED'],
    ['heartbeatAlertAfterSeconds', 90, 'HEARTBEAT_THRESHOLD_EXCEEDED'],
    ['scanStallAlertAfterSeconds', 120, 'SCAN_STALL_THRESHOLD_EXCEEDED'],
    ['alertDeliverySeconds', 30, 'ALERT_DELIVERY_EXCEEDED'],
    ['recoveryTargetSeconds', 600, 'RECOVERY_TARGET_EXCEEDED'],
  ];
  for (const [field, ceiling, code] of ceilings) {
    const value = Number(budgets[field]);
    if (!Number.isFinite(value)) { add('MISSING_BUDGET_FIELD', field); continue; }
    if (value > ceiling) add(code, field, { proposed: value, ceiling });
  }
  if (budgets.faultPolicy !== 'alert-and-record') {
    add('FAULT_POLICY_INVALID', 'faultPolicy', { proposed: budgets.faultPolicy ?? null, reason: 'G15 A records fault overrun as a violation with the exposure window kept open; pausing the clock or claiming a hard fault bound is a different (rejected) posture' });
  }
  return {
    ok: violations.length === 0,
    target: {
      policy: 'G15-A',
      endToEndTargetSeconds: budgets.endToEndTargetSeconds ?? null,
      detectionLatestSeconds: budgets.detectionLatestSeconds ?? null,
      isolationBudgetSeconds: budgets.isolationBudgetSeconds ?? null,
    },
    faultPolicy: budgets.faultPolicy ?? null,
    violations,
  };
}

// ISOLATION_GRANT_REQUIRED: resource-side narrowing needs a SEPARATE
// owner-issued isolation grant. "Allowed to publish" never derives "allowed
// to change permissions" (spec §2); the executor must be the registered
// isolator principal (P4_7 authorization-model roles.isolator), the grant
// must be currently valid on the real clock, cover the target, and its
// action set must stay inside the narrowing ceiling.
export function evaluateIsolationPreauthorization({ grant, executorPrincipal, target, now = Date.now() } = {}) {
  if (!grant || typeof grant !== 'object') {
    return { ok: false, code: 'ISOLATION_GRANT_REQUIRED', reason: 'no isolation grant is registered: narrowing access requires a separate owner preauthorization that a publish grant never implies' };
  }
  if (grant.kind !== 'isolation') {
    return { ok: false, code: 'PUBLISH_GRANT_NOT_ISOLATION_AUTH', reason: `the referenced grant is of kind ${String(grant.kind)}; publication authorization never includes ACL power` };
  }
  const actions = Array.isArray(grant.actions) ? grant.actions : [];
  const forbidden = actions.filter((action) => FORBIDDEN_ISOLATION_ACTIONS.includes(action) || !NARROWING_ACTION_CEILING.includes(action));
  if (forbidden.length > 0) {
    return { ok: false, code: 'ISOLATION_SCOPE_INVALID', reason: `isolation covers narrowing only; ${forbidden.join(', ')} ${forbidden.length === 1 ? 'is' : 'are'} outside the preauthorized action set (no delete, no restore, no enlarge)` };
  }
  const issuedAt = Date.parse(grant.issuedAt ?? '');
  const expiresAt = Date.parse(grant.expiresAt ?? '');
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt >= expiresAt) {
    return { ok: false, code: 'ISOLATION_GRANT_INVALID', reason: 'the isolation grant has no valid issuedAt/expiresAt window' };
  }
  if (now > expiresAt) {
    return { ok: false, code: 'ISOLATION_GRANT_EXPIRED', reason: 'the isolation grant has expired on the real clock; expiry never auto-renews' };
  }
  if (grant.revocation) {
    return { ok: false, code: 'ISOLATION_GRANT_REVOKED', reason: `the isolation grant was revoked at ${String(grant.revocation.revokedAt)}` };
  }
  if (!Array.isArray(grant.targets) || !grant.targets.includes(target)) {
    return { ok: false, code: 'ISOLATION_TARGET_OUT_OF_SCOPE', reason: `target ${String(target)} is not among the preauthorized isolation objects` };
  }
  if (executorPrincipal !== grant.executor) {
    return { ok: false, code: 'ISOLATOR_PRINCIPAL_REQUIRED', reason: `only the registered isolator principal may execute narrowing; ${String(executorPrincipal)} is not it (the publisher never narrows)` };
  }
  return { ok: true, actions: [...actions], executor: grant.executor, grantId: grant.id ?? null };
}

// --- 4.8.b: event and periodic reconciliation entrances ---------------------------

// The collector entrance: verifies the event shape and returns the FACT for
// Comet. The collector registers facts and resource ids — it never carries a
// business action, never writes ACL and never maintains phase (spec §2). An
// event that smuggles an action field is refused outright.
export function buildRevocationEvent({ kind, source, observedAt, reporter, evidence, action } = {}) {
  if (action !== undefined) {
    return { code: 'COLLECTOR_OVERSTEP_REFUSED', reason: 'the collector submits facts only; business actions (isolate/restore/dispatch) belong to the single Comet engine' };
  }
  if (!EVENT_KINDS.includes(kind)) {
    throw new KnowledgeRevocationError('EVENT_KIND_INVALID', `unknown revocation event kind ${String(kind)}; expected one of ${EVENT_KINDS.join(', ')}`);
  }
  if (!source || typeof source !== 'string') throw new KnowledgeRevocationError('EVENT_SOURCE_INVALID', 'the event must name the affected source domain or target');
  if (!Number.isFinite(Date.parse(observedAt ?? ''))) throw new KnowledgeRevocationError('EVENT_TIME_INVALID', 'the event must carry an ISO observedAt timestamp');
  if (!reporter || typeof reporter !== 'string') throw new KnowledgeRevocationError('EVENT_REPORTER_INVALID', 'the event must name its collector/reporter identity');
  return Object.freeze({
    interface: REVOCATION_INTERFACE,
    kind,
    source,
    observedAt,
    reporter,
    evidence: evidence ?? {},
  });
}

// The impact closure (spec §3): source ID → candidates/review → entries →
// documents → derived entries/attachments/caches. Multi-source objects are
// affected by ANY failed source; an object whose source mapping cannot be
// proven makes the boundary unprovable: the managed domain conservatively
// pauses and the closure never claims completeness over the gap.
export function computeImpactClosure({ registry, event } = {}) {
  if (!Array.isArray(registry?.mappings)) {
    throw new KnowledgeRevocationError('REGISTRY_INVALID', 'computeImpactClosure requires a registry with a mappings array');
  }
  const affected = [];
  const derivedArtifacts = [];
  const unmapped = [];
  for (const mapping of registry.mappings) {
    if (!Array.isArray(mapping.sources)) {
      unmapped.push(mapping.knowledgeId);
      continue;
    }
    if (mapping.sources.includes(event.source)) {
      affected.push(mapping.knowledgeId);
      derivedArtifacts.push(...(mapping.derived ?? []), ...(mapping.attachments ?? []), ...(mapping.caches ?? []));
    }
  }
  return {
    affected,
    derivedArtifacts,
    unmapped,
    conservativePause: unmapped.length > 0,
    complete: unmapped.length === 0,
    reason: unmapped.length > 0
      ? 'the impact boundary is unprovable for the unmapped objects: the managed domain conservatively pauses instead of reporting partial coverage as complete'
      : null,
  };
}

// Comet's acceptance of a collector fact: current receipts of the closure go
// stale, managed reads and publishing pause, and ONE maintenance operation is
// registered (or recovered — duplicates never mint a second operation). A new
// maintenance generation (epoch) is recorded; the status is
// needs-revalidation, never isolated: resource-side verification has not
// happened yet (L01).
export function acceptRevocationEvent({ state, event, closure, now = Date.now() } = {}) {
  if (!state || !Array.isArray(state.operations) || !Array.isArray(state.knowledge)) {
    throw new KnowledgeRevocationError('STATE_INVALID', 'acceptRevocationEvent requires the Comet-side state { knowledge, receipts, operations }');
  }
  if (!event || event.interface !== REVOCATION_INTERFACE) {
    throw new KnowledgeRevocationError('EVENT_INVALID', 'acceptRevocationEvent requires an event built by buildRevocationEvent');
  }
  if (!closure || !Array.isArray(closure.affected)) {
    throw new KnowledgeRevocationError('CLOSURE_INVALID', 'acceptRevocationEvent requires the impact closure');
  }
  const maintenanceClass = MAINTENANCE_CLASS[event.kind];
  const operationKey = maintenanceOperationKey(event.source, maintenanceClass);
  const existing = state.operations.find((op) => op.operationKey === operationKey);
  if (existing) {
    return {
      duplicate: true,
      operation: existing,
      state,
      staledReceipts: [],
      pauses: { managedReads: [...closure.affected], publishing: [event.source] },
      note: 'duplicate/out-of-order submission recovered the SAME operation against trusted current facts',
    };
  }
  const affectedSet = new Set(closure.affected);
  const nextEpoch = 1 + Math.max(0, ...state.knowledge.filter((k) => affectedSet.has(k.id)).map((k) => Number(k.epoch) || 0));
  const operation = {
    operationKey,
    maintenanceClass,
    kind: event.kind,
    source: event.source,
    affects: [...closure.affected],
    status: 'needs-revalidation',
    epoch: nextEpoch,
    attempts: 0,
    createdAt: now,
  };
  const staledReceipts = (state.receipts ?? []).filter((r) => affectedSet.has(r.knowledgeId) && r.state === 'valid');
  const nextState = {
    knowledge: state.knowledge.map((k) => affectedSet.has(k.id) ? { ...k, epoch: nextEpoch, status: 'needs-revalidation' } : k),
    receipts: (state.receipts ?? []).map((r) => affectedSet.has(r.knowledgeId) && r.state === 'valid' ? { ...r, state: 'staled' } : r),
    operations: [...state.operations, operation],
  };
  return {
    duplicate: false,
    operation,
    state: nextState,
    staledReceipts,
    pauses: { managedReads: [...closure.affected], publishing: [event.source] },
  };
}

// The periodic full reconciliation (spec §8 周期兜底, L08/L11): every
// REGISTERED source of every registered object is compared against the
// observed current permission — not the event cursor. Detection time is
// measured from the real permission change (changedAt), never from
// notification arrival. Registered-but-unobserved sources are unknown, not
// fine. A successful scan never clears failed isolation objects.
export function reconcileFullScan({ registered, observed, scanStartedAt, failedIsolations = [], cursorOnly = false } = {}) {
  if (cursorOnly) {
    return { code: 'CURSOR_REPLAY_NOT_RECONCILIATION', reason: 'replaying the event receive cursor is not reconciliation: every registered resource must be covered by the full scan' };
  }
  if (!Array.isArray(registered)) {
    throw new KnowledgeRevocationError('SCAN_INPUT_INVALID', 'reconcileFullScan requires the registered set');
  }
  const observations = new Map((Array.isArray(observed) ? observed : []).map((o) => [`${o.knowledgeId}\u0000${o.domain}`, o]));
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\u0001') === [...b].sort().join('\u0001');
  const maintenanceActions = [];
  const unknown = [];
  const diffTimes = [];
  for (const entry of registered) {
    for (const source of entry.sources ?? []) {
      const observedEntry = observations.get(`${entry.knowledgeId}\u0000${source.domain}`);
      if (!observedEntry) {
        unknown.push({ knowledgeId: entry.knowledgeId, domain: source.domain, reason: 'the scan could not observe this registered source: unknown, never fine' });
        continue;
      }
      if (!sameSet(observedEntry.currentReaders ?? [], source.expectedReaders ?? [])) {
        maintenanceActions.push({
          knowledgeId: entry.knowledgeId,
          domain: source.domain,
          operationKey: maintenanceOperationKey(source.domain, 'source-revocation'),
          detectedFrom: observedEntry.changedAt,
        });
        diffTimes.push(Date.parse(observedEntry.changedAt));
      }
    }
  }
  const sourceChangedAt = diffTimes.length > 0 ? Math.min(...diffTimes) : null;
  const acceptedAt = Number.isFinite(scanStartedAt) ? scanStartedAt : null;
  return {
    maintenanceActions,
    unknown,
    detection: sourceChangedAt === null ? null : { sourceChangedAt, acceptedAt, latencyMs: acceptedAt - sourceChangedAt },
    carriedFailures: [...failedIsolations],
  };
}

// Real wall-clock exposure arithmetic (G15 A): the window runs from the real
// permission change to the verified isolation. Fault downtime is recorded as
// a fault and STAYS inside the window — pausedMs is structurally 0; a budget
// overrun is a kept violation, never a reason to stop the clock.
export function computeExposureWindow({ sourceChangedAt, isolatedAt, faults = [], budgets } = {}) {
  if (!Number.isFinite(sourceChangedAt) || !Number.isFinite(isolatedAt)) {
    throw new KnowledgeRevocationError('WINDOW_INPUT_INVALID', 'computeExposureWindow requires real sourceChangedAt and isolatedAt timestamps');
  }
  const exposureMs = Math.max(0, isolatedAt - sourceChangedAt);
  const violations = [];
  if (Number.isFinite(budgets?.endToEndTargetMs) && exposureMs > budgets.endToEndTargetMs) {
    violations.push({ code: 'END_TO_END_DEADLINE_VIOLATED', budgetMs: budgets.endToEndTargetMs, actualMs: exposureMs });
  }
  if (Number.isFinite(budgets?.isolationBudgetMs) && exposureMs > budgets.isolationBudgetMs) {
    violations.push({ code: 'ISOLATION_DEADLINE_VIOLATED', budgetMs: budgets.isolationBudgetMs, actualMs: exposureMs });
  }
  return {
    exposureMs,
    pausedMs: 0,
    faults: [...faults],
    violations,
    note: 'the clock never pauses: fault spans are recorded facts inside the window, and deadline violations are kept on the incident record',
  };
}

// --- 4.8.c: resource-side isolation and re-proven restoration ---------------------

// The two deadlines (spec §1, L03/L04): publish_until gates NEW publication
// only; content_use_until gates the continued disclosure of already
// published content. Unclear continuous-use semantics never auto-publish
// (fail-closed, no default forever). A source revocation always recomputes
// the current disclosure condition — an unexpired old grant never overrides
// it — and an audience outside the current intersection forces isolation.
export function judgeTwoDeadlines({ publishUntil, contentUseUntil, now = Date.now(), audienceWithinIntersection = true, sourceRevoked = false } = {}) {
  const newPublish = (publishUntil !== undefined && now > Date.parse(publishUntil)) || sourceRevoked ? 'blocked' : 'allowed';
  if (contentUseUntil === undefined) {
    return { newPublish: 'blocked', autoPublish: 'blocked', existingContent: 'blocked', code: 'NO_CONTINUOUS_USE_SEMANTICS', reason: 'a grant without explicit continuous-use semantics never enters auto publication and is not permanent by default' };
  }
  if (sourceRevoked) {
    return { newPublish: 'blocked', existingContent: 'must-isolate', code: 'SOURCE_REVOKED_RECOMPUTE', reason: 'a source permission revocation always recomputes the current disclosure condition; an unexpired old grant never overrides it' };
  }
  if (audienceWithinIntersection !== true) {
    return { newPublish: 'blocked', existingContent: 'must-isolate', code: 'AUDIENCE_OUTSIDE_INTERSECTION', reason: 'the current target audience no longer sits inside the allowed disclosure intersection' };
  }
  if (now > Date.parse(contentUseUntil)) {
    return { newPublish: 'blocked', existingContent: 'must-isolate', code: 'CONTENT_USE_EXPIRED', reason: 'the continuous disclosure license has expired: old publish receipts stop counting and access narrows per the granted isolation capability' };
  }
  return { newPublish, existingContent: 'may-continue', code: null };
}

// Isolation completion (L02): a channel counts as constrained ONLY on an
// independent readback showing it unreadable. Labels (stale/unpublish/
// archive/moved) are not evidence; admin visibility proves existence, never
// inaccessibility; unknown and UNVERIFIED channels leave the object
// isolating under the SAME operation with alerts — the verdict is never
// faked to isolated.
export function evaluateIsolationCompletion({ requiredChannels, channelEvidence, labelStatus = null } = {}) {
  if (!Array.isArray(requiredChannels) || requiredChannels.length === 0) {
    throw new KnowledgeRevocationError('CHANNELS_REQUIRED', 'evaluateIsolationCompletion requires the required channel list for this object');
  }
  const evidenceByChannel = new Map((Array.isArray(channelEvidence) ? channelEvidence : []).map((e) => [e.channel, e]));
  const alerts = [];
  const uncoveredChannels = [];
  let allUnreadable = true;
  for (const channel of requiredChannels) {
    const evidence = evidenceByChannel.get(channel);
    if (!evidence) {
      uncoveredChannels.push(channel);
      allUnreadable = false;
      continue;
    }
    if (evidence.status === 'readable') {
      alerts.push({ code: 'CHANNEL_STILL_READABLE', channel, basis: evidence.basis ?? null });
      allUnreadable = false;
      continue;
    }
    if (evidence.status === 'unreadable' && evidence.basis === 'admin-observation') {
      alerts.push({ code: 'ADMIN_READ_IS_NOT_ISOLATION', channel, reason: 'an administrator still reading proves the object exists; it never proves others cannot read' });
      allUnreadable = false;
      continue;
    }
    if (evidence.status === 'unreadable' && evidence.basis === 'independent-readback') {
      continue;
    }
    // unknown / UNVERIFIED / any other basis: uncovered, never isolated.
    uncoveredChannels.push(channel);
    allUnreadable = false;
  }
  const isolated = allUnreadable && uncoveredChannels.length === 0 && alerts.length === 0;
  return {
    status: isolated ? 'isolated' : 'isolating',
    isolated,
    alerts,
    uncoveredChannels,
    sameOperationContinues: !isolated,
    labelStatus,
    labelIsEvidence: false,
    note: isolated ? null : 'uncovered or still-readable channels keep the object isolating under the same operation; a label never substitutes for an independent readback',
  };
}

// Restoration (L06): everything is re-proven against the CURRENT world. The
// new epoch is recorded before execution; the plan derives from the current
// allowed intersection (an old ACL snapshot is never replayed); principals
// offboarded since isolation are never re-added; a restore callback planned
// against an older generation is refused — revocation precedes old restores.
export function evaluateRestoration({ knowledge, authorization, review, plan, allowedAudience, channelEvidence, callbackEpoch } = {}) {
  if (!knowledge || typeof knowledge.epoch !== 'number') {
    throw new KnowledgeRevocationError('RESTORE_INPUT_INVALID', 'evaluateRestoration requires the isolated knowledge object with its epoch');
  }
  if (callbackEpoch !== undefined && callbackEpoch < knowledge.epoch) {
    return { ok: false, code: 'STALE_CALLBACK_REFUSED', reason: `the restore callback was planned against generation ${callbackEpoch} but the object is at generation ${knowledge.epoch}: a newer isolation generation is never overridden by an old restore` };
  }
  if (authorization?.grantsValid !== true) {
    return { ok: false, code: 'RESTORE_AUTHZ_INVALID', reason: 'restoration requires currently valid source owner/delegate authorization' };
  }
  if (authorization.contentUseUntil === undefined || Date.now() > Date.parse(authorization.contentUseUntil)) {
    return { ok: false, code: 'RESTORE_CONTENT_USE_EXPIRED', reason: 'the continuous disclosure license must currently hold for restoration' };
  }
  if (authorization.audienceWithinIntersection !== true) {
    return { ok: false, code: 'RESTORE_AUDIENCE_OUTSIDE_INTERSECTION', reason: 'the current target audience must sit inside the allowed intersection' };
  }
  if (!review || review.verdict !== 'pass') {
    return { ok: false, code: 'RESTORE_REVIEW_REQUIRED', reason: 'restoration re-runs the current authorization and knowledge review — removing a stale label is never enough' };
  }
  const offboarded = new Set(authorization.offboardedSinceIsolation ?? []);
  const planned = plan?.audience ?? [];
  const readded = planned.filter((principal) => offboarded.has(principal));
  if (readded.length > 0) {
    return { ok: false, code: 'OFFBOARDED_PRINCIPAL_READD', reason: `the plan re-adds offboarded principals (${readded.join(', ')}): an old ACL snapshot is never replayed` };
  }
  const allowed = new Set(allowedAudience ?? []);
  const outside = planned.filter((principal) => !allowed.has(principal));
  if (outside.length > 0) {
    return { ok: false, code: 'RESTORE_AUDIENCE_OUTSIDE_INTERSECTION', reason: `the plan exceeds the current allowed intersection (${outside.join(', ')})` };
  }
  const readbackOk = (Array.isArray(channelEvidence) ? channelEvidence : []).some((e) => e.status === 'readable' && e.basis === 'independent-readback');
  if (!readbackOk) {
    return { ok: false, code: 'RESTORE_READBACK_REQUIRED', reason: 'restoration requires an independent readback showing the required channels readable again' };
  }
  return {
    ok: true,
    status: 'active',
    newEpoch: knowledge.epoch + 1,
    audience: [...planned],
    note: 'the new maintenance generation is recorded before the restoration executes; only the independent readback turned it active',
  };
}

// Post-completion maintenance (L05): the original product Change stays
// delivered — its history is never rewritten. The SAME single engine opens a
// maintenance job linked to the original publish receipt; no product
// requirement is reopened and no watcher controller exists. An open run
// instead blocks its own closeout on the staled K receipt.
export function evaluatePostCompletionMaintenance({ originalRun, event } = {}) {
  if (!originalRun || typeof originalRun.state !== 'string') {
    throw new KnowledgeRevocationError('RUN_INVALID', 'evaluatePostCompletionMaintenance requires the original run record');
  }
  if (originalRun.state !== 'completed') {
    return { mode: 'same-run', blocked: ['K_RECEIPT_STALE_BLOCKS_CLOSEOUT'], note: 'the original run is still open: the staled knowledge receipt blocks its closeout on the same run' };
  }
  const maintenanceClass = event ? (MAINTENANCE_CLASS[event.kind] ?? 'source-revocation') : 'source-revocation';
  const source = event?.source ?? null;
  return {
    mode: 'maintenance-run',
    maintenance: {
      engine: 'Comet.Run.managedDelivery.v1',
      kind: 'knowledge-permission-maintenance',
      linkedReceipt: originalRun.publishReceiptId ?? null,
      operationKey: source === null ? null : maintenanceOperationKey(source, maintenanceClass),
      reopensProductRequirement: false,
    },
    originalRunPreserved: true,
    originalRun,
  };
}

// --- 4.8.d: fault economics, monitoring and recovery reconciliation ---------------

// Isolation failure economics (L10): the FIRST failure alerts immediately —
// never only after the budget is exhausted. Retries live inside the SAME
// Comet operation (the executor never owns a loop); a permission denial or
// revoked credential escalates to the owner instead of retrying; a 429
// honors Retry-After and records the budget violation; past the fast budget
// the operation drops to low-frequency retry with the alert not cleared and
// the exposure unresolved.
export function judgeIsolationFailure({ failures, now = Date.now(), budgets } = {}) {
  if (!Array.isArray(failures) || failures.length === 0) {
    throw new KnowledgeRevocationError('FAILURES_REQUIRED', 'judgeIsolationFailure requires the recorded failure list');
  }
  const first = failures[0];
  const last = failures[failures.length - 1];
  const alert = { code: 'ISOLATION_FAILED', at: first.at, cleared: false, dueBy: first.at + (budgets?.alertDeliveryMs ?? 30_000) };
  const base = { alert, owner: 'comet', exposureUnresolved: true, violations: [] };
  if (last.code === 'PERMISSION_DENIED' || last.code === 'CREDENTIAL_REVOKED') {
    return { ...base, retry: false, escalate: 'owner', reason: 'a permission denial or revoked credential goes to the empowered owner — it is never blindly retried' };
  }
  if (last.code === 'RATE_LIMITED') {
    const retryAfterMs = Number(last.retryAfterMs) || 0;
    const at = first.at + retryAfterMs;
    const violations = Number.isFinite(budgets?.isolationBudgetMs) && at - first.at > budgets.isolationBudgetMs
      ? [{ code: 'ISOLATION_BUDGET_EXCEEDED', budgetMs: budgets.isolationBudgetMs, projectedAttemptAt: at }]
      : [];
    return { ...base, retry: true, nextAttempt: { at, respectsRetryAfter: true, sameOperation: true }, violations };
  }
  const elapsed = now - first.at;
  if (Number.isFinite(budgets?.isolationBudgetMs) && elapsed > budgets.isolationBudgetMs) {
    return {
      ...base,
      retry: true,
      lowFrequency: { everyMs: budgets.lowFrequencyRetryMs ?? 300_000, sameOperation: true, alertNotCleared: true },
      violations: [{ code: 'ISOLATION_BUDGET_EXCEEDED', budgetMs: budgets.isolationBudgetMs, actualMs: elapsed }],
    };
  }
  return { ...base, retry: true, nextAttempt: { at: now + 30_000, sameOperation: true } };
}

// Monitor thresholds (L09, I07 semantics): a heartbeat older than 90s and a
// full-scan watermark stalled past 120s each alert — a fresh heartbeat never
// silences the scan-stall alert. The supervisor may only restart the
// ORIGINAL Comet instance; copying state or starting a second owner is
// refused. An alert delivered is never an isolation.
export function judgeMonitorThresholds({ heartbeatAt, lastFullScanAt, now = Date.now(), supervisorAction } = {}) {
  if (!Number.isFinite(heartbeatAt) || !Number.isFinite(lastFullScanAt)) {
    throw new KnowledgeRevocationError('MONITOR_INPUT_INVALID', 'judgeMonitorThresholds requires heartbeatAt and lastFullScanAt');
  }
  const alerts = [];
  const heartbeatAge = now - heartbeatAt;
  if (heartbeatAge > G15A_DEADLINES.heartbeatAlertAfterSeconds * 1000) {
    alerts.push({ code: 'RUNNER_HEARTBEAT_STALE', ageMs: heartbeatAge, thresholdMs: G15A_DEADLINES.heartbeatAlertAfterSeconds * 1000, dueBy: heartbeatAt + G15A_DEADLINES.heartbeatAlertAfterSeconds * 1000 });
  }
  const scanAge = now - lastFullScanAt;
  if (scanAge > G15A_DEADLINES.scanStallAlertAfterSeconds * 1000) {
    alerts.push({ code: 'SCAN_WATERMARK_STALLED', ageMs: scanAge, thresholdMs: G15A_DEADLINES.scanStallAlertAfterSeconds * 1000, note: 'the heartbeat can be fresh while the full-scan watermark is stalled — both facts are checked independently' });
  }
  const result = {
    alerts,
    isolated: false,
    note: 'alert delivery is not isolation: the monitor reports and alerts; only Comet plus resource-side verification isolates',
  };
  if (supervisorAction !== undefined) {
    result.supervisor = supervisorAction === 'restart-original'
      ? { allowed: true, action: supervisorAction, constraint: 'restart the ORIGINAL Comet instance only, after the old writer is confirmed terminated' }
      : { allowed: false, code: 'SUPERVISOR_OVERSTEP_REFUSED', action: supervisorAction, reason: 'the supervisor holds no business power: no state copy, no second owner, no phase change' };
  }
  return result;
}

// Recovery reconciliation (L11): after the original instance recovers, new
// publishing freezes FIRST, unknown remote writes reconcile BEFORE the full
// snapshot, and the full reconciliation registers idempotent
// isolation-first maintenance. The event receive cursor, the full-scan
// watermark and the isolation evidence stay three SEPARATE facts — one
// shared cursor is conflation and refused; a successful scan never clears
// failed isolations; the incident record keeps its violations.
const REQUIRED_RECOVERY_ORDER = Object.freeze(['freeze-new-publish', 'reconcile-unknown-writes', 'full-snapshot-reconciliation', 'isolation-first-maintenance']);

export function evaluateRecoveryReconciliation({ proposedOrder, state, violations = [] } = {}) {
  if (!state || typeof state !== 'object') {
    throw new KnowledgeRevocationError('RECOVERY_STATE_INVALID', 'evaluateRecoveryReconciliation requires the recovered state');
  }
  if (state.sharedCursor !== undefined) {
    return { ok: false, code: 'CURSOR_CONFLATION_REFUSED', reason: 'event receive cursor, full-scan watermark and isolation evidence are three separate facts; a single shared cursor conflates them' };
  }
  if (JSON.stringify(proposedOrder) !== JSON.stringify(REQUIRED_RECOVERY_ORDER)) {
    return { ok: false, code: 'RECOVERY_ORDER_INVALID', reason: `recovery must freeze new publishing, reconcile unknown writes, then run the full snapshot and isolation-first maintenance (in that order); got ${JSON.stringify(proposedOrder)}` };
  }
  return {
    ok: true,
    newPublishPaused: true,
    reconcilesUnknownWritesFirst: [...(state.unknownWrites ?? [])],
    watermarks: {
      eventReceiveCursor: state.eventReceiveCursor ?? null,
      fullScanWatermark: state.fullScanWatermark ?? null,
      isolationEvidenceCursor: state.isolationEvidenceCursor ?? null,
    },
    carriedFailures: [...(state.failedIsolations ?? [])],
    incident: {
      violations: [...violations],
      denominator: (state.unknownWrites ?? []).length + (state.failedIsolations ?? []).length,
      note: 'closure keeps every deadline violation on the record; objects without isolation evidence stay unknown',
    },
  };
}

// --- the real channel probe -------------------------------------------------------

const OUTLINE_SUCCESSOR = 'Outline owner + deployment verification wave (live web/share/search/attachment readback requires credentials absent in this sandbox)';

// Independent per-channel access probe. Local channels are REAL: the
// file-system wiki is read with real bytes, and the controlled MCP channel
// drives a REAL stdio JSON-RPC handshake process (initialize → initialized →
// tools/call) whose data lives on the real scratch wiki — the isolated-config
// substitute for the absent llmwiki venv launcher. A timeout is unknown,
// never unreadable (D06 family). External Outline web channels build the
// real request shape and stay honestly UNVERIFIED with the successor.
export async function probeChannelAccess({ channel, target, server, timeoutMs = 8_000 } = {}) {
  if (channel === 'file-wiki') {
    if (!target?.path) throw new KnowledgeRevocationError('PROBE_INPUT_INVALID', 'the file-wiki probe requires target.path');
    try {
      const content = await fs.readFile(target.path, 'utf8');
      return { channel, status: 'readable', basis: 'independent-readback', digest: sha256Hex(content) };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR') {
        return { channel, status: 'unreadable', basis: 'independent-readback', errorCode: error.code };
      }
      return { channel, status: 'unknown', basis: 'independent-readback', errorCode: error.code ?? null, reason: error.message };
    }
  }
  if (channel === 'controlled-mcp') {
    if (!server?.command || !target?.tool) throw new KnowledgeRevocationError('PROBE_INPUT_INVALID', 'the controlled-mcp probe requires server.command and target.tool');
    return invokeMcpProbe({ channel, target, server, timeoutMs });
  }
  if (channel === 'outline-direct-link') {
    return { channel, status: 'UNVERIFIED', request: { method: 'GET', url: target?.url ?? null }, successor: OUTLINE_SUCCESSOR };
  }
  if (channel === 'outline-share') {
    return { channel, status: 'UNVERIFIED', request: { method: 'POST', path: '/api/shares.info', body: { id: target?.shareId ?? null } }, successor: OUTLINE_SUCCESSOR };
  }
  if (channel === 'outline-search') {
    return { channel, status: 'UNVERIFIED', request: { method: 'POST', path: '/api/documents.search', body: { query: target?.query ?? null } }, successor: OUTLINE_SUCCESSOR };
  }
  if (channel === 'outline-attachment') {
    return { channel, status: 'UNVERIFIED', request: { method: 'GET', url: target?.url ?? null }, successor: OUTLINE_SUCCESSOR };
  }
  throw new KnowledgeRevocationError('CHANNEL_INVALID', `unknown channel ${String(channel)}`);
}

// The real stdio JSON-RPC driver (the llmwiki.js invokeMcpPublish shape): a
// real child process, a real initialize handshake, a real tools/call and a
// real timeout kill of the whole process group.
function invokeMcpProbe({ channel, target, server, timeoutMs }) {
  const frames = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sdd-knowledge-revocation', version: '0.1.0' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: target.tool, arguments: target.arguments ?? {} } }),
  ];
  return new Promise((resolve) => {
    const child = spawn(server.command, server.args ?? [], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
      resolve({ channel, ...result });
    };
    const timer = setTimeout(() => finish({
      status: 'unknown',
      code: 'MCP_TIMEOUT',
      basis: 'independent-readback',
      guidance: 'the probe timed out: unknown is never unreadable — resolve by an independent readback before any verdict',
    }), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ status: 'unknown', code: 'LAUNCHER_ENOENT', basis: 'independent-readback', reason: error.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      finish({ status: 'unknown', code: 'LAUNCHER_EXIT_NONZERO', basis: 'independent-readback', exitCode: code });
    });
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      for (const line of stdout.split('\n')) {
        if (!line.includes('"id":2')) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame?.id !== 2) continue;
        clearTimeout(timer);
        try {
          const payload = JSON.parse(frame.result?.content?.[0]?.text ?? '{}');
          if (target.tool === 'read') {
            finish(payload.found
              ? { status: 'readable', basis: 'independent-readback', digest: payload.digest ?? null }
              : { status: 'unreadable', basis: 'independent-readback', errorCode: 'NOT_FOUND' });
          } else {
            const hits = Array.isArray(payload.hits) ? payload.hits : [];
            finish(hits.length > 0
              ? { status: 'readable', basis: 'independent-readback', hits }
              : { status: 'unreadable', basis: 'independent-readback', hits: [] });
          }
        } catch {
          finish({ status: 'unknown', code: 'RESPONSE_UNPARSEABLE', basis: 'independent-readback' });
        }
        return;
      }
    });
    for (const frame of frames) child.stdin?.write(`${frame}\n`);
  });
}
