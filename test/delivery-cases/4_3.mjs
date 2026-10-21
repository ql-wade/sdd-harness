// P4_3 (acceptance B10): four-layer evidence is archived and indexed separately.
//
// Journey contract for this delivery case:
//   (a) every acceptance ID in the index reconciles 1:1 against the scenario
//       set in specs/delivery-foundation/spec.md (the sole semantic source) —
//       zero missing, zero invented;
//   (b) every entry's evidence pointers actually resolve (file exists AND the
//       anchor — scenario tag, test-name substring, or commit — is parseable
//       in the referenced artifact);
//   (c) every ENVIRONMENT_GATED entry carries a registered holder (an
//       unverified item never silently upgrades to PASS);
//   (d) the JSON is schema-self-consistent (layer/status enums, summary counts).
//
// Negative journeys below prove the validator itself fails on: a deleted
// scenario mapping, a fabricated missing evidence pointer, an
// ENVIRONMENT_GATED entry without a holder, and a bad enum value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CHANGE = 'openspec/changes/delivery-foundation-rearchitecture';
const INDEX_PATH = path.join(ROOT, CHANGE, 'acceptance-index.json');
const SPEC_PATH = path.join(ROOT, CHANGE, 'specs', 'delivery-foundation', 'spec.md');
const VERIFICATION_MD_PATH = path.join(ROOT, CHANGE, 'verification.md');

const LAYERS = new Set(['kernel', 'cli', 'host', 'ci']);
const STATUSES = new Set(['VERIFIED', 'ENVIRONMENT_GATED', 'UNVERIFIED']);

function specScenarioIds() {
  const text = fs.readFileSync(SPEC_PATH, 'utf8');
  const ids = [...text.matchAll(/^#### Scenario: ([A-Z]\d{2})$/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 90, `spec.md scenario parse collapsed: ${ids.length}`);
  return ids;
}

function loadIndex() {
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
}

// A pointer is "path :: anchor". Anchors starting with "commit:" are resolved
// against the git object store; every other anchor must appear as a literal
// substring of the referenced file (scenario tag, test-name fragment, exit marker).
function resolvePointer(pointer, problems, label) {
  if (typeof pointer !== 'string' || !pointer.includes(' :: ')) {
    problems.push(`${label}: malformed pointer (expected "path :: anchor"): ${pointer}`);
    return;
  }
  const sep = pointer.indexOf(' :: ');
  const rel = pointer.slice(0, sep);
  const anchor = pointer.slice(sep + 4);
  if (anchor.startsWith('commit:')) {
    const sha = anchor.slice('commit:'.length).trim();
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT, stdio: 'pipe' });
    } catch {
      problems.push(`${label}: commit anchor does not resolve: ${sha}`);
    }
    return;
  }
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    problems.push(`${label}: evidence file missing: ${rel}`);
    return;
  }
  if (!fs.readFileSync(abs, 'utf8').includes(anchor)) {
    problems.push(`${label}: anchor "${anchor}" not found in ${rel}`);
  }
}

function validateIndex(index, scenarioIds) {
  const problems = [];
  const ids = scenarioIds;
  const entries = index.entries;
  if (!entries || typeof entries !== 'object') {
    problems.push('index.entries missing');
    return problems;
  }
  const indexed = new Set(Object.keys(entries));
  for (const id of ids) {
    if (!indexed.has(id)) problems.push(`scenario ${id} from spec.md is not mapped in the index`);
  }
  for (const id of indexed) {
    if (!ids.includes(id)) problems.push(`index maps unknown acceptance ID ${id} (not in spec.md)`);
  }
  for (const [id, entry] of Object.entries(entries)) {
    const label = `entry ${id}`;
    if (!entry || typeof entry !== 'object') {
      problems.push(`${label}: not an object`);
      continue;
    }
    if (!LAYERS.has(entry.layer)) problems.push(`${label}: bad layer "${entry.layer}"`);
    if (!STATUSES.has(entry.status)) problems.push(`${label}: bad status "${entry.status}"`);
    if (!Array.isArray(entry.scenario_ids) || entry.scenario_ids.length !== 1 || entry.scenario_ids[0] !== id) {
      problems.push(`${label}: scenario_ids must map exactly to ["${id}"]`);
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      problems.push(`${label}: evidence must be a non-empty array`);
    } else {
      for (const p of entry.evidence) resolvePointer(p, problems, label);
    }
    if (entry.status === 'ENVIRONMENT_GATED' && !(typeof entry.holder === 'string' && entry.holder.trim())) {
      problems.push(`${label}: ENVIRONMENT_GATED without a registered holder`);
    }
    if (entry.status === 'UNVERIFIED' && !(typeof entry.holder === 'string' && entry.holder.trim())) {
      problems.push(`${label}: UNVERIFIED without a registered holder/successor`);
    }
  }
  // Summary must match the entries it summarizes — no hand-tuned green.
  if (index.summary) {
    const recount = { VERIFIED: 0, ENVIRONMENT_GATED: 0, UNVERIFIED: 0 };
    for (const e of Object.values(entries)) if (recount[e.status] !== undefined) recount[e.status] += 1;
    for (const [k, v] of Object.entries(recount)) {
      if (index.summary[k] !== v) {
        problems.push(`summary.${k}=${index.summary[k]} disagrees with entries (${v})`);
      }
    }
    if (index.summary.total !== undefined && index.summary.total !== Object.keys(entries).length) {
      problems.push('summary.total disagrees with entry count');
    }
  } else {
    problems.push('index.summary missing');
  }
  return problems;
}

test('B10 setup: acceptance-index.json and verification.md exist (four-layer archive)', () => {
  assert.ok(fs.existsSync(INDEX_PATH), `missing ${CHANGE}/acceptance-index.json`);
  assert.ok(fs.existsSync(VERIFICATION_MD_PATH), `missing ${CHANGE}/verification.md`);
  const md = fs.readFileSync(VERIFICATION_MD_PATH, 'utf8');
  for (const heading of ['内核层', 'CLI/装配层', '宿主层', '业务/CI 层']) {
    assert.ok(md.includes(heading), `verification.md lacks the "${heading}" chapter`);
  }
  assert.ok(md.includes('delivered'), 'verification.md must separate the delivered claim from target-environment confirmation');
});

test('B10 (a): all acceptance IDs reconcile 1:1 with the spec.md scenario set — zero missing', () => {
  const problems = validateIndex(loadIndex(), specScenarioIds());
  assert.deepEqual(problems.filter((p) => p.includes('not mapped') || p.includes('unknown acceptance')), []);
});

test('B10 (b): every evidence pointer resolves to a real file with a parseable anchor', () => {
  const problems = validateIndex(loadIndex(), specScenarioIds());
  assert.deepEqual(problems.filter((p) => p.includes('evidence file missing') || p.includes('anchor') || p.includes('malformed pointer')), []);
});

test('B10 (c): every ENVIRONMENT_GATED / UNVERIFIED entry names a registered holder', () => {
  const problems = validateIndex(loadIndex(), specScenarioIds());
  assert.deepEqual(problems.filter((p) => p.includes('holder')), []);
});

test('B10 (d): layer and status enums plus summary counts are self-consistent', () => {
  const problems = validateIndex(loadIndex(), specScenarioIds());
  assert.deepEqual(problems, []);
});

test('B10 negative: deleting one scenario mapping fails validation', () => {
  const index = loadIndex();
  const ids = specScenarioIds();
  const dropped = ids[ids.length - 1];
  delete index.entries[dropped];
  const problems = validateIndex(index, ids);
  assert.ok(problems.some((p) => p.includes(`${dropped} from spec.md is not mapped`)), 'validator must fail on a deleted scenario mapping');
});

test('B10 negative: a fabricated missing evidence pointer fails validation', () => {
  const index = loadIndex();
  const ids = specScenarioIds();
  const first = ids[0];
  index.entries[first].evidence.push('openspec/changes/delivery-foundation-rearchitecture/worker-reports/DOES_NOT_EXIST.json :: fabricated');
  const problems = validateIndex(index, ids);
  assert.ok(problems.some((p) => p.includes('evidence file missing') || p.includes('anchor')), 'validator must fail on a fabricated evidence pointer');
});

test('B10 negative: ENVIRONMENT_GATED without a holder fails validation', () => {
  const index = loadIndex();
  const ids = specScenarioIds();
  const gated = Object.values(index.entries).find((e) => e.status === 'ENVIRONMENT_GATED');
  assert.ok(gated, 'index must contain at least one honestly gated item');
  const gatedId = Object.keys(index.entries).find((k) => index.entries[k] === gated);
  delete index.entries[gatedId].holder;
  const problems = validateIndex(index, ids);
  assert.ok(problems.some((p) => p.includes(`${gatedId}: ENVIRONMENT_GATED without a registered holder`)));
});

test('B10 negative: an invalid layer enum fails validation', () => {
  const index = loadIndex();
  const ids = specScenarioIds();
  const first = ids[0];
  index.entries[first].layer = 'quantum';
  const problems = validateIndex(index, ids);
  assert.ok(problems.some((p) => p.includes(`${first}: bad layer "quantum"`)));
});
