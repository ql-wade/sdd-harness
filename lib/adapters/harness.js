// Managed driver layering for host adapters (task P1_3, work package 1.3.a;
// F05 plus the Runner.Dispatch.v1 binding). A driver is either
// 'managed-write' — an executor surface — or 'read-only' — an observer limited to status
// reads, artifact reads and probes. The frozen kind marker is the machine
// boundary: a read-only driver physically carries no execute surface, and
// requireWriteDriver refuses observers for product or test writes instead of
// letting an observer stand in for a write surface. The marker describes this
// component interface only; it does not qualify an issuer, current Native
// action, actual role/tool channels or OS isolation. Fixed host admission owns
// those separate checks; callers cannot turn a kind label into source trust.
//
// The runner composes a driver with the P2_2 trusted launcher
// (lib/delivery/evidence.js createLaunchAuthority, the local
// Runner.Dispatch.v1): dispatch binds run/gate/input/policy/attempt/epoch/
// execution under an HMAC integrity digest, admission reuses admitEvidence,
// and the runner interface has no phase write surface at all — it stores no
// phase, refuses phase fields in dispatch bindings, and never writes control
// state (Comet.Run.managedDelivery.v1: no second currentPhase; the phase
// belongs to the single Runtime state).
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseContract } from '../../contracts/delivery/index.js';
import { admitEvidence, envelopeDigest } from '../delivery/evidence.js';

export const DRIVER_KINDS = ['managed-write', 'read-only'];

const PHASE_FIELDS = ['phase', 'currentPhase', 'current_phase'];

export class HarnessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}

export function defineDriver({ id, kind, observe, execute }) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new HarnessError('DRIVER_ID_INVALID', 'defineDriver requires a non-empty driver id');
  }
  if (!DRIVER_KINDS.includes(kind)) {
    throw new HarnessError('DRIVER_KIND_INVALID', `driver ${id}: kind must be one of ${DRIVER_KINDS.join(', ')}; observed ${String(kind)}`);
  }
  if (kind === 'read-only') {
    if (execute !== undefined) {
      throw new HarnessError('DRIVER_SURFACE_REFUSED', `read-only driver ${id} cannot carry an execute surface; writes belong to the verified managed write executor (F05)`);
    }
    return Object.freeze({ id, kind, observe: observe ?? null, execute: undefined });
  }
  if (typeof execute !== 'function') {
    throw new HarnessError('DRIVER_SURFACE_REQUIRED', `managed-write driver ${id} must provide its managed execute surface; an unverified writer must not be registered as managed`);
  }
  return Object.freeze({ id, kind, observe: observe ?? null, execute });
}

export function requireWriteDriver(driver, purpose) {
  if (!driver || driver.kind !== 'managed-write') {
    throw new HarnessError(
      'DRIVER_WRITE_REFUSED',
      `driver ${driver?.id ?? '<none>'} is a ${driver?.kind ?? 'driverless'} observer; ${purpose ?? 'this write'} requires the verified managed write executor (F05)`,
    );
  }
  return driver;
}

export function createRunner({ authority, driver }) {
  requireWriteDriver(driver, 'a dispatching runner');
  if (!authority || typeof authority.issueDispatch !== 'function' || typeof authority.verifyDispatch !== 'function') {
    throw new HarnessError('RUNNER_AUTHORITY_INVALID', 'createRunner requires a trusted launch authority that issues and verifies dispatch records (Runner.Dispatch.v1)');
  }
  return Object.freeze({
    dispatch(binding) {
      if (binding && typeof binding === 'object') {
        for (const field of PHASE_FIELDS) {
          if (binding[field] !== undefined) {
            throw new HarnessError('RUNNER_PHASE_FIELD_REFUSED', `dispatch binding carries ${field}; the runner stores no phase and control state belongs to the single Runtime — there is no phase write surface on the runner`);
          }
        }
      }
      return authority.issueDispatch(binding);
    },
    verify(record) {
      return authority.verifyDispatch(record);
    },
    admit(args) {
      // The runner's own launch authority is the only registered source;
      // callers cannot substitute another authority (or none) at admission.
      return admitEvidence({ ...args, authority });
    },
  });
}

const NATIVE_SCOPE = Object.freeze({ scope: 'component/native-agent-transport', managedClosureEligible: false, runtimeQualified: false });
const NATIVE_ARGV = ['app-server', '--listen', 'stdio://'];
const NATIVE_FRAME = 256 * 1024, NATIVE_CAPTURE = 2 * 1024 * 1024;
const nativeObject = (v) => { try { return v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v)); } catch { return false; } };
const nativeText = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
const nativeKeys = (v, required, optional = []) => { try {
  if (!nativeObject(v)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
  return required.every((key) => Object.hasOwn(descriptors, key)) && keys.every((key) => typeof key === 'string'
    && [...required, ...optional].includes(key) && Object.hasOwn(descriptors[key], 'value'));
} catch { return false; } };
const nativeNo = (code) => { throw new HarnessError(code, `UNVERIFIED: ${code}`); };

function nativeData(value) {
  try {
    const seen = new Set();
    const walk = (v, depth) => {
      if (depth > 20) nativeNo('NATIVE_DATA_INVALID');
      if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
      if ((!Array.isArray(v) && !nativeObject(v)) || seen.has(v)) nativeNo('NATIVE_DATA_INVALID');
      seen.add(v);
      const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
      if (Array.isArray(v)) {
        if (v.length > 1024 || keys.some((key) => typeof key !== 'string' || key !== 'length'
          && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length))) nativeNo('NATIVE_DATA_INVALID');
        for (let i = 0; i < v.length; i++) { const entry = descriptors[i];
          if (!entry || !Object.hasOwn(entry, 'value')) nativeNo('NATIVE_DATA_INVALID'); walk(entry.value, depth + 1); }
      } else for (const key of keys) {
        if (typeof key !== 'string') nativeNo('NATIVE_DATA_INVALID'); const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, 'value')) nativeNo('NATIVE_DATA_INVALID'); walk(descriptor.value, depth + 1);
      }
      seen.delete(v);
    };
    walk(value, 0);
    if (Buffer.byteLength(JSON.stringify(value)) > NATIVE_FRAME) nativeNo('NATIVE_DATA_INVALID');
    return structuredClone(value);
  } catch { nativeNo('NATIVE_DATA_INVALID'); }
}

function nativeContext(value) {
  const v = nativeData(value);
  if (!nativeKeys(v, ['actionBinding', 'model', 'cwd', 'input', 'dynamicTools']) || !nativeText(v.model, 128)
    || !nativeText(v.cwd, 4096) || !path.isAbsolute(v.cwd) || !Array.isArray(v.input) || !v.input.length || v.input.length > 16
    || v.input.some((item) => !nativeKeys(item, ['type', 'text']) || item.type !== 'text' || typeof item.text !== 'string')
    || !Array.isArray(v.dynamicTools) || !v.dynamicTools.length || v.dynamicTools.length > 16) nativeNo('NATIVE_CONTEXT_INVALID');
  const parsed = parseContract('SDD.Delivery.ActionBinding', v.actionBinding);
  if (!parsed.ok || parsed.value.profile !== 'comet-managed-v2' || parsed.value.runnerId !== 'comet-classic') nativeNo('NATIVE_CONTEXT_INVALID');
  const names = new Set();
  for (const tool of v.dynamicTools) {
    if (!nativeKeys(tool, ['type', 'name', 'description', 'inputSchema']) || tool.type !== 'function'
      || typeof tool.name !== 'string' || !/^[-A-Za-z0-9_]{1,64}$/.test(tool.name) || names.has(tool.name)
      || typeof tool.description !== 'string' || !nativeObject(tool.inputSchema) || tool.inputSchema.type !== 'object'
      || !parsed.value.allowedTools.includes(tool.name)) nativeNo('NATIVE_CONTEXT_INVALID');
    names.add(tool.name);
  }
  return { ...v, actionBinding: parsed.value };
}

// JSON.parse supplies grammar validation; this bounded walk additionally rejects
// duplicate decoded keys instead of silently accepting a different correlation.
function nativeMessage(bytes) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(source), stack = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      const start = i;
      while (++i < source.length) { if (source[i] === '\\') i++; else if (source[i] === '"') break; }
      const top = stack.at(-1);
      if (top?.keys && top.expectKey) {
        const key = JSON.parse(source.slice(start, i + 1));
        if (top.keys.has(key)) nativeNo('NATIVE_MESSAGE_INVALID');
        top.keys.add(key); top.expectKey = false;
      }
    } else if (c === '{' || c === '[') stack.push(c === '{' ? { keys: new Set(), expectKey: true } : {});
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',' && stack.at(-1)?.keys) stack.at(-1).expectKey = true;
  }
  return nativeData(value);
}

// Fixed CODE composition for one0.163 stdio connection. These callbacks and
// field shapes are not an authenticated provider or proof of tool isolation.
export function createCodexStdioTransport(options) {
  if (!nativeKeys(options, ['registration', 'context', 'currentContext', 'invokeTool'])) nativeNo('NATIVE_OPTIONS_INVALID');
  const registration = nativeData(options.registration);
  if (!nativeKeys(registration, ['executable', 'sha256', 'argv', 'env', 'timeoutMs'])
    || !nativeText(registration.executable, 4096) || !path.isAbsolute(registration.executable)
    || typeof registration.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(registration.sha256)
    || !Array.isArray(registration.argv) || JSON.stringify(registration.argv) !== JSON.stringify(NATIVE_ARGV)
    || !nativeObject(registration.env) || Object.entries(registration.env).some(([key, value]) => !['PATH', 'LANG', 'TZ', 'TMPDIR'].includes(key)
      || typeof value !== 'string' || value.length > 8192 || value.includes('\0'))
    || !Number.isSafeInteger(registration.timeoutMs) || registration.timeoutMs < 10 || registration.timeoutMs > 900000) nativeNo('NATIVE_REGISTRATION_INVALID');
  let synchronous = false;
  try { synchronous = typeof options.currentContext === 'function'
    && !['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(options.currentContext.constructor?.name); } catch { /* Invalid CODE callback. */ }
  if (!synchronous || typeof options.invokeTool !== 'function') nativeNo('NATIVE_CALLBACK_REQUIRED');
  const fixed = nativeContext(options.context), contextDigest = envelopeDigest(fixed), registrationDigest = envelopeDigest(registration);
  const readCurrent = options.currentContext, invokeTool = options.invokeTool;
  const tools = new Set(fixed.dynamicTools.map((tool) => tool.name));
  const current = () => { try { if (envelopeDigest(nativeContext(readCurrent())) !== contextDigest) nativeNo('NATIVE_CONTEXT_STALE'); }
    catch { nativeNo('NATIVE_CONTEXT_STALE'); } };
  // No model credentials or preload/provider overrides enter this environment.
  // Existing HOME/CODEX_HOME are inherited unchanged, not selected by a job.
  const environment = { ...registration.env, ...Object.fromEntries(['HOME', 'CODEX_HOME'].filter((key) => typeof process.env[key] === 'string').map((key) => [key, process.env[key]])) };
  let operation, child, state = 'NOT_STARTED', reason = null, deadline, forceTimer, startFailure = null;
  let threadId = null, turnId = null, turnStatus = null, threadNotice = null, turnNotice = null, complete = false;
  let ended = false, exitCode = null, signal = null, truncated = false, pendingBytes = Buffer.alloc(0), rawSize = 0;
  const raw = { stdin: [], stdout: [], stderr: [] }, events = [], pending = new Map(), calls = new Map(), requestIds = new Map(), earlyCalls = [];
  const abort = new AbortController(); let resolveDone, resolveClosed, doneSettled = false;
  const snapshot = () => ({ ...NATIVE_SCOPE, status: state, reason, handle: operation?.handle ?? null, contextDigest,
    registrationDigest, threadId, turnId, turnStatus, protocolComplete: complete, truncated,
    process: { pid: child?.pid ?? null, exitCode, signal, closed: ended },
    raw: Object.fromEntries(Object.entries(raw).map(([key, chunks]) => [key, Buffer.concat(chunks)])), events: structuredClone(events) });
  const done = () => { if (!doneSettled) { doneSettled = true; resolveDone(snapshot()); } };
  const unknown = (code) => { if (state !== 'UNKNOWN') { state = 'UNKNOWN'; reason = code; } done(); };
  const capture = (channel, bytes) => {
    const remaining = Math.max(0, NATIVE_CAPTURE - rawSize);
    raw[channel].push(Buffer.from(bytes.subarray(0, remaining))); rawSize += Math.min(bytes.length, remaining);
    if (bytes.length > remaining) { truncated = true; unknown('NATIVE_CAPTURE_LIMIT'); return false; } return true;
  };
  const write = (message) => {
    if (ended || state === 'UNKNOWN') return;
    const bytes = Buffer.from(JSON.stringify(message) + '\n');
    if (bytes.length > NATIVE_FRAME || !capture('stdin', bytes)) { unknown('NATIVE_FRAME_LIMIT'); return; }
    try { child.stdin.write(bytes, (error) => { if (error) unknown('NATIVE_STDIN_UNAVAILABLE'); }); }
    catch { unknown('NATIVE_STDIN_UNAVAILABLE'); }
  };
  const request = (id, method, params) => { current(); pending.set(id, method); write({ id, method, params }); };
  const deny = (id, code) => { if (id !== undefined) write({ id, error: { code: -32601, message: 'REQUEST_REFUSED' } }); unknown(code); };
  const boundThread = (id) => {
    if (!nativeText(id) || !threadId && !pending.has('comet:thread') || (threadId ?? threadNotice) && (threadId ?? threadNotice) !== id) return false;
    if (!threadNotice) threadNotice = id; return true;
  };
  const boundTurn = (params) => {
    if (!nativeObject(params) || !boundThread(params.threadId) || !nativeText(params.turnId)
      || !turnId && !pending.has('comet:turn') || (turnId ?? turnNotice) && (turnId ?? turnNotice) !== params.turnId) return false;
    if (!turnNotice) turnNotice = params.turnId; return true;
  };
  const count = (v) => Number.isSafeInteger(v) && v >= 0;
  const boundedString = (v, bytes = 64 * 1024) => typeof v === 'string' && Buffer.byteLength(v) <= bytes;
  const usage = (v) => nativeKeys(v, ['cachedInputTokens', 'inputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'], ['cacheWriteInputTokens'])
    && Object.values(v).every(count);
  const ordinary = (method, p) => {
    if (method === 'thread/status/changed') {
      if (!nativeKeys(p, ['threadId', 'status']) || !boundThread(p.threadId) || !nativeObject(p.status)) return false;
      return p.status.type === 'active'
        ? nativeKeys(p.status, ['type', 'activeFlags']) && Array.isArray(p.status.activeFlags) && p.status.activeFlags.length <= 2
          && p.status.activeFlags.every((flag) => ['waitingOnApproval', 'waitingOnUserInput'].includes(flag))
        : nativeKeys(p.status, ['type']) && ['notLoaded', 'idle', 'systemError'].includes(p.status.type);
    }
    if (!boundTurn(p)) return false;
    if (method === 'thread/tokenUsage/updated') return nativeKeys(p, ['threadId', 'turnId', 'tokenUsage'])
      && nativeKeys(p.tokenUsage, ['last', 'total'], ['modelContextWindow']) && usage(p.tokenUsage.last) && usage(p.tokenUsage.total)
      && (p.tokenUsage.modelContextWindow === undefined || p.tokenUsage.modelContextWindow === null || count(p.tokenUsage.modelContextWindow));
    if (method === 'item/reasoning/summaryPartAdded') return nativeKeys(p, ['threadId', 'turnId', 'itemId', 'summaryIndex'])
      && nativeText(p.itemId) && count(p.summaryIndex);
    if (method === 'turn/diff/updated') return nativeKeys(p, ['threadId', 'turnId', 'diff']) && boundedString(p.diff);
    return method === 'turn/plan/updated' && nativeKeys(p, ['threadId', 'turnId', 'plan'], ['explanation'])
      && (p.explanation === undefined || p.explanation === null || boundedString(p.explanation)) && Array.isArray(p.plan) && p.plan.length <= 64
      && p.plan.every((step) => nativeKeys(step, ['step', 'status']) && boundedString(step.step, 4096) && ['pending', 'inProgress', 'completed'].includes(step.status));
  };
  const rpcId = (id) => nativeText(id) || Number.isSafeInteger(id);
  const toolCall = (message) => {
    const p = message.params;
    if (complete || !nativeKeys(p, ['arguments', 'callId', 'threadId', 'tool', 'turnId'], ['namespace']) || !boundTurn(p)
      || !nativeText(p.callId) || !nativeObject(p.arguments) || !tools.has(p.tool) || p.namespace !== undefined && p.namespace !== null) return deny(message.id, 'NATIVE_TOOL_REFUSED');
    // Only protocol reordering is buffered. No callback runs before the native
    // turn response confirms the provisional ids; no work is scheduled here.
    if (!turnId) { if (earlyCalls.length >= 4) return deny(message.id, 'NATIVE_TOOL_LIMIT'); earlyCalls.push(message); return; }
    current();
    const digest = envelopeDigest(p), previous = calls.get(p.callId);
    if (requestIds.has(message.id) && requestIds.get(message.id) !== p.callId) return deny(message.id, 'NATIVE_TOOL_ID_REUSED');
    if (previous) {
      if (previous.digest !== digest || previous.id !== message.id || previous.responded) return deny(message.id, 'NATIVE_TOOL_REPLAY_REFUSED');
      return; // An exact in-flight duplicate never executes the callback again.
    }
    if (calls.size >= 64 || [...calls.values()].filter((entry) => !entry.responded).length >= 4) return deny(message.id, 'NATIVE_TOOL_LIMIT');
    const entry = { id: message.id, digest, responded: false }; calls.set(p.callId, entry); requestIds.set(message.id, p.callId);
    const action = fixed.actionBinding;
    Promise.resolve().then(() => {
      if (state === 'UNKNOWN' || ended) return null;
      current();
      return invokeTool({ run: action.run, execution: action.execution, threadId, turnId, callId: p.callId,
        tool: p.tool, arguments: structuredClone(p.arguments), actionBinding: structuredClone(action), contextDigest,
        requestDigest: envelopeDigest({ contextDigest, params: p }) }, { signal: abort.signal });
    }).then((result) => {
      if (state === 'UNKNOWN' || ended) return;
      current(); const value = nativeData(result);
      if (!nativeKeys(value, ['contentItems', 'success']) || typeof value.success !== 'boolean' || !Array.isArray(value.contentItems)
        || value.contentItems.length > 16 || value.contentItems.some((item) => !nativeKeys(item, ['type', 'text']) || item.type !== 'inputText' || typeof item.text !== 'string')
        || Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) return deny(message.id, 'NATIVE_TOOL_RESULT_INVALID');
      entry.responded = true; write({ id: message.id, result: value });
    }).catch(() => deny(message.id, 'NATIVE_TOOL_SOURCE_UNVERIFIED'));
  };
  const message = (m) => {
    if (!nativeObject(m) || m.jsonrpc !== undefined && m.jsonrpc !== '2.0') return unknown('NATIVE_MESSAGE_INVALID');
    if (Object.hasOwn(m, 'method')) {
      if (!nativeKeys(m, ['method', 'params'], ['id', 'jsonrpc']) || !nativeText(m.method)) return unknown('NATIVE_MESSAGE_INVALID');
      if (Object.hasOwn(m, 'id')) {
        if (!rpcId(m.id)) return unknown('NATIVE_MESSAGE_INVALID');
        if (m.method !== 'item/tool/call') return deny(m.id, 'NATIVE_SERVER_REQUEST_REFUSED');
        return toolCall(m);
      }
      const p = m.params;
      if (m.method === 'thread/started') {
        if (!nativeKeys(p, ['thread']) || !nativeObject(p.thread) || !boundThread(p.thread.id)) return unknown('NATIVE_THREAD_MISMATCH'); return;
      }
      if (m.method === 'turn/started' || m.method === 'turn/completed') {
        if (!nativeKeys(p, ['threadId', 'turn']) || !nativeObject(p.turn) || !boundTurn({ threadId: p.threadId, turnId: p.turn.id })) return unknown('NATIVE_TURN_MISMATCH');
        if (m.method === 'turn/started') { if (p.turn.status !== 'inProgress') unknown('NATIVE_TURN_MISMATCH'); return; }
        if (!turnId || complete || !['completed', 'failed', 'interrupted'].includes(p.turn.status)
          || [...calls.values()].some((entry) => !entry.responded)) return unknown('NATIVE_TURN_INCOMPLETE');
        current(); complete = true; turnStatus = p.turn.status; child.stdin.end(); return;
      }
      if (['item/started', 'item/completed'].includes(m.method)) {
        const clock = m.method === 'item/started' ? 'startedAtMs' : 'completedAtMs';
        if (!nativeKeys(p, ['threadId', 'turnId', 'item', clock]) || !boundTurn(p) || !count(p[clock]) || !nativeObject(p.item) || !nativeText(p.item.id)
          || !['userMessage', 'agentMessage', 'reasoning', 'plan', 'dynamicToolCall'].includes(p.item.type)
          || p.item.type === 'dynamicToolCall' && !tools.has(p.item.tool)) return unknown('NATIVE_BUILTIN_TOOL_OBSERVED');
        return;
      }
      if (['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/reasoning/textDelta', 'item/plan/delta'].includes(m.method)) {
        const extra = m.method === 'item/reasoning/summaryTextDelta' ? ['summaryIndex'] : m.method === 'item/reasoning/textDelta' ? ['contentIndex'] : [];
        if (!nativeKeys(p, ['threadId', 'turnId', 'itemId', 'delta', ...extra]) || !boundTurn(p) || !nativeText(p.itemId)
          || !boundedString(p.delta) || extra.some((key) => !count(p[key]))) return unknown('NATIVE_TURN_MISMATCH'); return;
      }
      if (['thread/status/changed', 'thread/tokenUsage/updated', 'item/reasoning/summaryPartAdded', 'turn/diff/updated', 'turn/plan/updated'].includes(m.method)) {
        if (!ordinary(m.method, p)) unknown('NATIVE_NOTIFICATION_INVALID'); return;
      }
      return unknown('NATIVE_NOTIFICATION_REFUSED');
    }
    if (!nativeKeys(m, ['id'], ['result', 'error', 'jsonrpc']) || !pending.has(m.id)
      || Object.hasOwn(m, 'result') === Object.hasOwn(m, 'error')) return unknown('NATIVE_RESPONSE_MISMATCH');
    const method = pending.get(m.id); pending.delete(m.id);
    if (Object.hasOwn(m, 'error') || !nativeObject(m.result)) return unknown('NATIVE_RPC_ERROR');
    if (method === 'initialize') {
      current(); write({ method: 'initialized', params: {} });
      request('comet:thread', 'thread/start', { model: fixed.model, cwd: fixed.cwd, environments: [], dynamicTools: fixed.dynamicTools,
        ephemeral: true, approvalPolicy: 'untrusted', sandbox: 'read-only' });
    } else if (method === 'thread/start') {
      if (!nativeText(m.result.thread?.id) || threadNotice && threadNotice !== m.result.thread.id) return unknown('NATIVE_THREAD_MISMATCH');
      threadId = m.result.thread.id;
      request('comet:turn', 'turn/start', { threadId, input: fixed.input, model: fixed.model, cwd: fixed.cwd, environments: [], approvalPolicy: 'untrusted' });
    } else {
      if (!nativeText(m.result.turn?.id) || turnNotice && turnNotice !== m.result.turn.id || m.result.turn.status !== 'inProgress') return unknown('NATIVE_TURN_MISMATCH');
      turnId = m.result.turn.id; state = 'TURN_ACTIVE';
      for (const entry of earlyCalls.splice(0)) { if (state === 'UNKNOWN') break; toolCall(entry); }
    }
  };
  const receive = (bytes) => {
    if (!capture('stdout', bytes)) { child.stdout.destroy(); return; }
    if (state === 'UNKNOWN') return;
    pendingBytes = Buffer.concat([pendingBytes, bytes]);
    let newline;
    while ((newline = pendingBytes.indexOf(10)) >= 0 && state !== 'UNKNOWN') {
      const line = pendingBytes.subarray(0, newline); pendingBytes = pendingBytes.subarray(newline + 1);
      if (!line.length || line.length > NATIVE_FRAME || events.length >= 512) { unknown('NATIVE_FRAME_LIMIT'); break; }
      try { const value = nativeMessage(line); events.push(value); message(value); }
      catch { unknown('NATIVE_MESSAGE_OR_CONTEXT_UNVERIFIED'); }
    }
    if (pendingBytes.length > NATIVE_FRAME) unknown('NATIVE_FRAME_LIMIT');
  };
  const requireHandle = (handle) => { if (!operation || handle !== operation.handle) nativeNo('NATIVE_HANDLE_REQUIRED'); };
  return Object.freeze({ ...NATIVE_SCOPE,
    start(...args) {
      if (args.length) nativeNo('NATIVE_START_ARGUMENTS_REFUSED');
      if (operation) return operation;
      if (startFailure) nativeNo(startFailure);
      try { current(); } catch { startFailure = 'NATIVE_CONTEXT_STALE'; nativeNo(startFailure); }
      try {
        const stat = fs.lstatSync(registration.executable);
        if (!stat.isFile() || !(stat.mode & 0o111) || createHash('sha256').update(fs.readFileSync(registration.executable)).digest('hex') !== registration.sha256) nativeNo('NATIVE_BINARY_UNVERIFIED');
      } catch { startFailure = 'NATIVE_BINARY_UNVERIFIED'; nativeNo(startFailure); }
      if (process.platform === 'win32') { startFailure = 'NATIVE_PROCESS_GROUP_UNQUALIFIED'; nativeNo(startFailure); }
      state = 'INITIALIZING';
      const donePromise = new Promise((resolve) => { resolveDone = resolve; }), closed = new Promise((resolve) => { resolveClosed = resolve; });
      child = spawn(registration.executable, registration.argv, { cwd: fixed.cwd, env: environment, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
      const handle = Object.freeze({ id: randomUUID(), run: fixed.actionBinding.run, execution: fixed.actionBinding.execution, processId: child.pid ?? null, contextDigest });
      operation = Object.freeze({ ...NATIVE_SCOPE, handle, done: donePromise, closed });
      deadline = setTimeout(() => unknown('NATIVE_TIMEOUT_UNKNOWN'), registration.timeoutMs); deadline.unref();
      child.stdin.on('error', () => unknown('NATIVE_STDIN_UNAVAILABLE'));
      child.stdout.on('data', receive); child.stderr.on('data', (bytes) => { if (!capture('stderr', bytes)) child.stderr.destroy(); });
      child.stdout.on('error', () => unknown('NATIVE_STDOUT_UNAVAILABLE'));
      child.stderr.on('error', () => unknown('NATIVE_STDERR_UNAVAILABLE'));
      child.stdout.on('end', () => { if (pendingBytes.length || !complete) unknown('NATIVE_EOF_UNKNOWN'); });
      child.once('error', () => unknown('NATIVE_SPAWN_UNKNOWN'));
      child.once('spawn', () => { try { request('comet:init', 'initialize', { clientInfo: { name: 'sdd-comet-transport', version: '1' }, capabilities: { experimentalApi: true } }); }
        catch { unknown('NATIVE_CONTEXT_STALE'); } });
      child.once('close', (code, sig) => {
        ended = true; exitCode = code; signal = sig; clearTimeout(deadline); clearTimeout(forceTimer);
        try { current(); } catch { unknown('NATIVE_CONTEXT_STALE'); }
        if (!complete || code !== 0 || sig || [...calls.values()].some((entry) => !entry.responded)) unknown('NATIVE_EXIT_UNVERIFIED');
        else if (state !== 'UNKNOWN') { state = 'OBSERVED_TERMINAL'; done(); }
        resolveClosed(snapshot());
      });
      return operation;
    },
    observe(handle) { requireHandle(handle); return snapshot(); },
    cancel(handle) {
      requireHandle(handle); if (ended) return snapshot();
      unknown('NATIVE_CANCEL_REQUESTED'); abort.abort();
      const kill = (sig) => { if (!ended && child.pid) { try { process.kill(-child.pid, sig); } catch { /* Unknown remains unknown until the actual close event. */ } } };
      kill('SIGTERM'); if (!forceTimer) { forceTimer = setTimeout(() => kill('SIGKILL'), 500); forceTimer.unref(); }
      return snapshot();
    },
  });
}
