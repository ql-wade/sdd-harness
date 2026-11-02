import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 回归（2026-11-02 架构审核）：doctor 是无输入的骨架自检；检查失败属「验证不通过」
// = exit 2，不是「输入无效」（AGENTS.md §5 CLI 退出码契约 0 通过 / 1 输入无效 / 2 验证不通过）。
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('doctor exits 0 when the skeleton is complete', () => {
  const run = spawnSync(process.execPath, [path.join(repo, 'bin', 'cli.js'), 'doctor'], { cwd: repo, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
});

test('doctor exits 2 (not 1) when skeleton checks fail in an empty directory', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-doctor-empty-'));
  const run = spawnSync(process.execPath, [path.join(repo, 'bin', 'cli.js'), 'doctor'], { cwd: empty, encoding: 'utf8' });
  fs.rmSync(empty, { recursive: true, force: true });
  assert.equal(run.status, 2, `doctor must map skeleton failure to exit 2 (validation), got ${run.status}`);
});
