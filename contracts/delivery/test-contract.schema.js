// SDD.Delivery.TestContract v1 — frozen test intent: AC/case ids with per-case
// oracle, required verification levels and capabilities, the execution
// denominator the run must actually meet, environment/data cleanup, and the
// dependency baselines the cases apply to.
import { defineContract } from './schema-kernel.js';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.TestContract',
  version: 1,
  description: 'frozen test intent with execution denominator and oracles',
  fields: {
    project: { type: 'string' },
    change: { type: 'string' },
    cases: {
      type: 'array',
      min: 1,
      items: {
        fields: {
          id: { type: 'string' },
          ac: { type: 'string' },
          oracle: { type: 'string' },
        },
      },
    },
    requiredChecks: {
      type: 'array',
      min: 1,
      items: {
        fields: {
          level: { type: 'string' },
          capability: { type: 'string' },
        },
      },
    },
    executionDenominator: {
      type: 'object',
      fields: {
        totalCases: { type: 'int', min: 1 },
      },
    },
    cleanup: {
      type: 'object',
      fields: {
        environment: { type: 'string' },
        data: { type: 'string' },
      },
    },
    dependencyBaselines: {
      type: 'array',
      min: 1,
      items: {
        fields: {
          kind: { type: 'string' },
          digest: { type: 'sha256' },
        },
      },
    },
  },
});

export function validateTestContract(payload) {
  return CONTRACT.validate(payload);
}
