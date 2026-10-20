// Negative-path placement experiment only; never installs a managed runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [repoArg, buildArg, seedArg, ponyArg, openspecArg, outArg] = process.argv.slice(2);
assert(repoArg && buildArg && seedArg && ponyArg && openspecArg && outArg,
  'usage: node shared-gate-spike.mjs <repo> <fixed-build> <feasibility-output> <ponytail> <openspec-cli> <new-temp-output>');
const [repo, build, seed, pony, out] = [repoArg, buildArg, seedArg, ponyArg, outArg].map(p => path.resolve(p));
assert(out.startsWith('/private/tmp/') || out.startsWith('/tmp/'), 'experiment must stay in temporary storage');
await fs.mkdir(out); // Refuse reuse of a previous experiment.
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const records = [];
const originalStore = path.join(build, 'dist/domains/comet-classic/classic-store.js');
const originalBytes = await fs.readFile(originalStore);
const gatePath = path.join(repo, 'lib/delivery/gate.js');
const originalGate = await fs.readFile(gatePath);
const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CI: 'true', DO_NOT_TRACK: '1', OPENSPEC_TELEMETRY: '0', COMET_OPENSPEC: path.resolve(openspecArg) };
delete env.COMET_FORCE_PHASE;
delete env.COMET_SKIP_BUILD;
const run = (label, program, args, cwd, extraEnv = {}, input) => {
  const r = spawnSync(program, args, { cwd, env: { ...env, COMET_RUN_ROOT: cwd, ...extraEnv }, input, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(r.error);
  records.push({ label, exit: r.status, stdout: r.stdout.replaceAll(out, '<experiment>').replaceAll(repo, '<repo>'), stderr: r.stderr.replaceAll(out, '<experiment>').replaceAll(repo, '<repo>') });
  return r;
};
const cli = (root, workspace, label, args, extraEnv) => run(label, process.execPath, [path.join(root, 'bin/comet.js'), ...args], workspace, extraEnv);
const base = path.join(out, 'base');
await fs.cp(path.join(seed, 'workspace'), base, { recursive: true });
assert.equal(cli(build, base, 'prepare-open', ['state', 'set', 'boundary-probe', 'phase', 'open'], { COMET_FORCE_PHASE: '1' }).status, 0);
const changeRel = 'openspec/changes/boundary-probe';
// Restore the current Change delta removed by the previous negative probe.
await fs.rename(path.join(base, changeRel, 'specs/boundary/spec.md.disabled'), path.join(base, changeRel, 'specs/boundary/spec.md'));
// Prime the original Run before comparing mutations; native guard preview may
// initialize it even without advancing the phase.
assert.equal(cli(build, base, 'prepare-original-run', ['guard', 'boundary-probe', 'open', '--json']).status, 0);
assert.equal(cli(build, base, 'prepare-phase-readback', ['state', 'get', 'boundary-probe', 'phase']).stdout.trim(), 'open');
const candidate = path.join(out, 'candidate');
await fs.mkdir(candidate);
for (const item of ['bin', 'dist', 'package.json']) await fs.cp(path.join(build, item), path.join(candidate, item), { recursive: true });
await fs.symlink(path.join(build, 'node_modules'), path.join(candidate, 'node_modules'));
const fixtureInputs = {
  inputDigest: sha('isolated-placement-candidate'), builderExecution: 'placement-builder',
  testContract: { schemaVersion: 1, project: 'placement-lab', change: 'boundary-probe',
    cases: [{ id: 'R1', ac: 'R', oracle: 'missing independently admitted requirement evidence blocks open advancement' }],
    requiredChecks: [{ level: 'requirement', capability: 'required-method:grill-me' }],
    executionDenominator: { totalCases: 1 }, cleanup: { environment: 'temporary copy', data: 'no business data' },
    dependencyBaselines: [{ kind: 'product', digest: sha('placement-lab') }] }
};
// Deliberately no positive evidence or signer: this experiment only asks whether
// a real blocked Gate verdict reaches every tested persistence/recovery path.
const bridge = `import { evaluate } from ${JSON.stringify(pathToFileURL(gatePath).href)};
export function requireOpenEvidence(before, after) {
  if (before?.phase !== 'open' || after?.phase !== 'design') return;
  const result = evaluate(${JSON.stringify(fixtureInputs)}, [], ${JSON.stringify({ ref: 'placement-only', digest: sha('placement-policy') })});
  if (result.verdict !== 'pass') throw new Error('SDD_PLACEMENT_BLOCKED: ' + result.receipt.blocked.join('; '));
}
`;
const storeRel = 'dist/domains/comet-classic/classic-store.js';
await fs.writeFile(path.join(candidate, 'dist/domains/comet-classic/placement-only.mjs'), bridge);
let patched = `import { requireOpenEvidence } from './placement-only.mjs';\n` + originalBytes.toString();
const writeAnchor = '    const afterYaml = document.toString();';
const recoveryAnchor = '    const run = checkedRun(actual === transaction.afterYaml ? transaction.afterRun : transaction.beforeRun);';
assert.equal(patched.split(writeAnchor).length, 2);
assert.equal(patched.split(recoveryAnchor).length, 2);
patched = patched.replace(writeAnchor, writeAnchor + '\n    requireOpenEvidence(beforeYaml === null ? null : parseDocument(beforeYaml).toJS(), parseDocument(afterYaml).toJS());');
patched = patched.replace(recoveryAnchor, '    if (actual === transaction.afterYaml) requireOpenEvidence(transaction.beforeYaml === null ? null : parseDocument(transaction.beforeYaml).toJS(), parseDocument(transaction.afterYaml).toJS());\n' + recoveryAnchor);
await fs.writeFile(path.join(candidate, storeRel), patched);
const cases = [];
for (const kind of ['guard', 'transition', 'forced-set']) {
  for (const [variant, root] of [['native', build], ['placement', candidate]]) {
    const workspace = path.join(out, `${kind}-${variant}`);
    await fs.cp(base, workspace, { recursive: true });
    const before = await fs.readFile(path.join(workspace, changeRel, '.comet.yaml'));
    const args = kind === 'guard' ? ['guard', 'boundary-probe', 'open', '--apply', '--json']
      : kind === 'transition' ? ['state', 'transition', 'boundary-probe', 'open-complete', '--json']
        : ['state', 'set', 'boundary-probe', 'phase', 'design'];
    const result = cli(root, workspace, `${kind}-${variant}`, args, kind === 'forced-set' ? { COMET_FORCE_PHASE: '1' } : {});
    const readback = cli(root, workspace, `${kind}-${variant}-readback`, ['state', 'get', 'boundary-probe', 'phase']);
    assert.equal(readback.status, 0);
    if (variant === 'placement') {
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /SDD_PLACEMENT_BLOCKED/);
      assert.equal(readback.stdout.trim(), 'open');
      assert.deepEqual(await fs.readFile(path.join(workspace, changeRel, '.comet.yaml')), before);
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readback.stdout.trim(), 'design');
    }
    cases.push({ kind, variant, exit: result.status, phase: readback.stdout.trim() });
  }
}
// Construct an interrupted, YAML-committed native transaction. This is a fault
// fixture, not evidence that an unprivileged worker can write the journal.
const { readRunState } = await import(pathToFileURL(path.join(build, 'dist/domains/engine/state.js')));
for (const [variant, root] of [['native', build], ['placement', candidate]]) {
  const workspace = path.join(out, `recovery-${variant}`);
  await fs.cp(base, workspace, { recursive: true });
  const directory = path.join(workspace, changeRel);
  const beforeYaml = await fs.readFile(path.join(directory, '.comet.yaml'), 'utf8');
  const beforeRun = await readRunState(directory);
  assert.equal(cli(build, workspace, `recovery-${variant}-fixture`, ['state', 'transition', 'boundary-probe', 'open-complete']).status, 0);
  const afterYaml = await fs.readFile(path.join(directory, '.comet.yaml'), 'utf8');
  const afterRun = await readRunState(directory);
  const journal = path.join(directory, '.comet-state-transaction.json');
  await fs.writeFile(journal, JSON.stringify({ schema: 'comet.classic.state-transaction.v1', beforeYaml, afterYaml, beforeRun, afterRun }));
  const read = cli(root, workspace, `journal-read-${variant}`, ['state', 'get', 'boundary-probe', 'phase']);
  assert.equal(read.status, 0); assert.equal(read.stdout.trim(), 'design');
  if (variant === 'placement') await fs.access(journal);
  const r = cli(root, workspace, `recovery-${variant}`, ['state', 'set', 'boundary-probe', 'review_mode', 'standard']);
  if (variant === 'native') { assert.equal(r.status, 0); }
  else {
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /SDD_PLACEMENT_BLOCKED/);
    await fs.access(journal);
    assert.equal(await fs.readFile(path.join(directory, '.comet.yaml'), 'utf8'), afterYaml);
  }
  cases.push({ kind: 'committed-journal-recovery', variant, exit: r.status,
    scalarRead: 'design visible before recovery',
    result: variant === 'native' ? 'native continuation allowed' : 'locked operation refused; committed YAML preserved, journal retained; not rollback' });
}
const hook = file => path.join(pony, 'hooks', file);
const hookEnv = data => ({ PLUGIN_DATA: path.join(out, data), CLAUDE_CONFIG_DIR: path.join(out, 'host-config'), CLAUDE_PROJECT_DIR: base, XDG_CONFIG_HOME: path.join(out, 'config'), PONYTAIL_DEFAULT_MODE: 'full', PONYTAIL_MAP: '0', COPILOT_PLUGIN_DATA: '' });
for (const data of ['role-a', 'role-b']) {
  const r = run(`ponytail-${data}-start`, process.execPath, [hook('ponytail-activate.js')], base, hookEnv(data), JSON.stringify({ source: 'startup' }));
  assert.equal(r.status, 0); assert.match(r.stdout, /PONYTAIL MODE ACTIVE.*full/s);
}
assert.equal(run('ponytail-a-lite', process.execPath, [hook('ponytail-mode-tracker.js')], base, hookEnv('role-a'), JSON.stringify({ prompt: '/ponytail lite' })).status, 0);
for (const [data, mode] of [['role-a', 'lite'], ['role-b', 'full']]) {
  const r = run(`ponytail-${data}-readback`, process.execPath, [hook('ponytail-subagent.js')], base, hookEnv(data), '{}');
  assert.equal(r.status, 0); assert.match(r.stdout, new RegExp(`PONYTAIL MODE ACTIVE.*${mode}`, 's'));
}
assert.deepEqual(await fs.readFile(originalStore), originalBytes);
assert.deepEqual(await fs.readFile(gatePath), originalGate);
const result = { scope: 'negative-path placement spike; NOT a managed runtime or accepted implementation',
  provenance: { upstreamStoreSha256: sha(originalBytes), candidateStoreSha256: sha(patched), bridgeSha256: sha(bridge), gateSha256: sha(originalGate), probeSha256: sha(await fs.readFile(new URL(import.meta.url))), upstreamLockSha256: sha(await fs.readFile(path.join(repo, 'integrations/comet/upstream.lock.json'))), node: process.versions.node },
  cases, ponytailSeparateDataScopes: 'lite/full independently observed',
  limitations: ['No accepted-receipt/happy path; empty receipts intentionally block', 'Only open-to-design tested; no all-phase guarantee', 'Committed YAML remains readable as design before locked recovery; refusal does not roll it back', 'Control-file tamper resistance and real independent identities not tested', 'Ponytail script execution, not native host event delivery', 'OVR and production installation remain pending'],
  records: records.map(r => r.label.startsWith('ponytail-') ? { label: r.label, exit: r.exit, stdoutSha256: sha(r.stdout) } : r) };
await fs.writeFile(path.join(out, 'shared-gate-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ cases, ponytailSeparateDataScopes: result.ponytailSeparateDataScopes, result: path.join(out, 'shared-gate-results.json') }));
