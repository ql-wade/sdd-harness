// Handwritten schema kernel for the frozen SDD.Delivery.* contracts (v1).
// Zero-dependency and fail-closed, following the tools/infra validator style:
// a payload without an explicit schemaVersion, or with an unknown version, is
// an explicit error — never silently accepted or silently migrated.
// (delivery-architecture.md section 4: these are proposed interfaces.)

const SHA256_RE = /^[a-f0-9]{64}$/;

function validateValue(errors, label, value, rule) {
  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string' || value.length === 0) errors.push(`${label}: must be a non-empty string`);
      break;
    case 'sha256':
      if (typeof value !== 'string' || !SHA256_RE.test(value)) errors.push(`${label}: must be a sha256 hex digest`);
      break;
    case 'int': {
      const min = rule.min ?? 0;
      if (!Number.isInteger(value) || value < min) errors.push(`${label}: must be an integer >= ${min}`);
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${label}: must be a boolean`);
      break;
    case 'iso8601':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) errors.push(`${label}: must be an ISO-8601 timestamp`);
      break;
    case 'enum':
      if (!rule.values.includes(value)) errors.push(`${label}: must be one of ${rule.values.join('|')}`);
      break;
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${label}: must be an array`);
        break;
      }
      if (rule.min !== undefined && value.length < rule.min) {
        errors.push(`${label}: must contain at least ${rule.min} item(s)`);
      }
      if (rule.items) {
        value.forEach((item, index) => {
          const itemLabel = `${label}[${index}]`;
          if (rule.items.fields) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
              errors.push(`${itemLabel}: must be an object`);
              return;
            }
            validateFields(errors, `${itemLabel}.`, item, rule.items.fields);
          } else {
            validateValue(errors, itemLabel, item, rule.items);
          }
        });
      }
      break;
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${label}: must be an object`);
        break;
      }
      if (rule.fields) validateFields(errors, `${label}.`, value, rule.fields);
      break;
    }
    default:
      errors.push(`${label}: unknown rule type ${rule.type} (kernel bug)`);
  }
}

function validateFields(errors, prefix, payload, fields) {
  for (const [key, rule] of Object.entries(fields)) {
    const label = `${prefix}${key}`;
    const value = payload[key];
    if (value === undefined || value === null) {
      if (rule.required !== false) errors.push(`${label}: missing required ${rule.type} field`);
      continue;
    }
    validateValue(errors, label, value, rule);
  }
}

export function defineContract({ name, version, description, fields }) {
  return {
    name,
    version,
    description,
    validate(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, errors: [`${name}: payload must be a JSON object`] };
      }
      const errors = [];
      const declared = payload.schemaVersion;
      if (declared === undefined || declared === null) {
        errors.push(`schemaVersion: missing — ${name} v${version} requires an explicit schemaVersion (refusing to guess)`);
      } else if (!Number.isInteger(declared)) {
        errors.push(`schemaVersion: must be an integer, got ${typeof declared}`);
      } else if (declared > version) {
        errors.push(`schemaVersion: ${declared} is newer than supported v${version} — unknown future version explicitly rejected`);
      } else if (declared < version) {
        errors.push(`schemaVersion: ${declared} is older than supported v${version} — no compatibility mapping declared, explicitly rejected`);
      }
      validateFields(errors, '', payload, fields);
      return errors.length > 0 ? { ok: false, errors } : { ok: true, value: payload };
    },
  };
}
