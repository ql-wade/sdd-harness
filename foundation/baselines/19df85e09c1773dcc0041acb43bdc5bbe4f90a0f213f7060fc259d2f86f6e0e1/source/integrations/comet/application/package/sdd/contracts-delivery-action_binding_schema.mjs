// Immutable work-package data only. Structural validity is NOT issuer trust,
// method execution, semantic review or permission to dispatch. Runtime owners
// must independently verify protected policy, origin, input and attempt binding.
import { defineContract } from './contracts-delivery-schema_kernel.mjs';

export const CONTRACT = defineContract({
  name: 'SDD.Delivery.ActionBinding', version: 1,
  description: 'versioned action/method/work-package binding, no scheduler or state store',
  unknownFields: 'reject',
  fields: {
    profile: { type: 'string' }, runnerId: { type: 'string' }, run: { type: 'string' },
    action: { type: 'string' }, gate: { type: 'string' }, execution: { type: 'string' }, role: { type: 'string' },
    revision: { type: 'string' }, attempt: { type: 'int', min: 1 }, epoch: { type: 'int', min: 0 },
    inputDigest: { type: 'sha256' }, policyDigest: { type: 'sha256' }, environmentDigest: { type: 'sha256' },
    workPackage: { type: 'object', unknownFields: 'reject', fields: { id: { type: 'string' }, taskIds: { type: 'array', min: 1, items: { type: 'string' } } } },
    methods: { type: 'array', min: 1, items: { unknownFields: 'reject', fields: {
      name: { type: 'string' }, version: { type: 'pinnedVersion' }, ref: { type: 'path' }, digest: { type: 'sha256' },
    } } },
    allowedPaths: { type: 'array', min: 1, items: { type: 'path' } },
    allowedTools: { type: 'array', min: 1, items: { type: 'string' } },
    inputs: { type: 'array', min: 1, items: { unknownFields: 'reject', fields: { name: { type: 'string' }, ref: { type: 'path' }, digest: { type: 'sha256' } } } },
    outputs: { type: 'array', min: 1, items: { unknownFields: 'reject', fields: { name: { type: 'string' }, ref: { type: 'path' } } } },
  },
});

function freezeData(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freezeData(item); Object.freeze(value); }
  return value;
}

export function validateActionBinding(payload) {
  const parsed = CONTRACT.validate(payload);
  if (!parsed.ok) return parsed;
  const errors = [];
  const normalized = (value) => value.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.').join('/');
  for (const output of payload.outputs) {
    const target = normalized(output.ref);
    if (!payload.allowedPaths.some((entry) => { const scope = normalized(entry); return scope === '' || target === scope || target.startsWith(scope + '/'); })) errors.push(`outputs.${output.name}: target is outside allowedPaths`);
  }
  if (payload.allowedTools.some((tool) => !/^[-A-Za-z0-9_.:]+$/.test(tool))) errors.push('allowedTools: exact literal tool names required');
  for (const [label, ids] of [
    ['methods', payload.methods.map((method) => method.name)],
    ['workPackage.taskIds', payload.workPackage.taskIds],
    ['inputs', payload.inputs.map((input) => input.name)],
    ['outputs', payload.outputs.map((output) => output.name)],
  ]) if (new Set(ids).size !== ids.length) errors.push(`${label}: duplicate identities refused`);
  return errors.length ? { ok: false, errors } : { ok: true, value: freezeData(structuredClone(parsed.value)) };
}
