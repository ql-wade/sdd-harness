import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const cli = path.resolve('bin/cli.js');

test('Codex-only init installs official skills and managed AGENTS block without Claude assets', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-codex-init-'));
  await fs.outputFile(path.join(cwd, 'AGENTS.md'), '# Existing guidance\n');
  await fs.ensureDir(path.join(cwd, '.codex', 'skills', 'legacy-skill'));

  const runInit = () => spawnSync(
    process.execPath,
    [
      cli,
      'init',
      '--platform', 'codex',
      '--skip-dependencies',
      '--skip-schema',
      '--skip-commands',
    ],
    { cwd, encoding: 'utf8', env: { ...process.env, SDD_HOME: path.join(cwd, '.test-sdd-home') } },
  );

  const first = runInit();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /\.codex\/skills.*迁移|迁移.*\.codex\/skills/);

  const skillRoot = path.join(cwd, '.agents', 'skills');
  const sddSkills = (await fs.readdir(skillRoot)).filter(name => name.startsWith('sdd-'));
  assert.equal(sddSkills.length, 10);
  assert.equal(await fs.pathExists(path.join(cwd, '.claude')), false);
  assert.equal(await fs.pathExists(path.join(cwd, '.codex', 'config.toml')), false);
  assert.equal(await fs.pathExists(path.join(cwd, '.codex', 'skills', 'legacy-skill')), true);

  const agentsAfterFirst = await fs.readFile(path.join(cwd, 'AGENTS.md'), 'utf8');
  assert.match(agentsAfterFirst, /<!-- SDD-HARNESS:START -->/);
  assert.match(agentsAfterFirst, /\.sdd\/runs\/<run-id>\/workflow-frame\.yaml/);

  const second = runInit();
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const agentsAfterSecond = await fs.readFile(path.join(cwd, 'AGENTS.md'), 'utf8');
  assert.equal(agentsAfterSecond, agentsAfterFirst);
  assert.equal((agentsAfterSecond.match(/SDD-HARNESS:START/g) || []).length, 1);
});
