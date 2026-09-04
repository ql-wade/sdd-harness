#!/usr/bin/env node
// sdd — 团队 AI coding scaffold 的验证工具薄 CLI
//
// 定位（ADR-0001）：stage 编排已移除；本 CLI 只暴露
//   1. init/bootstrap（委托 tools/bootstrap.sh）
//   2. gate/audit 验证工具（lib/ 机械证据层：probe / deliverable-audit / evidence-audit /
//      workflow-audit / test-gate / generation-gate）
//   3. LLMWiki 集成（wiki init / ingest）
//
// 退出码契约：0 通过；1 输入无效；2 验证不通过。

import { program } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

import { validateProbe } from '../lib/probe-validator.js';
import { auditEvidence } from '../lib/evidence-audit.js';
import { captureTestInventory, evaluateGeneratedTests } from '../lib/generation-gate.js';
import { runProjectTestGate } from '../lib/project-test-gate.js';
import { auditWorkflowRun } from '../lib/workflow-audit.js';
import { auditDeliverables } from '../lib/deliverable-audit.js';
import { discoverKnowledgeSources, copySourcesToRaw } from '../lib/knowledge-seed.js';
import { getWikiHome } from '../lib/sdd-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts');
const TOOLS_DIR = path.join(__dirname, '..', 'tools');
const VERSION = '0.2.3';

const ID_UNSAFE_RE = /(?:^|\/)\.\.(?:\/|$)|[;|&`$(){}<>*?!\n\r]/;
function validateId(id, label = 'id') {
  if (id == null) return id;
  if (typeof id !== 'string' || ID_UNSAFE_RE.test(id)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(id)}`);
  }
  return id;
}

// ptyClaude — 流式执行 claude 子进程（wiki ingest 用）。
// 必须 PTY：claude -p 在非 TTY 下写完不退出（孤儿进程）。macOS 用 script -q /dev/null。
// ⚠️ 提权面（如实声明）：--dangerously-skip-permissions 让子 agent 无权限提示地写文件。
//    ingest prompt 内嵌 raw/ 文件内容 → 存在 prompt-injection → 无约束写入的风险面。
//    缓解：ingest 仅由用户显式调用 `sdd wiki ingest` 触发；raw/ 源视为已审阅输入。
//    不要把此模式用于未审阅的第三方内容。
// 契约：永远 resolve；失败经返回对象（exitCode/timedOut/killed）传递。
async function ptyClaude(prompt, { cwd, model = 'sonnet', timeoutMs = 600000 } = {}) {
  const tmp = path.join(os.tmpdir(), `sdd-prompt-${process.pid}-${Date.now()}.txt`);
  await fs.writeFile(tmp, prompt);
  const inner = `claude -p --bare --dangerously-skip-permissions --model ${model} < "${tmp}"`;
  const usePTY = os.platform() === 'darwin';
  const wrapped = usePTY ? `script -q /dev/null bash -c '${inner.replace(/'/g, "'\\''")}'` : inner;
  return new Promise((resolve) => {
    const sh = spawn('bash', ['-c', wrapped], { cwd: cwd || process.cwd(), detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
    let done = false;
    const finish = (result) => { if (done) return; done = true; fs.remove(tmp).catch(() => {}); resolve(result); };
    const timer = timeoutMs ? setTimeout(() => {
      try { process.kill(-sh.pid, 'SIGKILL'); } catch { try { sh.kill('SIGKILL'); } catch {} }
      finish({ exitCode: null, killed: true, timedOut: true });
    }, timeoutMs) : null;
    sh.on('exit', (code) => { if (timer) clearTimeout(timer); finish({ exitCode: code, killed: false, timedOut: false }); });
    sh.on('error', () => { if (timer) clearTimeout(timer); finish({ exitCode: 1, killed: false, timedOut: false }); });
  });
}

program.name('sdd').description('团队 AI coding scaffold — 验证工具薄 CLI').version(VERSION);

// ---- init：委托 bootstrap ----
program
  .command('init')
  .description('初始化 scaffold（hooks + skills + MCP；等价 bash tools/bootstrap.sh）')
  .option('--with-llmwiki', '同时安装 LLMWiki MCP（clone + venv）', false)
  .action(async (options) => {
    const args = [];
    if (options.withLlmwiki) args.push('--with-llmwiki');
    const result = spawnSync('bash', [path.join(TOOLS_DIR, 'bootstrap.sh'), ...args], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  });

// ---- doctor：最小环境检查 ----
program
  .command('doctor')
  .description('环境与骨架自检')
  .action(async () => {
    const checks = [];
    const ok = (name, pass, detail = '') => checks.push({ name, pass, detail });
    const { execSync } = await import('node:child_process');
    try { ok('node', true, execSync('node --version', { encoding: 'utf8' }).trim()); }
    catch { ok('node', false); }
    try { ok('git', true, execSync('git --version', { encoding: 'utf8' }).trim()); }
    catch { ok('git', false); }
    ok('AGENTS.md', await fs.pathExists('AGENTS.md'));
    ok('hooks.yaml', await fs.pathExists('hooks.yaml'));
    ok('.agents/skills', await fs.pathExists('.agents/skills/grill-me/SKILL.md'));
    ok('mcp-capabilities.yaml', await fs.pathExists('mcp-capabilities.yaml'));
    try {
      if (await fs.pathExists('.mcp.json')) JSON.parse(await fs.readFile('.mcp.json', 'utf8'));
      ok('.mcp.json', true, 'valid JSON');
    } catch (e) { ok('.mcp.json', false, e.message); }
    try { ok('python3', true, execSync('python3 --version', { encoding: 'utf8' }).trim()); }
    catch { ok('python3', false, 'hooks JSON 解析需要'); }

    console.log(chalk.blue('\n🩺 sdd doctor\n'));
    let fail = 0;
    for (const c of checks) {
      if (!c.pass) fail++;
      console.log(`  ${c.pass ? chalk.green('✅') : chalk.red('❌')} ${c.name}${c.detail ? chalk.gray(`  ${c.detail}`) : ''}`);
    }
    console.log('');
    process.exitCode = fail ? 1 : 0;
  });

// ---- probe ----
program
  .command('probe')
  .description('Evaluate deterministic browser/runtime probe evidence')
  .requiredOption('--project <dir>', 'Project directory that produced the evidence')
  .requiredOption('--evidence <file>', 'Runtime evidence JSON captured by Browser/Playwright MCP')
  .option('--profile <name>', 'apply project/probe-specific contract from contracts/probe-profiles')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    try {
      const projectDir = path.resolve(options.project);
      const evidencePath = path.resolve(options.evidence);
      let requiredInteractions = [];
      let transitionContracts = {};
      let observationAdapter;
      if (options.profile) {
        const profilePath = path.join(CONTRACTS_DIR, 'probe-profiles', `${options.profile}.yaml`);
        if (!await fs.pathExists(profilePath)) throw new Error(`probe profile not found: ${options.profile}`);
        const profileRaw = await fs.readFile(profilePath, 'utf8');
        const requiredMatch = profileRaw.match(/^requiredInteractions:\s*\[([^\]]*)\]/m);
        requiredInteractions = requiredMatch ? requiredMatch[1].split(',').map((i) => i.trim()).filter(Boolean) : [];
        const transitionContractsMatch = profileRaw.match(/^transitionContracts:\s*(\{.*\})\s*$/m);
        transitionContracts = transitionContractsMatch ? JSON.parse(transitionContractsMatch[1]) : {};
        const observationAdapterMatch = profileRaw.match(/^observationAdapter:\s*["']?([^"'#\n]+)["']?\s*$/m);
        observationAdapter = observationAdapterMatch?.[1]?.trim();
      }
      const report = await validateProbe({ projectDir, evidencePath, requiredInteractions, transitionContracts, observationAdapter });
      if (options.profile) report.profile = options.profile;
      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n🔬 Probe Gate\n'));
        for (const item of report.issues) console.log(chalk.red(`❌ ${item.code}: ${item.message}`));
        if (report.pass) console.log(chalk.green('✅ probe evidence passed'));
      }
      process.exitCode = report.pass ? 0 : 2;
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ schemaVersion: 1, pass: false, issues: [{ code: 'INVALID_PROBE_EVIDENCE', message: error.message }] }));
      } else {
        console.error(chalk.red(`❌ Invalid probe evidence: ${error.message}`));
      }
      process.exitCode = 1;
    }
  });

// ---- deliverable-audit ----
program
  .command('deliverable-audit')
  .description('Audit run deliverables — each completed stage produced its expected outputs')
  .requiredOption('--project <dir>', 'Project directory')
  .requiredOption('--run <id>', 'Runtime run id')
  .option('--stage <name>', 'Only check a specific stage (default: all completed stages)')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    try {
      validateId(options.run, 'run');
      const report = await auditDeliverables({ projectDir: path.resolve(options.project), run: options.run, stage: options.stage });
      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n📦 Deliverable Audit\n'));
        for (const r of report.results) {
          const icon = r.pass ? '✅' : (r.severity === 'required' ? '❌' : '⚠️');
          console.log(`  ${icon} [${r.stage}/${r.id}] ${r.describe}`);
          if (!r.pass && r.detail) console.log(chalk.yellow(`     → ${r.detail}`));
        }
      }
      process.exitCode = report.pass ? 0 : 2;
    } catch (error) {
      const report = { schemaVersion: 1, pass: false, error: error.message };
      if (options.json) console.log(JSON.stringify(report));
      else console.error(chalk.red(`❌ Deliverable audit failed: ${error.message}`));
      process.exitCode = 1;
    }
  });

// ---- workflow-audit ----
program
  .command('workflow-audit')
  .description('Re-evaluate an existing run against its current stage prerequisites')
  .requiredOption('--project <dir>', 'Project directory containing runs')
  .requiredOption('--run <id>', 'Runtime run id to audit')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    try {
      validateId(options.run, 'run');
      const report = await auditWorkflowRun({ projectDir: path.resolve(options.project), run: options.run });
      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n🧭 Workflow State Audit\n'));
        for (const item of report.issues) console.log(chalk.red(`❌ ${item.gate}: ${item.reason}`));
        if (report.pass) console.log(chalk.green('✅ workflow stage prerequisites are valid'));
      }
      process.exitCode = report.pass ? 0 : 2;
    } catch (error) {
      const report = { schemaVersion: 1, pass: false, issues: [{ code: 'INVALID_WORKFLOW_AUDIT', message: error.message }] };
      if (options.json) console.log(JSON.stringify(report));
      else console.error(chalk.red(`❌ Invalid workflow audit: ${error.message}`));
      process.exitCode = 1;
    }
  });

// ---- evidence-audit ----
program
  .command('evidence-audit')
  .description('Audit evidence claims against disk facts and captured command output')
  .requiredOption('--project <dir>', 'Project directory that produced the evidence')
  .requiredOption('--change <id>', 'OpenSpec change id')
  .option('--run <id>', 'Runtime run id when it differs from the OpenSpec change path')
  .option('--test-output <file>', 'Captured test output to compare against markdown claims')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    try {
      validateId(options.run, 'run');
      if (options.change) validateId(options.change, 'change');
      const report = await auditEvidence({
        projectDir: path.resolve(options.project),
        change: options.change,
        run: options.run,
        testOutputPath: options.testOutput ? path.resolve(options.testOutput) : undefined,
      });
      if (options.json) {
        console.log(JSON.stringify(report));
      } else {
        console.log(chalk.blue('\n🧾 Evidence Audit Gate\n'));
        for (const item of report.issues) console.log(chalk.red(`❌ ${item.code}: ${item.message}`));
        if (report.pass) console.log(chalk.green('✅ evidence matches disk and command output'));
      }
      process.exitCode = report.pass ? 0 : 2;
    } catch (error) {
      const report = { schemaVersion: 1, pass: false, issues: [{ code: 'INVALID_EVIDENCE_AUDIT', message: error.message }] };
      if (options.json) console.log(JSON.stringify(report));
      else console.error(chalk.red(`❌ Invalid evidence audit: ${error.message}`));
      process.exitCode = 1;
    }
  });

// ---- test-gate ----
program
  .command('test-gate')
  .description('Run the project test suite and persist sha256-bound evidence')
  .requiredOption('--project <dir>', 'Project directory to test')
  .option('--evidence-dir <dir>', 'Directory to persist test output + report')
  .option('--timeout <ms>', 'Test command timeout (ms)', '120000')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    const report = runProjectTestGate({
      projectDir: path.resolve(options.project),
      evidenceDir: options.evidenceDir ? path.resolve(options.evidenceDir) : undefined,
      timeoutMs: Number(options.timeout),
    });
    if (options.json) {
      console.log(JSON.stringify({ schemaVersion: 1, pass: report.pass, command: report.command, exitCode: report.exitCode, reason: report.reason, evidence: report.evidence }));
    } else {
      console.log(chalk.blue('\n🧪 Test Gate\n'));
      console.log(`  command: ${report.command ?? '(not detected)'}`);
      console.log(`  exit: ${report.exitCode ?? '-'}  pass: ${report.pass ? chalk.green('true') : chalk.red('false')}${report.reason ? chalk.gray(`  (${report.reason})`) : ''}`);
      if (report.evidence) console.log(chalk.gray(`  evidence: ${report.evidence.reportPath}`));
    }
    process.exitCode = report.pass ? 0 : 2;
  });

// ---- generation gate（测试用例编写完整性）----
program
  .command('generation-capture')
  .description('Capture the current test-file inventory (before TDD generation)')
  .requiredOption('--project <dir>', 'Project directory')
  .option('--out <file>', 'Write inventory JSON to file instead of stdout')
  .action(async (options) => {
    const inventory = await captureTestInventory(path.resolve(options.project));
    const payload = JSON.stringify(inventory, null, 2);
    if (options.out) {
      await fs.writeFile(path.resolve(options.out), payload);
      console.log(chalk.green(`✅ inventory (${inventory.files?.length ?? 0} files) → ${options.out}`));
    } else {
      console.log(payload);
    }
  });

program
  .command('generation-evaluate')
  .description('Evaluate that newly generated tests match the inventory delta and pass')
  .requiredOption('--project <dir>', 'Project directory')
  .requiredOption('--before <file>', 'Inventory JSON captured before generation (generation-capture --out)')
  .option('--command <cmd>', 'Test-generation command to run first (defaults to none)')
  .option('--json', 'Print a machine-readable report', false)
  .action(async (options) => {
    let beforeTestInventory;
    try {
      beforeTestInventory = JSON.parse(await fs.readFile(path.resolve(options.before), 'utf8'));
    } catch (error) {
      const report = { pass: false, reason: `invalid before-inventory: ${error.message}` };
      if (options.json) console.log(JSON.stringify(report));
      else console.error(chalk.red(`❌ ${report.reason}`));
      process.exitCode = 1;
      return;
    }
    let generationResult;
    if (options.command) {
      generationResult = await new Promise((resolve) => {
        const child = spawn('bash', ['-c', options.command], { cwd: path.resolve(options.project), stdio: 'inherit' });
        child.on('exit', (code) => resolve({ exitCode: code, timedOut: false }));
        child.on('error', () => resolve({ exitCode: 1, timedOut: false }));
      });
    }
    const report = await evaluateGeneratedTests({ projectDir: path.resolve(options.project), generationResult, beforeTestInventory });
    if (options.json) {
      console.log(JSON.stringify(report));
    } else {
      console.log(chalk.blue('\n📝 Generation Gate\n'));
      console.log(`  new test files: ${report.testFiles?.length ?? 0}`);
      console.log(`  pass: ${report.pass ? chalk.green('true') : chalk.red('false')}${report.reason ? chalk.gray(`  (${report.reason})`) : ''}`);
    }
    process.exitCode = report.pass ? 0 : 2;
  });

// ---- wiki（LLMWiki 集成）----
const wikiCmd = program.command('wiki').description('管理 LLMWiki（init / ingest）');
wikiCmd.command('init')
  .description('Initialize or rebuild LLMWiki instance skeleton')
  .option('--rebuild', 'Wipe and rebuild', false)
  .action(async (options) => {
    const cwd = process.cwd();
    const wikiDir = getWikiHome(cwd);
    if (options.rebuild && await fs.pathExists(wikiDir)) {
      console.log(chalk.yellow(`  ⚠️ --rebuild 将删除共享 wiki: ${wikiDir}（影响该 project 所有 worktree）`));
      await fs.remove(wikiDir);
    }
    const subs = ['raw','wiki/sources','wiki/concepts','wiki/entities','wiki/outputs','wiki/product/requirements','wiki/product/acceptance-criteria','wiki/engineering','wiki/testing/cases','wiki/testing/matrices','wiki/_shared/glossary','wiki/_shared/traceability'];
    for (const d of subs) await fs.ensureDir(path.join(wikiDir, d));
    if (!await fs.pathExists(path.join(wikiDir, 'index.md'))) await fs.writeFile(path.join(wikiDir, 'index.md'), '# LLMWiki Index\n');
    console.log(chalk.green(`✅ LLMWiki 骨架 (${subs.length} 子目录)`));
    const ks = discoverKnowledgeSources(cwd);
    const ksCount = ks.docs.length + ks.specs.length + ks.steering.length + ks.agentDocs.length;
    if (ksCount > 0 || ks.catalog || ks.domainGraph || ks.openspecConfig) {
      const copyResult = await copySourcesToRaw(cwd, wikiDir, ks);
      console.log(chalk.green(`✅ ${copyResult.copied} 个源 → ${wikiDir}/raw/（待 ingest）`));
      console.log(chalk.gray('   下一步：sdd wiki ingest 或 session 内用 mcp__llmwiki__create'));
    } else {
      console.log(chalk.gray(`ℹ️  无已有知识源（文档放入 ${wikiDir}/raw/ 后 sdd wiki ingest）`));
    }
    console.log('');
  });

wikiCmd.command('ingest')
  .description('读取 raw/ 源，驱动 claude 生成 wiki/sources/ 摘要')
  .option('--source <name>', '只处理指定 raw 文件（不含 .md）', '')
  .option('--force', '重新生成已有摘要', false)
  .option('--model <m>', 'claude model', 'sonnet')
  .option('--promote', 'ingest 后把 sources 派生为下游角色知识', false)
  .action(async (options) => {
    const cwd = process.cwd();
    const wikiHome = getWikiHome(cwd);
    const rawDir = path.join(wikiHome, 'raw');
    const sourcesDir = path.join(wikiHome, 'wiki', 'sources');
    await fs.ensureDir(rawDir); await fs.ensureDir(sourcesDir);
    const today = new Date().toISOString().slice(0, 10);
    const rawFiles = options.source ? [options.source + '.md'] : (await fs.readdir(rawDir).catch(() => [])).filter((f) => f.endsWith('.md'));
    if (rawFiles.length === 0) { console.log(chalk.yellow(`⚠️ raw/ 无 .md 源文件。先把源文档放入 ${rawDir}/`)); process.exitCode = 1; return; }
    let ingested = 0, skipped = 0;
    for (const rf of rawFiles) {
      const rawPath = path.join(rawDir, rf); const sourcePath = path.join(sourcesDir, rf);
      if (!await fs.pathExists(rawPath)) { console.log(chalk.yellow(`  ⚠️ 跳过：${rf} 不存在`)); continue; }
      if (await fs.pathExists(sourcePath) && !options.force) { console.log(chalk.gray(`  ✓ 已有摘要：${rf}（--force 重生成）`)); skipped++; continue; }
      console.log(chalk.blue(`\n  ▶ ingest: ${rf}`));
      const ingestPrompt = `你是 LLMWiki ingest agent。执行 ingest workflow：

1. 读 raw 源文件：${rawPath}
2. 生成 sources 摘要页写入：${sourcePath}，YAML frontmatter 必须含：
   type: source-summary, source_file: ${rf}, ingest_date: ${today}
   key_claims: [3-5 条关键声明], contradicts: [矛盾处无则 []], supports: [下游知识无则 []]
3. 正文：1-2 段提炼摘要，不重复全文。
4. 追加 ingest 记录到 ${wikiHome}/log.md：
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
    if (options.promote) {
      const allSources = (await fs.readdir(sourcesDir).catch(() => [])).filter((f) => f.endsWith('.md'));
      console.log(chalk.blue(`\n  ▶ promote：${allSources.length} 个 source → 下游角色知识\n`));
      const sourcesContent = allSources.map((f) => `## ${f}\n${fs.readFileSync(path.join(sourcesDir, f), 'utf8').slice(0, 400)}`).join('\n');
      const promotePrompt = `你是 LLMWiki ingest agent。基于已生成的 sources 摘要，派生下游角色知识。

## sources 摘要
${sourcesContent}

## 任务
读 sources 的 key_claims，判断每条属于哪个角色，写入对应角色知识目录（frontmatter 必须含 raw 指回其 source 摘要）：
- 产品相关（需求/目标/边界/用户）→ ${wikiHome}/wiki/product/REQ-<slug>.md（type: requirement, raw: ../wiki/sources/<对应source>.md）
- 工程相关（架构/设计/决策/技术约束）→ ${wikiHome}/wiki/engineering/EN-<slug>.md（type: engineering-note, raw: ../wiki/sources/<对应source>.md）
每条知识是简短的知识视角（不是全文复制），backlink 到 source 摘要。只产出有价值的，不为凑数。用 Write。`;
      try {
        await ptyClaude(promotePrompt, { cwd, model: options.model, timeoutMs: 300000 });
        console.log(chalk.green(`    ✓ promote 完成\n`));
      } catch (e) { console.log(chalk.red(`    ❌ promote 失败：${String(e.message).split('\n')[0]}`)); }
    }
  });

program.parse();
