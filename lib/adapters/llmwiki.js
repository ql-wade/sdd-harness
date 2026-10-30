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
import { TextDecoder } from 'node:util';

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
//   INPUT_INVALID        — the frozen body is missing, malformed or mismatched;
//   INITIALIZE_FAILED    — no create request was sent;
//   CREATE_FAILED/READ_FAILED/TIMEOUT — the result may be unknown: resolve
//                          by original-target readback, never blind-retry create;
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
  // Refuse mismatched or absent frozen content before opening the MCP session.
  if (typeof content !== 'string' || content.length === 0) {
    return Promise.resolve({ status: 'INPUT_INVALID', code: 'KP_CONTENT_REQUIRED' });
  }
  if (Buffer.from(content, 'utf8').toString('utf8') !== content) {
    return Promise.resolve({ status: 'INPUT_INVALID', code: 'KP_CONTENT_UNICODE_INVALID' });
  }
  if (typeof operation.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(operation.contentDigest)) {
    return Promise.resolve({ status: 'INPUT_INVALID', code: 'KP_CONTENT_DIGEST_INVALID' });
  }
  if (sha256Hex(content) !== operation.contentDigest) {
    return Promise.resolve({ status: 'INPUT_INVALID', code: 'KP_CONTENT_DIGEST_MISMATCH' });
  }
  const candidate = content;
  // SEQUENTIAL session discipline (live-observed): the real server processes
  // concurrent tool requests out of order — a read frame written before the
  // create commits races it and reports the target not-found. Each frame is
  // written only after the previous request's response arrived.
  // A later request ID does not exist until the preceding response is fully
  // drained, so a server cannot pre-send a usable response to that request.
  const requestId = () => crypto.randomBytes(16).toString('hex');
  const initializeId = requestId();
  const initializeFrame = JSON.stringify({ jsonrpc: '2.0', id: initializeId, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'sdd-knowledge-closeout', version: '0.1.0' } } });
  const initializedNotification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const createFrame = (id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'create', arguments: { knowledge_base: 'project', title: `${operation.capability}.md`, content: candidate, tags: ['kp', 'closeout'], path: '/wiki/concepts/' } } });
  const readFrame = (id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read', arguments: { knowledge_base: 'project', path: `/wiki/${operation.targetPath}` } } });
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
    const stdout = [];
    let stderr = '';
    const sessionStage = { createSent: false, readSent: false, createText: null, expectedId: initializeId, next: null, result: null };
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
      outcome: 'UNKNOWN',
      operationId: operation.operationId,
      guidance: 'result unknown: resolve by an independent readback of the original target first; never re-create the knowledge page (D06)',
    }), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ status: 'LAUNCHER_UNAVAILABLE', code: 'LAUNCHER_ENOENT', exitCode: null, reason: error.message });
    });
    child.stdin?.on('error', () => {
      if (settled) return;
      clearTimeout(timer);
      if (!sessionStage.createSent) {
        finish({ status: 'LAUNCHER_UNAVAILABLE', code: 'LAUNCHER_STDIN_UNAVAILABLE', exitCode: null });
        return;
      }
      const status = sessionStage.readSent ? 'READ_FAILED' : 'CREATE_FAILED';
      finish({ status, code: sessionStage.readSent ? 'MCP_READ_FAILED' : 'MCP_CREATE_FAILED',
        outcome: 'UNKNOWN', operationId: operation.operationId,
        guidance: 'result unknown: independently read the original target; never repeat create blindly' });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (sessionStage.createSent) {
        const status = sessionStage.readSent ? 'READ_FAILED' : 'CREATE_FAILED';
        finish({ status, code: sessionStage.readSent ? 'MCP_READ_FAILED' : 'MCP_CREATE_FAILED',
          outcome: 'UNKNOWN', operationId: operation.operationId, exitCode: code,
          guidance: 'result unknown: independently read the original target; never repeat create blindly' });
        return;
      }
      const reason = String(stderr ?? '').split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? `launcher exited ${code}`;
      finish({ status: 'LAUNCHER_UNAVAILABLE', code: 'LAUNCHER_EXIT_NONZERO', exitCode: code, reason });
    });
    // Process every complete frame already received before issuing the next
    // request; retain incomplete bytes until their frame can be classified.
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = Buffer.alloc(0);
    let scheduled = false;
    const failStage = (outOfOrder = false) => {
      clearTimeout(timer);
      const status = !sessionStage.createSent ? 'INITIALIZE_FAILED' : !sessionStage.readSent ? 'CREATE_FAILED' : 'READ_FAILED';
      const code = outOfOrder ? 'MCP_RESPONSE_OUT_OF_ORDER' : status === 'INITIALIZE_FAILED' ? 'MCP_INITIALIZE_FAILED' : status === 'CREATE_FAILED' ? 'MCP_CREATE_FAILED' : 'MCP_READ_FAILED';
      finish({ status, code, outcome: status === 'INITIALIZE_FAILED' ? 'NOT_STARTED' : 'UNKNOWN', operationId: operation.operationId,
        ...(status === 'INITIALIZE_FAILED' ? {} : { guidance: 'result unknown: independently read the original target; never repeat create blindly' }) });
    };
    const scheduleNext = () => {
      if (scheduled || !sessionStage.next || settled) return;
      scheduled = true;
      setImmediate(() => {
        scheduled = false;
        if (settled || !sessionStage.next || pending.length || child.stdout?.readableLength) return;
        const next = sessionStage.next;
        sessionStage.next = null;
        if (next === 'finish') {
          clearTimeout(timer);
          finish({ ...sessionStage.result, response: Buffer.concat(stdout).toString('utf8') });
          return;
        }
        let id;
        try { id = requestId(); } catch { failStage(true); return; }
        sessionStage.expectedId = id;
        if (next === 'create') {
          sessionStage.createSent = true;
          write(initializedNotification);
          write(createFrame(id));
        } else {
          sessionStage.readSent = true;
          write(readFrame(id));
        }
      });
    };
    child.stdout?.on('data', (chunk) => {
      if (settled) return;
      const bytes = Buffer.from(chunk);
      stdout.push(bytes);
      pending = Buffer.concat([pending, bytes]);
      let newline;
      while (!settled && (newline = pending.indexOf(10)) !== -1) {
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        let frame;
        try { frame = JSON.parse(decoder.decode(line)); } catch { failStage(true); return; }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame) || frame.jsonrpc !== '2.0') { failStage(true); return; }
        if (!Object.hasOwn(frame, 'id')) {
          if (typeof frame.method === 'string' && !Object.hasOwn(frame, 'result') && !Object.hasOwn(frame, 'error')) continue;
          failStage(true); return;
        }
        if (sessionStage.next || frame.id !== sessionStage.expectedId) { failStage(true); return; }
        const failed = Object.hasOwn(frame, 'error')
          || !frame.result || typeof frame.result !== 'object' || Array.isArray(frame.result)
          || (frame.result.isError !== undefined && frame.result.isError !== false);
        if (!sessionStage.createSent) {
          const ready = !failed && frame.result.protocolVersion === '2025-11-25'
            && frame.result.capabilities && typeof frame.result.capabilities === 'object' && !Array.isArray(frame.result.capabilities)
            && frame.result.serverInfo && typeof frame.result.serverInfo.name === 'string' && frame.result.serverInfo.name.length > 0
            && typeof frame.result.serverInfo.version === 'string' && frame.result.serverInfo.version.length > 0;
          if (!ready) { failStage(); return; }
          sessionStage.expectedId = null;
          sessionStage.next = 'create';
        } else if (!sessionStage.readSent) {
          if (failed || !Array.isArray(frame.result.content)) { failStage(); return; }
          sessionStage.createText = frame.result.content.map((item) => item?.text ?? '').join('\n');
          sessionStage.expectedId = null;
          sessionStage.next = 'read';
        } else {
          if (failed || !Array.isArray(frame.result.content)) { failStage(); return; }
          const readbackText = frame.result.content.map((item) => item?.text ?? '').join('\n');
          const readbackConsistent = readbackText.endsWith(candidate)
            && sha256Hex(readbackText.slice(readbackText.length - candidate.length)) === operation.contentDigest;
          sessionStage.result = { status: 'RESPONDED', operationId: operation.operationId, readbackRequestId: frame.id,
            createText: sessionStage.createText ?? null, readbackText, readbackConsistent };
          sessionStage.expectedId = null;
          sessionStage.next = 'finish';
        }
      }
      if (!pending.length) scheduleNext();
    });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
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
