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
    commandBindingsRequired: { type: 'boolean', required: false },
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
          required: { type: 'boolean', required: false },
          checkIds: { type: 'array', min: 1, required: false, items: { type: 'string' } },
        },
      },
    },
    requiredChecks: {
      type: 'array',
      min: 1,
      items: {
        fields: {
          id: { type: 'string', required: false },
          command: { type: 'string', required: false },
          caseIds: { type: 'array', min: 1, required: false, items: { type: 'string' } },
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
  const parsed = CONTRACT.validate(payload);
  if (!parsed.ok || payload.commandBindingsRequired !== true) return parsed;
  const trace = traceAcToCases({ acceptanceIds: payload.cases.map((entry) => entry.ac), testContract: payload, requireCommands: true });
  const requiredCases = payload.cases.filter((entry) => entry.required !== false).length;
  const errors = [...trace.errors];
  if (payload.executionDenominator.totalCases < requiredCases) errors.push('executionDenominator.totalCases undercounts distinct required cases');
  return trace.ok && errors.length === 0 ? parsed : { ok: false, errors };
}

// This checks declared intent links only; it cannot attest oracle strength,
// command execution or independent identity. Strict command binding is opt-in
// for versioned callers; legacy AC-only callers are explicitly labeled.
export function traceAcToCases({ acceptanceIds, testContract, requireCommands = false }) {
  const cases = Array.isArray(testContract?.cases) ? testContract.cases : [];
  const checks = Array.isArray(testContract?.requiredChecks) ? testContract.requiredChecks : [];
  const strict = requireCommands || testContract?.commandBindingsRequired === true;
  const missing = [];
  const mapped = [];
  const errors = [];
  const caseIds = new Set();
  for (const entry of cases) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || caseIds.has(entry.id)) errors.push('case identities must be non-empty and unique');
    caseIds.add(entry?.id);
    if (typeof entry?.oracle !== 'string' || !entry.oracle.trim()) errors.push(`case ${entry?.id}: oracle is required`);
  }
  for (const ac of acceptanceIds ?? []) {
    const ids = cases.filter((entry) => entry?.ac === ac).map((entry) => entry.id);
    if (ids.length === 0) missing.push({ ac, reason: `no case mapped to acceptance ${ac}` });
    else mapped.push({ ac, cases: ids });
  }
  if (strict) {
    const checkIds = new Set();
    for (const check of checks) {
      if (!check || typeof check.id !== 'string' || !check.id.trim() || checkIds.has(check.id)) errors.push('check identities must be non-empty and unique');
      checkIds.add(check?.id);
      if (typeof check?.command !== 'string' || !check.command.trim()) errors.push(`check ${check?.id}: required command missing`);
      if (!Array.isArray(check?.caseIds) || check.caseIds.length === 0 || check.caseIds.some((id) => !caseIds.has(id))) errors.push(`check ${check?.id}: missing or dangling case reference`);
      if (!cases.some((entry) => entry?.required !== false && entry?.checkIds?.includes(check?.id) && check?.caseIds?.includes(entry.id))) errors.push(`check ${check?.id}: required command is not bound to a required case`);
    }
    for (const entry of cases.filter((c) => c?.required !== false)) {
      if (!Array.isArray(entry.checkIds) || entry.checkIds.length === 0 || entry.checkIds.some((id) => !checkIds.has(id))) errors.push(`case ${entry.id}: missing or dangling check reference`);
      for (const id of entry.checkIds ?? []) {
        if (!checks.some((check) => check?.id === id && check.caseIds?.includes(entry.id))) errors.push(`case ${entry.id}: check ${id} does not bind this case`);
      }
    }
  }
  return { ok: missing.length === 0 && errors.length === 0, missing, mapped, errors, scope: strict ? 'declared-command-links' : 'ac-only' };
}
