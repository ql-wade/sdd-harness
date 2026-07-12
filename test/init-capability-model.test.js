import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const cliPath = path.join(repoRoot, 'bin', 'cli.js');

function runInit(args) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-init-capabilities-'));
  return spawnSync(process.execPath, [cliPath, 'init', '--dry-run', ...args], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SDD_HOME: path.join(project, '.test-sdd-home') },
  });
}

test('init installs a light core unless adapter capabilities are explicitly requested', () => {
  const core = runInit([]);
  assert.equal(core.status, 0, core.stderr || core.stdout);
  assert.match(core.stdout, /Core/i);
  assert.doesNotMatch(core.stdout, /open-code-review|LLMWiki|Understand-Anything|grill-me|Superpowers/i);

  const full = runInit(['--adapter', 'claude', '--with', 'wiki,graph,review']);
  assert.equal(full.status, 0, full.stderr || full.stdout);
  assert.match(full.stdout, /Claude Code/);
  assert.match(full.stdout, /open-code-review/);
  assert.match(full.stdout, /LLMWiki/);
  assert.match(full.stdout, /Understand-Anything/);
});

test('init can install an adapter without mutating global dependency state', () => {
  const isolated = runInit(['--adapter', 'claude', '--skip-dependencies']);
  assert.equal(isolated.status, 0, isolated.stderr || isolated.stdout);
  assert.match(isolated.stdout, /Skipping dependency installation/i);
  assert.match(isolated.stdout, /Claude Code/);
  assert.doesNotMatch(isolated.stdout, /Would clone|grill-me \+ grilling/i);
});

test('default doctor checks Core without requiring optional stage capabilities', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-core-doctor-'));
  const env = {
    ...process.env,
    SDD_HOME: path.join(project, '.test-sdd-home'),
    SDD_WIKI_HOME: path.join(project, '.test-wiki'),
  };
  const init = spawnSync(process.execPath, [cliPath, 'init', '--skip-dependencies'], {
    cwd: project,
    encoding: 'utf8',
    env,
  });
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const doctor = spawnSync(process.execPath, [cliPath, 'doctor'], {
    cwd: project,
    encoding: 'utf8',
    env,
  });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.match(doctor.stdout, /Core and installed adapter checks passed/i);
  assert.doesNotMatch(doctor.stdout, /open-code-review 缺失|LLMWiki repo 缺失|Skills directory missing/i);
});
