// Read-only compatibility observation. All CLI writes use disposable scratch homes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const out = path.join(root, '.local/p1_5-probe-repair/observations');
await fs.mkdir(out, { recursive: true });
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const lock = JSON.parse(await fs.readFile(path.join(root, 'integrations/comet/upstream.lock.json')));
const fingerprint = sha(JSON.stringify({ archive: lock.source.sha256, patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })), toolchain: lock.toolchain }));
const modulePath = path.join(root, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint, 'work/dist/domains/comet-classic/classic-artifact-requirements.js');
const { requiredArtifactClosure } = await import(pathToFileURL(modulePath));
const observations = [];
async function capture(id, argv, cwd, env) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', timeout: 30_000 });
  const finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, `${id}.stdout.txt`), result.stdout ?? '', { flag: 'wx' });
  await fs.writeFile(path.join(out, `${id}.stderr.txt`), result.stderr ?? '', { flag: 'wx' });
  const command = { argv, cwd, startedAt, finishedAt, exit: result.status, stdoutSha256: sha(result.stdout ?? ''), stderrSha256: sha(result.stderr ?? '') };
  await fs.writeFile(path.join(out, `${id}.command.json`), JSON.stringify(command, null, 2) + '\n', { flag: 'wx' });
  if (result.status !== 0) throw new Error(`${id}: CLI observation failed`);
  return result.stdout;
}
for (const [id, cli] of [
  ['current-host-1143', ['openspec']],
  ['isolated-1110', [process.execPath, path.join(root, '.sdd/tools/openspec-1.11.0/node_modules/@fission-ai/openspec/bin/openspec.js')]],
]) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p15-c08-observe-'));
  try {
    const change = path.join(scratch, 'openspec/changes/demo');
    await fs.mkdir(change, { recursive: true });
    await fs.writeFile(path.join(scratch, 'openspec/config.yaml'), 'schema: spec-driven\n');
    await fs.writeFile(path.join(change, '.openspec.yaml'), 'schema: spec-driven\nskip_specs: true\n');
    await fs.writeFile(path.join(change, 'proposal.md'), '# Proposal\nPure refactor.\n');
    await fs.writeFile(path.join(change, 'tasks.md'), '- [ ] Refactor and test\n');
    const env = { ...process.env, HOME: scratch, USERPROFILE: scratch, XDG_CONFIG_HOME: path.join(scratch, 'config'), CI: 'true', DO_NOT_TRACK: '1', OPENSPEC_TELEMETRY: '0' };
    const version = (await capture(`${id}-version`, [...cli, '--version'], scratch, env)).trim();
    const status = JSON.parse(await capture(`${id}-status`, [...cli, 'status', '--change', 'demo', '--json'], scratch, env));
    const closure = requiredArtifactClosure(status);
    observations.push({ id, version, scope: 'CLI status/pure closure only', dependencyEdgesExposed: status.artifacts.every((item) => Array.isArray(item.requires)), closure: Object.fromEntries(closure.map(({ id, status }) => [id, status])) });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
const legacyPath = 'openspec/changes/delivery-foundation-rearchitecture/package-probes/1_1.b-green-openspec-status-131-input.json';
const legacy = await fs.readFile(path.join(root, legacyPath));
try { requiredArtifactClosure(JSON.parse(legacy)); throw new Error('legacy response unexpectedly accepted'); }
catch (error) {
  if (error.message !== 'OpenSpec must expose dependency edges for every artifact; upgrade to a supported version') throw error;
  observations.push({ id: 'historical-131-response-replay', version: '1.3.1', observation: 'HISTORICAL_RESPONSE_REPLAY', input: legacyPath, sha256: sha(legacy), bytes: legacy.length, result: 'REJECTED', error: error.message });
}
const summary = { node: process.versions.node, fingerprint, predicateSha256: sha(await fs.readFile(modulePath)), observations, methodExecution: 'NOT_EXECUTED', wholeQualification: 'NOT_VERIFIED' };
await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
