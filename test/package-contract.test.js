import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('published package includes probe runtime modules', () => {
  assert.ok(pkg.files.includes('lib'));
});

test('package exposes the regression suite through npm test', () => {
  assert.equal(pkg.scripts?.test, 'node --test test/*.test.js');
});
