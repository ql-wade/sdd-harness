// SDD.Delivery.PlanBundle v1 — planner output only: task dependencies, a
// single scheduler owner, allowed paths, the worktree and acceptance
// references. No dispatch, no run state.
import { defineContract } from './schema-kernel.js';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.PlanBundle',
  version: 1,
  description: 'planner plan bundle without execution authority',
  fields: {
    change: { type: 'string' },
    schedulerOwner: { type: 'string' },
    tasks: {
      type: 'array',
      min: 1,
      items: {
        fields: {
          id: { type: 'string' },
          dependsOn: { type: 'array', required: false, items: { type: 'string' } },
        },
      },
    },
    allowedPaths: { type: 'array', min: 1, items: { type: 'string' } },
    worktree: { type: 'string' },
    acceptanceRefs: { type: 'array', min: 1, items: { type: 'string' } },
  },
});

export function validatePlanBundle(payload) {
  return CONTRACT.validate(payload);
}
