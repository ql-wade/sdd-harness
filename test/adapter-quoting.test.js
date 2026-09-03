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

test('pre-tool-gate fails closed on unparseable non-empty input (r2 F4)', () => {
  const deny = spawnSync('bash', [path.join(repoRoot, 'hooks', 'pre-tool-gate.sh')], {
    input: 'not-json{{',
    encoding: 'utf8',
  });
  assert.equal(deny.status, 2, 'unparseable input must deny, not silently pass');
});

test('.mcp.json carries pinned versions, never @latest (r2 F-001/zcode F1)', () => {
  const mcpJsonPath = path.join(repoRoot, '.mcp.json');
  if (!fs.existsSync(mcpJsonPath)) return;
  const raw = fs.readFileSync(mcpJsonPath, 'utf8');
  assert.ok(!raw.includes('@latest'), '.mcp.json contains floating @latest — supply chain unpinned');
  const servers = JSON.parse(raw).mcpServers ?? {};
  const pins = { playwright: '@playwright/mcp@0.0.80', 'chrome-devtools': 'chrome-devtools-mcp@1.8.0' };
  for (const [name, pin] of Object.entries(pins)) {
    if (servers[name]) {
      assert.ok(
        (servers[name].args ?? []).some((a) => String(a).startsWith(pin)),
        `${name} not pinned to ${pin}`,
      );
    }
  }
  // 清单不变量：.mcp.json 中每个 scaffold 管理的服务都必须出现在能力清单
  const manifest = fs.readFileSync(path.join(repoRoot, 'mcp-capabilities.yaml'), 'utf8');
  for (const name of Object.keys(servers)) {
    assert.ok(manifest.includes(`- name: ${name}`), `server "${name}" in .mcp.json is absent from mcp-capabilities.yaml`);
  }
});

test('pre-tool-gate denies direct wiki writes (kb-write-protection)', () => {
  const deny = spawnSync('bash', [path.join(repoRoot, 'hooks', 'pre-tool-gate.sh')], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/p/llmwiki/wiki/product/x.md' } }),
    encoding: 'utf8',
  });
  assert.equal(deny.status, 2);
  assert.match(deny.stderr, /mcp__llmwiki__create/);
});

// 回归（共识评审 F-HOOKS-001）：编译产物的 PreToolUse matcher 必须覆盖
// hooks.yaml 中每个 deny 策略的 matcher——否则策略是死代码。
test('compiled settings.json PreToolUse matcher covers every deny policy', { skip: !hasPython3 && 'python3 unavailable' }, () => {
  const settingsPath = path.join(repoRoot, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) return; // bootstrap 未跑时跳过
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const entries = settings.hooks?.PreToolUse ?? [];
  const gateEntry = entries.find((e) => (e.hooks ?? []).some((h) => (h.command ?? '').includes('pre-tool-gate.sh')));
  assert.ok(gateEntry, 'pre-tool-gate.sh not registered in settings.json');

  // 按策略块解析（以 "  - id:" 分段），统计 action: deny 策略的 matcher
  const hooksYaml = fs.readFileSync(path.join(repoRoot, 'hooks.yaml'), 'utf8');
  const blocks = hooksYaml.split(/^ {2}- id: /m).slice(1);
  const denyTools = blocks
    .filter((b) => /^\s*action: deny$/m.test(b))
    .flatMap((b) => (b.match(/^\s*matcher: (.+)$/m)?.[1] ?? '').split('|'))
    .filter(Boolean);
  assert.ok(denyTools.length >= 2, `expected at least two deny policies, got: ${denyTools}`);
  for (const tool of denyTools) {
    assert.match(gateEntry.matcher, new RegExp(`(^|\\|)${tool}(\\||$)`), `deny matcher "${tool}" missing from compiled PreToolUse matcher — policy is dead code`);
  }
});

// 回归（F-HOOKS-002）：adapter 必须保留用户已有 hook 条目（合并而非覆盖）。
// 测试结束后恢复 settings.json，避免 sentinel 残留进活控制平面（r2 评审 zcode F4）。
test('adapter preserves user hook entries it does not own', { skip: !hasPython3 && 'python3 unavailable' }, () => {
  const settingsPath = path.join(repoRoot, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) return;
  const original = fs.readFileSync(settingsPath, 'utf8');
  try {
    const settings = JSON.parse(original);
    const sentinel = 'echo user-sentinel-hook';
    settings.hooks ??= {};
    settings.hooks.SessionStart ??= [];
    settings.hooks.SessionStart.push({ matcher: 'startup', hooks: [{ type: 'command', command: sentinel }] });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const run = spawnSync('bash', [adapterPath], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = (after.hooks?.SessionStart ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
    assert.ok(cmds.includes(sentinel), 'user hook entry was clobbered by adapter');
  } finally {
    fs.writeFileSync(settingsPath, original);
  }
});

