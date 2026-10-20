#!/usr/bin/env node
// KnowledgeAuthz.v1 CLI — validate | verify-grant | revoke | decide | recheck | resolve
//
// P4_7 知识预授权决策面（delivery-foundation-rearchitecture Task P4_7, U01–U08）。
// 设计：knowledge-preauthorization-contract.md；规格：specs/delivery-foundation
// spec.md "Knowledge publication authorization"。三个登记工件（infra/delivery/
// knowledge/ 下 authorization-model / preauthorization-policy / grant-ledger）是
// 唯一事实源：请求不得携带自己的 grant/approved 字段（U01 自批类拒绝），台账是
// 授权的唯一记录；撤销/过期按真实时钟判定，本工具没有 --now 入口——Agent 不能
// 改时间；撤销是 authority-gated 的真实状态迁移（原子写回台账）。
//
// 本地可证子集：授权模型结构、可信签发/撤销/过期时序、多源披露交集、principal
// 映射完整性、写前重验与角色隔离边界（经 I01 secret-ref 目录的真实解析门）。
// 活源/目标权限读回、Outline 继承/单页/公开分享强制、受保护签发工作流在本环境
// 不可观测：一律 UNVERIFIED/UNREGISTERED 如实标注（承接：Outline owner + 部署
// 验证波次），绝不 mock 转绿。
//
// 退出码契约：
//   0 = PASS（validate 干净 / grant 有效 / decide=allow / recheck 新鲜 / resolve 主体通过四重检查）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、请求结构畸形）
//   2 = 验证失败（violations、denied、expired/revoked、stale、主体被拒）
//
// 零新依赖；秘密值永不落地（scanForForbiddenValues + I01 只读解析门）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, resolveSecretRef, scanForForbiddenValues } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const KNOWLEDGE_DIR = path.join(repoRoot, 'infra', 'delivery', 'knowledge');
const DEFAULT_MODEL = path.join(KNOWLEDGE_DIR, 'authorization-model.json');
const DEFAULT_POLICY = path.join(KNOWLEDGE_DIR, 'preauthorization-policy.json');
const DEFAULT_LEDGER = path.join(KNOWLEDGE_DIR, 'grant-ledger.example.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAPPED_PRINCIPAL = [
  /^svc:[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/,
  /^group:[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,62}$/,
  /^human:[a-z0-9][a-z0-9-]{0,62}#\d+$/,
];
const ROLES = ['author', 'reviewer', 'publisher', 'isolator'];
// U01：自批输入类——这三个字段无论值是什么都是拒绝（作者不能自带授权/批准/敏感级）。
const FORBIDDEN_REQUEST_FIELDS = {
  grant: 'SELF_AUTHORED_GRANT',
  approved: 'SELF_AUTHORED_APPROVAL',
  sensitivity: 'AUTHOR_CLASSIFICATION_FORBIDDEN',
};
const ALLOWED_REQUEST_FIELDS = new Set(['schemaVersion', 'requestedBy', 'execution', 'operation', 'payloadDigest', 'sources', 'review']);

const COMMANDS = {
  validate: ['model', 'policy', 'ledger', 'refs', 'registry', 'json'],
  'verify-grant': ['grant', 'ledger', 'model', 'json'],
  revoke: ['grant', 'ledger', 'model', 'as', 'reason', 'json'],
  decide: ['request', 'ledger', 'model', 'policy', 'json'],
  recheck: ['decision', 'ledger', 'model', 'policy', 'payload-digest', 'json'],
  resolve: ['ref', 'as', 'role', 'refs', 'json'],
};
// 每命令可缺省项（缺省时用仓库默认路径或语义可缺省）；其余选项必填。
const OPTIONAL_OPTIONS = new Set(['json', 'refs', 'registry', 'payload-digest']);

const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};
const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');
const sha256File = (file) => sha256Text(fs.readFileSync(file));
const isMappedPrincipal = (value) => typeof value === 'string' && MAPPED_PRINCIPAL.some((re) => re.test(value));
const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

function usage() {
  return [
    'usage:',
    '  knowledge-authz.mjs validate     --model <f> --policy <f> --ledger <f> [--refs <f>] [--registry <f>] [--json]',
    '  knowledge-authz.mjs verify-grant --grant <id> --ledger <f> --model <f> [--json]',
    '  knowledge-authz.mjs revoke       --grant <id> --ledger <f> --model <f> --as <principal> --reason <text> [--json]',
    '  knowledge-authz.mjs decide       --request <f> --ledger <f> --model <f> --policy <f> [--json]',
    '  knowledge-authz.mjs recheck      --decision <f> --ledger <f> --model <f> --policy <f> [--payload-digest <sha256>] [--json]',
    '  knowledge-authz.mjs resolve      --ref <secret-ref> --as <principal> --role <role> [--refs <f>] [--json]',
    '',
    'exit codes: 0=PASS, 1=invalid input/prerequisite, 2=verification failure (denied/expired/revoked/stale).',
    'there is no --now: validity is always judged against the real clock; agents cannot modify time.',
  ].join('\n');
}

function parseArgs(argv) {
  const command = argv[0];
  const allowed = COMMANDS[command];
  if (!allowed) return { command, error: command ? `unknown command: ${command}` : 'missing command' };
  const opts = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) return { command, error: `unexpected positional argument: ${arg}` };
    const key = arg.slice(2);
    if (!allowed.includes(key)) return { command, error: `unknown option --${key} for ${command}` };
    if (key === 'json') { opts.json = true; continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) return { command, error: `missing value for --${key}` };
    opts[key] = value;
  }
  for (const key of allowed) {
    if (!OPTIONAL_OPTIONS.has(key) && opts[key] === undefined) return { command, error: `missing required option --${key}` };
  }
  return { command, opts };
}

function print(payload) {
  process.stdout.write(`${JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, null, 2)}\n`);
}

function failInput(message) {
  process.stderr.write(`${redactHostPaths(message)}\n${usage()}\n`);
  return EXIT_INPUT;
}

function loadJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { error: `${label} unreadable: ${error.message}` };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch (error) {
    return { error: `${label} unparseable: ${error.message}` };
  }
}

// grant 链核验（verify-grant / decide / recheck 共用）：注册 issuer + 域权力 +
// 真实时钟下的有效期 + 未撤销。签名存在性从不进入判据（U01）。
function checkGrant(grant, { model, nowMs }) {
  const issuer = (model.issuers ?? []).find((entry) => entry.id === grant.issuer);
  if (!issuer) return { code: 'ISSUER_UNREGISTERED' };
  const coversSource = Array.isArray(issuer.authority?.sources) && issuer.authority.sources.includes(grant.authority?.source);
  const coversTarget = Array.isArray(issuer.authority?.targets) && issuer.authority.targets.includes(grant.authority?.target);
  if (!coversSource || !coversTarget) return { code: 'ISSUER_AUTHORITY_INVALID' };
  const issuedAt = Date.parse(grant.issuedAt ?? '');
  const expiresAt = Date.parse(grant.expiresAt ?? '');
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt >= expiresAt) return { code: 'GRANT_VALIDITY_INVALID' };
  if (nowMs < issuedAt) return { code: 'GRANT_NOT_YET_EFFECTIVE' };
  if (nowMs > expiresAt) return { code: 'GRANT_EXPIRED' };
  if (grant.revocation) return { code: 'GRANT_REVOKED' };
  return { ok: true, issuer };
}

// --- validate ------------------------------------------------------------------

function validateArtifacts({ model, policy, ledger, refsDoc, registry }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  if (model.interface !== 'KnowledgeAuthzModel.v1') add('MODEL_INTERFACE_INVALID', 'authorization-model.json', { expected: 'KnowledgeAuthzModel.v1' });
  if (policy.interface !== 'KnowledgePreauthPolicy.v1') add('POLICY_INTERFACE_INVALID', 'preauthorization-policy.json', { expected: 'KnowledgePreauthPolicy.v1' });
  if (ledger.interface !== 'KnowledgeGrantLedger.v1') add('LEDGER_INTERFACE_INVALID', 'grant-ledger.example.json', { expected: 'KnowledgeGrantLedger.v1' });
  const projectId = registry?.project?.id;
  for (const [name, doc] of [['model', model], ['policy', policy], ['ledger', ledger]]) {
    if (doc.project !== projectId) add('PROJECT_MISMATCH', name, { project: doc.project ?? null, registry: projectId ?? null });
  }
  for (const [name, doc] of [['model', model], ['policy', policy], ['ledger', ledger]]) {
    for (const item of scanForForbiddenValues(doc)) add(item.code, `${name}:${item.key}`, { reason: item.reason });
  }
  const catalogRefs = new Map((Array.isArray(refsDoc?.refs) ? refsDoc.refs : []).map((entry) => [entry.ref, entry]));

  // 四角色隔离：principal/ref 两两不同，且永不与 issuer 重合（U07 结构面）。
  const rolePrincipals = [];
  const roleRefs = [];
  for (const role of ROLES) {
    const entry = model.roles?.[role];
    const at = `authorization-model.json:roles.${role}`;
    if (!entry) { add('ROLE_ISOLATION_VIOLATED', at, { reason: `managed role ${role} is missing` }); continue; }
    rolePrincipals.push(entry.principal);
    roleRefs.push(entry.credentialRef);
    const parsed = parseSecretRef(entry.credentialRef ?? '');
    if (!parsed.ok) add('CROSS_PROJECT_REF', `${at}.credentialRef`, { reason: parsed.error });
    else {
      if (projectId && parsed.project !== projectId) add('CROSS_PROJECT_REF', `${at}.credentialRef`, { project: parsed.project });
      const catalogEntry = catalogRefs.get(entry.credentialRef);
      if (!catalogEntry) add('REF_NOT_IN_CATALOG', `${at}.credentialRef`, { ref: entry.credentialRef });
      else {
        if (catalogEntry.boundRole !== role) add('REF_ROLE_MISMATCH', `${at}.credentialRef`, { boundRole: catalogEntry.boundRole ?? null, expected: role });
        if (!Array.isArray(catalogEntry.allowedPrincipals) || !catalogEntry.allowedPrincipals.includes(entry.principal)) {
          add('REF_PRINCIPAL_MISMATCH', `${at}.principal`, { principal: entry.principal, ref: entry.credentialRef });
        }
      }
    }
  }
  if (new Set(rolePrincipals.filter(Boolean)).size !== ROLES.length || new Set(roleRefs.filter(Boolean)).size !== ROLES.length) {
    add('ROLE_ISOLATION_VIOLATED', 'authorization-model.json:roles', { reason: 'the four managed roles must have pairwise-distinct principals and credential refs' });
  }
  const issuerPrincipals = (model.issuers ?? []).map((issuer) => issuer.principal);
  for (const principal of rolePrincipals) {
    if (issuerPrincipals.includes(principal)) add('ROLE_ISOLATION_VIOLATED', 'authorization-model.json:issuers', { reason: `agent role principal ${principal} must never be an issuer` });
  }
  const sourceIds = new Set((model.sources ?? []).map((source) => source.id));
  const targetIds = new Set((model.targets ?? []).map((target) => target.id));
  for (const [index, issuer] of (model.issuers ?? []).entries()) {
    const at = `authorization-model.json:issuers[${index}]`;
    if (!isMappedPrincipal(issuer.principal)) add('PRINCIPAL_UNMAPPED', `${at}.principal`, { principal: issuer.principal ?? null });
    for (const source of issuer.authority?.sources ?? []) {
      if (!sourceIds.has(source)) add('SOURCE_TARGET_UNREGISTERED', `${at}.authority.sources`, { id: source });
    }
    for (const target of issuer.authority?.targets ?? []) {
      if (!targetIds.has(target)) add('SOURCE_TARGET_UNREGISTERED', `${at}.authority.targets`, { id: target });
    }
  }
  // owner 登记：源 owner 必须是受信 owner registry 登记的 owner；委托必须是 registry
  // 登记过的 delegate——模型不能发明 owner/委托（SOURCE_TARGET_OWNER_GRANT_REQUIRED）。
  const registeredOwner = registry?.project?.owner;
  const registeredDelegates = Array.isArray(registry?.project?.delegates) ? registry.project.delegates : [];
  for (const [index, source] of (model.sources ?? []).entries()) {
    const at = `authorization-model.json:sources[${index}]:${source.id ?? index}`;
    if (source.owner !== registeredOwner) add('OWNER_MISMATCH', `${at}.owner`, { owner: source.owner ?? null, registeredOwner: registeredOwner ?? null });
    for (const delegate of source.delegates ?? []) {
      if (!registeredDelegates.includes(delegate)) add('DELEGATE_UNREGISTERED', `${at}.delegates`, { delegate });
    }
  }
  for (const [index, target] of (model.targets ?? []).entries()) {
    const at = `authorization-model.json:targets[${index}]:${target.id ?? index}`;
    const parsed = parseSecretRef(target.ownerGrantRef ?? '');
    if (!parsed.ok) add('CROSS_PROJECT_REF', `${at}.ownerGrantRef`, { reason: parsed.error });
    else if (projectId && parsed.project !== projectId) add('CROSS_PROJECT_REF', `${at}.ownerGrantRef`, { project: parsed.project });
    else if (!catalogRefs.has(target.ownerGrantRef)) add('REF_NOT_IN_CATALOG', `${at}.ownerGrantRef`, { ref: target.ownerGrantRef });
  }

  // 策略：contract §3 的八类边界 + 交集规则 + 禁改 ACL。
  for (const section of ['subject', 'sources', 'purpose', 'content', 'target', 'actions', 'quality', 'lifecycle', 'audienceRule']) {
    if (!policy[section]) add('POLICY_SECTION_MISSING', `preauthorization-policy.json:${section}`);
  }
  if (policy.sources?.disclosureRule !== 'intersection') add('AUDIENCE_RULE_NOT_INTERSECTION', 'preauthorization-policy.json:sources.disclosureRule');
  if (policy.audienceRule?.unionForbidden !== true) add('AUDIENCE_RULE_NOT_INTERSECTION', 'preauthorization-policy.json:audienceRule.unionForbidden');
  if (policy.target?.aclMutationForbidden !== true || policy.target?.publicShareForbidden !== true
    || policy.target?.pageShareForbidden !== true || policy.target?.subtreeShareForbidden !== true) {
    add('TARGET_SHARING_NOT_RESTRICTED', 'preauthorization-policy.json:target', { reason: 'page/subtree/public sharing and ACL mutation must be forbidden by default' });
  }
  const requiredForbiddenActions = ['acl.change', 'membership.change', 'share.create', 'documents.delete'];
  for (const action of requiredForbiddenActions) {
    if (!Array.isArray(policy.actions?.forbidden) || !policy.actions.forbidden.includes(action)) {
      add('ACTION_FORBIDDEN_SET_INCOMPLETE', 'preauthorization-policy.json:actions.forbidden', { action });
    }
  }
  if (policy.quality?.reviewerMustDifferFromAuthor !== true) add('POLICY_SECTION_MISSING', 'preauthorization-policy.json:quality.reviewerMustDifferFromAuthor');
  for (const issuerId of policy.subject?.issuers ?? []) {
    if (!(model.issuers ?? []).some((issuer) => issuer.id === issuerId)) add('ISSUER_UNREGISTERED', 'preauthorization-policy.json:subject.issuers', { issuer: issuerId });
  }

  // 台账：issuer 注册、owner 登记、有效期 ≤ 上限、撤销记录权威、purpose ⊆ 策略。
  const seenGrantIds = new Set();
  const maxValidityMs = Number(policy.subject?.validity?.maxValidityDays) * 86_400_000;
  for (const [index, grant] of (ledger.grants ?? []).entries()) {
    const at = `grant-ledger.example.json:grants[${index}]:${grant.id ?? index}`;
    if (seenGrantIds.has(grant.id)) add('GRANT_ID_DUPLICATE', at, { grant: grant.id });
    seenGrantIds.add(grant.id);
    if (!(model.issuers ?? []).some((issuer) => issuer.id === grant.issuer)) add('GRANT_ISSUER_UNREGISTERED', at, { issuer: grant.issuer ?? null });
    if (grant.owner !== registeredOwner) add('OWNER_MISMATCH', `${at}.owner`, { owner: grant.owner ?? null, registeredOwner: registeredOwner ?? null });
    if (!sourceIds.has(grant.authority?.source) || !targetIds.has(grant.authority?.target)) {
      add('SOURCE_TARGET_UNREGISTERED', `${at}.authority`, { source: grant.authority?.source ?? null, target: grant.authority?.target ?? null });
    }
    const issuedAt = Date.parse(grant.issuedAt ?? '');
    const expiresAt = Date.parse(grant.expiresAt ?? '');
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt >= expiresAt
      || (Number.isFinite(maxValidityMs) && expiresAt - issuedAt > maxValidityMs)) {
      add('GRANT_VALIDITY_INVALID', at, { issuedAt: grant.issuedAt ?? null, expiresAt: grant.expiresAt ?? null });
    }
    if (grant.revocation) {
      const revokedAt = Date.parse(grant.revocation.revokedAt ?? '');
      const revokedBy = grant.revocation.revokedBy;
      const issuerPrincipal = (model.issuers ?? []).find((issuer) => issuer.id === grant.issuer)?.principal;
      if (!Number.isFinite(revokedAt) || revokedAt < issuedAt) add('GRANT_REVOCATION_INVALID', `${at}.revocation`, { revokedAt: grant.revocation.revokedAt ?? null });
      if (revokedBy !== issuerPrincipal && revokedBy !== model.ownerPrincipal) add('GRANT_REVOCATION_INVALID', `${at}.revocation.revokedBy`, { revokedBy: revokedBy ?? null });
    }
    for (const knowledgeType of grant.purpose?.knowledgeTypes ?? []) {
      if (!Array.isArray(policy.purpose?.knowledgeTypes) || !policy.purpose.knowledgeTypes.includes(knowledgeType)) {
        add('GRANT_PURPOSE_OUTSIDE_POLICY', `${at}.purpose.knowledgeTypes`, { knowledgeType });
      }
    }
    for (const reader of grant.purpose?.disclosureAudience ?? []) {
      if (!isMappedPrincipal(reader)) add('PRINCIPAL_UNMAPPED', `${at}.purpose.disclosureAudience`, { reader });
    }
  }
  return violations;
}

// --- decide ---------------------------------------------------------------------

function validateRequestShape(request) {
  const bad = (detail) => ({ detail });
  if (!request || typeof request !== 'object' || Array.isArray(request)) return bad('request must be a JSON object');
  if (request.schemaVersion !== 1) return bad('request.schemaVersion must be 1');
  if (typeof request.requestedBy !== 'string' || request.requestedBy.length === 0) return bad('requestedBy must be a non-empty string');
  if (typeof request.execution !== 'string' || request.execution.length === 0) return bad('execution must be a non-empty string');
  if (typeof request.payloadDigest !== 'string' || !SHA256_RE.test(request.payloadDigest)) return bad('payloadDigest must be a sha256 hex digest');
  const op = request.operation;
  if (!op || typeof op !== 'object') return bad('operation is required');
  if (typeof op.knowledgeId !== 'string' || op.knowledgeId.length === 0) return bad('operation.knowledgeId is required');
  if (typeof op.knowledgeType !== 'string' || op.knowledgeType.length === 0) return bad('operation.knowledgeType is required');
  if (typeof op.documentId !== 'string' || !UUID_RE.test(op.documentId)) return bad('operation.documentId must be a client UUID');
  if (typeof op.action !== 'string' || op.action.length === 0) return bad('operation.action is required');
  const target = op.target;
  if (!target || typeof target !== 'object') return bad('operation.target is required');
  if (typeof target.collection !== 'string' || target.collection.length === 0) return bad('operation.target.collection is required');
  if (typeof target.audienceSource !== 'string' || target.audienceSource.length === 0) return bad('operation.target.audienceSource is required');
  const audience = target.effectiveAudience;
  if (!audience || typeof audience !== 'object') return bad('operation.target.effectiveAudience is required');
  if (!Array.isArray(audience.readers)) return bad('effectiveAudience.readers must be an array');
  if (typeof audience.incompletePagination !== 'boolean') return bad('effectiveAudience.incompletePagination must be a boolean');
  if (!Array.isArray(audience.unmappedPrincipals)) return bad('effectiveAudience.unmappedPrincipals must be an array');
  if (!Array.isArray(request.sources) || request.sources.length === 0) return bad('sources must be a non-empty array');
  for (const [index, source] of request.sources.entries()) {
    const evidence = source?.permissionEvidence;
    if (typeof source?.domain !== 'string' || source.domain.length === 0) return bad(`sources[${index}].domain is required`);
    if (!evidence || typeof evidence !== 'object') return bad(`sources[${index}].permissionEvidence is required`);
    if (!['COMPLETE', 'INCOMPLETE', 'ERROR'].includes(evidence.status)) return bad(`sources[${index}].permissionEvidence.status must be COMPLETE|INCOMPLETE|ERROR`);
    if (typeof evidence.exportedByServiceAccountOnly !== 'boolean') return bad(`sources[${index}].permissionEvidence.exportedByServiceAccountOnly must be a boolean`);
    if (!Array.isArray(evidence.unmappedPrincipals)) return bad(`sources[${index}].permissionEvidence.unmappedPrincipals must be an array`);
  }
  const review = request.review;
  if (!review || typeof review !== 'object') return bad('review is required');
  if (typeof review.execution !== 'string' || review.execution.length === 0) return bad('review.execution is required');
  if (typeof review.reviewerPrincipal !== 'string' || review.reviewerPrincipal.length === 0) return bad('review.reviewerPrincipal is required');
  if (typeof review.verdict !== 'string' || review.verdict.length === 0) return bad('review.verdict is required');
  if (typeof review.boundPayloadDigest !== 'string' || !SHA256_RE.test(review.boundPayloadDigest)) return bad('review.boundPayloadDigest must be a sha256 hex digest');
  if (!Number.isFinite(Date.parse(review.reviewedAt ?? ''))) return bad('review.reviewedAt must be an ISO timestamp');
  return null;
}

function decidePublication({ request, model, policy, ledger, ledgerDigest, modelDigest, policyDigest, nowMs }) {
  const reasons = [];
  const push = (code, at, extra) => reasons.push({ code, at, ...(extra ?? {}) });
  const op = request.operation;

  // 1) 自批输入类与未知字段：无论后续链多完整，这些字段本身就是拒绝（U01）。
  for (const key of Object.keys(request)) {
    if (FORBIDDEN_REQUEST_FIELDS[key]) push(FORBIDDEN_REQUEST_FIELDS[key], key, { reason: 'this input belongs to the issuer/owner chain, never to the publish request; its mere presence is a refusal' });
    else if (!ALLOWED_REQUEST_FIELDS.has(key)) push('UNKNOWN_REQUEST_FIELD', key, { key });
  }
  // 2) 只有 Publisher 主体能请求正式发布执行（U07 身份面）。
  if (request.requestedBy !== model.roles?.publisher?.principal) push('IDENTITY_NOT_PUBLISHER', 'requestedBy', { requestedBy: request.requestedBy });
  // 3) 内容边界：作者不能自标敏感级降级之外，这里只核对请求未携带分类；分类由签发/审查链负责。
  if (!Array.isArray(policy.purpose?.knowledgeTypes) || !policy.purpose.knowledgeTypes.includes(op.knowledgeType)) {
    push('PURPOSE_NOT_PREAUTHORIZED', 'operation.knowledgeType', { knowledgeType: op.knowledgeType });
  }
  // 4) 动作边界：只允许策略明示的 create/update，永不包含 ACL/分享/删除（U05 动作面）。
  if (!Array.isArray(policy.actions?.allowed) || !policy.actions.allowed.includes(op.action)) {
    push('ACTION_NOT_PREAUTHORIZED', 'operation.action', { action: op.action });
  }
  // 5) 目标登记与受众来源：集合名/ID 在 allowlist 里还不够（U05）。
  const modelTarget = (model.targets ?? []).find((entry) => entry.id === op.target.collection);
  if (!modelTarget) push('TARGET_NOT_PREAUTHORIZED', 'operation.target.collection', { collection: op.target.collection });
  const allowedSources = new Set([...(policy.target?.allowedAudienceSource ?? []), ...(modelTarget?.allowedAudienceSource ?? [])]);
  if (!allowedSources.has(op.target.audienceSource)) {
    push('TARGET_AUDIENCE_ENLARGED', 'operation.target.audienceSource', { audienceSource: op.target.audienceSource, reason: 'inheritance/page-share/subtree-share/public entry outside the preauthorized collection-default audience' });
  }
  // 6) 授权链：每个源域必须在台账中有当前有效的 grant（请求不携带 grant 内容）。
  const grantAudiences = [];
  const usedGrants = [];
  for (const [index, source] of request.sources.entries()) {
    const at = `sources[${index}]:${source.domain}`;
    if (!Array.isArray(policy.sources?.allowlist) || !policy.sources.allowlist.includes(source.domain)) {
      push('SOURCE_NOT_ALLOWLISTED', at, { domain: source.domain });
    }
    const candidates = (ledger.grants ?? []).filter((grant) => grant.authority?.source === source.domain
      && grant.authority?.target === op.target.collection
      && Array.isArray(grant.purpose?.knowledgeTypes) && grant.purpose.knowledgeTypes.includes(op.knowledgeType));
    if (candidates.length === 0) {
      push('GRANT_NOT_FOUND', at, { domain: source.domain, target: op.target.collection });
      continue;
    }
    // 历史/已撤销 grant 从候选中自然退出；只有该域没有任何可用 grant 时才成拒绝，
    // 并如实报告每个候选不可用的原因（过期/撤销/签发问题）。
    const valid = [];
    const invalid = [];
    for (const grant of candidates) {
      const check = checkGrant(grant, { model, nowMs });
      if (check.ok) valid.push(grant);
      else invalid.push({ grant, code: check.code });
    }
    if (valid.length === 0) {
      for (const { grant, code } of invalid) push(code, `${at}:${grant.id}`, { grant: grant.id });
      continue;
    }
    for (const grant of valid) {
      usedGrants.push(grant.id);
      grantAudiences.push(Array.isArray(grant.purpose?.disclosureAudience) ? grant.purpose.disclosureAudience : []);
    }
    // 7) 源权限证据：未知绝不是空集/公开；服务账号可读不等于可再发布（U06）。
    const evidence = source.permissionEvidence;
    if (evidence.status === 'INCOMPLETE') push('PERMISSION_EVIDENCE_INCOMPLETE', `${at}.permissionEvidence`, { reason: 'incomplete permission pagination is fail-closed, never an empty set' });
    if (evidence.status === 'ERROR') push('PERMISSION_EVIDENCE_ERROR', `${at}.permissionEvidence`, { error: evidence.error ?? null });
    if (evidence.status === 'COMPLETE' && evidence.exportedByServiceAccountOnly === true) {
      push('SERVICE_ACCOUNT_READ_NOT_REPUBLICATION', `${at}.permissionEvidence`, { reason: 'a service account being able to read never proves republication consent' });
    }
    if (evidence.unmappedPrincipals.length > 0) push('PRINCIPAL_UNMAPPED', `${at}.permissionEvidence.unmappedPrincipals`, { unmapped: evidence.unmappedPrincipals });
  }
  // 8) 目标有效受众：映射完整 + 交集规则（多源取交集，不取并集；空交集 fail-closed）。
  const targetAudience = op.target.effectiveAudience;
  if (targetAudience.incompletePagination) push('TARGET_EVIDENCE_INCOMPLETE', 'operation.target.effectiveAudience', { reason: 'incomplete target audience pagination is fail-closed' });
  if (targetAudience.unmappedPrincipals.length > 0) push('PRINCIPAL_UNMAPPED', 'operation.target.effectiveAudience.unmappedPrincipals', { unmapped: targetAudience.unmappedPrincipals });
  const unmappedReaders = targetAudience.readers.filter((reader) => !isMappedPrincipal(reader));
  if (unmappedReaders.length > 0) push('PRINCIPAL_UNMAPPED', 'operation.target.effectiveAudience.readers', { unmapped: unmappedReaders });
  const policyAudience = Array.isArray(policy.target?.allowedAudience?.readers) ? policy.target.allowedAudience.readers : [];
  let allowed = [...policyAudience];
  for (const audience of grantAudiences) allowed = allowed.filter((reader) => audience.includes(reader));
  const outside = targetAudience.readers.filter((reader) => !allowed.includes(reader));
  if (outside.length > 0) {
    push('AUDIENCE_OUTSIDE_INTERSECTION', 'operation.target.effectiveAudience.readers', {
      outside,
      allowedIntersection: allowed,
      rule: 'effectiveAudience ⊆ preauthAllowedAudience ∩ ⋂ sources.allowedDisclosureAudience; empty intersection is fail-closed',
    });
  }
  // 9) 独立审查绑定：reviewer 注册且与作者/请求者分离、payload 摘要一致、真实时钟下的新鲜度（U04/U07）。
  const review = request.review;
  const expectedReviewer = policy.quality?.reviewerPrincipal;
  if (review.reviewerPrincipal !== expectedReviewer) push('REVIEWER_UNREGISTERED', 'review.reviewerPrincipal', { reviewer: review.reviewerPrincipal, expected: expectedReviewer ?? null });
  if (review.reviewerPrincipal === model.roles?.author?.principal || review.reviewerPrincipal === request.requestedBy) {
    push('SELF_REVIEW_FORBIDDEN', 'review.reviewerPrincipal', { reviewer: review.reviewerPrincipal });
  }
  if (review.boundPayloadDigest !== request.payloadDigest) push('REVIEW_PAYLOAD_STALE', 'review.boundPayloadDigest', { bound: review.boundPayloadDigest, current: request.payloadDigest });
  const reviewedAt = Date.parse(review.reviewedAt);
  if (reviewedAt - nowMs > 60_000) push('REVIEW_TIMESTAMP_INVALID', 'review.reviewedAt', { reviewedAt: review.reviewedAt, reason: 'review time cannot be in the future' });
  else {
    const freshnessMs = Number(policy.quality?.reviewFreshnessHours) * 3_600_000;
    if (Number.isFinite(freshnessMs) && nowMs - reviewedAt > freshnessMs) push('REVIEW_EXPIRED', 'review.reviewedAt', { reviewedAt: review.reviewedAt });
  }
  if (review.verdict !== 'pass') push('REVIEW_NOT_PASSED', 'review.verdict', { verdict: review.verdict });

  if (reasons.length > 0) {
    return { verdict: 'deny', reasons };
  }
  // 正向回执：绑定当前内容版本、授权版本、受众交集与三工件摘要；读回义务在列；
  // 只覆盖本对象本版本（U08），不自动续期。
  const receipt = {
    schemaVersion: 1,
    interface: 'KnowledgePublishDecision.v1',
    operation: op,
    payloadDigest: request.payloadDigest,
    grants: [...new Set(usedGrants)].sort(),
    audience: {
      rule: 'intersection',
      allowed,
      effective: targetAudience.readers,
      sources: Object.fromEntries(request.sources.map((source) => [source.domain, grantAudiences[request.sources.indexOf(source)] ?? []])),
    },
    bindings: {
      policyDigest,
      ledgerDigest,
      modelDigest,
      reviewExecution: review.execution,
    },
    decidedAt: new Date(nowMs).toISOString(),
    execution: request.execution,
    readback: { required: true, status: 'PENDING' },
    limits: {
      scope: 'this operation, this object version and this audience only; no extension to other objects or future versions',
      autoRenewal: false,
    },
    provenance: {
      permissionEvidence: 'LOCAL_ONLY: operator-declared permission evidence for the structural decision proof; live source/target permission readback is UNVERIFIED in this environment (successor: Outline owner + deployment verification wave)',
      issuance: 'ledger entries only; live issuance requires the protected workflow (issuanceCredential UNREGISTERED in the I01 catalog)',
    },
  };
  const decisionId = sha256Text(stableStringify(receipt));
  return { verdict: 'allow', reasons: [], decision: { ...receipt, decisionId, verdict: 'allow', reasons: [] } };
}

// --- recheck --------------------------------------------------------------------

const RECEIPT_FIELDS = ['schemaVersion', 'interface', 'operation', 'payloadDigest', 'grants', 'audience', 'bindings', 'decidedAt', 'execution', 'readback', 'limits', 'provenance'];

function recheckDecision({ decision, model, policy, ledger, ledgerDigest, modelDigest, policyDigest, payloadDigest, nowMs }) {
  const reasons = [];
  const push = (code, at, extra) => reasons.push({ code, at, ...(extra ?? {}) });
  if (!decision || typeof decision !== 'object' || decision.interface !== 'KnowledgePublishDecision.v1') {
    return { ok: false, reasons: [{ code: 'DECISION_MALFORMED', at: 'decision', reason: 'not a KnowledgePublishDecision.v1 receipt' }] };
  }
  const content = {};
  for (const field of RECEIPT_FIELDS) {
    if (!(field in decision)) return { ok: false, reasons: [{ code: 'DECISION_MALFORMED', at: `decision.${field}`, reason: 'receipt field missing' }] };
    content[field] = decision[field];
  }
  // 完整性：decisionId 覆盖全部回执字段——任何篡改（包括改 decidedAt/verdict）都失效（U03）。
  const recomputed = sha256Text(stableStringify(content));
  if (recomputed !== decision.decisionId) {
    push('TAMPERED_DECISION', 'decisionId', { expected: decision.decisionId ?? null, recomputed });
  }
  // 地面真值漂移：三工件摘要 + 逐 grant 按真实时钟重验。
  if (content.bindings?.ledgerDigest !== ledgerDigest) push('LEDGER_CHANGED', 'bindings.ledgerDigest', { recorded: content.bindings?.ledgerDigest ?? null, current: ledgerDigest });
  if (content.bindings?.modelDigest !== modelDigest) push('MODEL_CHANGED', 'bindings.modelDigest', { recorded: content.bindings?.modelDigest ?? null, current: modelDigest });
  if (content.bindings?.policyDigest !== policyDigest) push('POLICY_CHANGED', 'bindings.policyDigest', { recorded: content.bindings?.policyDigest ?? null, current: policyDigest });
  for (const grantId of Array.isArray(content.grants) ? content.grants : []) {
    const grant = (ledger.grants ?? []).find((entry) => entry.id === grantId);
    const check = grant ? checkGrant(grant, { model, nowMs }) : { code: 'GRANT_NOT_FOUND' };
    if (!check.ok) push('GRANT_NO_LONGER_VALID', `grants:${grantId}`, { grant: grantId, underlyingCode: check.code });
  }
  if (payloadDigest !== undefined && payloadDigest !== content.payloadDigest) {
    push('PAYLOAD_DRIFTED', 'payload-digest', { decided: content.payloadDigest, presented: payloadDigest });
  }
  return { ok: reasons.length === 0, reasons };
}

// --- commands --------------------------------------------------------------------

function loadWorld(opts, { withPolicy = false, withRegistry = false, withRefs = false } = {}) {
  const loaded = {};
  const modelFile = opts.model ?? DEFAULT_MODEL;
  const ledgerFile = opts.ledger ?? DEFAULT_LEDGER;
  const model = loadJson(modelFile, 'model');
  if (model.error) return { error: model.error };
  const ledger = loadJson(ledgerFile, 'ledger');
  if (ledger.error) return { error: ledger.error };
  loaded.model = model.value;
  loaded.ledger = ledger.value;
  loaded.modelFile = modelFile;
  loaded.ledgerFile = ledgerFile;
  if (withPolicy) {
    const policy = loadJson(opts.policy ?? DEFAULT_POLICY, 'policy');
    if (policy.error) return { error: policy.error };
    loaded.policy = policy.value;
    loaded.policyFile = opts.policy ?? DEFAULT_POLICY;
  }
  if (withRegistry) {
    const registry = loadJson(opts.registry ?? DEFAULT_REGISTRY, 'registry');
    if (registry.error) return { error: registry.error };
    loaded.registry = registry.value;
  }
  if (withRefs) {
    const refs = loadJson(opts.refs ?? DEFAULT_REFS, 'refs catalog');
    if (refs.error) return { error: refs.error };
    loaded.refsDoc = refs.value;
  }
  return loaded;
}

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  const nowMs = Date.now();

  if (command === 'validate') {
    const world = loadWorld(opts, { withPolicy: true, withRegistry: true, withRefs: true });
    if (world.error) return failInput(world.error);
    const violations = validateArtifacts({ model: world.model, policy: world.policy, ledger: world.ledger, refsDoc: world.refsDoc, registry: world.registry });
    print({
      interface: 'KnowledgeAuthz.v1',
      command,
      model: displayPath(opts.model ?? DEFAULT_MODEL),
      policy: displayPath(opts.policy ?? DEFAULT_POLICY),
      ledger: displayPath(opts.ledger ?? DEFAULT_LEDGER),
      ok: violations.length === 0,
      violations,
    });
    return violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'resolve') {
    const refsDoc = loadJson(opts.refs ?? DEFAULT_REFS, 'refs catalog');
    if (refsDoc.error) return failInput(refsDoc.error);
    const project = typeof refsDoc.value?.project === 'string' ? refsDoc.value.project : undefined;
    try {
      const result = resolveSecretRef({ ref: opts.ref, principalId: opts.as, role: opts.role, refsDoc: refsDoc.value, project });
      print({ interface: 'KnowledgeAuthz.v1', command, ok: true, ...result });
      return EXIT_PASS;
    } catch (err) {
      const code = err.code ?? 'RESOLVE_DENIED';
      print({ interface: 'KnowledgeAuthz.v1', command, ok: false, code, reason: redactHostPaths(err.message) });
      return code === 'MALFORMED_REF' ? EXIT_INPUT : EXIT_VERIFY;
    }
  }

  if (command === 'verify-grant') {
    const world = loadWorld(opts);
    if (world.error) return failInput(world.error);
    const grant = (world.ledger.grants ?? []).find((entry) => entry.id === opts.grant);
    if (!grant) {
      print({ interface: 'KnowledgeAuthz.v1', command, grant: opts.grant, ok: false, code: 'GRANT_NOT_FOUND' });
      return EXIT_VERIFY;
    }
    const check = checkGrant(grant, { model: world.model, nowMs });
    if (!check.ok) {
      print({ interface: 'KnowledgeAuthz.v1', command, grant: opts.grant, ok: false, code: check.code });
      return EXIT_VERIFY;
    }
    print({ interface: 'KnowledgeAuthz.v1', command, grant: opts.grant, ok: true, issuer: grant.issuer, validUntil: grant.expiresAt });
    return EXIT_PASS;
  }

  if (command === 'revoke') {
    const world = loadWorld(opts);
    if (world.error) return failInput(world.error);
    const grant = (world.ledger.grants ?? []).find((entry) => entry.id === opts.grant);
    if (!grant) {
      print({ interface: 'KnowledgeAuthz.v1', command, grant: opts.grant, revoked: false, code: 'GRANT_NOT_FOUND' });
      return EXIT_VERIFY;
    }
    if (grant.revocation) {
      print({ interface: 'KnowledgeAuthz.v1', command, grant: opts.grant, revoked: false, code: 'GRANT_ALREADY_REVOKED', revokedAt: grant.revocation.revokedAt });
      return EXIT_VERIFY;
    }
    const issuerPrincipal = (world.model.issuers ?? []).find((issuer) => issuer.id === grant.issuer)?.principal;
    if (opts.as !== issuerPrincipal && opts.as !== world.model.ownerPrincipal) {
      print({ interface: 'KnowledgeAuthz.v1', command, grant: opts.grant, revoked: false, code: 'REVOKE_NOT_AUTHORIZED', as: opts.as, reason: 'only the issuing authority or the registered owner may revoke; agents hold no management power' });
      return EXIT_VERIFY;
    }
    grant.revocation = { revokedAt: new Date(nowMs).toISOString(), revokedBy: opts.as, reason: opts.reason };
    const tmp = `${world.ledgerFile}.tmp-${process.pid}-${nowMs}`;
    fs.writeFileSync(tmp, `${JSON.stringify(world.ledger, null, 2)}\n`);
    fs.renameSync(tmp, world.ledgerFile);
    print({ interface: 'KnowledgeAuthz.v1', command, grant: opts.grant, revoked: true, revokedAt: grant.revocation.revokedAt, revokedBy: opts.as, ledger: displayPath(world.ledgerFile) });
    return EXIT_PASS;
  }

  if (command === 'decide') {
    const world = loadWorld(opts, { withPolicy: true });
    if (world.error) return failInput(world.error);
    const request = loadJson(opts.request, 'publish request');
    if (request.error) return failInput(request.error);
    const shapeError = validateRequestShape(request.value);
    if (shapeError) return failInput(`malformed publish request: ${shapeError.detail}`);
    const outcome = decidePublication({
      request: request.value,
      model: world.model,
      policy: world.policy,
      ledger: world.ledger,
      ledgerDigest: sha256File(world.ledgerFile),
      modelDigest: sha256File(world.modelFile),
      policyDigest: sha256File(world.policyFile),
      nowMs,
    });
    if (outcome.verdict === 'deny') {
      print({ interface: 'KnowledgeAuthz.v1', command, verdict: 'deny', reasons: outcome.reasons });
      return EXIT_VERIFY;
    }
    print({ interface: 'KnowledgeAuthz.v1', command, ...outcome.decision });
    return EXIT_PASS;
  }

  if (command === 'recheck') {
    const world = loadWorld(opts, { withPolicy: true });
    if (world.error) return failInput(world.error);
    const decision = loadJson(opts.decision, 'decision receipt');
    if (decision.error) return failInput(decision.error);
    const outcome = recheckDecision({
      decision: decision.value,
      model: world.model,
      policy: world.policy,
      ledger: world.ledger,
      ledgerDigest: sha256File(world.ledgerFile),
      modelDigest: sha256File(world.modelFile),
      policyDigest: sha256File(world.policyFile),
      payloadDigest: opts['payload-digest'],
      nowMs,
    });
    print({ interface: 'KnowledgeAuthz.v1', command, ok: outcome.ok, decisionId: decision.value?.decisionId ?? null, reasons: outcome.reasons });
    return outcome.ok ? EXIT_PASS : EXIT_VERIFY;
  }

  return failInput(`unknown command: ${command}`);
}

process.exit(await main(process.argv.slice(2)));
