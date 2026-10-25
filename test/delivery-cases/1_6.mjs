// P1_6 supplier qualification only. These installation and source checks do not
// certify real roles, review provenance, business gates, or the complete Run.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import '../comet-method-binding.test.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lockFile = process.env.P16_COMET_LOCK ?? 'integrations/comet/upstream.lock.json';
const lock = JSON.parse(await fs.readFile(path.resolve(root, lockFile), 'utf8'));
const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const build = path.join(root, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
const entry = path.join(build, 'work/bin/comet.js');
const node = process.versions.node === lock.toolchain.node ? process.execPath
  : path.join(process.env.HOME, '.nvm/versions/node', `v${lock.toolchain.node}`, 'bin/node');

async function initFixture(t, language) {
  await fs.access(path.join(build, 'distribution.json')); // Required case: absence is nonzero UNVERIFIED, never skip/PASS.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'method-init-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const project = path.join(scratch, 'project');
  const home = path.join(scratch, 'home');
  const stubs = path.join(scratch, 'stubs');
  for (const dir of [project, home, stubs]) await fs.mkdir(dir);
  const calls = path.join(scratch, 'install-calls.txt');
  for (const name of ['npm', 'npx']) {
    await fs.writeFile(path.join(stubs, name), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$P16_INSTALL_CALLS"\nexit 0\n', { mode: 0o755 });
  }
  await fs.writeFile(path.join(stubs, 'openspec'), '#!/bin/sh\nexec "$P16_NODE" "$P16_OPENSPEC_ENTRY" "$@"\n', { mode: 0o755 });
  const env = {
    ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
    PATH: `${stubs}:${path.dirname(node)}:${process.env.PATH ?? ''}`,
    P16_INSTALL_CALLS: calls, P16_NODE: node, PYTHONDONTWRITEBYTECODE: '1',
    P16_OPENSPEC_ENTRY: path.join(root, '.sdd/tools/openspec-1.11.0/node_modules/@fission-ai/openspec/bin/openspec.js'),
    OPENSPEC_TELEMETRY: '0', CI: 'true',
  };
  const run = (args) => {
    const result = spawnSync(node, [entry, ...args], { cwd: project, env, encoding: 'utf8', timeout: 180000 });
    assert.ifError(result.error);
    return { ...result, output: `${result.stdout}\n${result.stderr}` };
  };
  const installed = run(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', language]);
  assert.equal(installed.status, 0, installed.output);
  return { project, calls, run, skills: path.join(project, '.claude/skills'), installed };
}

for (const language of ['en', 'zh']) {
  test(`M01 supplier: real Classic init distributes Matt methods in ${language}, without activating a controller`, async (t) => {
    const { calls, skills, project, run } = await initFixture(t, language);
    const body = await fs.readFile(path.join(skills, 'comet-design/SKILL.md'), 'utf8');
    assert.match(body, /grill-me/);
    assert.doesNotMatch(body, /load the Superpowers `brainstorming`|加载 Superpowers `brainstorming`/);
    const protocol = await fs.readFile(path.join(skills, 'comet-classic/reference/method-profile.md'), 'utf8');
    assert.match(protocol, /comet-managed-v2/);
    assert.match(protocol, /UNQUALIFIED/);
    assert.match(protocol, /multi-agent-consensus-review/);
    assert.match(protocol, /test-authoring/);
    assert.match(protocol, /whitebox-verify/);
    const diagnostic = run(['doctor', project, '--scope', 'project', '--json']);
    const methods = JSON.parse(diagnostic.stdout).results.find((item) => item.check === 'Project methods');
    assert.equal(methods.status, 'warn');
    assert.match(methods.message, /UNQUALIFIED/);
    assert.doesNotMatch(methods.message, /npx skills add obra\/superpowers/);
    assert.doesNotMatch(await fs.readFile(calls, 'utf8').catch(() => ''), /obra\/superpowers/);
    for (const skill of ['comet-open', 'comet-design', 'comet-build', 'comet-verify', 'comet-archive']) {
      const installed = await fs.readFile(path.join(skills, skill, 'SKILL.md'), 'utf8');
      const source = await fs.readFile(path.join(build, 'work/assets', language === 'zh' ? 'skills-zh' : 'skills', skill, 'SKILL.md'), 'utf8');
      assert.equal(installed, source, `${skill} installation lost the patched method binding`);
    }
  });
}

test('M01 supplier: update keeps residual user methods but never reinstalls the disabled dependency', async (t) => {
  const { project, skills, calls, run } = await initFixture(t, 'en');
  const residual = path.join(skills, 'brainstorming');
  await fs.mkdir(residual, { recursive: true });
  const userBody = '# pre-existing user method, outside Comet ownership\n';
  await fs.writeFile(path.join(residual, 'SKILL.md'), userBody);
  const updated = run(['update', project, '--scope', 'project', '--current-project', '--skip-self-update', '--language', 'en', '--json']);
  assert.equal(updated.status, 0, updated.output);
  assert.doesNotMatch(await fs.readFile(calls, 'utf8').catch(() => ''), /obra\/superpowers/);
  assert.equal(await fs.readFile(path.join(residual, 'SKILL.md'), 'utf8'), userBody);
});
