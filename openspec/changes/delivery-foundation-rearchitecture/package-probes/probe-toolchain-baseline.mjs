// P1_1 work-package 1.1.a oracle: the toolchain baseline must pin the actual
// distributed npm artifacts (not only source commits) for Comet, TeamAI and
// OpenSpec, with re-verified integrity, plus Node/host/skills digests, and
// carry a qualified status. Exit 0 = deliverable satisfied; nonzero = RED.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const changeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(changeDir, '../../..');
const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};

const baseline = JSON.parse(await fs.readFile(path.join(changeDir, 'toolchain-baseline.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));

check('status is qualified', baseline.status === 'QUALIFIED', `observed ${baseline.status}`);
check('qualified_at recorded', typeof baseline.qualified_at === 'string' && baseline.qualified_at.length > 0);

// 1) Comet npm artifact integrity (source commit does not substitute the npm artifact).
const comet = baseline.comet ?? {};
check('comet.npm_artifact.name', comet.npm_artifact?.name === '@rpamis/comet');
check('comet.npm_artifact.version matches lock', comet.npm_artifact?.version === lock.package.version);
check('comet.npm_artifact.integrity matches lock', comet.npm_artifact?.integrity === lock.package.integrity);
check('comet.npm_artifact tarball re-hashed', comet.npm_artifact?.tarball_sha256_verified === true);
check('comet lock integrity re-verified against registry', comet.npm_artifact?.registry_integrity_matches === true);
check('comet source archive re-verified', comet.source_archive_reverified === true);

// 2) TeamAI distribution artifact.
const teamai = baseline.teamai ?? {};
check('teamai package pinned', teamai.npm_package === 'teamai-cli');
check('teamai version pinned', teamai.version === '0.22.0', `observed ${teamai.version}`);
check('teamai integrity pinned', typeof teamai.integrity === 'string' && teamai.integrity.startsWith('sha512-'));
check('teamai tarball re-hashed', teamai.npm_artifact?.tarball_sha256_verified === true);
check('teamai registry integrity matches', teamai.npm_artifact?.registry_integrity_matches === true);
check('teamai observed version evidence', teamai.observed?.command_version === '0.22.0');

// 3) OpenSpec distribution artifact.
const openspec = baseline.openspec ?? {};
check('openspec candidate artifact pinned', openspec.npm_artifact?.name === '@fission-ai/openspec');
check('openspec candidate version pinned', openspec.npm_artifact?.version === openspec.isolated_candidate);
check('openspec candidate integrity pinned', typeof openspec.npm_artifact?.integrity === 'string' && openspec.npm_artifact.integrity.startsWith('sha512-'));
check('openspec candidate tarball re-hashed', openspec.npm_artifact?.tarball_sha256_verified === true);
check('openspec local CLI version recorded', typeof openspec.local_cli?.observed_version === 'string');

// 4) Common toolchain + host + skills digests.
const toolchain = baseline.toolchain ?? {};
check('node host version recorded', typeof toolchain.node?.host_observed === 'string');
check('node pinned build version recorded', toolchain.node?.pinned_for_comet_build === lock.toolchain.node);
check('pnpm version recorded', toolchain.pnpm?.observed === lock.toolchain.pnpm);
check('python version recorded', typeof toolchain.python?.observed === 'string');
check('host digest recorded', typeof baseline.host?.digest === 'string' && baseline.host.digest.length === 64);
check('skills inventory digests recorded', Array.isArray(baseline.skills_inventory) && baseline.skills_inventory.length > 0
  && baseline.skills_inventory.every((entry) => typeof entry.path === 'string' && typeof entry.digest === 'string' && entry.digest.length === 64));

if (failures.length > 0) {
  console.error(`probe-toolchain-baseline: ${failures.length} check(s) FAILED`);
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log('probe-toolchain-baseline: all checks PASS');
