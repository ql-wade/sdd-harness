// P1_1 delivery case: the toolchain baseline must pin the actual distributed
// npm artifacts (not just source commits) for Comet, TeamAI and OpenSpec with
// re-verified integrity, record actually executed version/status/minimal-call
// probes (F01) with saved evidence, replay the local OpenSpec dependency-edge
// gap (F01/F03 compatibility matrix), and finalize the Comet extension
// delivery contract at concrete paths without touching plugin caches or skill
// bodies. Environment-conditional behavior checks run the pinned contract
// command against the integrated build when this project has prepared it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const changeDir = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture');
const probeDir = path.join(changeDir, 'package-probes');

const baseline = JSON.parse(await fs.readFile(path.join(changeDir, 'toolchain-baseline.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));

test('baseline is in a qualified state with qualification metadata', () => {
  assert.equal(baseline.status, 'QUALIFIED');
  assert.ok(!Number.isNaN(Date.parse(baseline.qualified_at)));
  assert.match(baseline.qualification_scope, /journey-level F01\/F03/i);
});

test('comet pins the npm distribution artifact, not only the source commit', () => {
  assert.equal(baseline.comet.npm_artifact.name, '@rpamis/comet');
  assert.equal(baseline.comet.npm_artifact.version, lock.package.version);
  assert.equal(baseline.comet.npm_artifact.integrity, lock.package.integrity);
  assert.equal(baseline.comet.npm_artifact.registry_integrity_matches, true);
  assert.equal(baseline.comet.npm_artifact.tarball_sha256_verified, true);
  assert.equal(baseline.comet.source_archive_reverified, true);
  assert.equal(baseline.comet.source_archive_sha256, lock.source.sha256);
  assert.equal(baseline.comet.source_archive_bytes, lock.source.bytes);
});

test('teamai and openspec distribution artifacts are pinned with re-verified integrity', () => {
  assert.equal(baseline.teamai.npm_package, 'teamai-cli');
  assert.equal(baseline.teamai.version, '0.22.0');
  assert.equal(baseline.teamai.npm_artifact.registry_integrity_matches, true);
  assert.equal(baseline.teamai.npm_artifact.tarball_sha256_verified, true);
  assert.equal(baseline.openspec.npm_artifact.name, '@fission-ai/openspec');
  assert.equal(baseline.openspec.npm_artifact.version, baseline.openspec.isolated_candidate);
  assert.equal(baseline.openspec.npm_artifact.registry_integrity_matches, true);
  assert.equal(baseline.openspec.npm_artifact.tarball_sha256_verified, true);
});

test('host, toolchain and skills digests are recorded', () => {
  assert.equal(baseline.toolchain.node.pinned_for_comet_build, lock.toolchain.node);
  assert.equal(baseline.toolchain.pnpm.observed, lock.toolchain.pnpm);
  assert.match(baseline.host.digest, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(baseline.skills_inventory) && baseline.skills_inventory.length > 0);
  for (const entry of baseline.skills_inventory) {
    assert.match(entry.digest, /^[a-f0-9]{64}$/);
  }
});

test('runtime claims record executed probes with existing evidence logs', async () => {
  const required = ['comet-cli-version', 'comet-cli-minimal-call', 'openspec-local-version', 'openspec-local-dependency-edges', 'openspec-candidate-version', 'teamai-cli-version'];
  const claims = baseline.runtime_claims ?? [];
  for (const id of required) {
    const claim = claims.find((entry) => entry.id === id);
    assert.ok(claim, `runtime claim ${id} missing`);
    assert.ok(!Number.isNaN(Date.parse(claim.executed_at)));
    assert.equal(typeof claim.observed === 'string' && claim.observed.length > 0, true);
    await fs.access(path.join(projectRoot, claim.evidence));
  }
  const versionClaim = claims.find((entry) => entry.id === 'comet-cli-version');
  assert.match(versionClaim.observed, /0\.4\.5/);
  const teamaiClaim = claims.find((entry) => entry.id === 'teamai-cli-version');
  assert.match(teamaiClaim.observed, /0\.22\.0/);
});

test('compatibility matrix replays the local OpenSpec dependency-edge gap and verifies the candidate', () => {
  const matrix = baseline.openspec.compatibility_matrix;
  assert.ok(Array.isArray(matrix) && matrix.length >= 2);
  const localRow = matrix.find((row) => row.version === baseline.openspec.current);
  assert.equal(localRow.dependency_edges.exposed, false);
  assert.equal(localRow.dependency_edges.replayed, true);
  assert.equal(localRow.dependency_edges.result, 'REJECTED');
  const candidateRow = matrix.find((row) => row.version === baseline.openspec.isolated_candidate);
  assert.equal(candidateRow.dependency_edges.exposed, true);
  assert.equal(candidateRow.dependency_edges.runtime_verified, true);
  assert.equal(candidateRow.dependency_edges.result, 'ACCEPTED');
});

test('extension delivery contract is finalized at concrete existing paths', async () => {
  const delivery = baseline.extension_delivery;
  assert.equal(delivery.status, 'QUALIFIED');
  for (const relative of [delivery.lock, delivery.prepare_tool, delivery.build_tool, ...(delivery.safety_tests ?? [])]) {
    await fs.access(path.join(projectRoot, relative));
  }
  assert.match(delivery.workspace, /<commit>/);
  assert.match(delivery.patches_dir, /^integrations\/comet\/patches$/);
  assert.ok(Array.isArray(delivery.forbidden_locations) && delivery.forbidden_locations.length >= 2);
  assert.match(delivery.forbidden_locations.join(' '), /plugin cache/);
  assert.match(delivery.forbidden_locations.join(' '), /\.agents/);
});

test('integrated build passes the V_COMET_NATIVE contract command when prepared locally', async (t) => {
  const buildRoot = baseline.extension_delivery.built_entrypoint
    ? path.dirname(path.dirname(path.dirname(baseline.extension_delivery.built_entrypoint)))
    : null;
  const prepared = await fs.access(path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'provenance.json')).then(() => true, () => false);
  const built = buildRoot ? await fs.access(path.join(projectRoot, buildRoot, 'distribution.json')).then(() => true, () => false) : false;
  if (!prepared || !built) {
    t.skip('prepared Comet source and completed build are not present in this project; run tools/comet/build.mjs --archive first');
    return;
  }
  const pinnedNode = baseline.toolchain.node.pinned_for_comet_build;
  let nodeExecutable = process.execPath;
  if (process.versions.node !== pinnedNode) {
    // The baseline records where this host keeps the pinned build Node.
    const pinnedSource = baseline.toolchain.node.pinned_source ?? '';
    const recordedPath = pinnedSource.match(/(\/|^~)[^\s]*$/)?.[0]?.replace(/^~/, process.env.HOME ?? '');
    const candidates = [recordedPath, path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${pinnedNode}`, 'bin/node')].filter(Boolean);
    let resolved = null;
    for (const candidate of candidates) {
      const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
      if (probe.status === 0 && probe.stdout.trim() === `v${pinnedNode}`) { resolved = candidate; break; }
    }
    if (!resolved) {
      t.skip(`pinned Node ${pinnedNode} is not available on this host (baseline records: ${pinnedSource})`);
      return;
    }
    nodeExecutable = resolved;
  }
  const result = spawnSync(nodeExecutable, ['tools/comet/build.mjs', '--check-generated', '--runtime-smoke', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 600000,
  });
  assert.equal(result.status, 0, `contract command failed (${result.status}): ${result.stderr?.slice(-2000)}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.sourceCommit, lock.source.commit);
  for (const step of summary.steps) {
    assert.equal(step.status, 'PASS', `step ${step.name} failed`);
  }
});
