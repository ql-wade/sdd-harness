// SDD.Delivery.EvidenceEnvelope v1 — one observed result bound to candidate,
// case/check, origin and execution identity, environment/toolchain, real
// execution counts, result, raw evidence URI/digest and an expiry.
// Digests prove content binding only; origin trust is decided by the gate.
import { defineContract } from './contracts-delivery-schema_kernel.mjs';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.EvidenceEnvelope',
  version: 1,
  description: 'evidence envelope bound to candidate, execution identity and raw evidence',
  fields: {
    candidateDigest: { type: 'sha256' },
    caseId: { type: 'string' },
    check: { type: 'string', required: false },
    origin: { type: 'object', fields: { kind: { type: 'string' }, id: { type: 'string' } } },
    execution: { type: 'object', fields: { id: { type: 'string' } } },
    environment: { type: 'string' },
    toolchain: { type: 'string' },
    executions: {
      type: 'object',
      fields: {
        total: { type: 'int', min: 0 },
        valid: { type: 'int', min: 0 },
      },
    },
    result: { type: 'enum', values: ['pass', 'fail', 'red', 'blocked', 'unverified'] },
    evidence: {
      type: 'array',
      min: 1,
      items: {
        fields: {
          uri: { type: 'string' },
          sha256: { type: 'sha256' },
        },
      },
    },
    expiry: { type: 'iso8601' },
  },
});

export function validateEvidenceEnvelope(payload) {
  return CONTRACT.validate(payload);
}
