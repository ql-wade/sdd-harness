#!/usr/bin/env node
// DeliveryControl.EnablementGate.v2 — F10 conditional-enablement gate for the
// CROSS_MACHINE scope (rework tasks.md P5_2, precondition
// CROSS_MACHINE_SCOPE_NOT_ENABLED; 条件性启用门).
//
// Supersedes the old-run paired-digest guard (DeliveryControl.ScopeGate.v1,
// commit bcc1afa): v2 binds enablement to a resolvable user adjudication
// record instead of a code-anchored digest — same-source with the P5_1
// machine matrix rule (team-host-matrix/matrix.json machine_dimension
// enablement_gate: enabled=true 当且仅当存在可解析的明确启用裁决; the wildcard
// host is default-deny with refuse_start/refuse_release NOT_ENABLED).
//
// Fail-closed contract (exit 0 = valid status readback only; 1 = invalid
// input; 2 = denial, house convention cf. tools/infra/backup-restore.mjs):
//   enabled=false                        -> start/release/implement DENIED
//                                           (CROSS_MACHINE_SCOPE_NOT_ENABLED);
//   enabled=true, decision_record=null   -> DENIED (ENABLEMENT_DECISION_RECORD_
//                                           REQUIRED — no hand-edit bypass);
//   decision_record does not resolve to an open_decisions adjudication entry
//   (id absent / entry OPEN / not an enablement decision / not decided by the
//   user / source outside the repo) -> DENIED (ENABLEMENT_DECISION_RECORD_
//                                           UNRESOLVED);
//   gate file unparseable, schema-broken, refuse semantics stripped, or
//   claiming a pass-like F10 state while not enabled -> everything DENIED
//                                           (GATE_FILE_FAIL_CLOSED — even the
//                                           status readback);
//   an adjudication that fully resolves still cannot open this build: the
//   service body is not constructed (ENABLED_CONSTRUCTION_PENDING).
// Environment variables are never consulted for the scope decision; a runtime
// `enable` record is digested as evidence and never trusted — opening the gate
// is a user adjudication registered by the control plane, landed as a paired
// commit on enablement.json (configVersion consistency lesson: no boolean
// flag, no TOCTOU).
//
// F10 pinning: while enabled=false the effective F10 state is
// UNVERIFIED_NOT_ENABLED and can never be reported in a pass position; a file
// claiming otherwise is schema-poison and fails closed. Positive
// cross-machine construction (project isolation, credential revocation,
// restore-time re-auth, API-disconnect cached-green denial) is NOT built and
// stays UNVERIFIED — "not enabled" never counts as F10 pass.
//
// Receipts are host-path free: requests/records enter as sha256 digests,
// never paths. The refusal receipt printed on stdout is the trace of every
// denial (留痕).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_DENY = 2;

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const DEFAULT_ENABLEMENT_FILE = path.join(here, 'enablement.json');

const GATE_ACTIONS = ['start', 'release', 'implement'];
const REFUSE_REQUIRED = [...GATE_ACTIONS];
const F10_NOT_ENABLED = 'UNVERIFIED_NOT_ENABLED';
const F10_ENABLED_PENDING = 'UNVERIFIED_ENABLED_CONSTRUCTION_PENDING';
const F10_ALLOWED = new Set([F10_NOT_ENABLED, F10_ENABLED_PENDING]);
const GATE_KEYS = new Set([
  'schemaVersion', 'service', 'interface', 'scope', 'enabled', 'decision_record',
  'refuse', 'f10_state', 'semantics_source', 'construction',
  'positive_auth_holder', 'future_enablement',
]);
const ENABLEMENT_DECISION = 'ENABLE_CROSS_MACHINE_SCOPE';
const ENABLEMENT_SOURCE_DEFAULT =
  'openspec/changes/delivery-foundation-rearchitecture/execution-state.json';

const POSITIVE_AUTH_HOLDER =
  'P5_2 owner + 用户跨机器范围裁决（正向隔离/撤权/备份恢复/API 断联认证未建设，保留 UNVERIFIED；不能以未启用判 F10 通过）';

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

// ------------------------------------------------------------ validation ---
// Steps 1-3 of the decision pipeline: parse + schema + state coherence. A
// violation poisons every command including the status readback.
function validateGateFile(raw) {
  let gate;
  try {
    gate = JSON.parse(raw);
  } catch (err) {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: `gate file is not valid JSON: ${err.message}` };
  }
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: 'gate file is not a JSON object' };
  }
  const unknown = Object.keys(gate).filter((k) => !GATE_KEYS.has(k));
  if (unknown.length > 0) {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: `unknown gate file keys: ${unknown.join(', ')}` };
  }
  if (gate.schemaVersion !== 2 || gate.service !== 'delivery-control' || gate.scope !== 'CROSS_MACHINE') {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: 'gate file must declare schemaVersion 2 / service delivery-control / scope CROSS_MACHINE' };
  }
  if (typeof gate.enabled !== 'boolean') {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: 'enabled must be a boolean' };
  }
  if (!Array.isArray(gate.refuse)) {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: 'refuse must be an array' };
  }
  if (typeof gate.f10_state !== 'string') {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: 'f10_state must be a string' };
  }
  // pass-like states are poison in any position: F10 is pinned to UNVERIFIED_*
  // in this delivery
  if (!F10_ALLOWED.has(gate.f10_state)) {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: `f10_state "${gate.f10_state}" is not an allowed state (${[...F10_ALLOWED].join(' | ')}); a pass-like claim under this delivery fails closed` };
  }
  const expectedState = gate.enabled ? F10_ENABLED_PENDING : F10_NOT_ENABLED;
  if (gate.f10_state !== expectedState) {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: `enabled=${gate.enabled} requires f10_state ${expectedState}, found "${gate.f10_state}"` };
  }
  if (gate.decision_record !== null && (typeof gate.decision_record !== 'object' || Array.isArray(gate.decision_record))) {
    return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: 'decision_record must be null or an adjudication pointer object' };
  }
  if (!gate.enabled) {
    const missing = REFUSE_REQUIRED.filter((a) => !gate.refuse.includes(a));
    if (missing.length > 0) {
      return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: `refuse semantics stripped (missing: ${missing.join(', ')}) — default-deny fails closed` };
    }
    if (gate.decision_record !== null) {
      return { ok: false, code: 'GATE_FILE_FAIL_CLOSED', reason: 'decision_record must be null while disabled (an adjudication pointer without enablement is incoherent)' };
    }
  }
  return { ok: true, gate };
}

// Step 5: resolve the adjudication pointer. The record must point, inside the
// repo, at an execution-state.json open_decisions entry that carries the
// cross-machine enablement decision, decided by the user, and no longer open.
function resolveDecisionRecord(record, root = projectRoot) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_REQUIRED', reason: 'enabled=true requires a decision_record adjudication pointer ({source, decision_id})' };
  }
  const { source, decision_id: decisionId } = record;
  if (typeof source !== 'string' || source.length === 0 || typeof decisionId !== 'string' || decisionId.length === 0) {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_REQUIRED', reason: 'decision_record must carry non-empty source and decision_id strings' };
  }
  if (path.isAbsolute(source) || source.split('/').includes('..')) {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', reason: `decision_record.source escapes the repo: ${source}` };
  }
  const resolved = path.resolve(root, source);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', reason: 'decision_record.source resolves outside the repo' };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', reason: `decision_record.source cannot be read or parsed: ${err.message}` };
  }
  const entry = (Array.isArray(parsed?.open_decisions) ? parsed.open_decisions : []).find((d) => d && d.id === decisionId);
  if (!entry) {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', reason: `decision_id "${decisionId}" is not registered in open_decisions` };
  }
  if (entry.status === 'OPEN') {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', reason: `decision_id "${decisionId}" is still an OPEN question, not an adjudication` };
  }
  if (entry.decision !== ENABLEMENT_DECISION) {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', reason: `decision_id "${decisionId}" does not carry decision=${ENABLEMENT_DECISION}` };
  }
  if (entry.decided_by !== 'user') {
    return { ok: false, code: 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', reason: `decision_id "${decisionId}" is not decided_by the user` };
  }
  return { ok: true, entry };
}

// ------------------------------------------------------------ cli plumbing --
function parseArgs(argv) {
  const opts = { command: argv[0], request: null, record: null, enablementFile: null, json: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--request') opts.request = argv[++i];
    else if (arg === '--record') opts.record = argv[++i];
    else if (arg === '--enablement-file') opts.enablementFile = argv[++i];
    else return { error: `unknown argument: ${arg}` };
  }
  return opts;
}

function readJsonFile(file, label) {
  if (!file) return { error: `${label} file is required (use --${label} <file>)` };
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch {
    return { error: `${label} file cannot be read: ${file}` };
  }
  try {
    return { value: JSON.parse(raw), raw };
  } catch (err) {
    return { error: `${label} file is not valid JSON: ${err.message}` };
  }
}

function usage() {
  return [
    'usage:',
    '  gate.mjs status    [--enablement-file <file>] [--json]',
    '  gate.mjs start     --request <file> [--enablement-file <file>] [--json]',
    '  gate.mjs release   --request <file> [--enablement-file <file>] [--json]',
    '  gate.mjs implement --request <file> [--enablement-file <file>] [--json]',
    '  gate.mjs enable    --record <file> [--enablement-file <file>] [--json]',
    '',
    'exit codes: 0 = valid status readback, 1 = invalid input, 2 = denial',
  ].join('\n');
}

function inputError(message) {
  process.stderr.write(`delivery-control-gate: ERROR ${message}\n`);
  process.exit(EXIT_INPUT);
}

function baseReceipt(command, gate) {
  return {
    interface: 'DeliveryControl.EnablementGate.v2',
    command,
    at: new Date().toISOString(),
    scope: gate?.scope ?? null,
    enabled: gate?.enabled ?? null,
    refuse: gate?.refuse ?? null,
  };
}

function deny(code, reason, { json, body }) {
  process.stderr.write(`delivery-control-gate: DENIED ${code} — ${reason}\n`);
  // the refusal receipt is the trace (留痕): always emitted on stdout,
  // pretty-printed with --json
  process.stdout.write(`${JSON.stringify(body, null, json ? 2 : 0)}\n`);
  process.exit(EXIT_DENY);
}

function loadGate(opts) {
  const file = opts.enablementFile ?? DEFAULT_ENABLEMENT_FILE;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { fail: `gate file cannot be read (${path.relative(projectRoot, file) || file}): ${err.message}` };
  }
  const verdict = validateGateFile(raw);
  return verdict.ok ? { gate: verdict.gate } : { fail: verdict.reason, code: verdict.code };
}

function receiptFor(command, gate, refusals, extra = {}) {
  return {
    ...baseReceipt(command, gate),
    status: 'DENIED',
    f10State: gate ? gate.f10_state : null,
    positiveAuthStatus: 'UNVERIFIED',
    positiveAuthHolder: POSITIVE_AUTH_HOLDER,
    refusals,
    ...extra,
  };
}

// Action decision pipeline (fail-closed, in order): file poison -> refusal
// semantics -> disabled -> adjudication pointer. Even a fully resolved
// adjudication stays denied: this build constructs no service body.
function decideAction(command, opts) {
  const request = readJsonFile(opts.request, 'request');
  if (request.error) inputError(request.error);
  const requestDigest = sha256Hex(request.raw);

  const loaded = loadGate(opts);
  if (loaded.fail) {
    deny(loaded.code ?? 'GATE_FILE_FAIL_CLOSED', loaded.fail, {
      json: opts.json,
      body: receiptFor(command, null, [{ code: loaded.code ?? 'GATE_FILE_FAIL_CLOSED', reason: loaded.fail }], { requestDigest }),
    });
  }
  const gate = loaded.gate;

  if (!gate.enabled) {
    const code = 'CROSS_MACHINE_SCOPE_NOT_ENABLED';
    const reason = 'cross-machine scope is not enabled: team control start/release/implement is gated until the user explicitly adjudicates the cross-machine scope (tasks.md P5_2 前置; P5_1 matrix wildcard host default-deny)';
    deny(code, reason, { json: opts.json, body: receiptFor(command, gate, [{ code, reason }], { requestDigest }) });
  }

  if (!gate.decision_record) {
    const code = 'ENABLEMENT_DECISION_RECORD_REQUIRED';
    const reason = 'enabled=true without a decision_record: opening the gate requires an adjudication pointer ({source, decision_id}) into the registered open_decisions — a hand-edited enabled flag cannot bypass the user decision';
    deny(code, reason, { json: opts.json, body: receiptFor(command, gate, [{ code, reason }], { requestDigest }) });
  }

  const verdict = resolveDecisionRecord(gate.decision_record);
  if (!verdict.ok) {
    deny(verdict.code, verdict.reason, { json: opts.json, body: receiptFor(command, gate, [{ code: verdict.code, reason: verdict.reason }], { requestDigest }) });
  }

  const code = 'ENABLED_CONSTRUCTION_PENDING';
  const reason = 'the adjudication resolves, but this delivery constructs no service body: rebuild services/delivery-control per tasks.md 5.2.a (RED-first positive isolation/revocation/restore/API-disconnect auth) before any team capability is claimed';
  deny(code, reason, {
    json: opts.json,
    body: receiptFor(command, gate, [{ code, reason }], {
      requestDigest,
      decisionRecord: { decision_id: gate.decision_record.decision_id, source: gate.decision_record.source, resolved: true },
    }),
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) inputError(`${opts.error}\n${usage()}`);
  if (!['status', ...GATE_ACTIONS, 'enable'].includes(opts.command)) {
    inputError(`unknown command: ${opts.command}\n${usage()}`);
  }

  if (opts.command === 'enable') {
    // A caller-supplied record is digested as evidence, never trusted as
    // approval (caller-supplied identity is not review). Registration happens
    // in the control plane, landed as a paired commit on enablement.json.
    const record = readJsonFile(opts.record, 'record');
    if (record.error) inputError(record.error);
    const code = 'ENABLEMENT_REQUIRES_REGISTERED_DECISION';
    const reason = 'opening the cross-machine scope requires the user adjudication registered in open_decisions and a paired commit on enablement.json (enabled + decision_record + f10_state together); a runtime record cannot flip the gate';
    deny(code, reason, {
      json: opts.json,
      body: {
        ...baseReceipt('enable', null),
        status: 'DENIED',
        recordTrusted: false,
        recordDigest: sha256Hex(record.raw),
        refusals: [{ code, reason }],
      },
    });
  }

  if (opts.command === 'status') {
    const loaded = loadGate(opts);
    if (loaded.fail) {
      deny(loaded.code ?? 'GATE_FILE_FAIL_CLOSED', loaded.fail, {
        json: opts.json,
        body: receiptFor('status', null, [{ code: loaded.code ?? 'GATE_FILE_FAIL_CLOSED', reason: loaded.fail }]),
      });
    }
    const gate = loaded.gate;
    let decisionRecord = { present: false, resolution: 'NONE' };
    if (gate.enabled) {
      const verdict = resolveDecisionRecord(gate.decision_record);
      decisionRecord = verdict.ok
        ? { present: true, decision_id: gate.decision_record.decision_id, resolution: 'RESOLVED' }
        : { present: true, decision_id: gate.decision_record?.decision_id ?? null, resolution: 'UNRESOLVED', reason: verdict.reason };
    }
    const body = {
      ...baseReceipt('status', gate),
      status: 'OK',
      f10State: gate.f10_state,
      construction: gate.construction ?? 'NOT_BUILT',
      decisionRecord,
      positiveAuthStatus: 'UNVERIFIED',
      positiveAuthHolder: POSITIVE_AUTH_HOLDER,
      semanticsSource: gate.semantics_source ?? null,
    };
    process.stdout.write(`${JSON.stringify(body, null, opts.json ? 2 : 0)}\n`);
    process.exit(EXIT_PASS);
  }

  decideAction(opts.command, opts);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main();

export { GATE_ACTIONS, resolveDecisionRecord, validateGateFile };
