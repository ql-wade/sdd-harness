// SecretRef.v1 — purpose-bound 不透明秘密引用：格式校验、登记目录校验与只读解析门。
//
// 本模块刻意不连接任何真实 secret store：resolveSecretRef 在项目/登记/身份/角色四重检查通过后，
// 仍只返回 UNRESOLVED（无运行时授权），绝不返回值。秘密值只能由后续任务的运行时授权机制挂载。
// 明文与宿主路径扫描是安全不变量（不是可调策略），因此编译在本模块而不是 policy 文件里。

export const SECRET_REF_PREFIX = 'secret-ref:';
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

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
  /sk-[A-Za-z0-9]{20,}/,
  /npm_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{25,}/,
];

const HOST_PATH_PATTERN = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;

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

export function validateRefsCatalog(refsDoc, expectedProject, { roles } = {}) {
  const violations = [];
  if (!refsDoc || refsDoc.interface !== 'SecretRef.v1' || !Array.isArray(refsDoc.refs)) {
    violations.push({ code: 'REFS_SCHEMA_INVALID', reason: 'refs catalog must carry interface SecretRef.v1 and a refs array' });
    return violations;
  }
  const seen = new Map();
  for (const entry of refsDoc.refs) {
    const parsed = parseSecretRef(entry.ref);
    if (!parsed.ok) {
      violations.push({ code: parsed.code, ref: entry.ref, reason: parsed.error });
      continue;
    }
    if (expectedProject && parsed.project !== expectedProject) {
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
    if (!entry.purpose || typeof entry.purpose !== 'string') {
      violations.push({ code: 'REF_PURPOSE_MISSING', ref: entry.ref });
    }
    if (!entry.boundRole || !NAME_PATTERN.test(entry.boundRole)) {
      violations.push({ code: 'ROLE_INVALID', ref: entry.ref, role: entry.boundRole ?? null });
    } else if (roles && !roles.includes(entry.boundRole)) {
      violations.push({ code: 'ROLE_NOT_IN_POLICY', ref: entry.ref, role: entry.boundRole });
    }
  }
  return violations.concat(scanForForbiddenValues(refsDoc));
}

export function resolveSecretRef({ ref, principalId, role, refsDoc, project }) {
  const deny = (code, reason) => {
    const error = new Error(reason);
    error.code = code;
    throw error;
  };
  const parsed = parseSecretRef(ref);
  if (!parsed.ok) deny(parsed.code, parsed.error);
  if (project && parsed.project !== project) {
    deny('CROSS_PROJECT_REF', `ref ${ref} belongs to project ${parsed.project}, not ${project}`);
  }
  const entry = (refsDoc && Array.isArray(refsDoc.refs) ? refsDoc.refs : []).find((item) => item.ref === ref);
  if (!entry) deny('REF_NOT_REGISTERED', `ref ${ref} is not registered in the project catalog`);
  const principals = Array.isArray(entry.allowedPrincipals) ? entry.allowedPrincipals : [];
  if (!principalId || !principals.includes(principalId) || (entry.boundRole && role !== entry.boundRole)) {
    deny('PRINCIPAL_NOT_AUTHORIZED', `principal ${principalId ?? '(none)'} with role ${role ?? '(none)'} may not resolve ${ref}`);
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
