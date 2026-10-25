// Fixed CODE composition for the original Classic managed host. No worker
// JSON, environment value or module path chooses these consumers. Constructors
// and function shapes are not source/OS qualification: the protected bootstrap
// must supply the real current source ports. Missing registration fails closed.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { parseContract } from '../../contracts/delivery/index.js';
import { taskDefinitionDigest } from '../delivery/baseline.js';
import { admitEvidence, envelopeDigest } from '../delivery/evidence.js';
import { evaluate } from '../delivery/gate.js';
import { createCliJobDriver } from '../../tools/infra/runner.mjs';

const GATES = ['R', 'A', 'T', 'P', 'V', 'Kp', 'Kt'];
const STATE_OPERATIONS = ['get', 'next', 'gates', 'dispatch-gate', 'accept-gate', 'transition', 'set', 'complete-design'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const boundary = { scope: 'component/fixed-host-execution', managedClosureEligible: false };

export class CometExecutionError extends Error {
  constructor(code) { super(`UNVERIFIED: ${code}`); this.name = 'CometExecutionError'; this.code = code; }
}
const no = (code) => { throw new CometExecutionError(code); };
const clone = (value) => structuredClone(value);
const synchronous = (value) => typeof value === 'function'
  && !['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(value.constructor?.name);

function eligible(current) {
  const qualification = current.admissionOptions?.sourceQualification;
  const clock = current.admissionOptions?.now;
  if (!object(qualification) || qualification.scope !== 'protected-source' || qualification.status !== 'qualified'
    || typeof clock !== 'string' || !Number.isFinite(Date.parse(clock)) || typeof qualification.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(qualification.expiresAt)) || Date.parse(qualification.expiresAt) <= Date.parse(clock)
    || !['id', 'sourceId', 'revision'].every((key) => text(qualification[key]))
    || !Array.isArray(qualification.evidenceRefs) || !qualification.evidenceRefs.length
    || qualification.evidenceRefs.some((ref) => !object(ref) || !text(ref.ref) || typeof ref.digest !== 'string' || !/^[a-f0-9]{64}$/.test(ref.digest))) no('SOURCE_UNQUALIFIED');
}

function registrationInput(value) {
  if (value === undefined || value === null) no('HOST_REGISTRATION_REQUIRED');
  if (!exact(value, ['schemaVersion', 'projectRoot', 'change', 'runId', 'runner', 'docker', 'actions'])
    || value.schemaVersion !== 1 || !text(value.projectRoot) || !path.isAbsolute(value.projectRoot)
    || !text(value.change) || !/^[a-z0-9][a-z0-9-]*$/.test(value.change) || !text(value.runId)
    || !object(value.runner) || !Array.isArray(value.runner.roles)
    || !exact(value.docker, ['executable', 'sha256']) || !text(value.docker.executable)
    || !path.isAbsolute(value.docker.executable) || typeof value.docker.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.docker.sha256)
    || !Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > GATES.length) no('HOST_REGISTRATION_INVALID');
  const seen = new Set();
  for (const action of value.actions) {
    if (!exact(action, ['gate', 'roleBindingId', 'argv']) || !GATES.includes(action.gate) || seen.has(action.gate)
      || !text(action.roleBindingId) || !Array.isArray(action.argv) || action.argv.length < 1 || action.argv.length > 64
      || action.argv.some((arg) => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) no('HOST_REGISTRATION_INVALID');
    seen.add(action.gate);
  }
  let projectRoot;
  try { projectRoot = fs.realpathSync(value.projectRoot); if (!fs.lstatSync(projectRoot).isDirectory()) no('PROJECT_ROOT_UNVERIFIED'); }
  catch { no('PROJECT_ROOT_UNVERIFIED'); }
  return { ...clone(value), projectRoot };
}

// These are the existing classic-managed-host CODE ports, not a generic
// callback loader. In particular context/qualification never come from a job
// or result JSON. The original Native kernel still owns signing and acceptance.
export function createCometExecutor(options = {}) {
  if (!object(options) || Object.keys(options).some((key) => !['native', 'authority', 'registration', 'source'].includes(key))) no('HOST_OPTIONS_INVALID');
  const { native, authority, registration, source } = options;
  const fixed = registrationInput(registration);
  if (!object(native) || ['runClassicCli', 'ensureClassicRuntimeRun', 'installManagedDeliveryHost'].some((key) => typeof native[key] !== 'function')) no('NATIVE_PORTS_REQUIRED');
  if (!object(authority) || ['issueDispatch', 'verifyDispatch', 'collectResult', 'verifyCollection'].some((key) => typeof authority[key] !== 'function')) no('AUTHORITY_PORTS_REQUIRED');
  if (!object(source) || ['policy', 'context', 'authorizeWrite', 'verifyReview'].some((key) => !synchronous(source[key]))) no('PROTECTED_SOURCE_PORTS_REQUIRED');
  const ports = Object.freeze(Object.fromEntries(['policy', 'context', 'authorizeWrite', 'verifyReview'].map((key) => [key, source[key]])));
  const original = Object.freeze(Object.fromEntries(['issueDispatch', 'verifyDispatch', 'collectResult', 'verifyCollection'].map((key) => [key, authority[key].bind(authority)])));
  const runtime = Object.freeze(Object.fromEntries(['runClassicCli', 'ensureClassicRuntimeRun', 'installManagedDeliveryHost'].map((key) => [key, native[key].bind(native)])));
  const changeDir = path.join(fixed.projectRoot, 'openspec/changes', fixed.change);
  const calls = new AsyncLocalStorage();
  // Volatile observation/cache only. No durable action, lease, queue, phase or
  // retry record is created here. Cold launch reconciliation needs the original
  // Native execution record; until that port exists it is explicitly refused.
  const createdHere = new Set(), observed = new Map();
  let installed = false;

  const active = () => {
    const call = calls.getStore();
    if (!call || call.runId !== fixed.runId) no('ORIGINAL_NATIVE_CALL_REQUIRED');
    return call;
  };
  const bind = (intent) => {
    const call = active();
    if (!object(intent) || !GATES.includes(intent.gate) || !text(intent.execution)) no('NATIVE_AUTHOR_ACTION_PORT_REQUIRED');
    if (intent.runId !== undefined && intent.runId !== fixed.runId) no('ORIGINAL_RUN_MISMATCH');
    const template = fixed.actions.find((entry) => entry.gate === intent.gate);
    if (!template) no('ACTION_NOT_REGISTERED');
    const current = ports.context(clone(intent));
    if (!object(current) || !object(current.admissionOptions) || !object(current.policy)) no('PROTECTED_CONTEXT_REQUIRED');
    const parsed = parseContract('SDD.Delivery.ActionBinding', current.actionBinding);
    if (!parsed.ok) no('PROTECTED_ACTION_REQUIRED');
    const action = parsed.value;
    if (action.profile !== 'comet-managed-v2' || action.run !== fixed.runId || action.gate !== intent.gate
      || ['execution', 'role', 'attempt', 'epoch', 'inputDigest'].some((key) => action[key] !== intent[key])
      || action.policyDigest !== current.policy.digest) no('ORIGINAL_ACTION_MISMATCH');
    const role = fixed.runner.roles.filter((entry) => object(entry) && entry.id === template.roleBindingId && entry.actionRole === action.role);
    if (role.length !== 1) no('ROLE_NOT_REGISTERED');
    // Project unqualified/expired facts too: the original Native invalidation
    // observer must see them and retire old intents. Eligibility is enforced
    // separately at signing and physical launch, never hidden by this reader.
    const job = { schemaVersion: 1, execution: action.execution, run: action.run, argv: [...template.argv] };
    const inputs = [...action.inputs];
    for (const [name, ref, digest] of [
      ['runner-registration', 'host/runner-registration', envelopeDigest(fixed.runner)],
      ['runner-role-binding', `host/roles/${role[0].id}`, envelopeDigest(role[0])],
      ['runner-job', `host/jobs/${action.execution}`, envelopeDigest(job)],
    ]) {
      const prior = inputs.find((item) => item.name === name);
      if (prior && prior.digest !== digest) no('PROTECTED_INPUT_BINDING_MISMATCH');
      if (!prior) inputs.push({ name, ref, digest });
    }
    const bound = parseContract('SDD.Delivery.ActionBinding', { ...action, inputs });
    if (!bound.ok) no('PROTECTED_ACTION_REQUIRED');
    const result = { ...current, actionBinding: bound.value };
    call.bindings.set(intent.execution, result);
    return { current: result, job, role: role[0] };
  };

  const host = Object.freeze({
    authority: Object.freeze({
      ...original,
      issueDispatch(binding) {
        const call = active(), prepared = call.bindings.get(binding?.execution);
        if (call.kind !== 'native' || !prepared || !fs.existsSync(path.join(changeDir, '.comet-state.lock'))
          || envelopeDigest(binding.actionBinding) !== envelopeDigest(prepared.actionBinding)) no('NATIVE_SIGNING_SCOPE_REQUIRED');
        eligible(prepared);
        const dispatch = original.issueDispatch(binding);
        createdHere.add(dispatch.execution);
        return dispatch;
      },
    }),
    policy(request) { active(); return ports.policy(request); },
    context(intent) { return bind(intent).current; },
    definitionDigest: taskDefinitionDigest,
    authorizeWrite(request) { active(); return ports.authorizeWrite(request); },
    verifyReview(request) { active(); return ports.verifyReview(request); },
    admitEvidence,
    evaluate,
    async readResult(intent) {
      active();
      const record = observed.get(intent?.execution);
      if (!record?.terminal) no('ORIGINAL_EXECUTION_UNRESOLVED');
      await record.terminal;
      await currentIntent(intent.execution);
      if (!record.packet) no('ORIGINAL_EXECUTION_UNVERIFIED');
      return clonePacket(record.packet);
    },
  });
  const physical = createCliJobDriver({ authority: host.authority, registration: fixed.runner,
    dockerExecutable: fixed.docker.executable, dockerSha256: fixed.docker.sha256 });
  const invoke = async (argv) => {
    if (!installed) no('FIXED_HOST_NOT_INSTALLED');
    if (!Array.isArray(argv) || !argv.length || argv.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) no('NATIVE_ARGUMENTS_INVALID');
    // Forward the existing kernel's scoped state operations, not an arbitrary
    // program, second Run, Spec owner or raw external-command forwarding path.
    const words = argv.filter((arg) => arg !== '--json');
    if (words[0] !== 'state' || !STATE_OPERATIONS.includes(words[1]) || words[2] !== fixed.change
      || words.includes('--') || words.includes('--project-root') || words.includes('--cwd')) no('NATIVE_COMMAND_SCOPE_REQUIRED');
    return calls.run({ kind: 'native', runId: fixed.runId, bindings: new Map() }, () => runtime.runClassicCli(argv, undefined,
      { projectRoot: fixed.projectRoot, invocationCwd: fixed.projectRoot }));
  };
  const readField = async (field) => {
    const result = await runtime.runClassicCli(['--json', 'state', 'get', fixed.change, field], undefined,
      { projectRoot: fixed.projectRoot, invocationCwd: fixed.projectRoot });
    let document;
    try { document = JSON.parse(result.stdout); } catch { no('ORIGINAL_NATIVE_READ_UNVERIFIED'); }
    if (result.exitCode !== 0 || document.exitCode !== 0) no('ORIGINAL_NATIVE_READ_UNVERIFIED');
    return document.stdout?.trim();
  };
  const currentIntent = async (execution) => {
    active();
    if (!text(execution) || execution.length > 256) no('EXECUTION_INVALID');
    const context = await runtime.ensureClassicRuntimeRun(changeDir);
    if (context.run.runId !== fixed.runId || context.run.status === 'completed') no('ORIGINAL_RUN_MISMATCH');
    let registry;
    try { const raw = await readField('gate_dispatches'); registry = raw === 'null' ? { dispatches: [] } : JSON.parse(raw); }
    catch { no('ORIGINAL_INTENT_UNVERIFIED'); }
    if (!object(registry) || !Array.isArray(registry.dispatches)) no('ORIGINAL_INTENT_UNVERIFIED');
    const matches = registry.dispatches.filter((item) => object(item) && item.execution === execution);
    if (matches.length !== 1 || matches[0].state !== 'open' || matches[0].runId !== fixed.runId) no('ORIGINAL_INTENT_NOT_CURRENT');
    const intent = matches[0], bound = bind({ ...intent, projectRoot: fixed.projectRoot, changeDir });
    eligible(bound.current);
    if (original.verifyDispatch(intent.protectedDispatch).ok !== true
      || envelopeDigest(bound.current.actionBinding) !== envelopeDigest(intent.actionBinding)
      || envelopeDigest(intent.protectedDispatch.actionBinding) !== envelopeDigest(intent.actionBinding)) no('ORIGINAL_INTENT_STALE');
    return { intent, ...bound };
  };
  const requestInput = (input) => {
    if (!exact(input, ['execution']) || !text(input.execution)) no('EXECUTION_REQUEST_INVALID');
    return input.execution;
  };
  const underSnapshot = (fn) => calls.run({ kind: 'snapshot', runId: fixed.runId, bindings: new Map() }, fn);
  const originalProcess = (execution) => {
    const record = observed.get(execution);
    if (!record?.handle) no('ORIGINAL_HANDLE_REQUIRED');
    return record;
  };
  const finish = async (record, terminal) => {
    record.raw = terminal;
    if (terminal.status !== 'CLIENT_TERMINAL' || terminal.outputTruncated || terminal.signal || terminal.clientExitCode === null) return terminal;
    const seen = physical.observeCliJob({ ...record.request, handle: record.handle });
    record.observation = seen;
    if (seen.observation.state !== 'exited' || seen.observation.exitCode !== terminal.clientExitCode) return terminal;
    let packet;
    try { packet = JSON.parse(terminal.stdoutBytes.toString('utf8')); } catch { return terminal; }
    if (!exact(packet, ['schemaVersion', 'run', 'execution', 'envelope', 'reportBase64', 'resultBase64', 'methodTraceBase64'])
      || packet.schemaVersion !== 1 || packet.run !== fixed.runId || packet.execution !== record.request.job.execution) return terminal;
    const bytes = [];
    for (const name of ['reportBase64', 'resultBase64', 'methodTraceBase64']) {
      if (typeof packet[name] !== 'string' || packet[name].length > 8 * 1024 * 1024) return terminal;
      const raw = Buffer.from(packet[name], 'base64');
      if (!raw.length || raw.toString('base64') !== packet[name]) return terminal;
      bytes.push(raw);
    }
    record.packet = { dispatch: record.request.dispatch, envelope: packet.envelope,
      launchRecord: { launchId: `native:${record.handle.containerId}`, execution: packet.execution,
        processId: terminal.clientProcessId, containerId: record.handle.containerId },
      reportBytes: bytes[0], resultBytes: bytes[1], methodTraceBytes: bytes[2] };
    return terminal;
  };

  return Object.freeze({
    ...boundary,
    install() {
      if (installed) no('FIXED_HOST_ALREADY_INSTALLED');
      runtime.installManagedDeliveryHost(host); installed = true;
      return { ...boundary, installed: true, productionQualified: false };
    },
    invokeNative: invoke,
    async describeCurrent() {
      return underSnapshot(async () => {
        if (!installed) no('FIXED_HOST_NOT_INSTALLED');
        const context = await runtime.ensureClassicRuntimeRun(changeDir);
        if (context.run.runId !== fixed.runId) no('ORIGINAL_RUN_MISMATCH');
        const read = async (command) => {
          const result = await runtime.runClassicCli(['--json', 'state', command, fixed.change], undefined,
            { projectRoot: fixed.projectRoot, invocationCwd: fixed.projectRoot });
          let document;
          try { document = JSON.parse(result.stdout); } catch { no('ORIGINAL_NATIVE_READ_UNVERIFIED'); }
          if (result.exitCode !== 0 || document.exitCode !== 0) no('ORIGINAL_NATIVE_READ_UNVERIFIED');
          return document.data;
        };
        const next = await read('next'), gates = await read('gates');
        return { ...boundary, run: clone(context.run), phase: context.classic.phase,
          continuation: clone(next.continuation), nextAction: clone(next.nextAction), taskState: clone(next.taskState), gates,
          authoring: { status: 'UNVERIFIED', code: 'NATIVE_AUTHOR_ACTION_PORT_REQUIRED' } };
      });
    },
    async execute(input) {
      const execution = requestInput(input);
      return underSnapshot(async () => {
        if (!installed) no('FIXED_HOST_NOT_INSTALLED');
        const current = await currentIntent(execution);
        const known = observed.get(execution);
        if (known) {
          if (!known.handle) no('ORIGINAL_EXECUTION_UNRESOLVED');
          return { ...boundary, resumed: true, ...physical.observeCliJob({ ...known.request, handle: known.handle }), terminal: known.terminal };
        }
        if (!createdHere.has(execution)) no('NATIVE_EXECUTION_RECOVERY_PORT_REQUIRED');
        const request = { dispatch: current.intent.protectedDispatch, currentActionBinding: current.current.actionBinding, job: current.job };
        const record = { request }; observed.set(execution, record);
        let started;
        try { started = physical.startCliJob(request); } catch { no('PHYSICAL_START_UNVERIFIED'); }
        record.handle = started.handle;
        if (!started.terminal) no('ORIGINAL_EXECUTION_UNRESOLVED');
        record.terminal = started.terminal.then((terminal) => finish(record, terminal));
        return { ...boundary, handle: record.handle, clientProcessId: started.clientProcessId, terminal: record.terminal };
      });
    },
    observe(input) {
      const record = originalProcess(requestInput(input));
      return { ...boundary, ...physical.observeCliJob({ ...record.request, handle: record.handle }) };
    },
    stop(input) {
      const record = originalProcess(requestInput(input));
      return { ...boundary, ...physical.stopCliJob({ ...record.request, handle: record.handle }) };
    },
    readSourceRecord(input) {
      const record = observed.get(requestInput(input));
      if (!record?.packet) no('ORIGINAL_RESULT_UNVERIFIED');
      return { ...clonePacket(record.packet), ...boundary, physical: clone(record.observation), terminal: {
        processId: record.raw.clientProcessId, exitCode: record.raw.clientExitCode, status: record.raw.status,
      } };
    },
  });
}

function clonePacket(packet) {
  return { ...clone({ dispatch: packet.dispatch, envelope: packet.envelope, launchRecord: packet.launchRecord }),
    reportBytes: Buffer.from(packet.reportBytes), resultBytes: Buffer.from(packet.resultBytes), methodTraceBytes: Buffer.from(packet.methodTraceBytes) };
}
