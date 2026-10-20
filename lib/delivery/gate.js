// SDD.Gate.v1 — pure gate evaluation for the delivery foundation
// (task 2.2.b, A18/B03/B06 plus A06 and stale-receipt defense).
//
// evaluate(inputs, receipts, policy) returns only a verdict and a GateReceipt
// validated against contracts/delivery. It never dispatches, never writes a
// current-stage, never touches the filesystem: the module imports no
// execution or persistence channel at all, and identical inputs produce a
// byte-identical receipt. Gate stores judgments and grounds only — execution
// phases belong to the single Runtime (delivery-architecture.md section 5).
//
// Receipts are the entries admission produced (lib/delivery/evidence.js).
// The gate re-verifies what it can structurally: entry digest vs envelope
// content (tamper), dispatch binding vs current policy/input digests (stale),
// and that no receipt execution is the builder execution (A06). Required
// capabilities stay blocked on missing receipts (A18), UNVERIFIED results
// (A18), observation-kind substitution (B06: the capability string is the
// substitution boundary — a service log is never a console) and
// authoring-only coverage (B03).
import { createHash } from 'node:crypto';
import { parseContract } from '../../contracts/delivery/index.js';
import { envelopeDigest } from './evidence.js';

const SHA256_RE = /^[a-f0-9]{64}$/;

// The digest of the empty judged set: the receipt schema always carries an
// evidence set; an honest empty set is digested rather than fabricated.
export const EMPTY_EVIDENCE_SET_DIGEST = createHash('sha256').update('[]').digest('hex');

export function evaluate(inputs, receipts, policy) {
  // Frozen inputs must be valid before the gate judges anything.
  const parsedContract = parseContract('SDD.Delivery.TestContract', inputs?.testContract);
  if (!parsedContract.ok) {
    throw new Error(`INVALID_TEST_CONTRACT: the gate refuses to judge — ${parsedContract.errors.join('; ')}`);
  }
  if (!inputs || typeof inputs.inputDigest !== 'string' || !SHA256_RE.test(inputs.inputDigest)
    || typeof inputs.builderExecution !== 'string' || inputs.builderExecution.length === 0) {
    throw new Error('INVALID_INPUTS: the gate refuses to judge — inputs must carry a sha256 inputDigest and a non-empty builderExecution');
  }
  if (!policy || typeof policy !== 'object' || typeof policy.ref !== 'string' || policy.ref.length === 0
    || typeof policy.digest !== 'string' || !SHA256_RE.test(policy.digest)) {
    throw new Error('INVALID_POLICY: the gate refuses to judge — policy must be { ref: string, digest: sha256 }');
  }
  if (!Array.isArray(receipts)) {
    throw new Error('INVALID_RECEIPTS: the gate refuses to judge — receipts must be an array of admission entries');
  }

  // Structural defense: tampered, stale and builder-identity receipts can
  // never satisfy a capability. First failure per entry wins; the entry is
  // excluded from satisfaction but stays visible in the blocked reasons.
  const blocked = [];
  const clean = [];
  for (const entry of receipts) {
    const label = entry?.execution ?? '<unknown>';
    if (!entry || typeof entry !== 'object'
      || typeof entry.digest !== 'string'
      || !entry.envelope || typeof entry.envelope !== 'object'
      || !entry.dispatch || typeof entry.dispatch !== 'object') {
      blocked.push(`TAMPERED_RECEIPT: malformed admission entry (${label})`);
      continue;
    }
    if (entry.digest !== envelopeDigest(entry.envelope)) {
      blocked.push(`TAMPERED_RECEIPT: entry digest does not match its envelope content (${label})`);
      continue;
    }
    if (entry.origin !== entry.dispatch.runnerId || entry.execution !== entry.dispatch.execution) {
      blocked.push(`TAMPERED_RECEIPT: entry identity does not match its dispatch binding (${label})`);
      continue;
    }
    if (entry.dispatch.policyDigest !== policy.digest) {
      blocked.push(`STALE_POLICY: receipt bound to policy digest ${entry.dispatch.policyDigest} but current policy digest is ${policy.digest} (${label})`);
      continue;
    }
    if (entry.dispatch.inputDigest !== inputs.inputDigest || entry.envelope.candidateDigest !== inputs.inputDigest) {
      blocked.push(`STALE_INPUT: receipt bound to input digest ${entry.dispatch.inputDigest} but current input digest is ${inputs.inputDigest} (${label})`);
      continue;
    }
    if (entry.execution === inputs.builderExecution) {
      blocked.push(`IDENTITY_CONFLICT: receipt execution ${entry.execution} is the builder execution; verifier and builder must differ (A06)`);
      continue;
    }
    clean.push(entry);
  }

  // Per-capability satisfaction over the structurally clean receipts.
  const required = parsedContract.value.requiredChecks;
  let valid = 0;
  for (const check of required) {
    const matching = clean.filter((entry) => entry.envelope.check === check.capability);
    if (matching.length === 0) {
      blocked.push(`MISSING_OBSERVATION: required check ${check.level}/${check.capability} has no receipt`);
      continue;
    }
    const independent = matching.filter((entry) => entry.class === 'independent-acceptance');
    if (independent.length === 0) {
      blocked.push(`AUTHORING_SELF_CHECK_ONLY: ${check.capability} is covered only by authoring self-check receipts, which cannot sign independent acceptance (B03)`);
      continue;
    }
    const observed = independent.filter((entry) => entry.envelope.result === 'pass'
      && Number.isInteger(entry.envelope.executions?.valid)
      && entry.envelope.executions.valid >= 1
      && entry.envelope.executions.valid <= entry.envelope.executions.total);
    if (observed.length === 0) {
      const sample = independent[0].envelope;
      blocked.push(`UNVERIFIED_CAPABILITY: ${check.capability} receipt result is ${sample.result} with ${sample.executions?.valid ?? 0} valid execution(s) (A18)`);
      continue;
    }
    valid += 1;
  }

  // The receipt. Judged evidence and attestation are derived, sorted and
  // deterministic; an empty judged set is digested honestly.
  const judged = receipts
    .map((entry) => (entry && typeof entry === 'object' && typeof entry.digest === 'string' && SHA256_RE.test(entry.digest) ? entry.digest : null))
    .filter((digest) => digest !== null)
    .sort();
  const attested = clean;
  const origins = [...new Set(attested.map((entry) => entry.origin))].sort();
  const executions = [...new Set(attested.map((entry) => entry.execution))].sort();
  const receipt = {
    schemaVersion: 1,
    policy: { ref: policy.ref, digest: policy.digest },
    inputDigest: inputs.inputDigest,
    evidence: judged.length > 0 ? judged : [EMPTY_EVIDENCE_SET_DIGEST],
    requiredDenominator: { required: required.length, valid },
    blocked,
    sourceAttestation: {
      origin: origins.length > 0 ? origins.join(',') : 'none',
      execution: executions.length > 0 ? executions.join(',') : 'none',
    },
    verdict: blocked.length === 0 ? 'pass' : 'blocked',
  };
  // Contract boundary: the gate only ever returns a receipt that satisfies
  // the frozen SDD.Delivery.GateReceipt v1 schema; anything else is a gate
  // bug and fails closed instead of emitting an unvalidatable verdict.
  const validated = parseContract('SDD.Delivery.GateReceipt', receipt);
  if (!validated.ok) {
    throw new Error(`GATE_RECEIPT_INVALID (gate bug): ${validated.errors.join('; ')}`);
  }
  return { verdict: receipt.verdict, receipt: validated.value };
}
