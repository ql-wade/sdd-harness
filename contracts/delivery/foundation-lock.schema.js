// SDD.Delivery.FoundationLock v1 — fixes the complete distributed asset set
// for one run: release commit, export digest, per-skill digests, schema/policy
// binding, CLI/Runner versions and platforms, and the method profile.
// Required content per delivery-architecture.md section 4.
import { defineContract } from './schema-kernel.js';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.FoundationLock',
  version: 1,
  description: 'frozen foundation asset set for one run',
  fields: {
    release: {
      type: 'object',
      fields: {
        commit: { type: 'string' },
        exportDigest: { type: 'sha256' },
      },
    },
    skills: {
      type: 'array',
      min: 1,
      items: {
        fields: {
          name: { type: 'string' },
          digest: { type: 'sha256' },
        },
      },
    },
    policy: {
      type: 'object',
      fields: {
        schemaRef: { type: 'string' },
        digest: { type: 'sha256' },
      },
    },
    toolchain: {
      type: 'object',
      fields: {
        cli: { type: 'object', fields: { name: { type: 'string' }, version: { type: 'string' } } },
        runner: { type: 'object', fields: { name: { type: 'string' }, version: { type: 'string' } } },
        node: { type: 'string' },
        platforms: { type: 'array', min: 1, items: { type: 'string' } },
      },
    },
    profile: { type: 'string' },
  },
});

export function validateFoundationLock(payload) {
  return CONTRACT.validate(payload);
}
