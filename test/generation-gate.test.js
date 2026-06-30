import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluateGeneratedTests } from '../lib/generation-gate.js';

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-generation-gate-'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  return project;
}

test('generation gate accepts a successful generator that produced a test file', async () => {
  const project = makeProject();
  fs.writeFileSync(path.join(project, 'src', 'main.test.ts'), 'export {};\n');

  const result = await evaluateGeneratedTests({
    projectDir: project,
    generationResult: { exitCode: 0, timedOut: false },
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.testFiles, ['src/main.test.ts']);
});

test('generation gate rejects timeout, non-zero exit, and empty test output', async () => {
  const project = makeProject();

  const timedOut = await evaluateGeneratedTests({
    projectDir: project,
    generationResult: { exitCode: null, timedOut: true },
  });
  const failed = await evaluateGeneratedTests({
    projectDir: project,
    generationResult: { exitCode: 1, timedOut: false },
  });
  const empty = await evaluateGeneratedTests({
    projectDir: project,
    generationResult: { exitCode: 0, timedOut: false },
  });

  assert.equal(timedOut.pass, false);
  assert.equal(timedOut.reason, 'test generation timed out');
  assert.equal(failed.pass, false);
  assert.equal(failed.reason, 'test generation exited with code 1');
  assert.equal(empty.pass, false);
  assert.equal(empty.reason, 'test generation produced no test files');
});

test('generation gate rejects an unchanged pre-existing test inventory', async () => {
  const project = makeProject();
  const testPath = path.join(project, 'src', 'main.test.ts');
  const content = 'export {};\n';
  fs.writeFileSync(testPath, content);
  const beforeTestInventory = [{
    path: 'src/main.test.ts',
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  }];

  const result = await evaluateGeneratedTests({
    projectDir: project,
    generationResult: { exitCode: 0, timedOut: false },
    beforeTestInventory,
  });

  assert.equal(result.pass, false);
  assert.equal(result.reason, 'test generation did not add or modify test files');
});
