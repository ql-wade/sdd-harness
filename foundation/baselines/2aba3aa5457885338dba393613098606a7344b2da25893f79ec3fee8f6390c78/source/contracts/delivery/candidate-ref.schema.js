// SDD.Delivery.CandidateRef v1 — one frozen candidate: project/change/run/
// attempt identity, the backend candidate, the full-input digest it was built
// from, and the builder execution that produced it.
import { defineContract } from './schema-kernel.js';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.CandidateRef',
  version: 1,
  description: 'frozen candidate identity bound to full-input digest and builder execution',
  fields: {
    project: { type: 'string' },
    change: { type: 'string' },
    run: { type: 'string' },
    attempt: { type: 'int', min: 1 },
    backendCandidate: { type: 'string' },
    inputDigest: { type: 'sha256' },
    builderExecution: { type: 'string' },
  },
});

export function validateCandidateRef(payload) {
  return CONTRACT.validate(payload);
}
