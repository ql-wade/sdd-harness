// P1_1 work-package 1.1.b oracle: the baseline must record actually executed
// version/status/minimal-call probes (F01/F03 behavior evidence) as
// runtime_claims entries with command, observed output, exit code, timestamp
// and a saved evidence log. A claim whose evidence file is missing or whose
// exit code is nonzero fails. Exit 0 = satisfied; nonzero = RED.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const probesDir = path.dirname(fileURLToPath(import.meta.url));
const changeDir = path.resolve(probesDir, '..');
const projectRoot = path.resolve(changeDir, '../../..');
const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};

const baseline = JSON.parse(await fs.readFile(path.join(changeDir, 'toolchain-baseline.json'), 'utf8'));
const claims = Array.isArray(baseline.runtime_claims) ? baseline.runtime_claims : [];

const required = [
  { id: 'comet-cli-version', expectVersion: '0.4.5', expectExit: 0 },
  { id: 'comet-cli-minimal-call', expectVersion: null, expectExit: 0 },
  { id: 'openspec-local-version', expectVersion: baseline.openspec?.current ?? null, expectExit: 0 },
  // The replayed 1.3.1 rejection IS the expected outcome, so its claim exits 3 by design.
  { id: 'openspec-local-dependency-edges', expectVersion: null, expectExit: 3 },
  { id: 'openspec-candidate-version', expectVersion: baseline.openspec?.isolated_candidate ?? null, expectExit: 0 },
  { id: 'teamai-cli-version', expectVersion: baseline.teamai?.version ?? null, expectExit: 0 },
];

check('runtime_claims present', claims.length > 0, 'baseline.runtime_claims is empty');
for (const requiredClaim of required) {
  const claim = claims.find((entry) => entry.id === requiredClaim.id);
  check(`claim ${requiredClaim.id} recorded`, Boolean(claim));
  if (!claim) continue;
  check(`claim ${requiredClaim.id} command`, typeof claim.command === 'string' && claim.command.length > 0);
  check(`claim ${requiredClaim.id} executedAt`, typeof claim.executed_at === 'string' && !Number.isNaN(Date.parse(claim.executed_at)));
  check(`claim ${requiredClaim.id} exit code matches expectation`, claim.exit_code === requiredClaim.expectExit, `observed ${claim.exit_code}, expected ${requiredClaim.expectExit}`);
  check(`claim ${requiredClaim.id} observed output`, typeof claim.observed === 'string' && claim.observed.length > 0);
  if (requiredClaim.expectVersion !== null) {
    check(`claim ${requiredClaim.id} observed version`, claim.observed.includes(requiredClaim.expectVersion), `observed "${claim.observed}"`);
  }
  check(`claim ${requiredClaim.id} evidence log`, typeof claim.evidence === 'string');
  if (typeof claim.evidence === 'string') {
    try {
      await fs.access(path.join(projectRoot, claim.evidence));
    } catch {
      check(`claim ${requiredClaim.id} evidence exists`, false, claim.evidence);
    }
  }
}

// Compatibility matrix: the local OpenSpec must have its old dependency-edge
// gap replayed against the exact published Comet artifact, not just asserted.
const matrix = baseline.openspec?.compatibility_matrix;
check('compatibility_matrix recorded', Array.isArray(matrix) && matrix.length >= 2);
if (Array.isArray(matrix)) {
  const localRow = matrix.find((row) => row.version === baseline.openspec?.current);
  check('matrix local row replayed', localRow?.dependency_edges?.replayed === true, JSON.stringify(localRow?.dependency_edges ?? null));
  const candidateRow = matrix.find((row) => row.version === baseline.openspec?.isolated_candidate);
  check('matrix candidate row runtime verified', candidateRow?.dependency_edges?.runtime_verified === true, JSON.stringify(candidateRow?.dependency_edges ?? null));
}

if (failures.length > 0) {
  console.error(`probe-runtime-claims: ${failures.length} check(s) FAILED`);
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log('probe-runtime-claims: all checks PASS');
