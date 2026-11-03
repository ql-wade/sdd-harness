import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readClaudeCommandEvent, readClaudeStatement } from '../lib/adapters/claude-host-source.js';

// bug#8 回归（sdd-test r7 实证）：宿主转录只增不减，整文件读 + 16MB SCAN_LIMIT 会把
// 长会话的全部门收据佐证永久拒绝。修复 = 流式逐行扫描（内存有界，任意大小可遍历），
// 锚定语义不变（realpath projects 根 + O_NOFOLLOW fd + 文件名匹配 + 逐行 2MB LIMIT）。

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const UUID = '1234e567-e89b-412d-a456-426614174000';

function withHome(t, root) {
  const old = process.env.HOME;
  process.env.HOME = root;
  t.after(() => { if (old === undefined) delete process.env.HOME; else process.env.HOME = old; });
}

test('readers traverse a >16MB transcript (SCAN_LIMIT ceiling removed)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-host-src-'));
  withHome(t, root);
  const projects = path.join(root, '.claude', 'projects', 'proj');
  fs.mkdirSync(projects, { recursive: true });
  const file = path.join(projects, `${UUID}.jsonl`);
  const command = 'node tools/gate-bundle.mjs --gate T --test-contract contract.json';
  const statement = 'T-DESIGN-REVIEW-PASS-FINAL statement';

  const lines = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'start' }] } }),
  ];
  const big = 'x'.repeat(300 * 1024); // 填充行（300KB ≤ 逐行 LIMIT）
  let total = lines[0].length + 1;
  while (total < 17 * 1024 * 1024) {
    lines.push(JSON.stringify({ type: 'pad', big }));
    total += big.length + 20;
  }
  lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command } }] } }));
  lines.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'gate bundle bytes written' }] } }));
  lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: statement }] } }));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const size = fs.statSync(file).size;
  assert.ok(size > 16 * 1024 * 1024, `fixture must exceed the old SCAN_LIMIT, got ${size}`);

  const cmd = readClaudeCommandEvent({ sessionPath: file, transcriptId: UUID, commandDigest: sha(command) });
  assert.equal(cmd.ok, true, JSON.stringify(cmd));
  assert.equal(cmd.output, 'gate bundle bytes written');
  assert.equal(cmd.outputDigest, sha('gate bundle bytes written'));

  const stmt = readClaudeStatement({ sessionPath: file, transcriptId: UUID, statementDigest: sha(statement) });
  assert.equal(stmt.ok, true, JSON.stringify(stmt));
  assert.equal(stmt.statement, statement);

  fs.rmSync(root, { recursive: true, force: true });
});

test('small transcripts keep working; oversize single lines are skipped, not fatal', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-host-src-small-'));
  withHome(t, root);
  const projects = path.join(root, '.claude', 'projects', 'proj');
  fs.mkdirSync(projects, { recursive: true });
  const file = path.join(projects, `${UUID}.jsonl`);
  const command = 'echo small';
  const lines = [
    JSON.stringify({ type: 'pad', big: 'y'.repeat(3 * 1024 * 1024) }), // 超过逐行 LIMIT 的行：跳过不致命
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'final statement' }] } }),
  ];
  fs.writeFileSync(file, lines.join('\n') + '\n');

  const cmd = readClaudeCommandEvent({ sessionPath: file, transcriptId: UUID, commandDigest: sha(command) });
  assert.equal(cmd.ok, true);
  assert.equal(cmd.output, 'ok');
  const stmt = readClaudeStatement({ sessionPath: file, transcriptId: UUID, statementDigest: sha('final statement') });
  assert.equal(stmt.ok, true);
  assert.equal(stmt.statement, 'final statement');

  fs.rmSync(root, { recursive: true, force: true });
});

test('anchoring preserved: name mismatch and symlink escape refuse', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-host-src-anchor-'));
  withHome(t, root);
  const projects = path.join(root, '.claude', 'projects', 'proj');
  fs.mkdirSync(projects, { recursive: true });
  const command = 'echo x';

  // 文件名与 transcriptId 不匹配 → 拒绝
  const wrong = path.join(projects, 'not-a-matching-name.jsonl');
  fs.writeFileSync(wrong, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command } }] } }) + '\n');
  const r1 = readClaudeCommandEvent({ sessionPath: wrong, transcriptId: UUID, commandDigest: sha(command) });
  assert.equal(r1.ok, false);

  // 符号链接逃逸 → 拒绝
  const outside = path.join(root, 'outside.jsonl');
  fs.writeFileSync(outside, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command } }] } }) + '\n');
  const link = path.join(projects, `${UUID}.jsonl`);
  fs.symlinkSync(outside, link);
  const r2 = readClaudeCommandEvent({ sessionPath: link, transcriptId: UUID, commandDigest: sha(command) });
  assert.equal(r2.ok, false);

  fs.rmSync(root, { recursive: true, force: true });
});
