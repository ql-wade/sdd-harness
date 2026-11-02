#!/usr/bin/env node
// design-handoff.mjs — Classic Design handoff 上下文与 outcome 生成器（官方文件协议复刻）。
//
// 用途：为 full 流程的 design 阶段产出 writeClassicSdkDesignContext 的同形状产物
// （.comet/handoff/design-context.{json,md}）与 record-outcome 载荷，并补齐官方执行器
// 一定会携带的双回执（sourceEvidence + requirementsEvidence）——sdd-test r2 实证：
// 手工 handoff outcome 缺 requirementsEvidence 时 allowDesignDocumentChanges=false，
// design.md 被字节锁死，改动即报 "Classic Design handoff has changed"。
//
// 优先级声明：正常流程由驱动器走官方执行器（自动带双回执），本工具用于手工
// record-outcome 复刻场景。验证线来源：gen-handoff-r2.mjs（minecraft-3d-r2 实证）。
//
// 用法：node tools/design-handoff.mjs --project <root> --change <name> [--out <outcome.json>]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveCometRuntimeJson } from './gate-bundle.mjs';

async function cometClassicModules(opts) {
  const runtimeJsonPath = resolveCometRuntimeJson(opts.cometRoot);
  if (!runtimeJsonPath) throw new Error('找不到已安装 comet（handoff 源哈希须与运行时同源；可用 --comet-root 指向包根）');
  const cometDist = path.dirname(path.dirname(path.dirname(runtimeJsonPath)));
  const handoffSource = await import(pathToFileURL(path.join(cometDist, 'domains', 'comet-classic', 'classic-handoff-source.js')).href);
  const sdkApplication = await import(pathToFileURL(path.join(cometDist, 'domains', 'comet-classic', 'classic-sdk-application.js')).href);
  return { handoffSourceHash: handoffSource.handoffSourceHash, classicOpenEvidenceReceipt: sdkApplication.classicOpenEvidenceReceipt };
}

export async function buildDesignHandoff(opts) {
  const changeRef = `openspec/changes/${opts.change}`;
  const changeDir = path.join(opts.project, changeRef);
  if (!existsSync(path.join(changeDir, 'proposal.md'))) throw new Error(`缺 ${changeRef}/proposal.md——handoff 至少需要 proposal`);

  const { handoffSourceHash, classicOpenEvidenceReceipt } = await cometClassicModules(opts);
  const files = ['proposal.md', 'design.md', 'tasks.md']
    .map((name) => path.join(changeDir, name))
    .filter((f) => existsSync(f));
  const sources = files.map((file) => {
    const reference = `${changeRef}/${path.basename(file)}`;
    const content = readFileSync(file, 'utf8');
    return { reference, sha256: handoffSourceHash(file, content) };
  });
  const contextHash = createHash('sha256')
    .update(sources.flatMap(({ reference, sha256: s }) => [`path:${reference}`, `sha256:${s}`]).join('\n'))
    .digest('hex');

  const handoffDir = path.join(changeDir, '.comet', 'handoff');
  mkdirSync(handoffDir, { recursive: true });
  const contextJsonRef = `${changeRef}/.comet/handoff/design-context.json`;
  const document = {
    change: opts.change, phase: 'design', canonical_spec: 'openspec',
    context_hash: contextHash, mode: 'compact',
    files: sources.map(({ reference, sha256: s }) => ({ path: reference, sha256: s })),
  };
  writeFileSync(path.join(handoffDir, 'design-context.json'), JSON.stringify(document, null, 2) + '\n');
  const mdLines = [
    `# Design handoff context — ${opts.change}`,
    '',
    `- Change: ${opts.change}`,
    '- Phase: design',
    `- Context hash: ${contextHash}`,
    '',
    ...sources.flatMap(({ reference, sha256: s }) => [`- Source: ${reference}`, `- SHA256: ${s}`]),
    '',
  ];
  writeFileSync(path.join(handoffDir, 'design-context.md'), mdLines.join('\n'));

  const proposal = readFileSync(path.join(changeDir, 'proposal.md'), 'utf8');
  // 官方执行器形状（classic-sdk-design.js）：output = { proposal, ...handoff, sourceEvidence, requirementsEvidence }。
  // 缺 requirementsEvidence 的手工 outcome 会让 design.md 字节锁死——这里必须补齐双回执。
  const sourceEvidence = await classicOpenEvidenceReceipt(opts.project, changeRef);
  const requirementsEvidence = await classicOpenEvidenceReceipt(opts.project, changeRef, { designRequirements: true });
  const outcome = {
    status: 'succeeded',
    output: { proposal, handoffContext: contextJsonRef, handoffHash: contextHash, sourceEvidence, requirementsEvidence },
  };
  return { contextHash, contextJsonRef, sources, outcome };
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { project: process.cwd(), cometRoot: null, out: null, change: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') opts.project = argv[++i];
    else if (argv[i] === '--change') opts.change = argv[++i];
    else if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--comet-root') opts.cometRoot = argv[++i];
  }
  if (!opts.change) {
    console.error('用法: node tools/design-handoff.mjs --project <root> --change <name> [--out <outcome.json>] [--comet-root <pkgRoot>]');
    process.exit(1);
  }
  try {
    const built = await buildDesignHandoff(opts);
    const out = opts.out ?? path.join(opts.project, '.sdd', 'delivery', 'gates', 'a-handoff-outcome.json');
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(built.outcome, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, change: opts.change, contextHash: built.contextHash, contextJson: built.contextJsonRef, sources: built.sources.map((s) => s.reference), outcomeFile: out }, null, 1));
    console.error('✅ handoff 上下文与 outcome 就绪（含 sourceEvidence + requirementsEvidence 双回执）。design.md 现在允许修改；下次 handoff 前先定稿。');
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

const invokedAs = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedAs === import.meta.url) {
  await main();
}
