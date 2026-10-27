// LLMWiki adapter — the Knowledge.Closeout.v1 Kp side (task P4_4, E01/D06).
//
// Judgment + protocol layer only. This module builds the structured publish
// operation, drives the REAL MCP launcher child process, and judges the
// independent readback. It owns no phase, no ledger and no retry loop: the
// Kp-before-archive ordering stays at the driver gate (P1_3 sealCloseout)
// and the run-level seat stays in the single Runtime
// (Comet.Run.managedDelivery.v1 — no second currentPhase here).
//
// Environment fact (revision 2026-10-26-comet-050-adoption-v1): the LIVE
// local stdio server is verified — the I04-admitted supply (venv python +
// mcp SDK 1.27.0) answers initialize with protocolVersion 2025-11-25 and the
// create/read/search tool-argument shapes below are the ones the real server
// accepts (P4_4's /tmp closed-loop world + the I04 worktree-mcp-readback
// probe). The launcher refusal and the timeout readback semantics remain the
// tested object of the offline suite; the managed-host admission of the
// launcher itself stays UNVERIFIED (I04 admission conditions).
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
//   RESPONDED            — the JSON-RPC response to the READBACK frame
//                          arrived (the create + readback round trip).
// The JSON-RPC frames are newline-delimited. The tool-argument shapes are the
// LIVE-VERIFIED ones (revision 2026-10-26-comet-050-adoption-v1, against the
// real local server: initialize negotiates protocolVersion 2025-11-25; the
// create tool takes knowledge_base/title/content/tags/path — the read tool
// takes knowledge_base/path and returns the exact stored bytes after its
// metadata header).
export function invokeMcpPublish({ operation, launcherPath, timeoutMs = 8_000, env, content } = {}) {
  if (!operation?.operationId || !launcherPath) {
    return Promise.resolve({ status: 'LAUNCHER_UNAVAILABLE', code: 'LAUNCHER_INPUT_INVALID', exitCode: null, reason: 'invokeMcpPublish requires operation and launcherPath' });
  }
  // The published candidate: the frozen knowledge body (default: the minimal
  // capability/digest carrier). A Kp execution passes the authored candidate
  // content; its sha256 must equal operation.contentDigest.
  const candidate = content ?? `capability: ${operation.capability}\ndigest: ${operation.contentDigest}\n`;
  // SEQUENTIAL session discipline (live-observed): the real server processes
  // concurrent tool requests out of order — a read frame written before the
  // create commits races it and reports the target not-found. Each frame is
  // written only after the previous request's response arrived.
  const initializeFrame = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'sdd-knowledge-closeout', version: '0.1.0' } } });
  const initializedNotification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const createFrame = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create', arguments: { knowledge_base: 'project', title: `${operation.capability}.md`, content: candidate, tags: ['kp', 'closeout'], path: '/wiki/concepts/' } } });
  const readFrame = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read', arguments: { knowledge_base: 'project', path: `/wiki/${operation.targetPath}` } } });
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
    const write = (frame) => child.stdin?.write(`${frame}\n`);
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
      // Responses may arrive in chunks; scan the complete lines each time and
      // advance the sequential session: initialize -> create -> read.
      let sawCompleteLine = false;
      const texts = {};
      for (const line of stdout.split('\n')) {
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        sawCompleteLine = true;
        if (frame?.id === undefined) continue;
        const frameContent = frame?.result?.content;
        texts[frame.id] = Array.isArray(frameContent)
          ? frameContent.map((item) => item?.text ?? '').join('\n') : null;
      }
      if (!sawCompleteLine) return;
      if (texts[1] !== undefined && !sessionStage.createSent) {
        sessionStage.createSent = true;
        write(initializedNotification);
        write(createFrame);
        return;
      }
      // The create (id 2) alone is NOT the settle point: the session readback
      // (id 3) is part of one publish invocation, and the timeout window must
      // stay open until it answers (D06: the readback is never optional).
      if (texts[2] !== undefined && !sessionStage.readSent) {
        sessionStage.readSent = true;
        sessionStage.createText = texts[2];
        write(readFrame);
        return;
      }
      if (texts[3] !== undefined) {
        clearTimeout(timer);
        // Judge the byte-suffix consistency against the candidate.
        const readbackText = texts[3];
        const readbackConsistent = typeof readbackText === 'string'
          && readbackText.endsWith(candidate)
          && sha256Hex(readbackText.slice(readbackText.length - candidate.length)) === operation.contentDigest;
        finish({
          status: 'RESPONDED', response: stdout, operationId: operation.operationId,
          createText: sessionStage.createText ?? null, readbackText, readbackConsistent,
        });
      }
    });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    const sessionStage = { createSent: false, readSent: false, createText: null };
    write(initializeFrame);
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
