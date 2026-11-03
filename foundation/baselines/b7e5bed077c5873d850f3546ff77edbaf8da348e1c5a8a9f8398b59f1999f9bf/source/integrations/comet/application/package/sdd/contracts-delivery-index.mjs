// Registry for the frozen SDD.Delivery.* shared contracts (v1).
// parseContract is the only entry consumers need: unknown names are refused
// explicitly, and every contract enforces its own version/compat boundary
// (missing, legacy and future schemaVersion values are explicit errors).
import { CONTRACT as FOUNDATION_LOCK_CONTRACT, validateFoundationLock } from './contracts-delivery-foundation_lock_schema.mjs';
import { CONTRACT as BASELINE_REF_CONTRACT, validateBaselineRef } from './contracts-delivery-baseline_ref_schema.mjs';
import { CONTRACT as TEST_CONTRACT_CONTRACT, validateTestContract } from './contracts-delivery-test_contract_schema.mjs';
import { CONTRACT as PLAN_BUNDLE_CONTRACT, validatePlanBundle } from './contracts-delivery-plan_bundle_schema.mjs';
import { CONTRACT as CANDIDATE_REF_CONTRACT, validateCandidateRef } from './contracts-delivery-candidate_ref_schema.mjs';
import { CONTRACT as EVIDENCE_ENVELOPE_CONTRACT, validateEvidenceEnvelope } from './contracts-delivery-evidence_envelope_schema.mjs';
import { CONTRACT as GATE_RECEIPT_CONTRACT, validateGateReceipt } from './contracts-delivery-gate_receipt_schema.mjs';
import { CONTRACT as RELEASE_RECEIPT_CONTRACT, validateReleaseReceipt } from './contracts-delivery-release_receipt_schema.mjs';

import { CONTRACT as ACTION_BINDING_CONTRACT, validateActionBinding } from './contracts-delivery-action_binding_schema.mjs';

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
