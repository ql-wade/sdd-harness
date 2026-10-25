// SDD.Delivery.GateReceipt v1 — pure gate verdict: policy binding, input
// digest, the evidence digest set it judged, the required denominator, any
// blocking reasons and the source attestation. Stores no execution phase and
// dispatches nothing (SDD.Gate.v1).
import { defineContract } from './schema-kernel.js';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.GateReceipt',
  version: 1,
  description: 'pure gate verdict with evidence set and source attestation',
  fields: {
    policy: {
      type: 'object',
      fields: {
        ref: { type: 'string' },
        digest: { type: 'sha256' },
      },
    },
    inputDigest: { type: 'sha256' },
    evidence: { type: 'array', min: 1, items: { type: 'sha256' } },
    requiredDenominator: {
      type: 'object',
      fields: {
        required: { type: 'int', min: 1 },
        valid: { type: 'int', min: 0 },
      },
    },
    blocked: { type: 'array', min: 0, items: { type: 'string' } },
    sourceAttestation: {
      type: 'object',
      fields: {
        origin: { type: 'string' },
        execution: { type: 'string' },
      },
    },
    verdict: { type: 'enum', values: ['pass', 'blocked'] },
  },
});

export function validateGateReceipt(payload) {
  return CONTRACT.validate(payload);
}
