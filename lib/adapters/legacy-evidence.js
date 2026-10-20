// lib/adapters/legacy-evidence.js — 旧证据通道 → 新 EvidenceEnvelope 的兼容
// adapter（task P2_3，B07/B10 边界）。
//
// 旧通道：lib/evidence-audit.js 的 auditEvidence 报告（schemaVersion 1：
// { pass, issues, change, evidenceSha256, ... }）。新门禁只收
// SDD.Delivery.EvidenceEnvelope v1 —— RED 实测：原始旧报告被 admitEvidence
// 拒绝 INVALID_ENVELOPE（缺 candidateDigest/caseId/origin 等）。
//
// 边界（如实声明）：
// - 只做形状映射与显式拒绝。B07：字段缺失（MISSING_FIELD）与版本不兼容
//   （INCOMPATIBLE_VERSION）明确拒绝，不虚构字段、不静默迁移。
// - 信任判定完全留在 lib/delivery/evidence.js 的 admitEvidence（import 使用，
//   不修改）：adapter 不发放身份、不持有 launcher secret。没有 launcher 签发
//   的 dispatch，映射产物照样被拒 UNREGISTERED_SOURCE。
// - B10 层诚实：envelope 如实声明来源层 —— origin.kind 'legacy-report'、
//   check 'report:evidence-audit:v1'。该 check 只能闭合同名 requiredCheck，
//   永远替代不了产品能力检查（capability 精确匹配由 gate 强制）。
// - 观察计数不放大：旧报告没有 case 级执行计数，adapter 只声明本次真实的
//   一次审计执行（executions { total: 1, valid: 1 }）；pass/fail 原样映射，
//   绝不把旧报告升级成它本来没有的结论。
import { createHash } from 'node:crypto';
import { parseContract } from '../../contracts/delivery/index.js';
import { admitEvidence } from '../delivery/evidence.js';

const SHA256_RE = /^[a-f0-9]{64}$/;
const SUPPORTED_LEGACY_VERSION = 1;

// The adapted envelope always names its true layer: the legacy evidence-audit
// report channel at its supported schema version. Gate capability matching is
// exact, so this check name is the substitution boundary (B10).
export const LEGACY_REPORT_CHECK = 'report:evidence-audit:v1';

const refuse = (error, reason) => ({ ok: false, error, reason });

// Deterministic serialization: the report artifact digest must be stable
// across processes and key insertion orders (same content → same digest).
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Shape-map one old-channel report into an EvidenceEnvelope v1, refusing
// explicitly on missing fields or incompatible versions (B07). Pure mapping:
// no dispatch, no admission, no trust decisions.
export function adaptLegacyReport(report, identity = {}) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return refuse('INVALID_LEGACY_REPORT', 'legacy evidence report must be a JSON object');
  }
  if (typeof identity.runnerId !== 'string' || identity.runnerId.length === 0
    || typeof identity.execution !== 'string' || identity.execution.length === 0
    || typeof identity.environment !== 'string' || identity.environment.length === 0) {
    return refuse('MISSING_FIELD', 'adapter identity requires non-empty runnerId, execution and environment strings');
  }
  if (report.schemaVersion === undefined) {
    return refuse('MISSING_FIELD', 'legacy report field missing: schemaVersion (B07: explicit refusal, refusing to guess)');
  }
  if (report.schemaVersion !== SUPPORTED_LEGACY_VERSION) {
    return refuse('INCOMPATIBLE_VERSION', `legacy report schemaVersion ${report.schemaVersion} is not supported; expected ${SUPPORTED_LEGACY_VERSION} (B07: no compatibility mapping declared, explicitly rejected)`);
  }
  for (const field of ['pass', 'issues', 'change', 'evidenceSha256']) {
    if (report[field] === undefined) {
      return refuse('MISSING_FIELD', `legacy report field missing: ${field} (B07: explicit refusal, no field fabrication)`);
    }
  }
  if (typeof report.pass !== 'boolean' || !Array.isArray(report.issues)
    || typeof report.change !== 'string' || report.change.length === 0) {
    return refuse('INVALID_LEGACY_REPORT', 'legacy report pass/issues/change do not match the evidence-audit v1 report shape');
  }
  if (!report.evidenceSha256 || typeof report.evidenceSha256 !== 'object'
    || typeof report.evidenceSha256.sourceTree !== 'string'
    || !SHA256_RE.test(report.evidenceSha256.sourceTree)) {
    return refuse('INVALID_LEGACY_REPORT', 'legacy report evidenceSha256.sourceTree must be a sha256 hex digest — the observed source-tree digest becomes the candidate binding');
  }
  const now = identity.now ?? new Date().toISOString();
  const envelope = {
    schemaVersion: 1,
    candidateDigest: report.evidenceSha256.sourceTree,
    caseId: report.change,
    check: LEGACY_REPORT_CHECK,
    origin: { kind: 'legacy-report', id: identity.runnerId },
    execution: { id: identity.execution },
    environment: identity.environment,
    toolchain: identity.toolchain ?? `node ${process.version}`,
    // One real execution: the audit run that produced this report.
    executions: { total: 1, valid: 1 },
    result: report.pass ? 'pass' : 'fail',
    evidence: [{
      uri: identity.reportPath ?? `legacy:evidence-audit/${report.change}`,
      sha256: createHash('sha256').update(stableStringify(report)).digest('hex'),
    }],
    expiry: identity.expiry ?? new Date(Date.parse(now) + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  // Internal invariant: the adapter only ever emits a schema-valid envelope.
  const parsed = parseContract('SDD.Delivery.EvidenceEnvelope', envelope);
  if (!parsed.ok) {
    return refuse('INVALID_ENVELOPE', `adapted envelope fails the frozen schema (adapter bug): ${parsed.errors.join('; ')}`);
  }
  return { ok: true, envelope: parsed.value };
}

// Trusted-launcher-side admission: issue the dispatch for the adapted
// envelope and hand both to admitEvidence unchanged. `dispatch` carries the
// launcher's binding choices (run/gate/role/attempt/epoch, optionally
// inputDigest/policyDigest); everything still passes the same integrity,
// identity, currency and duplicate-issuance checks as native evidence.
export function admitLegacyReport({ report, identity, authority, current, issuedExecutions = [], now, dispatch = {} }) {
  const adapted = adaptLegacyReport(report, { ...identity, now });
  if (!adapted.ok) return adapted;
  if (!authority || !current) {
    return refuse('UNREGISTERED_SOURCE', 'admitLegacyReport requires the launch authority and the current binding; the adapter mints no trust by itself');
  }
  const issued = authority.issueDispatch({
    runnerId: identity.runnerId,
    run: dispatch.run ?? report.change,
    gate: dispatch.gate ?? 'V',
    role: dispatch.role ?? 'verifier',
    attempt: dispatch.attempt ?? 1,
    epoch: dispatch.epoch ?? 1,
    execution: identity.execution,
    inputDigest: dispatch.inputDigest ?? report.evidenceSha256.sourceTree,
    policyDigest: dispatch.policyDigest ?? current.policyDigest,
  });
  return admitEvidence({
    envelope: adapted.envelope,
    dispatch: issued,
    authority,
    current,
    issuedExecutions,
    now,
  });
}
