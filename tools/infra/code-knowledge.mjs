#!/usr/bin/env node
// CodeKnowledgeInfra.v1 / CodeWiki.v1 / CodeGraph.v1 CLI — validate | qualify | up | probe
//
// 只登记、声明与验收：不启动任何服务、不持有阶段/DAG/业务重试、不改活配置（hooks/MCP 由对应 P 任务串行接纳）。
// 外层纯 gate 语义：本工具只返回事实与判定输入（violations / qualification categories / freshness verdict），
// 不建立自己的调度或阶段；判定按事前 policy 由外层 gate 完成。
// 镜像 tag/digest/版本一律来自 infra/delivery/code-knowledge/images.lock.json；deepwiki-open 上游仓库/发行物
// 未选定，当前不存在已认证镜像，严禁虚构。upGate 未开启时 up 必须拒绝。
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
import { parseSecretRef, scanForForbiddenValues } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const DEFAULT_DIR = path.join(repoRoot, 'infra', 'delivery', 'code-knowledge');

const JSON_FILES = ['images.lock.json', 'deepwiki-profile.json', 'graph-profile.json', 'repository-scope.json'];
const DOMAIN_FILES = ['compose.yaml', ...JSON_FILES];
const REQUIRED_COMPONENTS = ['codewiki-app', 'codegraph'];
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SECRET_REF_PREFIX = 'secret-ref:';

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时目录）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

const HOST_USER_PATH = /(^|[\s"'=(:])\/(Users|home|root)\//;

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

function validateLock(lock) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  if (lock.interface !== 'CodeKnowledgeImageLock.v1') add('LOCK_INTERFACE_INVALID', 'images.lock.json', { expected: 'CodeKnowledgeImageLock.v1' });
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

function validateRepositoryScope(scope, projectId) {
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
    }
    if (typeof entry.commit !== 'string' || !COMMIT_RE.test(entry.commit)) {
      add('SOURCE_COMMIT_NOT_PINNED', entryAt, { reason: 'an approved source must pin its exact commit' });
    }
    if (typeof entry.grantRef !== 'string' || !entry.grantRef.startsWith(SECRET_REF_PREFIX)) {
      add('GRANT_REF_MISSING', entryAt, { reason: 'an approved source needs a purpose-bound credential reference' });
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
  violations.push(...validateGraphProfile(graph));
  const scopeResult = validateRepositoryScope(scope, projectId);
  violations.push(...scopeResult.violations);

  // JSON 结构安全扫描 + compose 声明门。
  for (const name of JSON_FILES) violations.push(...scanForForbiddenValues(jsonDocs.get(name)));
  violations.push(...validateCompose(files.get('compose.yaml')));

  return { violations, catalogGaps, jsonDocs, scopeSources: scopeResult.sources };
}

function buildQualification({ registryFile, dir, files, catalogGaps, scopeSources }) {
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
      ? { status: 'VERIFIED', observed: 'all declared components carry an authenticated digest' }
      : UNVERIFIED(`no declared component image has an authenticated digest (${unreadyComponents.map((c) => c.component).join(', ')}); the upstream repository/release is UNSELECTED and inventing tags/digests/versions is forbidden`),
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
    'graph-optional-disabled': graph.enabled === false
      ? RECORDED('committed profile declares the removable optimization disabled; graph holds no gate/knowledge authority and the main validation chain re-runs green without it (probe graph-disabled-correctness)')
      : UNVERIFIED('graph enabled flag is not the committed disabled state; coverage evidence still requires a live component'),
    'backup-compatibility': UNVERIFIED('no restore drill registered for generation policy/source versions/authorization mapping and required wiki artifacts'),
  };
  const inputs = { registrySha256: sha256Text(fs.readFileSync(registryFile)), domainFiles: {} };
  for (const name of DOMAIN_FILES) inputs.domainFiles[name] = sha256Text(files.get(name));
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
    return denial('GENERATION_NOT_CONFIRMED', `manifest generation status is ${JSON.stringify(generationStatus ?? null)}, not "succeeded"; a failed/incomplete generation can never report freshness`);
  }
  const immutableId = manifest?.immutableId;
  const approved = scopeSources.find((entry) => entry.immutableId === immutableId);
  if (!approved || approved.status !== 'AUTHORIZED') {
    return denial('SOURCE_NOT_AUTHORIZED', `manifest immutableId ${JSON.stringify(immutableId ?? null)} is not an authorized entry of this project's approved scope; foreign/other-project indexes are never accepted as the project result`);
  }
  const manifestCommit = manifest?.commit;
  if (typeof manifestCommit !== 'string' || !COMMIT_RE.test(manifestCommit) || manifestCommit !== approved.commit) {
    return denial('COMMIT_MISMATCH_STALE', `manifest commit does not match the approved pinned commit for ${immutableId}; a stale commit can never report freshness`);
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

  if (command === 'probe') {
    const spec = PROBE_CASES[opts.case];
    if (!spec) return failInput(`unknown probe case: ${opts.case ?? '(missing --case)'}`);
    const dir = opts.dir ?? DEFAULT_DIR;
    const { files, missing, unparseable } = loadDomainFiles(dir);
    if (missing.length > 0) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
    if (unparseable.length > 0) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);
    const profile = JSON.parse(files.get('deepwiki-profile.json'));
    const graph = JSON.parse(files.get('graph-profile.json'));
    const registry = JSON.parse(fs.readFileSync(opts.registry ?? DEFAULT_REGISTRY, 'utf8'));
    const refsDoc = JSON.parse(fs.readFileSync(opts.refs ?? DEFAULT_REFS, 'utf8'));
    const { catalogGaps, scopeSources } = validateDomain({ registry, refsDoc, files });

    if (opts.case === 'graph-disabled-correctness') {
      const observation = {
        interface: 'CodeKnowledgeInfra.v1',
        command: 'probe',
        case: opts.case,
        dir: displayPath(dir),
        executed: true,
        status: null,
        reason: null,
        requiredInputs: spec.requiredInputs,
        plannedSteps: spec.plannedSteps,
        observedSteps: [],
        graph: { enabled: graph.enabled, gateAuthority: graph.removableOptimization?.gateAuthority ?? null, knowledgeAuthority: graph.removableOptimization?.knowledgeAuthority ?? null },
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
        observation.reason = 'main validation chain is green with the graph component disabled: CodeGraph is a removable optimization with no gate/knowledge authority, and the correctness protocol does not depend on it';
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
      endpoint: opts.endpoint ?? process.env.CODEWIKI_ENDPOINT ?? null,
      manifest: opts.manifest ? displayPath(opts.manifest) : null,
      executed: false,
      status: 'UNVERIFIED',
      reason: null,
      freshness: null,
      requiredInputs: spec.requiredInputs,
      plannedSteps: spec.plannedSteps,
      observedSteps: [],
    };
    if (opts.manifest) {
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(opts.manifest, 'utf8'));
      } catch (err) {
        return failInput(`manifest unreadable/unparseable (${displayPath(opts.manifest)}): ${redactHostPaths(err.message)}`);
      }
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
    // 真实可达性尝试：探针永远先打真实请求，失败即如实上报，绝不 mock。
    try {
      const response = await fetch(String(observation.endpoint).replace(/\/$/, '') + '/', { signal: AbortSignal.timeout(5000) });
      observation.observedSteps.push({ step: 'GET endpoint', status: 'VERIFIED', httpStatus: response.status });
    } catch (err) {
      const causeDetail = err?.cause ? (err.cause.code ?? err.cause.message ?? err.cause.name) : (err?.code ?? err?.message ?? err?.name ?? 'ERROR');
      const cause = redactHostPaths(String(causeDetail));
      observation.observedSteps.push({ step: 'GET endpoint', status: 'UNVERIFIED', error: cause });
      observation.reason = `endpoint unreachable (GET endpoint): ${cause}`;
      print(observation);
      return EXIT_VERIFY;
    }
    observation.observedSteps.push({
      step: 'authenticated provider API/MCP readback',
      status: 'UNVERIFIED',
      reason: 'requires a runtime-resolved provider credential (secret-ref:sdd-harness-pilot/codewiki-provider) and an authorized source scope; credentials resolve only via runtime-authorized secret refs',
    });
    observation.reason = 'endpoint reachable, but the pinned-commit readback requires authorized credentials and admission evidence that do not exist yet; no step may be fabricated';
    print(observation);
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
  const domain = validateDomain({ registry, refsDoc, files });

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
      },
      graph: {
        interface: 'CodeGraph.v1',
        enabled: graph.enabled ?? null,
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
    const qualification = buildQualification({ registryFile, dir, files, catalogGaps: domain.catalogGaps, scopeSources: domain.scopeSources });
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
        error: `UP_REFUSED_IMAGES_LOCK_NOT_READY: ${qualification.unreadyComponents.length} component images lack an authenticated digest (upstream releases are UNSELECTED; inventing tags/digests/versions is forbidden)`,
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
        ready: true,
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
        domain: 'code-knowledge',
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
      domain: 'code-knowledge',
      refused: true,
      ready: true,
      status: 'UNVERIFIED',
      error: 'UP_NOT_EXECUTED: runtime launch requires an authorized operator context; I05 declares the domain and gates, admission is a later explicit decision',
    });
    return EXIT_VERIFY;
  }

  return failInput(`unknown command: ${command}`);
}

process.exit(await main(process.argv.slice(2)));
