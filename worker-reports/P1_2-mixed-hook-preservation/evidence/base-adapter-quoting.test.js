import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 回归：adapter 生成的 hooks/.compiled.env 必须可被安全 source。
// 事故（2026-09-03）：值未加引号，source 时把 `git push --force`、`git reset --hard`、
// `rm -rf /` 当命令执行，git reset --hard 冲掉了未提交的迁移改动。
// 本测试钉死两条契约：①source 无副作用（stderr 为空）②策略值完整。
// 每个用例使用私有目标，避免读取或覆盖源工作树的生成配置。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const adapterPath = path.join(repoRoot, 'tools', 'adapters', 'claude-code.sh');

const hasPython3 = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

// 断言失败时也清理本用例的临时产物。
function makeTargetRoot(t) {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-adapter-quoting-'));
  t.after(() => fs.rmSync(targetRoot, { recursive: true, force: true }));
  return targetRoot;
}

// 真 adapter + 真 hooks.yaml（源仓库回退），唯一变量是隔离的 TARGET_ROOT。
function runAdapter(targetRoot) {
  return spawnSync('bash', [adapterPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, SDD_TARGET_ROOT: targetRoot },
  });
}

// hook从脚本所在目录读取compiled，须与同次生成的隔离产物一起运行。
function makeGateRoot(t) {
  const targetRoot = makeTargetRoot(t);
  const hooksDir = path.join(targetRoot, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const name of ['pre-tool-gate.sh', '_resolve-project-dir.sh']) {
    const src = path.join(repoRoot, 'hooks', name);
    assert.ok(fs.existsSync(src), `hooks/${name} missing — cannot build gate fixture`);
    const dest = path.join(hooksDir, name);
    fs.copyFileSync(src, dest);
    assert.ok(fs.readFileSync(src).equals(fs.readFileSync(dest)), `hooks/${name} fixture copy is not byte-for-byte`);
  }
  const run = runAdapter(targetRoot);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.ok(
    fs.existsSync(path.join(hooksDir, '.compiled.env')),
    'hooks/.compiled.env not generated in the gate TARGET_ROOT — behavior case must not silently skip',
  );
  return path.join(hooksDir, 'pre-tool-gate.sh');
}

test('claude-code adapter compiles hooks.yaml to safely-sourceable env', { skip: !hasPython3 && 'python3 unavailable' }, (t) => {
  const targetRoot = makeTargetRoot(t);
  const run = runAdapter(targetRoot);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const compiledPath = path.join(targetRoot, 'hooks', '.compiled.env');
  assert.ok(fs.existsSync(compiledPath), 'hooks/.compiled.env not generated in the isolated TARGET_ROOT');

  const compiled = fs.readFileSync(compiledPath, 'utf8');
  for (const line of compiled.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [, value] = line.split('=', 2);
    assert.match(value, /^'/, `value must be single-quoted: ${line}`);
  }
});

test('sourcing .compiled.env has no side effects and preserves deny patterns', { skip: !hasPython3 && 'python3 unavailable' }, (t) => {
  const targetRoot = makeTargetRoot(t);
  const run = runAdapter(targetRoot);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const compiledPath = path.join(targetRoot, 'hooks', '.compiled.env');
  assert.ok(fs.existsSync(compiledPath), 'hooks/.compiled.env not generated — sourcing case must not silently skip');

  // 路径经 argv 传递（不经 shell 内插），probe 自身保持零副作用断言。
  const probe = spawnSync(
    'bash',
    ['-c', 'set -e; source "$1"; printf \'%s\' "$DENY_PATTERNS"', 'probe', compiledPath],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stderr, '', `source must not execute patterns, got: ${probe.stderr}`);
  assert.ok(probe.stdout.includes('git push --force'), 'deny pattern lost');
  assert.ok(probe.stdout.includes('git reset --hard'), 'deny pattern lost');
});

test('pre-tool-gate denies blocked commands and allows normal ones', { skip: !hasPython3 && 'python3 unavailable' }, (t) => {
  const gate = makeGateRoot(t);
  const deny = spawnSync('bash', [gate], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }),
    encoding: 'utf8',
  });
  assert.equal(deny.status, 2, 'blocked command must exit 2');

  const allow = spawnSync('bash', [gate], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }),
    encoding: 'utf8',
  });
  assert.equal(allow.status, 0, 'normal command must pass');
});

test('pre-tool-gate fails closed on unparseable non-empty input (r2 F4)', { skip: !hasPython3 && 'python3 unavailable' }, (t) => {
  const deny = spawnSync('bash', [makeGateRoot(t)], {
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

test('pre-tool-gate denies direct wiki writes (kb-write-protection)', { skip: !hasPython3 && 'python3 unavailable' }, (t) => {
  const deny = spawnSync('bash', [makeGateRoot(t)], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/p/llmwiki/wiki/product/x.md' } }),
    encoding: 'utf8',
  });
  assert.equal(deny.status, 2);
  assert.match(deny.stderr, /mcp__llmwiki__create/);
});

// 回归（共识评审 F-HOOKS-001）：编译产物的 PreToolUse matcher 必须覆盖
// hooks.yaml 中每个 deny 策略的 matcher——否则策略是死代码。
test('compiled settings.json PreToolUse matcher covers every deny policy', { skip: !hasPython3 && 'python3 unavailable' }, (t) => {
  const targetRoot = makeTargetRoot(t);
  const run = runAdapter(targetRoot);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const settingsPath = path.join(targetRoot, '.claude', 'settings.json');
  assert.ok(fs.existsSync(settingsPath), 'settings.json not generated in the isolated TARGET_ROOT — matcher case must not silently skip');

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
// sentinel 写进隔离 TARGET_ROOT 的私有 settings.json——活控制平面零写入。
test('adapter preserves user hook entries it does not own', { skip: !hasPython3 && 'python3 unavailable' }, (t) => {
  const targetRoot = makeTargetRoot(t);
  const settingsPath = path.join(targetRoot, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const sentinel = 'echo user-sentinel-hook';
  const userSettings = {
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: sentinel }] }] },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));

  const run = runAdapter(targetRoot);
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const cmds = (after.hooks?.SessionStart ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
  assert.ok(cmds.includes(sentinel), 'user hook entry was clobbered by adapter');
});

