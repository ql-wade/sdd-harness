// Outline adapter — the Knowledge.Closeout.v1 Kt side (task P4_4, E02/D06/E06).
//
// The thin judgment surface for team publication: it evaluates the
// KnowledgeAuthz.v1 authorization receipt (P4_7), executes exactly the
// directive the single Runtime emits for a registered publication operation
// (0003 knowledgePublishDirective — the adapter never decides the business
// next step), binds the fixed target identity, and builds the observation
// and closeout receipts the Runtime re-verifies. There is no second ledger
// here: the authoritative publication ledger is the Runtime's
// comet.classic.knowledge-publish.v1, read by evaluateKtFromLedger for the
// overall-completion predicate (D07: archived is not completed).
//
// Environment fact: no live Outline instance exists in this wave. The
// judgment layer (authorization binding, target identity, timeout-unknown,
// readback match) is the tested object; the live API write + readback stay
// honestly UNVERIFIED (successor: Outline owner + deployment verification
// wave).
import crypto from 'node:crypto';
import { KnowledgeCloseoutError } from './llmwiki.js';

export const KT_INTERFACE = 'Knowledge.Closeout.v1';

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Same canonical JSON as the committed KnowledgeAuthz.v1 (sorted keys, arrays
// in order): decisionId is reproducible across implementations.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// The exact receipt fields KnowledgeAuthz.v1 binds with decisionId.
const DECISION_RECEIPT_FIELDS = ['schemaVersion', 'interface', 'operation', 'payloadDigest', 'grants', 'audience', 'bindings', 'decidedAt', 'execution', 'readback', 'limits', 'provenance'];

// The target identity is fixed BEFORE the first request and derived
// deterministically from the logical entry: a retry re-targets the SAME
// document and can never mint a second logical page (H04/D06/E06).
export function deriveOutlineTargetId({ change, capability }) {
  if (!change || typeof change !== 'string' || !capability || typeof capability !== 'string') {
    throw new KnowledgeCloseoutError('KT_TARGET_INVALID', 'deriveOutlineTargetId requires change and capability');
  }
  // Formatted as a client UUID (the client chooses the UUID before the first
  // request, H04): the digest bytes render into the canonical 8-4-4-4-12 shape.
  const hex = sha256Hex(`${change}\u0000${capability}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// E02: publication requires a KnowledgePublishDecision.v1 receipt that is
// intact (decisionId covers every field), granted, bound to THIS payload
// digest (U04 version binding) and carried by a non-empty effective audience
// (the committed target audience is fail-closed empty — no live instance yet).
export function evaluatePublishAuthorization({ operation, decision }) {
  if (!operation?.payloadDigest) throw new KnowledgeCloseoutError('KT_OPERATION_INVALID', 'evaluatePublishAuthorization requires the publish operation');
  if (!decision || typeof decision !== 'object') {
    throw new KnowledgeCloseoutError('OUTLINE_AUTHZ_REQUIRED', 'publication requires a KnowledgePublishDecision.v1 authorization receipt (E02)');
  }
  if (decision.interface !== 'KnowledgePublishDecision.v1') {
    throw new KnowledgeCloseoutError('OUTLINE_AUTHZ_REQUIRED', `the receipt is ${String(decision.interface)}, not a KnowledgePublishDecision.v1 decision`);
  }
  const content = {};
  for (const field of DECISION_RECEIPT_FIELDS) {
    if (!(field in decision)) {
      throw new KnowledgeCloseoutError('TAMPERED_DECISION', `decision receipt field ${field} is missing; decisionId cannot be re-derived`);
    }
    content[field] = decision[field];
  }
  if (sha256Hex(stableStringify(content)) !== decision.decisionId) {
    throw new KnowledgeCloseoutError('TAMPERED_DECISION', 'decisionId does not cover the receipt fields; a tampered decision is invalid (U03)');
  }
  if (decision.verdict !== 'allow') {
    throw new KnowledgeCloseoutError('OUTLINE_AUTHZ_NOT_GRANTED', `the decision verdict is ${String(decision.verdict)}; publication requires allow`);
  }
  if (decision.payloadDigest !== operation.payloadDigest) {
    throw new KnowledgeCloseoutError('AUTHZ_PAYLOAD_MISMATCH', `the decision binds payload ${String(decision.payloadDigest).slice(0, 12)}… but this publication is ${String(operation.payloadDigest).slice(0, 12)}…; any payload change invalidates the old verdict (U04)`);
  }
  const effective = decision.audience?.effective;
  if (!Array.isArray(effective) || effective.length === 0) {
    throw new KnowledgeCloseoutError('OUTLINE_AUDIENCE_REQUIRED', 'the decision carries no effective target audience; the empty allowed audience stays fail-closed');
  }
  return { ok: true, decisionId: decision.decisionId };
}

// The adapter executes ONLY the runtime directive (create|update). A
// reconcile directive must never degrade into a create, and a directive for
// another document is never ours (E06: no re-created page, no second
// controller).
export function buildPublishRequest({ directive, operation, decision }) {
  if (!directive || (directive.action !== 'create' && directive.action !== 'update')) {
    throw new KnowledgeCloseoutError('DIRECTIVE_NOT_EXECUTABLE', `the runtime directive ${String(directive?.action)} is not an executable publication; follow it (read back / reconcile) instead of creating (D06/E06)`);
  }
  if (directive.documentId !== operation.documentId) {
    throw new KnowledgeCloseoutError('TARGET_ID_MISMATCH', `the directive targets ${String(directive.documentId)} but the registered operation owns ${String(operation.documentId)}; the target identity is fixed before the first request`);
  }
  const { ok, decisionId } = evaluatePublishAuthorization({ operation, decision });
  if (!ok) throw new KnowledgeCloseoutError('OUTLINE_AUTHZ_REQUIRED', 'publication requires an allow decision');
  return Object.freeze({
    interface: 'OutlinePublish.v1',
    tool: directive.action === 'create' ? 'documents.create' : 'documents.update',
    documentId: operation.documentId,
    collection: operation.collection,
    payloadDigest: operation.payloadDigest,
    audience: decision.audience,
    decisionId,
  });
}

// D06/H04: a write timeout is recorded as unknown — it is never absence, so
// the next directive can only be a readback of the fixed document.
export function buildTimeoutObservation({ operation, at }) {
  if (!operation?.operationKey || !operation?.documentId) {
    throw new KnowledgeCloseoutError('KT_OPERATION_INVALID', 'buildTimeoutObservation requires the registered operation');
  }
  return { operationKey: operation.operationKey, documentId: operation.documentId, outcome: 'unknown', at };
}

// The independent readback observation: the digest binds THIS operation's
// registered payload; different bytes are a conflict for reconciliation.
export function buildReadbackObservation({ operation, revision, readbackDigest }) {
  if (!operation?.operationKey || !operation?.documentId) {
    throw new KnowledgeCloseoutError('KT_OPERATION_INVALID', 'buildReadbackObservation requires the registered operation');
  }
  if (typeof revision !== 'string' || revision.length === 0 || !/^[a-f0-9]{64}$/.test(readbackDigest ?? '')) {
    throw new KnowledgeCloseoutError('READBACK_INVALID', 'buildReadbackObservation requires the observed revision and sha256 readback digest');
  }
  return {
    operationKey: operation.operationKey,
    documentId: operation.documentId,
    outcome: readbackDigest === operation.payloadDigest ? 'exists' : 'conflict',
    revision,
    readbackDigest,
  };
}

// The closeout receipt is built ONLY from a confirmed independent readback.
export function buildCloseoutReceipt({ operation, observation, execution, recordedAt }) {
  if (!operation?.documentId) throw new KnowledgeCloseoutError('KT_OPERATION_INVALID', 'buildCloseoutReceipt requires the registered operation');
  if (typeof execution !== 'string' || execution.length === 0) {
    throw new KnowledgeCloseoutError('KP_EXECUTION_REQUIRED', 'buildCloseoutReceipt requires the closing execution identity (the Runtime K dispatch)');
  }
  const outcome = observation?.outcome;
  if (outcome === 'unknown' || !outcome) {
    throw new KnowledgeCloseoutError('PUBLICATION_UNKNOWN', 'the publication result is unknown; read the original target back first — unknown stays blocked (D06)');
  }
  if (outcome === 'absent') {
    throw new KnowledgeCloseoutError('PUBLICATION_ABSENT', 'the readback confirmed the document absent; publication has not happened');
  }
  if (outcome === 'conflict') {
    throw new KnowledgeCloseoutError('READBACK_CONFLICT', 'the remote content drifted from the registered payload; reconcile before recording (H05)');
  }
  if (outcome !== 'exists' || observation.readbackDigest !== operation.payloadDigest) {
    throw new KnowledgeCloseoutError('READBACK_MISMATCH', 'the readback does not match the registered payload; a stale publication is never accepted');
  }
  return {
    targetKind: 'external',
    target: operation.documentId,
    revision: observation.revision,
    readbackDigest: observation.readbackDigest,
    execution,
    recordedAt,
  };
}

// The Kt completion predicate over the SINGLE runtime publish ledger
// (comet.classic.knowledge-publish.v1). Registered-but-unknown stays blocked
// (idempotent resume: read back first); only a published operation whose
// independent readback digest matches the frozen candidate satisfies.
export function evaluateKtFromLedger({ required, ledger }) {
  const operations = Array.isArray(ledger?.operations) ? ledger.operations : null;
  if (operations === null) {
    throw new KnowledgeCloseoutError('KT_LEDGER_INVALID', 'evaluateKtFromLedger requires a comet.classic.knowledge-publish.v1 ledger');
  }
  const satisfied = [];
  const blocked = [];
  for (const entry of required ?? []) {
    const ops = operations.filter((op) => op.knowledgeId === entry.capability);
    if (ops.length === 0) {
      blocked.push({ capability: entry.capability, code: 'NO_PUBLISH_OPERATION', reason: 'no publish operation is registered for this obligation in the runtime ledger' });
      continue;
    }
    const published = ops.find((op) => op.state === 'published'
      && op.payloadDigest === entry.digest
      && op.lastObservation?.outcome === 'exists'
      && op.lastObservation?.readbackDigest === entry.digest);
    if (published) {
      satisfied.push({ capability: entry.capability, documentId: published.documentId, revision: published.lastObservation.revision });
      continue;
    }
    const conflict = ops.find((op) => op.state === 'conflict');
    if (conflict) {
      blocked.push({ capability: entry.capability, code: 'PUBLICATION_CONFLICT', reason: `operation ${String(conflict.operationKey).slice(0, 12)}… is in conflict; reconcile the remote readback (H05)` });
      continue;
    }
    const drifted = ops.find((op) => op.state === 'published' && op.lastObservation?.readbackDigest !== entry.digest);
    if (drifted) {
      blocked.push({ capability: entry.capability, code: 'KT_DIGEST_MISMATCH', reason: `published content read back as ${String(drifted.lastObservation?.readbackDigest).slice(0, 12)}…, not the frozen candidate` });
      continue;
    }
    blocked.push({ capability: entry.capability, code: 'PUBLICATION_UNKNOWN', reason: `operation ${String(ops[0].operationKey).slice(0, 12)}… is ${ops[0].state} with outcome ${String(ops[0].lastObservation?.outcome)}; read the fixed document back first — unknown is never absence (D06)` });
  }
  return { ok: blocked.length === 0, satisfied, blocked };
}

// C06: the Kt side of the knowledge boundary (see lib/adapters/llmwiki.js).
export function refuseCrossSourceEvidence({ channel, evidenceSource }) {
  const sources = ['builtin-memory', 'llmwiki', 'outline', 'code-wiki'];
  if (!sources.includes(channel)) {
    throw new KnowledgeCloseoutError('CHANNEL_INVALID', `unknown knowledge channel ${String(channel)}`);
  }
  if (channel === evidenceSource) return { allowed: true };
  return {
    allowed: false,
    code: 'KNOWLEDGE_SOURCE_SUBSTITUTION',
    reason: `${String(evidenceSource)} evidence cannot satisfy a ${channel} obligation: the knowledge sources are distinct unique sources that never cover or replace each other (C06)`,
  };
}
