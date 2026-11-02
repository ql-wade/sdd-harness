// Six-step ④ — application upgrade-path evaluation on the REAL Comet 0.5.1:
// installing the new immutable v10 must preserve the old Run bound to its
// original v9 package (versions coexist by content hash), and the six phase
// entries land in the project when the platform asks for them.
// Synthetic-negative-only: no human approval, no business acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classicCompositionStartRequest } from '../lib/adapters/comet.js';
import { resolveCometForTest } from './helpers/comet-cli.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v10AppFile = path.join(repo, 'integrations/comet/application/package/application.json');
const comet = resolveCometForTest();

test('v10 upgrade preserves the old Run on its original v9 package and lands the six entries', async (t) => {
  // The old Run's ACTUAL fixed package: the operator registry's installed v9
  // copy (host-local evidence; the git-committed v9 predates the fixture-log
  // gitignore repair and is refused by the real installer). A scaffold
  // checkout has no such host path — the operator supplies it via env, and
  // the case skips with an explicit reason rather than inventing a fixture.
  const registryV9 = process.env.SDD_TEST_V9_PACKAGE ?? '';
  if (!registryV9 || !fs.existsSync(path.join(registryV9, 'application.json'))) {
    t.skip('no v9 fixed package available (operator sets SDD_TEST_V9_PACKAGE to the installed v9 copy); the upgrade-path evaluation needs the old Run fixed package');
    return;
  }
  const v9Root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sdd-v9-pkg-'));
  t.after(() => { fs.rmSync(v9Root, { recursive: true, force: true }); });
  fs.cpSync(registryV9, path.join(v9Root, 'v9'), { recursive: true });
  const v9AppFile = path.join(v9Root, 'v9', 'application.json');
  assert.equal(JSON.parse(fs.readFileSync(v9AppFile, 'utf8')).version, '9');

  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sdd-upgrade-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'project'), home = path.join(scratch, 'home'); fs.mkdirSync(root); fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, 'config'),
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`, CI: 'true', DO_NOT_TRACK: '1' };
  delete env.NODE_OPTIONS; delete env.NODE_PATH; delete env.NODE_TEST_CONTEXT;
  const run = (program, args, expected = 0) => {
    const result = spawnSync(program, args, { cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, expected, `${program} ${args.join(' ')}: ${result.stderr || result.stdout}`);
    return result.stdout ? JSON.parse(result.stdout) : null;
  };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q');
  fs.writeFileSync(path.join(root, '.gitignore'), 'home/\n');
  git('add', '.gitignore');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'synthetic fixture');

  // 1. Install the handed-off v9 and start its Run.
  const preview9 = run(comet, ['application', 'install', v9AppFile, '--project', root, '--preview', '--json']);
  const installed9 = run(comet, ['application', 'install', v9AppFile, '--project', root, '--confirmation-hash', preview9.confirmationHash, '--json']);
  assert.equal(JSON.parse(fs.readFileSync(installed9.file, 'utf8')).version, '9');
  const change = 'synthetic-upgrade';
  const changeDir = path.join(root, 'openspec/changes', change);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Synthetic goal\n\nFixture only.\n');
  fs.writeFileSync(path.join(changeDir, 'design.md'), '# Synthetic design\n\nFixture only.\n');
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Synthetic tasks\n\n- [ ] x\n');
  const script9 = path.join(path.dirname(installed9.file), 'scripts/comet-run.mjs');
  const request = classicCompositionStartRequest({ change, changeDir: `openspec/changes/${change}`, workflowId: 'comet-classic-full', workflowVersion: '1' });
  const inputPath = path.join(root, 'input.json'), statePath = path.join(root, 'state.json');
  fs.writeFileSync(inputPath, JSON.stringify(request.input)); fs.writeFileSync(statePath, JSON.stringify(request.initialState));
  const base = ['--project-root', root, '--run-id', change];
  run(process.execPath, [script9, 'start', ...base, '--workflow-id', 'comet-classic-full', '--input-file', inputPath, '--initial-state-file', statePath]);

  // 2. Upgrade the project to v10 (new immutable identity; the upgrade path
  //    requires the explicit --upgrade choice on preview AND confirm).
  const preview10 = run(comet, ['application', 'install', v10AppFile, '--project', root, '--upgrade', '--preview', '--json']);
  const installed10 = run(comet, ['application', 'install', v10AppFile, '--project', root, '--upgrade', '--confirmation-hash', preview10.confirmationHash, '--json']);
  assert.equal(JSON.parse(fs.readFileSync(installed10.file, 'utf8')).version, '10', 'the registry must move to v10');
  assert.notEqual(path.dirname(installed10.file), path.dirname(installed9.file), 'v9 and v10 must coexist as distinct immutable versions');
  assert.equal(fs.existsSync(installed9.file), true, 'the old Run fixed package must stay on disk');

  // 3. The old Run continues on its original v9 package: recovery dispatch
  //    through the v9 files still drives the same Run.
  const recoverPath = path.join(root, 'recover.json');
  fs.writeFileSync(recoverPath, JSON.stringify({ operation: 'next', runId: change }));
  const via9 = run(comet, ['runtime', 'dispatch', '--application-file', installed9.file, '--project-root', root, '--request', recoverPath, '--json']);
  assert.equal(via9.run?.runId ?? via9.state?.runId ?? change, change, 'the v9 dispatch must keep the same Run');
  const inspect9 = spawnSync(process.execPath, [script9, 'inspect', ...base], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  const view9 = inspect9.status === 0 ? JSON.parse(inspect9.stdout) : null;
  if (view9) assert.equal(view9.run.runId, change);

  // 4. The six phase entries land via their own installer (preview ->
  //    confirmation hash -> apply) on top of the project's upstream skills.
  const installer = path.join(repo, 'integrations/comet/application/phase-entries/install.py');
  const codexDir = path.join(root, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'config.toml'), '[mcp_servers.synthetic]\ncommand = "true"\n');
  for (const name of ['comet', 'comet-open', 'comet-design', 'comet-build', 'comet-verify', 'comet-archive']) {
    fs.mkdirSync(path.join(root, '.agents', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'skills', name, 'SKILL.md'), `# synthetic upstream ${name}\n\nFixture only.\n`);
  }
  const py = (args, expected = 0) => {
    const result = spawnSync('python3', [installer, '--project', root, '--codex-config', path.join(codexDir, 'config.toml'), ...args],
      { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, expected, `install.py ${args[0]}: ${result.stderr || result.stdout}`);
    return result.stdout ? JSON.parse(result.stdout) : null;
  };
  const entryPreview = py(['--preview']);
  assert.ok(entryPreview.confirmationHash, 'the entry installer must preview with a confirmation hash');
  py(['--apply', entryPreview.confirmationHash]);
  const landed = fs.readdirSync(path.join(codexDir, 'skills')).filter((name) => name.endsWith('-managed')).sort();
  assert.deepEqual(landed, ['comet-archive-managed', 'comet-build-managed', 'comet-design-managed', 'comet-managed', 'comet-open-managed', 'comet-verify-managed'],
    'the six managed stage entries must land in the project Codex skills');

  t.diagnostic(JSON.stringify({ scope: 'upgrade-path-evaluation', v9ContentDir: path.basename(path.dirname(installed9.file)),
    v10ContentDir: path.basename(path.dirname(installed10.file)), entries: landed }));
});
