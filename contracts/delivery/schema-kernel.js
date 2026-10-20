// Handwritten schema kernel for the frozen SDD.Delivery.* contracts (v1).
// Zero-dependency and fail-closed, following the tools/infra validator style:
// a payload without an explicit schemaVersion, or with an unknown version, is
// an explicit error — never silently accepted or silently migrated.
// (delivery-architecture.md section 4: these are proposed interfaces.)

const SHA256_RE = /^[a-f0-9]{64}$/;

// Same semantics as tools/infra/secret-refs.mjs ABSOLUTE_PATH_FORBIDDEN:
// committed contract payloads carry repo-relative references, never host paths.
const HOST_PATH_PATTERN = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;
// Floating/unpinned versions: exact floating tags, pkg@latest forms, semver
// ranges (^ ~ > < =) and wildcard minors (1.x). Pinned releases pass untouched.
const FLOATING_VERSION_EXACT = /^(latest|head|\*|x)$/i;
const UNPINNED_VERSION_PATTERN = /@latest|@head|[~^><=]|\d+\.(x|\*)$/i;

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
    case 'path':
      if (typeof value !== 'string' || value.length === 0) errors.push(`${label}: must be a non-empty repo-relative path`);
      else if (HOST_PATH_PATTERN.test(value)) errors.push(`${label}: machine absolute paths are forbidden (ABSOLUTE_PATH_FORBIDDEN)`);
      break;
    case 'pinnedVersion':
      if (typeof value !== 'string' || value.length === 0) errors.push(`${label}: must be a non-empty version`);
      else if (HOST_PATH_PATTERN.test(value)) errors.push(`${label}: machine absolute paths are forbidden (ABSOLUTE_PATH_FORBIDDEN)`);
      else if (FLOATING_VERSION_EXACT.test(value) || UNPINNED_VERSION_PATTERN.test(value)) errors.push(`${label}: floating versions are forbidden (latest/HEAD/unpinned) — pin an exact release`);
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

// unknownFields: 'allow' (default) keeps the additive extra-field evolution
// path for contracts that opt out of strictness; 'reject' gives a contract a
// closed top-level field set (fail-closed) once its surface is fully modeled.
export function defineContract({ name, version, description, fields, unknownFields = 'allow' }) {
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
      if (unknownFields === 'reject') {
        for (const key of Object.keys(payload)) {
          if (key !== 'schemaVersion' && !fields[key]) {
            errors.push(`${key}: unknown field — ${name} v${version} has a closed field set`);
          }
        }
      }
      return errors.length > 0 ? { ok: false, errors } : { ok: true, value: payload };
    },
  };
}
