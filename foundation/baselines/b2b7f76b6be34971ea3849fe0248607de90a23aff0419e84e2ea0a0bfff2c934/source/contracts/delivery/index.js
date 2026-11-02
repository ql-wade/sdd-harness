// Registry for the frozen SDD.Delivery.* shared contracts (v1).
// parseContract is the only entry consumers need: unknown names are refused
// explicitly, and every contract enforces its own version/compat boundary
// (missing, legacy and future schemaVersion values are explicit errors).
import { CONTRACT as FOUNDATION_LOCK_CONTRACT, validateFoundationLock } from './foundation-lock.schema.js';
import { CONTRACT as BASELINE_REF_CONTRACT, validateBaselineRef } from './baseline-ref.schema.js';
import { CONTRACT as TEST_CONTRACT_CONTRACT, validateTestContract } from './test-contract.schema.js';
import { CONTRACT as PLAN_BUNDLE_CONTRACT, validatePlanBundle } from './plan-bundle.schema.js';
import { CONTRACT as CANDIDATE_REF_CONTRACT, validateCandidateRef } from './candidate-ref.schema.js';
import { CONTRACT as EVIDENCE_ENVELOPE_CONTRACT, validateEvidenceEnvelope } from './evidence-envelope.schema.js';
import { CONTRACT as GATE_RECEIPT_CONTRACT, validateGateReceipt } from './gate-receipt.schema.js';
import { CONTRACT as RELEASE_RECEIPT_CONTRACT, validateReleaseReceipt } from './release-receipt.schema.js';

import { CONTRACT as ACTION_BINDING_CONTRACT, validateActionBinding } from './action-binding.schema.js';

export const CONTRACTS = {
  'SDD.Delivery.ActionBinding': { contract: ACTION_BINDING_CONTRACT, validate: validateActionBinding },
  'SDD.Delivery.FoundationLock': { contract: FOUNDATION_LOCK_CONTRACT, validate: validateFoundationLock },
  'SDD.Delivery.BaselineRef': { contract: BASELINE_REF_CONTRACT, validate: validateBaselineRef },
  'SDD.Delivery.TestContract': { contract: TEST_CONTRACT_CONTRACT, validate: validateTestContract },
  'SDD.Delivery.PlanBundle': { contract: PLAN_BUNDLE_CONTRACT, validate: validatePlanBundle },
  'SDD.Delivery.CandidateRef': { contract: CANDIDATE_REF_CONTRACT, validate: validateCandidateRef },
  'SDD.Delivery.EvidenceEnvelope': { contract: EVIDENCE_ENVELOPE_CONTRACT, validate: validateEvidenceEnvelope },
  'SDD.Delivery.GateReceipt': { contract: GATE_RECEIPT_CONTRACT, validate: validateGateReceipt },
  'SDD.Delivery.ReleaseReceipt': { contract: RELEASE_RECEIPT_CONTRACT, validate: validateReleaseReceipt },
};

export function parseContract(name, payload) {
  const entry = Object.hasOwn(CONTRACTS, name) ? CONTRACTS[name] : null;
  if (!entry) {
    return {
      ok: false,
      errors: [`unknown contract ${name} — refusing to parse (registered contracts: ${Object.keys(CONTRACTS).join(', ')})`],
    };
  }
  return entry.validate(payload);
}
