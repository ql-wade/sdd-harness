// Evidence admission and identity binding for the delivery foundation
// (tasks 2.2.a / 2.2.c, A05/A06/A18/A19-local, B03/B07).
//
// Boundary (delivery-architecture.md section 4): a digest proves content
// binding only — origin trust is decided here, against a dispatch record
// issued by the trusted launcher. This is the local equivalent of
// Runner.Dispatch.v1: the launcher binds run/gate/input/policy/attempt/epoch
// with a keyed digest (HMAC-SHA256). Envelope role labels, origin strings and
// env strings grant nothing; a worker process without the launcher secret
// cannot mint a dispatch (spawnSync children inherit no identity). Real
// protected-Runner and release-key isolation are proven by real permission
// negatives on the managed Runner — the same-OS-account limitation means this
// module promises collaboration-grade checks locally, not tamper resistance.
//
// Pure evaluation only: refusals return an audit record for the caller's
// ledger; nothing is dispatched, written or phase-stored (SDD.Gate.v1).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { parseContract } from '../../contracts/delivery/index.js';

const SHA256_RE = /^[a-f0-9]{64}$/;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// Deterministic JSON: object keys sorted, arrays in order. Envelope digests
// must be stable across processes and key insertion orders.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

// Content digest of an evidence envelope (the GateReceipt evidence set and
// the audit trail both reference envelopes by this digest).
export function envelopeDigest(envelope) {
  return sha256(canonicalJson(envelope));
}

const DISPATCH_ROLES = ['verifier', 'test-author', 'builder'];

function dispatchShapeErrors(record) {
  const errors = [];
  const nonEmpty = (key) => {
    if (typeof record?.[key] !== 'string' || record[key].length === 0) errors.push(`${key}: must be a non-empty string`);
  };
  const shaField = (key) => {
    if (typeof record?.[key] !== 'string' || !SHA256_RE.test(record[key])) errors.push(`${key}: must be a sha256 hex digest`);
  };
  const positiveInt = (key) => {
    if (!Number.isInteger(record?.[key]) || record[key] < 1) errors.push(`${key}: must be an integer >= 1`);
  };
  nonEmpty('runnerId');
  nonEmpty('run');
  nonEmpty('gate');
  nonEmpty('role');
  nonEmpty('execution');
  shaField('inputDigest');
  shaField('policyDigest');
  shaField('integrity');
  positiveInt('attempt');
  if (record?.actionBinding !== undefined) {
    if (!Number.isInteger(record.epoch) || record.epoch < 0) errors.push('epoch: must be an integer >= 0');
    const parsed = parseContract('SDD.Delivery.ActionBinding', record.actionBinding);
    if (!parsed.ok) errors.push(...parsed.errors.map((error) => `actionBinding: ${error}`));
    else for (const key of ['runnerId', 'run', 'gate', 'inputDigest', 'policyDigest', 'attempt', 'epoch', 'role', 'execution']) {
      if (record[key] !== parsed.value[key]) errors.push(`action binding disagrees with dispatch ${key}`);
    }
  } else positiveInt('epoch');
  return errors;
}

// The trusted launcher. The secret stays inside this closure: it is never a
// property of the returned object and never appears in issued records, so a
// spawned worker (which inherits no identity) cannot mint dispatch records.
export function createLaunchAuthority({ secret, sourceVerifier } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('createLaunchAuthority: secret must be a string of at least 32 characters');
  }
  const sign = (record) => createHmac('sha256', secret).update(canonicalJson(record)).digest('hex');
  const bindingOf = (record) => ({
    runnerId: record.runnerId,
    run: record.run,
    gate: record.gate,
    inputDigest: record.inputDigest,
    policyDigest: record.policyDigest,
    attempt: record.attempt,
    epoch: record.epoch,
    role: record.role,
    execution: record.execution,
    ...(record.actionBinding !== undefined ? { actionBinding: record.actionBinding } : {}),
  });
  const authority = {
    issueDispatch(binding) {
      const record = bindingOf(binding ?? {});
      const errors = dispatchShapeErrors({ ...record, integrity: sha256('placeholder') });
      if (errors.length > 0) {
        throw new Error(`issueDispatch: invalid dispatch binding — ${errors.join('; ')}`);
      }
      return { ...record, integrity: sign(record) };
    },
    async collectResult(args) {
      // This is an injected protected HOST CODE port, never a worker JSON
      // flag. It must read a registered source and verify actual execution
      // facts; echoing these expected fields is not source qualification.
      if (typeof sourceVerifier !== 'function') return { ok: false, error: 'SOURCE_UNQUALIFIED' };
      const prepared = collectionInputs(args, authority);
      if (!prepared.ok) return prepared;
      let observed;
      try { observed = await sourceVerifier({ ...args, expected: prepared.binding, actionBinding: args.dispatch.actionBinding }); }
      catch { return { ok: false, error: 'SOURCE_UNQUALIFIED' }; }
      if (!qualifiedObservation(observed, prepared.binding, args.envelope)) return { ok: false, error: 'SOURCE_UNQUALIFIED' };
      const body = { domain: 'SDD.Delivery.CollectedResult.v1', ...prepared.binding, source: structuredClone(observed) };
      const collectionId = sha256(canonicalJson(body));
      return { ok: true, scope: 'component/collected-bindings', managedClosureEligible: false,
        collection: { ...body, collectionId, integrity: sign({ ...body, collectionId }) } };
    },
    verifyCollection({ collection, ...args } = {}) {
      const prepared = collectionInputs(args, authority);
      if (!prepared.ok) return prepared;
      if (!collection || collection.domain !== 'SDD.Delivery.CollectedResult.v1' || !SHA256_RE.test(collection.integrity ?? '')) return { ok: false, error: 'INVALID_COLLECTION' };
      const { integrity, collectionId, ...body } = collection;
      if (sha256(canonicalJson(body)) !== collectionId || !sameSignature(sign({ ...body, collectionId }), integrity)) return { ok: false, error: 'FORGED_COLLECTION' };
      if (canonicalJson(prepared.binding) !== canonicalJson(Object.fromEntries(Object.keys(prepared.binding).map((key) => [key, collection[key]])))) return { ok: false, error: 'COLLECTION_CONTENT_MISMATCH' };
      if (!qualifiedObservation(collection.source, prepared.binding, args.envelope)) return { ok: false, error: 'SOURCE_UNQUALIFIED' };
      return { ok: true, source: collection.source, collectionId };
    },
    verifyDispatch(record) {
      const errors = dispatchShapeErrors(record ?? {});
      if (errors.length > 0) return { ok: false, error: 'MALFORMED_DISPATCH', errors };
      const expected = sign(bindingOf(record));
      const given = String(record.integrity);
      const ok = expected.length === given.length
        && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
      return ok ? { ok: true, record } : { ok: false, error: 'FORGED_DISPATCH' };
    },
  };
  return authority;
}

function sameSignature(expected, given) {
  return typeof given === 'string' && expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

function rawBytes(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value) : null;
}

function collectionInputs({ dispatch, envelope, launchRecord, reportBytes, resultBytes, methodTraceBytes } = {}, authority) {
  if (!authority.verifyDispatch(dispatch).ok || !dispatch?.actionBinding) return { ok: false, error: 'ACTION_BINDING_REQUIRED' };
  const report = rawBytes(reportBytes), result = rawBytes(resultBytes), trace = rawBytes(methodTraceBytes);
  if (!report?.toString('utf8').trim() || !result?.length || !trace?.length) return { ok: false, error: 'RAW_EVIDENCE_REQUIRED' };
  if (!launchRecord || typeof launchRecord.launchId !== 'string' || !launchRecord.launchId || launchRecord.execution !== dispatch.execution) return { ok: false, error: 'LAUNCH_RECORD_REQUIRED' };
  return { ok: true, binding: { actionDigest: sha256(canonicalJson(dispatch.actionBinding)), dispatchDigest: sha256(canonicalJson(dispatch)),
    envelopeDigest: envelopeDigest(envelope), launchDigest: sha256(canonicalJson(launchRecord)), reportDigest: sha256(report), resultDigest: sha256(result), methodTraceDigest: sha256(trace),
    run: dispatch.run, execution: dispatch.execution, launchId: launchRecord.launchId, environmentDigest: dispatch.actionBinding.environmentDigest } };
}

function qualifiedObservation(observed, binding, envelope) {
  const q = observed?.qualification, facts = observed?.facts;
  const measurements = Array.isArray(facts?.observations) ? facts.observations.filter((item) => item?.caseId === envelope?.caseId && item.check === envelope?.check) : [];
  const measurement = measurements[0];
  return observed?.ok === true && q && ['id', 'sourceId', 'revision', 'expiresAt'].every((key) => typeof q[key] === 'string' && q[key].trim())
    && Number.isFinite(Date.parse(q.expiresAt)) && Array.isArray(q.evidenceRefs) && q.evidenceRefs.length > 0
    && q.evidenceRefs.every((ref) => typeof ref?.ref === 'string' && ref.ref.trim() && SHA256_RE.test(ref.digest ?? ''))
    && facts && typeof facts.principal === 'string' && facts.principal.trim()
    && Object.entries(binding).every(([key, value]) => facts[key] === value)
    && measurements.length === 1 && typeof measurement.command === 'string' && measurement.command.trim()
    && measurement.result === envelope.result && measurement.executions?.total === envelope.executions.total && measurement.executions?.valid === envelope.executions.valid;
}

function auditRecord({ envelope, dispatch, error, reason }) {
  let digest = null;
  try {
    digest = envelopeDigest(envelope ?? {});
  } catch {
    digest = null;
  }
  return {
    error,
    reason,
    origin: envelope?.origin?.id ?? null,
    execution: envelope?.execution?.id ?? null,
    caseId: envelope?.caseId ?? null,
    envelopeDigest: digest,
    dispatchExecution: dispatch?.execution ?? null,
  };
}

const refuse = (payload) => ({ ok: false, ...payload });

// A05/A06/A18 source admission: an envelope becomes evidence only when the
// trusted launcher dispatched exactly this binding, the envelope is pinned to
// that binding, everything is still current, and the execution identity has
// not issued evidence before. Ordered checks keep refusals deterministic.
function admitComponentEvidence({ envelope, dispatch, authority, current, issuedExecutions = [], now = new Date().toISOString() } = {}, purpose = null) {
  // 1. Structure and contract version boundary (B07: explicit refusal, never
  //    field fabrication or silent migration).
  const parsed = parseContract('SDD.Delivery.EvidenceEnvelope', envelope);
  if (!parsed.ok) {
    return refuse({
      error: 'INVALID_ENVELOPE',
      reason: `evidence envelope fails SDD.Delivery.EvidenceEnvelope v1: ${parsed.errors.join('; ')}`,
      audit: auditRecord({ envelope, dispatch, error: 'INVALID_ENVELOPE', reason: 'schema validation failed' }),
    });
  }
  // 2. Registered source: no launcher-issued dispatch, no evidence (A05).
  if (!dispatch || !authority) {
    return refuse({
      error: 'UNREGISTERED_SOURCE',
      reason: 'no authority-issued dispatch record binds this envelope; self-written or fixture evidence is not a registered source (A05)',
      audit: auditRecord({ envelope, dispatch, error: 'UNREGISTERED_SOURCE', reason: 'no dispatch' }),
    });
  }
  // 3. The dispatch must come from the launcher, not from the worker.
  const verified = authority.verifyDispatch(dispatch);
  if (!verified.ok) {
    return refuse({
      error: verified.error,
      reason: verified.error === 'MALFORMED_DISPATCH'
        ? `dispatch record is malformed: ${verified.errors.join('; ')}`
        : 'dispatch record fails launcher integrity verification; only the trusted launcher can issue dispatches (Runner.Dispatch.v1)',
      audit: auditRecord({ envelope, dispatch, error: verified.error, reason: 'dispatch integrity check failed' }),
    });
  }
  // 4. Identity: the builder execution never signs acceptance evidence (A06);
  //    unknown roles are refused, not guessed.
  if (dispatch.role === 'builder') {
    return refuse({
      error: 'IDENTITY_CONFLICT',
      reason: `builder execution ${dispatch.execution} cannot sign acceptance evidence; verifier and builder must be different executions (A06)`,
      audit: auditRecord({ envelope, dispatch, error: 'IDENTITY_CONFLICT', reason: 'builder role cannot sign evidence' }),
    });
  }
  if (!purpose && dispatch.role !== 'verifier' && dispatch.role !== 'test-author') {
    return refuse({
      error: 'ROLE_NOT_DISPATCHED',
      reason: `dispatch role ${dispatch.role} is not a role the launcher dispatches for evidence`,
      audit: auditRecord({ envelope, dispatch, error: 'ROLE_NOT_DISPATCHED', reason: 'unknown role' }),
    });
  }
  // 5. The envelope is pinned to the dispatch binding: it cannot re-declare
  //    who ran, where it came from or which candidate it observed.
  if (envelope.execution.id !== dispatch.execution) {
    return refuse({
      error: 'EXECUTION_BINDING_MISMATCH',
      reason: `envelope declares execution ${envelope.execution.id} but the dispatch assigned ${dispatch.execution}`,
      audit: auditRecord({ envelope, dispatch, error: 'EXECUTION_BINDING_MISMATCH', reason: 'execution pinning violated' }),
    });
  }
  if (envelope.origin.id !== dispatch.runnerId) {
    return refuse({
      error: 'ORIGIN_BINDING_MISMATCH',
      reason: `envelope declares origin ${envelope.origin.id} but the dispatch was issued to ${dispatch.runnerId}`,
      audit: auditRecord({ envelope, dispatch, error: 'ORIGIN_BINDING_MISMATCH', reason: 'origin pinning violated' }),
    });
  }
  if (envelope.candidateDigest !== dispatch.inputDigest) {
    return refuse({
      error: 'CANDIDATE_BINDING_MISMATCH',
      reason: `envelope observes candidate ${envelope.candidateDigest} but the dispatch bound ${dispatch.inputDigest}`,
      audit: auditRecord({ envelope, dispatch, error: 'CANDIDATE_BINDING_MISMATCH', reason: 'candidate pinning violated' }),
    });
  }
  // 6. Currency: stale policy, stale candidate, foreign environment and
  //    expired envelopes are refused.
  if (dispatch.inputDigest !== current.inputDigest) {
    return refuse({
      error: 'STALE_CANDIDATE',
      reason: `dispatch bound to input digest ${dispatch.inputDigest} but current input digest is ${current.inputDigest}`,
      audit: auditRecord({ envelope, dispatch, error: 'STALE_CANDIDATE', reason: 'input digest rotated since dispatch' }),
    });
  }
  if (dispatch.policyDigest !== current.policyDigest) {
    return refuse({
      error: 'STALE_POLICY',
      reason: `dispatch bound to policy digest ${dispatch.policyDigest} but current policy digest is ${current.policyDigest}`,
      audit: auditRecord({ envelope, dispatch, error: 'STALE_POLICY', reason: 'policy rotated since dispatch' }),
    });
  }
  if (envelope.environment !== current.environment) {
    return refuse({
      error: 'STALE_ENVIRONMENT',
      reason: `envelope observed in environment ${envelope.environment} but current environment is ${current.environment}`,
      audit: auditRecord({ envelope, dispatch, error: 'STALE_ENVIRONMENT', reason: 'environment mismatch' }),
    });
  }
  if (Date.parse(envelope.expiry) < Date.parse(now)) {
    return refuse({
      error: 'EXPIRED_ENVELOPE',
      reason: `envelope expired at ${envelope.expiry} (now ${now})`,
      audit: auditRecord({ envelope, dispatch, error: 'EXPIRED_ENVELOPE', reason: 'past expiry' }),
    });
  }
  // 7. Duplicate issuance: one dispatch execution signs exactly one envelope.
  if (issuedExecutions.includes(dispatch.execution)) {
    return refuse({
      error: 'DUPLICATE_ISSUANCE',
      reason: `execution ${dispatch.execution} already issued evidence; a repeated issuance from the same identity is refused`,
      audit: auditRecord({ envelope, dispatch, error: 'DUPLICATE_ISSUANCE', reason: 'execution already used' }),
    });
  }
  // 8. A18: a pass/fail/red claim carries real observation data; missing
  //    capability is recordable only as unverified/blocked, never as pass.
  const observedResult = envelope.result;
  if (observedResult === 'pass' || observedResult === 'fail' || observedResult === 'red') {
    const { total, valid } = envelope.executions;
    if (valid < 1) {
      return refuse({
        error: 'NO_OBSERVATION',
        reason: `result ${observedResult} with no real observation data: ${valid} valid of ${total} executions`,
        audit: auditRecord({ envelope, dispatch, error: 'NO_OBSERVATION', reason: 'zero valid executions behind a claim' }),
      });
    }
    if (valid > total) {
      return refuse({
        error: 'NO_OBSERVATION',
        reason: `no real observation data: ${valid} valid executions exceed the observed total ${total}`,
        audit: auditRecord({ envelope, dispatch, error: 'NO_OBSERVATION', reason: 'counts contradict the observed total' }),
      });
    }
  }
  // Admitted. The class comes from the dispatch role — never from the
  // envelope. Authoring self-checks stay visible but never sign acceptance.
  return {
    ok: true,
    entry: {
      digest: envelopeDigest(envelope),
      envelope,
      class: purpose ?? (dispatch.role === 'verifier' ? 'independent-acceptance' : 'authoring-self-check'),
      origin: dispatch.runnerId,
      execution: dispatch.execution,
      dispatch,
    },
  };
}


// Managed context comes exclusively from protected caller options. The caller
// owns qualification lookup and atomic replay consumption on the SAME Comet
// Run; this library creates no issuance log, phase, lease or retry loop.
function admitManagedEvidence(args, options) {
  const boundary = { scope: 'component/source-bound', managedClosureEligible: false };
  const no = (error, reason = error) => ({ ...boundary, ok: false, error, reason, audit: auditRecord({ ...args, error, reason }) });
  const authority = options.authority;
  if (!authority || typeof authority.verifyCollection !== 'function') return no('MANAGED_SOURCE_REQUIRED');
  const parsed = parseContract('SDD.Delivery.ActionBinding', options.actionBinding);
  if (!parsed.ok) return no('CURRENT_ACTION_REQUIRED');
  const verified = authority.verifyCollection(args);
  if (!verified.ok) return no(verified.error);
  const q = verified.source?.qualification, currentQ = options.sourceQualification;
  if (q?.scope !== 'protected-source' || q.status !== 'qualified' || currentQ?.scope !== 'protected-source' || currentQ?.status !== 'qualified') return no('SOURCE_UNQUALIFIED');
  if (canonicalJson(q) !== canonicalJson(currentQ)) return no('STALE_SOURCE_QUALIFICATION');
  const now = options.now;
  if (!Number.isFinite(Date.parse(now)) || Date.parse(q.expiresAt) <= Date.parse(now)) return no('EXPIRED_SOURCE_QUALIFICATION');
  if (sha256(canonicalJson(parsed.value)) !== args.collection.actionDigest) return no('STALE_ACTION_BINDING');
  if (!['independent-acceptance', 'authoring-self-check'].includes(options.purpose)
    || typeof options.environment !== 'string' || !options.environment
    || typeof options.builderExecution !== 'string' || !options.builderExecution
    || typeof options.builderPrincipal !== 'string' || !options.builderPrincipal
    || !Array.isArray(options.authoringExecutions) || !Array.isArray(options.authoringPrincipals)
    || !Array.isArray(options.consumedCollections) || !Array.isArray(options.issuedExecutions)) return no('PROTECTED_CONTEXT_REQUIRED');
  if (options.consumedCollections.includes(verified.collectionId)) return no('REPLAYED_COLLECTION');
  if (options.purpose === 'independent-acceptance' && (args.dispatch.role === 'test-author'
    || [options.builderExecution, ...options.authoringExecutions].includes(args.dispatch.execution)
    || [options.builderPrincipal, ...options.authoringPrincipals].includes(verified.source.facts.principal))) return no('IDENTITY_CONFLICT');
  const admitted = admitComponentEvidence({ envelope: args.envelope, dispatch: args.dispatch, authority,
    current: { inputDigest: parsed.value.inputDigest, policyDigest: parsed.value.policyDigest, environment: options.environment },
    issuedExecutions: options.issuedExecutions, now }, options.purpose);
  if (!admitted.ok) return { ...admitted, ...boundary };
  return { ok: true, ...boundary, entry: { ...admitted.entry, ...boundary, sourcePacket: structuredClone(Object.fromEntries(['dispatch', 'envelope', 'launchRecord', 'reportBytes', 'resultBytes', 'methodTraceBytes', 'collection'].map((key) => [key, args[key]]))), collectionId: verified.collectionId } };
}

// Strictness is a protected caller decision, never a worker profile flag.
// Compatibility retains old protocol behavior with explicitly finite scope.
export function admitEvidence(args, options = {}) {
  if (options.requireManaged !== undefined && typeof options.requireManaged !== 'boolean') return { ok: false, scope: 'component/source-bound', managedClosureEligible: false, error: 'INVALID_PROTECTED_POLICY', reason: 'requireManaged must be a protected boolean option' };
  if (options.requireManaged === true) return admitManagedEvidence(args, options);
  const result = admitComponentEvidence(args);
  const boundary = { scope: 'component/dispatch-binding', managedClosureEligible: false };
  return result.ok ? { ...result, ...boundary, entry: { ...result.entry, ...boundary } } : { ...result, ...boundary };
}
