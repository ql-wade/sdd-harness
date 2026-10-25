// SecretRef.v1 — purpose-bound 不透明秘密引用：格式校验、登记目录校验与只读解析门。
//
// 本模块刻意不连接任何真实 secret store：resolveSecretRef 在项目/登记/身份/角色四重检查通过后，
// 仍只返回 UNRESOLVED（无运行时授权），绝不返回值。秘密值只能由后续任务的运行时授权机制挂载。
// 明文与宿主路径扫描是安全不变量（不是可调策略），因此编译在本模块而不是 policy 文件里。

export const SECRET_REF_PREFIX = 'secret-ref:';
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonBlank = (value) => typeof value === 'string' && value.trim() !== '';
const stringList = (values, predicate = () => true) => Array.isArray(values) && values.length > 0
  && Array.from(values).every((value) => nonBlank(value) && predicate(value)) && new Set(values).size === values.length;
const QUALIFICATION_CATEGORIES = ['source-commit', 'source-digest', 'artifact-size', 'image-digest', 'platform', 'license', 'health-api', 'backup-compatibility'];

export function validateQualificationPolicy(policy) {
  const violations = [];
  const require = (ok, at, expected) => { if (!ok) violations.push({ code: 'POLICY_SCHEMA_INVALID', at, expected }); };
  if (!isObject(policy)) return [{ code: 'POLICY_SCHEMA_INVALID', at: 'policy', expected: 'object' }];
  require(policy.schemaVersion === 1, 'policy.schemaVersion', 'version 1');
  require(policy.interface === 'Qualification.v1', 'policy.interface', 'Qualification.v1');
  require(stringList(policy.roles, (role) => NAME_PATTERN.test(role)), 'policy.roles', 'non-empty unique role-name array');
  const categories = policy.evidenceCategories;
  require(stringList(categories, (category) => QUALIFICATION_CATEGORIES.includes(category))
    && categories.length === QUALIFICATION_CATEGORIES.length,
  'policy.evidenceCategories', 'all eight implemented categories, without duplicates');
  for (const [section, fields] of [['imageReference', ['digestPinnedRequired', 'floatingTagsForbidden']], ['upGate', ['enabled', 'requireAllCategoriesVerified']]]) {
    require(isObject(policy[section]), `policy.${section}`, 'object');
    if (isObject(policy[section])) {
      for (const field of fields) require(typeof policy[section][field] === 'boolean', `policy.${section}.${field}`, 'boolean');
    }
  }
  if (isObject(policy.imageReference)) require(policy.imageReference.digestFormat === '^sha256:[0-9a-f]{64}$', 'policy.imageReference.digestFormat', 'canonical SHA256 format');
  if (isObject(policy.upGate)) require(nonBlank(policy.upGate.refusalReason), 'policy.upGate.refusalReason', 'non-blank string');
  require(stringList(policy.secretValueKeyNames, (key) => /^[a-z][a-z0-9_-]*$/.test(key)), 'policy.secretValueKeyNames', 'non-empty unique field-name array');
  require(stringList(policy.forbiddenHostPathPrefixes, (prefix) => /^\/(?:[A-Za-z0-9._-]+\/)+$/.test(prefix) && !prefix.includes('/../')),
    'policy.forbiddenHostPathPrefixes', 'non-empty unique absolute directory-prefix array');
  return violations;
}

// 键名疑为秘密持有者的：非空即拒绝（引用目录只允许引用，不允许值）。
const SECRET_VALUE_KEY_PATTERN = /secret|token|password|passwd|apikey|api_key|privatekey|private_key|credentialvalue/i;
const SECRET_VALUE_EXACT_KEY_PATTERN = /^(value|secret|token|password|passwd|api_?key|private_?key)$/i;

const SECRET_PLAINTEXT_PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/,
  /gho_[A-Za-z0-9]{20,}/,
  /ghs_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /npm_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{25,}/,
];

const HOST_PATH_PATTERN = /(^|[\s"'=(:/])\/(Users|Volumes|home|root|private|var|usr|etc|opt|tmp)\//;

export function redactSecretValue(value) {
  return typeof value === 'string' && SECRET_PLAINTEXT_PATTERNS.some((pattern) => pattern.test(value))
    ? '<secret-redacted>'
    : value;
}

export function parseSecretRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(SECRET_REF_PREFIX)) {
    return { ok: false, code: 'MALFORMED_REF', error: 'ref must start with secret-ref:' };
  }
  const rest = ref.slice(SECRET_REF_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1 || rest.indexOf('/', slash + 1) !== -1) {
    return { ok: false, code: 'MALFORMED_REF', error: 'ref must be secret-ref:<project>/<name>' };
  }
  const project = rest.slice(0, slash);
  const name = rest.slice(slash + 1);
  if (!NAME_PATTERN.test(project) || !NAME_PATTERN.test(name)) {
    return { ok: false, code: 'MALFORMED_REF', error: 'project and name must be lowercase kebab labels' };
  }
  return { ok: true, project, name };
}

export function scanForForbiddenValues(node, key = '', out = []) {
  if (Array.isArray(node)) {
    for (const item of node) scanForForbiddenValues(item, key, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [childKey, value] of Object.entries(node)) scanForForbiddenValues(value, childKey, out);
    return out;
  }
  if (typeof node === 'string' && node.trim() !== '') {
    if (SECRET_VALUE_KEY_PATTERN.test(key) || SECRET_VALUE_EXACT_KEY_PATTERN.test(key)) {
      out.push({ code: 'SECRET_VALUE_KEY_FORBIDDEN', key, reason: 'registry structures carry references only, never secret values' });
    }
    if (SECRET_PLAINTEXT_PATTERNS.some((pattern) => pattern.test(node))) {
      out.push({ code: 'SECRET_PLAINTEXT_FORBIDDEN', key, reason: 'string matches a known secret token shape' });
    }
    if (HOST_PATH_PATTERN.test(node)) {
      out.push({ code: 'ABSOLUTE_PATH_FORBIDDEN', key, reason: 'host absolute paths must never be committed' });
    }
  }
  return out;
}

export function validateRefsCatalog(refsDoc, expectedProject, options = {}) {
  const violations = [];
  if (!isObject(options) || Object.keys(options).some((key) => !['roles', 'policy'].includes(key))
    || (Object.hasOwn(options, 'roles') && Object.hasOwn(options, 'policy'))) {
    return [{ code: 'REFS_OPTIONS_INVALID', reason: 'options must be an object with at most one role-policy source' }];
  }
  let roles;
  if (Object.hasOwn(options, 'policy')) {
    const policyViolations = validateQualificationPolicy(options.policy);
    if (policyViolations.length) return policyViolations;
    roles = options.policy.roles;
  } else if (Object.hasOwn(options, 'roles')) {
    if (!stringList(options.roles, (role) => NAME_PATTERN.test(role))) return [{ code: 'REFS_OPTIONS_INVALID', reason: 'roles must be a non-empty unique role-name array' }];
    roles = options.roles;
  }
  if (!isObject(refsDoc) || refsDoc.interface !== 'SecretRef.v1' || !Array.isArray(refsDoc.refs)
    || (Object.hasOwn(refsDoc, 'schemaVersion') && refsDoc.schemaVersion !== 1)) {
    violations.push({ code: 'REFS_SCHEMA_INVALID', reason: 'refs catalog must carry interface SecretRef.v1 and a refs array' });
    return violations;
  }
  const seen = new Map();
  for (const entry of refsDoc.refs) {
    if (!isObject(entry)) {
      violations.push({ code: 'REFS_SCHEMA_INVALID', reason: 'each registered reference must be an object' });
      continue;
    }
    const parsed = parseSecretRef(entry.ref);
    if (!parsed.ok) {
      violations.push({ code: parsed.code, ref: entry.ref, reason: parsed.error });
      continue;
    }
    if (expectedProject !== undefined && parsed.project !== expectedProject) {
      violations.push({ code: 'CROSS_PROJECT_REF', ref: entry.ref, project: parsed.project });
    }
    const previous = seen.get(entry.ref);
    if (previous) {
      violations.push({
        code: 'ROLE_REUSE',
        ref: entry.ref,
        roles: [previous.boundRole ?? null, entry.boundRole ?? null],
        reason: 'one credential reference must have exactly one binding; reuse across bindings is forbidden',
      });
    } else {
      seen.set(entry.ref, entry);
    }
    if (typeof entry.purpose !== 'string' || entry.purpose.trim() === '') {
      violations.push({ code: 'REF_PURPOSE_MISSING', ref: entry.ref });
    }
    if (typeof entry.boundRole !== 'string' || !NAME_PATTERN.test(entry.boundRole)) {
      violations.push({ code: 'ROLE_INVALID', ref: entry.ref, role: entry.boundRole ?? null });
    } else if (roles && !roles.includes(entry.boundRole)) {
      violations.push({ code: 'ROLE_NOT_IN_POLICY', ref: entry.ref, role: entry.boundRole });
    }
    if (!stringList(entry.allowedPrincipals)) violations.push({ code: 'REF_PRINCIPALS_INVALID', ref: entry.ref, reason: 'allowedPrincipals must be a non-empty unique string array' });
  }
  return violations.concat(scanForForbiddenValues(refsDoc));
}

export function resolveSecretRef(options) {
  const deny = (code) => {
    const error = new Error('secret reference resolution denied');
    error.code = code;
    throw error;
  };
  if (!isObject(options) || Object.keys(options).some((key) => !['ref', 'principalId', 'role', 'refsDoc', 'project', 'policy'].includes(key))) deny('RESOLUTION_INPUT_INVALID');
  const { ref, principalId, role, refsDoc, project } = options;
  const parsed = parseSecretRef(ref);
  if (!parsed.ok) deny(parsed.code);
  if (project !== undefined && parsed.project !== project) {
    deny('CROSS_PROJECT_REF');
  }
  const violations = validateRefsCatalog(refsDoc, project ?? parsed.project,
    Object.hasOwn(options, 'policy') ? { policy: options.policy } : {});
  if (violations.length > 0) {
    deny(violations[0].code);
  }
  const entry = (refsDoc && Array.isArray(refsDoc.refs) ? refsDoc.refs : []).find((item) => item.ref === ref);
  if (!entry) deny('REF_NOT_REGISTERED');
  const principals = Array.isArray(entry.allowedPrincipals) ? entry.allowedPrincipals : [];
  if (!principalId || !principals.includes(principalId) || (entry.boundRole && role !== entry.boundRole)) {
    deny('PRINCIPAL_NOT_AUTHORIZED');
  }
  // 四重检查全部通过：本任务仍无运行时 secret store 授权，如实 UNRESOLVED，绝不产生值。
  return {
    ref,
    project: parsed.project,
    purpose: entry.purpose ?? null,
    boundRole: entry.boundRole ?? null,
    resolved: false,
    status: 'UNRESOLVED',
    reason:
      'NO_RUNTIME_SECRET_STORE_AUTHORIZATION: value retrieval requires a runtime-authorized secret store, which I01 deliberately does not implement',
  };
}
