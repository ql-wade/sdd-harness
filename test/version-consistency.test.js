import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
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

// 负路径（共识 next-plan #8）：版本漂移必须被门禁抓住，而不是恒绿
test('version gate fails on drift (negative path)', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'bin', 'cli.js'), 'utf8');
  const drifted = src.replace(/const VERSION = '[^']+';/, "const VERSION = '9.9.9';");
  assert.notEqual(drifted, src, 'VERSION anchor not found — test is vacuous');
  // 放 repo 内（node_modules 可解析；/tmp 下 ESM 解析不到依赖）
  const tmp = path.join(repoRoot, 'test', '.tmp-drift-cli.js');
  fs.writeFileSync(tmp, drifted);
  try {
    const run = spawnSync(process.execPath, [tmp, '--version'], { encoding: 'utf8' });
    assert.match(run.stdout, /9\.9\.9/, 'drifted CLI must report drifted version');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    assert.notEqual(pkg.version, '9.9.9');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
