import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 回归（共识评审 r3 F-VERSION-001）：发布元数据必须全源一致。
// package.json / package-lock.json（顶层 + root 条目）/ bin/cli.js VERSION /
// CHANGELOG 必须引用同一版本号，否则锁文件漂移（0.1.0 vs 0.2.1）会复发。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');

test('release version metadata is consistent across all sources', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const cli = fs.readFileSync(path.join(repoRoot, 'bin', 'cli.js'), 'utf8');
  const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

  const version = pkg.version;
  assert.match(version, /^\d+\.\d+\.\d+$/, 'package.json version must be semver');

  assert.equal(lock.version, version, 'package-lock.json top-level version drifts from package.json');
  assert.equal(lock.packages?.['']?.version, version, 'package-lock.json root-package version drifts from package.json');

  assert.match(cli, new RegExp(`const VERSION = '${version.replace(/\./g, '\\.')}'`), 'bin/cli.js VERSION drifts from package.json');

  assert.match(changelog, new RegExp(`^## ${version.replace(/\./g, '\\.')} `, 'm'), 'CHANGELOG.md has no entry for current version');
});
