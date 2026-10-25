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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, redactSecretValue, scanForForbiddenValues, validateRefsCatalog } from './secret-refs.mjs';

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
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|Volumes|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时目录）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

const HOST_PATH_IN_VALUE = /(^|[\s"'=(:])\/(Users|Volumes|home|root|private|var|usr|etc|opt|tmp)\//;
const HOST_USER_PATH = /(^|[\s"'=(:])\/(Users|Volumes|home|root)\//;
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
    '  outline.mjs probe    --case <oidc-principal-acl|restart-persistence|attachment-denial|managed-publish> [--endpoint <url>] [--publish-request <file>] [--registry <file>] [--dir <outline dir>] [--json]',
    '  outline.mjs stop     [--registry <file>] [--dir <outline dir>] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  const allowed = ['registry', 'refs', 'dir', 'json', ...(command === 'probe' ? ['case', 'endpoint', 'publish-request'] : [])];
  if (command && !['validate', 'qualify', 'up', 'probe', 'stop'].includes(command)) return { command, opts, error: 'unknown command' };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || !allowed.includes(arg.slice(2))) return { command, opts, error: 'unknown option or positional argument' };
    if (Object.hasOwn(opts, arg.slice(2))) return { command, opts, error: 'duplicate option' };
    if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return { command, opts, error: `missing value for ${arg}` };
      opts[arg.slice(2)] = value;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, (_key, value) => typeof value === 'string' ? redactHostPaths(redactSecretValue(value)) : value, 2) + '\n');
}

function failInput(message) {
  process.stderr.write(`${redactHostPaths(redactSecretValue(message))}\n${usage()}\n`);
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
      unparseable.push(`${name}: JSON input is not parseable`);
    }
  }
  return { files, missing, unparseable };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonBlank = (value) => typeof value === 'string' && value.trim() !== '';
const strings = (value) => Array.isArray(value) && Array.from(value).every(nonBlank) && new Set(value).size === value.length;

function inputShapes({ registry, refsDoc, files }) {
  const violations = [];
  const add = (at, expected, code = 'INPUT_SHAPE_INVALID') => violations.push({ code, at, expected });
  const object = (value, at, code) => { if (!isObject(value)) { add(at, 'object', code); return false; } return true; };
  const text = (value, at, nullable = false, code) => { if (!(nullable && value === null) && !nonBlank(value)) add(at, nullable ? 'non-blank string or null' : 'non-blank string', code); };
  const list = (value, at, code) => { if (!strings(value)) add(at, 'unique non-blank string array', code); };
  if (!object(registry, 'registry') || !object(registry.project, 'registry.project')) return violations;
  if (registry.interface !== 'Registry.v1' || registry.schemaVersion !== 1) add('registry', 'Registry.v1 schemaVersion 1');
  text(registry.project.id, 'registry.project.id');
  violations.push(...validateRefsCatalog(refsDoc, typeof registry.project.id === 'string' ? registry.project.id : undefined));
  const docs = new Map();
  for (const name of JSON_FILES) {
    const doc = JSON.parse(files.get(name)); docs.set(name, doc);
    if (!object(doc, name)) continue;
    if (doc.schemaVersion !== 1) add(`${name}.schemaVersion`, 'version 1');
    if (doc.project !== registry.project.id) add(`${name}.project`, 'the registered project namespace', 'CROSS_PROJECT_REF');
  }
  const lock = docs.get('images.lock.json');
  if (isObject(lock)) {
    if (lock.interface !== 'OutlineImageLock.v1') add('images.lock.json.interface', 'OutlineImageLock.v1');
    if (!Array.isArray(lock.components)) add('images.lock.json.components', 'object array');
    else {
      const names = new Set();
      for (const [index, component] of lock.components.entries()) {
        const at = `images.lock.json.components[${index}]`;
        if (!object(component, at)) continue;
        text(component.component, `${at}.component`);
        if (names.has(component.component)) add(`${at}.component`, 'unique component identity');
        names.add(component.component);
        text(component.reference, `${at}.reference`, true); text(component.digest, `${at}.digest`, true);
        if (typeof component.digestAuthenticated !== 'boolean') add(`${at}.digestAuthenticated`, 'boolean');
        if (component.required !== undefined && typeof component.required !== 'boolean') add(`${at}.required`, 'boolean');
      }
    }
    if (object(lock.upGate, 'images.lock.json.upGate')) {
      if (typeof lock.upGate.enabled !== 'boolean') add('images.lock.json.upGate.enabled', 'boolean');
      for (const field of ['admittedBy', 'admittedAt', 'reason']) if (lock.upGate[field] !== undefined) text(lock.upGate[field], `upGate.${field}`);
    }
  }
  const oidc = docs.get('oidc-registration.example.json');
  const oidcCode = 'OIDC_REGISTRATION_INCOMPLETE';
  if (isObject(oidc)) {
    if (oidc.interface !== 'OutlineOidcRegistration.v1') add('oidc.interface', 'OutlineOidcRegistration.v1', oidcCode);
    if (object(oidc.provider, 'oidc.provider', oidcCode)) {
      text(oidc.provider.issuerUrl, 'oidc.provider.issuerUrl', true, oidcCode);
      text(oidc.provider.discoveryUrl, 'oidc.provider.discoveryUrl', true, oidcCode);
    }
    if (object(oidc.client, 'oidc.client', oidcCode)) {
      for (const field of ['credentialRef', 'sessionCredentialRef']) text(oidc.client[field], `oidc.client.${field}`, false, oidcCode);
      text(oidc.client.clientId, 'oidc.client.clientId', true, oidcCode);
      list(oidc.client.redirectUris, 'oidc.client.redirectUris', oidcCode);
    }
    object(oidc.subjectMapping, 'oidc.subjectMapping', oidcCode);
    if (object(oidc.testPrincipals, 'oidc.testPrincipals', oidcCode)) for (const field of ['owner', 'member', 'offboarded']) object(oidc.testPrincipals[field], `oidc.testPrincipals.${field}`, oidcCode);
  }
  const policy = docs.get('storage-policy.json');
  const storageCode = 'STORAGE_POLICY_INCOMPLETE';
  if (isObject(policy)) {
    if (policy.interface !== 'OutlineStoragePolicy.v1') add('storage.interface', 'OutlineStoragePolicy.v1', storageCode);
    if (object(policy.state, 'storage.state', storageCode)) for (const field of ['database', 'attachments', 'cache']) {
      if (object(policy.state[field], `storage.state.${field}`, storageCode) && typeof policy.state[field].durable !== 'boolean') add(`storage.state.${field}.durable`, 'boolean', storageCode);
    }
    if (isObject(policy.state?.cache) && typeof policy.state.cache.rightsAuthority !== 'boolean') add('storage.state.cache.rightsAuthority', 'boolean', storageCode);
    object(policy.storage, 'storage.storage', storageCode); object(policy.revocation, 'storage.revocation', storageCode);
    if (object(policy.apiContracts, 'storage.apiContracts', storageCode)) for (const field of ['fixedCreateUuid', 'lastRevision']) {
      if (object(policy.apiContracts[field], `apiContracts.${field}`, storageCode)) text(policy.apiContracts[field].status, `apiContracts.${field}.status`, false, storageCode);
    }
  }
  const domain = docs.get('collection-registration.example.json');
  const domainCode = 'DOMAIN_REGISTRATION_INCOMPLETE';
  if (isObject(domain)) {
    if (domain.interface !== 'OutlineDomain.v1') add('domain.interface', 'OutlineDomain.v1', domainCode);
    if (object(domain.instance, 'domain.instance', domainCode)) {
      text(domain.instance.id, 'domain.instance.id', true, domainCode);
      text(domain.instance.url, 'domain.instance.url', true, domainCode);
    }
    if (!Array.isArray(domain.collections)) add('domain.collections', 'object array', domainCode);
    else for (const [index, collection] of domain.collections.entries()) {
      const at = `domain.collections[${index}]`;
      if (!object(collection, at, domainCode)) continue;
      text(collection.name, `${at}.name`, false, domainCode); text(collection.id, `${at}.id`, true, domainCode);
      if (object(collection.owner, `${at}.owner`, 'OWNER_REGISTRATION_MISSING')) text(collection.owner.grantRef, `${at}.owner.grantRef`, false, 'GRANT_REF_MISSING');
      if (object(collection.audience, `${at}.audience`, 'AUDIENCE_REGISTRATION_MISSING')) {
        list(collection.audience.readers, `${at}.audience.readers`, 'AUDIENCE_REGISTRATION_MISSING');
        if (collection.audience.effectiveReaderSet !== null) list(collection.audience.effectiveReaderSet, `${at}.audience.effectiveReaderSet`, 'AUDIENCE_REGISTRATION_MISSING');
      }
    }
  }
  return violations;
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

  // 第二遍（缩进感知）：loopback 暴露不得自动开公网——networks: 下每个声明网络都必须 internal 且不得 external；
  // 持久状态（OutlineState.v1：数据库+附件）必须落在具名卷上，宿主 bind 已由第一遍拒绝。
  let topCtx = null;
  let netName = null;
  let netInternal = false;
  let netExternal = false;
  const declaredNetworks = [];
  let sawNamedVolumeDecl = false;
  let svcName = null;
  let svcSubKey = null;
  const svcNamedVolumeMounts = new Map();
  const serviceEnv = new Map();
  const closeNetwork = () => {
    if (netName !== null) declaredNetworks.push({ name: netName, internal: netInternal, external: netExternal });
    netName = null;
    netInternal = false;
    netExternal = false;
  };
  for (const [index, raw] of text.split('\n').entries()) {
    const lineNo = index + 1;
    const trimmedLine = raw.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      closeNetwork();
      svcName = null;
      svcSubKey = null;
      const topKey = trimmedLine.match(/^([A-Za-z0-9_-]+):\s*$/);
      topCtx = topKey ? topKey[1] : null;
      continue;
    }
    if (topCtx === 'networks') {
      if (/^internal:\s*true/.test(trimmedLine)) netInternal = true;
      if (/^external:\s*true/.test(trimmedLine)) netExternal = true;
      const netKey = trimmedLine.match(/^([A-Za-z0-9_-]+):\s*$/);
      if (netKey && indent === 2) {
        closeNetwork();
        netName = netKey[1];
      }
    } else if (topCtx === 'volumes') {
      if (indent === 2 && /^[A-Za-z0-9][A-Za-z0-9_.-]*:\s*$/.test(trimmedLine)) sawNamedVolumeDecl = true;
    } else if (topCtx === 'services') {
      if (indent === 2) {
        const svcKey = trimmedLine.match(/^([A-Za-z0-9_-]+):\s*$/);
        if (svcKey) {
          svcName = svcKey[1];
          svcSubKey = null;
        }
      } else if (indent === 4) {
        const subKeyMatch = trimmedLine.match(/^([A-Za-z0-9_-]+):\s*$/);
        if (subKeyMatch) svcSubKey = subKeyMatch[1];
        if (svcName === 'outline' && /^env_file:/.test(trimmedLine)) add('APP_SHARED_ENV_FILE_FORBIDDEN', `compose.yaml:${lineNo}`, { reason: 'app configuration must explicitly select its own fields; shared bootstrap material must not be injected' });
      }
      if (svcName && svcSubKey === 'environment' && indent === 6) {
        const entry = trimmedLine.match(/^([A-Z][A-Z0-9_]*):/);
        if (entry) { const keys = serviceEnv.get(svcName) ?? new Set(); keys.add(entry[1]); serviceEnv.set(svcName, keys); }
      }
      if (svcName && svcSubKey === 'volumes' && indent > 4 && /^-\s*[A-Za-z][A-Za-z0-9_.-]*:\S/.test(trimmedLine)) {
        const mounts = svcNamedVolumeMounts.get(svcName) ?? [];
        mounts.push(trimmedLine.slice(1).trim());
        svcNamedVolumeMounts.set(svcName, mounts);
      }
    }
  }
  closeNetwork();
  for (const net of declaredNetworks) {
    if (!net.internal || net.external) {
      add('NON_INTERNAL_NETWORK_DECLARED', `compose.yaml:networks:${net.name}`, {
        network: net.name,
        internal: net.internal,
        external: net.external,
        reason: 'loopback exposure must not auto-open a public network; every declared network stays internal',
      });
    }
  }
  if (!sawNamedVolumeDecl) {
    add('NAMED_VOLUMES_MISSING', 'compose.yaml:volumes', { reason: 'durable database+attachment state must ride named volumes' });
  }
  for (const durableService of ['outline-postgres', 'outline-object-store']) {
    if ((svcNamedVolumeMounts.get(durableService) ?? []).length === 0) {
      add('DURABLE_STORE_NOT_ON_NAMED_VOLUME', `compose.yaml:services:${durableService}`, {
        reason: `${durableService} carries durable state (OutlineState.v1) and must mount a named volume`,
      });
    }
  }
  const requiredEnv = {
    outline: ['URL', 'SECRET_KEY', 'UTILS_SECRET', 'DATABASE_URL', 'REDIS_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_AUTH_URI', 'OIDC_TOKEN_URI', 'OIDC_USERINFO_URI', 'FILE_STORAGE', 'AWS_S3_UPLOAD_BUCKET_URL', 'AWS_S3_UPLOAD_BUCKET_NAME', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    'outline-postgres': ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'],
    'outline-object-store': ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'],
  };
  for (const [service, fields] of Object.entries(requiredEnv)) for (const field of fields) {
    if (!serviceEnv.get(service)?.has(field)) add('COMPOSE_REQUIRED_BINDING_MISSING', `compose.yaml:${service}:${field}`);
  }
  for (const field of ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'POSTGRES_PASSWORD']) {
    if (serviceEnv.get('outline')?.has(field)) add('APP_BOOTSTRAP_CREDENTIAL_FORBIDDEN', `compose.yaml:outline:${field}`);
  }
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
  // 准入语义：enabled=false 为默认；资源准入波次可显式开门，但必须携带完整准入记录
  // （admittedBy/admittedAt/reason 三者齐备），否则仍视为越权开门。
  const gate = lock.upGate ?? {};
  const admissionRecordComplete = Boolean(gate.admittedBy && gate.admittedAt && gate.reason);
  if (gate.enabled !== false && !admissionRecordComplete) {
    add('UP_GATE_NOT_CLOSED', 'images.lock.json:upGate', { reason: 'up gate may open only with a complete admission record (admittedBy/admittedAt/reason); otherwise it must stay enabled=false' });
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

function buildQualification({ registryFile, refsFile, dir, files, catalogGaps }) {
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
      ? RECORDED('pinned references and historical digest flags recorded; current independent provenance/platform qualification is still required')
      : UNVERIFIED(`no required component image has an authenticated digest (${unreadyComponents.map((c) => c.component).join(', ')}); inventing tags/digests is forbidden (images_policy.invented_tags_or_digests=false)`),
    'oidc-registration': UNVERIFIED('current issuer/discovery/client and principal mapping are not independently qualified'),
    'oidc-login-proof': UNVERIFIED('no real issuance or login evidence; requires a live instance and a real issuer'),
    'object-store-access': UNVERIFIED('storage type/endpoint/bucket unselected; no bucket access proof'),
    'credentials-provisioned': UNVERIFIED('all 7 secret refs are NOT_PROVISIONED; no runtime secret store authorization exists'),
    'secret-refs-registered': catalogGaps.length === 0
      ? RECORDED('all 7 outline refs present in the I01 catalog; all remain NOT_PROVISIONED')
      : UNVERIFIED(`refs missing from the I01 catalog (catalog is I01-owned and needs a registration update): ${catalogGaps.join(', ')}`),
    'domain-registration': UNVERIFIED('historical immutable-ID observations do not establish current full audience or action authority'),
    'state-durability': UNVERIFIED('restart-persistence probe never executed against a live instance; durable DB+attachment readback unproven'),
    'health-api': UNVERIFIED('no current qualified health receipt supplied; an existing healthy process is not full resource readiness'),
    'license-platform': UNVERIFIED('installed version/license/platform metadata requires compatibility and authorized-use review'),
    'role-isolation': UNVERIFIED('independent Reader/Publisher/Isolator/Issuer runtime principals and grants remain unprovisioned'),
    'backup-compatibility': UNVERIFIED('no restore drill registered'),
  };
  const inputs = { registrySha256: sha256Text(fs.readFileSync(registryFile)), refsSha256: sha256Text(fs.readFileSync(refsFile)), domainFiles: {} };
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
      'unauthenticated principal across collection/page/subtree/public-share/search/attachment channels (expect per-channel denial)',
      'ordinary reader (member) across the same six channels — reads limited to granted scope (expect per-channel denial outside scope)',
      'off-boarded principal across collection/page/subtree/public-share/search/attachment channels (expect per-channel denial)',
      'record actual denials and residual paths separately per channel (deniedByChannel vs residualPath, e.g. signed attachment URLs still valid after revocation)',
      'member principal attempts to change issuer/client secret/isolator role (expect denial — general users cannot alter issuer/secret/isolator roles)',
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
  'managed-publish': {
    requiredInputs: [
      'publish-request evidence file (--publish-request <file>): target reader, source audience intersection, pagination completeness, principal mapping, grant validity',
      'live Outline instance endpoint for effective audience closure readback (--endpoint <url> or a registered instance.url)',
    ],
    plannedSteps: [
      'evaluate declared evidence: source audience intersection must include the target reader (admin-readable never substitutes for audience)',
      'pagination must be complete — a failed or partial source enumeration blocks the publish',
      'every subject must map to a principal — an unmappable principal blocks the publish',
      'publisher/isolator grant must be unexpired — an expired grant blocks the publish',
      'any observation error, including non-2xx HTTP, timeout, network and unknown failures, must never be recorded as target absence',
      'all declared preconditions satisfied is still not authorization: effective audience closure requires live readback, so the gate stays closed (UNVERIFIED) without it',
    ],
  },
};

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');
  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  const refsFile = opts.refs ?? DEFAULT_REFS;
  const dir = opts.dir ?? DEFAULT_DIR;
  let registry; let refsDoc;
  try { registry = JSON.parse(fs.readFileSync(registryFile, 'utf8')); }
  catch { return failInput('registry unreadable or unparseable'); }
  try { refsDoc = JSON.parse(fs.readFileSync(refsFile, 'utf8')); }
  catch { return failInput('refs catalog unreadable or unparseable'); }
  const { files, missing, unparseable } = loadDomainFiles(dir);
  if (missing.length) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
  if (unparseable.length) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);
  const shapes = inputShapes({ registry, refsDoc, files });
  if (shapes.length) { print({ interface: 'OutlineInfra.v1', command, ready: false, refused: true, violations: shapes }); return EXIT_VERIFY; }
  const admission = validateDomain({ registry, refsDoc, files });
  if (admission.violations.length && command !== 'validate') {
    print({ interface: 'OutlineInfra.v1', command, ready: false, refused: true, ...admission }); return EXIT_VERIFY;
  }

  if (command === 'probe') {
    const spec = Object.hasOwn(PROBE_CASES, opts.case) ? PROBE_CASES[opts.case] : null;
    if (!spec) return failInput(`unknown probe case: ${opts.case ?? '(missing --case)'}`);
    const registration = JSON.parse(files.get('collection-registration.example.json'));
    const endpoint = opts.endpoint ?? registration.instance?.url ?? null;
    if (endpoint !== null) {
      let url; try { url = new URL(endpoint); } catch { return failInput('endpoint must be a loopback HTTP origin'); }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return failInput('endpoint must be a loopback HTTP origin');
    }
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
    if (opts.case === 'managed-publish' && opts['publish-request'] !== undefined) {
      // 受管发布门（本地半边，纯声明证据、fail-closed）：来源交集/分页/principal映射/grant 期限任一不满足即受控阻断；
      // admin 读得到不算受众证据；任何观察错误都不证明目标不存在；全部满足仍不转绿——有效受众闭包须活实例读回。
      let request;
      try {
        request = JSON.parse(fs.readFileSync(opts['publish-request'], 'utf8'));
      } catch {
        return failInput('publish request unreadable or unparseable');
      }
      if (!isObject(request) || !nonBlank(request.targetReader)) {
        return failInput('publish request invalid: targetReader (non-empty string) is required');
      }
      if (!strings(request.audienceIntersection) || !isObject(request.pagination) || typeof request.pagination.complete !== 'boolean'
        || (request.pagination.reason !== undefined && !nonBlank(request.pagination.reason))
        || !isObject(request.principalMapping) || !nonBlank(request.principalMapping.status)
        || (request.principalMapping.subject !== undefined && request.principalMapping.subject !== null && !nonBlank(request.principalMapping.subject))
        || (request.principalMapping.status === 'MAPPED' && !nonBlank(request.principalMapping.subject))
        || (request.adminReadable !== undefined && typeof request.adminReadable !== 'boolean')
        || !isObject(request.grant) || typeof request.grant.expired !== 'boolean' || !nonBlank(request.grant.ref)
        || (request.observationError !== undefined && (!isObject(request.observationError) || !nonBlank(request.observationError.kind)
          || (request.observationError.targetRecordedAbsent !== undefined && typeof request.observationError.targetRecordedAbsent !== 'boolean')))
        || (request.effectiveAudience !== undefined && (!isObject(request.effectiveAudience) || !strings(request.effectiveAudience.channels)))) return failInput('publish request has invalid nested input shapes');
      const intersection = Array.isArray(request.audienceIntersection) ? request.audienceIntersection : [];
      const blocks = [];
      if (request.grant.ref !== `secret-ref:${registry.project.id}/outline-publisher`) blocks.push({ code: 'BLOCKED_GRANT_PURPOSE_MISMATCH', detail: 'publication requires its distinct purpose-bound grant; reader or owner material is not a substitute' });
      if (!intersection.includes(request.targetReader)) {
        blocks.push({
          code: 'BLOCKED_SOURCE_INTERSECTION_EXCLUDES_READER',
          detail: `target reader not present in the source audience intersection (${intersection.length} declared readers)`,
        });
      }
      if (request.adminReadable === true && intersection.length === 0) {
        blocks.push({ code: 'BLOCKED_ADMIN_READ_NOT_AUDIENCE', detail: 'admin readability of the source is never audience evidence' });
      }
      let pagesComplete = true;
      if (request.pagination.pages !== undefined) {
        const pages = request.pagination.pages;
        if (!Array.isArray(pages)) return failInput('pagination.pages must be an array');
        let offset = 0; let total = null; const ids = new Set();
        for (const page of pages) {
          if (!isObject(page) || !strings(page.ids) || !Number.isSafeInteger(page.total) || page.total < 0 || !Number.isSafeInteger(page.limit) || page.limit <= 0 || page.offset !== offset || page.ids.length > page.limit) { pagesComplete = false; break; }
          if (total === null) total = page.total;
          if (page.total !== total || page.ids.some((id) => ids.has(id))) pagesComplete = false;
          page.ids.forEach((id) => ids.add(id)); offset += page.ids.length;
        }
        if (total === null || offset !== total || ids.size !== total) pagesComplete = false;
      }
      if (request.pagination?.complete !== true || !pagesComplete) {
        blocks.push({
          code: 'BLOCKED_PAGINATION_INCOMPLETE',
          detail: `source enumeration incomplete (${request.pagination?.reason ?? 'no completion proof'})`,
        });
      }
      if (request.effectiveAudience && (request.effectiveAudience.complete !== true
        || !['collection', 'parents', 'page', 'groups', 'shares', 'public'].every((channel) => request.effectiveAudience.channels.includes(channel)))) {
        blocks.push({ code: 'BLOCKED_EFFECTIVE_AUDIENCE_INCOMPLETE', detail: 'all native entry points and pagination require independent current readback' });
      }
      if (request.principalMapping?.status !== 'MAPPED') {
        blocks.push({
          code: 'BLOCKED_PRINCIPAL_UNMAPPABLE',
          detail: `subject-to-principal mapping is ${request.principalMapping?.status ?? 'ABSENT'}; an unmappable principal blocks the publish`,
        });
      }
      if (request.grant?.expired === true) {
        blocks.push({ code: 'BLOCKED_GRANT_EXPIRED', detail: `grant ${request.grant.ref ?? '(unspecified)'} is expired` });
      }
      // Error classification must fail closed, even for a previously unseen kind.
      if (request.observationError?.targetRecordedAbsent === true) {
        blocks.push({
          code: 'BLOCKED_ABSENCE_INFERRED_FROM_ERROR',
          detail: `${request.observationError.kind} must never be recorded as target absence`,
        });
      }
      observation.executed = true;
      observation.evaluationBasis = 'declared-request-only';
      observation.liveReadback = false;
      observation.blocks = blocks;
      observation.observedSteps.push({
        step: 'evaluate declared publish-request evidence',
        status: 'RECORDED',
        note: 'pure fail-closed gate evaluation over declared values; no live instance consulted',
      });
      observation.observedSteps.push({
        step: 'live effective-audience closure readback',
        status: 'UNVERIFIED',
        reason: 'requires a live instance and authenticated principals (endpoint + sessions)',
      });
      if (blocks.length > 0) {
        observation.status = 'BLOCKED';
        observation.reason = `managed publish blocked (${blocks.length} cause(s)): ${blocks.map((b) => b.code).join(', ')}`;
      } else {
        observation.reason =
          'declared preconditions hold, but effective audience closure requires live readback; the gate stays closed (UNVERIFIED) — a declared-only evaluation never produces a PASS';
      }
      print(observation);
      return EXIT_VERIFY;
    }
    if (!endpoint) {
      observation.reason =
        'no live Outline instance endpoint configured; probes require a real authenticated instance (up refuses until the images lock qualifies and admission is granted). Pass --endpoint <url> once the stack exists — this command never mocks and never skips.';
      print(observation);
      return EXIT_VERIFY;
    }
    observation.observedSteps.push({
      step: 'authenticated principal channels',
      status: 'UNVERIFIED',
      reason: 'requires a real authenticated session (OIDC login proof not performed); credentials resolve only via runtime-authorized secret refs',
    });
    observation.reason = 'endpoint registration alone is not action authority; authenticated role/channel and lifecycle operations require separate verified runtime grants. No API or restart was attempted.';
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
        'no qualified lifecycle operation grant belongs to this invocation; an existing managed stack must not be stopped by declaration or historical admission. Comet retains the lifecycle decision.',
    });
    return EXIT_VERIFY;
  }

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
    const qualification = buildQualification({ registryFile, refsFile, dir, files, catalogGaps });
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
        ready: qualification.ready,
        error: `UP_NOT_AUTHORIZED: ${lock.upGate?.reason ?? 'up gate is closed in this task'}`,
      });
      return EXIT_VERIFY;
    }
    print({
      interface: 'Qualification.v1',
      command: 'up',
      domain: 'outline',
      refused: true,
      ready: qualification.ready,
      status: 'UNVERIFIED',
      error: 'UP_NOT_AUTHORIZED: complete current qualification and separately verified operation authority are required; a historical lock admission cannot launch a stack',
    });
    return EXIT_VERIFY;
  }

  return failInput(`unknown command: ${command}`);
}

process.exit(await main(process.argv.slice(2)));
