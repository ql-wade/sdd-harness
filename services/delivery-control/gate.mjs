#!/usr/bin/env node
// DeliveryControl.ScopeGate.v1 — F10 guard for the NOT_ENABLED cross-machine
// scope (tasks.md P5_2 前置: CROSS_MACHINE_SCOPE_NOT_ENABLED; 条件性启用门).
//
// The user has NOT enabled the cross-machine scope in this run, so this entry
// ships ONLY the denial guard. It is a real gate, not a declaration:
//   start / publish  really exit 2 with CROSS_MACHINE_SCOPE_NOT_ENABLED;
//   a forged scope file (status ENABLED, self-digest recomputed by the forger)
//                     is refused by the shipped anchor (SCOPE_FILE_NOT_ANCHORED);
//   environment vars  are never consulted for the scope decision — no silent
//                     flip is possible;
//   enable            refuses any runtime record (ENABLEMENT_REQUIRES_PAIRED_
//                     COMMIT): opening the gate is a user decision landed as a
//                     paired commit updating scope-gate.json AND
//                     EXPECTED_SCOPE_DIGEST here together (configVersion
//                     consistency lesson — no boolean flag, no TOCTOU).
//
// Positive cross-machine construction (project isolation, credential
// revocation, restore-time re-auth, API-disconnect cached-green denial) is NOT
// built here and stays UNVERIFIED; "not enabled" never counts as F10 pass.
//
// Exit code contract (house convention, cf. tools/infra/backup-restore.mjs):
//   0 = PASS   (status readback of an anchored registered scope)
//   1 = INPUT  (unknown command, missing/unparseable request or record file)
//   2 = DENY   (scope denial, unanchored/forged scope, runtime enablement)
// Receipts are host-path free: files enter as sha256 digests, never paths.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_DENY = 2;

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCOPE_FILE = path.join(here, 'scope-gate.json');

// Paired-mutation anchor: sha256 over the canonical payload of the committed
// scope-gate.json WITHOUT the contentDigest field. Any scope flip must update
// this constant in the same commit; env vars and out-of-band edits cannot.
const EXPECTED_SCOPE_DIGEST = 'c3c0bad73588967347cf7dbea2dcd1b47cc617ae9b6501a07f64e404a92dc12c';

const POSITIVE_AUTH_HOLDER =
  'P5_2 owner + 用户跨机器范围裁决（正向隔离/撤权/备份恢复/API 断联认证未建设，保留 UNVERIFIED；不能以未启用判 F10 通过）';

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const payloadDigest = (scope) =>
  crypto.createHash('sha256').update(canonicalStringify(scope)).digest('hex');

// Anchor chain: (1) self-consistency — the file's own contentDigest must cover
// its payload bytes; (2) pairing — that digest must equal the one shipped in
// this gate. A forger who recomputes (1) still fails (2).
function verifyScopeAnchoring(scope) {
  if (!scope || typeof scope !== 'object') {
    return { ok: false, code: 'SCOPE_FILE_UNPARSEABLE', reason: 'scope file is not a JSON object' };
  }
  const { contentDigest } = scope;
  const payload = { ...scope };
  delete payload.contentDigest;
  const recomputed = payloadDigest(payload);
  if (typeof contentDigest !== 'string' || contentDigest !== recomputed) {
    return {
      ok: false,
      code: 'SCOPE_DIGEST_MISMATCH',
      reason: 'contentDigest does not cover the scope payload (tampered content with a stale digest)',
      recomputed,
    };
  }
  if (contentDigest !== EXPECTED_SCOPE_DIGEST) {
    return {
      ok: false,
      code: 'SCOPE_FILE_NOT_ANCHORED',
      reason: 'self-consistent but not the digest shipped in gate.mjs; scope flips are paired commits only',
      expected: EXPECTED_SCOPE_DIGEST,
    };
  }
  return { ok: true, code: 'ANCHORED', digest: contentDigest };
}

function usage() {
  return [
    'usage:',
    '  gate.mjs status  [--scope-file <file>] [--json]',
    '  gate.mjs start   --request <file> [--scope-file <file>] [--json]',
    '  gate.mjs publish --request <file> [--scope-file <file>] [--json]',
    '  gate.mjs enable  --record <file> [--scope-file <file>] [--json]',
    '',
    'exit codes: 0 = PASS (anchored status readback), 1 = invalid input, 2 = denial',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { command: argv[0], request: null, record: null, scopeFile: null, json: false };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--request') opts.request = argv[++i];
    else if (arg === '--record') opts.record = argv[++i];
    else if (arg === '--scope-file') opts.scopeFile = argv[++i];
    else return { error: `unknown argument: ${arg}` };
  }
  return opts;
}

function readJsonFile(file, label) {
  if (!file) return { error: `${label} file is required (use --${label === 'request' ? 'request' : 'record'} <file>)` };
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

function deny(code, reason, receipt) {
  process.stderr.write(`delivery-control-gate: DENIED ${code} — ${reason}\n`);
  if (receipt?.json) {
    process.stdout.write(`${JSON.stringify(receipt.body, null, 2)}\n`);
  }
  process.exit(EXIT_DENY);
}

function inputError(message) {
  process.stderr.write(`delivery-control-gate: ERROR ${message}\n`);
  process.exit(EXIT_INPUT);
}

function baseReceipt(command, scope) {
  return {
    interface: 'DeliveryControl.ScopeGate.v1',
    command,
    at: new Date().toISOString(),
    scope: scope?.scope ?? null,
    registeredStatus: scope?.status ?? null,
    contentDigest: scope?.contentDigest ?? null,
    anchoredTo: EXPECTED_SCOPE_DIGEST,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.error) inputError(`${opts.error}\n${usage()}`);
  if (!['status', 'start', 'publish', 'enable'].includes(opts.command)) {
    inputError(`unknown command: ${opts.command}\n${usage()}`);
  }

  // Scope decision inputs: the registered scope file ONLY. process.env is
  // deliberately never consulted for the scope decision — no silent env flip.
  const scopeFile = opts.scopeFile ?? DEFAULT_SCOPE_FILE;
  let scope;
  try {
    scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
  } catch (err) {
    inputError(`scope file cannot be read or parsed (${scopeFile === DEFAULT_SCOPE_FILE ? 'services/delivery-control/scope-gate.json' : 'given --scope-file'}): ${err.message}`);
  }

  const anchoring = verifyScopeAnchoring(scope);

  if (opts.command === 'status') {
    if (!anchoring.ok) deny(anchoring.code, anchoring.reason, {
      json: opts.json,
      body: { ...baseReceipt('status', scope), status: 'UNANCHORED', refusals: [{ code: anchoring.code, reason: anchoring.reason }] },
    });
    const body = {
      ...baseReceipt('status', scope),
      status: scope.status,
      anchored: true,
      gateCode: scope.gateCode ?? 'CROSS_MACHINE_SCOPE_NOT_ENABLED',
      enablementCondition: scope.enablementCondition ?? null,
      positiveAuthStatus: 'UNVERIFIED',
      positiveAuthHolder: POSITIVE_AUTH_HOLDER,
    };
    process.stdout.write(opts.json ? `${JSON.stringify(body, null, 2)}\n` : `${JSON.stringify(body)}\n`);
    process.exit(EXIT_PASS);
  }

  // start / publish: gated actions.
  if (opts.command === 'start' || opts.command === 'publish') {
    const request = readJsonFile(opts.request, 'request');
    if (request.error) inputError(request.error);
    const receiptBody = {
      ...baseReceipt(opts.command, scope),
      status: 'DENIED',
      requestDigest: crypto.createHash('sha256').update(request.raw).digest('hex'),
      refusals: [],
    };
    if (!anchoring.ok) {
      receiptBody.refusals.push({ code: anchoring.code, reason: anchoring.reason });
      deny(anchoring.code, anchoring.reason, { json: opts.json, body: receiptBody });
    }
    if (scope.status !== 'NOT_ENABLED' || scope.scope !== 'CROSS_MACHINE_SCOPE') {
      // Anchored but claims an enabled state this build never shipped: the
      // anchor is what catches this; reaching here means the paired commit
      // exists, which is out of this not-enabled build by construction.
      const code = 'SCOPE_STATE_NOT_SUPPORTED_BY_THIS_BUILD';
      receiptBody.refusals.push({ code, reason: 'this gate build ships only the NOT_ENABLED guard' });
      deny(code, 'this gate build ships only the NOT_ENABLED guard', { json: opts.json, body: receiptBody });
    }
    const code = scope.gateCode ?? 'CROSS_MACHINE_SCOPE_NOT_ENABLED';
    const reason = 'cross-machine scope is not enabled: team Control API start/publish is gated until the user explicitly enables the cross-machine scope (tasks.md P5_2)';
    receiptBody.refusals.push({ code, reason });
    receiptBody.positiveAuthStatus = 'UNVERIFIED';
    receiptBody.positiveAuthHolder = POSITIVE_AUTH_HOLDER;
    deny(code, reason, { json: opts.json, body: receiptBody });
  }

  // enable: the record is digested as evidence and NEVER trusted as approval
  // (caller-supplied identity is not review). Opening the gate is a user
  // decision landed as a paired commit — no runtime record can flip it.
  const record = readJsonFile(opts.record, 'record');
  if (record.error) inputError(record.error);
  const code = 'ENABLEMENT_REQUIRES_PAIRED_COMMIT';
  const reason = 'opening the cross-machine scope requires the explicitly registered user decision as a paired commit (scope-gate.json + EXPECTED_SCOPE_DIGEST in gate.mjs updated together); a runtime record cannot flip the gate';
  deny(code, reason, {
    json: opts.json,
    body: {
      ...baseReceipt('enable', scope),
      status: 'DENIED',
      recordTrusted: false,
      recordDigest: crypto.createHash('sha256').update(record.raw).digest('hex'),
      refusals: [{ code, reason }],
    },
  });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main();

export { canonicalStringify, payloadDigest, verifyScopeAnchoring, EXPECTED_SCOPE_DIGEST, POSITIVE_AUTH_HOLDER };
