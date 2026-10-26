#!/usr/bin/env node
// Delivery journey runner — test action/observer adapter for the comet-managed-v2
// verification journeys (delivery-foundation-rearchitecture, P3_1).
//
// verification_runner_invariant (execution-contract.json): this tool is a test
// action/observer adapter ONLY, not a controller. It cannot own phase, DAG,
// retries, job lease or auto-recovery. It loads a delivery-case-schema-valid
// case definition, executes the actions the case DECLARES (spawn real
// commands, read real state, collect evidence) and emits a structured verdict
// JSON plus on-disk evidence. Scenario semantics live in the case definition
// and the upstream contract; the runner never invents them.
//
// Exit code contract (execution-contract.json V_*.cli_contract):
//   0 = PASS
//   1 = invalid input/prerequisite (bad arguments, unreadable explicit
//       override paths)
//   2 = verification failure — FAIL, and every NOT-EXERCISED /
//       NOT-APPLICABLE (missing case definition or case module, unregistered
//       scenario, missing/drifted frozen pilot baseline, zero effective
//       execution). Missing environment is explicitly UNVERIFIED and nonzero.
//       A skip is never converted into a pass.
//
// Writes only inside --evidence-dir. Executes each declared action exactly
// once per invocation (no retry, no auto-recovery). Profile/owner/environment
// bindings come from the pilot contract machine block in
// openspec/changes/delivery-foundation-rearchitecture/pilot-contract.md.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { computeFullInputBaseline, taskDefinitionDigest } from '../../lib/delivery/baseline.js';
import * as cometAdapter from '../../lib/adapters/comet.js';
import { parseContract } from '../../contracts/delivery/index.js';
import { classifyRunOutcome, parseTapSummary } from '../../lib/delivery/test-contract.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// add-journey-version: the tool's frozen version identity (never read from
// package.json at runtime — the flag contract is zero side effects).
const TOOL_VERSION = '0.1.0';
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_CASE_PLAN = path.join(repoRoot, 'openspec', 'changes', 'delivery-foundation-rearchitecture', 'verification-case-plan.json');
const DEFAULT_PILOT_CONTRACT = path.join(repoRoot, 'openspec', 'changes', 'delivery-foundation-rearchitecture', 'pilot-contract.md');
const SCHEMA_PATH = path.join(repoRoot, 'tools', 'verify', 'delivery-case-schema.json');
const SPAWN_TIMEOUT_MS = 600_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const FROZEN_ARTIFACT_KINDS = ['product', 'design', 'testContract', 'planBundle'];
const NEGATIVE_AC_CATEGORIES = ['ui', 'api', 'persistence', 'permissions'];
const SCENARIO_ID_RE = /^[A-Z]{1,2}[0-9]{1,2}$/;
const RUNNER_INVARIANT = 'test action/observer adapter only — no phase, no DAG, no retries, no job lease, no auto-recovery';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const resolveActionFileTarget = (file, base) => path.isAbsolute(file) ? file : path.resolve(base, file);

// 宿主私有路径绝不进入结构化回执；对外输出统一脱敏（与 tools/infra/registry.mjs 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

// Inside a node --test child, NODE_TEST_CONTEXT=child-v8 makes a nested
// `node --test` skip running files (repo convention, cf. test/delivery-cases/2_1.mjs).
// The runner executes case modules as real standalone processes, so the
// test-runner coordination variable never crosses the boundary.
const childEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

function usage() {
  return [
    'Usage: node tools/verify/delivery-journey.mjs --scenario <ID> --profile <profile> --evidence-dir <dir> [--json]',
    '       [--case-plan <path>] [--pilot-contract <path>] [--case-definition <path>]',
    '',
    '  --scenario <ID>       scenario id from verification-case-plan.json (e.g. A01)',
    '  --journey <name>      registered journey (same-run-delivery | real-comet-recovery | post-delivery-permissions)',
    '  --profile <profile>   registered journey profile (comet-managed-v2)',
    '  --version             print the tool version and exit 0',
    '  --evidence-dir <dir>  fresh empty directory for verdict.json + action evidence',
    '  --json                print the verdict JSON to stdout',
    '  --case-plan <path>    override the scenario registry (default: change verification-case-plan.json)',
    '  --pilot-contract <path>  override the pilot contract (default: change pilot-contract.md)',
    '  --case-definition <path>  execute an explicit schema-validated case definition',
    '',
    'Exit codes: 0=PASS, 1=invalid input/prerequisite, 2=verification failure/UNVERIFIED.',
  ].join('\n');
}

function failInput(message) {
  console.error(redactHostPaths(JSON.stringify({ error: 'INVALID_INPUT', message }, null, 2)));
  console.error(usage());
  return EXIT_INPUT;
}

// --- minimal JSON-schema validator (subset used by delivery-case-schema.json) ---

const jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validateAgainstSchema(instance, schema, ptr = '') {
  const errors = [];
  const walk = (value, sch, at) => {
    if (sch === false) {
      errors.push({ path: at, message: 'property is not allowed for this action' });
      return;
    }
    if (!sch || typeof sch !== 'object') return;
    if (sch.const !== undefined && !jsonEqual(value, sch.const)) {
      errors.push({ path: at, message: `must equal ${JSON.stringify(sch.const)}` });
    }
    if (Array.isArray(sch.enum) && !sch.enum.some((allowed) => jsonEqual(value, allowed))) {
      errors.push({ path: at, message: `must be one of: ${sch.enum.join(', ')}` });
    }
    if (sch.type) {
      const expected = Array.isArray(sch.type) ? sch.type : [sch.type];
      const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
      const typeOk = expected.includes(actual)
        || (expected.includes('integer') && actual === 'number' && Number.isInteger(value));
      if (!typeOk) {
        errors.push({ path: at, message: `must be of type ${sch.type}` });
        return;
      }
    }
    if (typeof value === 'string') {
      if (sch.minLength !== undefined && value.length < sch.minLength) {
        errors.push({ path: at, message: `shorter than minLength ${sch.minLength}` });
      }
      if (sch.pattern !== undefined && !new RegExp(sch.pattern).test(value)) {
        errors.push({ path: at, message: `must match ${sch.pattern}` });
      }
    }
    if (Array.isArray(value)) {
      if (sch.minItems !== undefined && value.length < sch.minItems) {
        errors.push({ path: at, message: `fewer than minItems ${sch.minItems}` });
      }
      if (sch.uniqueItems === true) {
        const seen = new Set(value.map((item) => JSON.stringify(item)));
        if (seen.size !== value.length) {
          errors.push({ path: at, message: 'must have unique items' });
        }
      }
      if (sch.maxItems !== undefined && value.length > sch.maxItems) {
        errors.push({ path: at, message: `more than maxItems ${sch.maxItems}` });
      }
      if (sch.items) value.forEach((item, i) => walk(item, sch.items, `${at}/${i}`));
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (sch.minProperties !== undefined && Object.keys(value).length < sch.minProperties) errors.push({ path: at, message: `fewer than minProperties ${sch.minProperties}` });
      for (const required of sch.required ?? []) {
        // Report at the offending field path, so if/then conditional
        // requirements name the missing property directly.
        if (!(required in value)) errors.push({ path: `${at}/${required}`, message: `missing required property '${required}'` });
      }
      if (sch.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(sch.properties && key in sch.properties)) {
            errors.push({ path: `${at}/${key}`, message: 'additional property is not allowed' });
          }
        }
      }
      for (const [key, sub] of Object.entries(sch.properties ?? {})) {
        if (key in value) walk(value[key], sub, `${at}/${key}`);
      }
      for (const sub of sch.allOf ?? []) walk(value, sub, at);
      if (sch.if) {
        const ifSatisfied = validateAgainstSchema(value, sch.if).length === 0;
        if (ifSatisfied && sch.then) walk(value, sch.then, at);
        if (!ifSatisfied && sch.else) walk(value, sch.else, at);
      }
    }
  };
  walk(instance, schema, ptr);
  return errors;
}

// --- case plan / pilot contract / case definition -----------------------------

function loadCasePlan(explicitPath) {
  const planPath = explicitPath ?? DEFAULT_CASE_PLAN;
  let raw;
  try {
    raw = fs.readFileSync(planPath, 'utf8');
  } catch {
    return { error: explicitPath ? 'override-case-plan-unreadable' : 'case-plan-unreadable', planPath };
  }
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (err) {
    return { error: 'case-plan-malformed', planPath, detail: String(err) };
  }
  if (!plan || typeof plan !== 'object' || !plan.cases || typeof plan.cases !== 'object') {
    return { error: 'case-plan-malformed', planPath };
  }
  return { plan, planPath };
}

function extractPilotContract(markdown) {
  const match = String(markdown).match(/```pilot-contract\s*\n([\s\S]*?)```/);
  if (!match) return { error: 'pilot-contract-machine-block-missing' };
  try {
    return { contract: JSON.parse(match[1]) };
  } catch (err) {
    return { error: 'pilot-contract-machine-block-malformed', detail: String(err) };
  }
}

function loadPilotContract(explicitPath) {
  const contractPath = explicitPath ?? DEFAULT_PILOT_CONTRACT;
  let raw;
  try {
    raw = fs.readFileSync(contractPath, 'utf8');
  } catch {
    return { error: explicitPath ? 'override-pilot-contract-unreadable' : 'pilot-contract-unreadable', contractPath };
  }
  const extracted = extractPilotContract(raw);
  if (extracted.error) return { ...extracted, contractPath };
  return { contract: extracted.contract, contractPath };
}

// A01/A15 baseline gate: every frozen artifact must be registered, present on
// disk and byte-identical (PlanBundle via the checkbox-state-agnostic plan
// digest); the negative AC panel must cover all four categories.
function evaluateFrozenBaseline(contract) {
  const artifacts = {};
  const missing = [];
  const drift = [];
  for (const kind of FROZEN_ARTIFACT_KINDS) {
    const entry = contract?.frozenArtifacts?.[kind];
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
      missing.push(kind);
      artifacts[kind] = { status: 'missing-pointer' };
      continue;
    }
    const abs = path.isAbsolute(entry.path) ? entry.path : path.join(repoRoot, entry.path);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      missing.push(kind);
      artifacts[kind] = { status: 'file-missing', path: displayPath(abs), sha256Recorded: entry.sha256 };
      continue;
    }
    const normalization = kind === 'planBundle' ? 'checkbox-state-agnostic' : 'raw';
    const observed = normalization === 'checkbox-state-agnostic' ? taskDefinitionDigest(content) : sha256(content);
    const detail = {
      status: observed === entry.sha256 ? 'ok' : 'digest-mismatch',
      path: displayPath(abs),
      sha256Recorded: entry.sha256,
      sha256Observed: observed,
      normalization,
    };
    artifacts[kind] = detail;
    if (detail.status === 'digest-mismatch') {
      drift.push({ artifact: kind, path: detail.path, expected: entry.sha256, observed });
    }
  }
  const negativeAc = {};
  for (const category of NEGATIVE_AC_CATEGORIES) {
    const items = contract?.negativeAc?.[category];
    negativeAc[category] = Array.isArray(items) ? items.length : 0;
    if (!Array.isArray(items) || items.length === 0) missing.push(`negativeAc.${category}`);
  }
  return { artifacts, missing, drift, negativeAc };
}

function buildCaseDefinition(scenario, entry, caseModule) {
  return {
    schemaVersion: 1,
    scenario,
    acceptanceIds: [scenario],
    // P1-04 target denominator: the plan entry (assertion_binding_required)
    // demands the scenario token maps to executed ok test points — module
    // green alone is never scenario pass.
    requiredAssertions: entry?.required_assertions ?? [scenario],
    caseModule,
    ...(entry?.required_proof_level ? { proofLevel: entry.required_proof_level } : {}),
    sourceBinding: Array.isArray(entry?.source_binding) ? entry.source_binding : [],
    actions: [
      {
        type: 'spawn',
        command: `node --test --test-reporter=tap ${caseModule}`,
        expected: `exit 0; TAP summary fail=0 with pass>0; test point matching ${scenario} (V_${scenario} or bare id) is ok`,
        expect: { kind: 'exitCode', value: 0 },
      },
      {
        type: 'readState',
        path: 'action-1-stdout.txt',
        expected: 'TAP evidence is persisted to disk and parseable with effective executions > 0',
        expect: { kind: 'nonEmptyFile' },
      },
      {
        type: 'inspect',
        command: 'git rev-parse HEAD',
        expected: 'candidate digest is recorded in the verdict (observation only; does not gate)',
        required: false,
      },
    ],
    evidence: {
      artifacts: [
        'case-definition.json',
        'pilot-baseline.json',
        'action-1-stdout.txt',
        'action-1-stderr.txt',
        'verdict.json',
      ],
    },
    verdictSemantics: {
      PASS: 'actions executed with execution count > 0 and every expected outcome met',
      FAIL: 'the scenario executed and the observed outcome contradicted the frozen THEN',
      'NOT-EXERCISED': 'a prerequisite was missing (case definition, registered baseline, identity or environment); structured refusal, nonzero exit, never a pass',
      'NOT-APPLICABLE': 'explicitly out of scope for the registered profile with a recorded reason; still nonzero',
    },
  };
}

// --- TAP ----------------------------------------------------------------------
//
// Typed final-state readback (P1-04): the verdict is derived from the
// structured TAP points of THIS invocation's spawns, attributed per
// assertion id — never from suite-level green, caller-supplied pass JSON or
// pre-existing evidence bytes.

function parseTapPoints(stdoutText) {
  const points = [];
  for (const match of String(stdoutText ?? '').matchAll(/^[ \t]*(ok|not ok)\s+\d+\s+-\s+(.+)$/gm)) {
    const name = match[2];
    const todo = /#\s*TODO\b/i.test(name);
    const isSkip = /#\s*SKIP\b/i.test(name) || todo;
    points.push({ ok: match[1] === 'ok', skipped: isSkip, todo, name: name.replace(/\s*#\s*(?:SKIP|TODO)\b.*$/i, '') });
  }
  return points;
}

// Word-boundary match of one assertion id against test point names. Ids that
// carry a composite sub-assertion suffix (V_X89:readback) use ':' as part of
// the token so a bare id never matches a composite point and vice versa.
function assertionIdMatches(pointName, id) {
  if (/\s/.test(id)) return pointName === id;
  const inner = id.includes(':') ? 'A-Za-z0-9_:' : 'A-Za-z0-9';
  const boundary = new RegExp(`(^|[^${inner}])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^${inner}]|$)`);
  return boundary.test(pointName);
}

// Typed evaluation of one required assertion id against executed points.
function evaluateAssertionId(id, points) {
  const matched = points.filter((point) => assertionIdMatches(point.name, id));
  const okCount = matched.filter((point) => point.ok && !point.skipped).length;
  const failedCount = matched.filter((point) => !point.ok && !point.skipped).length;
  const skippedCount = matched.filter((point) => point.skipped).length;
  const status = matched.length === 0
    ? 'missing'
    : failedCount > 0 ? 'failed'
      : okCount > 0 ? 'satisfied'
        : skippedCount > 0 ? 'skipped' : 'missing';
  return { id, status, matchedPoints: matched.length, ok: okCount, failed: failedCount, skipped: skippedCount };
}

function evaluateJsonFields(bytes, expected) {
  let value;
  try { value = JSON.parse(bytes); } catch { return { ok: false, fields: null }; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || expected === null || typeof expected !== 'object' || Array.isArray(expected) || Object.keys(expected).length === 0) {
    return { ok: false, fields: null };
  }
  const fields = Object.fromEntries(Object.keys(expected).map((key) => [key, value[key]]));
  return { ok: Object.keys(expected).every((key) => Object.hasOwn(value, key) && isDeepStrictEqual(value[key], expected[key])), fields };
}

// Reference readback is not authorization. The fixed adapter must already
// qualify invocation of the original Comet entry; Comet keeps all business gates.
async function observeEntryPreflight(observer, request) {
  try {
    const source = await observer({ ...request, stage: 'preflight' });
    const root = fs.realpathSync(source.workspace.projectRoot);
    const readRef = (entry) => {
      if (!entry || typeof entry.ref !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest ?? '')) throw new Error('invalid reference');
      const file = entry.ref.startsWith('file:') ? fileURLToPath(entry.ref) : path.resolve(root, entry.ref);
      const bytes = fs.readFileSync(file);
      if (!fs.statSync(file).isFile() || sha256(bytes) !== entry.digest) throw new Error('reference mismatch');
      return { ref: displayPath(file), digest: entry.digest, bytes };
    };
    const authorityRef = readRef(source.authorityRegistration);
    const registration = JSON.parse(authorityRef.bytes);
    const authority = registration.authority;
    const rows = registration.registrations?.filter((row) => row.authorityId === authority?.id && row.workspaceId === authority?.workspaceId) ?? [];
    if (registration.interface !== 'Authority.v1' || registration.schemaVersion !== 1 || authority?.status !== 'VERIFIED'
        || !authority.id || !authority.workspaceId || !authority.controllerPrincipal || rows.length !== 1
        || !rows[0].registrationId || !rows[0].instanceId || rows[0].stateOrigin !== 'authoritative' || rows[0].writerExclusivity !== 'single') {
      return { error: 'entry-authority-unregistered' };
    }
    const policy = readRef(source.policy);
    if (!Array.isArray(source.evidenceRefs) || !['capability', 'permission'].every((kind) => source.evidenceRefs.some((entry) => entry?.kind === kind))) {
      return { error: 'entry-capability-or-permission-observation-missing' };
    }
    const evidenceRefs = source.evidenceRefs.map((entry) => { const actual = readRef(entry); return { kind: entry.kind, ref: actual.ref, digest: actual.digest }; });
    return { root, observation: { authorityId: authority.id, workspaceId: authority.workspaceId,
      authorityRegistration: { ref: authorityRef.ref, digest: authorityRef.digest }, policy: { ref: policy.ref, digest: policy.digest },
      evidenceRefs, scope: 'original-Comet-entry-only; references are not business authorization' } };
  } catch { return { error: 'entry-preflight-unavailable-or-unverified' }; }
}

// The callback belongs to fixed trusted host code. Callback fixtures remain
// component-only; an ActionBinding/hash/role JSON never authenticates a source.
async function observeRuntime({ definition, observer, candidate, actions, evidenceDir, checkId, requiredProofLevel, requiredReadbacks, evidenceHashes, authorityRoot, componentOnly }) {
  const expected = definition.runtimeBinding ? parseContract('SDD.Delivery.ActionBinding', definition.runtimeBinding) : null;
  if ((expected && !expected.ok) || typeof observer !== 'function') return { error: 'protected-source-or-runtime-binding-unavailable' };
  let source;
  try { source = await observer({ stage: 'readback', binding: expected?.value ?? null, candidate, actions, evidenceDir, caseId: definition.scenario, checkId, requiredProofLevel, requiredReadbacks, evidenceFiles: Object.keys(evidenceHashes) }); }
  catch { return { error: 'protected-source-observation-failed' }; }
  const observed = parseContract('SDD.Delivery.ActionBinding', source?.binding);
  const admitted = source?.admission?.entry;
  const envelope = parseContract('SDD.Delivery.EvidenceEnvelope', admitted?.envelope);
  if (!observed.ok || observed.value.profile !== 'comet-managed-v2' || (expected && !isDeepStrictEqual(expected.value, observed.value))
      || source?.admission?.ok !== true || admitted?.class !== 'independent-acceptance' || !envelope.ok) {
    return { error: 'protected-source-not-admitted-or-binding-mismatch' };
  }
  if (!componentOnly) {
    const qualification = admitted.sourcePacket?.collection?.source?.qualification;
    if (!/^[a-f0-9]{64}$/.test(admitted.collectionId ?? '') || admitted.sourcePacket?.collection?.collectionId !== admitted.collectionId
        || qualification?.scope !== 'protected-source' || qualification.status !== 'qualified'
        || !qualification.id || !qualification.sourceId || !qualification.revision
        || !Number.isFinite(Date.parse(qualification.expiresAt)) || Date.parse(qualification.expiresAt) <= Date.now()
        || !Array.isArray(qualification.evidenceRefs) || qualification.evidenceRefs.length === 0) {
      return { error: 'managed-source-collection-or-current-qualification-missing' };
    }
  }
  const binding = observed.value;
  const common = ['runnerId', 'run', 'gate', 'execution', 'role', 'attempt', 'epoch', 'inputDigest', 'policyDigest'];
  if (common.some((key) => admitted.dispatch?.[key] !== binding[key])
      || envelope.value.caseId !== definition.scenario || envelope.value.check !== checkId
      || envelope.value.execution.id !== binding.execution || envelope.value.candidateDigest !== binding.inputDigest
      || envelope.value.origin.id !== binding.runnerId || envelope.value.result !== 'pass'
      || envelope.value.executions.valid < 1 || Date.parse(envelope.value.expiry) <= Date.now()) {
    return { error: 'protected-source-execution-or-candidate-mismatch' };
  }
  try {
    const authority = fs.realpathSync(source.workspace.projectRoot);
    if (authorityRoot && authorityRoot !== authority) return { error: 'entry-authority-changed-during-observation' };
    if (fs.lstatSync(source.workspace.runStateFile).isSymbolicLink()) return { error: 'native-comet-workspace-mismatch' };
    const runFile = fs.realpathSync(source.workspace.runStateFile);
    if (!runFile.startsWith(`${authority}${path.sep}`) || !runFile.endsWith(`${path.sep}.comet${path.sep}run-state.json`)) {
      return { error: 'native-comet-workspace-mismatch' };
    }
    const dispatchFile = path.join(path.dirname(runFile), 'gate-dispatches.json');
    if (fs.lstatSync(dispatchFile).isSymbolicLink() || fs.realpathSync(dispatchFile) !== dispatchFile) return { error: 'native-comet-dispatch-path-mismatch' };
    const runBytes = fs.readFileSync(runFile, 'utf8');
    const dispatchBytes = fs.readFileSync(dispatchFile, 'utf8');
    const nativeRun = JSON.parse(runBytes);
    const nativeDispatches = JSON.parse(dispatchBytes);
    const matches = nativeDispatches.dispatches?.filter((entry) => entry.execution === binding.execution) ?? [];
    const fields = ['gate', 'execution', 'role', 'attempt', 'epoch', 'inputDigest'];
    if (nativeRun.runId !== binding.run || nativeDispatches.schema !== 'comet.classic.gate-dispatches.v1'
        || matches.length !== 1 || fields.some((key) => matches[0][key] !== binding[key])
        || !['open', 'consumed'].includes(matches[0].state)
        || (matches[0].state === 'consumed' && matches[0].verdict !== 'pass')
        || fs.readFileSync(runFile, 'utf8') !== runBytes || fs.readFileSync(dispatchFile, 'utf8') !== dispatchBytes) {
      return { error: 'native-comet-run-or-dispatch-mismatch' };
    }
    const bound = new Map(envelope.value.evidence.map((item) => [
      item.uri.startsWith('file:') ? fileURLToPath(item.uri) : path.resolve(evidenceDir, item.uri), item.sha256,
    ]));
    for (const [name, capturedHash] of Object.entries(evidenceHashes)) {
      const file = path.join(evidenceDir, name);
      if (bound.get(file) !== capturedHash || sha256(fs.readFileSync(file)) !== capturedHash) return { error: 'current-raw-evidence-not-bound' };
    }
    return { binding, authority: displayPath(authority), nativeRunSha256: sha256(runBytes), nativeDispatchSha256: sha256(dispatchBytes), envelopeDigest: admitted.digest ?? null };
  } catch { return { error: 'native-comet-or-raw-readback-unavailable' }; }
}

// --- verdict ------------------------------------------------------------------

export async function runDeliveryJourney({ args = process.argv.slice(2), observeProtectedSource = cometAdapter.observeProtectedSource } = {}) {
  // add-journey-version (AC3, debate r1 resolution; code-review r1 fix): the
  // version request is honored on the CALLER'S argv (the args parameter — the
  // function's input contract), never on the host process.argv, so programmatic
  // calls are covered and a host --version never leaks into other invocations.
  if (args.includes('--version')) {
    console.log(TOOL_VERSION);
    return EXIT_PASS;
  }
  let options;
  try {
    options = parseArgs({
      args,
      strict: true,
      options: {
        scenario: { type: 'string' },
        journey: { type: 'string' },
        profile: { type: 'string' },
        'evidence-dir': { type: 'string' },
        json: { type: 'boolean', default: false },
        'case-plan': { type: 'string' },
        'pilot-contract': { type: 'string' },
        'case-definition': { type: 'string' },
      },
    }).values;
  } catch (err) {
    return failInput(`argument error: ${String(err?.message ?? err)}`);
  }

  const scenario = options.scenario;
  const journeyName = options.journey;
  const profile = options.profile;
  const evidenceDirOption = options['evidence-dir'];
  if (journeyName && scenario) {
    return failInput('--journey and --scenario are mutually exclusive; a journey recipe declares its own scenario');
  }
  if (journeyName && options['case-definition']) {
    return failInput('--journey and --case-definition are mutually exclusive; the journey recipe is the case definition');
  }
  if ((!scenario && !journeyName) || !profile || !evidenceDirOption) {
    return failInput('--scenario (or --journey), --profile and --evidence-dir are required');
  }
  if (scenario && !SCENARIO_ID_RE.test(scenario)) {
    return failInput(`--scenario must match ${SCENARIO_ID_RE}`);
  }

  const componentOnly = Boolean(options['case-plan'] || options['pilot-contract'] || options['case-definition']
    || observeProtectedSource !== cometAdapter.observeProtectedSource);
  const startedAt = new Date().toISOString();
  const evidenceDir = path.resolve(evidenceDirOption);
  try {
    if (fs.existsSync(evidenceDir) && fs.lstatSync(evidenceDir).isSymbolicLink()) return failInput('evidence dir cannot be a symbolic link');
    fs.mkdirSync(evidenceDir, { recursive: true });
    if (fs.readdirSync(evidenceDir).length !== 0) return failInput('evidence dir must be fresh and empty; prior trial bytes are never overwritten');
  } catch (err) {
    return failInput(`cannot create evidence dir ${evidenceDirOption}: ${String(err?.message ?? err)}`);
  }

  const verdict = {
    schemaVersion: 1,
    tool: 'tools/verify/delivery-journey.mjs',
    runnerInvariant: RUNNER_INVARIANT,
    scenario,
    acceptanceIds: journeyName ? [] : [scenario],
    journey: journeyName ? { name: journeyName, owner: null, requiredCheck: null, recipePath: null, registeredStatus: null } : null,
    profile,
    scope: componentOnly ? 'component/observer-qualification' : 'managed/unqualified',
    managedClosureEligible: false,
    sourceObservation: null,
    caseModule: null,
    sourceBinding: [],
    verdict: 'NOT-EXERCISED',
    reason: null,
    missing: [],
    drift: [],
    schemaErrors: [],
    execution: {
      command: null,
      actions: [],
      tests: 0,
      pass: 0,
      fail: 0,
      skipped: 0,
      todo: 0,
      effectiveExecutions: 0,
      target: { token: scenario, found: false, status: null },
      requiredAssertions: [],
    },
    candidate: { gitHead: null, node: process.version, platform: process.platform },
    timing: { startedAt, finishedAt: null, durationMs: null },
    evidence: { dir: displayPath(evidenceDir), files: [], sha256: {} },
    exitCode: EXIT_VERIFY,
  };

  const writeEvidence = (name, bytes) => {
    fs.writeFileSync(path.join(evidenceDir, name), bytes, { flag: 'wx' });
    if (!verdict.evidence.files.includes(name)) verdict.evidence.files.push(name);
    if (name !== 'verdict.json') verdict.evidence.sha256[name] = sha256(bytes);
  };
  const writeJson = (name, value) => writeEvidence(name, `${JSON.stringify(value, null, 2)}\n`);

  const emit = (exitCode) => {
    verdict.exitCode = exitCode;
    verdict.timing.finishedAt = new Date().toISOString();
    verdict.timing.durationMs = Date.parse(verdict.timing.finishedAt) - Date.parse(verdict.timing.startedAt);
    if (!verdict.evidence.files.includes('verdict.json')) verdict.evidence.files.push('verdict.json');
    writeJson('verdict.json', verdict);
    if (options.json) console.log(JSON.stringify(verdict, null, 2));
    else console.log(`delivery-journey ${scenario} [${profile}]: ${verdict.verdict} (${verdict.reason ?? 'expected outcomes met'}) exit=${exitCode}`);
    return exitCode;
  };

  const notExercised = (reason, extra = {}) => {
    verdict.verdict = 'NOT-EXERCISED';
    verdict.reason = reason;
    Object.assign(verdict, extra);
    return emit(EXIT_VERIFY);
  };
  const fail = (reason, extra = {}) => {
    verdict.verdict = 'FAIL';
    verdict.reason = reason;
    Object.assign(verdict, extra);
    return emit(EXIT_VERIFY);
  };

  if (profile !== 'comet-managed-v2') {
    return notExercised('profile-retired-or-unknown: only comet-managed-v2 is a current verification profile');
  }

  // Candidate observation is read-only and non-fatal.
  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: MAX_BUFFER, env: childEnv() });
  verdict.candidate.gitHead = gitHead.status === 0 ? String(gitHead.stdout).trim() : null;

  // 0. Journey mode (execution-contract.observer_contract): resolve the
  // registered journey -> owner/required_check -> recipe path. The recipe IS
  // the case definition; this adapter only triggers and observes the actions
  // the recipe declares — it never owns phase, recovery, retries or a second
  // DAG. A registered real journey whose recipe has not landed (resources
  // missing) is a nonzero UNVERIFIED refusal, never a pass and never a
  // completed-journey claim.
  let explicitDefinition = null;
  let declaredModule = null;
  let entry = null;
  let journeyRecipeDefinition = null;
  if (journeyName) {
    const planLoad = loadCasePlan(options['case-plan']);
    if (planLoad.error) return failInput(`cannot read --case-plan: ${planLoad.error} (${redactHostPaths(planLoad.planPath ?? '')})`);
    const registrations = planLoad.plan.journey_definitions;
    if (!registrations || typeof registrations !== 'object' || !registrations[journeyName]) {
      verdict.acceptanceIds = [];
      return notExercised(`journey-not-registered: '${journeyName}' is not in verification-case-plan journey_definitions; unknown journeys never fall into a default-success path`);
    }
    const registration = registrations[journeyName];
    entry = registration;
    verdict.journey = {
      name: journeyName,
      owner: typeof registration.owner === 'string' ? registration.owner : null,
      requiredCheck: typeof registration.required_check === 'string' ? registration.required_check : null,
      recipePath: typeof registration.path === 'string' ? displayPath(path.isAbsolute(registration.path) ? registration.path : path.join(repoRoot, registration.path)) : null,
      registeredStatus: typeof registration.status === 'string' ? registration.status : null,
    };
    if (!verdict.journey.owner || !verdict.journey.requiredCheck || !registration.path) {
      return notExercised('journey-registration-incomplete: owner/required_check/path must all be registered explicitly');
    }
    const recipeAbs = path.isAbsolute(registration.path) ? registration.path : path.join(repoRoot, registration.path);
    if (!componentOnly) {
      const recipeInput = computeFullInputBaseline({ root: repoRoot, manifest: { artifacts: [registration.path] } });
      if (!recipeInput.ok || !/^[a-f0-9]{64}$/.test(registration.case_definition_sha256 ?? '')) return notExercised('journey-recipe-freeze-or-safe-path-missing');
      if (recipeInput.files[0].sha256 !== registration.case_definition_sha256) return notExercised('registered-journey-recipe-drift');
    }
    if (!fs.existsSync(recipeAbs)) {
      return notExercised(`journey-recipe-not-implemented (UNVERIFIED): the registered recipe does not exist on disk — real-journey resources are not present; recipe owner ${verdict.journey.owner} has not landed it (registered status: ${verdict.journey.registeredStatus ?? 'unknown'})`);
    }
    let recipeRaw;
    try {
      recipeRaw = fs.readFileSync(recipeAbs, 'utf8');
    } catch (err) {
      return notExercised(`journey-recipe-unreadable: ${String(err?.message ?? err)}`);
    }
    try {
      journeyRecipeDefinition = JSON.parse(recipeRaw);
    } catch (err) {
      return notExercised(`journey-recipe-malformed: ${String(err?.message ?? err)}`);
    }
    if (typeof journeyRecipeDefinition.scenario !== 'string' || !SCENARIO_ID_RE.test(journeyRecipeDefinition.scenario)) {
      return notExercised('journey-recipe-scenario-invalid: the recipe must declare a valid scenario id');
    }
    declaredModule = typeof journeyRecipeDefinition.caseModule === 'string' ? journeyRecipeDefinition.caseModule : '';
    if (!declaredModule) {
      return notExercised('case-module-not-registered');
    }
    const recipeModule = path.isAbsolute(declaredModule) ? declaredModule : path.join(repoRoot, declaredModule);
    if (!fs.existsSync(recipeModule)) {
      return notExercised('case-module-missing', { caseModule: declaredModule });
    }
    verdict.caseModule = declaredModule;
    verdict.scenario = journeyRecipeDefinition.scenario;
    verdict.acceptanceIds = Array.isArray(journeyRecipeDefinition.acceptanceIds) ? journeyRecipeDefinition.acceptanceIds : [];
    verdict.sourceBinding = Array.isArray(journeyRecipeDefinition.sourceBinding) ? journeyRecipeDefinition.sourceBinding : [];
    verdict.execution.target = { token: journeyRecipeDefinition.scenario, found: false, status: null };
    explicitDefinition = journeyRecipeDefinition;
  }

  // 1. Case source: a journey recipe, an explicit schema-validated definition
  // (the plan is not consulted) or the scenario registry entry.
  if (journeyRecipeDefinition) {
    // Journey recipes are already fully bound above; the scenario registry is
    // not consulted (the journey_definitions registration is the binding).
  } else if (options['case-definition']) {
    const definitionPath = options['case-definition'];
    let raw;
    try {
      raw = fs.readFileSync(definitionPath, 'utf8');
    } catch {
      return failInput(`cannot read --case-definition: ${redactHostPaths(definitionPath)}`);
    }
    try {
      explicitDefinition = JSON.parse(raw);
    } catch (err) {
      return failInput(`--case-definition is not valid JSON: ${String(err?.message ?? err)}`);
    }
    if (explicitDefinition?.scenario !== scenario) {
      return failInput(`--case-definition scenario ${JSON.stringify(explicitDefinition?.scenario)} does not match --scenario ${scenario}`);
    }
    declaredModule = typeof explicitDefinition.caseModule === 'string' ? explicitDefinition.caseModule : '';
    if (!declaredModule) {
      return notExercised('case-module-not-registered');
    }
    const resolvedModule = path.isAbsolute(declaredModule) ? declaredModule : path.join(repoRoot, declaredModule);
    if (!fs.existsSync(resolvedModule)) {
      return notExercised('case-module-missing', { caseModule: declaredModule });
    }
    verdict.caseModule = declaredModule;
    verdict.sourceBinding = Array.isArray(explicitDefinition.sourceBinding) ? explicitDefinition.sourceBinding : [];
  } else {
    const planLoad = loadCasePlan(options['case-plan']);
    if (planLoad.error) return failInput(`cannot read --case-plan: ${planLoad.error} (${redactHostPaths(planLoad.planPath ?? '')})`);
    entry = planLoad.plan.cases[scenario];
    if (!entry) {
      return notExercised('scenario-not-registered-in-case-plan', { missing: [`${scenario} (verification-case-plan.json)`] });
    }
    declaredModule = typeof entry.case_module === 'string' ? entry.case_module : '';
    if (!declaredModule) {
      return notExercised('case-module-not-registered');
    }
    const resolvedModule = path.isAbsolute(declaredModule) ? declaredModule : path.join(repoRoot, declaredModule);
    if (!fs.existsSync(resolvedModule)) {
      return notExercised('case-module-missing', { caseModule: declaredModule });
    }
    verdict.caseModule = declaredModule;
    verdict.sourceBinding = Array.isArray(entry.source_binding) ? entry.source_binding : [];
    if (!componentOnly) {
      const moduleInput = computeFullInputBaseline({ root: repoRoot, manifest: { tests: [declaredModule] } });
      if (!moduleInput.ok) return notExercised('registered-case-module-path-unsafe-or-missing');
    }
    if (entry.case_definition) {
      try {
        if (!/^[a-f0-9]{64}$/.test(entry.case_definition_sha256 ?? '')) return notExercised('registered-case-definition-hash-missing');
        if (!componentOnly) {
          const recipeInput = computeFullInputBaseline({ root: repoRoot, manifest: { artifacts: [entry.case_definition] } });
          if (!recipeInput.ok) return notExercised('registered-case-definition-path-unsafe-or-missing');
        }
        const recipe = fs.readFileSync(path.resolve(repoRoot, entry.case_definition), 'utf8');
        if (sha256(recipe) !== entry.case_definition_sha256) return notExercised('registered-case-definition-drift');
        explicitDefinition = JSON.parse(recipe);
        if (explicitDefinition.scenario !== scenario || path.resolve(repoRoot, explicitDefinition.caseModule ?? '') !== path.resolve(repoRoot, declaredModule)) {
          return notExercised('registered-case-definition-target-mismatch');
        }
      } catch { return notExercised('registered-case-definition-unreadable-or-malformed'); }
    }
  }

  if (!entry && explicitDefinition && options['case-plan']) {
    const registeredPlan = loadCasePlan(options['case-plan']);
    if (registeredPlan.error) return notExercised(registeredPlan.error);
    entry = registeredPlan.plan.cases[explicitDefinition.scenario];
    if (!entry) return notExercised('scenario-not-registered-in-case-plan');
  }

  // 3. Pilot contract machine block + profile registration (A01/A15 gate).
  const contractLoad = loadPilotContract(options['pilot-contract']);
  if (contractLoad.error === 'override-pilot-contract-unreadable') {
    return failInput(`cannot read --pilot-contract: ${redactHostPaths(contractLoad.contractPath)}`);
  }
  if (contractLoad.error) {
    writeJson('pilot-baseline.json', { contractPath: displayPath(contractLoad.contractPath), error: contractLoad.error, detail: contractLoad.detail ?? null });
    return notExercised(contractLoad.error);
  }
  if (contractLoad.contract.profile !== profile) {
    writeJson('pilot-baseline.json', {
      contractPath: displayPath(contractLoad.contractPath),
      profileRegistered: contractLoad.contract.profile ?? null,
      profileRequested: profile,
    });
    return notExercised('profile-not-registered-in-pilot-contract');
  }

  // 4. Frozen baseline gate: registration + disk presence + digest binding.
  const baseline = evaluateFrozenBaseline(contractLoad.contract);
  writeJson('pilot-baseline.json', {
    contractPath: displayPath(contractLoad.contractPath),
    profile: contractLoad.contract.profile,
    artifacts: baseline.artifacts,
    negativeAcCategories: baseline.negativeAc,
  });
  if (baseline.missing.length > 0) {
    return notExercised('baseline-missing: dispatch refused, the registered pilot baseline is incomplete (A01: refuse and list the missing items)', { missing: baseline.missing });
  }
  if (baseline.drift.length > 0) {
    return notExercised('frozen-baseline-drift: the accepted artifact changed after freeze; re-freezing is an explicit registration change (A15: conservative invalidation)', { drift: baseline.drift });
  }

  if (componentOnly && entry?.required_proof_level && entry.required_proof_level !== 'component') {
    return notExercised('component-proof-cannot-satisfy-registered-layer (UNVERIFIED)');
  }

  if (!componentOnly) {
    if (!['comet-runtime', 'host', 'platform', 'resource'].includes(entry?.required_proof_level)
        || !Array.isArray(entry.required_assertions) || entry.required_assertions.length === 0
        || !Array.isArray(entry.required_readbacks) || entry.required_readbacks.length === 0) {
      return notExercised('proof-registration-missing (UNVERIFIED): formal scenarios require a frozen assertion denominator, real proof level and typed readbacks');
    }
    if (typeof observeProtectedSource !== 'function') {
      return notExercised('protected-source-unavailable (UNVERIFIED): no qualified Comet launcher observation interface is installed');
    }
  }

  // 5. Case definition: the explicit one loaded in step 1 or the canonical
  // actions synthesized from the registry entry.
  let definition = explicitDefinition ?? buildCaseDefinition(scenario, entry, declaredModule);
  // Historical whitespace-split path probes are fixture compatibility only.
  // Existing paths (including names with spaces) always remain file observations.
  // Formal recipes must name commands explicitly; no managed path is executed.
  if (componentOnly && Array.isArray(definition.actions)) {
    const legacy = [];
    const actions = definition.actions.map((action, index) => {
      if (action?.type !== 'inspect' || Object.hasOwn(action, 'command') || typeof action.path !== 'string'
          || !/\s/.test(action.path) || fs.existsSync(resolveActionFileTarget(action.path, repoRoot))) return action;
      legacy.push(index + 1);
      const { path: command, ...rest } = action;
      return { ...rest, command };
    });
    if (legacy.length > 0) {
      definition = { ...definition, actions };
      verdict.legacyInspectionActions = { scope: 'component/legacy-compatibility', indexes: legacy };
    }
  }

  // 6. Schema enforcement.
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (err) {
    return notExercised('case-schema-unreadable', { schemaErrors: [{ path: displayPath(SCHEMA_PATH), message: String(err?.message ?? err) }] });
  }
  const schemaErrors = validateAgainstSchema(definition, schema);
  if (schemaErrors.length > 0) {
    return notExercised('case-definition-schema-invalid', { schemaErrors });
  }
  if (definition.evidence.artifacts.some((name) => path.isAbsolute(name) || path.resolve(evidenceDir, name) === evidenceDir
      || !path.resolve(evidenceDir, name).startsWith(`${evidenceDir}${path.sep}`))) {
    return notExercised('evidence-artifact-outside-invocation: artifacts must be files inside this fresh evidence directory');
  }

  const frozenTargetMapping = Array.isArray(entry?.required_assertions) && entry.required_assertions.length > 0;
  if (!definition.acceptanceIds.includes(definition.scenario)
      || (!frozenTargetMapping && !definition.requiredAssertions.some((id) => assertionIdMatches(id, definition.scenario)))) {
    return notExercised('required-scenario-target-missing: an explicit denominator cannot replace the requested scenario');
  }
  if (explicitDefinition && (options['case-plan'] || !options['pilot-contract'])) {
    const frozenPlan = loadCasePlan(options['case-plan']);
    if (frozenPlan.error) return notExercised(frozenPlan.error);
    const registered = frozenPlan.plan.cases[definition.scenario];
    if (!registered) return notExercised('scenario-not-registered-in-case-plan');
    const required = registered.required_assertions ?? [definition.scenario];
    if (!Array.isArray(required) || required.length === 0
        || required.some((id) => !definition.requiredAssertions.some((declared) => declared === id || (id === definition.scenario && assertionIdMatches(declared, id))))) {
      return notExercised('frozen-assertion-denominator-weakened: explicit definition omitted a registered required assertion');
    }
    if (path.resolve(repoRoot, registered.case_module ?? '') !== path.resolve(repoRoot, definition.caseModule)) {
      return notExercised('registered-case-module-mismatch: explicit definition cannot replace the registered module');
    }
  }
  if (options['case-plan'] && !entry) {
    const frozenPlan = loadCasePlan(options['case-plan']);
    if (frozenPlan.error) return notExercised(frozenPlan.error);
    entry = frozenPlan.plan.cases[definition.scenario];
  }
  if (entry?.required_proof_level && definition.proofLevel && entry.required_proof_level !== definition.proofLevel) {
    return notExercised('frozen-proof-level-mismatch: proof labels cannot downgrade the registered real layer');
  }
  if (entry?.required_readbacks) {
    if (!Array.isArray(entry.required_readbacks) || entry.required_readbacks.length === 0) return notExercised('frozen-readback-registration-invalid');
    for (const readback of entry.required_readbacks) {
      if (readback === null || typeof readback !== 'object' || Array.isArray(readback)) return notExercised('frozen-readback-registration-invalid');
      const matches = definition.actions.filter((action) => action.id === readback.id);
      const action = matches[0];
      if (typeof readback.id !== 'string' || !readback.id || matches.length !== 1 || action.required === false
          || action.type !== readback.type || action.expect?.kind !== readback.expect
          || !['jsonFields', 'equals'].includes(readback.expect)) {
        return notExercised('frozen-typed-readback-missing-or-weakened');
      }
      if (readback.expect === 'jsonFields') {
        if (!Array.isArray(readback.fields) || readback.fields.length === 0
            || readback.fields.some((field) => typeof field !== 'string' || !field) || new Set(readback.fields).size !== readback.fields.length
            || readback.fields.some((field) => !Object.hasOwn(action.expect.value, field))
            || Object.entries(readback.value ?? {}).some(([field, value]) => !isDeepStrictEqual(action.expect.value[field], value))) {
          return notExercised('frozen-typed-readback-fields-or-values-weakened');
        }
      } else if (typeof readback.value !== 'string' || action.expect.value !== readback.value) {
        return notExercised('frozen-typed-readback-value-weakened');
      }
    }
  }
  writeJson('case-definition.json', definition);

  let entryPreflight = null;
  if (typeof observeProtectedSource === 'function') {
    entryPreflight = await observeEntryPreflight(observeProtectedSource, { profile, definition, candidate: verdict.candidate, evidenceDir,
      caseId: definition.scenario, checkId: verdict.journey?.requiredCheck ?? `V_${definition.scenario}`,
      requiredProofLevel: entry?.required_proof_level ?? 'component', requiredReadbacks: entry?.required_readbacks ?? [] });
    if (entryPreflight.error) return notExercised(`${entryPreflight.error} (UNVERIFIED): original Comet entry qualification was not observed`);
    verdict.preflightObservation = entryPreflight.observation;
    writeJson('entry-preflight.json', entryPreflight.observation);
  }

  // 7. Execute the declared actions — each exactly once (no retries). Every
  // required action's typed expectation is evaluated against the LIVE
  // observation this invocation produced (real exit code / bytes / probe
  // stdout); a registered expectation value never attests to itself and a
  // required inspection is never free (RW_OBSERVATION_REQUIRED).
  const spawnStdouts = [];
  const spawnPoints = [];
  for (let index = 0; index < definition.actions.length; index += 1) {
    const action = definition.actions[index];
    const label = index + 1;
    const isRequired = action.required !== false;
    const expect = action.expect ?? null;
    const result = {
      index: label,
      id: action.id ?? null,
      type: action.type,
      expected: action.expected,
      required: isRequired,
      expectation: expect,
      ok: false,
      exitCode: null,
      durationMs: null,
      note: null,
      observed: null,
    };
    const actionStart = Date.now();
    let expectationFailed = false;
    const expectationNote = (message) => {
      expectationFailed = true;
      if (result.note === null) result.note = message;
      else result.note = `${result.note}; ${message}`;
    };
    if (action.type === 'spawn') {
      const argv = action.command.split(/\s+/);
      if (/^node(?:\.exe)?$/.test(path.basename(argv[0])) && argv.includes('--test')
          && !argv.some((arg) => arg === '--test-reporter' || arg.startsWith('--test-reporter='))) {
        argv.splice(argv.indexOf('--test') + 1, 0, '--test-reporter=tap');
      }
      result.argv = argv;
      result.command = action.command;
      verdict.execution.command = verdict.execution.command ?? action.command;
      const run = spawnSync(argv[0], argv.slice(1), {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        timeout: SPAWN_TIMEOUT_MS,
        env: childEnv(),
      });
      result.durationMs = Date.now() - actionStart;
      const stdoutName = `action-${label}-stdout.txt`;
      const stderrName = `action-${label}-stderr.txt`;
      writeEvidence(stdoutName, run.stdout ?? '');
      writeEvidence(stderrName, run.stderr ?? '');
      spawnStdouts.push(run.stdout ?? '');
      for (const point of parseTapPoints(run.stdout ?? '')) {
        spawnPoints.push({ actionIndex: label, ...point });
      }
      result.exitCode = run.status;
      if (run.error) {
        result.note = String(run.error?.message ?? run.error);
      } else if (run.status === null) {
        result.note = `terminated by signal ${run.signal}`;
      }
      const completed = !run.error && run.status !== null;
      if (parseTapPoints(run.stdout).length > 0 || argv.includes('--test') || expect?.kind === 'tapRequiredAssertions') {
        const outcome = classifyRunOutcome({ exitCode: run.status, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}`, spawnError: run.error });
        result.testOutcome = outcome;
        if (outcome.kind !== 'pass') {
          result.unverified = outcome.kind === 'environment-failure' ? 'invalid-test-execution' : outcome.kind === 'empty' ? 'no-effective-execution' : null;
          expectationNote(`test execution is ${outcome.kind}; complete passing TAP is required`);
        }
      }
      if (expect?.kind === 'exitCode') {
        if (!completed) expectationNote(`expected exit ${expect.value}, spawn did not complete`);
        else if (run.status !== expect.value) expectationNote(`expected exit ${expect.value}, observed exit ${run.status}`);
      } else if (expect?.kind === 'commandSucceeds') {
        if (!completed || run.status !== 0) expectationNote('expected the spawn to succeed');
      }
      if (expect?.kind === 'tapRequiredAssertions') {
        const ownPoints = parseTapPoints(run.stdout ?? '');
        const evaluations = (expect.assertions ?? []).map((id) => evaluateAssertionId(id, ownPoints));
        result.assertions = evaluations;
        for (const evaluation of evaluations) {
          if (evaluation.status !== 'satisfied') {
            expectationNote(`required assertion ${evaluation.id} not satisfied in this action's TAP (${evaluation.status})`);
          }
        }
      }
      // exitCode expectations govern nonzero exits (a refusal recipe may pin
      // exit 2); without one, a completed nonzero exit is a plain action
      // failure (pre-schema default kept).
      const exitOk = expect?.kind === 'exitCode' ? completed && run.status === expect.value : completed && run.status === 0;
      result.ok = exitOk && !expectationFailed;
    } else if (action.type === 'readState') {
      const target = resolveActionFileTarget(action.path, evidenceDir);
      result.command = null;
      let stat = null;
      try {
        stat = fs.statSync(target);
      } catch {
        stat = null;
      }
      const exists = stat !== null && stat.isFile();
      const bytes = exists ? fs.readFileSync(target, 'utf8') : null;
      if (bytes !== null) {
        result.rawEvidence = [`action-${label}-readback.txt`];
        writeEvidence(result.rawEvidence[0], bytes);
      }
      result.observed = { path: displayPath(target), bytes: stat === null ? null : stat.size };
      if (!exists) {
        result.note = 'state file does not exist';
      } else if (stat.size === 0) {
        result.note = 'state file is empty';
      }
      if (expect?.kind === 'nonEmptyFile') {
        if (!exists || stat.size === 0) expectationNote('expected a non-empty state file');
      } else if (expect?.kind === 'jsonFields') {
        const match = evaluateJsonFields(bytes, expect.value);
        result.observed.fields = match.fields;
        if (!match.ok) expectationNote('typed JSON readback did not match the frozen fields');
      } else if (expect?.kind === 'equals') {
        result.observed.value = bytes;
        if (bytes === null) {
          expectationNote('expected bytes, file missing');
        } else if (bytes !== expect.value) {
          expectationNote(`expected bytes do not match the observed file content (observed sha256 ${sha256(bytes)})`);
        }
      }
      result.ok = exists && !expectationFailed;
    } else if (action.type === 'inspect') {
      result.command = null;
      const commandInspection = Object.hasOwn(action, 'command');
      const supportedKinds = commandInspection
        ? ['commandSucceeds', 'equals', 'jsonFields']
        : ['equals', 'nonEmptyFile', 'jsonFields'];
      if (expect && !supportedKinds.includes(expect.kind)) {
        expectationNote(`unsupported ${expect.kind} expectation for ${commandInspection ? 'command' : 'file'} inspection`);
      } else if (commandInspection) {
        const argv = action.command.split(/\s+/);
        result.argv = argv;
        result.command = action.command;
        const observation = spawnSync(argv[0], argv.slice(1), {
          cwd: repoRoot,
          encoding: 'utf8',
          maxBuffer: MAX_BUFFER,
          timeout: SPAWN_TIMEOUT_MS,
          env: childEnv(),
        });
        result.exitCode = observation.status;
        result.rawEvidence = [`action-${label}-inspection-stdout.txt`, `action-${label}-inspection-stderr.txt`];
        writeEvidence(result.rawEvidence[0], observation.stdout ?? '');
        writeEvidence(result.rawEvidence[1], observation.stderr ?? '');
        result.observed = observation.status === 0 ? String(observation.stdout).trim() : null;
        if (observation.error) {
          result.note = String(observation.error?.message ?? observation.error);
        } else if (observation.status !== 0) {
          result.note = `inspection command exited ${observation.status}`;
        }
        if (expect?.kind === 'commandSucceeds') {
          if (observation.error || observation.status !== 0) expectationNote('expected the inspection command to succeed');
        } else if (expect?.kind === 'jsonFields') {
          const match = evaluateJsonFields(observation.stdout, expect.value);
          result.observed = { fields: match.fields };
          if (observation.error || observation.status !== 0 || !match.ok) expectationNote('typed JSON inspection failed or did not match the frozen fields');
        } else if (expect?.kind === 'equals') {
          if (observation.error || observation.status !== 0) {
            expectationNote('expected a value, the live probe failed');
          } else if (String(observation.stdout).trim() !== expect.value) {
            expectationNote(`expected value does not match the live probe output (observed sha256 ${sha256(String(observation.stdout).trim())})`);
          }
        }
        result.ok = !observation.error && observation.status === 0 && !expectationFailed;
      } else {
        const target = resolveActionFileTarget(action.path, repoRoot);
        let stat = null;
        try {
          stat = fs.statSync(target);
        } catch {
          stat = null;
        }
        result.observed = stat === null
          ? { path: displayPath(target), exists: false }
          : { path: displayPath(target), exists: true, bytes: stat.size };
        const content = stat === null || !stat.isFile() ? null : fs.readFileSync(target, 'utf8');
        if (content !== null) {
          result.rawEvidence = [`action-${label}-inspection-readback.txt`];
          writeEvidence(result.rawEvidence[0], content);
        }
        if (expect?.kind === 'nonEmptyFile') {
          if (stat === null || !stat.isFile() || stat.size === 0) expectationNote('expected a non-empty regular inspected file');
        } else if (expect?.kind === 'jsonFields') {
          const match = evaluateJsonFields(content, expect.value);
          result.observed.fields = match.fields;
          if (!match.ok) expectationNote('typed JSON inspected file did not match the frozen fields');
        } else if (expect?.kind === 'equals') {
          result.observed.value = content;
          if (content === null) {
            expectationNote('expected bytes, inspected file missing');
          } else if (content !== expect.value) {
            expectationNote('expected bytes do not match the inspected file content');
          }
        }
        result.ok = stat !== null && stat.isFile() && !expectationFailed;
      }
    }
    // Optional observations retain their actual result; only required actions gate.
    result.durationMs = Date.now() - actionStart;
    result.observedAt = new Date().toISOString();
    verdict.execution.actions.push(result);
  }

  // 8. Evidence contract: every declared artifact must have landed on disk.
  const missingEvidence = [];
  for (const name of definition.evidence.artifacts.filter((item) => item !== 'verdict.json')) {
    const file = path.join(evidenceDir, name);
    try {
      if (!fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(`${fs.realpathSync(evidenceDir)}${path.sep}`)) {
        missingEvidence.push(name);
        continue;
      }
      const observed = sha256(fs.readFileSync(file));
      if (verdict.evidence.sha256[name] && verdict.evidence.sha256[name] !== observed) return fail('evidence-changed-after-capture');
      if (!verdict.evidence.files.includes(name)) verdict.evidence.files.push(name);
      verdict.evidence.sha256[name] = observed;
    } catch { missingEvidence.push(name); }
  }
  if (missingEvidence.length > 0) {
    return fail(`evidence-artifact-missing: ${missingEvidence.join(', ')} — a claim without persisted bytes is not evidence`);
  }

  // 9. Verdict from the executed outcomes, typed by assertion id (P1-04):
  // every required assertion must map to executed ok test points — missing,
  // skipped, failed or unmatched ids are structured nonzero refusals.
  const failedAction = verdict.execution.actions.find((action) => action.required && !action.ok);
  // Counts come from complete summaries of this invocation; named targets
  // independently map to its actual TAP points, including nested tests.
  const summaries = spawnStdouts.map(parseTapSummary).filter(Boolean);
  for (const key of ['tests', 'pass', 'fail', 'skipped', 'todo', 'cancelled']) {
    verdict.execution[key] = summaries.reduce((sum, summary) => sum + summary[key], 0);
  }
  verdict.execution.effectiveExecutions = verdict.execution.pass + verdict.execution.fail;

  const requiredIds = Array.isArray(definition.requiredAssertions) ? definition.requiredAssertions : [];
  const evaluations = requiredIds.map((id) => evaluateAssertionId(id, spawnPoints));
  verdict.execution.requiredAssertions = evaluations;
  const scenarioToken = verdict.scenario;
  const scenarioEvaluation = evaluateAssertionId(scenarioToken, spawnPoints);
  const target = frozenTargetMapping
    ? { matchedPoints: evaluations.reduce((sum, item) => sum + item.matchedPoints, 0),
      status: evaluations.every((item) => item.status === 'satisfied') ? 'satisfied'
        : evaluations.some((item) => item.status === 'failed') ? 'failed'
          : evaluations.some((item) => item.status === 'skipped') ? 'skipped' : 'missing' }
    : scenarioEvaluation;
  verdict.execution.target = {
    token: scenarioToken,
    mapping: frozenTargetMapping ? 'frozen-assertions' : 'scenario-token',
    found: target.matchedPoints > 0,
    status: target.matchedPoints === 0 ? null : target.status === 'satisfied' ? 'ok' : target.status,
  };

  if (failedAction) {
    if (failedAction.unverified) return notExercised(`${failedAction.unverified}: action-${failedAction.index} did not produce valid execution evidence`);
    return fail(`action-${failedAction.index}-failed (${failedAction.type}): ${failedAction.note ?? `exit ${failedAction.exitCode}`} (expected: ${failedAction.expected})`);
  }
  if (verdict.execution.fail > 0) {
    return fail('case-tests-failed: the executed case module reported failures against the frozen THEN');
  }
  if (verdict.execution.effectiveExecutions === 0) {
    return notExercised(`no-effective-execution: ${verdict.execution.tests} test point(s) observed, 0 passed, ${verdict.execution.skipped} skipped — zero effective execution never passes`);
  }
  const failedAssertion = evaluations.find((evaluation) => evaluation.status === 'failed');
  if (failedAssertion) {
    return fail(`required-assertion-failed: ${failedAssertion.id} executed and failed — the scenario WHEN/THEN was exercised and contradicted`);
  }
  const skippedAssertion = evaluations.find((evaluation) => evaluation.status === 'skipped');
  if (skippedAssertion) {
    return notExercised(`target-scenario-skipped: every executed test point for ${skippedAssertion.id} was skipped; skips are not execution`);
  }
  const unresolved = evaluations.filter((evaluation) => evaluation.status !== 'satisfied');
  if (unresolved.length > 0) {
    return notExercised(`assertion-mapping-not-verifiable: no executed test point maps to required assertion(s) ${unresolved.map((evaluation) => evaluation.id).join(', ')} — a green suite without the registered target is not a scenario pass (P1-04)`, {
      missing: unresolved.map((evaluation) => evaluation.id),
    });
  }
  if (!componentOnly || definition.runtimeBinding || typeof observeProtectedSource === 'function') {
    const source = await observeRuntime({ definition, observer: observeProtectedSource, candidate: verdict.candidate,
      actions: verdict.execution.actions, evidenceDir, checkId: verdict.journey?.requiredCheck ?? `V_${definition.scenario}`,
      requiredProofLevel: entry?.required_proof_level ?? 'component', requiredReadbacks: entry?.required_readbacks ?? [], evidenceHashes: { ...verdict.evidence.sha256 }, authorityRoot: entryPreflight?.root, componentOnly });
    if (source.error) return notExercised(`${source.error} (UNVERIFIED): actual protected Run/dispatch/current evidence was not established`);
    verdict.sourceObservation = source;
    if (!componentOnly) {
      verdict.scope = `managed/${entry.required_proof_level}`;
      // A qualified single check still cannot sign overall delivery/Journey closure.
    }
  }
  verdict.verdict = 'PASS';
  verdict.reason = null;
  return emit(EXIT_PASS);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDeliveryJourney();
}
