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
import { Parser } from 'commonmark';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// A01: implementation dispatch requires all three confirmed baselines.
export const REQUIRED_IMPLEMENTATION_BASELINES = ['product', 'design', 'usecase'];

// Full-input manifest groups; every declared file must exist (fail-closed).
const BASELINE_GROUPS = ['sources', 'tests', 'lockfiles', 'migrations', 'deployConfigs', 'artifacts', 'designs', 'testIntents', 'methods', 'policies', 'environments'];

export function digestInputs(entries) {
  // Frozen digests cross machines and locales: order by UTF-16 code unit
  // (plain < / >), the same deterministic order as the MISSING_INPUT list.
  // localeCompare would make the frozen digest locale-dependent.
  const sorted = [...entries].sort((a, b) => {
    const ka = `${a.group}\u0000${a.path}`;
    const kb = `${b.group}\u0000${b.path}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return sha256(sorted.map((entry) => `${entry.group}\u0000${entry.path}\u0000${entry.sha256}`).join('\n'));
}

export function computeFullInputBaseline({ root, manifest }) {
  const invalid = (reason) => ({ ok: false, error: 'INVALID_MANIFEST', reason });
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return invalid('a declared input manifest is required');
  if (Object.keys(manifest).some((group) => !BASELINE_GROUPS.includes(group))) return invalid('unknown input manifest group');
  if (Object.values(manifest).some((entries) => !Array.isArray(entries))) return invalid('manifest groups must contain arrays of relative file paths');
  if (!Object.values(manifest).some((entries) => entries.length > 0)) return invalid('zero declared inputs cannot establish a baseline');
  const rootPath = fs.realpathSync(root);
  const missing = [];
  const files = [];
  for (const group of BASELINE_GROUPS) {
    for (const rel of manifest?.[group] ?? []) {
      if (typeof rel !== 'string' || !rel.trim() || /^(?:[A-Za-z]:|[\\/]|~)/.test(rel) || rel.split(/[\\/]/).includes('..') || rel.includes('\0')) return invalid('input paths must remain relative to the project');
      const abs = path.resolve(rootPath, rel);
      if (fs.existsSync(abs) && !fs.realpathSync(abs).startsWith(rootPath + path.sep)) return invalid('input resolves outside the project');
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

// Block membership comes from the pinned CommonMark AST, not a second
// Markdown scanner. Only the first paragraph of a real list item may carry
// a task marker; map its source position back to the original source bytes.
// A missing/mismatched source marker stays unchanged (conservative binding).
export function normalizeTaskProgress(text) {
  const source = String(text ?? '');
  const starts = [0];
  for (const newline of source.matchAll(/\r\n|\r|\n/g)) starts.push(newline.index + newline[0].length);
  const walker = new Parser().parse(source).walker();
  const edits = [];
  let event;
  while ((event = walker.next())) {
    const node = event.node;
    if (!event.entering || node.type !== 'paragraph' || node.parent?.type !== 'item' || node.parent.firstChild !== node) continue;
    const [line, column] = node.sourcepos[0];
    const offset = starts[line - 1] + column - 1;
    if (!Number.isInteger(offset) || offset < 0 || offset + 2 >= source.length) continue;
    if (/^\[[xX]\](?=[ \t\r\n]|$)/.test(source.slice(offset))) edits.push(offset + 1);
  }
  let result = '', cursor = 0;
  for (const position of edits.sort((a, b) => a - b)) { result += source.slice(cursor, position) + ' '; cursor = position + 1; }
  return result + source.slice(cursor);
}

// Existing digest compatibility normalizes CRLF explicitly; the AST helper
// above does not render/reformat text or alter its newline bytes.
export function taskDefinitionDigest(text) {
  return sha256(normalizeTaskProgress(String(text ?? '').replace(/\r\n/g, '\n')));
}

export { traceAcToCases } from '../../contracts/delivery/test-contract.schema.js';

export function requireImplementationBaselines({ baselines }) {
  const declared = Array.isArray(baselines) ? baselines : [];
  const current = declared.filter((baseline) => typeof baseline?.revision === 'string' && baseline.revision.trim() && /^[a-f0-9]{64}$/.test(baseline?.digest ?? ''));
  const present = new Set(current.map((baseline) => baseline.kind));
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
  if (!/^[a-f0-9]{64}$/.test(currentDigest ?? '') || report?.inputDigest !== currentDigest) {
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
