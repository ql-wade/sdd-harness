// SDD.Delivery.BaselineRef v1 — one confirmed artifact baseline (product,
// design or usecase) bound to a revision and content digest, with the
// confirming principal and the scope the confirmation covers.
import { defineContract } from './contracts-delivery-schema_kernel.mjs';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.BaselineRef',
  version: 1,
  description: 'confirmed product/design/usecase baseline reference',
  fields: {
    project: { type: 'string' },
    change: { type: 'string' },
    kind: { type: 'enum', values: ['product', 'design', 'usecase'] },
    revision: { type: 'string' },
    digest: { type: 'sha256' },
    confirmedBy: { type: 'string' },
    confirmationScope: { type: 'string' },
  },
});

export function validateBaselineRef(payload) {
  return CONTRACT.validate(payload);
}
