import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateStageCapabilities } from '../lib/capabilities.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const cliPath = path.join(repoRoot, 'bin', 'cli.js');

test('stage doctor reports missing verify capabilities as a machine-readable gate', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-capability-doctor-'));
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({
      scripts: { test: 'node --test' },
      devDependencies: { vite: '^5.0.0' },
    }),
  );

  const result = spawnSync(
    process.execPath,
    [cliPath, 'doctor', '--stage', 'verify', '--json'],
    { cwd: project, encoding: 'utf8' },
  );

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.stage, 'verify');
  assert.equal(report.pass, false);
  assert.ok(report.capabilities.some((item) => item.id === 'project-tests' && item.status === 'available'));
  assert.ok(report.capabilities.some((item) => item.id === 'runtime-probe' && item.status === 'missing'));
  assert.ok(report.capabilities.every((item) => ['available', 'missing', 'not-applicable'].includes(item.status)));
});

test('adapter files do not impersonate an unavailable agent host', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-capability-host-'));
  fs.mkdirSync(path.join(project, '.codex', 'skills', 'sdd-grill'), { recursive: true });
  const originalPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const report = evaluateStageCapabilities({ projectDir: project, stage: 'grill' });
    assert.equal(report.pass, false);
    assert.ok(report.capabilities.some((item) => item.id === 'agent-host' && item.status === 'missing'));
    assert.ok(report.capabilities.some((item) => item.id === 'discovery' && item.status === 'missing'));
  } finally {
    process.env.PATH = originalPath;
  }
});

test('knowledge-base configuration requires its server command to exist', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-capability-wiki-'));
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({
    mcpServers: { llmwiki: { command: 'definitely-missing-llmwiki-command' } },
  }));
  const originalPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const report = evaluateStageCapabilities({ projectDir: project, stage: 'test' });
    assert.equal(report.pass, false);
    assert.ok(report.capabilities.some((item) => item.id === 'knowledge-base' && item.status === 'missing'));
  } finally {
    process.env.PATH = originalPath;
  }
});
