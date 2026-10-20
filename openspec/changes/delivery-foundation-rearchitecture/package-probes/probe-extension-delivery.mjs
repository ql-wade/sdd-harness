// P1_1 work-package 1.1.c oracle: the Comet extension delivery location must
// be finalized in the toolchain baseline as a concrete contract — fixed
// artifact source/test directories, patch-build and distribution method —
// with the pinned build entrypoint present in this project, and explicit
// forbidden modification locations. Exit 0 = satisfied; nonzero = RED.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const probesDir = path.dirname(fileURLToPath(import.meta.url));
const changeDir = path.resolve(probesDir, '..');
const projectRoot = path.resolve(changeDir, '../../..');
const failures = [];
const check = async (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};

const baseline = JSON.parse(await fs.readFile(path.join(changeDir, 'toolchain-baseline.json'), 'utf8'));
const delivery = baseline.extension_delivery ?? {};

await check('delivery status qualified', delivery.status === 'QUALIFIED', `observed ${delivery.status}`);
await check('lock location recorded', typeof delivery.lock === 'string');
if (typeof delivery.lock === 'string') await check('lock file exists', await fs.access(path.join(projectRoot, delivery.lock)).then(() => true, () => false), delivery.lock);
await check('prepare tool recorded', typeof delivery.prepare_tool === 'string');
if (typeof delivery.prepare_tool === 'string') await check('prepare tool exists', await fs.access(path.join(projectRoot, delivery.prepare_tool)).then(() => true, () => false), delivery.prepare_tool);
await check('build tool recorded', typeof delivery.build_tool === 'string');
if (typeof delivery.build_tool === 'string') await check('build tool exists', await fs.access(path.join(projectRoot, delivery.build_tool)).then(() => true, () => false), delivery.build_tool);
await check('source workspace pattern recorded', typeof delivery.workspace === 'string' && delivery.workspace.includes('<commit>'));
await check('patches directory recorded', typeof delivery.patches_dir === 'string');
await check('safety tests recorded', Array.isArray(delivery.safety_tests) && delivery.safety_tests.length >= 2);
for (const testFile of delivery.safety_tests ?? []) {
  await check(`safety test exists ${testFile}`, await fs.access(path.join(projectRoot, testFile)).then(() => true, () => false), testFile);
}
await check('built entrypoint recorded', typeof delivery.built_entrypoint === 'string');
if (typeof delivery.built_entrypoint === 'string') {
  await check('built entrypoint exists in this project', await fs.access(path.join(projectRoot, delivery.built_entrypoint)).then(() => true, () => false), delivery.built_entrypoint);
}
await check('forbidden modification locations declared', Array.isArray(delivery.forbidden_locations) && delivery.forbidden_locations.length >= 2);
await check('distribution method recorded', typeof delivery.distribution === 'string' && delivery.distribution.length > 0);

if (failures.length > 0) {
  console.error(`probe-extension-delivery: ${failures.length} check(s) FAILED`);
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log('probe-extension-delivery: all checks PASS');
