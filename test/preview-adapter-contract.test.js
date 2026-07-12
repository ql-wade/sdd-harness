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
const stages = ['grill', 'product', 'dev', 'test', 'code', 'review', 'verify', 'release', 'archive'];

function installPreviewAdapter(adapter) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), `sdd-${adapter}-preview-`));
  const result = spawnSync(
    process.execPath,
    [cliPath, 'init', '--adapter', adapter, '--skip-dependencies'],
    {
      cwd: project,
      encoding: 'utf8',
      env: {
        ...process.env,
        SDD_HOME: path.join(project, '.test-sdd-home'),
        SDD_WIKI_HOME: path.join(project, '.test-wiki'),
      },
    },
  );
  return { project, result };
}

for (const adapter of ['codex', 'opencode']) {
  test(`${adapter} preview adapter installs stage skills without Claude-only hooks`, () => {
    const { project, result } = installPreviewAdapter(adapter);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const stage of stages) {
      const skill = path.join(project, `.${adapter}`, 'skills', `sdd-${stage}`, 'SKILL.md');
      assert.ok(fs.existsSync(skill), `${adapter} is missing ${stage}`);
      const content = fs.readFileSync(skill, 'utf8');
      assert.match(content, new RegExp(`sdd run ${stage}\\b`));
      assert.match(content, new RegExp(`adapter:\\s*${adapter}`));
      assert.match(content, /support:\s*preview/);
      assert.doesNotMatch(content, /Superpowers verdict|OCR 评论|mcp__llmwiki__/);
    }

    assert.equal(fs.existsSync(path.join(project, '.claude', 'commands')), false);
    assert.equal(fs.existsSync(path.join(project, '.sdd', 'hooks')), false);
  });
}
