import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 回归：adapter 生成的 hooks/.compiled.env 必须可被安全 source。
// 事故（2026-09-03）：值未加引号，source 时把 `git push --force`、`git reset --hard`、
// `rm -rf /` 当命令执行，git reset --hard 冲掉了未提交的迁移改动。
// 本测试钉死两条契约：①source 无副作用（stderr 为空）②策略值完整。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const adapterPath = path.join(repoRoot, 'tools', 'adapters', 'claude-code.sh');
const compiledPath = path.join(repoRoot, 'hooks', '.compiled.env');

const hasPython3 = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

test('claude-code adapter compiles hooks.yaml to safely-sourceable env', { skip: !hasPython3 && 'python3 unavailable' }, () => {
  const run = spawnSync('bash', [adapterPath], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.ok(fs.existsSync(compiledPath), 'hooks/.compiled.env not generated');

  const compiled = fs.readFileSync(compiledPath, 'utf8');
  for (const line of compiled.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [, value] = line.split('=', 2);
    assert.match(value, /^'/, `value must be single-quoted: ${line}`);
  }
});

test('sourcing .compiled.env has no side effects and preserves deny patterns', { skip: !hasPython3 && 'python3 unavailable' }, () => {
  if (!fs.existsSync(compiledPath)) return; // bootstrap 未跑时跳过（pre-tool-gate 有内置默认）
  const probe = spawnSync(
    'bash',
    ['-c', `set -e; source '${compiledPath}'; printf '%s' "$DENY_PATTERNS"`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stderr, '', `source must not execute patterns, got: ${probe.stderr}`);
  assert.ok(probe.stdout.includes('git push --force'), 'deny pattern lost');
  assert.ok(probe.stdout.includes('git reset --hard'), 'deny pattern lost');
});

test('pre-tool-gate denies blocked commands and allows normal ones', () => {
  const deny = spawnSync('bash', [path.join(repoRoot, 'hooks', 'pre-tool-gate.sh')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }),
    encoding: 'utf8',
  });
  assert.equal(deny.status, 2, 'blocked command must exit 2');

  const allow = spawnSync('bash', [path.join(repoRoot, 'hooks', 'pre-tool-gate.sh')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }),
    encoding: 'utf8',
  });
  assert.equal(allow.status, 0, 'normal command must pass');
});

test('pre-tool-gate denies direct wiki writes (kb-write-protection)', () => {
  const deny = spawnSync('bash', [path.join(repoRoot, 'hooks', 'pre-tool-gate.sh')], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/p/llmwiki/wiki/product/x.md' } }),
    encoding: 'utf8',
  });
  assert.equal(deny.status, 2);
  assert.match(deny.stderr, /mcp__llmwiki__create/);
});
