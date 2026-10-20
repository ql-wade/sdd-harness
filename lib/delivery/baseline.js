// Full-input baseline and AC-to-case traceability for the delivery foundation.
// Digests cover code, tests, lockfiles, migrations, deploy configs and
// declared artifacts — never only src JS/TS. Frozen task definitions are
// hashed separately from progress checkboxes. Pure evaluation only: listing
// missing baselines, invalidating bound receipts on scope change and checking
// report currency produce verdicts; nothing is dispatched or phase-written
// (SDD.Gate.v1 boundary, tasks 2.1.b, A01/A02/A07/A08).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// A01: implementation dispatch requires all three confirmed baselines.
export const REQUIRED_IMPLEMENTATION_BASELINES = ['product', 'design', 'usecase'];

// Full-input manifest groups; every declared file must exist (fail-closed).
const BASELINE_GROUPS = ['sources', 'tests', 'lockfiles', 'migrations', 'deployConfigs', 'artifacts'];

export function digestInputs(entries) {
  const sorted = [...entries].sort((a, b) =>
    `${a.group}\u0000${a.path}`.localeCompare(`${b.group}\u0000${b.path}`));
  return sha256(sorted.map((entry) => `${entry.group}\u0000${entry.path}\u0000${entry.sha256}`).join('\n'));
}

export function computeFullInputBaseline({ root, manifest }) {
  const missing = [];
  const files = [];
  for (const group of BASELINE_GROUPS) {
    for (const rel of manifest?.[group] ?? []) {
      const abs = path.resolve(root, rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        missing.push(rel);
        continue;
      }
      files.push({ group, path: rel, sha256: sha256(fs.readFileSync(abs)) });
    }
  }
  if (missing.length > 0) {
    const sorted = [...missing].sort();
    return {
      ok: false,
      error: 'MISSING_INPUT',
      missing: sorted,
      reason: `declared inputs missing from the frozen manifest scope: ${sorted.join(', ')}`,
    };
  }
  return { ok: true, digest: digestInputs(files), files };
}

// Frozen-plan hard boundary: the digest binds the task definition text only.
// Ticking or unticking a checkbox ([ ] / [x]) must never change it.
export function taskDefinitionDigest(text) {
  return sha256(String(text ?? '').replace(/\[[ xX]\]/g, '[ ]'));
}

export function traceAcToCases({ acceptanceIds, testContract }) {
  const cases = Array.isArray(testContract?.cases) ? testContract.cases : [];
  const missing = [];
  const mapped = [];
  for (const ac of acceptanceIds ?? []) {
    const caseIds = cases.filter((entry) => entry.ac === ac).map((entry) => entry.id);
    if (caseIds.length === 0) missing.push({ ac, reason: `no case mapped to acceptance ${ac}` });
    else mapped.push({ ac, cases: caseIds });
  }
  return { ok: missing.length === 0, missing, mapped };
}

export function requireImplementationBaselines({ baselines }) {
  const present = new Set((baselines ?? []).map((baseline) => baseline?.kind));
  const missing = REQUIRED_IMPLEMENTATION_BASELINES.filter((kind) => !present.has(kind));
  return {
    ok: missing.length === 0,
    missing,
    reason: missing.length > 0
      ? `missing required implementation baselines: ${missing.join(', ')}`
      : null,
  };
}

// A02: only downstream receipts bound to the changed baseline kind are
// invalidated (digest drift, or revision drift with identical content).
// Receipts bound to other baselines keep their validity.
export function invalidateOnScopeChange({ changed, receipts }) {
  const invalidated = [];
  const valid = [];
  for (const receipt of receipts ?? []) {
    const boundDigest = receipt?.boundDigests?.[changed.kind];
    if (boundDigest === undefined) {
      valid.push({ id: receipt.id });
      continue;
    }
    if (boundDigest !== changed.digest) {
      invalidated.push({
        id: receipt.id,
        reason: `bound ${changed.kind} digest ${boundDigest} does not match current digest ${changed.digest}`,
      });
      continue;
    }
    const boundRevision = receipt?.boundRevisions?.[changed.kind];
    if (boundRevision !== undefined && boundRevision !== changed.revision) {
      invalidated.push({
        id: receipt.id,
        reason: `bound ${changed.kind} revision ${boundRevision} does not match current revision ${changed.revision}`,
      });
      continue;
    }
    valid.push({ id: receipt.id });
  }
  return { invalidated, valid };
}

// A07: a previously passed report may only be reused while the full-input
// digest it was bound to is still current.
export function verifyReportCurrency({ report, currentDigest }) {
  if (report?.inputDigest !== currentDigest) {
    return {
      ok: false,
      error: 'DIGEST_MISMATCH',
      reportId: report?.id ?? null,
      boundDigest: report?.inputDigest ?? null,
      currentDigest,
      reason: `report bound to input digest ${report?.inputDigest ?? '<none>'} but current full-input digest is ${currentDigest}`,
    };
  }
  return { ok: true, reportId: report.id, currentDigest };
}
