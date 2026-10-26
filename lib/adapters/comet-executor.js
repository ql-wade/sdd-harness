// Fixed CODE composition for the 0.5.0 composition-application host (task
// P1_3, revision 2026-10-26-comet-050-adoption-v1, ADR-0022). No worker JSON,
// environment value or module path chooses these consumers. Constructors and
// function shapes are not source/OS qualification: the protected bootstrap
// must supply the real current source ports. Missing registration fails
// closed.
//
// 0.5.0 face (replaces the retired 0002 managed-delivery injection ports
// runClassicCli/ensureClassicRuntimeRun/installManagedDeliveryHost — that
// patch chain is gone from the lock; its archive-follow/signing-scope
// session semantics that still hold here are reimplemented for this surface
// and marked [reuse 0.4.5-candidate] where they came from):
//   install        `comet application install <application.json>` — the
//                  compiled classic-full composition package
//                  (P2_4, integrations/comet/application) enters the project
//                  through the official installer; preview-first, the actual
//                  install carries the confirmed preview hash.
//   schedule       `comet runtime dispatch --application-file … --request …`
//                  is the ONLY entry that may advance an SDK composition Run
//                  (app/cli/runtime-command.ts; the basic state commands
//                  refuse a composition Run — classic-sdk-state-store.ts
//                  recoveryRequired). Building a base state write for this
//                  Run is refused here, not delegated.
//   gate receipts  the six managed gates R/A/T/P/V/Kp are composition
//                  extensions whose pass results are accepted ONLY through
//                  the packaged bindings validators
//                  (integrations/comet/application/bindings.mjs), which
//                  delegate every verdict to the pure lib/delivery gate —
//                  there is no fallback acceptance path in this module.
//   Kt             no composition extension exists for Kt (0.5.0 has no
//                  post-archive hook): the 0005 predicate
//                  (lib/adapters/comet.js knowledgeCloseoutBlocked) parks the
//                  SAME Run at <profile>.archive.execute until the optional
//                  knowledgeCloseout state field is required-and-completed.
//                  The WRITE path of that field is the supply/admission wave;
//                  this module only refuses overall completion while it is
//                  pending.
// Real host execution (application install against a live project, dispatch
// inside a real Run) is P1_4/P3_2/VERIFY — UNVERIFIED here by design.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { taskDefinitionDigest } from '../delivery/baseline.js';
import { admitEvidence } from '../delivery/evidence.js';
import { evaluate } from '../delivery/gate.js';
import {
  applicationInstallArgv,
  classicCompositionRecoveryRequest,
  classicCompositionStartRequest,
  knowledgeCloseoutBlocked,
  runtimeDispatchArgv,
  RUNTIME_REQUEST_OPERATIONS,
} from './comet.js';
import { createBindings } from '../../integrations/comet/application/bindings.mjs';

// The packaged composition (single source of truth, P2_4). The executor reads
// it — it never re-declares gates, extensions or validators that could drift
// from the compiled package.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMPOSITION_ROOT = path.join(repositoryRoot, 'integrations/comet/application');
const COMPOSITION_FILE = path.join(COMPOSITION_ROOT, 'composition.json');

const COMPOSITION_GATES = Object.freeze(['R', 'A', 'T', 'P', 'V', 'Kp']);
const KT_GATE = 'Kt';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const boundary = { scope: 'component/fixed-host-execution', managedClosureEligible: false };
// The packaged validator bindings, resolved once (createBindings is async and
// ambient-state free — see bindings.mjs: context is deliberately unread).
const bindingsPromise = createBindings();
// CODE object identity only; not a process/role/source qualification record.
const fixedEntries = new WeakMap();

export class CometExecutionError extends Error {
  constructor(code) { super(`UNVERIFIED: ${code}`); this.name = 'CometExecutionError'; this.code = code; }
}
const no = (code) => { throw new CometExecutionError(code); };
const clone = (value) => structuredClone(value);

function readComposition() {
  let document;
  try { document = JSON.parse(fs.readFileSync(COMPOSITION_FILE, 'utf8')); }
  catch { no('COMPOSITION_PACKAGE_REQUIRED'); }
  if (!object(document) || document.schema !== 'sdd.comet.classic-application.composition.v1'
    || document.base !== 'classic-full' || !Array.isArray(document.composition?.extensions)) no('COMPOSITION_PACKAGE_INVALID');
  return document;
}

// Gate -> extension mapping, read from the packaged composition (not
// re-declared): the six managed gates plus their validator refs.
function compositionGateMap(document) {
  const gates = new Map();
  for (const extension of document.composition.extensions) {
    if (!exact(extension, ['id', 'skillId', 'artifactRefs', 'validator', 'afterStep']) || !text(extension.id)
      || !text(extension.skillId) || !object(extension.validator)) no('COMPOSITION_PACKAGE_INVALID');
    const declared = fs.existsSync(path.join(COMPOSITION_ROOT, 'extensions', `${extension.id}.json`))
      ? JSON.parse(fs.readFileSync(path.join(COMPOSITION_ROOT, 'extensions', `${extension.id}.json`), 'utf8')) : null;
    if (!object(declared) || declared.id !== extension.id || !COMPOSITION_GATES.includes(declared.gate)
      || declared.validator?.id !== extension.validator.id || declared.validator?.version !== extension.validator.version) no('COMPOSITION_PACKAGE_INVALID');
    if (gates.has(declared.gate)) no('COMPOSITION_PACKAGE_INVALID');
    gates.set(declared.gate, {
      extensionId: extension.id,
      skillId: extension.skillId,
      afterStep: extension.afterStep,
      validator: Object.freeze({ ...extension.validator }),
      artifactRefs: Object.freeze([...extension.artifactRefs]),
    });
  }
  if (gates.size !== COMPOSITION_GATES.length || COMPOSITION_GATES.some((gate) => !gates.has(gate))) no('COMPOSITION_PACKAGE_INVALID');
  return gates;
}

function registrationInput(value) {
  if (value === undefined || value === null) no('HOST_REGISTRATION_REQUIRED');
  if (!exact(value, ['schemaVersion', 'projectRoot', 'change', 'runId', 'applicationFile'])
    || value.schemaVersion !== 1 || !text(value.projectRoot) || !path.isAbsolute(value.projectRoot)
    || !text(value.change) || !/^[a-z0-9][a-z0-9-]*$/.test(value.change) || !text(value.runId)
    // 0.5.0 invariant (assertBuiltInChangeInput): a Classic SDK Run's id IS
    // the change name — a second, divergent run identity is refused here.
    || value.runId !== value.change) no('HOST_REGISTRATION_INVALID');
  if (typeof value.applicationFile !== 'string' || !path.isAbsolute(value.applicationFile)
    || path.basename(value.applicationFile) !== 'application.json') no('HOST_REGISTRATION_INVALID');
  let projectRoot;
  try { projectRoot = fs.realpathSync(value.projectRoot); if (!fs.lstatSync(projectRoot).isDirectory()) no('PROJECT_ROOT_UNVERIFIED'); }
  catch { no('PROJECT_ROOT_UNVERIFIED'); }
  // The registered package must be THE packaged composition's compiled
  // application.json — a caller-supplied package never selects it. The
  // compile wave (composition.json#unverified) has not produced that file
  // yet at this revision: registration pins the canonical location, and the
  // install/dispatch paths below refuse to execute until it exists.
  const applicationFile = path.resolve(value.applicationFile);
  if (applicationFile !== path.join(COMPOSITION_ROOT, 'application.json')) no('APPLICATION_PACKAGE_MISMATCH');
  return { ...clone(value), projectRoot, applicationFile };
}

// These are the existing managed-host CODE ports, not a generic callback
// loader. In particular context/qualification never come from a job or
// result JSON. The original launch authority still owns signing.
export function createCometExecutor(options = {}) {
  if (!object(options) || Object.keys(options).some((key) => !['native', 'authority', 'registration'].includes(key))) no('HOST_OPTIONS_INVALID');
  const { native, authority, registration } = options;
  const composition = readComposition();
  const gateMap = compositionGateMap(composition);
  const fixed = registrationInput(registration);
  if (!object(native) || typeof native.runCometCli !== 'function') no('NATIVE_PORTS_REQUIRED');
  if (!object(authority) || ['issueDispatch', 'verifyDispatch'].some((key) => typeof authority[key] !== 'function')) no('AUTHORITY_PORTS_REQUIRED');
  const runCometCli = native.runCometCli.bind(native);
  const original = Object.freeze(Object.fromEntries(['issueDispatch', 'verifyDispatch'].map((key) => [key, authority[key].bind(authority)])));
  const changeDir = path.join(fixed.projectRoot, 'openspec/changes', fixed.change);
  const calls = new AsyncLocalStorage();
  // Volatile observation only. No durable action, lease, queue, phase or
  // retry record is created here. Judged receipts live in this process's
  // memory for the signing-scope check and are never persisted as control
  // state; re-judging the same execution replaces the prior entry.
  const judged = new Map();

  const active = () => {
    const call = calls.getStore();
    if (!call || call.runId !== fixed.runId || call.kind !== 'native') no('ORIGINAL_NATIVE_CALL_REQUIRED');
    return call;
  };

  const validatorFor = (gate) => {
    const entry = gateMap.get(gate);
    if (!entry) no('ACTION_NOT_REGISTERED');
    return entry;
  };

  const host = Object.freeze({
    authority: Object.freeze({
      ...original,
      issueDispatch(binding) {
        active();
        // [reuse 0.4.5-candidate] signing-scope semantics, re-based: the
        // authority signs ONLY inside an executor-scoped native call, and
        // only a gate whose extension result this executor judged accepted,
        // for THIS run, bound to the same input digest — a stale, foreign or
        // unjudged binding never reaches the signature.
        const record = judged.get(binding?.execution);
        if (!record || record.gate !== binding?.gate || record.run !== fixed.runId
          || record.inputDigest !== binding?.inputDigest
          || !fs.existsSync(path.join(changeDir, '.comet-state.lock'))) no('NATIVE_SIGNING_SCOPE_REQUIRED');
        return original.issueDispatch(binding);
      },
    }),
    definitionDigest: taskDefinitionDigest,
    admitEvidence,
    evaluate,
  });

  const executor = Object.freeze({
    ...boundary,
    // `comet application install` — construction + delegation through the
    // fixed CLI port. The preview/install confirmation flow (hash) is the
    // real host wave's responsibility; here the argv must be exactly the
    // official installer's.
    applicationInstallArgv,
    async installApplication(install = {}) {
      if (!object(install) || Object.keys(install).some((key) => !['platforms', 'host', 'scope', 'upgrade', 'confirmationHash', 'preview'].includes(key))) no('APPLICATION_INSTALL_INVALID');
      return calls.run({ kind: 'native', runId: fixed.runId }, async () => {
        // The compile wave must have produced the package before the official
        // installer can run against it (honest UNVERIFIED boundary — the
        // supply wave owns the build, not this component).
        if (!fs.existsSync(fixed.applicationFile)) no('APPLICATION_PACKAGE_REQUIRED');
        const argv = applicationInstallArgv({
          applicationFile: fixed.applicationFile,
          project: fixed.projectRoot,
          platform: install.platforms,
          host: install.host,
          scope: install.scope,
          upgrade: install.upgrade,
          confirmationHash: install.confirmationHash,
          preview: install.preview,
          json: true,
        });
        return runCometCli([...argv], undefined, { projectRoot: fixed.projectRoot, invocationCwd: fixed.projectRoot });
      });
    },
    // The scoped native session for the real host wave: recording an
    // extension outcome, signing the judged binding and dispatching must all
    // happen inside one executor-scoped native call — the authority wrapper
    // below refuses to sign outside it.
    async nativeCall(fn) {
      if (typeof fn !== 'function') no('NATIVE_CALL_INVALID');
      return calls.run({ kind: 'native', runId: fixed.runId }, fn);
    },
    // `comet runtime dispatch --application-file …` request construction for
    // the composition Run. Only the declared read-only recovery operations
    // and the checked start request are constructed here; everything else a
    // composition Run needs (claim/record-outcome/…) is the real host wave.
    buildStartRequest(details) {
      return classicCompositionStartRequest({
        change: fixed.change,
        changeDir: path.relative(fixed.projectRoot, changeDir).split(path.sep).join('/'),
        workflowId: 'comet-classic-full',
        workflowVersion: '1',
        ...details,
      });
    },
    buildRecoveryRequest(details) {
      return classicCompositionRecoveryRequest({ change: fixed.change, ...details });
    },
    async dispatchRequest({ request, requestFile }) {
      return calls.run({ kind: 'native', runId: fixed.runId }, async () => {
        if (!object(request) || !RUNTIME_REQUEST_OPERATIONS.includes(request.operation) || request.runId !== fixed.runId) no('DISPATCH_REQUEST_INVALID');
        if (!text(requestFile) || !path.isAbsolute(requestFile)) no('DISPATCH_REQUEST_INVALID');
        const resolved = path.resolve(requestFile);
        if (resolved !== fixed.projectRoot && !resolved.startsWith(fixed.projectRoot + path.sep)) no('DISPATCH_REQUEST_INVALID');
        if (!fs.existsSync(fixed.applicationFile)) no('APPLICATION_PACKAGE_REQUIRED');
        const argv = runtimeDispatchArgv({
          applicationFile: fixed.applicationFile,
          requestFile: resolved,
          projectRoot: fixed.projectRoot,
          json: true,
        });
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, `${JSON.stringify(clone(request), null, 2)}\n`);
        return runCometCli([...argv], undefined, { projectRoot: fixed.projectRoot, invocationCwd: fixed.projectRoot });
      });
    },
    // The six-gate extension receipt acceptance: fail closed through the
    // packaged bindings validators. The upstream domain wrapper checks
    // verdict/sourceHash/artifactHashes BEFORE the validator runs — that
    // order is mirrored here, then the validator judges the gateEvidence
    // payload through the pure SDD.Gate.v1 evaluation. No fallback accepts.
    async acceptGateReceipt({ gate, execution, outcome }) {
      const entry = validatorFor(gate);
      if (!text(execution) || execution.length > 256) no('EXECUTION_INVALID');
      // Mirror of the domain wrapper's pre-validator binding (classic-
      // application.ts): the claimed pass must carry a bound sourceHash and
      // non-empty artifactHashes over the extension's declared artifactRefs
      // before any validator judges the gateEvidence payload.
      if (!object(outcome) || outcome.verdict !== 'pass' || !text(outcome.sourceHash)
        || !object(outcome.artifactHashes) || Object.keys(outcome.artifactHashes).length === 0
        || Object.values(outcome.artifactHashes).some((digest) => typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) no('EXTENSION_OUTCOME_INVALID');
      const bindings = await bindingsPromise;
      const validator = bindings.validators.find((candidate) => candidate.id === entry.validator.id && candidate.version === entry.validator.version);
      if (!validator) no('VALIDATOR_NOT_REGISTERED');
      const input = { run: { runId: fixed.runId }, action: { gate }, outcome: clone(outcome) };
      const verdict = validator.validate(input);
      if (!object(verdict) || verdict.accepted !== true) {
        return { accepted: false, gate, extensionId: entry.extensionId,
          reason: `SDD gate ${gate} extension ${entry.extensionId} refused: ${text(verdict?.reason) ? verdict.reason : 'no verdict'}` };
      }
      const evidence = outcome.output?.gateEvidence;
      judged.set(execution, {
        gate,
        run: fixed.runId,
        inputDigest: evidence?.inputs?.inputDigest,
      });
      return { accepted: true, gate, extensionId: entry.extensionId, validatorId: entry.validator.id };
    },
    // Kt: the 0005 read-side predicate. No dispatch, no state write — the
    // SAME Run simply may not be reported completed while the obligation is
    // required and unmet. The write path (wire keys, managed admission) is
    // the supply/admission wave — UNVERIFIED here.
    ktCloseout(stateLike = {}) {
      const state = stateLike.classic ?? stateLike;
      const blocked = knowledgeCloseoutBlocked(state);
      return Object.freeze({
        gate: KT_GATE,
        mechanism: 'upstream-minimal-patch-0005',
        blocked,
        overallCompletionEligible: !blocked,
        writePath: 'UNVERIFIED: supply/admission wave (composition.json knowledgeCloseout.writePath)',
      });
    },
    describeComposition() {
      return {
        ...boundary,
        base: composition.base,
        revision: composition.revision,
        applicationFile: fixed.applicationFile,
        gates: Object.fromEntries([...gateMap.entries()].map(([gate, entry]) => [gate, clone(entry)])),
        kt: this.ktCloseout(),
        runtimeAccepted: composition.runtimeAccepted === true,
      };
    },
    host,
  });
  fixedEntries.set(executor, (argv) => {
    // The bootstrap main may forward ONLY a runtime dispatch for the
    // registered application package — a base state write for a composition
    // Run is refused (0.5.0: those commands reject composition Runs anyway).
    const words = argv.filter((arg) => arg !== '--json');
    if (words[0] !== 'runtime' || words[1] !== 'dispatch' || words.includes('--application') || words.includes('--workflow')) no('NATIVE_COMMAND_SCOPE_REQUIRED');
    return calls.run({ kind: 'native', runId: fixed.runId }, async () => {
      const requestFile = words[words.indexOf('--request') + 1];
      if (words[words.indexOf('--application-file') + 1] !== fixed.applicationFile
        || !text(requestFile) || !path.isAbsolute(requestFile)) no('NATIVE_COMMAND_SCOPE_REQUIRED');
      // Request validation first: a foreign or malformed request never even
      // reaches the package-existence boundary.
      let request;
      try { request = JSON.parse(fs.readFileSync(requestFile, 'utf8')); }
      catch { no('DISPATCH_REQUEST_INVALID'); }
      if (!object(request) || request.runId !== fixed.runId || !RUNTIME_REQUEST_OPERATIONS.includes(request.operation)) no('DISPATCH_REQUEST_INVALID');
      if (!fs.existsSync(fixed.applicationFile)) no('APPLICATION_PACKAGE_REQUIRED');
      return runCometCli([...argv], undefined, { projectRoot: fixed.projectRoot, invocationCwd: fixed.projectRoot });
    });
  });
  return executor;
}

function bootstrapResult(status, code, exitCode) {
  return { exitCode, stdout: JSON.stringify({ status, code, scope: 'component/fixed-host-bootstrap',
    managedClosureEligible: false, productionQualified: false }) + '\n' };
}

function bootstrapArguments(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.length > 16
    || Array.from(argv).some((arg) => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) return false;
  const words = argv[0] === '--json' ? argv.slice(1) : argv;
  if (words[0] !== 'runtime' || words[1] !== 'dispatch' || words.includes('--json')) return false;
  const flags = ['--application-file', '--request', '--project-root', '--details'];
  for (let index = 2; index < words.length; index += 1) {
    if (!flags.includes(words[index])) return false;
    if (words[index] !== '--details' && !text(words[index + 1])) return false;
    if (words[index] === '--details') continue;
    index += 1;
  }
  return words.includes('--application-file') && words.includes('--request');
}

export async function runCometHostMain(argv, executor) {
  try {
    if (!bootstrapArguments(argv)) return bootstrapResult('INPUT_INVALID', 'NATIVE_COMMAND_SCOPE_REQUIRED', 1);
    if (executor === undefined) return bootstrapResult('UNVERIFIED', 'PROTECTED_BOOTSTRAP_REQUIRED', 2);
    const invoke = fixedEntries.get(executor);
    if (!invoke) return bootstrapResult('INPUT_INVALID', 'FIXED_HOST_CAPABILITY_REQUIRED', 1);
    const result = await invoke([...argv]);
    if (!object(result) || ![0, 1, 2].includes(result.exitCode) || typeof result.stdout !== 'string'
      || Buffer.byteLength(result.stdout) > 8 * 1024 * 1024) {
      return bootstrapResult('INTERNAL_FAILURE', 'NATIVE_RESULT_INVALID', 1);
    }
    return { ...boundary, productionQualified: false, exitCode: result.exitCode, stdout: result.stdout };
  } catch (error) {
    if (error instanceof CometExecutionError) {
      if (error.code === 'NATIVE_COMMAND_SCOPE_REQUIRED' || error.code === 'DISPATCH_REQUEST_INVALID') return bootstrapResult('INPUT_INVALID', error.code, 1);
      // The honest UNVERIFIED boundary keeps its specific code: a missing
      // compiled package is a supply-wave fact, not an internal failure.
      if (error.code === 'APPLICATION_PACKAGE_REQUIRED') return bootstrapResult('UNVERIFIED', error.code, 2);
      return bootstrapResult('UNVERIFIED', 'PROTECTED_HOST_INVOCATION_UNVERIFIED', 2);
    }
    return bootstrapResult('INTERNAL_FAILURE', 'BOOTSTRAP_INTERNAL_FAILURE', 1);
  }
}

let isMain = false;
try { isMain = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
catch { /* Importing the CODE module never selects a CLI or provider. */ }
if (isMain) {
  const result = await runCometHostMain(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}
