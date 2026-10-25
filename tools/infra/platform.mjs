#!/usr/bin/env node
// PlatformInfra.v1 / IntegrationIdentity.v1 / Environment.v1 CLI — validate | probe
//
// I06 只做只读核验（没有 up 子命令）：登记读回 Git/CI/Registry/隔离环境身份与权限，
// 绝不隐式写远端平台策略。平台 writer 归既有 P 任务与 Comet closeout 授权，真实 P4_1/P4_2 门保留。
//
// Historical TLS/authentication failures are retained as history only. Current
// operator/repository/check/artifact observations are read back afresh; no read
// permission or local declaration authorizes remote policy, delivery or rollback writes.
//
// 退出码契约（execution-contract.json V_INFRA_I06.cli_contract）：
//   0 = PASS（validate 通过 / 本地链路贯通 VERIFIED / 读回成功）
//   1 = 输入或前置无效（平台登记文件缺失/不可解析、chain fixture 缺失/不可解析、SHA/digest 格式错误、参数错误）
//   2 = 验证失败（语义违规、授权门拒绝、集成身份链阻断、UNVERIFIED）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 转 PASS。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, resolveSecretRef, scanForForbiddenValues, validateRefsCatalog, redactSecretValue, validateQualificationPolicy } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_PLATFORM_DIR = path.join(repoRoot, 'infra', 'delivery', 'platform');
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const PLATFORM_FILES = [
  'repository-registration.json',
  'ci-policy.json',
  'registry-registration.example.json',
  'environment-registration.example.json',
  'artifact-retention.json',
];
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const BLOCKING_SEMANTICS_REQUIRED = ['MISSING', 'SKIPPED', 'TIMED_OUT', 'STALE_EVIDENCE'];

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|Volumes|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

function usage() {
  return [
    'usage:',
    '  platform.mjs validate --registry <file> [--refs <file>] [--platform-dir <dir>] [--json]',
    '  platform.mjs probe --case repository-identity --read-only [--registry <file>] [--platform-dir <dir>] [--json]',
    '  platform.mjs probe --case required-checks-authorization [--registry <file>] [--refs <file>] [--principal <id>] [--platform-dir <dir>] [--json]',
    '  platform.mjs probe --case registry-environment-identity [--chain <file>] [--platform-dir <dir>] [--json]',
    '  platform.mjs probe --case platform-observation --read-only [--candidate-sha <40hex>] [--json]',
    '  platform.mjs probe --case artifact-readback|environment-readback --read-only --candidate-sha <40hex> --artifact-digest sha256:<64hex> --operation-id <id> [--json]',
    '  platform.mjs qualify --read-only --candidate-sha <40hex> --artifact-digest sha256:<64hex> --operation-id <id> [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };const command=argv[0];
  const booleans=new Set(['json','read-only']);
  const strings=new Set(['registry','refs','platform-dir','case','principal','chain','candidate-sha','operation-id','artifact-digest']);
  const seen=new Set();
  for(let i=1;i<argv.length;i++) {
    const arg=argv[i];
    if(!arg.startsWith('--'))return {command,opts,error:'unexpected positional argument'};
    const key=arg.slice(2);if(!booleans.has(key)&&!strings.has(key))return {command,opts,error:'unknown option'};
    if(seen.has(key))return {command,opts,error:'duplicate option'};seen.add(key);
    if(booleans.has(key)){opts[key]=true;continue;}
    const value=argv[++i];if(!value||value.startsWith('--'))return {command,opts,error:'missing option value'};opts[key]=value;
  }
  return {command,opts};
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, (key,value)=>typeof value==='string'?redactHostPaths(redactSecretValue(key==='ref'&&!parseSecretRef(value).ok?'<invalid-ref>':value)):value, 2) + '\n');
}

function failInput(message) {
  process.stderr.write(`${message}\n${usage()}\n`);
  return EXIT_INPUT;
}

// 门禁必须 fail-closed：平台登记文件缺失/不可解析 = 前置无效，绝不静默降级为空规则。
function loadPlatformDocs(platformDir) {
  const docs = {};
  for (const name of PLATFORM_FILES) {
    const file = path.join(platformDir, name);
    try {
      docs[name] = readJson(file);
    } catch (error) {
      return {error:'platform input unreadable: '+name};
    }
  }
  return { docs };
}

function checkRefs(refs, refsDoc, violations, catalogGaps, at) {
  for (const ref of refs ?? []) {
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) {
      violations.push({ code: parsed.code, at, ref, reason: parsed.error });
      continue;
    }
    if (parsed.project !== 'sdd-harness-pilot') {
      violations.push({ code: 'CROSS_PROJECT_REF', at, ref, project: parsed.project });
      continue;
    }
    const registered = (refsDoc?.refs ?? []).some((item) => item.ref === ref);
    if (!registered) catalogGaps.add(ref);
  }
}

// I01 caller convergence（ROUND2）：validate 与 repository-identity probe 消费同一个身份核。
// 五个字段先验形状（repoId/principalId 必须是正安全整数；repoFullname/url/owner 必须是非空字符串），
// 再做精确相等——两侧同缺/同空白/同类型漂移不算同源：两个 undefined 相等不是身份，等值绝不放行缺席。
const isPositiveSafeInteger = (value) => Number.isSafeInteger(value) && value > 0;
const isNonBlankString = (value) => typeof value === 'string' && value.trim().length > 0;
const IDENTITY_FIELDS = [
  { field: 'repoId', valid: isPositiveSafeInteger },
  { field: 'principalId', valid: isPositiveSafeInteger },
  { field: 'repoFullname', valid: isNonBlankString },
  { field: 'url', valid: isNonBlankString },
  { field: 'owner', valid: isNonBlankString },
];

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim() !== '';
const flag = (v) => typeof v === 'boolean';
const integer = (v) => Number.isSafeInteger(v) && v > 0;
const exact = (expected) => (v) => v === expected;
const choice = (...values) => (v) => values.includes(v);
const label = (v) => text(v) && /^[a-z0-9][a-z0-9-]*$/.test(v);
const iso = (v) => text(v) && Number.isFinite(Date.parse(v));
const githubIdentityShape = {repoId:integer,principalId:integer,repoFullname:text,url:text,owner:text};
const projectShape = {id:label};
const historicalReadbackShape={status:text,'command?':text,'error?':text,'ghAuthStatus?':text,'observedAt?':iso,'note?':text};
const readbackShape = {...historicalReadbackShape,status:choice('VERIFIED','UNVERIFIED'),'scope?':text,'evidenceRef?':text,'history?':[historicalReadbackShape]};
const booleanRules = (...keys) => Object.fromEntries(keys.map((key)=>[key,flag]));
// Closed, versioned consumer shapes. Unknown fields cannot become unreviewed policy.
function shape(value, schema, at, out) {
  const bad = (expected) => out.push({code:'INPUT_SCHEMA_INVALID',at,expected});
  if (typeof schema === 'function') {if (!schema(value)) bad('valid declared field type/value');return;}
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) {bad('array');return;}
    if (value.every((v)=>typeof v!=='object') && new Set(value).size!==value.length) out.push({code:'DUPLICATE_INPUT',at});
    for (const [i,item] of value.entries()) shape(item,schema[0],`${at}[${i}]`,out);
    return;
  }
  if (!object(value)) {bad('object');return;}
  const allowed=new Set(Object.keys(schema).map((key)=>key.replace(/\?$/,'')));
  for (const key of Object.keys(value)) if (!allowed.has(key)) out.push({code:'UNKNOWN_FIELD',at:`${at}.<unknown-field>`});
  for (const [declared,spec] of Object.entries(schema)) {
    const key=declared.replace(/\?$/,'');
    if (!Object.hasOwn(value,key) && declared.endsWith('?')) continue;
    shape(value[key],spec,`${at}.${key}`,out);
  }
}
const platformHeader = (kind,iface='PlatformInfra.v1') => ({schemaVersion:exact(1),interface:exact(iface),kind:exact(kind),project:projectShape,localOnly:flag});
const platformShapes = {
  'repository-registration.json':{...platformHeader('repository-registration'),
    repository:{...githubIdentityShape,sameOriginRef:text,'sameOriginNote?':text},
    identity:{readback:readbackShape,permissions:{status:text,'previousAdminObservation?':text}},
    branchProtection:{configuredStatus:text,requiredChecksSource:text,'evidenceRule?':text},
    credentialRefs:[text],remotePolicyWrites:{allowed:flag,mode:exact('LOCAL_ONLY'),basis:text},
    'readOnly?':{apiOrigin:exact('https://api.github.com'),branch:text,pageSize:integer,maxPages:integer,timeoutMs:integer,operatorObservationOnly:exact(true)}},
  'ci-policy.json':{...platformHeader('ci-policy'),mode:exact('LOCAL_ONLY'),provider:{status:text,'kind?':choice('github-actions'),'note?':text},
    requiredChecks:{registrationStatus:choice('UNSELECTED','REGISTERED'),names:[text],binding:{mode:exact('exact-sha'),description:text},blockingSemantics:[text],failClosed:flag,'evidenceRule?':text},
    authorization:{remotePolicyWriteAuthorized:flag,writerOwner:text,basis:text},credentialRefs:[text]},
  'registry-registration.example.json':{...platformHeader('registry-registration'),example:flag,
    registry:{endpoint:text,kind:text,'repository?':text,'transport?':choice('https','http-local-test'),'note?':text,credentialRef:text,readerCredentialRef:text,pushIdentity:booleanRules('digestPinnedRequired','floatingTagsForbidden'),signing:{mechanism:text,status:text},provenance:{mechanism:text,status:text}},
    artifactIdentity:{digestFormat:text,tagBinding:text,buildBinding:text}},
  'environment-registration.example.json':{...platformHeader('environment-registration','Environment.v1'),example:flag,
    environment:{id:text,endpoint:text,owner:text,'note?':text,networkIsolation:{status:text,crossProjectIsolation:text},deployCredentialRef:text,
      rollback:{credentialRef:text,...booleanRules('approvalRequired','sameDigestRequired','retainLastApprovedArtifact','independentBusinessTerminalStateRequired')},
      readbackOracle:{kind:exact('independent-business-readback'),correlationIdRequired:flag,onTimeout:text,status:text,
        'expectedBusinessTerminalState?':text,'transport?':choice('https','http-local-test')}}},
  'artifact-retention.json':{...platformHeader('artifact-retention'),
    retention:{rpo:text,rto:text,retentionPeriod:text,encryptionOwner:text,destructionPrecondition:text,autoCleanupEnabled:flag,'note?':text},
    manifest:booleanRules('preserveExactSourceAndPolicyAndArtifactManifest','preserveProtectedCheckHistory'),
    rollbackRetention:{...booleanRules('retainLastApprovedArtifact','sameDigestRollbackRequired','oldEvidenceNeverAuthorizesNewSha','revocationCheckOnRestore'),'note?':text}},
};
function refsAdmission(refsDoc, expectedProject) {
  const violations=validateRefsCatalog(refsDoc,expectedProject);
  shape(refsDoc,{schemaVersion:exact(1),interface:exact('SecretRef.v1'),project:label,'note?':text,
    refs:[{ref:text,purpose:text,boundRole:label,allowedPrincipals:[text],'status?':text,
      'configuredSourceMetadata?':{kind:text,fileRef:text,fieldNames:[text],fieldPresenceObserved:flag,scope:text,observedAt:iso,'configurationContext?':text}}]},'refs',violations);
  if (expectedProject && refsDoc?.project!==expectedProject) violations.push({code:'PROJECT_MISMATCH',at:'refs.project'});
  return violations;
}
function contextAdmission({docs,registry,refsDoc}) {
  const violations=refsAdmission(refsDoc,registry?.project?.id);
  shape(registry,{schemaVersion:exact(1),interface:exact('Registry.v1'),project:{id:label,displayName:text,owner:text,delegates:[text],github:githubIdentityShape,
    authority:{readbackStatus:choice('VERIFIED','UNVERIFIED'),readbackCommand:text,'readbackError?':text,observedAt:iso,'note?':text,'recordScope?':text,
      'latestIdentityObservation?':{status:text,observedAt:iso,repoId:integer,repoFullname:text,principalId:integer,login:text,scope:text,evidenceRef:text}}},
    resources:[object]},'registry',violations);
  for (const [name,spec] of Object.entries(platformShapes)) shape(docs[name],spec,name,violations);
  const ids=new Set();for(const resource of Array.isArray(registry?.resources)?registry.resources:[]) {
    if (!object(resource)) continue;
    shape(resource,{id:label,kind:label,owner:text,purpose:text,credentialRef:text,lockRef:text,domain:object,retention:object,'backupOwner?':text,'audience?':text,'registrationRef?':text,'runtimeRequirement?':{node:text,source:text},'image?':{reference:text,digest:(v)=>DIGEST_RE.test(v??'')},'observation?':object},'registry.resource',violations);

    if (!label(resource.id) || ids.has(resource.id)) violations.push({code:'DUPLICATE_OR_INVALID_RESOURCE',at:'registry.resources.id'});ids.add(resource.id);
    if (text(resource.credentialRef)) {const parsed=parseSecretRef(resource.credentialRef);if(!parsed.ok||parsed.project!==registry?.project?.id)violations.push({code:'CROSS_PROJECT_REF',at:'registry.resources.credentialRef'});}
  }
  const identity=checkRepositoryIdentity({registration:docs['repository-registration.json']?.repository,registryGithub:registry?.project?.github});
  if(!identity.sameOrigin) violations.push({code:'IDENTITY_NOT_SAME_ORIGIN',at:'repository-registration.json',fields:identity.mismatches});
  return {violations,identity};
}

function checkRepositoryIdentity({ registration, registryGithub }) {
  const mismatches = IDENTITY_FIELDS
    .filter(({ field, valid }) => !valid(registration?.[field]) || !valid(registryGithub?.[field]) || registration[field] !== registryGithub[field])
    .map(({ field }) => field);
  return { sameOrigin: mismatches.length === 0, mismatches };
}

function validatePlatform({ docs, registry, refsDoc }) {
  const violations = [];
  const catalogGaps = new Set();
  const repo = docs['repository-registration.json'];
  const ci = docs['ci-policy.json'];
  const registryExample = docs['registry-registration.example.json'];
  const environment = docs['environment-registration.example.json'];
  const retention = docs['artifact-retention.json'];

  if (repo.interface !== 'PlatformInfra.v1' || ci.interface !== 'PlatformInfra.v1' || registryExample.interface !== 'PlatformInfra.v1' || retention.interface !== 'PlatformInfra.v1') {
    violations.push({ code: 'PLATFORM_INTERFACE_INVALID', reason: 'platform files must carry interface PlatformInfra.v1' });
  }
  if (environment.interface !== 'Environment.v1') {
    violations.push({ code: 'ENVIRONMENT_INTERFACE_INVALID', reason: 'environment registration must carry interface Environment.v1' });
  }
  for (const [name, doc] of Object.entries(docs)) {
    if (doc.project?.id !== registry?.project?.id) {
      violations.push({ code: 'PROJECT_MISMATCH', at: name, project: doc.project?.id ?? null, registry: registry?.project?.id ?? null });
    }
  }

  const git=registry?.project?.github;
  if(git&&(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(git.repoFullname??'')||git.owner!==git.repoFullname.split('/')[0]||git.url!=='https://github.com/'+git.repoFullname))violations.push({code:'REPOSITORY_TARGET_INVALID',at:'registry.project.github'});
  const ro=repo.readOnly;
  if(ro&&(!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,200}$/.test(ro.branch)||ro.branch.split('/').includes('..')||ro.pageSize>100||ro.maxPages>10||ro.timeoutMs<100||ro.timeoutMs>30000))violations.push({code:'READ_ONLY_LIMITS_INVALID',at:'repository-registration.json.readOnly'});
  const regTarget=registryExample.registry;
  if(!registryExample.example&&(!admittedEndpoint(regTarget.endpoint,regTarget.transport==='http-local-test')||!text(regTarget.repository)||!regTarget.repository.split('/').every((part)=>/^[a-z0-9][a-z0-9._-]*$/.test(part)&&!['.','..'].includes(part))))violations.push({code:'REGISTRY_ENDPOINT_INVALID',at:'registry-registration.example.json'});
  if(!environment.example&&!admittedEndpoint(environment.environment.endpoint,environment.environment.readbackOracle.transport==='http-local-test'))violations.push({code:'ENVIRONMENT_ENDPOINT_INVALID',at:'environment-registration.example.json'});

  // repository-registration：身份与 I01 registry 同源；读回诚实；保护声称必须有平台证据。
  // 同源 = 五个身份字段逐一相等（repoId/repoFullname/url/principalId/owner），且两侧都必须在场有效——
  // 缺值/空白/类型漂移也算失配；ID 相同但 fullname/url 漂移到另一仓库同样是身份劫持面（I01 caller convergence）。
  // 与 repository-identity probe 共用 checkRepositoryIdentity：validate 拒绝的身份漂移，probe 也绝不放行。
  const github = registry?.project?.github ?? {};
  const identity = checkRepositoryIdentity({ registration: repo.repository, registryGithub: github });
  if (!identity.sameOrigin) {
    violations.push({
      code: 'IDENTITY_NOT_SAME_ORIGIN',
      at: 'repository-registration.json',
      fields: identity.mismatches,
      reason: 'repository identity (repoId/repoFullname/url/principalId/owner) must match infra/delivery/registry.json#project.github exactly; every field must be present and valid on both sides — equal-but-missing/blank/invalid-typed values are not same-origin',
    });
  }
  if (!repo.repository?.sameOriginRef) {
    violations.push({ code: 'SAME_ORIGIN_REF_MISSING', at: 'repository-registration.json' });
  }
  const readbackStatus = repo.identity?.readback?.status;
  if (readbackStatus !== 'UNVERIFIED' && readbackStatus !== 'VERIFIED') {
    violations.push({ code: 'IDENTITY_READBACK_STATUS_INVALID', at: 'repository-registration.json', status: readbackStatus ?? null });
  }
  const configuredStatus = repo.branchProtection?.configuredStatus;
  if (configuredStatus !== 'UNVERIFIED' && configuredStatus !== 'NOT_CONFIGURED') {
    violations.push({ code: 'PLATFORM_PROTECTION_CLAIM_FORBIDDEN', at: 'repository-registration.json', configuredStatus, reason: 'only UNVERIFIED/NOT_CONFIGURED or an evidenced platform readback may appear; claims of configured protection are forbidden' });
  }
  if (repo.remotePolicyWrites?.allowed === true) {
    violations.push({ code: 'REMOTE_POLICY_WRITE_FORBIDDEN', at: 'repository-registration.json', reason: 'no remote policy write authorization exists for this run' });
  }
  if (repo.localOnly !== true) violations.push({ code: 'LOCAL_ONLY_REQUIRED', at: 'repository-registration.json' });

  // ci-policy：required-checks 契约结构；名称未登记时禁止出现任何名称；阻断语义齐全且 fail-closed。
  const requiredChecks = ci.requiredChecks ?? {};
  if ((requiredChecks.names ?? []).length > 0 && requiredChecks.registrationStatus !== 'REGISTERED') {
    violations.push({ code: 'REQUIRED_CHECK_NAMES_UNREGISTERED', at: 'ci-policy.json', names: requiredChecks.names, reason: 'required-check names are an admin-registered input; names without REGISTERED status are fabricated' });
  }
  const semantics = requiredChecks.blockingSemantics ?? [];
  const missing = BLOCKING_SEMANTICS_REQUIRED.filter((code) => !semantics.includes(code));
  if (missing.length > 0 || requiredChecks.failClosed !== true) {
    violations.push({ code: 'BLOCKING_SEMANTICS_INCOMPLETE', at: 'ci-policy.json', missing, failClosed: requiredChecks.failClosed ?? null });
  }
  if (ci.authorization?.remotePolicyWriteAuthorized === true) {
    violations.push({ code: 'REMOTE_POLICY_WRITE_FORBIDDEN', at: 'ci-policy.json', reason: 'no remote policy write authorization exists for this run' });
  }
  if (ci.mode !== 'LOCAL_ONLY') violations.push({ code: 'LOCAL_ONLY_REQUIRED', at: 'ci-policy.json' });

  // example 文件必须自我声明为 example；Environment.v1 的回滚/readback 门必须 fail-closed。
  for (const [name, doc] of [['registry-registration.example.json', registryExample], ['environment-registration.example.json', environment]]) {
    if(typeof doc.example!=='boolean')violations.push({code:'EXAMPLE_DECLARATION_REQUIRED',at:name});
    if(doc.example===false&&(name.startsWith('registry')?[doc.registry?.endpoint,doc.registry?.kind,doc.registry?.repository].some((v)=>!text(v)||v==='UNSELECTED'):[doc.environment?.id,doc.environment?.endpoint,doc.environment?.owner,doc.environment?.readbackOracle?.expectedBusinessTerminalState].some((v)=>!text(v)||v==='UNSELECTED')))violations.push({code:'EXAMPLE_DECLARATION_REQUIRED',at:name},{code:'LIVE_REGISTRATION_INCOMPLETE',at:name});
  }
  const rollback = environment.environment?.rollback ?? {};
  if (rollback.approvalRequired !== true) violations.push({ code: 'ROLLBACK_APPROVAL_REQUIRED', at: 'environment-registration.example.json' });
  if (rollback.sameDigestRequired !== true) violations.push({ code: 'ROLLBACK_SAME_DIGEST_REQUIRED', at: 'environment-registration.example.json' });
  if (rollback.independentBusinessTerminalStateRequired !== true) {
    violations.push({ code: 'ROLLBACK_TERMINAL_STATE_REQUIRED', at: 'environment-registration.example.json' });
  }
  const oracle = environment.environment?.readbackOracle ?? {};
  if (oracle.correlationIdRequired !== true) violations.push({ code: 'READBACK_ORACLE_CORRELATION_REQUIRED', at: 'environment-registration.example.json' });

  // registry example：digest 钉住与浮动 tag 禁令。
  const pushIdentity = registryExample.registry?.pushIdentity ?? {};
  if (pushIdentity.digestPinnedRequired !== true || pushIdentity.floatingTagsForbidden !== true) {
    violations.push({ code: 'REGISTRY_IDENTITY_RULES_REQUIRED', at: 'registry-registration.example.json', pushIdentity });
  }

  // artifact-retention：未确认值 fail-closed；恢复后旧证据不放行新 SHA；撤销后重验。
  const retentionFields = retention.retention ?? {};
  for (const field of ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner', 'destructionPrecondition']) {
    if (retentionFields[field] === undefined) violations.push({ code: 'RETENTION_FIELD_MISSING', at: 'artifact-retention.json', field });
  }
  const unconfirmed = ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner'].filter(
    (key) => !retentionFields[key] || retentionFields[key] === 'UNVERIFIED',
  );
  if (retentionFields.autoCleanupEnabled === true && unconfirmed.length > 0) {
    violations.push({ code: 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY', at: 'artifact-retention.json', unconfirmed });
  }
  const rollbackRetention = retention.rollbackRetention ?? {};
  if (rollbackRetention.retainLastApprovedArtifact !== true) violations.push({ code: 'RETENTION_LAST_APPROVED_REQUIRED', at: 'artifact-retention.json' });
  if (rollbackRetention.sameDigestRollbackRequired !== true) violations.push({ code: 'ROLLBACK_SAME_DIGEST_REQUIRED', at: 'artifact-retention.json' });
  if (rollbackRetention.oldEvidenceNeverAuthorizesNewSha !== true) {
    violations.push({ code: 'RETENTION_STALE_EVIDENCE_RULE_REQUIRED', at: 'artifact-retention.json' });
  }
  if (rollbackRetention.revocationCheckOnRestore !== true) {
    violations.push({ code: 'RETENTION_REVOCATION_RECHECK_REQUIRED', at: 'artifact-retention.json' });
  }

  // credentialRefs：格式 + 项目命名空间；目录成员缺口如实上报（I01 所有，镜像 outline/code-knowledge 先例）。
  checkRefs(repo.credentialRefs, refsDoc, violations, catalogGaps, 'repository-registration.json');
  checkRefs(ci.credentialRefs, refsDoc, violations, catalogGaps, 'ci-policy.json');
  checkRefs(
    [registryExample.registry?.credentialRef, registryExample.registry?.readerCredentialRef].filter(Boolean),
    refsDoc,
    violations,
    catalogGaps,
    'registry-registration.example.json',
  );
  checkRefs(
    [environment.environment?.deployCredentialRef, environment.environment?.rollback?.credentialRef].filter(Boolean),
    refsDoc,
    violations,
    catalogGaps,
    'environment-registration.example.json',
  );

  for (const [name, doc] of Object.entries(docs)) {
    for (const finding of scanForForbiddenValues(doc)) {
      violations.push({ code: finding.code, at: name, key: finding.key, reason: finding.reason });
    }
  }

  const summary = {
    repository: {
      readbackStatus,
      branchProtection: { configuredStatus },
      remotePolicyWritesAllowed: repo.remotePolicyWrites?.allowed === true,
    },
    ci: {
      providerStatus: ci.provider?.status ?? null,
      requiredChecks: {
        registrationStatus: requiredChecks.registrationStatus ?? null,
        names: requiredChecks.names ?? [],
        blockingSemantics: semantics,
        failClosed: requiredChecks.failClosed === true,
      },
    },
    registryExample: {
      endpoint: registryExample.registry?.endpoint ?? null,
      signingStatus: registryExample.registry?.signing?.status ?? null,
      provenanceStatus: registryExample.registry?.provenance?.status ?? null,
    },
    environmentExample: {
      id: environment.environment?.id ?? null,
      rollback: {
        approvalRequired: rollback.approvalRequired === true,
        sameDigestRequired: rollback.sameDigestRequired === true,
        independentBusinessTerminalStateRequired: rollback.independentBusinessTerminalStateRequired === true,
      },
      readbackOracle: { correlationIdRequired: oracle.correlationIdRequired === true },
    },
    retention: {
      autoCleanupEnabled: retentionFields.autoCleanupEnabled === true,
      unconfirmedFields: unconfirmed,
    },
  };
  return { violations, catalogGaps: [...catalogGaps].sort(), summary };
}

// IntegrationIdentity.v1：PR head -> mergeSHA -> build artifact digest -> 部署身份 -> readback/回滚。
// 纯本地评估（LOCAL_ONLY）：只证明本地机制；真实平台拒绝合并/环境读回仍归 P4_1/P4_2。
function evaluateIntegrationIdentity(chain, expectedProject) {
  const codes = [];
  const steps = [];
  let blocked = false;
  let unverified = false;
  const block = (code) => {
    codes.push(code);
    blocked = true;
  };

  if(chain.project!==expectedProject)block('CHAIN_PROJECT_MISMATCH');
  const checkKeys=(chain.checks??[]).map((check)=>check.name+'@'+check.boundSha);
  if(new Set(checkKeys).size!==checkKeys.length)block('AMBIGUOUS_CHECK_EVIDENCE');

  // required checks：证据必须精确绑定当前 merge SHA；缺项/skip/超时/旧证据四类全部阻断。
  for (const name of chain.requiredChecks ?? []) {
    const evidences = (chain.checks ?? []).filter((check) => check.name === name);
    if (evidences.length === 0) {
      block('CHECK_MISSING');
      continue;
    }
    const bound = evidences.find((check) => check.boundSha === chain.merge);
    if (!bound) {
      block('CHECK_STALE_EVIDENCE');
      continue;
    }
    if (bound.timedOut === true || bound.conclusion === 'timed_out') block('CHECK_TIMED_OUT');
    else if (bound.conclusion === 'skipped') block('CHECK_SKIPPED');
    else if (bound.conclusion !== 'success') block('CHECK_NOT_SUCCESS');
  }
  steps.push({ step: 'checks', binding: 'EXACT_SHA', verdict: blocked ? 'BLOCKED' : 'PASS' });

  // artifact：digest 必须构建自 merge SHA；tag 必须解析到同一 digest（tag 改指不同 digest 即阻断）。
  if (chain.artifact?.builtFromMerge !== chain.merge) block('ARTIFACT_NOT_FROM_MERGE');
  if (chain.artifact?.tagResolvedDigest !== chain.artifact?.digest) block('TAG_DIGEST_DRIFT');
  steps.push({ step: 'artifact', binding: 'TAG_TO_DIGEST', verdict: blocked ? 'BLOCKED' : 'PASS' });

  // 部署身份：环境归属本项目；digest 贯通；receipt 必须带原关联 ID。
  if (chain.deployment?.project !== chain.project) block('ENVIRONMENT_PROJECT_MISMATCH');
  if (chain.deployment?.artifactDigest !== chain.artifact?.digest) block('DEPLOYMENT_DIGEST_MISMATCH');
  if (!chain.deployment?.receipt?.correlationId) block('RECEIPT_CORRELATION_MISSING');
  steps.push({ step: 'deployment', binding: 'DIGEST_AND_CORRELATION_ID', verdict: blocked ? 'BLOCKED' : 'PASS' });

  // readback：响应丢失按原关联 ID 查询；确认需要独立业务终态。
  const receipt = chain.deployment?.receipt;
  const readback = chain.readback ?? {};
  let via = 'RECEIPT_DIRECT';
  if(readback.correlationId && readback.correlationId!==receipt?.correlationId)block('READBACK_CORRELATION_MISMATCH');
  if (receipt?.responseLost === true) {
    via = 'QUERY_BY_CORRELATION_ID';
    if (readback.correlationId !== receipt.correlationId) {
      block('READBACK_CORRELATION_MISMATCH');
    } else if (!readback.observed?.businessTerminalState) {
      codes.push('READBACK_UNCONFIRMED');
      unverified = true;
    }
  } else if (!readback.observed?.businessTerminalState) {
    codes.push('READBACK_UNCONFIRMED');
    unverified = true;
  }
  steps.push({ step: 'readback', via, verdict: blocked ? 'BLOCKED' : unverified ? 'UNVERIFIED' : 'PASS' });

  // 回滚门：未批准拒绝；已批准必须同 digest（保留上一已批准制品）且有独立业务终态。
  const rollback = chain.rollback ?? {};
  if (rollback.requested === true) {
    if (rollback.approved !== true) {
      block('ROLLBACK_NOT_APPROVED');
    } else if (!rollback.previousApprovedDigest) {
      block('ROLLBACK_RETENTION_MISSING');
    } else if (rollback.digest !== rollback.previousApprovedDigest) {
      block('ROLLBACK_DIGEST_MISMATCH');
    } else if (!rollback.observed?.businessTerminalState) {
      codes.push('ROLLBACK_TERMINAL_STATE_UNCONFIRMED');
      unverified = true;
    }
    steps.push({ step: 'rollback', verdict: blocked ? 'BLOCKED' : unverified ? 'UNVERIFIED' : 'PASS' });
  }

  const status = blocked ? 'BLOCKED' : unverified ? 'UNVERIFIED' : 'VERIFIED';
  return { blocked, unverified, status, codes, steps };
}

// chain fixture 输入校验：格式错误是输入问题（exit 1），与语义阻断（exit 2）严格区分。
function validateChainInput(chain) {
  if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return 'chain must be a JSON object';
  const issues=[];
  const digest=(v)=>typeof v==='string'&&DIGEST_RE.test(v);
  const sha=(v)=>typeof v==='string'&&SHA_RE.test(v);
  const business=(v)=>text(v)||object(v)&&v.schemaVersion===1&&v.interface==='BusinessTerminalState.v1'&&text(v.environment)&&digest(v.serving)&&integer(v.revision)&&iso(v.observedAt);
  const observed={'businessTerminalState?':business,'environment?':text};
  shape(chain,{'schemaVersion?':exact(1),'interface?':exact('IntegrationIdentity.v1'),project:label,head:sha,merge:sha,requiredChecks:[text],checks:[{name:text,boundSha:sha,conclusion:text,'timedOut?':flag}],
    artifact:{'tag?':text,digest,tagResolvedDigest:digest,builtFromMerge:sha,'files?':integer,'expectedDigest?':digest},
    deployment:{project:label,'environmentId?':text,artifactDigest:digest,'receipt?':{'correlationId?':text,'status?':text,'responseLost?':flag}},
    'readback?':{'correlationId?':text,'observed?':observed},
    'rollback?':{requested:flag,'approved?':flag,'previousApprovedDigest?':(v)=>v===null||digest(v),'digest?':digest,'approvedBy?':text,'observed?':observed},
    'gate?':object},'chain',issues);
  if(issues.length)return issues[0].code+' at '+issues[0].at;
  if (!SHA_RE.test(chain.head ?? '')) return 'head must be a 40-hex SHA';
  if (!SHA_RE.test(chain.merge ?? '')) return 'merge must be a 40-hex SHA';
  if (!Array.isArray(chain.requiredChecks) || chain.requiredChecks.length === 0 || chain.requiredChecks.some((name) => typeof name !== 'string')) {
    return 'requiredChecks must be a non-empty array of names';
  }
  if (!Array.isArray(chain.checks)) return 'checks must be an array';
  for (const check of chain.checks) {
    if (typeof check?.name !== 'string' || !SHA_RE.test(check?.boundSha ?? '') || typeof check?.conclusion !== 'string') {
      return 'each check needs a name, a 40-hex boundSha and a string conclusion';
    }
  }
  const artifact = chain.artifact ?? {};
  if (!DIGEST_RE.test(artifact.digest ?? '') || !DIGEST_RE.test(artifact.tagResolvedDigest ?? '')) return 'artifact digest/tagResolvedDigest must be sha256:<64 hex>';
  if (!SHA_RE.test(artifact.builtFromMerge ?? '')) return 'artifact.builtFromMerge must be a 40-hex SHA';
  const deployment = chain.deployment ?? {};
  if (!DIGEST_RE.test(deployment.artifactDigest ?? '')) return 'deployment.artifactDigest must be sha256:<64 hex>';
  if (typeof chain.project !== 'string' || typeof deployment.project !== 'string') return 'project and deployment.project are required strings';
  return null;
}

function probeRepositoryIdentity({ docs, registryFile }) {
  const repo = docs['repository-registration.json'];
  const registry = readJson(registryFile);
  const github = registry?.project?.github ?? {};
  // 与 validate 同一个身份核（checkRepositoryIdentity）：登记侧五字段与 registry 源全部在场且相等，
  // 否则预检拒绝——绝不带着本地漂移去打真实平台，也绝不把未发生的网络尝试标成 executed:true。
  const identity = checkRepositoryIdentity({ registration: repo.repository, registryGithub: github });
  if (!identity.sameOrigin) {
    print({
      interface: 'PlatformInfra.v1',
      case: 'repository-identity',
      readOnly: true,
      executed: false,
      mode: 'LOCAL_ONLY',
      localConsistency: 'FAIL',
      code: 'IDENTITY_NOT_SAME_ORIGIN',
      fields: identity.mismatches,
      reason: 'repository registration diverges from infra/delivery/registry.json#project.github (all five identity fields must be present, valid and equal); no platform call is made while local bindings disagree',
    });
    return EXIT_VERIFY;
  }

  // 真实只读尝试（一次；目标是 registry 登记源的 repoFullname；失败原样保留错误文本，宿主路径脱敏）。
  const command = `gh api repos/${github.repoFullname}`;
  const run = spawnSync('gh', ['api', `repos/${github.repoFullname}`], { encoding: 'utf8', timeout: 15_000 });
  // 诚实执行报告：spawn 失败（error 且 pid===0，例如 gh 缺失/不可执行）从未启动子进程，绝不能声称 executed；
  // 超时被杀（error ETIMEDOUT 但 pid>0）子进程确实启动过，仍算已尝试执行。
  const childLaunched = !run.error || run.pid > 0;
  const base = {
    interface: 'PlatformInfra.v1',
    case: 'repository-identity',
    readOnly: true,
    executed: childLaunched,
    mode: 'LOCAL_ONLY',
    localConsistency: 'PASS',
  };
  if (run.status === 0) {
    try {
      const observed = JSON.parse(run.stdout);
      // 形状 fail-closed：必须是仓库对象（非 null/非数组），id 为正整数且 full_name 非空；
      // 不可解读的形状 = UNVERIFIED，绝不当成 MISMATCH、更绝不当成 VERIFIED。
      const shapeOk = observed !== null
        && typeof observed === 'object'
        && !Array.isArray(observed)
        && isPositiveSafeInteger(observed.id)
        && isNonBlankString(observed.full_name);
      if (!shapeOk) {
        print({
          ...base,
          readback: { status: 'UNVERIFIED', command, error: 'gh output was not a repository object with an integer id and a non-empty full_name' },
        });
        return EXIT_VERIFY;
      }
      // id 与 full_name 都必须等于登记源（registry#project.github）；只有 id 相同不足以 VERIFIED
      // （同 id 换名 / 同名换库都是身份劫持面）。
      const matches = observed.id === github.repoId && observed.full_name === github.repoFullname;
      print({
        ...base,
        readback: {
          status: matches ? 'VERIFIED' : 'MISMATCH',
          command,
          observed: {repoId:observed.id===github.repoId?observed.id:undefined,fullName:matches?observed.full_name:undefined,identityMatches:matches},
          expected: { repoId: github.repoId, repoFullname: github.repoFullname },
        },
      });
      return matches ? EXIT_PASS : EXIT_VERIFY;
    } catch {
      print({
        ...base,
        readback: { status: 'UNVERIFIED', command, error: redactHostPaths('gh output was not JSON') },
      });
      return EXIT_VERIFY;
    }
  }
  // 失败路径 fail-closed：spawnSync 失败时 stderr/stdout 可为 null/undefined，先兜底再 trim——
  // 崩溃（exit 1 无 JSON）绝不冒充结构化 UNVERIFIED。有传输输出时仍原样保留首行（宿主路径脱敏）；
  // 无输出则诊断点名 spawn 失败原因（run.error.code），起不来的 gh 永远是 UNVERIFIED，绝不 VERIFIED。
  const stderrText = typeof run.stderr === 'string' ? run.stderr.trim() : '';
  const stdoutText = typeof run.stdout === 'string' ? run.stdout.trim() : '';
  const fallback = run.error ? `gh did not complete (${run.error.code ?? 'SPAWN_ERROR'})` : `gh exited ${run.status}`;
  const rawError = (stderrText || stdoutText || fallback).split('\n')[0];
  print({
    ...base,
    readback: { status: 'UNVERIFIED', command, error: /x509|certificate|tls/i.test(rawError)?'TLS x509 read failure':run.error?'client unavailable ('+(run.error.code??'SPAWN_ERROR')+')':'upstream repository read failed' },
  });
  return EXIT_VERIFY;
}

function probeRequiredChecksAuthorization({ docs, refsDoc, opts }) {
  const ci = docs['ci-policy.json'];
  const repo = docs['repository-registration.json'];
  const principal = opts.principal ?? 'dev:sdd-harness-pilot/developer';
  const request = {
    action: 'configure-required-checks',
    repo: repo.repository?.repoFullname ?? null,
    checks: ci.requiredChecks?.names ?? [],
    principalId: principal,
  };
  // 授权门：管理员身份不等于本次批准修改分支保护；拒绝依据是本次运行的计划授权，不是身份。
  if (ci.authorization?.remotePolicyWriteAuthorized !== true) {
    const credentialTiers = platformCredentialTiers({ docs, refsDoc, principal });
    print({
      interface: 'PlatformInfra.v1',
      case: 'required-checks-authorization',
      executed: true,
      mode: 'LOCAL_ONLY',
      refused: true,
      code: 'REMOTE_POLICY_WRITE_NOT_AUTHORIZED',
      basis: ci.authorization?.basis ?? 'admin identity is not this run approval to modify branch protection',
      request,
      credentialTiers,
    });
    return EXIT_VERIFY;
  }
  // 文件声称已授权也必须拒绝：validate 会另行报 REMOTE_POLICY_WRITE_FORBIDDEN（结构门），本任务自身无平台 writer。
  const credentialTiers = platformCredentialTiers({ docs, refsDoc, principal });
  print({
    interface: 'PlatformInfra.v1',
    case: 'required-checks-authorization',
    executed: true,
    mode: 'LOCAL_ONLY',
    refused: true,
    code: 'NO_PLATFORM_WRITER_THIS_TASK',
    basis: 'this task holds no platform writer authorization even when a file claims otherwise; validate reports the structural violation separately',
    request,
    credentialTiers,
  });
  return EXIT_VERIFY;
}

// 六个 secret-ref 的凭据 tier 报告：逐条显式拒绝或 UNRESOLVED，绝不产出值（I01 SecretRef.v1 语义）。
function platformCredentialTiers({ docs, refsDoc, principal }) {
  const declared = [
    ...new Set(
      [
        docs['repository-registration.json'].credentialRefs ?? [],
        docs['ci-policy.json'].credentialRefs ?? [],
        docs['registry-registration.example.json'].registry?.credentialRef,
        docs['registry-registration.example.json'].registry?.readerCredentialRef,
        docs['environment-registration.example.json'].environment?.deployCredentialRef,
        docs['environment-registration.example.json'].environment?.rollback?.credentialRef,
      ]
        .filter(Boolean)
        .flat(),
    ),
  ];
  return declared.map((ref) => {
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) return { ref, outcome: `REFUSED_${parsed.code}`, resolution: false };
    if (parsed.project !== 'sdd-harness-pilot') return { ref, outcome: 'REFUSED_CROSS_PROJECT_REF', resolution: false };
    const entry = (refsDoc?.refs ?? []).find((item) => item.ref === ref);
    if (!entry) return { ref, registered: false, outcome: 'REFUSED_REF_NOT_REGISTERED', resolution: false };
    try {
      const result = resolveSecretRef({ ref, principalId: principal, role: entry.boundRole, refsDoc, project: parsed.project });
      return { ref, registered: true, boundRole: entry.boundRole ?? null, outcome: result.status, resolution: false };
    } catch (error) {
      return { ref, registered: true, boundRole: entry.boundRole ?? null, outcome: `REFUSED_${error.code ?? 'DENIED'}`, resolution: false };
    }
  });
}

function probeRegistryEnvironmentIdentity({ docs, chainFile }) {
  const repo = docs['repository-registration.json'];
  // 生产晋级与本地机制如实分离（P4_2 回执语义）：链路 VERIFIED 只是 LOCAL_ONLY 机制证明，
  // 真实生产交付始终 UNVERIFIED 且 holder 在案（P4_2 隔离环境属主 + 运行时准入；真实合并门归 P4_1）。
  const productionPromotion = {
    status: 'UNVERIFIED',
    holder: 'P4_2 isolated-environment owner + runtime admission; the real merge gate stays with P4_1',
  };
  if (!chainFile) {
    // 无真实 Registry/环境证据：结构化 UNVERIFIED（列出所需输入与计划步骤），绝不 skip、绝不 mock。
    print({
      interface: 'IntegrationIdentity.v1',
      case: 'registry-environment-identity',
      executed: false,
      status: 'UNVERIFIED',
      scope: 'LOCAL_ONLY',
      mode: 'LOCAL_ONLY',
      productionPromotion,
      reason: 'no dedicated registry/artifact store and no isolated target environment are registered; the chain can only be evaluated from a local --chain fixture',
      requiredInputs: [
        'registry endpoint + signing/provenance readback (registry-registration is an example; endpoint UNSELECTED)',
        'an integration candidate: PR head SHA, merge SHA and required-check evidence bound to the exact merge SHA',
        'a build artifact digest built from the merge SHA, with the tag resolving to that digest',
        'a target deployment receipt carrying the original correlation ID',
        'an isolated environment endpoint with an independent business readback oracle and an approval-gated rollback path',
      ],
      plannedSteps: [
        'bind required checks to the exact integration merge SHA (missing/skipped/timed-out/stale evidence block promotion)',
        'resolve the artifact tag to an immutable digest and verify it was built from the merge SHA',
        'match the deployment identity digest to the artifact digest',
        'confirm deployment via the original correlation ID when the response is lost',
        'refuse unapproved rollbacks; require same digest plus an independent business terminal state for approved ones',
      ],
    });
    return EXIT_VERIFY;
  }

  let chain;
  try {
    chain = readJson(chainFile);
  } catch (error) {
    return failInput('chain input unreadable');
  }
  const inputError = validateChainInput(chain);
  if (inputError) return failInput(`invalid chain fixture: ${inputError}`);
  const verdict = evaluateIntegrationIdentity(chain,repo.project.id);
  print({
    interface: 'IntegrationIdentity.v1',
    case: 'registry-environment-identity',
    executed: true,
    scope: 'LOCAL_ONLY',
    mode: 'LOCAL_ONLY',
    productionPromotion,
    project: chain.project,
    head: chain.head,
    merge: chain.merge,
    blocked: verdict.blocked,
    status: verdict.status,
    codes: verdict.codes,
    steps: verdict.steps,
    note: 'local mechanism proof only; the real platform merge gate and environment readback stay with P4_1/P4_2',
  });
  return verdict.blocked || verdict.status !== 'VERIFIED' ? EXIT_VERIFY : EXIT_PASS;
}

// Read-only platform observation. Routes are built from the admitted registration,
// never from response URLs, caller URLs, credential locators or other projects.
function safeDiagnostic(run) {
  if(run.error?.code==='ETIMEDOUT')return 'TIMEOUT';
  if(run.error)return 'CLIENT_UNAVAILABLE';
  const line=String(run.stderr??'');return /x509|certificate|tls/i.test(line)?'TLS_X509_ERROR':'UPSTREAM_READ_FAILED';
}
function githubClient(context, candidate) {
  const registration=context.docs['repository-registration.json'];const cfg=registration.readOnly;
  const expected=context.registry.project.github;const base=`repos/${expected.repoFullname}`;const branch=encodeURIComponent(cfg.branch);
  const approved=new Set(['user',base,`${base}/branches/${branch}`,`${base}/branches/${branch}/protection`,`${base}/rulesets`,`${base}/actions/workflows`,`${base}/actions/runs`,`${base}/actions/artifacts`,`${base}/deployments`]);
  if(candidate)for(const suffix of ['', '/check-runs','/status','/pulls'])approved.add(`${base}/commits/${candidate}${suffix}`);
  const requests=[];
  const read=(route)=>{
    if(!approved.has(route.split('?')[0]))return {ok:false,code:'ROUTE_NOT_REGISTERED'};
    const startedAt=new Date().toISOString();
    const child=spawnSync('gh',['api','--hostname','github.com','--method','GET','--include','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28',route],{encoding:'utf8',timeout:cfg.timeoutMs,maxBuffer:2*1024*1024});
    const raw=String(child.stdout??'');const boundary=raw.search(/\r?\n\r?\n/);const headers=boundary<0?'':raw.slice(0,boundary);
    const body=boundary<0?'':raw.slice(boundary).replace(/^\r?\n\r?\n/,'');
    const status=Number(headers.match(/^HTTP\/\S+\s+(\d{3})/m)?.[1]??0);
    const record={method:'GET',route,startedAt,endedAt:new Date().toISOString(),executed:!!child.pid,httpStatus:status||null,complete:false};requests.push(record);
    if(child.error||child.status!==0||status<200||status>=300){record.code=status?'HTTP_READ_UNVERIFIED':safeDiagnostic(child);return {ok:false,code:record.code,status};}
    let data;try{data=JSON.parse(body);}catch{record.code='RESPONSE_SHAPE_UNVERIFIED';return {ok:false,code:record.code,status};}
    record.complete=true;
    return {ok:true,data,status,link:headers.split(/\r?\n/).find((line)=>/^link:/i.test(line))?.slice(5).trim()??''};
  };
  const pages=(route,key,project)=>{
    const items=[];const seen=new Set();let expectedTotal;
    for(let page=1;page<=cfg.maxPages;page++){
      const withQuery=route+(route.includes('?')?'&':'?')+`per_page=${cfg.pageSize}&page=${page}`;const response=read(withQuery);
      if(!response.ok)return {status:'UNVERIFIED',complete:false,code:response.code,observedItems:items.length,items};
      const raw=key?response.data?.[key]:response.data;
      if(!Array.isArray(raw))return {status:'UNVERIFIED',complete:false,code:'COLLECTION_SHAPE_UNVERIFIED',items};
      if(key){const total=response.data?.total_count;if(!Number.isSafeInteger(total)||total<0||(expectedTotal!==undefined&&total!==expectedTotal))return {status:'UNVERIFIED',complete:false,code:'COLLECTION_TOTAL_UNVERIFIED',items};expectedTotal=total;}
      for(const row of raw){const item=project(row);if(!item||!integer(item.id)||seen.has(item.id))return {status:'UNVERIFIED',complete:false,code:'ITEM_IDENTITY_UNVERIFIED',items};seen.add(item.id);items.push(item);}
      const next=response.link.match(/<([^>]+)>;\s*rel="next"/);
      if(next){let url;try{url=new URL(next[1]);}catch{return {status:'UNVERIFIED',complete:false,code:'PAGINATION_UNVERIFIED',items};}
        const current=new URL('https://api.github.com/'+withQuery);current.searchParams.set('page',String(page+1));
        if(url.origin!==current.origin||url.pathname!==current.pathname||url.searchParams.get('page')!==String(page+1)||url.searchParams.get('per_page')!==String(cfg.pageSize))return {status:'UNVERIFIED',complete:false,code:'PAGINATION_SCOPE_MISMATCH',items};
        for(const [key,value] of current.searchParams)if(url.searchParams.get(key)!==value)return {status:'UNVERIFIED',complete:false,code:'PAGINATION_SCOPE_MISMATCH',items};
        if([...url.searchParams].length!==[...current.searchParams].length)return {status:'UNVERIFIED',complete:false,code:'PAGINATION_SCOPE_MISMATCH',items};
        continue;
      }
      if(expectedTotal!==undefined&&items.length!==expectedTotal||expectedTotal===undefined&&raw.length>=cfg.pageSize)return {status:'UNVERIFIED',complete:false,code:'PAGINATION_INCOMPLETE',items};
      return {status:'OBSERVED',complete:true,observedItems:items.length,items};
    }
    return {status:'UNVERIFIED',complete:false,code:'PAGE_LIMIT',items};
  };
  return {read,pages,requests,base,branch};
}
function observePlatform(context,opts) {
  const cfg=context.docs['repository-registration.json'].readOnly;
  if(!cfg)return {status:'UNVERIFIED',executed:false,code:'READ_ONLY_RESOURCE_NOT_REGISTERED'};
  const candidate=opts['candidate-sha'];const api=githubClient(context,candidate);const expected=context.registry.project.github;
  const operator=api.read('user');
  if(!operator.ok||operator.data?.id!==expected.principalId||operator.data?.login!==expected.owner)return {status:'UNVERIFIED',code:'OPERATOR_IDENTITY_UNVERIFIED',requests:api.requests};
  const repo=api.read(api.base);
  if(!repo.ok||repo.data?.id!==expected.repoId||repo.data?.full_name!==expected.repoFullname||repo.data?.owner?.id!==expected.principalId||repo.data?.owner?.login!==expected.owner)return {status:'UNVERIFIED',code:'REPOSITORY_IDENTITY_UNVERIFIED',requests:api.requests};
  const branch=api.read(`${api.base}/branches/${api.branch}`);
  const branchObservation=branch.ok&&branch.data?.name===cfg.branch&&SHA_RE.test(branch.data?.commit?.sha??'')&&typeof branch.data?.protected==='boolean'
    ?{status:'OBSERVED',branch:cfg.branch,sha:branch.data.commit.sha,protected:branch.data.protected}:{status:'UNVERIFIED'};
  const protection=api.read(`${api.base}/branches/${api.branch}/protection`);
  const protectionObservation=protection.ok&&object(protection.data)?{status:'OBSERVED',requiredChecks:Array.isArray(protection.data.required_status_checks?.contexts)?protection.data.required_status_checks.contexts.filter(text):[],enforceAdmins:protection.data.enforce_admins?.enabled===true}:{status:'UNVERIFIED',httpStatus:protection.status??null};
  const rulesets=api.pages(`${api.base}/rulesets`,null,(r)=>integer(r?.id)&&text(r?.enforcement)?{id:r.id,enforcement:r.enforcement}:null);
  const workflows=api.pages(`${api.base}/actions/workflows`,'workflows',(r)=>integer(r?.id)&&text(r?.name)&&text(r?.path)&&text(r?.state)?{id:r.id,name:r.name,path:r.path,state:r.state}:null);
  const sha=candidate??branchObservation.sha;
  const result={status:'OBSERVED',scope:'OPERATOR_READ_ONLY_METADATA',executed:true,operator:{id:expected.principalId,login:expected.owner},repository:{id:expected.repoId,fullName:expected.repoFullname},branch:branchObservation,protection:protectionObservation,rulesets,workflows,requests:api.requests,runtimeAuthority:{status:'UNVERIFIED',valuesRead:false,reason:'Operator readability does not attest the CI/source/control runtime actor or grant writer authority.'}};
  if(!sha){result.status='OBSERVED_WITH_GAPS';result.candidate={status:'UNVERIFIED'};return result;}
  // A default branch SHA is admitted only after its repository-bound response.
  const selected=candidate?api:githubClient(context,sha);if(!candidate)result.requests.push(...selected.requests);
  const commit=selected.read(`${selected.base}/commits/${sha}`);
  result.candidate=commit.ok&&commit.data?.sha===sha?{status:'OBSERVED',sha}:{status:'UNVERIFIED',sha,code:'CANDIDATE_READBACK_UNVERIFIED'};
  if(result.candidate.status!=='OBSERVED'){result.status='OBSERVED_WITH_GAPS';if(selected!==api)result.requests.push(...selected.requests);return result;}
  const checkProject=(r)=>integer(r?.id)&&text(r?.name)&&r.head_sha===sha&&text(r?.status)&&(r.conclusion===null||text(r.conclusion))?{id:r.id,name:r.name,sha:r.head_sha,status:r.status,conclusion:r.conclusion,appId:integer(r.app?.id)?r.app.id:null}:null;
  result.checks=selected.pages(`${selected.base}/commits/${sha}/check-runs`,'check_runs',checkProject);
  // Join complete repository inventories by IDs. A shared SHA/name/app never
  // supplies a missing workflow, run, or source-repository identity.
  const workflowById=new Map(workflows.complete?workflows.items.map((item)=>[item.id,item]):[]);
  const sameRepository=(item)=>item?.id===expected.repoId&&(item.full_name===undefined||item.full_name===expected.repoFullname);
  result.runs=selected.pages(`${selected.base}/actions/runs?head_sha=${sha}`,'workflow_runs',(r)=>{
    const workflow=workflowById.get(r?.workflow_id);
    if(!integer(r?.id)||r.head_sha!==sha||!sameRepository(r.repository)||!sameRepository(r.head_repository)||!workflow||!text(r.path)||!(r.path===workflow.path||r.path.startsWith(workflow.path+'@')&&r.path.length>workflow.path.length+1)||!text(r.status)||!(r.conclusion===null||text(r.conclusion)))return null;
    return {id:r.id,sha:r.head_sha,repositoryId:r.repository.id,sourceRepositoryId:r.head_repository.id,status:r.status,conclusion:r.conclusion,workflowId:workflow.id,workflowPath:workflow.path};
  });
  const candidateRuns=new Map(result.runs.complete?result.runs.items.map((item)=>[item.id,item]):[]);
  result.artifacts=selected.pages(`${selected.base}/actions/artifacts`,'artifacts',(r)=>{
    const producer=r?.workflow_run;
    if(!integer(r?.id)||!text(r.name)||typeof r.expired!=='boolean'||!integer(producer?.id)||producer.repository_id!==expected.repoId||producer.head_repository_id!==expected.repoId||!SHA_RE.test(producer.head_sha??''))return null;
    const run=candidateRuns.get(producer.id);const matchesCandidate=producer.head_sha===sha;
    if(run&&(producer.head_sha!==run.sha||producer.repository_id!==run.repositoryId||producer.head_repository_id!==run.sourceRepositoryId)||matchesCandidate&&!run)return null;
    return {id:r.id,name:r.name,expired:r.expired,workflowRunId:producer.id,workflowId:run?.workflowId??null,sha:producer.head_sha,digest:DIGEST_RE.test(r.digest??'')?r.digest:null,mediaType:'github-actions-artifact-zip',matchesCandidate};
  });
  // GitHub deployment metadata has no independently attested producing run,
  // artifact bytes or original Comet operation; it is never a business terminal.
  const environmentRegistration=context.docs['environment-registration.example.json'];
  result.deployments=selected.pages(`${selected.base}/deployments?sha=${sha}`,null,(r)=>integer(r?.id)&&r.sha===sha&&text(r.environment)?{id:r.id,sha:r.sha,registeredEnvironment:environmentRegistration.example===false&&environmentRegistration.environment.id!=='UNSELECTED'&&r.environment===environmentRegistration.environment.id,productionCorrelation:'UNVERIFIED'}:null);
  result.requiredChecks={registrationStatus:context.docs['ci-policy.json'].requiredChecks.registrationStatus,names:context.docs['ci-policy.json'].requiredChecks.names,protectedPolicyObserved:branchObservation.protected===true&&protectionObservation.status==='OBSERVED'};
  if(selected!==api)result.requests.push(...selected.requests);
  if(![result.rulesets,result.workflows,result.checks,result.runs,result.artifacts,result.deployments].every((r)=>r?.complete===true)||branchObservation.status!=='OBSERVED'||protectionObservation.status!=='OBSERVED')result.status='OBSERVED_WITH_GAPS';
  return result;
}
async function readRegisteredEndpoint(endpoint,kind,timeoutMs=10000) {
  const startedAt=new Date().toISOString();let response;
  try{response=await fetch(endpoint,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:kind==='oci'?'application/vnd.oci.image.manifest.v1+json':'application/json'}});}catch{return {ok:false,status:'UNVERIFIED',code:'READ_TIMEOUT_OR_TRANSPORT',startedAt,endedAt:new Date().toISOString()};}
  if(response.status<200||response.status>=300)return {ok:false,status:'UNVERIFIED',httpStatus:response.status,code:'HTTP_READ_UNVERIFIED',startedAt,endedAt:new Date().toISOString()};
  let bytes;
  try {
    const reader=response.body.getReader();const chunks=[];let size=0;
    while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>1024*1024){await reader.cancel();return {ok:false,status:'UNVERIFIED',code:'RESPONSE_TOO_LARGE'};}chunks.push(Buffer.from(item.value));}
    bytes=Buffer.concat(chunks);
  }catch{return {ok:false,status:'UNVERIFIED',code:'READ_TIMEOUT_OR_TRANSPORT'};}
  let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{return {ok:false,status:'UNVERIFIED',code:'RESPONSE_SHAPE_UNVERIFIED'};}
  return {ok:true,data,bytes,digest:response.headers.get('docker-content-digest'),httpStatus:response.status,startedAt,endedAt:new Date().toISOString()};
}
function admittedEndpoint(value,localTest=false) {
  try{const url=new URL(value);return !url.username&&!url.password&&!url.hash&&!url.search&&(url.protocol==='https:'||localTest&&url.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(url.hostname));}catch{return false;}
}
async function observeEnvironment(context,opts) {
  const registration=context.docs['environment-registration.example.json'];const env=registration.environment;
  if(registration.example||[env.id,env.endpoint,env.owner].includes('UNSELECTED'))return {status:'UNVERIFIED',executed:false,code:'ISOLATED_ENVIRONMENT_NOT_REGISTERED'};
  if(!admittedEndpoint(env.endpoint,env.readbackOracle.transport==='http-local-test'))return {status:'UNVERIFIED',executed:false,code:'ENDPOINT_NOT_ADMITTED'};
  const url=new URL(env.endpoint);url.searchParams.set('project',context.registry.project.id);url.searchParams.set('candidate',opts['candidate-sha']);url.searchParams.set('operation',opts['operation-id']);
  const result=await readRegisteredEndpoint(url,'json');
  if(!result.ok)return {...result,executed:true};const data=result.data;
  const matches=object(data)&&data.schemaVersion===1&&data.project===context.registry.project.id&&data.environmentId===env.id&&data.candidateSha===opts['candidate-sha']&&data.operationId===opts['operation-id']&&data.artifactDigest===opts['artifact-digest']&&data.businessTerminalState===env.readbackOracle.expectedBusinessTerminalState;
  return {status:matches?'OBSERVED_MATCH':'UNVERIFIED',executed:true,readOnly:true,httpStatus:result.httpStatus,startedAt:result.startedAt,endedAt:result.endedAt,code:matches?'REGISTERED_TARGET_MATCH':'TARGET_IDENTITY_OR_TERMINAL_MISMATCH',observation:matches?{environmentId:env.id,candidateSha:data.candidateSha,operationId:data.operationId,artifactDigest:data.artifactDigest,businessTerminalState:data.businessTerminalState}:undefined};
}
async function observeRegistry(context,opts) {
  const registration=context.docs['registry-registration.example.json'];const reg=registration.registry;
  if(registration.example||reg.kind!=='oci-v2'||reg.endpoint==='UNSELECTED'||!reg.repository)return {status:'UNVERIFIED',executed:false,code:'ARTIFACT_REGISTRY_NOT_REGISTERED'};
  if(!admittedEndpoint(reg.endpoint,reg.transport==='http-local-test'))return {status:'UNVERIFIED',executed:false,code:'ENDPOINT_NOT_ADMITTED'};
  const base=reg.endpoint.replace(/\/$/,'')+'/v2/'+reg.repository;const result=await readRegisteredEndpoint(base+'/manifests/'+opts['artifact-digest'],'oci');
  if(!result.ok)return {...result,executed:true};
  const digest='sha256:'+crypto.createHash('sha256').update(result.bytes).digest('hex');
  if(result.data?.schemaVersion!==2||result.data?.mediaType!=='application/vnd.oci.image.manifest.v1+json'||digest!==opts['artifact-digest']||result.digest!==digest||!DIGEST_RE.test(result.data?.config?.digest??''))return {status:'UNVERIFIED',executed:true,code:'MANIFEST_DIGEST_UNVERIFIED'};
  const config=await readRegisteredEndpoint(base+'/blobs/'+result.data.config.digest,'json');
  if(!config.ok)return {...config,executed:true};
  if('sha256:'+crypto.createHash('sha256').update(config.bytes).digest('hex')!==result.data.config.digest||config.data?.config?.Labels?.['org.opencontainers.image.revision']!==opts['candidate-sha'])return {status:'UNVERIFIED',executed:true,code:'ARTIFACT_SOURCE_SHA_UNVERIFIED'};
  return {status:'OBSERVED_MATCH',executed:true,mediaType:'oci-image-manifest',digest,candidateSha:opts['candidate-sha'],signingStatus:'UNVERIFIED',provenanceStatus:'UNVERIFIED',qualification:'DIGEST_AND_SOURCE_ONLY'};
}

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');
  if(!['validate','qualify','probe'].includes(command))return failInput('unknown command');

  const common=['registry','refs','platform-dir','json'];
  const cases={
    'repository-identity':['case','read-only'],
    'required-checks-authorization':['case','principal'],
    'registry-environment-identity':['case','chain'],
    'platform-observation':['case','read-only','candidate-sha'],
    'artifact-readback':['case','read-only','candidate-sha','artifact-digest','operation-id'],
    'environment-readback':['case','read-only','candidate-sha','artifact-digest','operation-id'],
  };
  const accepted=new Set([...common,...(command==='probe'?(cases[opts.case]??[]):command==='qualify'?['read-only','candidate-sha','artifact-digest','operation-id']:[])]);
  if(Object.keys(opts).some((key)=>key!=='_'&&!accepted.has(key)))return failInput('option does not apply to this operation');

  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  const refsFile = opts.refs ?? DEFAULT_REFS;
  const platformDir = opts['platform-dir'] ?? DEFAULT_PLATFORM_DIR;

  if (command === 'probe' && !opts.case) return failInput('probe requires --case');
  if (command === 'probe' && opts.case && !['repository-identity', 'required-checks-authorization', 'registry-environment-identity','platform-observation','environment-readback','artifact-readback'].includes(opts.case)) {
    return failInput('unknown probe case');
  }
  if (command === 'probe' && opts.case === 'repository-identity' && !opts['read-only']) {
    return failInput('repository-identity is a read-only probe; pass --read-only (this task never writes remote platform policy)');
  }

  let refsDoc;
  try {refsDoc=readJson(refsFile);} catch(error) {return failInput('refs catalog unreadable');}
  const initialRefs=refsAdmission(refsDoc);
  if(initialRefs.length){print({interface:'PlatformInfra.v1',executed:false,ok:false,status:'UNVERIFIED',code:'REFS_ADMISSION_FAILED',violations:initialRefs});return EXIT_VERIFY;}
  let registry;
  try {registry=readJson(registryFile);}catch(error){return failInput('registry unreadable');}
  const refsViolations=refsAdmission(refsDoc,registry?.project?.id);
  if(refsViolations.length){print({interface:'PlatformInfra.v1',executed:false,ok:false,status:'UNVERIFIED',code:'REFS_ADMISSION_FAILED',violations:refsViolations});return EXIT_VERIFY;}
  let referencePolicy;
  try{referencePolicy=readJson(path.join(repoRoot,'infra/delivery/qualification-policy.json'));}catch{return failInput('reference policy unavailable');}
  const policyViolations=validateQualificationPolicy(referencePolicy);
  const roleViolations=policyViolations.length?policyViolations:validateRefsCatalog(refsDoc,registry?.project?.id,{policy:referencePolicy});
  if(roleViolations.length){print({interface:'PlatformInfra.v1',executed:false,ok:false,status:'UNVERIFIED',code:'REFS_ADMISSION_FAILED',violations:roleViolations});return EXIT_VERIFY;}
  const loaded = loadPlatformDocs(platformDir);
  if (loaded.error) return failInput(loaded.error);
  const docs = loaded.docs;
  const admission=contextAdmission({docs,registry,refsDoc});
  if(admission.violations.length){print({interface:'PlatformInfra.v1',executed:false,ok:false,status:'UNVERIFIED',code:admission.identity.sameOrigin?'PLATFORM_ADMISSION_FAILED':'IDENTITY_NOT_SAME_ORIGIN',fields:admission.identity.mismatches,localConsistency:'FAIL',violations:admission.violations});return EXIT_VERIFY;}
  const semantic=validatePlatform({docs,registry,refsDoc});
  if(command!=='validate' && semantic.violations.length){print({interface:'PlatformInfra.v1',executed:false,ok:false,status:'UNVERIFIED',code:'PLATFORM_ADMISSION_FAILED',violations:semantic.violations});return EXIT_VERIFY;}

  if (command === 'validate') {
    const { violations, catalogGaps, summary } = validatePlatform({ docs, registry, refsDoc });
    print({
      interface: 'PlatformInfra.v1',
      platformDir: platformDir===DEFAULT_PLATFORM_DIR?'infra/delivery/platform':'<platform-input>',
      registry: registryFile===DEFAULT_REGISTRY?'infra/delivery/registry.json':'<registry-input>',
      refs: refsFile===DEFAULT_REFS?'infra/delivery/secrets.refs.example.json':'<refs-input>',
      mode: docs['repository-registration.json'].localOnly === true && docs['ci-policy.json'].mode === 'LOCAL_ONLY' ? 'LOCAL_ONLY' : 'MIXED',
      ok: violations.length === 0,
      violations,
      catalogGaps,
      summary:violations.length?undefined:summary,
    });
    return violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'probe' && opts.case === 'repository-identity') {
    return probeRepositoryIdentity({ docs, registryFile });
  }
  if (command === 'probe' && opts.case === 'required-checks-authorization') {
    return probeRequiredChecksAuthorization({ docs, refsDoc, opts });
  }
  if (command === 'probe' && opts.case === 'registry-environment-identity') {
    return probeRegistryEnvironmentIdentity({ docs, chainFile: opts.chain });
  }

  if(command==='qualify'||command==='probe'&&['platform-observation','environment-readback','artifact-readback'].includes(opts.case)) {
    if(!opts['read-only'])return failInput('read-only required');
    if(opts['candidate-sha']&&!SHA_RE.test(opts['candidate-sha']))return failInput('candidate-sha must be a 40-hex SHA');
    if(command==='qualify'||opts.case!=='platform-observation'){
      if(!SHA_RE.test(opts['candidate-sha']??'')||!DIGEST_RE.test(opts['artifact-digest']??'')||!/^[-A-Za-z0-9_.:]{1,160}$/.test(opts['operation-id']??''))return failInput('exact candidate-sha, artifact-digest and operation-id required');
    }
    const context={docs,registry,refsDoc};
    if(opts.case==='platform-observation'){const observation=observePlatform(context,opts);print({interface:'PlatformInfra.v1',case:opts.case,readOnly:true,observation});return observation.status==='OBSERVED'?EXIT_PASS:EXIT_VERIFY;}
    if(opts.case==='environment-readback'){const observation=await observeEnvironment(context,opts);print({interface:'Environment.v1',readOnly:true,observation});return observation.status==='OBSERVED_MATCH'?EXIT_PASS:EXIT_VERIFY;}
    if(opts.case==='artifact-readback'){const observation=await observeRegistry(context,opts);print({interface:'IntegrationIdentity.v1',readOnly:true,observation});return observation.status==='OBSERVED_MATCH'?EXIT_PASS:EXIT_VERIFY;}
    const platform=observePlatform(context,opts);const artifact=await observeRegistry(context,opts);const environment=await observeEnvironment(context,opts);
    const blockers=['CONTROL_SOURCE_RUNTIME_ACTOR_NOT_ATTESTED'];
    if(platform.status!=='OBSERVED'||platform.requiredChecks?.protectedPolicyObserved!==true||platform.requiredChecks?.registrationStatus!=='REGISTERED')blockers.push('PROTECTED_POLICY_AND_REQUIRED_CHECK_ACCEPTANCE_REQUIRED');
    if(artifact.status!=='OBSERVED_MATCH'||artifact.signingStatus!=='VERIFIED'||artifact.provenanceStatus!=='VERIFIED')blockers.push('ARTIFACT_SIGNING_PROVENANCE_REQUIRED');
    if(environment.status!=='OBSERVED_MATCH')blockers.push('INDEPENDENT_TARGET_READBACK_REQUIRED');
    print({interface:'PlatformInfra.v1',operation:'qualify',readOnly:true,status:'NOT_READY',runtimeReady:false,observations:{platform,artifact,environment},blockers,writerOwner:'existing Comet P4_1/P4_2; no writer or credential-store access in I06'});return EXIT_VERIFY;
  }
  return failInput('unknown command');
}

main(process.argv.slice(2)).then((code)=>process.exit(code),(error)=>{print({interface:'PlatformInfra.v1',executed:false,status:'UNVERIFIED',code:'READ_OR_INPUT_FAILURE'});process.exit(EXIT_VERIFY);});
