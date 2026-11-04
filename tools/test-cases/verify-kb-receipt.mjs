#!/usr/bin/env node
// KB 发布回执读回比对（proposal v2.5 AC-5）：校验回执结构、与当前 Run 的绑定、
// 正本 digest 与盘上字节一致、（提供页导出时）KB 页面 frontmatter 记录的正本 digest。
// llmwiki MCP 恢复前，页文件以人工导出的 Markdown 提供；MCP 恢复后可直读导出。
// 退出码契约：0 通过 / 1 校验不通过 / 2 用法错误。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message) => { process.stderr.write(`❌ kb-receipt: ${message}\n`); process.exit(1); };

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const args = process.argv.slice(2);
const project = path.resolve(argValue(args, '--project') ?? process.cwd());
const receiptRel = argValue(args, '--receipt') ?? '.sdd/delivery/gates/t/kb-publish-receipt.json';
const pageFile = argValue(args, '--page');
const expectedRunId = argValue(args, '--run-id');
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write('用法: node tools/test-cases/verify-kb-receipt.mjs --project <root> [--receipt <path>] [--run-id <runId>] [--page <exported-page.md>]\n');
  process.exit(0);
}
const receiptPath = path.resolve(project, receiptRel);
if (!fs.existsSync(receiptPath)) fail(`回执不存在: ${receiptRel}`);
let receipt;
try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch (error) { fail(`回执不可解析: ${error.message}`); }
if (receipt?.schema !== 'sdd.delivery.kb-publish-receipt.v1') fail('schema 必须是 sdd.delivery.kb-publish-receipt.v1');
for (const field of ['runId', 'change', 'page', 'source', 'publishedAt']) {
  if (receipt[field] === undefined) fail(`回执缺字段 ${field}`);
}
if (expectedRunId && receipt.runId !== expectedRunId) {
  fail(`回执 runId (${receipt.runId}) 与当前 Run (${expectedRunId}) 绑定失配——疑似跨 Run 复制`);
}
if (receipt.change !== receipt.runId) fail('回执 change 必须与 runId 一致（同一需求）');
const sourcePath = path.resolve(project, receipt.source?.path ?? '');
if (!fs.existsSync(sourcePath)) fail(`回执正本不存在: ${receipt.source?.path}`);
const sourceBytes = fs.readFileSync(sourcePath);
if (sha256(sourceBytes) !== receipt.source?.sha256) fail('正本 digest 失配（source.sha256 与盘上字节不一致）');
if (!/^[a-f0-9]{64}$/.test(receipt.page?.sha256 ?? '')) fail('页哈希必须是 sha256 hex');
if (pageFile) {
  const pageBytes = fs.readFileSync(path.resolve(pageFile), 'utf8');
  const match = /^digest:\s*([a-f0-9]{64})\s*$/m.exec(pageBytes);
  if (!match) fail('页面文件缺 frontmatter `digest: <sha256>` 记录（KB 存摘要+指针+矩阵，读回比对该记录）');
  if (match[1] !== receipt.source.sha256) fail(`页面记录 digest (${match[1].slice(0, 12)}…) ≠ 回执正本 digest (${receipt.source.sha256.slice(0, 12)}…)`);
}
process.stdout.write(`✅ kb-receipt: ${receiptRel} 通过（runId=${receipt.runId} 正本=${receipt.source.path} digest=${receipt.source.sha256.slice(0, 12)}…${pageFile ? ' 页读回一致' : ' 页未提供——读回校验需 --page 导出文件（llmwiki MCP 恢复后可直接导出）'}）\n`);
