#!/usr/bin/env node
// OutlineInfra.v1 / OutlineDomain.v1 / OutlineState.v1 CLI — validate | qualify | up | probe | stop
//
// 只登记、声明与验收：不启动任何服务、不持有阶段/DAG/业务重试、不改活配置（hooks/MCP 由对应 P 任务串行接纳）。
// 镜像 tag/digest 一律来自 infra/delivery/outline/images.lock.json；当前不存在已认证镜像，严禁虚构。
// 秘密值永不读写：域文件只能携带 secret-ref 引用，解析属运行时授权机制（I01 secret-refs 只读门）。
//
// 退出码契约（execution-contract.json V_INFRA_I03.cli_contract）：
//   0 = PASS（validate 通过）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、未知 probe case）
//   2 = 验证失败（语义违规、qualify NOT_READY、up 被拒、probe/stop 环境缺失 UNVERIFIED）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 或 mock 转绿。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, scanForForbiddenValues } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const DEFAULT_DIR = path.join(repoRoot, 'infra', 'delivery', 'outline');

const JSON_FILES = ['images.lock.json', 'oidc-registration.example.json', 'storage-policy.json', 'collection-registration.example.json'];
const DOMAIN_FILES = ['compose.yaml', 'outline.env.example', ...JSON_FILES];
const REQUIRED_COMPONENTS = ['outline-app', 'outline-postgres', 'outline-redis', 'outline-object-store'];
const CONCRETE_ENV_ALLOWLIST = new Set(['URL', 'PORT', 'FORCE_HTTPS', 'NODE_ENV', 'OIDC_DISPLAY_NAME', 'OIDC_SCOPES']);
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SECRET_REF_PREFIX = 'secret-ref:';

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时目录）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

const HOST_PATH_IN_VALUE = /(^|[\s"'=(:])\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;
const HOST_USER_PATH = /(^|[\s"'=(:])\/(Users|home|root)\//;
const SECRET_PLAINTEXT = [
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

const UNVERIFIED = (reason) => ({ status: 'UNVERIFIED', reason });
const RECORDED = (reason) => ({ status: 'RECORDED', reason });

function usage() {
  return [
    'usage:',
    '  outline.mjs validate --registry <file> [--refs <file>] [--dir <outline dir>] [--json]',
    '  outline.mjs qualify  --registry <file> [--dir <outline dir>] [--json]',
    '  outline.mjs up       --registry <file> [--dir <outline dir>] [--json]',
    '  outline.mjs probe    --case <oidc-principal-acl|restart-persistence|attachment-denial> [--endpoint <url>] [--registry <file>] [--dir <outline dir>] [--json]',
    '  outline.mjs stop     [--registry <file>] [--dir <outline dir>] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (value === undefined) return { command, opts, error: `missing value for ${arg}` };
      opts[arg.slice(2)] = value;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, null, 2) + '\n');
}

function failInput(message) {
  process.stderr.write(`${message}\n${usage()}\n`);
  return EXIT_INPUT;
}

const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');

function loadDomainFiles(dir) {
  const files = new Map();
  const missing = [];
  const unparseable = [];
  for (const name of DOMAIN_FILES) {
    try {
      files.set(name, fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      missing.push(name);
    }
  }
  for (const name of JSON_FILES) {
    if (!files.has(name)) continue;
    try {
      JSON.parse(files.get(name));
    } catch (error) {
      unparseable.push(`${name}: ${redactHostPaths(error.message)}`);
    }
  }
  return { files, missing, unparseable };
}

function collectSecretRefs(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectSecretRefs(item, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectSecretRefs(value, out);
    return;
  }
  if (typeof node === 'string' && node.trim().startsWith(SECRET_REF_PREFIX)) out.add(node.trim());
}

function parseEnv(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    lines.push(eq === -1 ? { key: trimmed, value: null } : { key: trimmed.slice(0, eq).trim(), value: trimmed.slice(eq + 1).trim() });
  }
  return lines;
}

// compose 仅声明门（行级结构检查；真实网络/挂载执行效果属 up 后的运行时证据）。
function validateCompose(text) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  let section = null;
  let sawServices = false;
  let sawNetworks = false;
  for (const [index, raw] of text.split('\n').entries()) {
    const lineNo = index + 1;
    const trimmedRaw = raw.trim();
    const stripped = raw.replace(/\$\{[^}]*\}/g, 'PLACEHOLDER');
    const trimmed = stripped.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^image:\s*/.test(trimmedRaw)) {
      // 镜像引用只能是 ${VAR:?} 占位（由 images.lock 解析注入）；任何具体 tag 都拒绝。
      if (!/^image:\s*\$\{[A-Z0-9_]+:\?[^}]*\}\s*$/.test(trimmedRaw)) {
        add('COMPOSE_IMAGE_NOT_LOCK_RESOLVED', `compose.yaml:${lineNo}`, { line: trimmedRaw.slice(0, 120) });
      }
      section = null;
      continue;
    }
    if (/^network_mode:\s*host/.test(trimmed)) add('HOST_NETWORK_FORBIDDEN', `compose.yaml:${lineNo}`);
    if (/^privileged:\s*true/.test(trimmed)) add('PRIVILEGED_FORBIDDEN', `compose.yaml:${lineNo}`);
    if (HOST_USER_PATH.test(stripped)) add('HOST_MOUNT_FORBIDDEN', `compose.yaml:${lineNo}`, { reason: 'host user paths never belong in compose' });

    const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      const [, key, rest] = keyMatch;
      if (rest === '') {
        if (key === 'services') sawServices = true;
        if (key === 'networks') sawNetworks = true;
        section = key;
      } else {
        section = null;
      }
      continue;
    }
    if (trimmed.startsWith('-') && (section === 'ports' || section === 'volumes')) {
      let item = trimmed.slice(1).trim();
      if (item.startsWith('"') && item.endsWith('"')) item = item.slice(1, -1);
      if (section === 'ports') {
        if (item.split(':')[0] !== '127.0.0.1') add('PORT_BINDING_NOT_LOOPBACK', `compose.yaml:${lineNo}`, { binding: item });
      } else {
        const left = item.split(':')[0];
        if (left === 'PLACEHOLDER' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(left)) {
          add('HOST_MOUNT_FORBIDDEN', `compose.yaml:${lineNo}`, { mount: item, reason: 'only named volumes are allowed; no host bind mounts' });
        }
      }
    }
  }
  if (!sawServices) add('SERVICES_MISSING', 'compose.yaml');
  if (!sawNetworks) add('NETWORK_MISSING', 'compose.yaml');
  if (!/internal:\s*true/.test(text)) add('NETWORK_NOT_INTERNAL', 'compose.yaml');
  return violations;
}

function validateDomain({ registry, refsDoc, files }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const projectId = registry?.project?.id;
  const jsonDocs = new Map(JSON_FILES.map((name) => [name, JSON.parse(files.get(name))]));

  // 全域 secret-ref：格式 + 项目绑定 + catalog 登记缺口（缺口显式上报，绝不静默）。
  const refs = new Set();
  for (const name of JSON_FILES) collectSecretRefs(jsonDocs.get(name), refs);
  for (const { value } of parseEnv(files.get('outline.env.example'))) {
    if (value && value.startsWith(SECRET_REF_PREFIX)) refs.add(value);
  }
  const catalogRefs = new Set((refsDoc?.refs ?? []).map((entry) => entry.ref));
  const catalogGaps = [];
  for (const ref of refs) {
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) {
      add('MALFORMED_REF', 'domain refs', { ref, reason: parsed.error });
      continue;
    }
    if (projectId && parsed.project !== projectId) {
      add('CROSS_PROJECT_REF', 'domain refs', { ref, project: parsed.project });
      continue;
    }
    if (!catalogRefs.has(ref)) catalogGaps.push(ref);
  }
  catalogGaps.sort();

  // images.lock：组件齐备、无浮动 tag、digest 格式与认证声明一致、upGate 保持关闭。
  const lock = jsonDocs.get('images.lock.json');
  if (lock.interface !== 'OutlineImageLock.v1') add('LOCK_INTERFACE_INVALID', 'images.lock.json', { expected: 'OutlineImageLock.v1' });
  const components = Array.isArray(lock.components) ? lock.components : [];
  const byName = new Map(components.map((component) => [component.component, component]));
  for (const name of REQUIRED_COMPONENTS) {
    const entry = byName.get(name);
    const at = `images.lock.json:${name}`;
    if (!entry) {
      add('MISSING_LOCK_COMPONENT', at);
      continue;
    }
    if (typeof entry.reference === 'string') {
      if (/:latest\s*$/.test(entry.reference)) add('FLOATING_TAG_FORBIDDEN', at, { reference: entry.reference });
      if (!entry.digest) add('IMAGE_NOT_DIGEST_PINNED', at, { reference: entry.reference });
    }
    if (entry.digest !== null && entry.digest !== undefined && !DIGEST_RE.test(entry.digest)) {
      add('DIGEST_FORMAT_INVALID', at, { digest: entry.digest });
    }
    if (entry.digestAuthenticated === true && !entry.digest) {
      add('DIGEST_AUTH_FLAG_INCONSISTENT', at, { reason: 'digestAuthenticated=true requires a digest' });
    }
  }
  if (lock.upGate?.enabled !== false) {
    add('UP_GATE_NOT_CLOSED', 'images.lock.json:upGate', { reason: 'committed lock must declare upGate.enabled=false until resource admission' });
  }

  // env：明文秘密 / 宿主绝对路径 / 未绑定具体值（敏感变量只允许 secret-ref 或空）。
  const envText = files.get('outline.env.example');
  for (const [index, { key, value }] of parseEnv(envText).entries()) {
    const at = `outline.env.example:${index + 1}:${key}`;
    if (value === null) {
      add('ENV_LINE_MALFORMED', at);
      continue;
    }
    if (value === '') continue;
    if (SECRET_PLAINTEXT.some((pattern) => pattern.test(value))) {
      add('SECRET_PLAINTEXT_FORBIDDEN', at, { reason: 'value matches a known secret token shape' });
      continue;
    }
    if (HOST_PATH_IN_VALUE.test(value)) {
      add('ABSOLUTE_PATH_FORBIDDEN', at);
      continue;
    }
    if (value.startsWith(SECRET_REF_PREFIX)) continue;
    if (!CONCRETE_ENV_ALLOWLIST.has(key)) {
      add('ENV_UNBOUND_VALUE_FORBIDDEN', at, { reason: 'sensitive values must bind to a secret-ref; concrete values are allowlisted keys only' });
    }
  }
  for (const [index, raw] of envText.split('\n').entries()) {
    if (HOST_USER_PATH.test(raw)) add('ABSOLUTE_PATH_FORBIDDEN', `outline.env.example:${index + 1}`);
  }

  // OIDC 注册结构：provider/issuer、client+凭据引用、loopback redirect、subject 映射、测试主体。
  const oidc = jsonDocs.get('oidc-registration.example.json');
  const oidcMissing = [];
  if (!oidc.provider || !('issuerUrl' in oidc.provider)) oidcMissing.push('provider.issuerUrl');
  if (!oidc.client) {
    oidcMissing.push('client');
  } else {
    if (!oidc.client.credentialRef) oidcMissing.push('client.credentialRef');
    if (!oidc.client.sessionCredentialRef) oidcMissing.push('client.sessionCredentialRef');
    const uris = Array.isArray(oidc.client.redirectUris) ? oidc.client.redirectUris : [];
    if (uris.length === 0) oidcMissing.push('client.redirectUris');
    for (const uri of uris) {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
        add('REDIRECT_URI_NOT_LOOPBACK', 'oidc-registration.example.json:client.redirectUris', { uri });
      }
    }
  }
  if (!oidc.subjectMapping) oidcMissing.push('subjectMapping');
  const principals = oidc.testPrincipals ?? {};
  if (!('owner' in principals) || !('member' in principals) || !('offboarded' in principals)) {
    oidcMissing.push('testPrincipals(owner/member/offboarded)');
  }
  if (oidcMissing.length > 0) add('OIDC_REGISTRATION_INCOMPLETE', 'oidc-registration.example.json', { missing: oidcMissing });

  // storage-policy：持久状态声明、cache 非权威、撤回不假定立即生效、API 契约登记。
  const policy = jsonDocs.get('storage-policy.json');
  const policyMissing = [];
  const state = policy.state ?? {};
  if (!state.database || state.database.durable !== true) policyMissing.push('state.database.durable=true');
  if (!state.attachments || state.attachments.durable !== true) policyMissing.push('state.attachments.durable=true');
  if (!state.cache) {
    policyMissing.push('state.cache');
  } else {
    if (state.cache.rightsAuthority === true) {
      add('CACHE_AS_AUTHORITY_FORBIDDEN', 'storage-policy.json:state.cache', { reason: 'cache is never the rights authority (OutlineState.v1)' });
    }
    if (state.cache.durable === true) {
      add('CACHE_DURABILITY_FORBIDDEN', 'storage-policy.json:state.cache', { reason: 'cache is explicitly non-durable' });
    }
  }
  if (!policy.revocation || policy.revocation.immediateEffectAssumed !== false) {
    add('REVOCATION_ASSUMED_IMMEDIATE', 'storage-policy.json:revocation', { reason: 'attachment revocation must not be assumed immediately effective (signed-URL residue risk)' });
  }
  const contracts = policy.apiContracts ?? {};
  for (const key of ['fixedCreateUuid', 'lastRevision']) {
    if (!contracts[key] || typeof contracts[key].status !== 'string') policyMissing.push(`apiContracts.${key}.status`);
  }
  if (policyMissing.length > 0) add('STORAGE_POLICY_INCOMPLETE', 'storage-policy.json', { missing: policyMissing });

  // collection-registration：instance 登记 + 每文集 owner/grant/受众登记。
  const domain = jsonDocs.get('collection-registration.example.json');
  if (domain.interface !== 'OutlineDomain.v1') add('DOMAIN_INTERFACE_INVALID', 'collection-registration.example.json', { expected: 'OutlineDomain.v1' });
  if (!domain.instance || !('id' in domain.instance)) {
    add('DOMAIN_REGISTRATION_INCOMPLETE', 'collection-registration.example.json:instance', { missing: 'instance.id' });
  }
  const collections = Array.isArray(domain.collections) ? domain.collections : [];
  if (collections.length === 0) {
    add('DOMAIN_REGISTRATION_INCOMPLETE', 'collection-registration.example.json:collections', { missing: 'at least one collection' });
  }
  for (const [index, collection] of collections.entries()) {
    const at = `collection-registration.example.json:collections[${index}]:${collection.name ?? index}`;
    if (!collection.owner) {
      add('OWNER_REGISTRATION_MISSING', at);
    } else if (!collection.owner.grantRef) {
      add('GRANT_REF_MISSING', `${at}:owner`);
    }
    if (!collection.audience || !Array.isArray(collection.audience.readers)) {
      add('AUDIENCE_REGISTRATION_MISSING', at);
    }
  }

  // JSON 结构安全扫描 + compose 声明门。
  for (const name of JSON_FILES) violations.push(...scanForForbiddenValues(jsonDocs.get(name)));
  violations.push(...validateCompose(files.get('compose.yaml')));

  return { violations, catalogGaps };
}

function buildQualification({ registryFile, dir, files, catalogGaps }) {
  const lock = JSON.parse(files.get('images.lock.json'));
  const components = Array.isArray(lock.components) ? lock.components : [];
  const unreadyComponents = [];
  for (const name of REQUIRED_COMPONENTS) {
    const entry = components.find((component) => component.component === name);
    if (!entry || typeof entry.reference !== 'string' || !entry.digest || !DIGEST_RE.test(entry.digest) || entry.digestAuthenticated !== true) {
      unreadyComponents.push({
        component: name,
        status: 'UNVERIFIED',
        reason: !entry
          ? 'component missing from lock'
          : `reference=${entry.reference ? 'recorded' : 'UNSELECTED'}, digest=${entry.digest ? 'recorded' : 'absent'}, digestAuthenticated=${entry.digestAuthenticated === true}`,
      });
    }
  }
  const categories = {
    'image-digest-authenticated': unreadyComponents.length === 0
      ? { status: 'VERIFIED', observed: 'all required components carry an authenticated digest' }
      : UNVERIFIED(`no required component image has an authenticated digest (${unreadyComponents.map((c) => c.component).join(', ')}); inventing tags/digests is forbidden (images_policy.invented_tags_or_digests=false)`),
    'oidc-registration': UNVERIFIED('issuer/discovery unprovisioned; no discovery readback performed'),
    'oidc-login-proof': UNVERIFIED('no real issuance or login evidence; requires a live instance and a real issuer'),
    'object-store-access': UNVERIFIED('storage type/endpoint/bucket unselected; no bucket access proof'),
    'credentials-provisioned': UNVERIFIED('all 7 secret refs are NOT_PROVISIONED; no runtime secret store authorization exists'),
    'secret-refs-registered': catalogGaps.length === 0
      ? RECORDED('all 7 outline refs present in the I01 catalog; all remain NOT_PROVISIONED')
      : UNVERIFIED(`refs missing from the I01 catalog (catalog is I01-owned and needs a registration update): ${catalogGaps.join(', ')}`),
    'domain-registration': UNVERIFIED('immutable instance/collection IDs and effective reader sets not observed from a real deployment'),
    'state-durability': UNVERIFIED('restart-persistence probe never executed against a live instance; durable DB+attachment readback unproven'),
    'health-api': UNVERIFIED('no running service; health evidence requires the stack up'),
    'backup-compatibility': UNVERIFIED('no restore drill registered'),
  };
  const inputs = { registrySha256: sha256Text(fs.readFileSync(registryFile)), domainFiles: {} };
  for (const name of DOMAIN_FILES) inputs.domainFiles[name] = sha256Text(files.get(name));
  const values = Object.values(categories);
  return {
    interface: 'Qualification.v1',
    domain: 'outline',
    dir: displayPath(dir),
    ready: values.every((category) => category.status === 'VERIFIED'),
    unverifiedCount: values.filter((category) => category.status === 'UNVERIFIED').length,
    catalogGaps,
    categories,
    inputs,
    unreadyComponents,
  };
}

const PROBE_CASES = {
  'oidc-principal-acl': {
    requiredInputs: [
      'live Outline instance endpoint (--endpoint <url> or a registered instance.url)',
      'real OIDC issuer with issued sessions for owner/member/offboarded principals',
      'registered managed + isolation collections with real immutable IDs',
    ],
    plannedSteps: [
      'GET /api/config — instance reachable and identity observed',
      'authenticated owner session reads managed collection (expect success)',
      'unauthenticated read of collection/page/subtree (expect denial)',
      'off-group principal across collection/page/subtree/public-share/search/attachment channels (expect per-channel denial)',
      'record effective reader set closure across all entry points (admin-readable never substitutes for audience)',
    ],
  },
  'restart-persistence': {
    requiredInputs: [
      'live stack (application + database + object store)',
      'authenticated author principal',
      'disposable test page and attachment',
    ],
    plannedSteps: [
      'create test page — observe returned identifier (fixed create UUID contract)',
      'upload attachment and read it back',
      'restart application and database',
      'read back test page and attachment (durable readback)',
      'stale lastRevision update (expect 409, never blind overwrite)',
    ],
  },
  'attachment-denial': {
    requiredInputs: [
      'live object store with signed-URL issuance',
      'attachment owned by the managed collection',
      'unauthorized and off-group principals',
    ],
    plannedSteps: [
      'unauthenticated attachment fetch (expect denial)',
      'off-group principal attachment fetch (expect denial)',
      'revoke attachment then re-fetch — record signed-URL residual validity (no immediate-effect assumption)',
    ],
  },
};

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');

  if (command === 'probe') {
    const spec = PROBE_CASES[opts.case];
    if (!spec) return failInput(`unknown probe case: ${opts.case ?? '(missing --case)'}`);
    const dir = opts.dir ?? DEFAULT_DIR;
    const { files, missing, unparseable } = loadDomainFiles(dir);
    if (missing.length > 0) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
    if (unparseable.length > 0) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);
    const registration = JSON.parse(files.get('collection-registration.example.json'));
    const endpoint = opts.endpoint ?? process.env.OUTLINE_ENDPOINT ?? registration.instance?.url ?? null;
    const observation = {
      interface: 'OutlineInfra.v1',
      command: 'probe',
      case: opts.case,
      endpoint,
      executed: false,
      status: 'UNVERIFIED',
      reason: null,
      requiredInputs: spec.requiredInputs,
      plannedSteps: spec.plannedSteps,
      observedSteps: [],
    };
    if (!endpoint) {
      observation.reason =
        'no live Outline instance endpoint configured; probes require a real authenticated instance (up refuses until the images lock qualifies and admission is granted). Pass --endpoint <url> once the stack exists — this command never mocks and never skips.';
      print(observation);
      return EXIT_VERIFY;
    }
    // 真实可达性尝试：探针永远先打真实请求，失败即如实上报，绝不 mock。
    try {
      const response = await fetch(String(endpoint).replace(/\/$/, '') + '/api/config', { signal: AbortSignal.timeout(5000) });
      observation.observedSteps.push({ step: 'GET /api/config', status: 'VERIFIED', httpStatus: response.status });
    } catch (err) {
      const causeDetail = err?.cause ? (err.cause.code ?? err.cause.message ?? err.cause.name) : (err?.code ?? err?.message ?? err?.name ?? 'ERROR');
      const cause = redactHostPaths(String(causeDetail));
      observation.observedSteps.push({ step: 'GET /api/config', status: 'UNVERIFIED', error: cause });
      observation.reason = `endpoint unreachable (GET /api/config): ${cause}`;
      print(observation);
      return EXIT_VERIFY;
    }
    observation.observedSteps.push({
      step: 'authenticated principal channels',
      status: 'UNVERIFIED',
      reason: 'requires a real authenticated session (OIDC login proof not performed); credentials resolve only via runtime-authorized secret refs',
    });
    observation.reason = 'endpoint reachable, but probe channels require authenticated principals and admission evidence that do not exist yet; no step may be fabricated';
    print(observation);
    return EXIT_VERIFY;
  }

  if (command === 'stop') {
    print({
      interface: 'OutlineInfra.v1',
      command: 'stop',
      executed: false,
      status: 'UNVERIFIED',
      reason:
        'no Outline stack was ever started by this tool (up refuses until the images lock qualifies and admission is granted); there is nothing this tool can stop. A stack started outside this tool must be stopped by its own supervisor.',
    });
    return EXIT_VERIFY;
  }

  // validate/qualify/up：registry 与 refs 目录必须先可读（fail-closed，绝不静默降级为空规则）。
  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  const refsFile = opts.refs ?? DEFAULT_REFS;
  let registry;
  let refsDoc;
  try {
    registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  } catch (err) {
    return failInput(`registry unreadable: ${redactHostPaths(err.message)}`);
  }
  try {
    refsDoc = JSON.parse(fs.readFileSync(refsFile, 'utf8'));
  } catch (err) {
    return failInput(`refs catalog unreadable (${displayPath(refsFile)}): ${redactHostPaths(err.message)}`);
  }
  const dir = opts.dir ?? DEFAULT_DIR;
  const { files, missing, unparseable } = loadDomainFiles(dir);
  if (missing.length > 0) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
  if (unparseable.length > 0) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);

  if (command === 'validate') {
    const { violations, catalogGaps } = validateDomain({ registry, refsDoc, files });
    const domainDoc = JSON.parse(files.get('collection-registration.example.json'));
    const policyDoc = JSON.parse(files.get('storage-policy.json'));
    print({
      interface: 'OutlineInfra.v1',
      command: 'validate',
      registry: displayPath(registryFile),
      refs: displayPath(refsFile),
      dir: displayPath(dir),
      ok: violations.length === 0,
      violations,
      catalogGaps,
      domain: {
        interface: domainDoc.interface,
        instance: domainDoc.instance ?? null,
        collections: (domainDoc.collections ?? []).map((collection) => ({
          name: collection.name,
          purpose: collection.purpose,
          id: collection.id,
          ownerStatus: collection.owner?.status ?? 'MISSING',
          audienceStatus: collection.audience?.status ?? 'MISSING',
        })),
      },
      state: {
        interface: 'OutlineState.v1',
        database: policyDoc.state?.database ?? null,
        attachments: policyDoc.state?.attachments ?? null,
        cache: policyDoc.state?.cache ?? null,
        apiContracts: policyDoc.apiContracts ?? null,
      },
    });
    return violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'qualify' || command === 'up') {
    // 单一事实源：catalog 缺口来自同一 validateDomain 结果，validate/qualify/up 共享。
    const { catalogGaps } = validateDomain({ registry, refsDoc, files });
    const qualification = buildQualification({ registryFile, dir, files, catalogGaps });
    if (command === 'qualify') {
      print(qualification);
      return qualification.ready ? EXIT_PASS : EXIT_VERIFY;
    }
    if (qualification.unreadyComponents.length > 0) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'outline',
        refused: true,
        ready: false,
        error: `UP_REFUSED_IMAGES_LOCK_NOT_READY: ${qualification.unreadyComponents.length} component images lack an authenticated digest`,
        unverifiedComponents: qualification.unreadyComponents,
        receipt: qualification,
      });
      return EXIT_VERIFY;
    }
    const lock = JSON.parse(files.get('images.lock.json'));
    if (lock.upGate?.enabled !== true) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'outline',
        refused: true,
        ready: true,
        error: `UP_NOT_AUTHORIZED: ${lock.upGate?.reason ?? 'up gate is closed in this task'}`,
      });
      return EXIT_VERIFY;
    }
    const daemon = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 8000 });
    if (daemon.status !== 0) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'outline',
        refused: true,
        ready: true,
        status: 'UNVERIFIED',
        error: `UP_REFUSED_CONTAINER_DAEMON_UNREACHABLE: ${redactHostPaths(daemon.stderr.trim().split('\n')[0] || `docker exited ${daemon.status}`)}`,
      });
      return EXIT_VERIFY;
    }
    print({
      interface: 'Qualification.v1',
      command: 'up',
      domain: 'outline',
      refused: true,
      ready: true,
      status: 'UNVERIFIED',
      error: 'UP_NOT_EXECUTED: runtime launch requires an authorized operator context; I03 declares the domain and gates, admission is a later explicit decision',
    });
    return EXIT_VERIFY;
  }

  return failInput(`unknown command: ${command}`);
}

process.exit(await main(process.argv.slice(2)));
