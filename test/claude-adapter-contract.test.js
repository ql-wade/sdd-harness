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
const installedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-claude-reference-'));
const install = spawnSync(
  process.execPath,
  [cliPath, 'init', '--adapter', 'claude', '--skip-dependencies'],
  {
    cwd: installedProject,
    encoding: 'utf8',
    env: {
      ...process.env,
      SDD_HOME: path.join(installedProject, '.test-sdd-home'),
      SDD_WIKI_HOME: path.join(installedProject, '.test-wiki'),
    },
  },
);
assert.equal(install.status, 0, install.stderr || install.stdout);
const skillsRoot = path.join(installedProject, '.claude', 'skills');
const stages = ['grill', 'product', 'dev', 'test', 'code', 'review', 'verify', 'release', 'archive'];

test('Claude stage skills request transitions through the CLI control plane', () => {
  for (const stage of stages) {
    const skillPath = path.join(skillsRoot, `sdd-${stage}`, 'SKILL.md');
    const skill = fs.readFileSync(skillPath, 'utf8');

    assert.match(
      skill,
      new RegExp(`sdd run ${stage}\\b`),
      `${stage} must request its transition through sdd run`,
    );
    assert.doesNotMatch(
      skill,
      /workflow-frame(?:\.yaml)?\s+(?:stage\.)?current\s*=|workflow-frame(?:\.yaml)?.{0,80}(?:推进|修改|标).*stage|写\s*workflow-frame(?:\.yaml)?.{0,80}deploy_mode/iu,
      `${stage} must not mutate workflow state directly`,
    );
  }
});

test('shared Claude adapter delegates bootstrap and state changes to the CLI', () => {
  const skill = fs.readFileSync(path.join(skillsRoot, 'sdd-harness', 'SKILL.md'), 'utf8');

  assert.match(skill, /sdd run <stage>/);
  assert.match(skill, /唯一.*control plane|control plane.*唯一/iu);
  assert.doesNotMatch(skill, /mkdir -p \.sdd\/runs|echo "\$change_id" > \.sdd\/active-run/);
  assert.doesNotMatch(skill, /workflow-frame:\s*stage\.current\s*=|stage\.current\s*=\s*<target_stage>/u);
});

test('installed Claude commands and hooks preserve the CLI-owned workflow state', () => {
  for (const stage of stages) {
    assert.ok(fs.existsSync(path.join(installedProject, '.claude', 'commands', `sdd-${stage}.md`)));
  }
  const settings = JSON.parse(fs.readFileSync(
    path.join(installedProject, '.claude', 'settings.json'),
    'utf8',
  ));
  assert.ok(settings.hooks?.SessionStart);
  assert.ok(settings.hooks?.PreToolUse);
  assert.ok(settings.hooks?.PostToolUse);
  assert.ok(settings.hooks?.Stop);

  const resolver = path.join(installedProject, '.sdd', 'hooks', '_resolve-project-dir.sh');
  const wikiResolution = spawnSync(
    'bash',
    ['-c', `source ${JSON.stringify(resolver)}; printf %s "$SDD_WIKI_HOME_RESOLVED"`],
    {
      cwd: installedProject,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: installedProject,
        SDD_WIKI_HOME: path.join(installedProject, '.test-wiki'),
      },
    },
  );
  assert.equal(wikiResolution.status, 0, wikiResolution.stderr || wikiResolution.stdout);
  assert.equal(wikiResolution.stdout, path.join(installedProject, '.test-wiki'));

  const run = spawnSync(
    process.execPath,
    [cliPath, 'run', 'grill', '--goal', 'adapter integration', '--slug', 'adapter-integration'],
    { cwd: installedProject, encoding: 'utf8' },
  );
  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.match(run.stdout, /内容未达标/);
  const changeId = fs.readFileSync(path.join(installedProject, '.sdd', 'active-run'), 'utf8').trim();
  const workflowPath = path.join(installedProject, '.sdd', 'runs', changeId, 'workflow-frame.yaml');
  const beforeHook = fs.readFileSync(workflowPath, 'utf8');

  const sessionHook = spawnSync('bash', [path.join(installedProject, '.sdd', 'hooks', 'session-start.sh')], {
    cwd: installedProject,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: installedProject },
  });
  assert.equal(sessionHook.status, 0, sessionHook.stderr || sessionHook.stdout);
  assert.match(sessionHook.stdout, /Stage:\s*grill/);
  assert.equal(fs.readFileSync(workflowPath, 'utf8'), beforeHook);
});
