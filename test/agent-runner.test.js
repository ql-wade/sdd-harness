import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  resolveAgentRunner,
  resolveCodexExecutable,
  writeSessionHandoff,
} from '../lib/agent-runner.js';

const cli = path.resolve('bin/cli.js');

test('auto selects the current Codex session and never falls through to Claude', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-runner-'));
  await fs.ensureDir(path.join(cwd, '.claude'));

  assert.equal(resolveAgentRunner('auto', {
    cwd,
    env: { CODEX_THREAD_ID: 'thread-123' },
  }), 'session');
});

test('auto selects Claude only for a pure Claude project', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-runner-'));
  await fs.ensureDir(path.join(cwd, '.claude'));

  assert.equal(resolveAgentRunner('auto', { cwd, env: {} }), 'claude');

  await fs.ensureDir(path.join(cwd, '.agents', 'skills'));
  assert.equal(resolveAgentRunner('auto', { cwd, env: {} }), 'session');
});

test('Codex executable resolution honors option, env, then PATH', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-runner-'));
  const explicit = path.join(cwd, 'explicit-codex.exe');
  const fromEnv = path.join(cwd, 'env-codex.exe');
  await fs.writeFile(explicit, '');
  await fs.writeFile(fromEnv, '');

  assert.equal(resolveCodexExecutable({
    agentBin: explicit,
    env: { SDD_CODEX_BIN: fromEnv, PATH: '' },
  }), explicit);
  assert.equal(resolveCodexExecutable({
    env: { SDD_CODEX_BIN: fromEnv, PATH: '' },
  }), fromEnv);
  assert.equal(resolveCodexExecutable({
    env: { PATH: '' },
    findOnPath: () => 'C:\\tools\\codex.exe',
  }), 'C:\\tools\\codex.exe');
});

test('session handoff is written under the run and names the current skill', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-handoff-'));
  const result = await writeSessionHandoff({
    cwd,
    runId: 'feature-1',
    operation: 'fill-grill',
    skill: 'sdd-grill',
    prompt: 'Continue the grill stage.',
  });

  assert.match(result.path.replaceAll('\\', '/'), /\.sdd\/runs\/feature-1\/fill-grill-handoff\.md$/);
  assert.match(await fs.readFile(result.path, 'utf8'), /\$sdd-grill/);
});

test('fill session runner returns exit 3 with a handoff instead of invoking Claude', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-fill-session-'));
  const changeId = 'feature-1';
  await fs.outputFile(path.join(cwd, '.sdd', 'active-run'), changeId);
  await fs.outputFile(
    path.join(cwd, '.sdd', 'runs', changeId, 'workflow-frame.yaml'),
    'goal: "Test Codex session"\nstage:\n  current: grill\n',
  );

  const result = spawnSync(
    process.execPath,
    [cli, 'fill', 'grill', '--runner', 'auto'],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CODEX_THREAD_ID: 'thread-123' },
    },
  );

  assert.equal(result.status, 3, result.stderr || result.stdout);
  assert.match(result.stdout, /等待当前 agent 执行/);
  assert.equal(
    await fs.pathExists(path.join(cwd, '.sdd', 'runs', changeId, 'fill-grill-handoff.md')),
    true,
  );
});

test('a started Codex process that exits non-zero reports runtime and login guidance', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-fill-codex-fail-'));
  const changeId = 'feature-1';
  await fs.outputFile(path.join(cwd, '.sdd', 'active-run'), changeId);
  await fs.outputFile(
    path.join(cwd, '.sdd', 'runs', changeId, 'workflow-frame.yaml'),
    'goal: "Test Codex failure guidance"\nstage:\n  current: product\n',
  );
  await fs.ensureDir(path.join(cwd, 'openspec', 'changes', changeId));

  const result = spawnSync(
    process.execPath,
    [
      cli,
      'fill', 'product',
      '--runner', 'codex',
      '--agent-bin', process.execPath,
    ],
    { cwd, encoding: 'utf8', env: { ...process.env, CODEX_THREAD_ID: '' } },
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /codex login/);
  assert.match(result.stdout, /--agent-bin/);
});

test('graph without --refresh reports health and does not start an agent', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-graph-health-'));
  const sddHome = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-home-'));
  await fs.ensureDir(path.join(sddHome, 'repos', 'Understand-Anything'));

  const result = spawnSync(process.execPath, [cli, 'graph'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SDD_HOME: sddHome, CODEX_THREAD_ID: 'thread-123' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /missing or placeholder/);
  assert.doesNotMatch(result.stdout, /等待当前 agent 执行|Triggering/);
});

test('graph refresh with session runner returns exit 3 and writes a handoff', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-graph-session-'));
  const sddHome = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-home-'));
  await fs.ensureDir(path.join(sddHome, 'repos', 'Understand-Anything'));

  const result = spawnSync(
    process.execPath,
    [cli, 'graph', '--refresh', '--runner', 'auto'],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, SDD_HOME: sddHome, CODEX_THREAD_ID: 'thread-123' },
    },
  );

  assert.equal(result.status, 3, result.stderr || result.stdout);
  assert.match(result.stdout, /等待当前 agent 执行/);
  const handoffs = await fs.readdir(path.join(cwd, '.sdd', 'runs'));
  assert.equal(handoffs.length, 1);
});
