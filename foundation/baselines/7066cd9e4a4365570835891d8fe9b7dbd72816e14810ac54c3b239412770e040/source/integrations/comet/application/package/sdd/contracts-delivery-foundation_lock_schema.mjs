// SDD.Delivery.FoundationLock v1 — fixes the complete distributed asset set
// for one run: release commit, export digest, per-skill digests, schema/policy
// binding, CLI/Runner versions and platforms, the method profile, the pinned
// MCP set and the method profile manifest reference. Field shapes follow the
// artifact the P1_2 exporter actually emits (foundation/foundation-lock.json).
// Path fields reject machine absolute paths (ABSOLUTE_PATH_FORBIDDEN, I01
// semantics); version fields reject floating versions (@latest/HEAD/unpinned).
// The top-level field set is closed (fail-closed): this contract is the
// machine-reachability surface (MCP launchers, profile paths), so unknown
// fields cannot smuggle unvalidated launch data past the schema.
import { defineContract } from './contracts-delivery-schema_kernel.mjs';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.FoundationLock',
  version: 1,
  description: 'frozen foundation asset set for one run',
  unknownFields: 'reject',
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
        schemaRef: { type: 'path' },
        digest: { type: 'sha256' },
      },
    },
    toolchain: {
      type: 'object',
      fields: {
        cli: { type: 'object', fields: { name: { type: 'string' }, version: { type: 'pinnedVersion' } } },
        runner: { type: 'object', fields: { name: { type: 'string' }, version: { type: 'pinnedVersion' } } },
        node: { type: 'pinnedVersion' },
        platforms: { type: 'array', min: 1, items: { type: 'string' } },
      },
    },
    profile: { type: 'string' },
    mcps: {
      type: 'array',
      required: false,
      items: {
        fields: {
          name: { type: 'string' },
          version: { type: 'pinnedVersion', required: false },
          digest: { type: 'sha256' },
        },
      },
    },
    methodProfile: {
      type: 'object',
      required: false,
      fields: {
        path: { type: 'path' },
        digest: { type: 'sha256' },
        profile: { type: 'string' },
      },
    },
  },
});

export function validateFoundationLock(payload) {
  return CONTRACT.validate(payload);
}
