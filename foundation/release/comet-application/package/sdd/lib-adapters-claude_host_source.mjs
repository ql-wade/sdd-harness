// Read-only Claude Code host session observation — the claude-side sibling of
// codex-host-source.js. Locates a real transcript under the logged-in user's
// ~/.claude/projects root (root session <uuid>.jsonl or subagent
// agent-<id>.jsonl), checks its identity, and extracts ONE Bash command
// execution (tool_use + tool_result) or ONE assistant text statement with
// byte digests. Corroboration only: no identity qualification, no approvals.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SHA = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT = /^[0-9a-f]{16,64}$/;
const LIMIT = 2 * 1024 * 1024;
const READ_CHUNK = 1024 * 1024;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const refusal = () => ({ ok: false, scope: 'claude-host-observation', sourceQualified: false, managedClosureEligible: false });

function transcriptNameMatches(basename, transcriptId) {
  return basename === `${transcriptId}.jsonl` || basename === `agent-${transcriptId}.jsonl`;
}
function idAcceptable(transcriptId) {
  return ID.test(transcriptId ?? '') || AGENT.test(transcriptId ?? '');
}
function openTranscript({ sessionPath, transcriptId }) {
  if (typeof sessionPath !== 'string' || !path.isAbsolute(sessionPath) || !idAcceptable(transcriptId)
    || typeof fs.constants.O_NOFOLLOW !== 'number') return null;
  if (!transcriptNameMatches(path.basename(sessionPath), transcriptId)) return null;
    // Anchor the host identity to the REAL logged-in user, never the process
  // HOME override (a verify sandbox may set HOME to scratch space).
  let projectsRoot = null;
  for (const home of [os.homedir(), path.join('/Users', os.userInfo().username), path.join('/home', os.userInfo().username)]) {
    const candidate = path.join(home, '.claude', 'projects');
    try { if (fs.statSync(candidate).isDirectory()) { projectsRoot = candidate; break; } } catch { /* next */ }
  }
  if (!projectsRoot) return null;
  const root = fs.realpathSync(projectsRoot);
  const target = fs.realpathSync(sessionPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || fs.lstatSync(sessionPath).isSymbolicLink()) return null;
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const stat = fs.fstatSync(fd);
  if (!stat.isFile()) { fs.closeSync(fd); return null; }
  return { fd };
}
// 流式逐行扫描（JSONL）：内存有界（每行 ≤LIMIT，读缓冲 ≤READ_CHUNK），转录任意大小
// 可遍历——bug#8（sdd-test r7 实证）：宿主转录只增不减，整文件读 + 16MB 上限会把
// 长会话的全部门收据佐证永久拒绝。锚定语义不变（O_NOFOLLOW fd + realpath projects 根）。
// onLine 返回 false 时提前停止（调用方命中目标后免扫余文）；返回 false = 打开/扫描失败。
function scanTranscriptLines({ sessionPath, transcriptId }, onLine) {
  const opened = openTranscript({ sessionPath, transcriptId });
  if (!opened) return false;
  const { fd } = opened;
  try {
    const chunk = Buffer.alloc(READ_CHUNK);
    let carry = null, pos = 0;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, READ_CHUNK, pos);
      if (n === 0) break;
      pos += n;
      const buf = carry ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      let from = 0;
      for (;;) {
        const end = buf.indexOf(10, from);
        if (end < 0) break;
        const line = buf.subarray(from, end);
        from = end + 1;
        if (line.length > LIMIT) continue;
        if (onLine(line) === false) return true;
      }
      carry = buf.subarray(from);
      if (carry.length > LIMIT) carry = null; // 超长单行：与既有逐行 LIMIT 语义一致，弃行
    }
    if (carry && carry.length) onLine(carry);
    return true;
  } finally { fs.closeSync(fd); }
}
const parseLine = (line) => {
  try { return JSON.parse(line.toString('utf8')); } catch { return null; }
};
const textOfResult = (block) => Array.isArray(block.content)
  ? block.content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n')
  : typeof block.content === 'string' ? block.content : null;

// ONE Bash tool execution: the assistant tool_use whose command string hashes
// to commandDigest, paired with its tool_result output.
export function readClaudeCommandEvent({ sessionPath, transcriptId, commandDigest } = {}) {
  try {
    if (!SHA.test(commandDigest ?? '')) return refusal();
    let toolUse = null, toolResult = null;
    const found = scanTranscriptLines({ sessionPath, transcriptId }, (line) => {
      if (toolUse && toolResult !== null) return false; // 命中即停，免扫余文
      const record = parseLine(line);
      if (!record) return;
      if (record?.type === 'assistant' && Array.isArray(record.message?.content) && !toolUse) {
        for (const block of record.message.content) {
          if (block?.type === 'tool_use' && block.name === 'Bash' && typeof block.input?.command === 'string'
            && hash(block.input.command) === commandDigest) toolUse = block;
        }
      }
      if (record?.type === 'user' && Array.isArray(record.message?.content) && toolUse && toolResult === null) {
        for (const block of record.message.content) {
          if (block?.type === 'tool_result' && block.tool_use_id === toolUse.id) toolResult = textOfResult(block);
        }
      }
      return toolUse && toolResult !== null ? false : undefined;
    });
    if (!found || !toolUse || toolResult === null) return refusal();
    return { ok: true, scope: 'claude-host-observation', sourceQualified: false, managedClosureEligible: false,
      transcriptId, commandDigest, outputDigest: hash(toolResult), output: toolResult };
  } catch { return refusal(); }
}
// ONE assistant text statement whose sha256 equals statementDigest.
export function readClaudeStatement({ sessionPath, transcriptId, statementDigest } = {}) {
  try {
    if (!SHA.test(statementDigest ?? '')) return refusal();
    let statement = null;
    const found = scanTranscriptLines({ sessionPath, transcriptId }, (line) => {
      const record = parseLine(line);
      if (record?.type !== 'assistant' || !Array.isArray(record.message?.content)) return;
      for (const block of record.message.content) {
        if (block?.type === 'text' && typeof block.text === 'string' && hash(block.text) === statementDigest) {
          statement = block.text;
          return false; // 命中即停
        }
      }
    });
    if (!found || statement === null) return refusal();
    return { ok: true, scope: 'claude-host-observation', sourceQualified: false, managedClosureEligible: false,
      transcriptId, statementDigest, statement };
  } catch { return refusal(); }
}
