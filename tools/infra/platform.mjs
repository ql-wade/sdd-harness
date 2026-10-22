#!/usr/bin/env node
// PlatformInfra.v1 / IntegrationIdentity.v1 / Environment.v1 CLI — validate | probe
//
// I06 只做只读核验（没有 up 子命令）：登记读回 Git/CI/Registry/隔离环境身份与权限，
// 绝不隐式写远端平台策略。平台 writer 归既有 P 任务与 Comet closeout 授权，真实 P4_1/P4_2 门保留。
//
// 环境事实（2026-10-20 实测，worker-reports/I06/evidence/env-probe.txt）：
//   - gh 令牌失效 + TLS 拦截（x509 OSStatus -26276）→ GitHub 只读读回不可行，如实 UNVERIFIED；
//   - 无远端分支保护/CI 配置写授权 → LOCAL_ONLY；required-check 名称未登记 → UNSELECTED，不虚构。
//
// 退出码契约（execution-contract.json V_INFRA_I06.cli_contract）：
//   0 = PASS（validate 通过 / 本地链路贯通 VERIFIED / 读回成功）
//   1 = 输入或前置无效（平台登记文件缺失/不可解析、chain fixture 缺失/不可解析、SHA/digest 格式错误、参数错误）
//   2 = 验证失败（语义违规、授权门拒绝、集成身份链阻断、UNVERIFIED）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 转 PASS。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, resolveSecretRef, scanForForbiddenValues } from './secret-refs.mjs';

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
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
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
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json' || arg === '--read-only') {
      opts[arg.slice(2)] = true;
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, null, 2) + '\n');
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
      return { error: `platform file unreadable (${displayPath(file)}): ${redactHostPaths(error.message)}` };
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

  // repository-registration：身份与 I01 registry 同源；读回诚实；保护声称必须有平台证据。
  const github = registry?.project?.github ?? {};
  if (repo.repository?.repoId !== github.repoId || repo.repository?.principalId !== github.principalId || repo.repository?.owner !== github.owner) {
    violations.push({ code: 'IDENTITY_NOT_SAME_ORIGIN', at: 'repository-registration.json', reason: 'repository identity must match infra/delivery/registry.json#project.github' });
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
    if (doc.example !== true) violations.push({ code: 'EXAMPLE_DECLARATION_REQUIRED', at: name });
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
function evaluateIntegrationIdentity(chain) {
  const codes = [];
  const steps = [];
  let blocked = false;
  let unverified = false;
  const block = (code) => {
    codes.push(code);
    blocked = true;
  };

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

function probeRepositoryIdentity({ docs, registryFile, json }) {
  void json;
  const repo = docs['repository-registration.json'];
  const registry = readJson(registryFile);
  const github = registry?.project?.github ?? {};
  const sameOrigin =
    repo.repository?.repoId === github.repoId && repo.repository?.principalId === github.principalId && repo.repository?.owner === github.owner;
  if (!sameOrigin) {
    print({
      interface: 'PlatformInfra.v1',
      case: 'repository-identity',
      readOnly: true,
      executed: true,
      mode: 'LOCAL_ONLY',
      localConsistency: 'FAIL',
      code: 'IDENTITY_NOT_SAME_ORIGIN',
      reason: 'repository registration diverges from infra/delivery/registry.json#project.github',
    });
    return EXIT_VERIFY;
  }

  // 真实只读尝试：gh api（一次；失败原样保留错误文本，宿主路径脱敏）。
  const command = `gh api repos/${repo.repository.repoFullname}`;
  const run = spawnSync('gh', ['api', `repos/${repo.repository.repoFullname}`], { encoding: 'utf8', timeout: 15_000 });
  if (run.status === 0) {
    try {
      const observed = JSON.parse(run.stdout);
      const matches = observed.id === repo.repository.repoId;
      print({
        interface: 'PlatformInfra.v1',
        case: 'repository-identity',
        readOnly: true,
        executed: true,
        mode: 'LOCAL_ONLY',
        localConsistency: 'PASS',
        readback: {
          status: matches ? 'VERIFIED' : 'MISMATCH',
          command,
          observed: { repoId: observed.id, fullName: observed.full_name },
          expected: { repoId: repo.repository.repoId, repoFullname: repo.repository.repoFullname },
        },
      });
      return matches ? EXIT_PASS : EXIT_VERIFY;
    } catch {
      print({
        interface: 'PlatformInfra.v1',
        case: 'repository-identity',
        readOnly: true,
        executed: true,
        mode: 'LOCAL_ONLY',
        localConsistency: 'PASS',
        readback: { status: 'UNVERIFIED', command, error: redactHostPaths('gh output was not JSON') },
      });
      return EXIT_VERIFY;
    }
  }
  const rawError = (run.stderr.trim() || run.stdout.trim() || `gh exited ${run.status}`).split('\n')[0];
  print({
    interface: 'PlatformInfra.v1',
    case: 'repository-identity',
    readOnly: true,
    executed: true,
    mode: 'LOCAL_ONLY',
    localConsistency: 'PASS',
    readback: { status: 'UNVERIFIED', command, error: redactHostPaths(rawError) },
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
    return failInput(`chain fixture unreadable (${displayPath(chainFile)}): ${redactHostPaths(error.message)}`);
  }
  const inputError = validateChainInput(chain);
  if (inputError) return failInput(`invalid chain fixture: ${inputError}`);
  const verdict = evaluateIntegrationIdentity(chain);
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

function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');

  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  const refsFile = opts.refs ?? DEFAULT_REFS;
  const platformDir = opts['platform-dir'] ?? DEFAULT_PLATFORM_DIR;

  if (command === 'probe' && !opts.case) return failInput('probe requires --case');
  if (command === 'probe' && opts.case && !['repository-identity', 'required-checks-authorization', 'registry-environment-identity'].includes(opts.case)) {
    return failInput(`unknown probe case: ${opts.case}`);
  }
  if (command === 'probe' && opts.case === 'repository-identity' && !opts['read-only']) {
    return failInput('repository-identity is a read-only probe; pass --read-only (this task never writes remote platform policy)');
  }

  let registry;
  try {
    registry = readJson(registryFile);
  } catch (err) {
    return failInput(`registry unreadable (${displayPath(registryFile)}): ${redactHostPaths(err.message)}`);
  }
  let refsDoc;
  try {
    refsDoc = readJson(refsFile);
  } catch (err) {
    return failInput(`refs catalog unreadable (${displayPath(refsFile)}): ${redactHostPaths(err.message)}`);
  }
  const loaded = loadPlatformDocs(platformDir);
  if (loaded.error) return failInput(loaded.error);
  const docs = loaded.docs;

  if (command === 'validate') {
    const { violations, catalogGaps, summary } = validatePlatform({ docs, registry, refsDoc });
    print({
      interface: 'PlatformInfra.v1',
      platformDir: displayPath(platformDir),
      registry: displayPath(registryFile),
      refs: displayPath(refsFile),
      mode: docs['repository-registration.json'].localOnly === true && docs['ci-policy.json'].mode === 'LOCAL_ONLY' ? 'LOCAL_ONLY' : 'MIXED',
      ok: violations.length === 0,
      violations,
      catalogGaps,
      summary,
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

  return failInput(`unknown command: ${command}`);
}

process.exit(main(process.argv.slice(2)));
