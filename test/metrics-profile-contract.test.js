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
const coreMetricsPath = path.join(repoRoot, 'templates', 'sdd-harness', 'stage-metrics.yaml');
const minicraftProfilePath = path.join(
  repoRoot,
  'templates',
  'sdd-harness',
  'probe-profiles',
  'minicraft.yaml',
);

function makeProject() {
  const changeId = 'profile-minicraft-a1b2';
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-profile-'));
  const changeDir = path.join(project, 'openspec', 'changes', changeId);
  const runsDir = path.join(project, '.sdd', 'runs', changeId);
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(changeDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(project, '.sdd', 'active-run'), changeId);
  fs.writeFileSync(path.join(changeDir, 'progress.md'), '## code\n- test pass\n');
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { test: 'true' } }));
  fs.writeFileSync(
    path.join(project, 'src', 'main.ts'),
    'const x = "Scene PerspectiveCamera WebGLRenderer PointerLock keydown keyup click";\n',
  );
  fs.writeFileSync(path.join(project, 'src', 'world.ts'), 'export const world = true;\n');
  return project;
}

test('core stage metrics contain no MiniCraft or Three.js project assumptions', () => {
  const core = fs.readFileSync(coreMetricsPath, 'utf8');

  for (const forbidden of [
    'vitest',
    '.test.ts',
    'chunk/camera/input',
    'PerspectiveCamera',
    'WebGLRenderer',
    'src/main.ts',
    'globalThis).__sdd',
    'countSolid',
    'scene.children',
    'isInstancedMesh',
  ]) {
    assert.equal(core.includes(forbidden), false, `core metrics leaked ${forbidden}`);
  }
});

test('MiniCraft-specific metrics live in a probe profile', () => {
  const profile = fs.readFileSync(minicraftProfilePath, 'utf8');

  assert.match(profile, /profile:\s*minicraft/);
  assert.match(profile, /PerspectiveCamera/);
  assert.match(profile, /WebGLRenderer/);
  assert.match(profile, /chunk\|Chunk\|camera\|Camera\|input\|Input/);
  assert.match(profile, /countSolid/);
  assert.match(profile, /isInstancedMesh/);
});

test('sdd check can explicitly add the MiniCraft probe profile metrics', () => {
  const project = makeProject();

  const result = spawnSync(
    process.execPath,
    [cliPath, 'check', 'code', '--profile', 'minicraft'],
    { cwd: project, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /MiniCraft render primitives/);
  assert.match(result.stdout, /MiniCraft interaction wiring/);
});
