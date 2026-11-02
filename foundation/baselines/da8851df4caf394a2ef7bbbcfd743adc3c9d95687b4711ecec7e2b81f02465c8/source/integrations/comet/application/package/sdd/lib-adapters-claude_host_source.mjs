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
const SCAN_LIMIT = 16 * 1024 * 1024;
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
  if (!stat.isFile() || stat.size > SCAN_LIMIT) { fs.closeSync(fd); return null; }
  return { fd, size: stat.size };
}
function readTranscript({ sessionPath, transcriptId }) {
  const opened = openTranscript({ sessionPath, transcriptId });
  if (!opened) return null;
  const { fd, size } = opened;
  try {
    const bytes = Buffer.alloc(size);
    if (fs.readSync(fd, bytes, 0, size, 0) !== size) throw Error('transcript read failed');
    return bytes;
  } finally { fs.closeSync(fd); }
}
const textOfResult = (block) => Array.isArray(block.content)
  ? block.content.filter((item) => item?.type === 'text').map((item) => item.text).join('\n')
  : typeof block.content === 'string' ? block.content : null;

// ONE Bash tool execution: the assistant tool_use whose command string hashes
// to commandDigest, paired with its tool_result output.
export function readClaudeCommandEvent({ sessionPath, transcriptId, commandDigest } = {}) {
  try {
    if (!SHA.test(commandDigest ?? '')) return refusal();
    const bytes = readTranscript({ sessionPath, transcriptId });
    if (!bytes) return refusal();
    let from = 0, toolUse = null, toolResult = null;
    while (from < bytes.length) {
      const end = bytes.indexOf(10, from);
      if (end < 0) break;
      const line = bytes.subarray(from, end); from = end + 1;
      if (line.length > LIMIT) continue;
      let record;
      try { record = JSON.parse(line.toString('utf8')); } catch { continue; }
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
      if (toolUse && toolResult !== null) break;
    }
    if (!toolUse || toolResult === null) return refusal();
    return { ok: true, scope: 'claude-host-observation', sourceQualified: false, managedClosureEligible: false,
      transcriptId, commandDigest, outputDigest: hash(toolResult), output: toolResult };
  } catch { return refusal(); }
}
// ONE assistant text statement whose sha256 equals statementDigest.
export function readClaudeStatement({ sessionPath, transcriptId, statementDigest } = {}) {
  try {
    if (!SHA.test(statementDigest ?? '')) return refusal();
    const bytes = readTranscript({ sessionPath, transcriptId });
    if (!bytes) return refusal();
    let from = 0;
    while (from < bytes.length) {
      const end = bytes.indexOf(10, from);
      if (end < 0) break;
      const line = bytes.subarray(from, end); from = end + 1;
      if (line.length > LIMIT) continue;
      let record;
      try { record = JSON.parse(line.toString('utf8')); } catch { continue; }
      if (record?.type !== 'assistant' || !Array.isArray(record.message?.content)) continue;
      for (const block of record.message.content) {
        if (block?.type === 'text' && typeof block.text === 'string' && hash(block.text) === statementDigest) {
          return { ok: true, scope: 'claude-host-observation', sourceQualified: false, managedClosureEligible: false,
            transcriptId, statementDigest, statement: block.text };
        }
      }
    }
    return refusal();
  } catch { return refusal(); }
}
