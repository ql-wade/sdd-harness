#!/usr/bin/env node
// CodeKnowledgeInfra.v1 / CodeWiki.v1 / CodeGraph.v1 CLI — validate | qualify | up | probe
//
// 只登记、声明与验收：不启动任何服务、不持有阶段/DAG/业务重试、不改活配置（hooks/MCP 由对应 P 任务串行接纳）。
// 外层纯 gate 语义：本工具只返回事实与判定输入（violations / qualification categories / freshness verdict），
// 不建立自己的调度或阶段；判定按事前 policy 由外层 gate 完成。
// 镜像 tag/digest/版本一律来自 infra/delivery/code-knowledge/images.lock.json；deepwiki-open 上游仓库/发行物
// 已固定公共源码与镜像元数据，但尚未完成运行与来源认证，严禁虚构。upGate 未开启时 up 必须拒绝。
// 秘密值永不读写：域文件只能携带 secret-ref 引用，解析属运行时授权机制（I01 secret-refs 只读门）。
//
// 退出码契约（execution-contract.json V_INFRA_I05.cli_contract）：
//   0 = PASS（validate 通过 / graph-disabled-correctness 主链路实测绿）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、未知 probe case、manifest 不可解析）
//   2 = 验证失败（语义违规、qualify NOT_READY、up 被拒、probe 环境缺失 UNVERIFIED、新鲜度拒绝）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 或 mock 转绿。

import { spawnSync } from 'node:child_process';
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
const DEFAULT_DIR = path.join(repoRoot, 'infra', 'delivery', 'code-knowledge');

const JSON_FILES = ['images.lock.json', 'deepwiki-profile.json', 'graph-profile.json', 'repository-scope.json'];
const DOMAIN_FILES = ['compose.yaml', ...JSON_FILES];
const REQUIRED_COMPONENTS = ['codewiki-app'];
const ABSENT_GRAPH = {
  schemaVersion: 1, interface: 'CodeGraph.v1', kind: 'structure-index', component: 'codegraph', enabled: false, status: 'NOT_INSTALLED',
  removableOptimization: { removable: true, gateAuthority: false, knowledgeAuthority: false },
  source: { credentialRef: 'secret-ref:sdd-harness-pilot/codegraph-source-read', structureOnly: true, inputCommitPinRequired: true, coverage: { requiredFields: [] } },
  lifecycle: { separateLifecycleFromWiki: true, rebuildRequiresFreshPull: true, noAutoFeedOutlineOrLlmWiki: true },
};
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SECRET_REF_PREFIX = 'secret-ref:';

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|Volumes|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时目录）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

const UNVERIFIED = (reason) => ({ status: 'UNVERIFIED', reason });
const RECORDED = (reason) => ({ status: 'RECORDED', reason });

function usage() {
  return [
    'usage:',
    '  code-knowledge.mjs validate --registry <file> [--refs <file>] [--dir <code-knowledge dir>] [--json]',
    '  code-knowledge.mjs qualify  --registry <file> [--dir <code-knowledge dir>] [--json]',
    '  code-knowledge.mjs up       --registry <file> [--dir <code-knowledge dir>] [--json]',
    '  code-knowledge.mjs probe    --case <pinned-code-wiki|graph-disabled-correctness> [--endpoint <url>] [--manifest <file>] [--registry <file>] [--dir <code-knowledge dir>] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  if (command && !['validate', 'qualify', 'up', 'probe'].includes(command)) return { command, opts, error: 'unknown command' };
  const allowed = ['registry', 'refs', 'dir', 'json', ...(command === 'probe' ? ['case', 'endpoint', 'manifest'] : [])];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || !allowed.includes(arg.slice(2))) return { command, opts, error: 'unknown option or positional argument' };
    if (Object.hasOwn(opts, arg.slice(2))) return { command, opts, error: 'duplicate option' };
    if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return { command, opts, error: 'missing option value' };
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

function failInput(message, code = 'INPUT_INVALID') {
  print({ interface: 'CodeKnowledgeInfra.v1', status: 'INPUT_INVALID', ready: false, code, error: message });
  return EXIT_INPUT;
}

const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');

const INPUT_FILE_ERRORS = new Set(['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG']);

function readInputText(file, label, prefix) {
  try { return { ok: true, text: fs.readFileSync(file, 'utf8') }; }
  catch (error) {
    const expected = typeof error?.code === 'string' && INPUT_FILE_ERRORS.has(error.code);
    return { ok: false, status: expected ? 'INPUT_INVALID' : 'INTERNAL_FAILURE', exitCode: expected ? EXIT_INPUT : EXIT_VERIFY,
      code: `${prefix}_READ_${expected ? error.code : 'INTERNAL_FAILURE'}`, error: `${label} ${expected ? 'unreadable' : 'read failed'}` };
  }
}

function parseInputJson(text, label, prefix) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (error) {
    const expected = error instanceof SyntaxError;
    return { ok: false, status: expected ? 'INPUT_INVALID' : 'INTERNAL_FAILURE', exitCode: expected ? EXIT_INPUT : EXIT_VERIFY,
      code: `${prefix}_${expected ? 'JSON_INVALID' : 'PARSE_INTERNAL_FAILURE'}`, error: `${label} ${expected ? 'invalid JSON' : 'parse failed'}` };
  }
}

function readInputJson(file, label, prefix) {
  const read = readInputText(file, label, prefix);
  if (!read.ok) return read;
  const parsed = parseInputJson(read.text, label, prefix);
  return parsed.ok ? { ...parsed, text: read.text } : parsed;
}

function reportInputFailure(failure) {
  print({ interface: 'CodeKnowledgeInfra.v1', status: failure.status, ready: false, code: failure.code, error: failure.error });
  return failure.exitCode;
}

function loadDomainFiles(dir) {
  const files = new Map();
  const missing = [];
  const unparseable = [];
  const optionalMissing = [];
  for (const name of DOMAIN_FILES) {
    const read = readInputText(path.join(dir, name), 'domain input', 'DOMAIN');
    if (read.ok) files.set(name, read.text);
    else {
      if (name === 'graph-profile.json' && read.code === 'DOMAIN_READ_ENOENT') {
        files.set(name, JSON.stringify(ABSENT_GRAPH)); optionalMissing.push(name);
      } else if (read.exitCode === EXIT_VERIFY) return { files, missing, unparseable, optionalMissing, internalFailure: read };
      else missing.push(name);
    }
  }
  for (const name of JSON_FILES) {
    if (!files.has(name)) continue;
    const parsed = parseInputJson(files.get(name), 'domain input', 'DOMAIN');
    if (!parsed.ok && parsed.exitCode === EXIT_VERIFY) return { files, missing, unparseable, optionalMissing, internalFailure: parsed };
    if (!parsed.ok) unparseable.push(name);
  }
  return { files, missing, unparseable, optionalMissing };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonBlank = (value) => typeof value === 'string' && value.trim() !== '';
const strings = (value) => Array.isArray(value) && value.every(nonBlank) && new Set(value).size === value.length;

function inputShapes({ registry, refsDoc, files }) {
  const violations = [];
  const add = (at, expected) => violations.push({ code: 'INPUT_SHAPE_INVALID', at, expected });
  const object = (value, at) => { if (!isObject(value)) { add(at, 'object'); return false; } return true; };
  const text = (value, at, nullable = false) => { if (!(nullable && value === null) && !nonBlank(value)) add(at, nullable ? 'non-blank string or null' : 'non-blank string'); };
  const bool = (value, at) => { if (typeof value !== 'boolean') add(at, 'boolean'); };
  if (!object(registry, 'registry') || !object(registry.project, 'registry.project')) return violations;
  if (registry.interface !== 'Registry.v1' || registry.schemaVersion !== 1) add('registry', 'Registry.v1 schemaVersion 1');
  text(registry.project.id, 'registry.project.id');
  if (object(registry.project.github, 'registry.project.github')) {
    for (const key of ['repoId', 'principalId']) if (!Number.isSafeInteger(registry.project.github[key]) || registry.project.github[key] <= 0) add(`registry.project.github.${key}`, 'positive integer');
    for (const key of ['repoFullname', 'owner', 'url']) text(registry.project.github[key], `registry.project.github.${key}`);
  }
  violations.push(...validateRefsCatalog(refsDoc, nonBlank(registry.project.id) ? registry.project.id : undefined));
  const docs = new Map();
  for (const name of JSON_FILES) {
    const doc = JSON.parse(files.get(name)); docs.set(name, doc);
    if (!object(doc, name)) continue;
    if (doc.schemaVersion !== 1) add(`${name}.schemaVersion`, 'version 1');
    if (doc.project !== undefined && doc.project !== registry.project.id) add(`${name}.project`, 'the registered project');
  }
  const lock = docs.get('images.lock.json');
  if (isObject(lock)) {
    if (!Array.isArray(lock.components)) add('images.lock.json.components', 'object array');
    else {
      const names = new Set();
      for (const [index, entry] of lock.components.entries()) {
        const at = `images.lock.json.components[${index}]`;
        if (!object(entry, at)) continue;
        text(entry.component, `${at}.component`);
        if (names.has(entry.component)) add(`${at}.component`, 'unique component identity');
        names.add(entry.component);
        for (const key of ['reference', 'digest']) text(entry[key], `${at}.${key}`, true);
        bool(entry.digestAuthenticated, `${at}.digestAuthenticated`);
        bool(entry.required, `${at}.required`);
      }
    }
    if (object(lock.upGate, 'images.lock.json.upGate')) bool(lock.upGate.enabled, 'images.lock.json.upGate.enabled');
  }
  const profile = docs.get('deepwiki-profile.json');
  if (isObject(profile)) {
    if (object(profile.service, 'wiki.service')) {
      text(profile.service.kind, 'wiki.service.kind'); bool(profile.service.publicHostedServiceSubstitute, 'wiki.service.publicHostedServiceSubstitute');
      if (object(profile.service.upstream, 'wiki.service.upstream')) {
        for (const key of ['repository', 'commit', 'release', 'license']) text(profile.service.upstream[key], `wiki.service.upstream.${key}`, true);
        text(profile.service.upstream.status, 'wiki.service.upstream.status');
      }
    }
    if (object(profile.provider, 'wiki.provider')) for (const key of ['credentialRef', 'sourceReadCredentialRef']) text(profile.provider[key], `wiki.provider.${key}`);
    if (object(profile.generation, 'wiki.generation')) {
      bool(profile.generation.manifestRequired, 'wiki.generation.manifestRequired');
      if (!strings(profile.generation.manifestFields)) add('wiki.generation.manifestFields', 'unique string array');
      if (object(profile.generation.freshness, 'wiki.generation.freshness')) {
        const freshness = profile.generation.freshness;
        bool(freshness.commitPinRequired, 'wiki.generation.freshness.commitPinRequired');
        for (const key of ['maxCommitAgeDays', 'languageCoverageMin']) if (freshness[key] !== null && (!Number.isFinite(freshness[key]) || freshness[key] < 0)) add(`wiki.generation.freshness.${key}`, 'nonnegative finite number or null');
      }
    }
    if (object(profile.access, 'wiki.access')) for (const key of ['apiAuthRequired', 'mcpReadbackRequired']) bool(profile.access[key], `wiki.access.${key}`);
  }
  const graph = docs.get('graph-profile.json');
  if (isObject(graph)) {
    bool(graph.enabled, 'graph.enabled');
    if (object(graph.removableOptimization, 'graph.removableOptimization')) for (const key of ['removable', 'gateAuthority', 'knowledgeAuthority']) bool(graph.removableOptimization[key], `graph.removableOptimization.${key}`);
    if (object(graph.source, 'graph.source')) {
      text(graph.source.credentialRef, 'graph.source.credentialRef');
      for (const key of ['structureOnly', 'inputCommitPinRequired']) bool(graph.source[key], `graph.source.${key}`);
      if (object(graph.source.coverage, 'graph.source.coverage') && !strings(graph.source.coverage.requiredFields)) add('graph.source.coverage.requiredFields', 'unique string array');
    }
    if (object(graph.lifecycle, 'graph.lifecycle')) for (const key of ['separateLifecycleFromWiki', 'rebuildRequiresFreshPull', 'noAutoFeedOutlineOrLlmWiki']) bool(graph.lifecycle[key], `graph.lifecycle.${key}`);
  }
  const scope = docs.get('repository-scope.json');
  if (isObject(scope)) {
    if (object(scope.scope, 'scope.scope')) {
      for (const key of ['denyByDefault', 'ingestRequiresAuthorizedScope']) bool(scope.scope[key], `scope.scope.${key}`);
      if (object(scope.scope.publicHostedServiceSubstitute, 'scope.scope.publicHostedServiceSubstitute')) bool(scope.scope.publicHostedServiceSubstitute.allowed, 'scope.scope.publicHostedServiceSubstitute.allowed');
    }
    if (!Array.isArray(scope.approvedSources)) add('scope.approvedSources', 'object array');
    else for (const [index, entry] of scope.approvedSources.entries()) {
      if (!object(entry, `scope.approvedSources[${index}]`)) continue;
      for (const key of ['project', 'repository', 'grantRef', 'status']) text(entry[key], `scope.approvedSources[${index}].${key}`);
      for (const key of ['immutableId', 'commit']) if (entry[key] !== null) text(entry[key], `scope.approvedSources[${index}].${key}`);
    }
    object(scope.authorizationEvidence, 'scope.authorizationEvidence');
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

// Parse the bounded input with the existing isolated PyYAML runtime. Only fixed
// categories and parser metadata leave the subprocess; never configuration values.
const COMPOSE_INPUT_LIMIT = 65_536;
const COMPOSE_OUTPUT_LIMIT = 65_536;
const COMPOSE_TIMEOUT_MS = 5_000;
const COMPOSE_YAML_VERSION = '6.0.3';
const COMPOSE_VALIDATOR = String.raw`
import json, sys
VERSION = None
AVAILABLE = False

def emit(violations):
    print(json.dumps({"ok": not violations, "parser": "PyYAML", "version": VERSION,
                      "available": AVAILABLE, "violations": violations}, separators=(",", ":")))
    raise SystemExit(0 if not violations else 2)

def reject(code):
    emit([{"code": code, "at": "compose.yaml"},
          {"code": "HOST_MOUNT_FORBIDDEN", "at": "compose.yaml"}])

try:
    import yaml
except Exception:
    reject("COMPOSE_PARSER_UNAVAILABLE")
if getattr(yaml, "__version__", None) != "6.0.3":
    reject("COMPOSE_PARSER_VERSION_MISMATCH")
VERSION = yaml.__version__
AVAILABLE = True

class ForbiddenYaml(Exception):
    pass

class StrictLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            if key_node.tag == "tag:yaml.org,2002:merge":
                raise ForbiddenYaml("COMPOSE_YAML_MERGE_UNSUPPORTED")
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ForbiddenYaml("COMPOSE_YAML_KEY_UNSUPPORTED")
            if key in result:
                raise ForbiddenYaml("COMPOSE_YAML_DUPLICATE_KEY")
            result[key] = self.construct_object(value_node, deep=deep)
        return result

try:
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        reject("COMPOSE_INPUT_LIMIT_EXCEEDED")
    source = raw.decode("utf-8", errors="strict")
    for token in yaml.scan(source, Loader=StrictLoader):
        if isinstance(token, yaml.tokens.TagToken):
            reject("COMPOSE_YAML_TAG_UNSUPPORTED")
    depth = 0
    nodes = 0
    for event in yaml.parse(source, Loader=StrictLoader):
        if isinstance(event, yaml.events.AliasEvent) or getattr(event, "anchor", None) is not None:
            reject("COMPOSE_YAML_ALIAS_UNSUPPORTED")
        if isinstance(event, (yaml.events.MappingStartEvent, yaml.events.SequenceStartEvent)):
            depth += 1
            if depth > 24:
                reject("COMPOSE_YAML_DEPTH_LIMIT_EXCEEDED")
        if isinstance(event, (yaml.events.MappingEndEvent, yaml.events.SequenceEndEvent)):
            depth -= 1
        nodes += 1
        if nodes > 4096:
            reject("COMPOSE_YAML_NODE_LIMIT_EXCEEDED")
    document = yaml.load(source, Loader=StrictLoader)
except ForbiddenYaml as error:
    reject(str(error))
except Exception:
    reject("COMPOSE_YAML_INVALID")

violations = []
def add(code, at="compose.yaml"):
    item = {"code": code, "at": at}
    if item not in violations:
        violations.append(item)

def mapping(value, allowed, at):
    if not isinstance(value, dict):
        add("COMPOSE_SCHEMA_INVALID", at)
        add("HOST_MOUNT_FORBIDDEN", at)
        return False
    if set(value) - set(allowed):
        add("COMPOSE_FIELD_FORBIDDEN", at)
        add("HOST_MOUNT_FORBIDDEN", at)
    return True

def same_strings(value, expected):
    return (isinstance(value, list) and len(value) == len(expected)
            and all(isinstance(item, str) for item in value) and set(value) == set(expected))

if not mapping(document, ["services", "volumes", "networks"], "compose.yaml"):
    emit(violations)
services = document.get("services")
if not isinstance(services, dict) or set(services) != {"codewiki-app"}:
    add("SERVICES_MISSING", "compose.yaml:services")
    add("HOST_MOUNT_FORBIDDEN", "compose.yaml:services")
app = services.get("codewiki-app") if isinstance(services, dict) else None
at = "compose.yaml:services.codewiki-app"
fields = ["image", "restart", "environment", "networks", "ports", "volumes", "mem_limit",
          "mem_reservation", "cpus", "cap_drop", "security_opt"]
if mapping(app, fields, at):
    if "privileged" in app:
        add("PRIVILEGED_FORBIDDEN", at)
    if "network_mode" in app:
        add("HOST_NETWORK_FORBIDDEN", at)
    if any(key in app for key in ["pid", "ipc", "uts", "userns_mode", "cgroup"]):
        add("HOST_NAMESPACE_FORBIDDEN", at)
    if "env_file" in app:
        add("HOST_ENV_FILE_FORBIDDEN", at)
    expected_image = "$" + "{CODEWIKI_IMAGE:?must be resolved from infra/delivery/code-knowledge/images.lock.json before up}"
    if app.get("image") != expected_image:
        add("COMPOSE_IMAGE_NOT_LOCK_RESOLVED", at)
    if app.get("restart") != "no":
        add("COMPOSE_FIELD_FORBIDDEN", at)
    environment = {"PORT": "8001", "NODE_ENV": "production", "SERVER_BASE_URL": "http://127.0.0.1:8001",
                   "LOG_FILE_PATH": "api/logs/application.log", "NEXT_TELEMETRY_DISABLED": "1"}
    if app.get("environment") != environment:
        add("HOST_ENV_FILE_FORBIDDEN", at)
        add("HOST_MOUNT_FORBIDDEN", at)
    if not same_strings(app.get("networks"), ["code-knowledge-internal"]):
        add("NETWORK_NOT_INTERNAL", at)
    if not same_strings(app.get("ports"), ["127.0.0.1:" + "$" + "{CODEWIKI_PORT:-17400}:3000",
                                          "127.0.0.1:" + "$" + "{CODEWIKI_API_PORT:-17402}:8001"]):
        add("PORT_BINDING_NOT_LOOPBACK", at)
    if not same_strings(app.get("volumes"), ["codewiki-data:/root/.adalflow", "codewiki-logs:/app/api/logs"]):
        add("HOST_MOUNT_FORBIDDEN", at)
    if app.get("mem_limit") != "6g" or app.get("mem_reservation") != "2g" or app.get("cpus") != 2:
        add("RESOURCE_LIMIT_INVALID", at)
    if not same_strings(app.get("cap_drop"), ["ALL"]) or not same_strings(app.get("security_opt"), ["no-new-privileges:true"]):
        add("SECURITY_OPTION_REQUIRED", at)
volumes = document.get("volumes")
if not isinstance(volumes, dict) or set(volumes) != {"codewiki-data", "codewiki-logs"}:
    add("HOST_MOUNT_FORBIDDEN", "compose.yaml:volumes")
elif any(value is not None and not (isinstance(value, dict) and not value) for value in volumes.values()):
    add("HOST_MOUNT_FORBIDDEN", "compose.yaml:volumes")
networks = document.get("networks")
if not isinstance(networks, dict) or set(networks) != {"code-knowledge-internal"}:
    add("NETWORK_MISSING", "compose.yaml:networks")
    add("HOST_MOUNT_FORBIDDEN", "compose.yaml:networks")
else:
    network = networks["code-knowledge-internal"]
    if not isinstance(network, dict) or set(network) != {"internal"} or network.get("internal") is not True:
        add("NETWORK_NOT_INTERNAL", "compose.yaml:networks")
        add("HOST_MOUNT_FORBIDDEN", "compose.yaml:networks")
emit(violations)
`;

const COMPOSE_CODES = new Set([
  'COMPOSE_PARSER_UNAVAILABLE', 'COMPOSE_PARSER_VERSION_MISMATCH', 'COMPOSE_INPUT_LIMIT_EXCEEDED',
  'COMPOSE_YAML_MERGE_UNSUPPORTED', 'COMPOSE_YAML_KEY_UNSUPPORTED', 'COMPOSE_YAML_DUPLICATE_KEY',
  'COMPOSE_YAML_TAG_UNSUPPORTED', 'COMPOSE_YAML_ALIAS_UNSUPPORTED', 'COMPOSE_YAML_DEPTH_LIMIT_EXCEEDED',
  'COMPOSE_YAML_NODE_LIMIT_EXCEEDED', 'COMPOSE_YAML_INVALID', 'COMPOSE_SCHEMA_INVALID', 'COMPOSE_FIELD_FORBIDDEN',
  'HOST_MOUNT_FORBIDDEN', 'SERVICES_MISSING', 'PRIVILEGED_FORBIDDEN', 'HOST_NETWORK_FORBIDDEN',
  'HOST_NAMESPACE_FORBIDDEN', 'HOST_ENV_FILE_FORBIDDEN', 'COMPOSE_IMAGE_NOT_LOCK_RESOLVED', 'NETWORK_NOT_INTERNAL',
  'PORT_BINDING_NOT_LOOPBACK', 'RESOURCE_LIMIT_INVALID', 'SECURITY_OPTION_REQUIRED', 'NETWORK_MISSING',
]);
const COMPOSE_LOCATIONS = new Set(['compose.yaml', 'compose.yaml:services', 'compose.yaml:services.codewiki-app', 'compose.yaml:volumes', 'compose.yaml:networks']);

function validateCompose(text) {
  const parser = { command: 'python3', flags: ['-I'], implementation: 'PyYAML', requiredVersion: COMPOSE_YAML_VERSION, version: null, proofLayer: 'component-parser', attempted: false, executed: false, status: 'UNVERIFIED' };
  const failure = (code) => ({ violations: [{ code, at: 'compose.yaml' }, { code: 'HOST_MOUNT_FORBIDDEN', at: 'compose.yaml' }], parser });
  if (Buffer.byteLength(text, 'utf8') > COMPOSE_INPUT_LIMIT) return failure('COMPOSE_INPUT_LIMIT_EXCEEDED');
  parser.attempted = true;
  const result = spawnSync('python3', ['-I', '-c', COMPOSE_VALIDATOR], {
    input: text, encoding: 'utf8', timeout: COMPOSE_TIMEOUT_MS, maxBuffer: COMPOSE_OUTPUT_LIMIT, killSignal: 'SIGKILL',
  });
  if (result.error?.code === 'ETIMEDOUT') return failure('COMPOSE_PARSER_TIMEOUT');
  if (result.error?.code === 'ENOBUFS') return failure('COMPOSE_PARSER_OUTPUT_LIMIT');
  if (result.error?.code === 'ENOENT') return failure('COMPOSE_PARSER_UNAVAILABLE');
  if (result.error || result.signal || result.stderr || ![0, 2].includes(result.status)) return failure('COMPOSE_PARSER_FAILED');
  let output;
  try { output = JSON.parse(result.stdout); } catch { return failure('COMPOSE_PARSER_INVALID_OUTPUT'); }
  if (!isObject(output) || Object.keys(output).sort().join(',') !== 'available,ok,parser,version,violations'
    || output.parser !== 'PyYAML' || typeof output.available !== 'boolean' || typeof output.ok !== 'boolean'
    || !Array.isArray(output.violations) || output.violations.length > 64
    || output.violations.some((entry) => !isObject(entry) || Object.keys(entry).sort().join(',') !== 'at,code' || !COMPOSE_CODES.has(entry.code) || !COMPOSE_LOCATIONS.has(entry.at))
    || output.ok !== (output.violations.length === 0) || result.status !== (output.ok ? 0 : 2)
    || (output.available ? output.version !== COMPOSE_YAML_VERSION : output.version !== null)
    || output.available === output.violations.some((entry) => ['COMPOSE_PARSER_UNAVAILABLE', 'COMPOSE_PARSER_VERSION_MISMATCH'].includes(entry.code))) return failure('COMPOSE_PARSER_INVALID_OUTPUT');
  if (output.available) { parser.version = output.version; parser.executed = true; parser.status = 'AVAILABLE'; }
  return { violations: output.violations, parser };
}

function validateLock(lock) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  if (lock.interface !== 'CodeKnowledgeImageLock.v1') add('LOCK_INTERFACE_INVALID', 'images.lock.json', { expected: 'CodeKnowledgeImageLock.v1' });
  const components = Array.isArray(lock.components) ? lock.components : [];
  const byName = new Map(components.map((component) => [component.component, component]));
  for (const name of new Set([...REQUIRED_COMPONENTS, ...components.map((entry) => entry.component)])) {
    const entry = byName.get(name);
    const at = `images.lock.json:${name}`;
    if (!entry) {
      add('MISSING_LOCK_COMPONENT', at);
      continue;
    }
    if (!['codewiki-app', 'codegraph'].includes(name)) add('UNKNOWN_LOCK_COMPONENT', at);
    if (name === 'codegraph' && entry.required !== false) add('OPTIONAL_GRAPH_REQUIRED', at);
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
  return { violations, components, byName };
}

function validateWikiProfile(profile) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const at = 'deepwiki-profile.json';
  if (profile.interface !== 'CodeWiki.v1' || profile.kind !== 'code-wiki-service') {
    add('PROFILE_INTERFACE_INVALID', at, { expected: 'CodeWiki.v1 kind=code-wiki-service' });
  }
  const service = profile.service ?? {};
  // CodeWiki.v1：敏感代码不得用公共托管服务替代自托管 code wiki。
  if (service.publicHostedServiceSubstitute !== false) {
    add('PUBLIC_SERVICE_SUBSTITUTE_FORBIDDEN', `${at}:service`, { reason: 'sensitive code must never be delegated to a public hosted service' });
  }
  // CodeWiki.v1：代码 Wiki 不构成正式团队知识——新鲜度/来源事实不得把它升格为设计事实。
  if (service.knowledgeAuthority !== false) {
    add('WIKI_KNOWLEDGE_AUTHORITY_FORBIDDEN', `${at}:service`, { reason: 'the code wiki is never official team knowledge; freshness/source facts never promote it into design facts' });
  }
  // 上游选定必须固定精确 commit；未选定保持 null（严禁虚构）。
  const upstream = service.upstream ?? {};
  if (upstream.status && upstream.status !== 'UNSELECTED') {
    if (typeof upstream.commit !== 'string' || !COMMIT_RE.test(upstream.commit)) {
      add('UPSTREAM_COMMIT_NOT_PINNED', `${at}:service.upstream`, { status: upstream.status, reason: 'a selected upstream must pin its exact commit' });
    }
  }
  const generation = profile.generation ?? {};
  if (generation.manifestRequired !== true) {
    add('WIKI_MANIFEST_POLICY_MISSING', `${at}:generation`, { reason: 'CodeWiki.v1 requires a wiki generation manifest policy' });
  }
  if (generation.freshness?.commitPinRequired !== true) {
    add('FRESHNESS_COMMIT_PIN_POLICY_MISSING', `${at}:generation.freshness`, { reason: 'freshness requires the commit-pin policy declared' });
  }
  const access = profile.access ?? {};
  if (access.apiAuthRequired !== true || access.mcpReadbackRequired !== true) {
    add('WIKI_READBACK_POLICY_MISSING', `${at}:access`, { reason: 'policy requires an authenticated, independently read-back API/MCP' });
  }
  return violations;
}

// CodeWiki.v1 部署登记门（修订 2026-10-26-comet-050-adoption-v1）：按真实需要自托管——
// 未部署必须如实登记 NOT_DEPLOYED + 按需触发条件（真实需要 = 设计阶段消费代码解释）；
// 未过镜像认证/upGate 准入不得自称任何已部署状态。
function validateWikiDeployment(profile, lock) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const at = 'deepwiki-profile.json';
  const deployment = profile?.deployment;
  if (!isObject(deployment)) {
    add('WIKI_DEPLOYMENT_STATUS_UNREGISTERED', at, { reason: 'the deployment state (NOT_DEPLOYED + on-demand trigger) must be explicitly registered' });
    return violations;
  }
  if (deployment.status === 'NOT_DEPLOYED') {
    const condition = deployment.onDemandTrigger?.condition;
    if (typeof condition !== 'string' || condition.trim() === '') {
      add('WIKI_ON_DEMAND_TRIGGER_UNREGISTERED', `${at}:deployment`, { reason: 'a NOT_DEPLOYED wiki must register its on-demand trigger condition (real need = design-phase code-explanation consumption)' });
    }
  } else if (lock?.upGate?.enabled !== true) {
    add('WIKI_DEPLOYMENT_STATUS_NOT_ADMITTED', `${at}:deployment`, { status: deployment.status, reason: 'claiming any deployed status requires the images lock up gate to be explicitly admitted first' });
  }
  return violations;
}

function validateGraphProfile(graph) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const at = 'graph-profile.json';
  if (graph.interface !== 'CodeGraph.v1' || graph.kind !== 'structure-index') {
    add('GRAPH_INTERFACE_INVALID', at, { expected: 'CodeGraph.v1 kind=structure-index' });
  }
  if (typeof graph.enabled !== 'boolean') add('GRAPH_ENABLED_FLAG_INVALID', `${at}:enabled`);
  // CodeGraph.v1：可删除的独立优化件——无 gate 权威、无知识权威。
  const removable = graph.removableOptimization ?? {};
  if (removable.removable !== true) {
    add('GRAPH_REMOVABILITY_REQUIRED', `${at}:removableOptimization`, { reason: 'graph must stay removable (optimization, never load-bearing)' });
  }
  if (removable.gateAuthority !== false) {
    add('GRAPH_GATE_AUTHORITY_FORBIDDEN', `${at}:removableOptimization`, { reason: 'graph must never hold gate authority' });
  }
  if (removable.knowledgeAuthority !== false) {
    add('GRAPH_KNOWLEDGE_AUTHORITY_FORBIDDEN', `${at}:removableOptimization`, { reason: 'graph must never hold knowledge authority' });
  }
  const source = graph.source ?? {};
  if (source.structureOnly !== true) {
    add('GRAPH_NOT_STRUCTURE_ONLY', `${at}:source`, { reason: 'CodeGraph.v1 is a structure-only index' });
  }
  if (source.inputCommitPinRequired !== true) {
    add('GRAPH_COMMIT_PIN_POLICY_MISSING', `${at}:source`, { reason: 'graph coverage must pin its exact input commit' });
  }
  const lifecycle = graph.lifecycle ?? {};
  if (lifecycle.rebuildRequiresFreshPull !== true) {
    add('GRAPH_REBUILD_FRESH_PULL_POLICY_MISSING', `${at}:lifecycle`, { reason: 'rebuild must re-pull under current permissions (no revoked-source cache reuse)' });
  }
  if (lifecycle.noAutoFeedOutlineOrLlmWiki !== true) {
    add('GRAPH_AUTOFEED_FORBIDDEN', `${at}:lifecycle`, { reason: 'the whole repository must never be auto-fed to Outline/LLMWiki' });
  }
  return violations;
}

function validateRepositoryScope(scope, registry) {
  const projectId = registry.project.id;
  const expected = registry.project.github;
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const at = 'repository-scope.json';
  if (scope.interface !== 'CodeWiki.v1' || scope.kind !== 'repository-scope') {
    add('SCOPE_INTERFACE_INVALID', at, { expected: 'CodeWiki.v1 kind=repository-scope' });
  }
  const policy = scope.scope ?? {};
  if (policy.denyByDefault !== true) {
    add('SCOPE_DENY_BY_DEFAULT_MISSING', `${at}:scope`, { reason: 'approved code access must be deny-by-default' });
  }
  if (policy.publicHostedServiceSubstitute?.allowed !== false) {
    add('PUBLIC_SERVICE_SUBSTITUTE_FORBIDDEN', `${at}:scope.publicHostedServiceSubstitute`, { reason: 'sensitive code must never be delegated to a public hosted service' });
  }
  if (policy.ingestRequiresAuthorizedScope !== true) {
    add('INGEST_AUTHORIZATION_POLICY_MISSING', `${at}:scope`, { reason: 'ingest/startup must require an authorized scope entry' });
  }
  const sources = Array.isArray(scope.approvedSources) ? scope.approvedSources : [];
  if (!Array.isArray(scope.approvedSources)) add('SCOPE_APPROVED_SOURCES_INVALID', `${at}:approvedSources`);
  for (const [index, entry] of sources.entries()) {
    const entryAt = `${at}:approvedSources[${index}]:${entry.immutableId ?? entry.repository ?? index}`;
    if (projectId && entry.project !== projectId) {
      add('CROSS_PROJECT_SOURCE', entryAt, { project: entry.project, reason: 'sources outside this project are never approvable here' });
      continue;
    }
    if (typeof entry.immutableId !== 'string' || entry.immutableId.length === 0) {
      add('SOURCE_IMMUTABLE_ID_MISSING', entryAt);
    } else if (entry.immutableId !== String(expected.repoId) || entry.repository !== expected.repoFullname) {
      add('SOURCE_IDENTITY_MISMATCH', entryAt, { reason: 'source immutable ID and full repository name must both match the current registered project repository' });
    }
    if (typeof entry.commit !== 'string' || !COMMIT_RE.test(entry.commit)) {
      add('SOURCE_COMMIT_NOT_PINNED', entryAt, { reason: 'an approved source must pin its exact commit' });
    }
    if (typeof entry.grantRef !== 'string' || !entry.grantRef.startsWith(SECRET_REF_PREFIX)) {
      add('GRANT_REF_MISSING', entryAt, { reason: 'an approved source needs a purpose-bound credential reference' });
    } else if (entry.grantRef !== `secret-ref:${projectId}/codewiki-source-read`) {
      add('SOURCE_GRANT_PURPOSE_MISMATCH', entryAt);
    }
  }
  return { violations, sources };
}

function validateDomain({ registry, refsDoc, files }) {
  const violations = [];
  const projectId = registry?.project?.id;
  const jsonDocs = new Map(JSON_FILES.map((name) => [name, JSON.parse(files.get(name))]));
  const lock = jsonDocs.get('images.lock.json');
  const profile = jsonDocs.get('deepwiki-profile.json');
  const graph = jsonDocs.get('graph-profile.json');
  const scope = jsonDocs.get('repository-scope.json');

  // 全域 secret-ref：格式 + 项目绑定 + catalog 登记缺口（缺口显式上报，绝不静默）。
  const refs = new Set();
  for (const name of JSON_FILES) collectSecretRefs(jsonDocs.get(name), refs);
  const catalogRefs = new Set((refsDoc?.refs ?? []).map((entry) => entry.ref));
  const catalogGaps = [];
  for (const ref of refs) {
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) {
      violations.push({ code: 'MALFORMED_REF', at: 'domain refs', ref, reason: parsed.error });
      continue;
    }
    if (projectId && parsed.project !== projectId) {
      violations.push({ code: 'CROSS_PROJECT_REF', at: 'domain refs', ref, project: parsed.project });
      continue;
    }
    if (!catalogRefs.has(ref)) catalogGaps.push(ref);
  }
  catalogGaps.sort();

  violations.push(...validateLock(lock).violations);
  violations.push(...validateWikiProfile(profile));
  violations.push(...validateWikiDeployment(profile, lock));
  violations.push(...validateGraphProfile(graph));
  const scopeResult = validateRepositoryScope(scope, registry);
  violations.push(...scopeResult.violations);

  // JSON 结构安全扫描 + compose 声明门。
  for (const name of JSON_FILES) violations.push(...scanForForbiddenValues(jsonDocs.get(name)));
  const compose = validateCompose(files.get('compose.yaml'));
  violations.push(...compose.violations);

  return { violations, catalogGaps, jsonDocs, scopeSources: scopeResult.sources, composeParser: compose.parser };
}

function buildQualification({ registryText, dir, files, catalogGaps, scopeSources, optionalMissing }) {
  const lock = JSON.parse(files.get('images.lock.json'));
  const profile = JSON.parse(files.get('deepwiki-profile.json'));
  const graph = JSON.parse(files.get('graph-profile.json'));
  const scope = JSON.parse(files.get('repository-scope.json'));
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
  const authorizedCount = scopeSources.filter((entry) => entry.status === 'AUTHORIZED').length;
  const freshness = profile.generation?.freshness ?? {};
  const policyDecided = freshness.maxCommitAgeDays !== null && freshness.maxCommitAgeDays !== undefined
    && freshness.languageCoverageMin !== null && freshness.languageCoverageMin !== undefined;
  const categories = {
    'image-digest-authenticated': unreadyComponents.length === 0
      ? RECORDED('required image digest flags are declarations; independent current registry/source/platform/provenance qualification is still required')
      : UNVERIFIED(`required components still lack independent current image qualification (${unreadyComponents.map((c) => c.component).join(', ')}); recorded source/image metadata does not establish runtime or action authority`),
    'upstream-release-selected': (profile.service?.upstream?.status === 'SELECTED' && typeof profile.service?.upstream?.commit === 'string')
      ? UNVERIFIED('upstream recorded as selected; exact release/digest/license/startup-API contract still require execution-time verification')
      : UNVERIFIED('deepwiki-open upstream repository/release is UNSELECTED; selection with a pinned commit must be verified before any startup'),
    'source-authorization': authorizedCount > 0
      ? UNVERIFIED('approved sources exist; each entry still requires execution-time read-permission proof via its grantRef')
      : UNVERIFIED('deny-by-default scope authorizes nothing yet; startup/ingest refuse until a source is approved with immutableID + pinned commit by an authorized grant'),
    'secret-refs-registered': catalogGaps.length === 0
      ? RECORDED('all 3 code-knowledge refs present in the I01 catalog; all remain NOT_PROVISIONED')
      : UNVERIFIED(`refs missing from the I01 catalog (catalog is I01-owned and needs a registration update): ${catalogGaps.join(', ')}`),
    'credentials-provisioned': UNVERIFIED('all 3 secret refs are NOT_PROVISIONED; no runtime secret store authorization exists'),
    'wiki-generation-manifest': UNVERIFIED('no wiki generation manifest observed; requires a real self-hosted generation for an approved pinned commit'),
    'wiki-freshness': policyDecided
      ? UNVERIFIED('freshness policy decided but never exercised against a real generation manifest + live readback')
      : UNVERIFIED('freshness policy undecided (maxCommitAgeDays/languageCoverageMin unset): fail-closed — freshness can never report pass until the pilot language/repo-scale/update policy is decided'),
    'api-mcp-readback': UNVERIFIED('no live instance; authenticated API/MCP pagination/version-exposure capabilities are unproven'),
    'wiki-deployment-demand': (profile.deployment?.status === 'NOT_DEPLOYED' && nonBlank(profile.deployment?.onDemandTrigger?.condition))
      ? RECORDED('not deployed; deployment is on-demand only — no deployment without the real need (设计阶段实际消费代码解释且现有本地事实不足); admission prerequisites (digest authentication, authorized source scope, up gate, provisioned credentials) unchanged')
      : UNVERIFIED('deployment registration missing or inconsistent (NOT_DEPLOYED status / on-demand trigger condition)'),
    'graph-optional-disabled': graph.enabled === false
      ? RECORDED('graph is disabled or absent; no graph runtime, coverage or whole correctness journey is claimed by this declaration')
      : UNVERIFIED('graph enabled flag is not the committed disabled state; coverage evidence still requires a live component'),
    'backup-compatibility': UNVERIFIED('no restore drill registered for generation policy/source versions/authorization mapping and required wiki artifacts'),
  };
  const inputs = { registrySha256: sha256Text(registryText), domainFiles: {} };
  for (const name of DOMAIN_FILES) inputs.domainFiles[name] = optionalMissing.includes(name) ? null : sha256Text(files.get(name));
  const values = Object.values(categories);
  return {
    interface: 'Qualification.v1',
    domain: 'code-knowledge',
    dir: displayPath(dir),
    ready: values.every((category) => category.status === 'VERIFIED'),
    unverifiedCount: values.filter((category) => category.status === 'UNVERIFIED').length,
    catalogGaps,
    categories,
    inputs,
    unreadyComponents,
    scope: { approvedSources: scopeSources.length, authorizedSources: authorizedCount },
  };
}

// CodeWiki.v1 新鲜度评估（manifest 级事实；真实 API/MCP 独立读回仍属运行时证据）。
// 失败闭合：生成失败、scope 越权、commit 不一致、策略未定、覆盖不足、证据缺失——任一命中即 passed=false。
function evaluateFreshness({ manifest, profile, scopeSources }) {
  const denial = (code, reason) => ({ evaluated: true, passed: false, code, reason });
  const generationStatus = manifest?.generation?.status;
  if (generationStatus !== 'succeeded') {
    return denial('GENERATION_NOT_CONFIRMED', 'manifest generation is not confirmed as succeeded; a failed or incomplete generation cannot report freshness');
  }
  const immutableId = manifest?.immutableId;
  const approved = scopeSources.find((entry) => entry.immutableId === immutableId);
  if (!approved || approved.status !== 'AUTHORIZED') {
    return denial('SOURCE_NOT_AUTHORIZED', 'manifest source is not an authorized entry of the current project scope; foreign or other-project indexes are never accepted as the project result');
  }
  const manifestCommit = manifest?.commit;
  if (typeof manifestCommit !== 'string' || !COMMIT_RE.test(manifestCommit) || manifestCommit !== approved.commit) {
    return denial('COMMIT_MISMATCH_STALE', 'manifest commit does not match the approved pinned source commit; a stale commit cannot report freshness');
  }
  const freshness = profile.generation?.freshness ?? {};
  const policyDecided = freshness.maxCommitAgeDays !== null && freshness.maxCommitAgeDays !== undefined
    && freshness.languageCoverageMin !== null && freshness.languageCoverageMin !== undefined;
  if (!policyDecided || freshness.commitPinRequired !== true) {
    return denial('FRESHNESS_POLICY_UNSET', 'freshness policy is undecided (maxCommitAgeDays/languageCoverageMin unset): fail-closed — an undecided policy can never report pass');
  }
  const coverage = Array.isArray(manifest?.languageCoverage) ? manifest.languageCoverage : null;
  if (!coverage) {
    return denial('FRESHNESS_EVIDENCE_MISSING', 'manifest carries no languageCoverage evidence');
  }
  if (coverage.length < freshness.languageCoverageMin) {
    return denial('COVERAGE_INSUFFICIENT', `language coverage ${coverage.length} is below the policy minimum ${freshness.languageCoverageMin}; insufficient coverage can never report freshness`);
  }
  if (typeof manifest?.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) {
    return denial('FRESHNESS_EVIDENCE_MISSING', 'manifest carries no parseable generatedAt; commit age cannot be evaluated');
  }
  const ageDays = (Date.now() - Date.parse(manifest.generatedAt)) / 86_400_000;
  if (ageDays > freshness.maxCommitAgeDays) {
    return denial('COMMIT_AGE_EXCEEDED', `manifest age ${ageDays.toFixed(2)}d exceeds the policy maximum ${freshness.maxCommitAgeDays}d; a stale wiki can never report freshness`);
  }
  return {
    evaluated: true,
    passed: true,
    code: 'FRESHNESS_MANIFEST_LEVEL_PASS',
    reason: 'manifest-level freshness checks pass against the approved pinned scope and decided policy; real API/MCP readback evidence is still required before any verified claim',
  };
}

const PROBE_CASES = {
  'pinned-code-wiki': {
    requiredInputs: [
      'live self-hosted code-wiki instance endpoint (--endpoint <url>; public hosted services are not an allowed substitute)',
      'provider credential resolved via secret-ref:sdd-harness-pilot/codewiki-provider (runtime authorization; no token borrowing)',
      'an authorized repository-scope entry with immutableID + pinned commit and grant secret-ref:sdd-harness-pilot/codewiki-source-read',
      'a wiki generation manifest for the exact approved commit (--manifest <file> enables the local manifest-level freshness evaluation)',
    ],
    plannedSteps: [
      'GET endpoint — instance reachable and identity observed',
      'authenticated provider API/MCP readback of the wiki for repoID/immutableID/commit (pagination/version exposure verified)',
      'compare repoID/immutableID/commit against the repository-scope approved entry and the generation manifest',
      'sample wiki references for accuracy; verify language coverage meets the decided policy',
      'record the freshness verdict as fact — the outer gate decides per the pre-committed policy',
    ],
  },
  'graph-disabled-correctness': {
    requiredInputs: [
      'committed code-knowledge domain files (--dir; no live runtime required)',
    ],
    plannedSteps: [
      'read the committed graph-profile and record the enabled flag and authority declarations',
      're-run the full main validation chain (validateDomain) against the domain for real — not a flag-text read',
      'assert the main chain is green with graph disabled and that graph holds no gate/knowledge authority',
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
  const registryInput = readInputJson(registryFile, 'registry', 'REGISTRY');
  if (!registryInput.ok) return reportInputFailure(registryInput);
  const registry = registryInput.value;
  const refsInput = readInputJson(refsFile, 'refs catalog', 'REFS');
  if (!refsInput.ok) return reportInputFailure(refsInput);
  const refsDoc = refsInput.value;
  const { files, missing, unparseable, optionalMissing, internalFailure } = loadDomainFiles(dir);
  if (internalFailure) return reportInputFailure(internalFailure);
  if (missing.length) return failInput(`domain files missing: ${missing.join(', ')}`);
  if (unparseable.length) return failInput(`domain files unparseable: ${unparseable.join(', ')}`);
  const shapes = inputShapes({ registry, refsDoc, files });
  if (shapes.length) { print({ interface: 'CodeKnowledgeInfra.v1', command, ready: false, refused: true, violations: shapes }); return EXIT_VERIFY; }
  const domain = validateDomain({ registry, refsDoc, files });
  if (domain.violations.length && command !== 'validate') {
    print({ interface: 'CodeKnowledgeInfra.v1', command, ready: false, refused: true, status: domain.composeParser.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'BLOCKED', violations: domain.violations, composeParser: domain.composeParser }); return EXIT_VERIFY;
  }

  if (command === 'probe') {
    const spec = Object.hasOwn(PROBE_CASES, opts.case) ? PROBE_CASES[opts.case] : null;
    if (!spec) return failInput('unknown probe case', 'PROBE_CASE_INVALID');
    if (opts.endpoint !== undefined) {
      let endpoint;
      try { endpoint = new URL(opts.endpoint); } catch { return failInput('endpoint must be a loopback HTTP origin'); }
      if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
        || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) return failInput('endpoint must be a loopback HTTP origin');
    }
    const profile = JSON.parse(files.get('deepwiki-profile.json'));
    const graph = JSON.parse(files.get('graph-profile.json'));
    const { catalogGaps, scopeSources } = domain;

    if (opts.case === 'graph-disabled-correctness') {
      const observation = {
        interface: 'CodeKnowledgeInfra.v1',
        command: 'probe',
        case: opts.case,
        dir: displayPath(dir),
        executed: true,
        status: null,
        proofLayer: 'component-configuration',
        composeParser: domain.composeParser,
        reason: null,
        requiredInputs: spec.requiredInputs,
        plannedSteps: spec.plannedSteps,
        observedSteps: [],
        graph: { enabled: graph.enabled, declarationPresent: !optionalMissing.includes('graph-profile.json'), runtimeVerified: false, gateAuthority: graph.removableOptimization?.gateAuthority ?? null, knowledgeAuthority: graph.removableOptimization?.knowledgeAuthority ?? null },
      };
      observation.observedSteps.push({
        step: 'read committed graph-profile enabled flag',
        status: 'VERIFIED',
        enabled: graph.enabled,
      });
      // 真实重跑主校验链（不是读开关文本）：停用 graph 后正确性协议必须照常可执行。
      const { violations } = validateDomain({ registry, refsDoc, files });
      observation.observedSteps.push({
        step: 'main validation chain re-run (graph-disabled correctness)',
        status: violations.length === 0 ? 'VERIFIED' : 'UNVERIFIED',
        violations: violations.length,
        codes: violations.map((violation) => violation.code),
      });
      if (violations.length === 0) {
        observation.status = 'VERIFIED';
        observation.reason = 'the component configuration validation chain passed without requiring a graph runtime; actual correctness tests and Comet retrieval still require independent execution';
        print(observation);
        return EXIT_PASS;
      }
      observation.status = 'UNVERIFIED';
      observation.reason = `main validation chain reported ${violations.length} violation(s) with graph state recorded (${JSON.stringify(graph.enabled)}); correctness cannot be confirmed`;
      print(observation);
      return EXIT_VERIFY;
    }

    // pinned-code-wiki：本地可做的是 manifest 级新鲜度评估；API/MCP 独立读回必须真实运行时。
    const observation = {
      interface: 'CodeKnowledgeInfra.v1',
      command: 'probe',
      case: opts.case,
      endpoint: opts.endpoint ?? null,
      manifest: opts.manifest ? displayPath(opts.manifest) : null,
      executed: false,
      status: 'UNVERIFIED',
      liveReadback: false,
      evaluationBasis: 'declared-artifact-only',
      reason: null,
      freshness: null,
      requiredInputs: spec.requiredInputs,
      plannedSteps: spec.plannedSteps,
      observedSteps: [],
    };
    if (opts.manifest) {
      const manifestInput = readInputJson(opts.manifest, 'manifest', 'MANIFEST');
      if (!manifestInput.ok) return reportInputFailure(manifestInput);
      const manifest = manifestInput.value;
      const freshness = evaluateFreshness({ manifest, profile, scopeSources });
      observation.freshness = freshness;
      observation.executed = true;
      observation.observedSteps.push({
        step: 'manifest-level freshness evaluation against approved scope + decided policy',
        status: freshness.passed ? 'VERIFIED' : 'UNVERIFIED',
        passed: freshness.passed,
        code: freshness.code,
      });
      if (!freshness.passed) {
        observation.reason = `freshness denied: ${freshness.code} — ${freshness.reason}`;
        print(observation);
        return EXIT_VERIFY;
      }
    }
    if (!observation.endpoint) {
      observation.reason =
        'no live self-hosted code-wiki endpoint configured; freshness requires a real authenticated API/MCP readback for the approved pinned commit (up refuses until the images lock qualifies, the source scope is authorized and admission is granted). Pass --endpoint <url> once the stack exists — this command never mocks and never skips.'
        + (catalogGaps.length > 0 ? ` Pending I01 catalog registrations: ${catalogGaps.join(', ')}.` : '');
      print(observation);
      return EXIT_VERIFY;
    }
    observation.observedSteps.push({
      step: 'authenticated provider API/MCP readback',
      status: 'UNVERIFIED',
      reason: 'requires a runtime-resolved provider credential (secret-ref:sdd-harness-pilot/codewiki-provider) and an authorized source scope; credentials resolve only via runtime-authorized secret refs',
    });
    observation.reason = 'endpoint registration is not an action grant; current source/provider identities and native authenticated commit-bound API/MCP readback remain unqualified. No API request or generation was attempted.';
    print(observation);
    return EXIT_VERIFY;
  }

  // validate/qualify/up：registry 与 refs 目录必须先可读（fail-closed，绝不静默降级为空规则）。
  if (command === 'validate') {
    const profile = domain.jsonDocs.get('deepwiki-profile.json');
    const graph = domain.jsonDocs.get('graph-profile.json');
    const scope = domain.jsonDocs.get('repository-scope.json');
    print({
      interface: 'CodeKnowledgeInfra.v1',
      command: 'validate',
      registry: displayPath(registryFile),
      refs: displayPath(refsFile),
      dir: displayPath(dir),
      ok: domain.violations.length === 0,
      status: domain.composeParser.status === 'UNVERIFIED' ? 'UNVERIFIED' : domain.violations.length ? 'BLOCKED' : 'VALIDATED',
      composeParser: domain.composeParser,
      violations: domain.violations,
      catalogGaps: domain.catalogGaps,
      wiki: {
        interface: 'CodeWiki.v1',
        kind: profile.kind,
        serviceKind: profile.service?.kind ?? null,
        upstream: {
          status: profile.service?.upstream?.status ?? null,
          repository: profile.service?.upstream?.repository ?? null,
          commit: profile.service?.upstream?.commit ?? null,
        },
        generation: {
          manifestRequired: profile.generation?.manifestRequired ?? null,
          commitPinRequired: profile.generation?.freshness?.commitPinRequired ?? null,
          maxCommitAgeDays: profile.generation?.freshness?.maxCommitAgeDays ?? null,
          languageCoverageMin: profile.generation?.freshness?.languageCoverageMin ?? null,
        },
        access: {
          apiAuthRequired: profile.access?.apiAuthRequired ?? null,
          mcpReadbackRequired: profile.access?.mcpReadbackRequired ?? null,
        },
        deployment: {
          status: profile.deployment?.status ?? null,
          onDemandTriggerRegistered: typeof profile.deployment?.onDemandTrigger?.condition === 'string' && profile.deployment.onDemandTrigger.condition.trim() !== '',
          knowledgeAuthority: profile.service?.knowledgeAuthority ?? null,
        },
      },
      graph: {
        interface: 'CodeGraph.v1',
        enabled: graph.enabled ?? null,
        declarationPresent: !optionalMissing.includes('graph-profile.json'),
        runtimeVerified: false,
        status: graph.status ?? null,
        removable: graph.removableOptimization?.removable ?? null,
        gateAuthority: graph.removableOptimization?.gateAuthority ?? null,
        knowledgeAuthority: graph.removableOptimization?.knowledgeAuthority ?? null,
      },
      scope: {
        interface: 'CodeWiki.v1',
        kind: scope.kind,
        denyByDefault: scope.scope?.denyByDefault ?? null,
        ingestRequiresAuthorizedScope: scope.scope?.ingestRequiresAuthorizedScope ?? null,
        publicHostedServiceSubstituteAllowed: scope.scope?.publicHostedServiceSubstitute?.allowed ?? null,
        approvedSources: (scope.approvedSources ?? []).length,
        authorizationStatus: scope.authorizationEvidence?.status ?? null,
      },
    });
    return domain.violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'qualify' || command === 'up') {
    // 单一事实源：catalog 缺口来自同一 validateDomain 结果，validate/qualify/up 共享。
    const qualification = buildQualification({ registryText: registryInput.text, dir, files, catalogGaps: domain.catalogGaps, scopeSources: domain.scopeSources, optionalMissing });
    qualification.composeParser = domain.composeParser;
    if (command === 'qualify') {
      print(qualification);
      return qualification.ready ? EXIT_PASS : EXIT_VERIFY;
    }
    if (qualification.unreadyComponents.length > 0) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'code-knowledge',
        refused: true,
        ready: false,
        error: `UP_REFUSED_IMAGES_LOCK_NOT_READY: ${qualification.unreadyComponents.length} required component images lack current independent qualification; public source/image metadata is not runtime authority`,
        unverifiedComponents: qualification.unreadyComponents,
        receipt: qualification,
      });
      return EXIT_VERIFY;
    }
    // 未授权源码：deny-by-default scope 没有任何已批准源时，启动/摄入必须拒绝。
    const scope = JSON.parse(files.get('repository-scope.json'));
    const requiresScope = scope.scope?.ingestRequiresAuthorizedScope === true;
    if (requiresScope && qualification.scope.authorizedSources === 0) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'code-knowledge',
        refused: true,
        ready: false,
        error: `UP_REFUSED_SOURCE_SCOPE_NOT_AUTHORIZED: deny-by-default scope has ${qualification.scope.approvedSources} approved source(s), 0 authorized; startup/ingest require an approved source with immutableID + pinned commit`,
        receipt: qualification,
      });
      return EXIT_VERIFY;
    }
    const lock = JSON.parse(files.get('images.lock.json'));
    if (lock.upGate?.enabled !== true) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'code-knowledge',
        refused: true,
        ready: false,
        error: 'UP_NOT_AUTHORIZED: runtime launch is not admitted',
      });
      return EXIT_VERIFY;
    }
    print({
      interface: 'Qualification.v1',
      command: 'up',
      domain: 'code-knowledge',
      refused: true,
      ready: false,
      status: 'UNVERIFIED',
      error: 'UP_NOT_EXECUTED: runtime launch requires an authorized operator context; I05 declares the domain and gates, admission is a later explicit decision',
    });
    return EXIT_VERIFY;
  }

  return failInput('unknown command');
}

let exitCode;
try { exitCode = await main(process.argv.slice(2)); }
catch { exitCode = reportInputFailure({ status: 'INTERNAL_FAILURE', code: 'INTERNAL_FAILURE', error: 'unexpected internal failure', exitCode: EXIT_VERIFY }); }
process.exit(exitCode);
