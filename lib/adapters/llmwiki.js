// LLMWiki adapter — the Knowledge.Closeout.v1 Kp side (task P4_4, E01/D06).
//
// Judgment + protocol layer only. This module builds the structured publish
// operation, drives the REAL MCP launcher child process, and judges the
// independent readback. It owns no phase, no ledger and no retry loop: the
// Kp-before-archive ordering stays at the driver gate (P1_3 sealCloseout)
// and the run-level seat stays in the single Runtime
// (Comet.Run.managedDelivery.v1 — no second currentPhase here).
//
// Environment fact: no live LLMWiki service is verified in this wave. The
// launcher refusal and the timeout readback semantics below are the tested
// object; a real MCP write round-trip stays honestly UNVERIFIED (successor:
// deployment verification wave — the I04 probe worktree-mcp-readback owns
// the live channel). The JSON-RPC tool-argument shape for `create` is
// likewise unverified and may need adjustment against the live server.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

export const KP_INTERFACE = 'Knowledge.Closeout.v1';

// C06 knowledge boundary: the four knowledge sources are distinct unique
// sources; none covers or replaces another (P1_4 registered semantics).
export const KNOWLEDGE_SOURCES = Object.freeze(['builtin-memory', 'llmwiki', 'outline', 'code-wiki']);

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

export class KnowledgeCloseoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KnowledgeCloseoutError';
    this.code = code;
  }
}

// The publish operation: a deterministic identity (same change + capability +
// content digest => same operationId) so a retry re-targets the SAME
// operation and can never mint a second knowledge page (E06).
export function buildKpOperation({ change, entry }) {
  if (!change || typeof change !== 'string') {
    throw new KnowledgeCloseoutError('KP_OPERATION_INVALID', 'buildKpOperation requires the change id');
  }
  if (!entry || typeof entry.capability !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest ?? '')) {
    throw new KnowledgeCloseoutError('KP_OPERATION_INVALID', 'buildKpOperation requires an entry with capability and a sha256 content digest');
  }
  const operationId = `kp-${sha256Hex(`${change}\u0000${entry.capability}\u0000${entry.digest}`).slice(0, 16)}`;
  return Object.freeze({
    interface: KP_INTERFACE,
    channel: 'llmwiki-mcp',
    operationId,
    tool: 'mcp__llmwiki__create',
    change,
    capability: entry.capability,
    contentDigest: entry.digest,
    targetPath: `concepts/${entry.capability}.md`,
  });
}

// The REAL MCP launcher entrance. Statuses:
//   LAUNCHER_UNAVAILABLE — the launcher resolved and refused (missing venv,
//                          non-zero exit) or could not spawn at all;
//   TIMEOUT              — the server did not answer within timeoutMs; the
//                          caller MUST resolve by independent readback and is
//                          never allowed to blind-retry the create (D06);
//   RESPONDED            — a JSON-RPC response frame arrived.
// The JSON-RPC frames are newline-delimited; the exact create tool-argument
// shape is unverified against a live server (see header) — the launcher
// refusal and timeout paths are the verified surface here.
export function invokeMcpPublish({ operation, launcherPath, timeoutMs = 8_000, env } = {}) {
  if (!operation?.operationId || !launcherPath) {
    return Promise.resolve({ status: 'LAUNCHER_UNAVAILABLE', code: 'LAUNCHER_INPUT_INVALID', exitCode: null, reason: 'invokeMcpPublish requires operation and launcherPath' });
  }
  const frames = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sdd-knowledge-closeout', version: '0.1.0' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create', arguments: { kb: 'project', name: operation.capability, content: `capability: ${operation.capability}\ndigest: ${operation.contentDigest}` } } }),
  ];
  return new Promise((resolve) => {
    // The launcher is spawned directly (shebang-executable); its stdin stays
    // open for its lifetime like a real MCP session — closing it would end
    // the server before the timeout window can ever be observed.
    // detached: the timeout kill takes down the whole launcher process GROUP
    // (a shell launcher leaves children that would otherwise hold the stdio
    // pipes open for the runner).
    const child = spawn(launcherPath, [], {
      cwd: process.cwd(),
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
      resolve(result);
    };
    const timer = setTimeout(() => finish({
      status: 'TIMEOUT',
      code: 'MCP_TIMEOUT',
      operationId: operation.operationId,
      guidance: 'result unknown: resolve by an independent readback of the original target first; never re-create the knowledge page (D06)',
    }), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ status: 'LAUNCHER_UNAVAILABLE', code: 'LAUNCHER_ENOENT', exitCode: null, reason: error.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const reason = String(stderr ?? '').split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? `launcher exited ${code}`;
      finish({ status: 'LAUNCHER_UNAVAILABLE', code: 'LAUNCHER_EXIT_NONZERO', exitCode: code, reason });
    });
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      // A response to our tools/call frame settles the invoke.
      if (stdout.includes('"id":2')) {
        clearTimeout(timer);
        finish({ status: 'RESPONDED', response: stdout });
      }
    });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    for (const frame of frames) child.stdin?.write(`${frame}\n`);
  });
}

// D06: a timed-out publication resolves by reading the ORIGINAL target back
// (the readback is re-derived by the K execution, not assumed). Unknown
// stays blocked; a mismatch is never a pass. No branch here re-issues the
// create — the journal guard below is what allows a retry at all.
export function resolveTimedOutPublish({ operation, readback }) {
  if (!operation?.operationId) throw new KnowledgeCloseoutError('KP_OPERATION_INVALID', 'resolveTimedOutPublish requires the operation');
  if (!readback || typeof readback.found !== 'boolean') {
    throw new KnowledgeCloseoutError('READBACK_INVALID', 'resolveTimedOutPublish requires a readback record { found, digest }');
  }
  if (!readback.found) {
    return { resolved: false, outcome: 'PUBLICATION_UNKNOWN', blocked: ['KP_PUBLICATION_UNKNOWN'] };
  }
  if (readback.digest !== operation.contentDigest) {
    return { resolved: false, outcome: 'READBACK_MISMATCH', blocked: ['KP_READBACK_MISMATCH'] };
  }
  return {
    resolved: true,
    outcome: 'CONFIRMED_BY_READBACK',
    receipt: buildKpCloseoutReceipt({ operation, readback, execution: readback.execution ?? 'readback-confirmed', recordedAt: readback.at ?? new Date().toISOString() }),
  };
}

// E06: the issued-operation journal is the only path back to a publish. A
// second create for an already-issued operation is refused outright.
export function refuseDuplicateCreate({ issuedOperationIds, operationId }) {
  if (!Array.isArray(issuedOperationIds)) {
    throw new KnowledgeCloseoutError('JOURNAL_INVALID', 'refuseDuplicateCreate requires the issued-operation journal array');
  }
  if (issuedOperationIds.includes(operationId)) {
    return { refused: true, code: 'DUPLICATE_CREATE_REFUSED', reason: `operation ${operationId} was already issued; resume by readback, never a second create (E06)` };
  }
  return { refused: false };
}

// The Kp receipt in the Knowledge.Closeout.v1 shape consumed by the P1_3
// sealCloseout / closeoutSpecs preconditions. Step 11 rework: the receipt is
// the Kp-before-archive seal input, so it can only be minted from a CONFIRMED
// independent readback of the original target — missing/unconfirmed stays
// blocked, a mismatch is never a pass (admission/upGate semantics:
// fail-closed, full reason, no door without the bound evidence).
export function buildKpCloseoutReceipt({ operation, readback, execution, recordedAt }) {
  if (!operation?.capability || !/^[a-f0-9]{64}$/.test(operation.contentDigest ?? '')) {
    throw new KnowledgeCloseoutError('KP_OPERATION_INVALID', 'buildKpCloseoutReceipt requires a Kp operation with capability and digest');
  }
  if (!readback || typeof readback !== 'object') {
    throw new KnowledgeCloseoutError('KP_READBACK_REQUIRED', 'the Kp archive receipt requires a confirmed independent readback of the original target; a shape-correct record without readback evidence opens no door');
  }
  if (readback.found !== true) {
    throw new KnowledgeCloseoutError('KP_PUBLICATION_UNKNOWN', 'the readback did not confirm the knowledge entry (found !== true); unknown stays blocked — read the original target back first (D06)');
  }
  if (readback.digest !== operation.contentDigest) {
    throw new KnowledgeCloseoutError('KP_READBACK_MISMATCH', `the readback digest ${String(readback.digest).slice(0, 12)}… does not match the operation content digest ${String(operation.contentDigest).slice(0, 12)}…; a mismatched readback never signs the archive receipt`);
  }
  if (typeof execution !== 'string' || execution.length === 0) {
    throw new KnowledgeCloseoutError('KP_EXECUTION_REQUIRED', 'buildKpCloseoutReceipt requires the closing execution identity');
  }
  return { id: `llmwiki:${operation.capability}`, digest: operation.contentDigest };
}

// C06: knowledge evidence is source-bound. A publication in one source can
// never satisfy an obligation of another source (an Outline page is not an
// LLMWiki entry; a builtin memory note is not external knowledge evidence).
export function refuseCrossSourceEvidence({ channel, evidenceSource }) {
  if (!KNOWLEDGE_SOURCES.includes(channel)) {
    throw new KnowledgeCloseoutError('CHANNEL_INVALID', `unknown knowledge channel ${String(channel)}; expected one of ${KNOWLEDGE_SOURCES.join(', ')}`);
  }
  if (channel === evidenceSource) return { allowed: true };
  return {
    allowed: false,
    code: 'KNOWLEDGE_SOURCE_SUBSTITUTION',
    reason: `${String(evidenceSource)} evidence cannot satisfy a ${channel} obligation: the knowledge sources are distinct unique sources that never cover or replace each other (C06)`,
  };
}
