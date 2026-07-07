#!/usr/bin/env node

import { program } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import chalk from 'chalk';
import os from 'os';
import { validateProbe } from '../lib/probe-validator.js';
import { evaluateStageAdvanceGate } from '../lib/stage-gates.js';
import { auditEvidence } from '../lib/evidence-audit.js';
import { captureTestInventory, evaluateGeneratedTests } from '../lib/generation-gate.js';
import { runProjectTestGate } from '../lib/project-test-gate.js';
import { auditWorkflowRun } from '../lib/workflow-audit.js';
import { auditDeliverables } from '../lib/deliverable-audit.js';
import { fixDeliverables } from '../lib/deliverable-fixer.js';
import { graphHealthCheck, getSourceDirs, countSourceFiles, detectProjectType, detectMonorepo } from '../lib/project-context.js';
import { discoverKnowledgeSources, generateSeedContent } from '../lib/knowledge-seed.js';
import { sedimentStage } from '../lib/llmwiki-sediment.js';
import { installDailyGraphRefresh, uninstallDailyGraphRefresh, checkDailyGraphRefresh } from '../lib/daily-scheduler.js';

// 异步流式执行 claude（非 execSync 阻塞；stdin 走临时文件 redirect；慷慨超时）
//
// 关键修复（autoresearch 发现）：必须分配真 PTY。
//   claude -p 在非 TTY 环境下写完文件后不退出，会 hang 并变孤儿进程。
//   - macOS: script -q /dev/null bash -c '...' 分配 pseudo-terminal，claude 正常退出
//   - 其他平台: 回退到裸 spawn（无 PTY，但保留进程组 kill 避免孤儿）
//
// 进程管理：detached:true 建新进程组，超时用 process.kill(-pid) 杀整组（bash+claude），
//   修复旧版 SIGKILL 只杀 bash 导致 claude 成孤儿进程的 bug。
async function ptyClaude(prompt, { cwd, model = 'sonnet', timeoutMs = 600000 } = {}) {
  const tmp = path.join(os.tmpdir(), `sdd-prompt-${process.pid}-${Date.now()}.txt`);
  await fs.writeFile(tmp, prompt);
  const inner = `claude -p --bare --dangerously-skip-permissions --model ${model} < "${tmp}"`;
  // macOS: 真 PTY 让 claude -p 写完即正常退出
  const usePTY = os.platform() === 'darwin';
  const wrapped = usePTY
    ? `script -q /dev/null bash -c '${inner.replace(/'/g, "'\\''")}'`
    : inner;
  return new Promise((resolve) => {
    const sh = spawn('bash', ['-c', wrapped], {
      cwd: cwd || process.cwd(),
      detached: true,               // 新进程组：可整组 kill
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    let done = false;
    const finish = (result) => { if (done) return; done = true; fs.remove(tmp).catch(() => {}); resolve(result); };
    const timer = timeoutMs ? setTimeout(() => {
      try { process.kill(-sh.pid, 'SIGKILL'); }   // 杀整个进程组（bash + claude）
      catch { try { sh.kill('SIGKILL'); } catch {} }
      finish({ exitCode: null, killed: true, timedOut: true });
    }, timeoutMs) : null;
    sh.on('exit', (code) => { if (timer) clearTimeout(timer); finish({ exitCode: code, killed: false, timedOut: false }); });
    sh.on('error', () => { if (timer) clearTimeout(timer); finish({ exitCode: 1, killed: false, timedOut: false }); });
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const VERSION = '0.1.0';

// Multi-stack test/build command resolver (monorepo-aware)
function detectTestBuildCommands(cwd) {
  const mono = detectMonorepo(cwd);
  const projects = mono.length >= 2 ? mono : [];
  if (projects.length === 0) {
    const single = detectProjectType(cwd);
    if (single) projects.push({ dir: '.', ...single });
  }
  if (projects.length === 0) {
    return { testCmd: 'npm test', buildCmd: 'npm run build', label: 'npm (fallback)' };
  }
  // Use the first project's commands (or the frontend one for monorepos)
  const p = projects.find(p => p.type === 'node') || projects[0];
  return { testCmd: p.testCmd, buildCmd: p.buildCmd, label: `${p.type} (${p.dir})` };
}

// 平台配置
const PLATFORMS = {
  claude: {
    name: 'Claude Code',
    skillsDir: '.claude/skills',
    commandsDir: '.claude/commands',
    templateDir: 'claude',
  },
  opencode: {
    name: 'OpenCode',
    skillsDir: '.opencode/skills',
    commandsDir: '.opencode/commands',
    templateDir: 'opencode',
  },
  codex: {
    name: 'Codex',
    skillsDir: '.codex/skills',
    commandsDir: null,
    templateDir: 'codex',
  }
};

const ALL_PLATFORMS = Object.keys(PLATFORMS);

// 需要清理的旧命令文件
const LEGACY_COMMANDS = [
  'hybrid-new.md', 'hybrid-continue.md', 'hybrid-apply.md',
  'hybrid-verify.md', 'hybrid-archive.md', 'hybrid-status.md',
  'opsx-new.md', 'opsx-continue.md', 'opsx-apply.md',
  'opsx-verify.md', 'opsx-archive.md', 'opsx-status.md',
];

// 有效的 platform 参数值
const VALID_PLATFORMS = [...ALL_PLATFORMS, 'both', 'all'];

// 自动检测平台。没有检测到平台目录时，默认安装所有支持的平台。
function detectPlatforms(cwd) {
  const detected = ALL_PLATFORMS.filter(platform => {
    const platformRoot = PLATFORMS[platform].skillsDir.split('/')[0];
    return fs.existsSync(path.join(cwd, platformRoot));
  });

  return detected.length > 0 ? detected : ALL_PLATFORMS;
}

function resolvePlatforms(platformOption, cwd) {
  if (platformOption === 'all') return ALL_PLATFORMS;
  if (platformOption === 'both') return ['claude', 'opencode'];
  if (platformOption) return [platformOption];
  return detectPlatforms(cwd);
}

function formatPlatforms(platforms) {
  return platforms.map(p => PLATFORMS[p].name).join(' + ');
}

// 真实执行 shell 命令，捕获结果
function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts });
}

function cmdExists(cmd) {
  try { run(`${cmd} --version 2>&1 || ${cmd} -v 2>&1`); return true; }
  catch { try { run(`command -v ${cmd}`); return true; } catch { return false; } }
}

// clone 一个 git repo 到目标路径（已存在则跳过）
async function cloneRepo(repo, dest, dryRun) {
  if (await fs.pathExists(dest) && (await fs.readdir(dest)).length > 0) {
    console.log(chalk.green(`  ✅ 已存在: ${path.basename(dest)}`));
    return 'exists';
  }
  if (dryRun) {
    console.log(chalk.cyan(`  [dry-run] git clone ${repo} → ${dest}`));
    return 'dryrun';
  }
  console.log(chalk.yellow(`  ⏳ clone ${repo}...`));
  try {
    await fs.ensureDir(path.dirname(dest));
    // 用 inherit 让 git progress 直接到终端，避免 pipe buffer 撑爆（大 repo 如 Understand-Anything）
    execSync(`git clone --depth 1 ${repo} "${dest}"`, { encoding: 'utf8', stdio: 'inherit' });
    console.log(chalk.green(`  ✅ cloned: ${path.basename(dest)}`));
    return 'installed';
  } catch (e) {
    console.log(chalk.red(`  ❌ clone 失败: ${repo}`));
    console.log(chalk.gray(`     ${String(e.message).split('\n')[0]}`));
    return 'failed';
  }
}

// §13.1 完整依赖安装（真实执行）
async function ensureDependencies(platforms, dryRun, cwd) {
  const homeDir = os.homedir();
  const skillsDir = path.join(homeDir, '.claude', 'skills');
  let installed = 0, failed = 0;

  console.log(chalk.blue('\n🔍 [1/8] pre-doctor: 检测环境\n'));

  // === Step 2: 系统级 CLI ===
  console.log(chalk.blue('🔧 [2/8] 系统级 CLI\n'));

  // OpenSpec CLI
  if (cmdExists('openspec')) {
    console.log(chalk.green(`  ✅ openspec CLI: ${run('openspec --version').trim()}`));
  } else if (dryRun) {
    console.log(chalk.cyan('  [dry-run] brew install openspec'));
  } else {
    console.log(chalk.yellow('  ⏳ 安装 openspec CLI (brew)...'));
    try { run('brew install openspec 2>&1', { stdio: 'inherit' }); installed++; console.log(chalk.green('  ✅ openspec installed')); }
    catch { console.log(chalk.red('  ❌ brew install openspec 失败 — 请手动: brew install openspec')); failed++; }
  }

  // open-code-review CLI
  if (cmdExists('ocr')) {
    console.log(chalk.green(`  ✅ open-code-review: ${run('ocr --version').trim()}`));
  } else if (dryRun) {
    console.log(chalk.cyan('  [dry-run] npm i -g @alibaba-group/open-code-review'));
  } else {
    console.log(chalk.yellow('  ⏳ 安装 open-code-review (npm -g)...'));
    try { run('npm install -g @alibaba-group/open-code-review 2>&1', { stdio: 'inherit' }); installed++; console.log(chalk.green('  ✅ open-code-review installed')); }
    catch { console.log(chalk.red('  ❌ npm install -g 失败 — 请手动: npm i -g @alibaba-group/open-code-review')); failed++; }
  }

  // === Step 3: clone skills ===
  console.log(chalk.blue('\n📦 [3/8] clone skills → ~/.claude/skills/\n'));
  const skills = [
    { name: 'superpowers', repo: 'https://github.com/obra/superpowers' },
    { name: 'planning-with-files', repo: 'https://github.com/OthmanAdi/planning-with-files' },
    // grill-with-docs: 作为独立 skill 期望已存在（与 superpowers/planning-with-files 同级）。
    // 不在此 clone（避免重复 clone superpowers）。doctor 会检测缺失并提示。
  ];
  for (const s of skills) {
    const dest = path.join(skillsDir, s.name);
    const r = await cloneRepo(s.repo, dest, dryRun);
    if (r === 'installed') installed++;
    if (r === 'failed') failed++;
  }

  // === Step 4 + 5: LLMWiki (真实 repo + 初始化) ===
  console.log(chalk.blue('\n📚 [4/8] LLMWiki repo + MCP\n'));
  const llmwikiRepoDir = path.join(homeDir, '.sdd', 'repos', 'llmwiki');
  const r1 = await cloneRepo('https://github.com/lucasastorian/llmwiki', llmwikiRepoDir, dryRun);
  if (r1 === 'installed') installed++;
  if (r1 === 'failed') failed++;

  // LLMWiki 是 Python，需 3.11+。优先找 brew 装的 3.11+（系统 python3 可能是 3.9）
  const findPy311 = () => {
    for (const cand of ['python3.14', 'python3.13', 'python3.12', 'python3.11']) {
      try { run(`command -v ${cand}`); return cand; } catch {}
    }
    return null;
  };
  const py311Bin = findPy311();
  const pyVersion = (() => {
    const bin = py311Bin || 'python3';
    try { const v = run(`${bin} --version`); const m = v.match(/Python (\d+)\.(\d+)/); return [parseInt(m[1]), parseInt(m[2])]; }
    catch { return [0, 0]; }
  })();
  const pyOk = pyVersion[0] > 3 || (pyVersion[0] === 3 && pyVersion[1] >= 11);
  const pyBin = py311Bin || 'python3';
  const mcpReqPath = path.join(llmwikiRepoDir, 'mcp', 'requirements.txt');

  if (!dryRun && await fs.pathExists(mcpReqPath)) {
    if (pyOk) {
      console.log(chalk.green(`  ✅ ${pyBin} (Python ${pyVersion[0]}.${pyVersion[1]}, 满足 3.11+)`));
      console.log(chalk.yellow(`  ⏳ venv + 装 LLMWiki Python deps...`));
      const venvDir = path.join(llmwikiRepoDir, '.venv');
      if (!await fs.pathExists(venvDir)) {
        try { run(`${pyBin} -m venv ${venvDir}`); } catch { console.log(chalk.yellow('  ⚠️ venv 创建失败')); }
      }
      const pip = path.join(venvDir, 'bin', 'pip');
      try { run(`${pip} install -r ${mcpReqPath} 2>&1`, { stdio: 'inherit' }); console.log(chalk.green('  ✅ LLMWiki Python deps installed')); }
      catch { console.log(chalk.yellow('  ⚠️ pip install 失败 — LLMWiki MCP 需手动装')); failed++; }
    } else {
      console.log(chalk.yellow(`  ⚠️ 无 Python 3.11+ (当前 ${pyBin} ${pyVersion[0]}.${pyVersion[1]})`));
      console.log(chalk.gray('     LLMWiki MCP 未启用。装 Python 3.11+: brew install python@3.12，然后重跑 sdd init'));
      console.log(chalk.gray('     或用 LLMWiki remote 模式 (llmwiki.app)'));
      failed++;
    }
  }

  // 注册 LLMWiki MCP 到项目 .mcp.json
  if (!dryRun && pyOk) {
    const mcpConfig = path.join(cwd, '.mcp.json');
    let config = {};
    if (await fs.pathExists(mcpConfig)) {
      try { config = JSON.parse(await fs.readFile(mcpConfig, 'utf8')); } catch {}
    }
    config.mcpServers = config.mcpServers || {};
    if (!config.mcpServers['llmwiki']) {
      const venvPy = path.join(llmwikiRepoDir, '.venv', 'bin', 'python');
      config.mcpServers['llmwiki'] = {
        command: await fs.pathExists(venvPy) ? venvPy : pyBin,
        args: ['-m', 'local_server', '--workspace', path.join(cwd, 'llmwiki')],
        cwd: path.join(llmwikiRepoDir, 'mcp'),
      };
      await fs.writeFile(mcpConfig, JSON.stringify(config, null, 2));
      console.log(chalk.green(`  ✅ 注册 LLMWiki MCP → ${path.relative(cwd, mcpConfig)}`));
    }
 }

  // === Step 5: LLMWiki 实例初始化（项目级 wiki 内容目录） ===
  console.log(chalk.blue('\n🗂️  [5/8] LLMWiki 实例初始化（wiki 内容目录）\n'));
  const wikiDir = path.join(cwd, 'llmwiki');
  if (!dryRun) {
    await fs.ensureDir(wikiDir);
    // 按 §9.1 建三大流程骨架
    const wikiSubdirs = [
      'raw', 'wiki/sources', 'wiki/concepts', 'wiki/entities', 'wiki/outputs',
      'wiki/product/requirements', 'wiki/product/acceptance-criteria',
      'wiki/product/user-stories', 'wiki/product/prototypes', 'wiki/product/decisions',
      'wiki/engineering', 'wiki/testing/cases', 'wiki/testing/suites',
      'wiki/testing/matrices', 'wiki/testing/plans', 'wiki/testing/reports', 'wiki/testing/regression',
      'wiki/_shared/glossary', 'wiki/_shared/traceability', 'wiki/_shared/runbooks', 'wiki/_shared/releases',
    ];
    for (const d of wikiSubdirs) await fs.ensureDir(path.join(wikiDir, d));
    // index.md + log.md
    if (!await fs.pathExists(path.join(wikiDir, 'index.md'))) {
      await fs.writeFile(path.join(wikiDir, 'index.md'), '# LLMWiki Index\n\nSDD Harness 知识中枢。三大流程：product / engineering / testing。\n');
    }
    if (!await fs.pathExists(path.join(wikiDir, 'log.md'))) {
      await fs.writeFile(path.join(wikiDir, 'log.md'), '# Log\n\n## [init] LLMWiki 实例初始化\n');
    }
    if (!await fs.pathExists(path.join(wikiDir, 'wiki', '_schema.md'))) {
      await fs.writeFile(path.join(wikiDir, 'wiki', '_schema.md'), '# Wiki Schema\n\n详见 docs/llmwiki-structure.md\n');
    }
    console.log(chalk.green(`  ✅ wiki 内容目录已建: ${path.relative(cwd, wikiDir)}/ (含 ${wikiSubdirs.length} 子目录)`));

    // --- Knowledge seed: scan project for existing docs/specs and seed wiki ---
    const ks = discoverKnowledgeSources(cwd);
    const ksCount = ks.docs.length + ks.specs.length + ks.steering.length + ks.agentDocs.length;
    if (ksCount > 0 || ks.catalog) {
      console.log(chalk.cyan(`  📖 发现 ${ksCount} 个知识源 (${ks.docs.length} docs, ${ks.specs.length} specs, ${ks.steering.length} steering${ks.catalog ? ', CODEBASE-CATALOG' : ''})`));
      if (!dryRun) {
        const seedResult = generateSeedContent(cwd, ks);
        console.log(chalk.green(`  ✅ knowledge seed: ${seedResult.files.length} 个 wiki 条目写入`));
        for (const f of seedResult.files.slice(0, 8)) {
          console.log(chalk.gray(`     → ${f.path}`));
        }
        if (seedResult.files.length > 8) console.log(chalk.gray(`     … +${seedResult.files.length - 8} more`));
      }
    } else {
      console.log(chalk.gray('  ℹ️  无已有知识源可 seed（后续文档放入 llmwiki/raw/ 后 sdd wiki ingest）'));
    }
  } else {
    console.log(chalk.cyan(`  [dry-run] 建 ${wikiDir} 骨架`));
  }

  // === Step 6: Understand-Anything —— 检测代码库，引导生成知识图谱 ===
  // Multi-stack/monorepo-aware source detection via project-context
  const detectedSourceDirs = getSourceDirs(cwd);
  const codeExtensions = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.rb', '.cs'];
  let hasCode = false;
  let codeFileCount = countSourceFiles(cwd, detectedSourceDirs);
  if (codeFileCount > 0) hasCode = true;
  try {
    const rootFiles = await fs.readdir(cwd);
    for (const f of rootFiles) {
      if (codeExtensions.some(ext => f.endsWith(ext))) { codeFileCount++; hasCode = true; }
    }
  } catch {}

  console.log(chalk.blue('\n🧠 [6/8] Understand-Anything（代码知识图谱）\n'));
  const graphPath = path.join(cwd, '.understand-anything', 'knowledge-graph.json');
  if (!dryRun) {
    // Deep graph health check (freshness + orphans + layers)
    const graphHealth = graphHealthCheck(cwd);
    if (graphHealth.existence === 'missing') {
      await fs.ensureDir(path.dirname(graphPath));
      await fs.writeFile(graphPath, JSON.stringify({
        note: 'placeholder. Real graph generated by sdd graph --refresh',
        nodes: [], edges: [], layers: [], generated_at: null,
      }, null, 2));
      if (hasCode) {
        console.log(chalk.yellow(`  ⚠️ knowledge-graph.json placeholder (${codeFileCount} code files detected in: ${detectedSourceDirs.join(', ')})`));
        console.log(chalk.cyan.bold('\n     📌 Fix: sdd graph --refresh (auto-trigger /understand)\n'));
        console.log(chalk.white('         /understand\n'));
        console.log(chalk.gray('     Used by dev/code/review/test/verify for impact/boundary/domain queries\n'));
        console.log(chalk.gray('     If not installed: sdd graph --install\n'));
      } else {
        console.log(chalk.yellow('  ⚠️ knowledge-graph.json placeholder'));
        console.log(chalk.gray('     No code yet. Run after code stage: /understand\n'));
      }
    } else if (graphHealth.existence === 'placeholder') {
      console.log(chalk.yellow('  ⚠️ knowledge-graph.json placeholder (0 nodes)'));
      if (hasCode) {
        console.log(chalk.cyan.bold('\n     📌 Fix: sdd graph --refresh\n'));
      }
    } else {
      // Graph exists with nodes — deep health check
      if (graphHealth.issues.length === 0) {
        console.log(chalk.green(`  ✅ knowledge-graph.json healthy (${graphHealth.nodeCount} nodes, ${graphHealth.edgeCount} edges, ${graphHealth.layerCount} layers)`));
      } else {
        console.log(chalk.yellow(`  ⚠️ knowledge-graph.json has ${graphHealth.nodeCount} nodes, but ${graphHealth.issues.length} issue(s):`));
        for (const issue of graphHealth.issues) {
          console.log(chalk.yellow(`     → ${issue}`));
        }
        console.log(chalk.cyan.bold('\n     📌 Fix: sdd graph --refresh (auto-trigger /understand)\n'));
        console.log(chalk.white('         /understand\n'));
        console.log(chalk.gray('     Used by dev/code/review/test/verify for impact/boundary/domain queries\n'));
      }
    }
  }

  // === mcp-keys.env 模板 ===
  if (!dryRun) {
    const keysFile = path.join(homeDir, '.sdd', 'mcp-keys.env');
    if (!await fs.pathExists(keysFile)) {
      await fs.ensureDir(path.dirname(keysFile));
      const keysTpl = await fs.readFile(path.join(TEMPLATES_DIR, 'sdd-harness', 'mcp-keys.env'), 'utf8').catch(() => '# MCP keys\nLLMWIKI_ENDPOINT=\nLLMWIKI_API_KEY=\nGITHUB_TOKEN=\n');
      await fs.writeFile(keysFile, keysTpl);
      console.log(chalk.gray(`  ℹ️  MCP keys 模板: ${keysFile} (填后启用 LLMWiki MCP)`));
    }
  }

  console.log(chalk.blue('\n'));
  if (installed > 0) console.log(chalk.green(`✓ 新装 ${installed} 个依赖`));
  if (failed > 0) console.log(chalk.yellow(`⚠️  ${failed} 个失败（见上，部分需手动）`));

  return { installed, failed };
}

// §13.1 step 7: 落 SDD Harness 层（skills/commands/hooks/templates/config）
async function copySDDHarnessLayer(cwd, dryRun, force) {
  console.log(chalk.blue('\n🎯 [7/8] 落 SDD Harness 层\n'));
  let count = 0;

  // SDD-* skills — install to ALL detected platforms for parity
  // (claude, codex, opencode all get sdd-* skills, not just claude)
  const srcSkills = path.join(TEMPLATES_DIR, 'claude', 'skills');
  const platforms = resolvePlatforms(undefined, cwd);
  const sddSkillDirs = {
    claude: path.join(cwd, '.claude', 'skills'),
    codex: path.join(cwd, '.codex', 'skills'),
    opencode: path.join(cwd, '.opencode', 'skills'),
  };
  if (!dryRun) {
    for (const platform of platforms) {
      const destSkills = sddSkillDirs[platform];
      if (!destSkills) continue;
      await fs.ensureDir(destSkills);
      let pCount = 0;
      for (const entry of await fs.readdir(srcSkills)) {
        if (!entry.startsWith('sdd-')) continue;
        const src = path.join(srcSkills, entry);
        const dest = path.join(destSkills, entry);
        if ((await fs.stat(src)).isDirectory() && (!await fs.pathExists(dest) || force)) {
          await fs.copy(src, dest, { overwrite: force });
          pCount++;
        }
      }
      if (pCount > 0) {
        console.log(chalk.green(`  ✓ ${pCount} 个 sdd-* skill → ${PLATFORMS[platform].skillsDir}/`));
        count += pCount;
      }
    }
  }

  // SDD commands (Claude Code only — commands are Claude-specific slash commands)
  const srcCmds = path.join(TEMPLATES_DIR, 'claude', 'commands');
  const destCmds = path.join(cwd, '.claude', 'commands');
  if (!dryRun) {
    await fs.ensureDir(destCmds);
    let cmdCount = 0;
    for (const entry of await fs.readdir(srcCmds)) {
      if (!entry.startsWith('sdd-')) continue;
      const dest = path.join(destCmds, entry);
      if (!await fs.pathExists(dest) || force) {
        await fs.copy(path.join(srcCmds, entry), dest, { overwrite: force });
        cmdCount++;
      }
    }
    console.log(chalk.green(`  ✓ ${cmdCount} 个 /sdd:* command → .claude/commands/`));
  }

  // hooks
  const srcHooks = path.join(TEMPLATES_DIR, 'claude', 'hooks');
  const destHooks = path.join(cwd, '.sdd', 'hooks');
  if (!dryRun) {
    await fs.ensureDir(destHooks);
    let hookCount = 0;
    for (const entry of await fs.readdir(srcHooks)) {
      const dest = path.join(destHooks, entry);
      await fs.copy(path.join(srcHooks, entry), dest, { overwrite: force });
      await fs.chmod(dest, 0o755);
      hookCount++;
    }
    console.log(chalk.green(`  ✓ ${hookCount} 个 hook → .sdd/hooks/ (可执行)`));

    // ★ 接线：写 .claude/settings.json 的 hooks 块（否则 Claude Code 不会加载 hook）
    const settingsPath = path.join(cwd, '.claude', 'settings.json');
    let settings = {};
    if (await fs.pathExists(settingsPath)) {
      try { settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')); } catch {}
    }
    settings.hooks = settings.hooks || {};
    const hookWiring = {
      SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.sdd/hooks/session-start.sh' }] }],
      PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|Bash', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.sdd/hooks/pre-tool-gate.sh' }] }],
      PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.sdd/hooks/post-tool-tracker.sh' }] }],
      PreCompact: [{ matcher: 'manual|auto', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.sdd/hooks/pre-compact-save.sh' }] }],
      SubagentStop: [{ hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.sdd/hooks/subagent-stop-contract.sh' }] }],
      Stop: [{ hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.sdd/hooks/stop-gate.sh' }] }],
    };
    settings.hooks = { ...settings.hooks, ...hookWiring };

    // Status Line：永远显示当前 SDD stage
    settings.statusLine = { type: 'command', command: 'ID=$(cat .sdd/active-run 2>/dev/null); STAGE=$(grep current .sdd/runs/$ID/workflow-frame.yaml 2>/dev/null | awk "{print \\$2}"); echo "SDD:${STAGE:-idle}"' };

    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    console.log(chalk.green(`  ✓ .claude/settings.json hooks 接线（6 hook）+ statusLine`));
  }

  // .claude/rules/ — CC 原生注入 SDD 规则
  if (!dryRun) {
    const rulesDir = path.join(cwd, '.claude', 'rules');
    await fs.ensureDir(rulesDir);
    const rulesFile = path.join(rulesDir, 'sdd-harness.md');
    if (!await fs.pathExists(rulesFile)) {
      await fs.writeFile(rulesFile, `# SDD Harness Rules（CC 原生注入）

## 当前项目
- 技术栈/架构/决策原则 → 读 .sdd/steering/project.md
- 当前 stage → 读 .sdd/runs/$(cat .sdd/active-run)/workflow-frame.yaml

## 决策原则
- spec 是真相，代码是实现
- 冲突优先级：OpenSpec > PRD > 代码
- 不可逆决策需 ADR
- 不加无 review 的外部依赖

## 5-Question Reboot（重大决策前必须答）
1. 当前 stage？　2. 下一步？　3. 目标？　4. 学到什么？（findings.md）　5. 做了什么？（progress.md）
`);
      console.log(chalk.green('  ✓ .claude/rules/sdd-harness.md（CC 原生注入）'));
    }
  }

  // config.yaml + dependencies.yaml
  if (!dryRun) {
    await fs.ensureDir(path.join(cwd, '.sdd'));

    // steering 持久指导目录（借鉴 cc-sdd `.kiro/steering/`）——跨 change 的项目级 AI 指导
    const steeringDir = path.join(cwd, '.sdd', 'steering');
    await fs.ensureDir(steeringDir);
    const steeringTpl = path.join(steeringDir, 'project.md');
    if (!await fs.pathExists(steeringTpl)) {
      await fs.writeFile(steeringTpl, `# Project Steering\n\n跨 change 持久的项目级指导（agent 每个 stage 都读）。\n\n## Tech Stack\n- \n\n## Architecture\n- \n\n## Coding Standards\n- \n\n## Domain Knowledge\n- \n`);
      console.log(chalk.green('  ✓ .sdd/steering/project.md（持久指导，请填写）'));
    }

    const cfgSrc = path.join(TEMPLATES_DIR, 'sdd-harness', 'config.yaml');
    const cfgDest = path.join(cwd, '.sdd', 'config.yaml');
    if (!await fs.pathExists(cfgDest) || force) {
      await fs.copy(cfgSrc, cfgDest, { overwrite: force });
      console.log(chalk.green('  ✓ .sdd/config.yaml'));
    }
    const depsSrc = path.join(TEMPLATES_DIR, 'sdd-harness', 'dependencies.yaml');
    const depsDest = path.join(cwd, '.sdd', 'dependencies.yaml');
    if (await fs.pathExists(depsSrc) && !await fs.pathExists(depsDest)) {
      await fs.copy(depsSrc, depsDest);
      console.log(chalk.green('  ✓ .sdd/dependencies.yaml'));
    }

    // .gitignore 加 .sdd/runs/
    const gitignore = path.join(cwd, '.gitignore');
    let gi = await fs.readFile(gitignore, 'utf8').catch(() => '');
    if (!gi.includes('.sdd/runs/')) {
      gi += '\n# SDD Harness runtime\n.sdd/runs/\n.understand-anything/\n';
      await fs.writeFile(gitignore, gi);
      console.log(chalk.green('  ✓ .gitignore (+ .sdd/runs/, .understand-anything/)'));
    }
  }

  return count;
}

// 复制 skills 目录
async function copySkills(cwd, platform, force, dryRun) {
  const config = PLATFORMS[platform];
  const destSkillsDir = path.join(cwd, config.skillsDir);
  const templateSkillsDir = path.join(TEMPLATES_DIR, config.templateDir, 'skills');

  if (!await fs.pathExists(templateSkillsDir)) return 0;

  if (dryRun) {
    const skills = (await fs.readdir(templateSkillsDir)).filter(async s => {
      const stat = await fs.stat(path.join(templateSkillsDir, s));
      return stat.isDirectory();
    });
    console.log(chalk.cyan(`  [dry-run] Would copy ${skills.length} skills to ${config.skillsDir}/`));
    return skills.length;
  }

  await fs.ensureDir(destSkillsDir);
  const skills = await fs.readdir(templateSkillsDir);
  let copied = 0;

  for (const skill of skills) {
    const src = path.join(templateSkillsDir, skill);
    const dest = path.join(destSkillsDir, skill);
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) continue;
    if (await fs.exists(dest) && !force) continue;

    await fs.copy(src, dest, { overwrite: force });
    copied++;
  }

  return copied;
}

// 复制 commands 目录
async function copyCommands(cwd, platform, force, dryRun) {
  const config = PLATFORMS[platform];
  if (!config.commandsDir) return 0;

  const destCommandsDir = path.join(cwd, config.commandsDir);
  const templateCommandsDir = path.join(TEMPLATES_DIR, config.templateDir, 'commands');

  if (!await fs.pathExists(templateCommandsDir)) return 0;

  if (dryRun) {
    const commands = (await fs.readdir(templateCommandsDir)).filter(async c => {
      const stat = await fs.stat(path.join(templateCommandsDir, c));
      return stat.isFile();
    });
    console.log(chalk.cyan(`  [dry-run] Would copy ${commands.length} commands to ${config.commandsDir}/`));
    return commands.length;
  }

  await fs.ensureDir(destCommandsDir);
  const commands = await fs.readdir(templateCommandsDir);
  let copied = 0;

  for (const cmd of commands) {
    const src = path.join(templateCommandsDir, cmd);
    const dest = path.join(destCommandsDir, cmd);
    const stat = await fs.stat(src);
    if (!stat.isFile()) continue;
    if (await fs.exists(dest) && !force) continue;

    await fs.copy(src, dest, { overwrite: force });
    copied++;
  }

  return copied;
}

// 清理旧命令文件
async function cleanupLegacyCommands(cwd, platforms, dryRun) {
  let cleaned = 0;

  for (const plat of platforms) {
    const config = PLATFORMS[plat];
    if (!config.commandsDir) continue;
    const commandsDir = path.join(cwd, config.commandsDir);

    if (!await fs.pathExists(commandsDir)) continue;

    const existing = await fs.readdir(commandsDir);
    for (const legacy of LEGACY_COMMANDS) {
      if (existing.includes(legacy)) {
        const filePath = path.join(commandsDir, legacy);
        if (dryRun) {
          console.log(chalk.cyan(`  [dry-run] Would remove: ${config.commandsDir}/${legacy}`));
        } else {
          await fs.remove(filePath);
          console.log(chalk.gray(`  ✓ Removed legacy: ${config.commandsDir}/${legacy}`));
        }
        cleaned++;
      }
    }
  }

  return cleaned;
}

program
  .name('sdd')
  .description('SDD Harness — AI DevOps workflow wrapper (9-stage spec-driven governance + knowledge closed-loop)')
  .version(VERSION);

program
  .command('init')
  .description('Initialize SDD workflow configuration in current project')
  .option('-f, --force', 'Overwrite existing files', false)
  .option('--skip-schema', 'Skip copying schema files', false)
  .option('--skip-skills', 'Skip copying skill files', false)
  .option('--skip-commands', 'Skip copying command files', false)
  .option('--platform <name>', 'Target platform: claude | opencode | codex | both | all (auto-detect by default)')
  .option('--dry-run', 'Preview changes without writing files', false)
  .action(async (options) => {
    const cwd = process.cwd();

    // P1#4: Platform 参数校验
    if (options.platform && !VALID_PLATFORMS.includes(options.platform)) {
      console.error(chalk.red(`\n❌ Invalid platform: "${options.platform}"`));
      console.error(chalk.red(`   Valid options: ${VALID_PLATFORMS.join(', ')}`));
      process.exit(1);
    }

    const detectedPlatforms = detectPlatforms(cwd);
    const platformsToInstall = resolvePlatforms(options.platform, cwd);

    console.log(chalk.blue(`\n🚀 Initializing SDD workflow v${VERSION}...\n`));
    console.log(chalk.gray(`Detected: ${formatPlatforms(detectedPlatforms)}`));
    console.log(chalk.gray(`Installing: ${formatPlatforms(platformsToInstall)}`));
    console.log(chalk.gray(`Schema: trinity-workflow-v2`));
    if (options.dryRun) {
      console.log(chalk.yellow(`Mode: DRY RUN (no files will be written)\n`));
    } else {
      console.log();
    }

    try {
      await ensureDependencies(platformsToInstall, options.dryRun, cwd);

      // SDD Harness 层（sdd-* skills/commands/hooks/templates/config）
      await copySDDHarnessLayer(cwd, options.dryRun, options.force);

      const legacyCount = await cleanupLegacyCommands(cwd, platformsToInstall, options.dryRun);
      if (legacyCount > 0 && !options.dryRun) {
        console.log(chalk.green(`✓ Cleaned ${legacyCount} legacy command(s)\n`));
      }

      // 1. Copy openspec config and schema (共享)
      if (!options.skipSchema) {
        const openspecDir = path.join(cwd, 'openspec');
        const schema = 'trinity-workflow-v2';

        if (options.dryRun) {
          console.log(chalk.cyan('[dry-run] Would create: openspec/config.yaml'));
          console.log(chalk.cyan(`[dry-run] Would create: openspec/schemas/${schema}/`));
        } else {
          await fs.ensureDir(path.join(openspecDir, 'schemas', schema));
          await fs.ensureDir(path.join(openspecDir, 'specs'));
          await fs.ensureDir(path.join(openspecDir, 'changes'));

          // Copy config.yaml
          const configSrc = path.join(TEMPLATES_DIR, 'openspec', 'config.yaml');
          const configDest = path.join(openspecDir, 'config.yaml');

          if (await fs.exists(configDest) && !options.force) {
            console.log(chalk.yellow('⚠ config.yaml already exists, use --force to overwrite'));
          } else {
            await fs.copy(configSrc, configDest);
            console.log(chalk.green('✓ Created openspec/config.yaml'));
          }

          // Copy entire schema directory
          const schemaSrcDir = path.join(TEMPLATES_DIR, 'openspec', 'schemas', schema);
          const schemaDestDir = path.join(openspecDir, 'schemas', schema);

          if (await fs.pathExists(schemaSrcDir)) {
            await fs.copy(schemaSrcDir, schemaDestDir, { overwrite: options.force });
            console.log(chalk.green(`✓ Created openspec/schemas/${schema}/`));
          }

          // Create .active file
          const activeFile = path.join(openspecDir, '.active');
          if (!await fs.exists(activeFile)) {
            await fs.writeFile(activeFile, '');
          }
        }
      }

      // 2. Copy skills + commands per platform
      if (!options.skipSkills || !options.skipCommands) {
        for (const plat of platformsToInstall) {
          const config = PLATFORMS[plat];
          console.log(chalk.gray(`\n📦 ${config.name}:`));

          if (!options.skipSkills) {
            const skillCount = await copySkills(cwd, plat, options.force, options.dryRun);
            if (skillCount > 0 && !options.dryRun) {
              console.log(chalk.green(`  ✓ Copied ${skillCount} skills to ${config.skillsDir}/`));
            } else if (!options.dryRun) {
              console.log(chalk.gray(`  - Skills already exist, skipping (use --force to overwrite)`));
            }
          }

          if (!options.skipCommands && config.commandsDir) {
            const cmdCount = await copyCommands(cwd, plat, options.force, options.dryRun);
            if (cmdCount > 0 && !options.dryRun) {
              console.log(chalk.green(`  ✓ Copied ${cmdCount} commands to ${config.commandsDir}/`));
            } else if (!options.dryRun) {
              console.log(chalk.gray(`  - Commands already exist, skipping`));
            }
          }
        }
      }

      console.log('\n' + chalk.green.bold(`✅ SDD Harness v${VERSION} initialized!`));

      // Show available commands
      console.log('\n📚 SDD Harness 9 阶段命令:');
      console.log(chalk.cyan('   /sdd:grill "描述"') + '     - 澄清（业务/术语/边界）');
      console.log(chalk.cyan('   /sdd:product') + '          - 产品草案（PRD/AC）');
      console.log(chalk.cyan('   /sdd:dev') + '             - 工程 spec（OpenSpec）');
      console.log(chalk.cyan('   /sdd:test') + '            - 测试矩阵 → LLMWiki');
      console.log(chalk.cyan('   /sdd:code') + '            - 实现（TDD）');
      console.log(chalk.cyan('   /sdd:review') + '          - Review（Superpowers + OCR）');
      console.log(chalk.cyan('   /sdd:verify') + '          - 交付验证（证据）');
      console.log(chalk.cyan('   /sdd:release') + '         - 部署（manual|auto|skip）');
      console.log(chalk.cyan('   /sdd:archive') + '         - 归档 + 知识沉淀\n');
      console.log(chalk.gray('   维护: sdd doctor | sdd upgrade | sdd graph --refresh | sdd wiki init\n'));

      if (options.dryRun) {
        console.log(chalk.yellow('⚠ This was a dry run. No files were written.\n'));
      }

    } catch (error) {
      console.error(chalk.red('\n❌ Initialization failed:'), error.message);
      process.exit(1);
    }
  });

// P2: cleanup 命令
program
  .command('cleanup')
  .description('Clean up legacy SDD workflow files')
  .option('--dry-run', 'Preview without deleting', false)
  .option('--all', 'Clean all known legacy files', false)
  .action(async (options) => {
    const cwd = process.cwd();
    const platforms = detectPlatforms(cwd);

    console.log(chalk.blue('\n🧹 Cleaning up legacy SDD files...\n'));

    const legacyCount = await cleanupLegacyCommands(cwd, platforms, options.dryRun);

    if (legacyCount === 0) {
      console.log(chalk.green('✓ No legacy files found. Clean!'));
    } else if (options.dryRun) {
      console.log(chalk.yellow(`\n⚠ Found ${legacyCount} legacy file(s). Run without --dry-run to remove.`));
    } else {
      console.log(chalk.green(`\n✓ Removed ${legacyCount} legacy file(s).`));
    }
    console.log();
  });

// P2: doctor 命令
program
  .command('doctor')
  .description('Diagnose SDD workflow health')
  .option('--fix', 'Auto-fix issues (install missing dependencies)', false)
  .action(async (options) => {
    const cwd = process.cwd();
    let issues = 0;

    console.log(chalk.blue('\n🔍 SDD Workflow Health Check\n'));

    // Check openspec config
    const configPath = path.join(cwd, 'openspec', 'config.yaml');
    if (await fs.pathExists(configPath)) {
      console.log(chalk.green('✅ openspec/config.yaml exists'));
    } else {
      console.log(chalk.red('❌ openspec/config.yaml missing — run `sdd init`'));
      issues++;
    }

    // Check schema
    const schemaDir = path.join(cwd, 'openspec', 'schemas', 'trinity-workflow-v2');
    if (await fs.pathExists(schemaDir)) {
      const schemaFile = path.join(schemaDir, 'schema.yaml');
      if (await fs.pathExists(schemaFile)) {
        console.log(chalk.green('✅ trinity-workflow-v2 schema exists'));
      } else {
        console.log(chalk.red('❌ schema.yaml missing in trinity-workflow-v2'));
        issues++;
      }
    } else {
      console.log(chalk.red('❌ trinity-workflow-v2 schema directory missing'));
      issues++;
    }

    // Check skills per platform
    const platforms = detectPlatforms(cwd);

    for (const plat of platforms) {
      const config = PLATFORMS[plat];
      const skillsDir = path.join(cwd, config.skillsDir);
      if (await fs.pathExists(skillsDir)) {
        const allDirs = await fs.readdir(skillsDir);
        const trinitySkills = [];
        for (const d of allDirs) {
          if (d.startsWith('trinity-')) {
            const stat = await fs.stat(path.join(skillsDir, d));
            if (stat.isDirectory()) trinitySkills.push(d);
          }
        }
        if (trinitySkills.length >= 7) {
          console.log(chalk.green(`✅ ${config.name}: ${trinitySkills.length} Trinity skills installed`));
        } else {
          console.log(chalk.yellow(`⚠️  ${config.name}: Only ${trinitySkills.length}/7 Trinity skills — run \`sdd init --force\``));
          issues++;
        }
      } else {
        console.log(chalk.yellow(`⚠️  ${config.name}: Skills directory missing — run \`sdd init\``));
        issues++;
      }
    }

    // Check legacy commands
    for (const plat of platforms) {
      const config = PLATFORMS[plat];
      if (!config.commandsDir) continue;
      const commandsDir = path.join(cwd, config.commandsDir);
      if (await fs.pathExists(commandsDir)) {
        const existing = await fs.readdir(commandsDir);
        const found = existing.filter(f => LEGACY_COMMANDS.includes(f));
        if (found.length > 0) {
          console.log(chalk.yellow(`⚠️  ${config.name}: ${found.length} legacy commands found — run \`sdd cleanup\``));
          issues++;
        } else {
          console.log(chalk.green(`✅ ${config.name}: No legacy commands`));
        }
      }
    }

    // Check openspec CLI
    try {
      const version = execSync('openspec --version', { encoding: 'utf8' }).trim();
      console.log(chalk.green(`✅ openspec CLI: ${version}`));
    } catch {
      console.log(chalk.yellow('⚠️  openspec CLI not found — install with `brew install openspec`'));
      issues++;
    }

    // === SDD Harness 专属检查 ===
    console.log(chalk.blue('\n── SDD Harness 依赖 ──'));

    // open-code-review CLI
    if (cmdExists('ocr')) {
      console.log(chalk.green('✅ open-code-review CLI (review 阶段)'));
    } else {
      console.log(chalk.yellow('⚠️  open-code-review 缺失 (review 行级降级) — npm i -g @alibaba-group/open-code-review'));
      issues++;
    }

    // sdd-* skills
    const sddSkillsDir = path.join(cwd, '.claude', 'skills');
    if (await fs.pathExists(sddSkillsDir)) {
      const sddSkills = (await fs.readdir(sddSkillsDir)).filter(d => d.startsWith('sdd-'));
      if (sddSkills.length >= 10) {
        console.log(chalk.green(`✅ SDD skills: ${sddSkills.length} 个`));
      } else {
        console.log(chalk.yellow(`⚠️  SDD skills 仅 ${sddSkills.length}/10 — 运行 sdd init --force`));
        issues++;
      }
    }

    // /sdd commands
    const sddCmdsDir = path.join(cwd, '.claude', 'commands');
    if (await fs.pathExists(sddCmdsDir)) {
      const sddCmds = (await fs.readdir(sddCmdsDir)).filter(f => f.startsWith('sdd-') && (f === 'sdd-grill.md' || f === 'sdd-product.md' || f === 'sdd-dev.md' || f === 'sdd-test.md' || f === 'sdd-code.md' || f === 'sdd-review.md' || f === 'sdd-verify.md' || f === 'sdd-release.md' || f === 'sdd-archive.md'));
      console.log(sddCmds.length >= 9 ? chalk.green(`✅ /sdd:* commands: ${sddCmds.length} 个`) : chalk.yellow(`⚠️  /sdd commands ${sddCmds.length}/9`));
    }

    // LLMWiki repo + wiki 内容
    const llmwikiRepo = path.join(os.homedir(), '.sdd', 'repos', 'llmwiki');
    if (await fs.pathExists(llmwikiRepo)) {
      console.log(chalk.green('✅ LLMWiki repo (test/archive 阶段)'));
    } else {
      console.log(chalk.yellow('⚠️  LLMWiki repo 缺失 (用例/知识无法持久化) — sdd init 重试或手动 clone'));
      issues++;
    }
    const wikiContent = path.join(cwd, 'llmwiki', 'wiki');
    console.log(await fs.pathExists(wikiContent) ? chalk.green('✅ LLMWiki wiki 内容目录') : chalk.yellow('⚠️  wiki 内容目录缺失 — sdd wiki init'));

    // knowledge-graph — deep health check (freshness + orphan detection)
    const graphHealth = graphHealthCheck(cwd);
    if (graphHealth.existence === 'missing') {
      console.log(chalk.gray('ℹ️  knowledge-graph 未建 — sdd graph --install'));
    } else if (graphHealth.existence === 'placeholder') {
      console.log(chalk.gray('ℹ️  knowledge-graph 占位 (code graph 按需) — sdd graph --install 启用'));
    } else if (graphHealth.existence === 'corrupt') {
      console.log(chalk.red('❌ knowledge-graph.json is corrupt — sdd graph --install'));
      issues++;
    } else {
      // Graph exists with nodes — check freshness and orphans
      const hasIssues = graphHealth.issues.length > 0;
      if (hasIssues) {
        console.log(chalk.yellow(`⚠️  knowledge-graph: ${graphHealth.nodeCount} nodes, but ${graphHealth.issues.length} issue(s):`));
        for (const issue of graphHealth.issues) {
          console.log(chalk.yellow(`     → ${issue}`));
        }
        console.log(chalk.gray('     Fix: sdd graph --refresh'));
      } else {
        console.log(chalk.green(`✅ knowledge-graph healthy (${graphHealth.nodeCount} nodes, ${graphHealth.edgeCount} edges, ${graphHealth.layerCount} layers)`));
      }
    }

    // hooks
    const hooksDir = path.join(cwd, '.sdd', 'hooks');
    if (await fs.pathExists(hooksDir)) {
      const hooks = (await fs.readdir(hooksDir)).filter(f => f.endsWith('.sh'));
      console.log(chalk.green(`✅ hooks: ${hooks.length} 个`));
    }

        console.log();
    // Graph issues are warnings (not hard blockers), but should be reported
    const graphIssues = graphHealthCheck(cwd).issues.length;
    if (issues === 0 && graphIssues === 0) {
      console.log(chalk.green.bold('✅ All checks passed! SDD Harness ready.\n'));
    } else if (issues === 0 && graphIssues > 0) {
      console.log(chalk.yellow.bold(`⚠️  Core checks passed, but knowledge-graph has ${graphIssues} issue(s). Run /understand to refresh.\n`));
    } else if (options.fix) {
      console.log(chalk.yellow.bold(`⚠️  Found ${issues} issue(s). Auto-fixing...\n`));
      const platforms = detectPlatforms(cwd);
      await ensureDependencies(platforms, false, cwd);
      console.log(chalk.green('✅ Auto-fix complete. Run `sdd doctor` again to verify.\n'));
    } else {
      console.log(chalk.yellow.bold(`⚠️  Found ${issues} issue(s). Run \`sdd doctor --fix\` to auto-fix, or fix manually.\n`));
    }
  });

program
  .command('list')
  .description('List available commands and schemas')
  .action(() => {
    console.log(chalk.bold('\n📚 SDD Harness 9 阶段命令:'));
    console.log('   /sdd:grill "描述"   - 澄清（discovery 路由）');
    console.log('   /sdd:product        - 产品草案（PRD/AC）');
    console.log('   /sdd:dev            - 工程 spec（OpenSpec）');
    console.log('   /sdd:test           - 测试矩阵 → LLMWiki');
    console.log('   /sdd:code           - 实现（TDD）');
    console.log('   /sdd:review         - Review（Superpowers + OCR）');
    console.log('   /sdd:verify         - 交付验证');
    console.log('   /sdd:release        - 部署（manual|auto|skip）');
    console.log('   /sdd:archive        - 归档 + 知识沉淀');

    console.log(chalk.bold('\n🔧 维护命令:'));
    console.log('   sdd init / sdd doctor / sdd graph --install / sdd wiki init / sdd upgrade');

    console.log(chalk.bold('\n🖥️ Supported Platforms:'));
    console.log('   claude   - Claude Code (.claude/skills/, .claude/commands/)');
    console.log('   opencode - OpenCode (.opencode/skills/, .opencode/commands/)');
    console.log('   codex    - Codex (.codex/skills/)');
    console.log('   both     - Install for Claude Code and OpenCode');
    console.log('   all      - Install for all supported platforms (default when no platform is detected)\n');
  });

// sdd run <stage> —— CLI 驱动 stage：bootstrap run + scaffold artifact + 推进 frame
const STAGE_CONTRACTS = {
  grill:    { next: 'product',  artifacts: ['findings.md'], scaffold: { 'findings.md': '# Findings\n\n## 术语\n- \n\n## 边界\n- \n\n## ADR 候选\n- \n' } },
  product:  { next: 'dev',      artifacts: ['proposal.md','acceptance-criteria.md','functional-test-draft.yaml'], scaffold: {
              'proposal.md': '# Proposal\n\n## User\n- \n## Problem\n- \n## Scope\n- \n## Non-goals\n- \n## Metrics\n- \n',
              'acceptance-criteria.md': '# Acceptance Criteria\n\n## AC-1\nGIVEN \nWHEN \nTHEN \n',
              'functional-test-draft.yaml': 'feature: \nscenarios:\n  happy-path: []\n  edge-cases: []\n  error-cases: []\n' } },
  dev:      { next: 'test',     artifacts: ['design.md','tasks.md'], scaffold: {
              'design.md': '# Design\n\n## File Structure Plan\n- \n\n## Boundary\n_Boundary_: \n_Depends_: \n',
              'tasks.md': '# Tasks\n- [ ] T1: _Boundary: _\n' } },
  test:     { next: 'code',     artifacts: [], wiki: 'wiki/testing/matrices/test-matrix.md' },
  code:     { next: 'review',   artifacts: ['progress.md'], scaffold: { 'progress.md': '# Progress\n\n## [code]\n- \n' } },
  review:   { next: 'verify',   artifacts: [], runtime: 'review-notes.md' },
  verify:   { next: 'release',  artifacts: [], note: '证据写进 progress.md' },
  release:  { next: 'archive',  artifacts: [], modes: ['manual','automated','skip'] },
  archive:  { next: null,       artifacts: [], promote: 'openspec/specs/' },
};

program
  .command('run <stage>')
  .description('Drive a SDD stage via CLI: bootstrap run + scaffold artifacts + advance frame (grill|product|dev|test|code|review|verify|release|archive)')
  .option('--change <id>', 'Use existing change-id (skip bootstrap)')
  .option('--goal <text>', 'Goal for the change (grill bootstrap)')
  .option('--slug <slug>', 'Explicit slug for change-id (default: derive from goal or timestamp)')
  .option('--mode <m>', 'Release mode: manual|automated|skip', 'manual')
  .action(async (stage, options) => {
    const cwd = process.cwd();
    if (!STAGE_CONTRACTS[stage]) {
      console.log(chalk.red(`❌ 未知 stage: ${stage}`));
      console.log(chalk.gray('   可用: ' + Object.keys(STAGE_CONTRACTS).join(' | ')));
      process.exit(1);
    }
    const contract = STAGE_CONTRACTS[stage];
    const activeRunFile = path.join(cwd, '.sdd', 'active-run');

    console.log(chalk.blue(`\n▶ /sdd:${stage}${stage==='release' ? ` (mode=${options.mode})` : ''} (CLI-driven)\n`));

    // release skip 模式：直接跳到 archive
    if (stage === 'release' && options.mode === 'skip') {
      console.log(chalk.yellow('  ⏭  skip 模式：跳过 release，直接推进 verify→archive'));
      // 直接推进 frame 到 archive（若 active run 存在）
      if (await fs.pathExists(activeRunFile)) {
        const cid = (await fs.readFile(activeRunFile, 'utf8')).trim();
        const skipRunsDir = path.join(cwd, '.sdd', 'runs', cid);
        const wfPath = path.join(skipRunsDir, 'workflow-frame.yaml');
        if (await fs.pathExists(wfPath)) {
          let wf = await fs.readFile(wfPath, 'utf8');
          const current = wf.match(/current:\s*(\w+)/)?.[1];
          const archiveGate = await evaluateStageAdvanceGate({
            stage: 'archive',
            runsDir: skipRunsDir,
          });
          if (!['verify', 'release'].includes(current) || !archiveGate.pass) {
            wf = wf.replace(/status:\s*\w+/, 'status: failed');
            await fs.writeFile(wfPath, wf);
            const reason = !['verify', 'release'].includes(current)
              ? `current stage is ${current || 'unknown'}`
              : archiveGate.failures.map(item => item.reason).join('; ');
            console.log(chalk.red(`  ⛔ release skip 被阻止：${reason}`));
            process.exitCode = 2;
            return;
          }
          wf = wf.replace(/current: \w+/, 'current: archive').replace(/status:\s*\w+/, 'status: passed');
          await fs.writeFile(wfPath, wf);
          console.log(chalk.green(`  ✓ workflow-frame stage → archive (skip no-deploy)`));
          // 记录 no-deploy 理由到 progress
          const prog = path.join(cwd, 'openspec', 'changes', cid, 'progress.md');
          if (await fs.pathExists(prog)) {
            await fs.appendFile(prog, `\n## [release skip] no-deploy（CLI 标记，reason: skip 模式）\n`);
          }
        }
      }
      console.log(chalk.green('  🏁 跳过完成。\n'));
      return;
    }

    // Bootstrap run（首次或指定 --change）
    let changeId = options.change;
    if (!changeId && await fs.pathExists(activeRunFile)) {
      changeId = (await fs.readFile(activeRunFile, 'utf8')).trim();
    }
    let bootstrap = false;
    if (!changeId) {
      // 生成 slug：优先 --slug，其次 goal 拉丁字符，最后 timestamp（避免中文/纯非拉丁 → 空）
      let slug = options.slug;
      if (!slug) {
        const raw = (options.goal || '').toLowerCase();
        slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      if (!slug) {
        // goal 无拉丁字符（如纯中文）→ 用 timestamp slug
        slug = 'change-' + Date.now().toString(36);
      }
      slug = slug.slice(0, 24);
      const hash = Math.random().toString(16).slice(2, 6);
      changeId = `${slug}-${hash}`;
      bootstrap = true;
    }

    // 归档路径回退：change 已 archive 时在 changes/archive/<date>-<id>/ 下
    let changesDir = path.join(cwd, 'openspec', 'changes', changeId);
    if (!await fs.pathExists(changesDir)) {
      const archiveBase = path.join(cwd, 'openspec', 'changes', 'archive');
      if (await fs.pathExists(archiveBase)) {
        const match = (await fs.readdir(archiveBase)).find(d => d.endsWith('-' + changeId));
        if (match) changesDir = path.join(archiveBase, match);
      }
    }
    const runsDir = path.join(cwd, '.sdd', 'runs', changeId);
    const wfPath = path.join(runsDir, 'workflow-frame.yaml');

    if (bootstrap) {
      console.log(chalk.cyan(`📦 bootstrap run: ${changeId}`));
      await fs.ensureDir(path.join(changesDir, 'specs'));
      await fs.ensureDir(runsDir);
      // 实例化 workflow-frame
      await fs.writeFile(path.join(runsDir, 'workflow-frame.yaml'),
        `run_id: ${changeId}\nstage:\n  current: ${stage}\n  history: []\ngoal: "${options.goal || ''}"\nartifacts:\n  required: ${JSON.stringify(contract.artifacts)}\n  produced: []\ngates:\n  status: pending\n`);
      await fs.writeFile(activeRunFile, changeId);
      console.log(chalk.green(`  ✓ openspec/changes/${changeId}/`));
      console.log(chalk.green(`  ✓ .sdd/runs/${changeId}/workflow-frame.yaml (stage=${stage})`));
      console.log(chalk.green(`  ✓ .sdd/active-run → ${changeId}`));
    } else {
      console.log(chalk.cyan(`▶ resume run: ${changeId}`));
      if (await fs.pathExists(wfPath)) {
        const wf = await fs.readFile(wfPath, 'utf8');
        const current = wf.match(/current:\s*(\w+)/)?.[1];
        if (current && current !== stage) {
          console.log(chalk.red(`  ⛔ stage entry 被阻止：workflow 当前为 ${current}，不能执行 ${stage}`));
          process.exitCode = 2;
          return;
        }
      }
    }

    // Scaffold 该 stage 的 artifact
    if (contract.scaffold) {
      for (const [file, content] of Object.entries(contract.scaffold)) {
        const fp = path.join(changesDir, file);
        if (!await fs.pathExists(fp)) {
          await fs.writeFile(fp, content);
          console.log(chalk.green(`  ✓ scaffold ${file}`));
        } else {
          console.log(chalk.gray(`  · ${file} 已存在，跳过`));
        }
      }
    }
    if (contract.wiki) {
      const wp = path.join(cwd, 'llmwiki', contract.wiki);
      await fs.ensureDir(path.dirname(wp));
      if (!await fs.pathExists(wp)) {
        await fs.writeFile(wp, `# Test Matrix\n\n| feature | unit | integration | e2e |\n|---------|------|-------------|-----|\n|  |  |  |  |\n`);
        console.log(chalk.green(`  ✓ scaffold ${contract.wiki}`));
      }
    }
    if (contract.runtime) {
      const rp = path.join(runsDir, contract.runtime);
      if (!await fs.pathExists(rp)) {
        await fs.writeFile(rp, `# ${contract.runtime}\n\n(Superpowers verdict + OCR 评论 — 由 agent 填)\n`);
        console.log(chalk.green(`  ✓ scaffold .sdd/runs/${changeId}/${contract.runtime}`));
      }
    }

    // Gate 检查（CLI 验存在性）
    console.log(chalk.blue('\n🔍 Gate 检查（存在性）:'));
    let gateOk = true;
    for (const art of contract.artifacts) {
      const exists = await fs.pathExists(path.join(changesDir, art));
      console.log(`   ${exists ? chalk.green('✅') : chalk.yellow('⚠️')} ${art} ${exists ? '' : '(skeleton 已 scaffold，待 agent 填内容)'}`);
    }
    if (contract.promote) {
      const promoted = await fs.pathExists(path.join(cwd, contract.promote, changeId.split('-').slice(0,-1).join('-')));
      console.log(`   ${promoted ? chalk.green('✅') : chalk.gray('ℹ️')} spec promotion (archive 阶段做)`);
    }

    const stageGate = await evaluateStageAdvanceGate({ stage, runsDir });
    if (!stageGate.pass) {
      gateOk = false;
      for (const item of stageGate.failures) {
        console.log(chalk.red(`   ❌ ${item.gate}: ${item.reason}`));
      }
    }

    // 推进 frame
    if (!gateOk) {
      if (await fs.pathExists(wfPath)) {
        let wf = await fs.readFile(wfPath, 'utf8');
        wf = wf.replace(/status:\s*\w+/, 'status: failed');
        await fs.writeFile(wfPath, wf);
      }
      console.log(chalk.red(`\n⛔ ${stage} gate 未通过，stage 保持不变。\n`));
      process.exitCode = 2;
      return;
    }

    // Content quality check: run metrics before advancing
    // If artifacts are empty scaffolds, stay at current stage and guide user
    // Content quality check: only for content-producing stages (grill→review).
    // verify/release/archive use stage-gates.js (probe/evidence checks).
    const CONTENT_STAGES = new Set(['grill', 'product', 'dev', 'test', 'code', 'review']);
    let metricsPass = true;
    if (CONTENT_STAGES.has(stage)) {
    try {
      const r = await evalStageMetrics(stage, changeId, cwd);
      if (r.error) {
        // No metrics for this stage — skip content check
      } else {
        metricsPass = r.allPass;
        if (!r.allPass) {
          const failed = r.results.filter(m => !m.pass);
          console.log(chalk.yellow(`\n⚠️ ${stage} 内容指标 ${r.results.filter(m=>m.pass).length}/${r.results.length} 达标：`));
          for (const m of failed) {
            console.log(chalk.yellow(`   ❌ ${m.name}: ${m.actual} ${m.op} ${m.threshold}`));
          }
        }
      }
    } catch (e) {
      // metrics eval failed — proceed with existence gate only
    }
    } // end CONTENT_STAGES check

    if (!metricsPass) {
      // Update frame: gate exists but content not ready
      if (await fs.pathExists(wfPath)) {
        let wf = await fs.readFile(wfPath, 'utf8');
        wf = wf.replace(/status:\s*\w+/, 'status: pending');
        await fs.writeFile(wfPath, wf);
      }
      console.log(chalk.cyan(`\n📌 ${stage} scaffold 完成，但内容未达标。stage 保持 ${stage}。`));
      console.log(chalk.gray(`   填充内容后重跑 sdd run ${stage} 推进，或 sdd fill ${stage} 自动生成。\n`));
      return;
    }

    if (await fs.pathExists(wfPath) && contract.next) {
      let wf = await fs.readFile(wfPath, 'utf8');
      wf = wf.replace(/current: \w+/, `current: ${contract.next}`);
      wf = wf.replace(/status:\s*\w+/, 'status: passed');
      await fs.writeFile(wfPath, wf);
      console.log(chalk.blue(`\n✅ ${stage} 内容达标，推进 → ${contract.next}`));

      // Auto-sediment stage artifacts to LLMWiki
      try {
        const sed = await sedimentStage(changeId, stage, cwd);
        if (sed.sediments && sed.sediments.length > 0) {
          console.log(chalk.gray(`   📝 LLMWiki sediment: ${sed.sediments.length} 条 → llmwiki/`));
        }
      } catch (e) {
        // sediment failure is non-blocking
      }
    } else if (!contract.next) {
      console.log(chalk.green('\n🏁 最终 stage (archive)。workflow 完成。'));
    }
  });

// sdd graph —— clone UA + auto-trigger /understand to generate/refresh graph
// sdd schedule — 定时刷新 UA 知识图谱（每日 02:00）
program
  .command('schedule')
  .description('Manage daily knowledge graph refresh (Understand-Anything)')
  .option('--install', 'Install daily UA graph refresh job (launchd/cron)', false)
  .option('--uninstall', 'Remove daily UA graph refresh job', false)
  .option('--status', 'Check if daily refresh is installed', false)
  .action(async (options) => {
    const cwd = process.cwd();

    if (options.install) {
      console.log(chalk.blue('\n⏰ Installing daily UA graph refresh...\n'));
      const result = await installDailyGraphRefresh(cwd);
      console.log(chalk.green(`✅ Daily refresh installed (${result.schedule})`));
      console.log(chalk.gray(`   Platform: ${result.platform}`));
      console.log(chalk.gray(`   Script: ${result.scriptPath}`));
      console.log(chalk.gray(`   Project: ${cwd}`));
      console.log(chalk.gray('\n   UA knowledge graph will auto-refresh every day at 02:00.'));
      console.log(chalk.gray('   Logs: ~/.sdd/logs/graph-refresh.log'));
    } else if (options.uninstall) {
      console.log(chalk.blue('\n⏰ Removing daily UA graph refresh...\n'));
      const result = await uninstallDailyGraphRefresh();
      console.log(chalk.green('✅ Daily refresh removed'));
    } else {
      // Default: show status
      const status = await checkDailyGraphRefresh();
      if (status.installed) {
        console.log(chalk.green('\n✅ Daily UA graph refresh is installed\n'));
        if (status.plistPath) console.log(chalk.gray(`   ${status.plistPath}`));
      } else {
        console.log(chalk.yellow('\n⚠️  Daily UA graph refresh not installed\n'));
        console.log(chalk.gray('   Install: sdd schedule --install'));
      }
    }
  });

program
  .command('graph')
  .description('Refresh code knowledge graph (Understand-Anything)')
  .option('--install', 'Clone Understand-Anything repo if missing', false)
  .option('--refresh', 'Force trigger /understand via claude -p', false)
  .action(async (options) => {
    const cwd = process.cwd();
    const homeDir = os.homedir();
    const graphPath = path.join(cwd, '.understand-anything', 'knowledge-graph.json');
    console.log(chalk.blue('\n🧠 SDD Harness - Code Graph\n'));

    // Detect UA installation in multiple locations
    const uaCandidates = [
      path.join(homeDir, '.sdd', 'repos', 'Understand-Anything'),
      path.join(homeDir, '.understand-anything', 'repo', 'understand-anything-plugin'),
    ];
    const uaRepoDir = uaCandidates.find(d => fs.pathExistsSync(d));
    const uaInstalled = !!uaRepoDir ||
      fs.pathExistsSync(path.join(homeDir, '.understand-anything', 'repo'));

    if (options.install && !uaInstalled) {
      const installDir = path.join(homeDir, '.sdd', 'repos', 'Understand-Anything');
      console.log(chalk.yellow('⏳ clone Understand-Anything...'));
      const r = await cloneRepo('https://github.com/Egonex-AI/Understand-Anything', installDir, false);
      if (r === 'failed') { console.log(chalk.red('\n❌ clone 失败')); process.exit(1); }
      if (await fs.pathExists(path.join(installDir, 'install.sh'))) {
        try { execSync(`cd ${installDir} && bash install.sh`, { stdio: 'inherit' }); } catch {}
      }
      console.log(chalk.green('✅ Understand-Anything installed'));
    } else if (uaInstalled) {
      console.log(chalk.green(`✅ Understand-Anything 已安装`));
    } else {
      console.log(chalk.yellow('⚠️ 未安装。运行: sdd graph --install'));
      return;
    }

    // Health check
    const health = graphHealthCheck(cwd);
    if (health.existence === 'ok' && health.issues.length === 0) {
      console.log(chalk.green(`✅ knowledge-graph healthy (${health.nodeCount} nodes, ${health.edgeCount} edges, ${health.layerCount} layers)`));
      return;
    }
    if (health.existence === 'ok' && health.issues.length > 0) {
      console.log(chalk.yellow(`⚠️ knowledge-graph has ${health.issues.length} issue(s):`));
      for (const i of health.issues) console.log(chalk.yellow(`   → ${i}`));
    } else {
      console.log(chalk.yellow('⚠️ knowledge-graph.json missing or placeholder'));
    }

    // Try auto-refresh via claude -p
    const hasClaude = cmdExists('claude');
    if (!hasClaude) {
      console.log(chalk.gray('\n   📌 Run /understand in your AI tool session to generate'));
      console.log(chalk.gray('   Or install Claude Code: sdd graph --refresh'));
      return;
    }

    if (!options.refresh && health.issues.length === 0 && health.existence === 'ok') {
      return; // healthy, no action needed
    }

    console.log(chalk.cyan('\n   🤖 Triggering /understand via claude -p headless...\n'));
    console.log(chalk.gray('   This may take 5-15 minutes depending on repo size.\n'));

    // If graph is a symlink (shared from another worktree), break it
    try {
      const stats = await fs.lstat(graphPath);
      if (stats.isSymbolicLink()) {
        await fs.unlink(graphPath);
        console.log(chalk.gray('   Removed symlink to shared graph; generating project-specific graph.\n'));
      }
    } catch {}

    const result = await ptyClaude(
      `Run the /understand command to analyze this codebase at ${cwd} and generate ` +
      `.understand-anything/knowledge-graph.json with nodes, edges, and layers. ` +
      `Use the understand skill pipeline.`,
      { cwd, model: 'sonnet', timeoutMs: 900000 }
    );

    if (result.timedOut) {
      console.log(chalk.yellow('⚠️ /understand timed out (15 min). Graph may be partial.'));
    } else {
      const postHealth = graphHealthCheck(cwd);
      if (postHealth.existence === 'ok' && postHealth.nodeCount > 0) {
        console.log(chalk.green(`\n✅ Knowledge graph refreshed (${postHealth.nodeCount} nodes, ${postHealth.edgeCount} edges)`));
      } else {
        console.log(chalk.yellow('\n⚠️ Graph may not have completed. Run /understand manually.'));
      }
    }
  });

program
  const wikiCmd = program.command('wiki').description('管理 LLMWiki（init / ingest）');
  wikiCmd.command('init')
    .description('Initialize or rebuild LLMWiki instance skeleton')
    .option('--rebuild', 'Wipe and rebuild', false)
    .action(async (options) => {
      const cwd = process.cwd();
      const wikiDir = path.join(cwd, 'llmwiki');
      if (options.rebuild && await fs.pathExists(wikiDir)) await fs.remove(wikiDir);
      const subs = ['raw','wiki/sources','wiki/concepts','wiki/entities','wiki/outputs','wiki/product/requirements','wiki/product/acceptance-criteria','wiki/engineering','wiki/testing/cases','wiki/testing/matrices','wiki/_shared/glossary','wiki/_shared/traceability'];
      for (const d of subs) await fs.ensureDir(path.join(wikiDir, d));
      if (!await fs.pathExists(path.join(wikiDir, 'index.md'))) await fs.writeFile(path.join(wikiDir, 'index.md'), '# LLMWiki Index\n');
      console.log(chalk.green(`✅ LLMWiki 骨架 (${subs.length} 子目录)`));
      // Knowledge seed from existing project sources
      const ks = discoverKnowledgeSources(cwd);
      const ksCount = ks.docs.length + ks.specs.length + ks.steering.length + ks.agentDocs.length;
      if (ksCount > 0 || ks.catalog) {
        const seedResult = generateSeedContent(cwd, ks);
        console.log(chalk.green(`✅ Knowledge seed: ${seedResult.files.length} entries (${ksCount} sources scanned)`));
      } else {
        console.log(chalk.gray('ℹ️  No existing knowledge sources found to seed'));
      }
      console.log();
    });
 wikiCmd.command('ingest')
   .description('读取 raw/ 源，驱动 claude 生成 wiki/sources/ 摘要（§5 ingest）')
   .option('--source <name>', '只处理指定 raw 文件（不含 .md）', '')
   .option('--force', '重新生成已有摘要', false)
   .option('--model <m>', 'claude model', 'sonnet')
    .option('--promote', 'ingest 后把 sources 派生为下游角色知识（§5 ingest ④更新下游）', false)
   .action(async (options) => {
      const cwd = process.cwd();
      const rawDir = path.join(cwd, 'llmwiki', 'raw');
      const sourcesDir = path.join(cwd, 'llmwiki', 'wiki', 'sources');
      await fs.ensureDir(rawDir); await fs.ensureDir(sourcesDir);
      const today = new Date().toISOString().slice(0, 10);
      const rawFiles = options.source ? [options.source + '.md'] : (await fs.readdir(rawDir).catch(() => [])).filter(f => f.endsWith('.md'));
      if (rawFiles.length === 0) { console.log(chalk.yellow('⚠️ raw/ 无 .md 源文件。先把源文档放入 llmwiki/raw/')); process.exit(1); }
      let ingested = 0, skipped = 0;
      for (const rf of rawFiles) {
        const rawPath = path.join(rawDir, rf); const sourcePath = path.join(sourcesDir, rf);
        if (!await fs.pathExists(rawPath)) { console.log(chalk.yellow(`  ⚠️ 跳过：${rf} 不存在`)); continue; }
        if (await fs.pathExists(sourcePath) && !options.force) { console.log(chalk.gray(`  ✓ 已有摘要：${rf}（--force 重生成）`)); skipped++; continue; }
        console.log(chalk.blue(`\n  ▶ ingest: ${rf}`));
        const ingestPrompt = `你是 LLMWiki ingest agent。执行 ingest workflow（§5）：

1. 读 raw 源文件：${rawPath}
2. 生成 sources 摘要页写入：${sourcePath}，YAML frontmatter 必须含：
   type: source-summary, source_file: ${rf}, ingest_date: ${today}
   key_claims: [3-5 条关键声明], contradicts: [矛盾处无则 []], supports: [下游知识无则 []]
3. 正文：1-2 段提炼摘要，不重复全文。
4. 追加 ingest 记录到 ${cwd}/llmwiki/log.md：
   ## [ingest] ${today} | ${rf}
   - key_claims: N 条 / 矛盾: X 处
用 Write 工具写文件。立刻完成。`;
        try {
          const result = await ptyClaude(ingestPrompt, { cwd, model: options.model, timeoutMs: 300000 });
          if (!result.timedOut && await fs.pathExists(sourcePath)) { ingested++; console.log(chalk.green(`    ✓ ${rf} ingest 完成`)); }
          else { console.log(chalk.red(`    ❌ ${rf} 未生成摘要（exit=${result.exitCode}）`)); }
        } catch (e) { console.log(chalk.red(`    ❌ ${rf} 失败：${String(e.message).split('\n')[0]}`)); }
      }
     console.log(chalk.green(`\n✅ ingest：${ingested} 新 / ${skipped} 跳过\n`));
      // §5 ingest 第④步：sources → 下游角色知识（product/engineering）
      if (options.promote) {
        const allSources = (await fs.readdir(sourcesDir).catch(() => [])).filter(f => f.endsWith('.md'));
        console.log(chalk.blue(`\n  ▶ promote：${allSources.length} 个 source → 下游角色知识\n`));
        const sourcesContent = allSources.map(f => `## ${f}\n${fs.readFileSync(path.join(sourcesDir,f),'utf8').slice(0,400)}`).join('\n');
        const promotePrompt = `你是 LLMWiki ingest agent。执行 §5 ingest 第④步（更新下游）：基于已生成的 sources 摘要，派生下游角色知识。

## sources 摘要
${sourcesContent}

## 任务
读 sources 的 key_claims，判断每条属于哪个角色，写入对应角色知识目录（frontmatter 必须含 raw 指回其 source 摘要）：
- 产品相关（需求/目标/边界/用户）→ ${cwd}/llmwiki/wiki/product/REQ-<slug>.md（type: requirement, raw: ../wiki/sources/<对应source>.md）
- 工程相关（架构/设计/决策/技术约束）→ ${cwd}/llmwiki/wiki/engineering/EN-<slug>.md（type: engineering-note, raw: ../wiki/sources/<对应source>.md）
每条知识是简短的知识视角（不是全文复制），backlink 到 source 摘要。只产出有价值的，不为凑数。用 Write。`;
        try {
          await ptyClaude(promotePrompt, { cwd, model: options.model, timeoutMs: 300000 });
          console.log(chalk.green(`    ✓ promote 完成\n`));
        } catch (e) { console.log(chalk.red(`    ❌ promote 失败：${String(e.message).split('\n')[0]}`)); }
      }
   });
program
  .command('upgrade')
  .description('Upgrade from original sdd-cli to SDD Harness')
  .action(async () => {
    const cwd = process.cwd();
    console.log(chalk.blue('\n🔄 Upgrade from sdd-cli\n'));
    const oldConfig = path.join(cwd, 'openspec', 'config.yaml');
    if (await fs.pathExists(oldConfig)) { await fs.copy(oldConfig, oldConfig + '.bak'); console.log(chalk.green('✅ 备份旧 config')); }
    await copySDDHarnessLayer(cwd, false, true);
    console.log(chalk.green('\n✅ 升级完成\n'));
  });

function extractMetricsBlock(raw, stage) {
  const stageRegex = new RegExp(`\\n${stage}:([\\s\\S]*?)(?=\\n[a-zA-Z_][a-zA-Z0-9_-]*:|$)`);
  const normalized = `\n${raw}`;
  return normalized.match(stageRegex)?.[1] ?? '';
}

// 指标评估器：读 stage-metrics.yaml，对 change 的 artifact 跑各 metric 的 check
async function evalStageMetrics(stage, changeId, cwd, options = {}) {
  const metricsPath = path.join(TEMPLATES_DIR, 'sdd-harness', 'stage-metrics.yaml');
  if (!await fs.pathExists(metricsPath)) return { error: 'stage-metrics.yaml 未找到' };
  const raw = await fs.readFile(metricsPath, 'utf8');
  let block = extractMetricsBlock(raw, stage);
  if (!block) return { error: `stage ${stage} 无指标定义` };

  if (options.profile) {
    const profilePath = path.join(
      TEMPLATES_DIR,
      'sdd-harness',
      'probe-profiles',
      `${options.profile}.yaml`,
    );
    if (!await fs.pathExists(profilePath)) {
      return { error: `probe profile ${options.profile} 未找到` };
    }
    const profileRaw = await fs.readFile(profilePath, 'utf8');
    const profileBlock = extractMetricsBlock(profileRaw, stage);
    if (profileBlock) block += `\n${profileBlock}`;
  }

  // 解析 change 路径：优先 openspec/changes/<id>/，归档后回落 openspec/changes/archive/*/<id>/
  let changesDir = path.join(cwd, 'openspec', 'changes', changeId);
  if (!await fs.pathExists(changesDir)) {
    const archDir = path.join(cwd, 'openspec', 'changes', 'archive');
    if (await fs.pathExists(archDir)) {
      for (const d of await fs.readdir(archDir)) {
        if (d.endsWith(changeId) || d === changeId) { changesDir = path.join(archDir, d); break; }
      }
    }
  }
  const runsDir = path.join(cwd, '.sdd', 'runs', changeId);
  const results = [];

  // 解析 metrics 下的每个 - name/check/op/threshold
  const metricRegex = /- name:\s*(.+?)\n\s*check:\s*"(.+?)"\n\s*op:\s*(\S+)\n\s*threshold:\s*(\S+)/g;
  let mm;
  while ((mm = metricRegex.exec(block)) !== null) {
    let [, name, check, op, threshold] = mm;
    // 剥 YAML 引号（op: ">=" 被正则连引号捕获）
    op = op.replace(/^["']|["']$/g, '');
    threshold = threshold.replace(/^["']|["']$/g, '');
    const actual = runMetricCheck(check, changeId, changesDir, runsDir, cwd);
    const thr = isNaN(threshold) ? threshold : Number(threshold);
    const pass = compareMetric(actual, op, thr);
    results.push({ name, check, op, threshold: thr, actual, pass });
  }
  return { results, allPass: results.every(r => r.pass) };
}

function runMetricCheck(check, changeId, changesDir, runsDir, cwd) {
  // 替换 artifact 路径引用
  let cmd = check
    .replace(/\bfindings\.md\b/g, `"${changesDir}/findings.md"`)
    .replace(/\bbrief\.md\b/g, `"${changesDir}/brief.md"`)
    .replace(/\bproposal\.md\b/g, `"${changesDir}/proposal.md"`)
    .replace(/\bacceptance-criteria\.md\b/g, `"${changesDir}/acceptance-criteria.md"`)
    .replace(/\bfunctional-test-draft\.yaml\b/g, `"${changesDir}/functional-test-draft.yaml"`)
    .replace(/\bdesign\.md\b/g, `"${changesDir}/design.md"`)
    .replace(/\btasks\.md\b/g, `"${changesDir}/tasks.md"`)
    .replace(/\bprogress\.md\b/g, `"${changesDir}/progress.md"`)
    .replace(/\breview-notes\.md\b/g, `"${runsDir}/review-notes.md"`)
    .replace(/\btest-matrix\.md\b/g, `"${cwd}/llmwiki/wiki/testing/matrices/test-matrix.md"`)
    .replace(/(?<!openspec\/)specs\//g, `"${changesDir}/specs/"`)
    .replace(/<slug>/g, changeId.split('-').slice(0, -1).join('-') || changeId);

  // 特殊命令处理
  if (cmd.startsWith('yaml_has_keys')) {
    // yaml_has_keys <file> [k1,k2,k3]
    const parts = cmd.match(/yaml_has_keys\s+"([^"]+)"\s+\[([^\]]+)\]/);
    if (parts) {
      const [, file, keys] = parts;
      try {
        const content = execSync(`cat ${file}`, { encoding: 'utf8' });
        const allPresent = keys.split(',').every(k => content.includes(k.trim()));
        return allPresent ? 'true' : 'false';
      } catch { return 'false'; }
    }
    return 'false';
  }
  if (cmd.startsWith('count_files')) {
    // count_files <dir> <pattern>  (pattern 可能带引号或不带)
    const parts = cmd.match(/count_files\s+(\S+)\s+'([^']+)'|count_files\s+(\S+)\s+(\S+)/);
    if (parts) {
      const dir = parts[1] || parts[3];
      const pat = parts[2] || parts[4];
      try { return execSync(`find ${dir} -name '${pat}' 2>/dev/null | wc -l`, { encoding: 'utf8' }).trim(); }
      catch { return '0'; }
    }
    return '0';
  }
  if (cmd.startsWith('cmd_exit')) {
    // cmd_exit <command> —— 返回命令 exit code（真实运行验证）
    const real = cmd.replace(/^cmd_exit\s+/, '');
    try { execSync(real, { encoding: 'utf8', cwd, stdio: ['ignore','ignore','ignore'] }); return '0'; }
    catch (e) { return String(e.status ?? 1); }
  }
 if (cmd.startsWith('exists')) {
   const target = cmd.replace('exists ', '').split(' ')[0].replace(/"/g, '');
   return fs.pathExistsSync(target) ? '1' : '0';
 }
  // Multi-stack source file detection (monorepo-aware)
  if (cmd === 'auto:find_source') {
    return String(countSourceFiles(cwd));
  }
  // Multi-stack test file detection
  if (cmd === 'auto:find_tests') {
    try {
      const testPatterns = [
        "-name '*.test.*'", "-name '*.spec.*'",     // JS/TS
        "-name '*_test.*'", "-name '*Test.*'",      // Go/Java
        "-name 'test_*.*'",                          // Python
      ];
      const mono = detectMonorepo(cwd);
      const searchDirs = mono.length >= 2 ? mono.map(m => m.dir) : ['.'];
      let total = 0;
      for (const dir of searchDirs) {
        try {
          const out = execSync(
            `find "${dir}" -type f \\( ${testPatterns.join(' -o ')} \\) ` +
            `-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/target/*' 2>/dev/null | wc -l`,
            { encoding: 'utf8', cwd }
          );
          total += parseInt(out.trim()) || 0;
        } catch {}
      }
      return String(total);
    } catch { return '0'; }
  }
 if (cmd.includes('git diff')) {
    try { return execSync(cmd, { encoding: 'utf8', cwd }).trim() || '0'; } catch { return '0'; }
  }

  // 默认 grep/find 命令：artifact 文件已替换为绝对路径，故在项目根 cwd 跑（src/ 等项目相对路径也能解析）
  try {
    const out = execSync(cmd, { encoding: 'utf8', cwd }).trim();
    return out || '0';
  } catch {
    return '0';
  }
}

function compareMetric(actual, op, threshold) {
  let a = String(actual).trim();
  // files>= : 数输出里的非空行数（grep -rl 返回文件列表）
  if (op === 'files>=' || op === 'files>') {
    const lines = a === '' ? 0 : a.split('\n').filter(l => l.trim()).length;
    const tn = Number(threshold);
    return op === 'files>=' ? lines >= tn : lines > tn;
  }
  const t = String(threshold);
  if (op === '==') return a === t;
  const an = parseFloat(a), tn = parseFloat(t);
  if (isNaN(an) || isNaN(tn)) return a === t;
  if (op === '>=') return an >= tn;
  if (op === '>') return an > tn;
  if (op === '<=') return an <= tn;
  if (op === '<') return an < tn;
  return a === t;
}

program
  .command('check <stage>')
  .description('Evaluate a stage output against stage-metrics.yaml (objective reasonableness check)')
  .option('--change <id>', 'change-id (default: active-run)')
  .option('--profile <name>', 'add project/probe-specific metrics from templates/sdd-harness/probe-profiles')
  .action(async (stage, options) => {
    const cwd = process.cwd();
    const activeRun = path.join(cwd, '.sdd', 'active-run');
    let changeId = options.change;
    if (!changeId && await fs.pathExists(activeRun)) changeId = (await fs.readFile(activeRun, 'utf8')).trim();
    if (!changeId) { console.log(chalk.red('❌ 无 active run。先 sdd run grill')); process.exit(1); }

    // Verify change directory exists
    let changeDir = path.join(cwd, 'openspec', 'changes', changeId);
    if (!await fs.pathExists(changeDir)) {
      const archBase = path.join(cwd, 'openspec', 'changes', 'archive');
      if (await fs.pathExists(archBase)) {
        const match = (await fs.readdir(archBase)).find(d => d.endsWith('-' + changeId));
        if (match) changeDir = path.join(archBase, match);
      }
    }
    if (!await fs.pathExists(changeDir)) {
      console.log(chalk.red(`❌ change 不存在: ${changeId}`));
      console.log(chalk.gray('   先 sdd run grill --slug <name> --goal "..." 创建'));
      process.exit(1);
    }

    const profileLabel = options.profile ? ` + profile:${options.profile}` : '';
    console.log(chalk.blue(`\n🔍 /sdd:${stage} 产出合理性评估（stage-metrics.yaml${profileLabel}）\n`));
    const r = await evalStageMetrics(stage, changeId, cwd, { profile: options.profile });
    if (r.error) { console.log(chalk.red('❌ ' + r.error)); process.exit(1); }

    let passCount = 0;
    for (const m of r.results) {
      const mark = m.pass ? chalk.green('✅') : chalk.red('❌');
      console.log(`  ${mark} ${m.name}: ${m.actual} ${m.op} ${m.threshold} ${m.pass ? '' : chalk.red('(未达标)')}`);
      if (m.pass) passCount++;
    }
    console.log(chalk.blue(`\n${passCount}/${r.results.length} 指标达标`));
    if (r.allPass) {
      console.log(chalk.green.bold(`✅ ${stage} 阶段产出合理，达标。\n`));
    } else {
      console.log(chalk.yellow.bold(`⚠️  ${stage} 阶段产出未完全达标。agent 需补充内容使上述 ❌ 指标通过。\n`));
      process.exit(2);
    }
  });

program
  .command('fill <stage>')
  .description('LLM-fill a stage artifacts to meet stage-metrics (invokes claude -p headless). Framework generates content, not you.')
  .option('--change <id>', 'change-id (default: active-run)')
  .option('--model <m>', 'claude model', 'sonnet')
  .action(async (stage, options) => {
    const cwd = process.cwd();
    if (!STAGE_CONTRACTS[stage]) { console.log(chalk.red(`❌ 未知 stage: ${stage}`)); process.exit(1); }
    const activeRun = path.join(cwd, '.sdd', 'active-run');
    let changeId = options.change;
    if (!changeId && await fs.pathExists(activeRun)) changeId = (await fs.readFile(activeRun, 'utf8')).trim();
    if (!changeId) { console.log(chalk.red('❌ 无 active run。先 sdd run grill --slug X --goal "..."')); process.exit(1); }

    // 读 goal + steering
    const wfPath = path.join(cwd, '.sdd', 'runs', changeId, 'workflow-frame.yaml');
    let goal = '';
    if (await fs.pathExists(wfPath)) {
      const wf = await fs.readFile(wfPath, 'utf8');
      goal = (wf.match(/^goal:\s*"(.*)"/m) || [])[1] || '';
    }
    const steering = path.join(cwd, '.sdd', 'steering', 'project.md');
    const steeringContent = await fs.pathExists(steering) ? await fs.readFile(steering, 'utf8') : '(无 steering，按通用最佳实践)';

    // 读该 stage 的指标（作为达标要求）
    const metricsPath = path.join(TEMPLATES_DIR, 'sdd-harness', 'stage-metrics.yaml');
    let metricsReq = '';
    if (await fs.pathExists(metricsPath)) {
      const raw = await fs.readFile(metricsPath, 'utf8');
      const m = raw.match(new RegExp(stage + ":([\\s\\S]*?)(?=\\n[a-z]+:|$)"));
      if (m) metricsReq = m[1];
    }

    // 归档路径回退（fill）：change 已 archive 时在 changes/archive/<date>-<id>/ 下
    let changesDir = path.join(cwd, 'openspec', 'changes', changeId);
    if (!await fs.pathExists(changesDir)) {
      const archiveBase = path.join(cwd, 'openspec', 'changes', 'archive');
      if (await fs.pathExists(archiveBase)) {
        const match = (await fs.readdir(archiveBase)).find(d => d.endsWith('-' + changeId));
        if (match) changesDir = path.join(archiveBase, match);
      }
    }
    const runsDir = path.join(cwd, '.sdd', 'runs', changeId);

    console.log(chalk.blue(`\n🤖 sdd fill ${stage}（claude -p headless 生成达标内容）\n`));
    console.log(chalk.gray(`   change: ${changeId}`));
    console.log(chalk.gray(`   goal: ${goal}`));
    console.log(chalk.gray(`   model: ${options.model}\n`));

    // verify 阶段：实证——真实跑 build，失败则调 claude 修，循环到通过
    if (stage === 'verify') {
      const { buildCmd, label: buildLabel } = detectTestBuildCommands(cwd);
      console.log(chalk.cyan(`   实证：${buildCmd} 真实构建 + 失败自动修 (${buildLabel})\n`));
      let buildOk = false;
      let lastErr = '';
      for (let attempt = 1; attempt <= 3 && !buildOk; attempt++) {
        console.log(chalk.blue(`▶ build 尝试 ${attempt}`));
        let buildOut = '';
        try {
          buildOut = execSync(`${buildCmd} 2>&1`, { encoding: 'utf8', cwd, timeout: 120000 });
          // exit 0 但有 "failed to resolve" 警告也算失败（vite 对 unresolved import 有时 exit 0）
          if (/failed to resolve|Could not resolve/i.test(buildOut)) throw new Error('resolve warning');
          buildOk = true;
          console.log(chalk.green('  ✅ build 通过\n'));
        } catch (e) {
          if (!buildOut) { try { buildOut = execSync(`${buildCmd} 2>&1`, { encoding: 'utf8', cwd, timeout: 120000 }); } catch (e2) { buildOut = e2.stdout || String(e2.message); } }
          const errTail = String(buildOut).split('\n').slice(-15).join('\n');
          console.log(chalk.yellow(`  ⚠️ build 失败，调 claude 修（带真实错误）...\n`));
          const fixPrompt = `项目 ${cwd} 的 \`${buildCmd}\` 失败。真实错误（最后 15 行）:

\`\`\`
${errTail}
\`\`\`

针对该错误修 src/ 代码 或 vite.config / tsconfig / package.json，使 build 通过。
常见错误对照:
- "node:crypto does not provide getRandomValues" → vite 浏览器构建误用 Node crypto；修法：建 vite.config.ts 加 define: { global: 'globalThis' } 或在代码里用 globalThis.crypto，或装 vite-plugin-node-polyfills
- "Cannot find module / import 路径错" → 改 import 路径（如 /main.ts → /src/main.ts）
- TS 类型错 → 修类型或 tsconfig 改 strict

直接改文件（Bash/Write），改完重跑 ${buildCmd} 确认 exit 0。`;
          try {
            await ptyClaude(fixPrompt, { cwd, model: options.model, timeoutMs: 180000 });
          } catch (e2) { if (String(e2.message).includes('TIMEDOUT')) console.log(chalk.gray('   (fix 超时)')); }
        }
      }
      // 写证据到 progress.md
      const prog = path.join(changesDir, 'progress.md');
      await fs.appendFile(prog, `\n## [verify] 实证构建\n- ${buildCmd}: ${buildOk ? 'PASS (exit 0)' : 'FAIL'}\n- 非功能: Lighthouse/waiver 待 preview\n- failure 分类: ${buildOk ? '无' : 'build error'}\n`);
      console.log(chalk.green(`✓ verify 实证完成（build ${buildOk ? 'PASS' : 'FAIL'}）\n`));
      const r = await evalStageMetrics('verify', changeId, cwd);
      let pc = 0; for (const m of r.results) { const ok = m.pass; console.log(`  ${ok?chalk.green('✅'):chalk.red('❌')} ${m.name}: ${m.actual} ${m.op} ${m.threshold}`); if (ok) pc++; }
      console.log(chalk.blue(`\n${pc}/${r.results.length} 达标`));
      return;
    }

    // code 阶段：通用化——从 steering（tech stack）+ specs（功能）+ design（File Structure Plan）派生，零项目专属硬编码
    if (stage === 'code') {
      // 读 design.md 的 File Structure Plan（决定 src 文件结构）+ specs + tasks
      const designPath = path.join(changesDir, 'design.md');
      const designContent = await fs.readFile(designPath, 'utf8').catch(() => '');
      const fspMatch = designContent.match(/File Structure Plan[\s\S]*?(?=\n##|\n## Boundary|$)/i);
      const fileStructurePlan = fspMatch ? fspMatch[0] : '(无 File Structure Plan，按 specs 推断)';
      const specsDir = path.join(changesDir, 'specs');
      let specsSummary = '';
      if (await fs.pathExists(specsDir)) {
        for (const cap of await fs.readdir(specsDir)) {
          const sp = path.join(specsDir, cap, 'spec.md');
          if (await fs.pathExists(sp)) specsSummary += `\n## ${cap}\n${(await fs.readFile(sp,'utf8')).slice(0,600)}\n`;
        }
      }
      const probeGenerationContractPath = path.join(
        TEMPLATES_DIR,
        'sdd-harness',
        'generation-contracts',
        'browser-probe.md',
      );
      const probeGenerationContract = await fs.readFile(
        probeGenerationContractPath,
        'utf8',
      ).catch(() => '');
      const lockedProbeProfileName = (
        await fs.readFile(path.join(runsDir, 'probe-profile'), 'utf8').catch(() => '')
      ).trim();
      const lockedProbeProfile = lockedProbeProfileName
        ? await fs.readFile(
          path.join(
            TEMPLATES_DIR,
            'sdd-harness',
            'probe-profiles',
            `${lockedProbeProfileName}.yaml`,
          ),
          'utf8',
        ).catch(() => '')
        : '';

      // Detect real source dirs for this project (monorepo-aware)
      const detectedSourceDirs = getSourceDirs(cwd);
      const projectType = detectProjectType(cwd);
      const monoRepos = detectMonorepo(cwd);
      const sourceDirsLabel = monoRepos.length >= 2
        ? monoRepos.map(m => `${m.dir}/ (${m.type})`).join(', ')
        : (projectType ? `${projectType.type}: ${detectedSourceDirs.join(', ')}` : detectedSourceDirs.join(', '));

      console.log(chalk.cyan(`   通用化实现（source: ${sourceDirsLabel}）\n`));

      // Only include browser probe contract for JS/web projects
      const isWebProject = !projectType || projectType.type === 'node';
      const probeContext = isWebProject
        ? `## Browser Probeability Generation Contract\n${probeGenerationContract || '(非 browser 项目可忽略)'}\n## Active Probe Profile\n${lockedProbeProfile || '(当前 run 未锁定 probe profile)'}`
        : '(非 browser 项目，跳过 probe contract)';

      // 调用 1: src 源码（按 specs + steering + File Structure Plan + REAL source dirs）
      const srcPrompt = `你是 SDD code agent。基于项目上下文实现源码。

## steering（tech stack — 决定技术）
${steeringContent}

## specs（决定功能）
${specsSummary || '(无)'}

## File Structure Plan（决定文件结构）
${fileStructurePlan}

## 项目源码位置（必须在此结构下创建文件）
${sourceDirsLabel}

${probeContext}

## 要求
1. 按 File Structure Plan 的结构 + steering 的技术栈 + specs 的功能实现源码
2. 文件放在上面的真实源码目录中（不要放在根目录 src/）
3. 真实可运行，不占位
4. 遵循 steering 中的编码规范（如 WebFlux reactive、pnpm 等）
${isWebProject ? '5. browser 项目按上述契约暴露只读 globalThis.__sddProbe.snapshot()，禁止 debug DOM' : ''}
用 Write 工具，立刻完成。`;
      try {
        await ptyClaude(srcPrompt, { cwd, model: options.model, timeoutMs: 600000 });
      } catch (e) { if (String(e.message).includes('TIMEDOUT')) console.log(chalk.gray('   (src 超时)')); }

      // 调用 2: 配置文件（package.json + 入口，按 steering 构建工具）
      // manifest 配置：按 steering 语言决定（autoresearch 优化：区分 JS/Python，修复 JS 中心主义）
      const cfgPrompt = `写 manifest 配置文件，按 steering 的技术栈决定：
- JS/TS 项目：写 ${cwd}/package.json（scripts 必须含 build 和 test）
- Python 项目：写 ${cwd}/pyproject.toml
- Java/Maven 项目：pom.xml 已存在则不重写，仅确认 build/test 命令可用（mvn package / mvn test）
- Monorepo（多子项目）：每个子项目已有自己的 manifest，跳过——不要在根目录创建新的
立刻完成。用 Write。`;
      try {
        await ptyClaude(cfgPrompt, { cwd, model: options.model, timeoutMs: 120000 });
      } catch (e) { if (String(e.message).includes('TIMEDOUT')) console.log(chalk.gray('   (config 超时)')); }

      // 调用 3: 测试代码（按 specs + generation contract 验证真实实现）
      const testContextSection = isWebProject
        ? `## Browser Probeability Regression Tests\n${probeGenerationContract || '(非 browser 项目可忽略)'}\n## Active Probe Profile\n${lockedProbeProfile || '(当前 run 未锁定 probe profile)'}`
        : '';

      const browserSpecificRules = isWebProject
        ? `- browser/canvas 项目必须调用真实 resize controller，证明尺寸源是 viewport 或稳定外部容器
- 测试必须能阻止 canvas client size → renderer setSize 的 resize feedback；只测 aspect helper 不算
- 覆盖 debug DOM 禁止项与 globalThis.__sddProbe.snapshot() 的只读可用性
- 若 profile 声明 requiredInteractions / transitionContracts，为其生成状态转移测试`
        : '- 测试框架按 steering（Java → JUnit5/Mockito, JS/TS → Vitest/Jest, Python → pytest）';

      const testPrompt = `你是 SDD test-generation agent。为当前实现生成可运行的自动化测试，**测试真实生产路径，不复制实现逻辑**。

## steering（决定测试框架）
${steeringContent}

## specs（决定功能行为）
${specsSummary || '(无)'}

${testContextSection}

在项目惯例的测试目录或源码旁生成测试文件：
- 覆盖 specs 的核心行为与错误路径
${browserSpecificRules}
只写测试文件，不修改生产实现。用 Write 工具，立刻完成。`;
      const beforeTestInventory = await captureTestInventory(cwd);
      const testGenerationResult = await ptyClaude(
        testPrompt,
        { cwd, model: options.model, timeoutMs: 300000 },
      );
      const generationGate = await evaluateGeneratedTests({
        projectDir: cwd,
        generationResult: testGenerationResult,
        beforeTestInventory,
      });
      if (!generationGate.pass) {
        console.log(chalk.red(`   ⛔ test generation gate failed: ${generationGate.reason}`));
        process.exitCode = 2;
        return;
      }
      const projectTestGate = runProjectTestGate({ projectDir: cwd, evidenceDir: runsDir });
      if (!projectTestGate.pass) {
        console.log(chalk.red(`   ⛔ project test gate failed: ${projectTestGate.reason}`));
        process.exitCode = 2;
        return;
      }

      const prog = path.join(changesDir, 'progress.md');
      await fs.appendFile(prog, `\n## [code] 实现\n- 源码目录: ${sourceDirsLabel}\n- 按 steering tech stack + specs 功能 + File Structure Plan 结构\n${isWebProject ? '- browser probeability contract 已注入\n' : ''}- 测试: 已生成/修改 ${generationGate.changedTestFiles.length} 个文件；${projectTestGate.command} PASS (exit 0)\n- test evidence: ${projectTestGate.evidence.reportPath}; output SHA-256 ${projectTestGate.evidence.outputSha256}\n`);
      console.log(chalk.green(`\n✓ 通用化实现 + progress.md\n`));
      const r = await evalStageMetrics('code', changeId, cwd);
      let pc = 0; for (const m of r.results) { const ok = m.pass; console.log(`  ${ok?chalk.green('✅'):chalk.red('❌')} ${m.name}: ${m.actual} ${m.op} ${m.threshold}`); if (ok) pc++; }
      console.log(chalk.blue(`\n${pc}/${r.results.length} 达标`));
      return;
    }

    // 构建完整目标文件列表（changesDir + wiki + runtime）
    const contract = STAGE_CONTRACTS[stage];
    const targets = [];
    for (const a of contract.artifacts) targets.push(`${changesDir}/${a}`);
    if (stage === 'grill') targets.push(`${changesDir}/brief.md（含 'route: new|extend|direct_impl|decompose'）`);
    if (contract.wiki) targets.push(`${cwd}/llmwiki/${contract.wiki}`);
   if (contract.runtime) targets.push(`${runsDir}/${contract.runtime}`);
    // test 阶段：通用化——扫描真实 src（不硬编码文件名）+ steering 测试框架 + specs 派生测试
    // 架构 §5.4：归一化测试用例写入 LLMWiki（markdown + frontmatter）
    if (stage === 'test') {
      // 扫描真实 src 结构 + 读取核心源码内容（让 claude 基于实现而非推测写测试）
      let srcStructure = '(未发现 src/)';
      let srcSource = '';
      try {
        const srcFiles = execSync(`find src -type f \\( -name '*.ts' -o -name '*.js' -o -name '*.py' \\) ! -name '*.test.*' 2>/dev/null | sort`, { encoding: 'utf8', cwd }).trim().split('\n').filter(Boolean);
        srcStructure = srcFiles.join('\n') || '(src/ 为空)';
        for (const sf of srcFiles.slice(0, 12)) {
          try { srcSource += `\n// ${sf}\n${(await fs.readFile(path.join(cwd, sf), 'utf8')).slice(0, 400)}\n`; } catch {}
        }
      } catch { srcStructure = '(扫描失败)'; }
      const specsDir2 = path.join(changesDir, 'specs');
      let specsForTest = '';
      if (await fs.pathExists(specsDir2)) {
        for (const cap of await fs.readdir(specsDir2)) {
          const sp = path.join(specsDir2, cap, 'spec.md');
          if (await fs.pathExists(sp)) specsForTest += `\n## ${cap}\n${(await fs.readFile(sp,'utf8')).slice(0,500)}\n`;
        }
      }
      console.log(chalk.cyan(`   通用化测试生成（扫描真实 src + steering 测试框架，零硬编码）\n`));
      const testPrompt = `你是 SDD test agent。基于已有源码和规格生成测试，**不预设文件名/框架**。

## steering（测试框架 — 决定用什么测）
${steeringContent}

## specs（决定测什么功能）
${specsForTest || '(无 specs)'}

## 已有源码结构（决定测试放哪）
${srcStructure}

## 核心源码实现（决定测试细节——基于真实行为而非推测）
${srcSource || '(未能读取)'}

生成：
1. test matrix: ${cwd}/llmwiki/wiki/testing/matrices/test-matrix.md（feature × test type 表格）
2. 单测文件：为 src/ 下核心模块生成对应测试文件，**基于上方源码结构决定文件名，不要预设 world.test.ts/camera.test.ts**
3. 归一化用例（§5.4）：每个写 ${cwd}/llmwiki/wiki/testing/cases/TC-<slug>.md，frontmatter: type: test-case, id: TC-<slug>, spec, status, suite
4. 测试配置：按 steering（JS→vitest.config.ts，Python→conftest.py）
5. manifest：package.json scripts 含 test 或 pyproject.toml 含 pytest 配置
真实测试，覆盖 specs 核心功能，断言基于上方源码的真实行为。用 Write 立刻完成。`;
      try { await ptyClaude(testPrompt, { cwd, model: options.model, timeoutMs: 600000 }); } catch (e) { if (String(e.message).includes('TIMEDOUT')) console.log(chalk.gray('   (test 超时)')); }

      // test-fix 闭环：跑测试，失败调 claude 修（对齐 verify 的 build-fix 模式）
      console.log(chalk.cyan(`   test-fix 闭环：验证测试通过\n`));
      let testOk = false; let testErr = '';
      for (let attempt = 1; attempt <= 3 && !testOk; attempt++) {
        try {
          const { testCmd } = detectTestBuildCommands(cwd);
          testErr = execSync(`${testCmd} 2>&1`, { encoding: 'utf8', cwd, timeout: 120000 });
          if (/failed.*\(0\)|Tests.*passed/.test(testErr) && !/✗|×|FAIL\b/.test(testErr)) testOk = true;
          if (testOk) { console.log(chalk.green(`  ✅ ${testCmd} 通过\n`)); break; }
        } catch (e) { testErr = (e.stdout || String(e.message)); }
        const errTail = String(testErr).split('\n').slice(-20).join('\n');
        console.log(chalk.yellow(`  ⚠️ 测试失败，调 claude 修（attempt ${attempt}）...\n`));
        const fixPrompt = `项目 ${cwd} 的 \`${testCmd}\` 失败。真实错误（最后 20 行）:

\`\`\`
${errTail}
\`\`\`

针对失败修测试文件（修测试断言以匹配真实源码行为，或修 src/ 里的 bug）。直接改文件，改完重跑 ${testCmd} 确认。`;
        try { await ptyClaude(fixPrompt, { cwd, model: options.model, timeoutMs: 300000 }); } catch (e2) { if (String(e2.message).includes('TIMEDOUT')) console.log(chalk.gray('   (fix 超时)')); }
      }
      const prog = path.join(changesDir, 'progress.md');
      await fs.appendFile(prog, `\n## [test] 通用化测试\n- 扫描真实 src 结构（不硬编码）\n- test-matrix + 单测 + LLMWiki TC-* 归一化用例\n- 框架按 steering\n`);
      console.log(chalk.green(`\n✓ 通用化测试 + progress.md\n`));
      const r = await evalStageMetrics('test', changeId, cwd);
      let pc = 0; for (const m of r.results) { const ok = m.pass; console.log(`  ${ok?chalk.green('✅'):chalk.red('❌')} ${m.name}: ${m.actual} ${m.op} ${m.threshold}`); if (ok) pc++; }
      console.log(chalk.blue(`\n${pc}/${r.results.length} 达标`));
      return;
    }
    if (stage === 'code') {
      targets.push(`src/ 下的真实源码实现（基于 specs/ 和 tasks.md，写可运行的 TypeScript + Three.js 代码：world/render/input/player 四层模块 + index.html + package.json）`);
      targets.push(`${changesDir}/progress.md（追加 code 阶段条目，记录实现的文件 + 测试结果）`);
    }
    if (stage === 'verify' || stage === 'release') targets.push(`${changesDir}/progress.md（追加该阶段条目）`);

    const prompt = `你是 SDD Harness "${stage}" 阶段执行 agent。严格按以下要求填写 artifact，产出必须客观达标。

## 项目目标
${goal}

## 项目 steering（tech stack / 规范）
${steeringContent}

## ${stage} 阶段达标要求（stage-metrics.yaml，必须每条满足）
${metricsReq}

## 你的任务
基于目标和 steering，填写以下文件，使其满足上述全部指标:
${targets.map(t => `- ${t}`).join('\n')}

要求:
1. 内容真实合理，基于目标和 steering，不要泛泛或占位
2. 必须满足达标要求里的每一条指标（数量、结构）—— 这是最重要约束
3. 中文叙述 + 英文技术术语
4. 直接用 Write 工具写文件，不要只输出到对话

开始。`;

    // 调 claude -p headless（--bare 跳过 hooks/skills/memory 重启动开销，prompt 走 stdin；8min 超时）
    try {
      await ptyClaude(prompt, { cwd, model: options.model, timeoutMs: 480000 });
    } catch (e) {
      if (!String(e.message).includes('TIMEDOUT') && !String(e.message).includes('timeout')) {
        console.log(chalk.red('⚠️ claude headless 调用失败: ' + String(e.message).split('\n')[0]));
      } else {
        console.log(chalk.gray('   (claude 超时，但文件可能已写，继续验证)'));
      }
    }

    // 填完后自动 check
    console.log(chalk.blue('\n🔍 自动验证（sdd check）\n'));
    const r = await evalStageMetrics(stage, changeId, cwd);
    if (r.error) { console.log(chalk.red(r.error)); process.exit(1); }
    let passCount = 0;
    for (const m of r.results) {
      const mark = m.pass ? chalk.green('✅') : chalk.red('❌');
      console.log(`  ${mark} ${m.name}: ${m.actual} ${m.op} ${m.threshold}`);
      if (m.pass) passCount++;
    }
    console.log(chalk.blue(`\n${passCount}/${r.results.length} 达标`));
    if (r.allPass) console.log(chalk.green.bold(`✅ ${stage} 填充完成且达标\n`));
    else { console.log(chalk.yellow(`⚠️ 仍有指标未达标，可重跑 sdd fill ${stage}\n`)); process.exit(2); }
  });

program
  .command('workflow-audit')
  .description('Re-evaluate an existing workflow run against its current stage prerequisites')
  .requiredOption('--project <dir>', 'Project directory containing .sdd/runs')
  .requiredOption('--run <id>', 'Runtime run id to audit')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    try {
      const report = await auditWorkflowRun({
        projectDir: path.resolve(options.project),
        run: options.run,
      });
      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n🧭 SDD Workflow State Audit\n'));
        for (const item of report.issues) {
          console.log(chalk.red(`❌ ${item.gate}: ${item.reason}`));
        }
        if (report.pass) console.log(chalk.green('✅ workflow stage prerequisites are valid'));
      }
      process.exitCode = report.pass ? 0 : 2;
    } catch (error) {
      const report = {
        schemaVersion: 1,
        pass: false,
        issues: [{
          code: 'INVALID_WORKFLOW_AUDIT',
          message: error.message,
        }],
      };
      if (options.json) console.log(JSON.stringify(report));
      else console.error(chalk.red(`❌ Invalid workflow audit: ${error.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('deliverable-audit')
  .description('Audit stage deliverables — verify that each completed stage produced its expected outputs')
  .requiredOption('--project <dir>', 'Project directory')
  .requiredOption('--run <id>', 'Runtime run id')
  .option('--stage <name>', 'Only check a specific stage (default: all completed stages)')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    try {
      const report = await auditDeliverables({
        projectDir: path.resolve(options.project),
        run: options.run,
        stage: options.stage,
      });
      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n📦 SDD Deliverable Audit\n'));
        console.log(chalk.gray(`   Stages checked: ${report.checkedStages.join(' → ')}\n`));
        for (const r of report.results) {
          const icon = r.pass ? '✅' : (r.severity === 'required' ? '❌' : '⚠️');
          const sev = r.severity === 'required' ? chalk.red : chalk.yellow;
          console.log(`  ${icon} [${r.stage}/${r.id}] ${r.describe}`);
          if (!r.pass && r.detail) console.log(sev(`     → ${r.detail}`));
        }
        const reqFail = report.requiredFailures.length;
        const expFail = report.expectedFailures.length;
        console.log(chalk.gray(`\n   ${report.totalRules} rules: ${report.totalRules - reqFail - expFail} pass, ${reqFail} required fail, ${expFail} expected fail`));
        if (report.pass) console.log(chalk.green.bold('\n✅ All required deliverables present\n'));
        else { console.log(chalk.red.bold(`\n❌ ${reqFail} required deliverable(s) missing\n`)); }
      }
      process.exitCode = report.pass ? 0 : 2;
    } catch (error) {
      const report = { schemaVersion: 1, pass: false, error: error.message };
      if (options.json) console.log(JSON.stringify(report));
      else console.error(chalk.red(`❌ Deliverable audit failed: ${error.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('fill-deliverables')
  .description('Auto-fix expected deliverable gaps (ADR archive, AC split, learnings propagation, concepts extraction, etc.)')
  .requiredOption('--project <dir>', 'Project directory')
  .requiredOption('--run <id>', 'Runtime run id')
  .option('--stage <name>', 'Only fix a specific stage')
  .option('--json', 'Print machine-readable report', false)
  .action(async (options) => {
    try {
      const report = await fixDeliverables({
        projectDir: path.resolve(options.project),
        run: options.run,
        stage: options.stage,
      });
      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n🔧 SDD Deliverable Auto-Fix\n'));
        console.log(chalk.gray(`   Gaps found: ${report.totalGaps}\n`));
        for (const f of report.fixed) {
          console.log(chalk.green(`  ✅ [${f.stage}/${f.id}] ${f.action}`));
        }
        for (const m of report.manual) {
          const icon = m.needsLLM ? '🤖' : '⚠️ ';
          console.log(chalk.cyan(`  ${icon} [${m.stage}/${m.id}] ${m.reason}`));
          if (m.instruction) console.log(chalk.gray(`     → ${m.instruction}`));
        }
        const llmCount = report.manual.filter(m => m.needsLLM).length;
        const manualCount = report.manualCount - llmCount;
        console.log(chalk.gray(`\n   ${report.fixedCount} auto-fixed, ${llmCount} need LLM (sdd-archive skill), ${manualCount} need manual`));
        if (report.fixedCount > 0) {
          console.log(chalk.green.bold('\n✅ Re-run deliverable-audit to verify fixes\n'));
        }
      }
      process.exitCode = 0;
    } catch (error) {
      if (options.json) console.log(JSON.stringify({ error: error.message }));
      else console.error(chalk.red(`❌ Fix failed: ${error.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('probe')
  .description('Evaluate deterministic browser/runtime probe evidence')
  .requiredOption('--project <dir>', 'Project directory that produced the evidence')
  .requiredOption('--evidence <file>', 'Runtime evidence JSON captured by Browser/Playwright MCP')
  .option('--profile <name>', 'apply project/probe-specific contract from templates/sdd-harness/probe-profiles')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    try {
      const projectDir = path.resolve(options.project);
      const evidencePath = path.resolve(options.evidence);
      let requiredInteractions = [];
      let transitionContracts = {};
      let observationAdapter;
      if (options.profile) {
        const profilePath = path.join(
          TEMPLATES_DIR,
          'sdd-harness',
          'probe-profiles',
          `${options.profile}.yaml`,
        );
        if (!await fs.pathExists(profilePath)) {
          throw new Error(`probe profile not found: ${options.profile}`);
        }
        const profileRaw = await fs.readFile(profilePath, 'utf8');
        const requiredMatch = profileRaw.match(/^requiredInteractions:\s*\[([^\]]*)\]/m);
        requiredInteractions = requiredMatch
          ? requiredMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
          : [];
        const transitionContractsMatch = profileRaw.match(/^transitionContracts:\s*(\{.*\})\s*$/m);
        transitionContracts = transitionContractsMatch
          ? JSON.parse(transitionContractsMatch[1])
          : {};
        const observationAdapterMatch = profileRaw.match(/^observationAdapter:\s*["']?([^"'#\n]+)["']?\s*$/m);
        observationAdapter = observationAdapterMatch?.[1]?.trim();
      }
      const report = await validateProbe({
        projectDir,
        evidencePath,
        requiredInteractions,
        transitionContracts,
        observationAdapter,
      });
      if (options.profile) report.profile = options.profile;

      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n🔬 SDD Harness Probe Gate\n'));
        for (const item of report.issues) {
          console.log(chalk.red(`❌ ${item.code}: ${item.message}`));
        }
        if (report.pass) console.log(chalk.green('✅ probe evidence passed'));
      }
      process.exitCode = report.pass ? 0 : 2;
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({
          schemaVersion: 1,
          pass: false,
          issues: [{
            code: 'INVALID_PROBE_EVIDENCE',
            message: error.message,
          }],
        }));
      } else {
        console.error(chalk.red(`❌ Invalid probe evidence: ${error.message}`));
      }
      process.exitCode = 1;
    }
  });

program
  .command('evidence-audit')
  .description('Audit SDD evidence against disk facts and captured command output')
  .requiredOption('--project <dir>', 'Project directory that produced the evidence')
  .requiredOption('--change <id>', 'OpenSpec/SDD change id')
  .option('--run <id>', 'Runtime run id when it differs from the OpenSpec change path')
  .option('--test-output <file>', 'Captured npm/vitest test output to compare against markdown claims')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    try {
      const report = await auditEvidence({
        projectDir: path.resolve(options.project),
        change: options.change,
        run: options.run,
        testOutputPath: options.testOutput ? path.resolve(options.testOutput) : undefined,
      });

      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n🧾 SDD Evidence Audit Gate\n'));
        for (const item of report.issues) {
          console.log(chalk.red(`❌ ${item.code}: ${item.message}`));
        }
        if (report.pass) console.log(chalk.green('✅ evidence matches disk and command output'));
      }
      process.exitCode = report.pass ? 0 : 2;
    } catch (error) {
      const report = {
        schemaVersion: 1,
        pass: false,
        issues: [{
          code: 'INVALID_EVIDENCE_AUDIT',
          message: error.message,
        }],
      };
      if (options.json) console.log(JSON.stringify(report));
      else console.error(chalk.red(`❌ Invalid evidence audit: ${error.message}`));
      process.exitCode = 1;
    }
  });

program.parse();
