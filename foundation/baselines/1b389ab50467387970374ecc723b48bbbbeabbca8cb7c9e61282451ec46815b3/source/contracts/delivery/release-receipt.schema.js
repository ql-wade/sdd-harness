// SDD.Delivery.ReleaseReceipt v1 — release fact: integration SHA, build
// digest, target environment, config/migration versions, deploy/rollback
// identity and the independent readback. A receipt without a confirmed
// independent readback is not a release receipt.
import { defineContract } from './schema-kernel.js';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.ReleaseReceipt',
  version: 1,
  description: 'release fact bound to integration sha, build digest and independent readback',
  fields: {
    integrationSha: { type: 'string' },
    buildDigest: { type: 'sha256' },
    targetEnvironment: { type: 'string' },
    configVersions: {
      type: 'object',
      fields: {
        config: { type: 'string' },
        migration: { type: 'string' },
      },
    },
    deployIdentity: { type: 'string' },
    rollbackIdentity: { type: 'string' },
    readback: {
      type: 'object',
      fields: {
        ok: { type: 'boolean' },
        at: { type: 'iso8601' },
        evidenceDigest: { type: 'sha256' },
      },
    },
  },
});

export function validateReleaseReceipt(payload) {
  const result = CONTRACT.validate(payload);
  if (!result.ok) return result;
  if (payload.readback.ok !== true) {
    return {
      ok: false,
      errors: ['readback.ok: an independent readback must be confirmed before a release receipt exists'],
    };
  }
  return result;
}
