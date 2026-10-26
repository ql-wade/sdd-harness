// Comet 0.5.0 host adapter (task P1_3, revision 2026-10-26-comet-050-adoption-v1).
//
// Everything here is the REAL interface of the pinned 0.5.0 build (source lock
// integrations/comet/upstream.lock.json, commit aeb1a659…, patches []),
// not a parallel control plane: the Classic Run keeps its single RunState,
// its .comet-state lock and its state transaction, and there is no second
// currentPhase anywhere in this module (Comet.Run.managedDelivery.v1).
// 0.5.0 discovery facts (pristine domains/comet-classic + live scratch probe
// against builds/29f2332b…, recorded in host-probes/1_3-050-surface.json):
//   project config        <root>/.comet/config.yaml (comet.project.v1)
//   change control state  <changesRoot>/<change>/comet-state.yaml
//                         (SDK default, NATIVE_CHANGE_STATE_FILE) with the
//                         legacy .comet.yaml still readable — upstream
//                         resolveClassicStateFile keeps whichever name exists,
//                         refuses symlinks/directories, and refuses the change
//                         outright when BOTH exist (ClassicStateFileConflict)
//   state lock            <changeDir>/.comet-state.lock (recoverable file lock)
//   state transaction     <changeDir>/.comet-state-transaction.json
//   change selection      <root>/.comet/current-change.json (comet.selection.v2)
//   check logs            <changeDir>/.comet/checks/<uuid>.log (real runtime
//                         checks; manual record-check declarations never
//                         satisfy the guard — observed upstream refusal)
//   check policy          <root>/.comet/check-policy.json — version 2 binds
//                         command identity per entry (argv+cwd), so unrelated
//                         entries no longer invalidate this command's evidence
//                         (classic-check-policy.ts CheckPolicy.entryDigest)
//   composition apps      `comet application install <pkg>` installs a compiled
//                         SDK application package; SDK composition Runs are
//                         driven ONLY through
//                         `comet runtime dispatch --application-file <pkg>`
//                         (app/cli/runtime-command.ts) — the basic state
//                         commands refuse to advance a composition Run
//                         (classic-sdk-state-store.ts recoveryRequired emits
//                         the runtime-dispatch argv for application Runs)
//   Kt closeout           0.5.0 has no post-archive hook; integrations/comet/
//                         patches/0005-comet-050-kt-closeout.patch pins the
//                         read-side predicate: an archived run with the
//                         optional knowledgeCloseout state field
//                         { required, completed } parks at
//                         <profile>.archive.execute (same Run) instead of
//                         'completed' until required===true is completed.
//                         The WRITE path of that field is the supply/admission
//                         wave — see knowledgeCloseoutBlocked below.
// The phase guard denies cross-phase product writes for the attributed edit
// channel with the claude hook contract (exit 2, "COMET PHASE GUARD — WRITE
// BLOCKED"); Shell and MCP write channels are not attributed by the guard —
// probeWriteChannels records that fact as a capability gap (A09: a gap is
// never recorded as blocked) instead of claiming coverage.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLaunchAuthority } from '../delivery/evidence.js';
import { evaluate } from '../delivery/gate.js';
export { createCometExecutor } from './comet-executor.js';

export const RUNNER_ID = 'comet-classic';

// 0.5.0 state-file face (pristine domains/comet-classic/classic-state-file.ts):
// the SDK default name for new state, the legacy name still readable, and the
// upstream default when neither exists.
export const CHANGE_STATE_FILE = 'comet-state.yaml';
export const LEGACY_CHANGE_STATE_FILE = '.comet.yaml';
export const CHANGE_STATE_FILES = Object.freeze([CHANGE_STATE_FILE, LEGACY_CHANGE_STATE_FILE]);

// Runner.Dispatch.v1 for the single Comet master: the authority is bound to
// one run id, so a dispatch or a verified record from any other run is
// refused before it can be confused with this run's receipts (F07).
export function cometLaunchAuthority({ secret, runId, sourceVerifier }) {
  if (typeof runId !== 'string' || runId.length === 0) {
    const error = new Error('cometLaunchAuthority: runId is required — the authority is bound to exactly one Comet run');
    error.code = 'RUN_ID_REQUIRED';
    throw error;
  }
  const authority = createLaunchAuthority({ secret, sourceVerifier });
  return Object.freeze({
    runId,
    issueDispatch(binding) {
      if (binding?.run !== runId) {
        const error = new Error(`issueDispatch: binding run ${String(binding?.run)} does not match the authority run ${runId} (F07: receipts must carry the bound run id)`);
        error.code = 'RUN_MISMATCH';
        throw error;
      }
      if (binding?.runnerId !== undefined && binding.runnerId !== RUNNER_ID) {
        const error = new Error(`issueDispatch: runnerId ${String(binding.runnerId)} does not match the single Comet Classic master runner ${RUNNER_ID}`);
        error.code = 'RUNNER_MISMATCH';
        throw error;
      }
      return authority.issueDispatch({ ...binding, runnerId: RUNNER_ID });
    },
    verifyDispatch(record) {
      if (record?.run !== runId) {
        return { ok: false, error: 'RUN_MISMATCH', errors: [`record run ${String(record?.run)} does not match the authority run ${runId}`] };
      }
      return authority.verifyDispatch(record);
    },
    async collectResult(packet) {
      if (packet?.dispatch?.run !== runId) return { ok: false, error: 'RUN_MISMATCH' };
      return authority.collectResult(packet);
    },
    verifyCollection(packet) {
      if (packet?.dispatch?.run !== runId) return { ok: false, error: 'RUN_MISMATCH' };
      return authority.verifyCollection(packet);
    },
  });
}

// Mirror of upstream resolveClassicStateFile semantics (read side only): the
// name that exists wins; both names at once is an ambiguous state the run
// refuses to touch; a symlink/directory is refused; the 0.5.0 default for a
// change with no state yet is comet-state.yaml. This never writes or renames.
export async function resolveChangeStateFile(changeDir) {
  const found = [];
  for (const name of CHANGE_STATE_FILES) {
    const target = path.join(changeDir, name);
    let stat;
    try { stat = await fs.lstat(target); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    found.push({ name, target, stat });
  }
  if (found.length > 1) {
    const error = new Error(`classic state files are ambiguous in ${changeDir}: ${CHANGE_STATE_FILES.join(' and ')} both exist; preserve both files and resolve the conflict before continuing`);
    error.code = 'WORKSPACE_STATE_CONFLICT';
    throw error;
  }
  if (found.length === 1) {
    const { name, target, stat } = found[0];
    if (!stat.isFile()) {
      const error = new Error(`classic state must be a regular file, not a symlink or directory: ${target}`);
      error.code = 'WORKSPACE_STATE_INVALID';
      throw error;
    }
    return { file: target, name, legacy: name === LEGACY_CHANGE_STATE_FILE, default: false };
  }
  return { file: path.join(changeDir, CHANGE_STATE_FILE), name: CHANGE_STATE_FILE, legacy: false, default: true };
}

function hookRegistration(settings) {
  const preToolUse = settings?.hooks?.PreToolUse;
  if (!Array.isArray(preToolUse) || preToolUse.length === 0) {
    const error = new Error('no PreToolUse Comet hook registration in .claude/settings.local.json');
    error.code = 'WORKSPACE_HOOK_MISSING';
    throw error;
  }
  const entry = preToolUse.find((candidate) => candidate?.hooks?.[0]?.args?.includes('--platform'));
  if (!entry) {
    const error = new Error('PreToolUse registration does not invoke the Comet hook router');
    error.code = 'WORKSPACE_HOOK_MISSING';
    throw error;
  }
  return {
    hookMatcher: entry.matcher,
    hookCommand: entry.hooks[0].command,
    routerPath: entry.hooks[0].args[0],
  };
}

// The workspace half of the authority/workspace/execution interface: real
// paths and the real host hook registration, discovered and verified against
// the live project instead of assumed. The change control state is resolved
// with the 0.5.0 dual-name rule (comet-state.yaml default, legacy .comet.yaml
// readable, both-present refused).
export async function describeWorkspace({ projectRoot, change }) {
  const changeDir = path.join(projectRoot, 'docs/openspec/changes', change);
  const settingsFile = path.join(projectRoot, '.claude/settings.local.json');
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      error.code = 'WORKSPACE_HOOK_MISSING';
      error.message = 'the project has no .claude/settings.local.json hook registration; run comet init first';
    }
    throw error;
  }
  const hook = hookRegistration(settings);
  if (!await fs.access(hook.routerPath).then(() => true, () => false)) {
    const error = new Error(`the registered guard router is missing on disk: ${hook.routerPath}`);
    error.code = 'WORKSPACE_HOOK_MISSING';
    throw error;
  }
  const state = await resolveChangeStateFile(changeDir);
  return Object.freeze({
    projectRoot,
    projectConfig: path.join(projectRoot, '.comet/config.yaml'),
    changeStateFile: state.file,
    changeStateName: state.name,
    changeStateLegacy: state.legacy,
    changeStateDefaulted: Boolean(state.default),
    runStateFile: path.join(changeDir, '.comet/run-state.json'),
    stateLockFile: path.join(changeDir, '.comet-state.lock'),
    stateTransactionFile: path.join(changeDir, '.comet-state-transaction.json'),
    selectionFile: path.join(projectRoot, '.comet/current-change.json'),
    checkPolicyFile: path.join(projectRoot, '.comet/check-policy.json'),
    checksDir: path.join(changeDir, '.comet/checks'),
    ...hook,
  });
}

// --- 0.5.0 composition-application command construction ----------------------
//
// These builders are ARGV/REQUEST CONSTRUCTION ONLY (their execution belongs
// to the real host waves — P1_4/P3_2 and VERIFY). They fail closed on any
// option the upstream CLI does not declare, so a caller cannot smuggle an
// arbitrary program, a second Run, or an unpinned application through them.

const APPLICATION_INSTALL_FLAGS = Object.freeze(['applicationFile', 'project', 'platform', 'host', 'scope', 'userRoot', 'upgrade', 'confirmationHash', 'preview', 'json']);
const APPLICATION_HOSTS = Object.freeze(['codex', 'claude-code']);
const APPLICATION_SCOPES = Object.freeze(['project', 'user']);

// `comet application install <file>` (app/cli/index.ts): preview first, then
// the confirmed preview hash installs the fixed version and platform entries.
export function applicationInstallArgv(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    const error = new Error('applicationInstallArgv: an options object is required');
    error.code = 'APPLICATION_OPTIONS_INVALID';
    throw error;
  }
  const unknown = Object.keys(options).filter((key) => !APPLICATION_INSTALL_FLAGS.includes(key));
  if (unknown.length > 0 || typeof options.applicationFile !== 'string' || !path.isAbsolute(options.applicationFile)) {
    const error = new Error(`applicationInstallArgv: unknown fields [${unknown.join(', ')}] or a non-absolute application.json path — the install surface is fixed to the declared flags`);
    error.code = 'APPLICATION_OPTIONS_INVALID';
    throw error;
  }
  const argv = ['application', 'install', options.applicationFile];
  const flag = (name, value) => argv.push(`--${name}`, value);
  if (options.project !== undefined) flag('project', options.project);
  for (const platform of options.platform ?? []) {
    if (typeof platform !== 'string' || !platform.trim()) {
      const error = new Error('applicationInstallArgv: --platform entries must be non-empty platform ids');
      error.code = 'APPLICATION_OPTIONS_INVALID';
      throw error;
    }
    flag('platform', platform);
  }
  if (options.host !== undefined) {
    if (!APPLICATION_HOSTS.includes(options.host)) {
      const error = new Error(`applicationInstallArgv: --host must be one of ${APPLICATION_HOSTS.join('|')}`);
      error.code = 'APPLICATION_OPTIONS_INVALID';
      throw error;
    }
    flag('host', options.host);
  }
  if (options.scope !== undefined) {
    if (!APPLICATION_SCOPES.includes(options.scope)) {
      const error = new Error(`applicationInstallArgv: --scope must be one of ${APPLICATION_SCOPES.join('|')}`);
      error.code = 'APPLICATION_OPTIONS_INVALID';
      throw error;
    }
    flag('scope', options.scope);
  }
  if (options.userRoot !== undefined) flag('user-root', options.userRoot);
  if (options.upgrade === true) argv.push('--upgrade');
  if (options.confirmationHash !== undefined) {
    if (typeof options.confirmationHash !== 'string' || !/^[a-f0-9]{64}$/i.test(options.confirmationHash)) {
      const error = new Error('applicationInstallArgv: --confirmation-hash must be the confirmed install preview digest');
      error.code = 'APPLICATION_OPTIONS_INVALID';
      throw error;
    }
    flag('confirmation-hash', options.confirmationHash);
  }
  if (options.preview === true) argv.push('--preview');
  argv.push('--json');
  return Object.freeze(argv);
}

const RUNTIME_DISPATCH_FLAGS = Object.freeze(['applicationFile', 'requestFile', 'projectRoot', 'details', 'json']);

// `comet runtime dispatch` (app/cli/runtime-command.ts): the ONLY entry for an
// SDK composition Run — one application selector, one request file, one
// project context. Mutations carry the current Run revision; queries never
// load execution modules.
export function runtimeDispatchArgv(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    const error = new Error('runtimeDispatchArgv: an options object is required');
    error.code = 'DISPATCH_OPTIONS_INVALID';
    throw error;
  }
  const unknown = Object.keys(options).filter((key) => !RUNTIME_DISPATCH_FLAGS.includes(key));
  if (unknown.length > 0 || typeof options.applicationFile !== 'string' || !path.isAbsolute(options.applicationFile)
    || typeof options.requestFile !== 'string' || !path.isAbsolute(options.requestFile)) {
    const error = new Error('runtimeDispatchArgv: exactly --application-file and --request (absolute paths) plus the declared flags are accepted');
    error.code = 'DISPATCH_OPTIONS_INVALID';
    throw error;
  }
  const argv = ['runtime', 'dispatch', '--application-file', options.applicationFile, '--request', options.requestFile];
  if (options.projectRoot !== undefined) argv.push('--project-root', options.projectRoot);
  if (options.details === true) argv.push('--details');
  argv.push('--json');
  return Object.freeze(argv);
}

// The runtime request operations the 0.5.0 command layer accepts
// (app/commands/runtime.ts operationFields) — requests outside this face are
// refused here instead of reaching the CLI as an unknown operation.
export const RUNTIME_REQUEST_OPERATIONS = Object.freeze([
  'start', 'inspect', 'query', 'acknowledge-stopped', 'inspect-storage-index',
  'audit-storage-index', 'rebuild-storage-index', 'next', 'execute',
  'dispatch-command', 'claim', 'record-outcome', 'record-evidence',
  'invalidate-evidence', 'resolve-wait', 'revise-wait', 'mark-unknown', 'retry', 'cancel',
]);

const CHANGE_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// The start request for a classic composition Run (assertBuiltInChangeInput):
// runId MUST equal the change name, changeDir is project-relative POSIX whose
// basename is the change, and input.change must match when present.
export function classicCompositionStartRequest({ change, changeDir, workflowId, workflowVersion }) {
  if (typeof change !== 'string' || !CHANGE_NAME_RE.test(change)) {
    const error = new Error('classicCompositionStartRequest: a canonical kebab-case change name is required');
    error.code = 'REQUEST_CHANGE_INVALID';
    throw error;
  }
  if (typeof changeDir !== 'string' || changeDir.startsWith('/') || changeDir.split('/').includes('..')
    || path.posix.basename(changeDir.replaceAll('\\', '/')) !== change
    || (changeDir !== `openspec/changes/${change}` && changeDir !== `docs/openspec/changes/${change}`)) {
    const error = new Error(`classicCompositionStartRequest: changeDir must be the change's own directory under openspec/changes or docs/openspec/changes (got ${String(changeDir)})`);
    error.code = 'REQUEST_CHANGE_DIR_INVALID';
    throw error;
  }
  if (typeof workflowId !== 'string' || workflowId !== 'comet-classic-full'
    || typeof workflowVersion !== 'string' || !workflowVersion.trim()) {
    const error = new Error('classicCompositionStartRequest: the classic-full composition workflow { id, version } is required (the pristine workflows declare version "1")');
    error.code = 'REQUEST_WORKFLOW_INVALID';
    throw error;
  }
  return Object.freeze({
    operation: 'start',
    runId: change,
    workflow: Object.freeze({ id: workflowId, version: workflowVersion }),
    input: Object.freeze({ change, changeDir }),
  });
}

// The documented recovery request for a composition Run whose portable
// checkpoint exists (classic-sdk-state-store.ts recoveryRequired): a `next`
// on the same runId restores the recorded state without executing host work.
export function classicCompositionRecoveryRequest({ change, operation = 'next' }) {
  if (typeof change !== 'string' || !CHANGE_NAME_RE.test(change)) {
    const error = new Error('classicCompositionRecoveryRequest: a canonical kebab-case change name is required');
    error.code = 'REQUEST_CHANGE_INVALID';
    throw error;
  }
  if (!['next', 'inspect'].includes(operation)) {
    const error = new Error('classicCompositionRecoveryRequest: only the read-only recovery operations next|inspect are constructed here');
    error.code = 'REQUEST_OPERATION_INVALID';
    throw error;
  }
  return Object.freeze({ operation, runId: change });
}

// --- check-policy v2 command identity ----------------------------------------

const CHECK_POLICY_COMMAND_KEYS = Object.freeze(['argv', 'cwd', 'files', 'outputs', 'env', 'git', 'taskCheckboxes']);

// Match one v2 command entry for an executed identity (classic-check-policy
// parseCommandEntry + entry selection): unknown fields, empty argv, absolute
// cwd or a non-directory cwd shape are refused exactly like the upstream
// parser. The entryDigest itself stays upstream-owned — this helper selects
// the entry, it never invents the digest the guard compares.
export function selectCheckPolicyCommand(document, { argv, cwd = '.' }) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)
    || document.version !== 2 || !Array.isArray(document.commands)) {
    const error = new Error('selectCheckPolicyCommand: a version 2 check-policy document with a commands array is required');
    error.code = 'CHECK_POLICY_INVALID';
    throw error;
  }
  if (document.version === 2 && Object.keys(document).some((key) => !['version', 'commands'].includes(key))) {
    const error = new Error('selectCheckPolicyCommand: version 2 allows only version and commands');
    error.code = 'CHECK_POLICY_INVALID';
    throw error;
  }
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== 'string' || !part || part.includes('\0'))) {
    const error = new Error('selectCheckPolicyCommand: the executed argv must be literal non-empty strings');
    error.code = 'CHECK_POLICY_IDENTITY_INVALID';
    throw error;
  }
  if (typeof cwd !== 'string' || !cwd || path.isAbsolute(cwd)) {
    const error = new Error('selectCheckPolicyCommand: the executed cwd must be a project-relative directory');
    error.code = 'CHECK_POLICY_IDENTITY_INVALID';
    throw error;
  }
  const normalizedCwd = cwd === '.' ? '.' : cwd.replaceAll('\\', '/').replace(/\/+$/u, '');
  let match = null;
  for (const entry of document.commands) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !CHECK_POLICY_COMMAND_KEYS.includes(key))
      || !Array.isArray(entry.argv) || entry.argv.length === 0
      || entry.argv.some((part) => typeof part !== 'string' || !part || part.includes('\0'))
      || typeof entry.cwd !== 'string' || !entry.cwd) {
      const error = new Error('selectCheckPolicyCommand: a commands entry violates the v2 shape (argv/cwd/files/outputs/env/git/taskCheckboxes only)');
      error.code = 'CHECK_POLICY_INVALID';
      throw error;
    }
    const entryCwd = entry.cwd === '.' ? '.' : entry.cwd.replaceAll('\\', '/').replace(/\/+$/u, '');
    if (JSON.stringify(entry.argv) === JSON.stringify(argv) && entryCwd === normalizedCwd) {
      if (match !== null) {
        const error = new Error('selectCheckPolicyCommand: the executed command identity matches more than one v2 entry');
        error.code = 'CHECK_POLICY_AMBIGUOUS';
        throw error;
      }
      match = entry;
    }
  }
  return match === null ? null : Object.freeze({
    argv: Object.freeze([...match.argv]),
    cwd: match.cwd,
    files: Object.freeze([...(match.files ?? [])]),
    outputs: Object.freeze([...(match.outputs ?? [])]),
    env: Object.freeze([...(match.env ?? [])]),
    git: match.git ?? 'none',
    taskCheckboxes: match.taskCheckboxes ?? 'ignore',
  });
}

// --- 0005 Kt read-side predicate ----------------------------------------------

// EXACTLY the 0005 patch semantic (fail-open default): absent/null field —
// every upstream and legacy state — keeps the original unconditional
// completion; the predicate blocks ONLY while required === true and
// completed !== true. The WRITE path that puts the field onto the state is
// the supply/admission wave and is deliberately not implemented here.
export function knowledgeCloseoutBlocked(classicState) {
  if (classicState === null || typeof classicState !== 'object' || Array.isArray(classicState)) {
    const error = new Error('knowledgeCloseoutBlocked: a ClassicState-shaped object is required');
    error.code = 'KT_STATE_INVALID';
    throw error;
  }
  const closeout = classicState.knowledgeCloseout;
  if (closeout === null || closeout === undefined) return false;
  if (typeof closeout !== 'object' || Array.isArray(closeout)
    || Object.keys(closeout).some((key) => !['required', 'completed'].includes(key))) {
    const error = new Error('knowledgeCloseoutBlocked: the optional knowledgeCloseout field is { required?, completed? } | null');
    error.code = 'KT_STATE_INVALID';
    throw error;
  }
  return closeout.required === true && closeout.completed !== true;
}

function runRouter({ workspace, nodeExecutable, env, toolName, toolInput }) {
  const payload = JSON.stringify({
    session_id: 'p1-3-channel-probe',
    hook_event_name: 'PreToolUse',
    cwd: workspace.projectRoot,
    tool_name: toolName,
    tool_input: toolInput,
  });
  const result = spawnSync(nodeExecutable, [workspace.routerPath, '--platform', 'claude', '--project-root', workspace.projectRoot], {
    input: payload,
    cwd: workspace.projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: env ?? process.env,
  });
  const denied = result.status === 2 || /WRITE BLOCKED/.test(result.stderr ?? '');
  return {
    toolName,
    target: toolInput.file_path ?? null,
    outcome: denied ? 'rejected' : 'allowed',
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// A09: probe each write channel separately against the live guard. The edit
// channel is attributed by the host hook (matcher Write|Edit) and is really
// denied for a cross-phase product write; the same channel toward the
// change's own artifact stays allowed (the denial is phase-targeted). Shell
// and MCP write tools are NOT attributed by the guard — a allowed outcome is
// recorded as the capability gap it is, never as "blocked".
export async function probeWriteChannels({ projectRoot, nodeExecutable, change, env }) {
  const workspace = await describeWorkspace({ projectRoot, change });
  const crossPhaseTarget = path.join(projectRoot, 'src/product.ts');
  const artifactTarget = path.join(projectRoot, 'docs/openspec/changes', change, 'tasks.md');

  const editWrite = runRouter({ workspace, nodeExecutable, env, toolName: 'Write', toolInput: { file_path: crossPhaseTarget, content: 'probe' } });
  const editControl = runRouter({ workspace, nodeExecutable, env, toolName: 'Write', toolInput: { file_path: artifactTarget, content: 'probe' } });
  const shellWrite = runRouter({ workspace, nodeExecutable, env, toolName: 'Bash', toolInput: { command: `cat > '${crossPhaseTarget}' <<'EOF'\nprobe\nEOF` } });
  const mcpWrite = runRouter({ workspace, nodeExecutable, env, toolName: 'mcp__filesystem__write_file', toolInput: { file_path: crossPhaseTarget, content: 'probe' } });

  const gapReason = (record) => `the phase guard did not attribute this channel: matcher "${workspace.hookMatcher}" does not match ${record.toolName} and the guard treats unattributed tool names as intent "unknown" (A09 capability gap; successor: guard hook contract extension covering shell and MCP write tools)`;
  const asRecord = (channel, record, extra = {}) => ({
    channel,
    toolName: record.toolName,
    target: record.target,
    outcome: record.outcome === 'rejected' ? 'rejected' : 'gap',
    detail: record.outcome === 'rejected'
      ? `exit ${record.exitCode}: ${record.stderr.trim().split('\n')[0] ?? 'phase guard denial'}`
      : gapReason(record),
    exitCode: record.exitCode,
    stdout: record.stdout,
    stderr: record.stderr,
    ...extra,
  });

  return [
    asRecord('edit', editWrite, { control: { outcome: editControl.outcome, exitCode: editControl.exitCode, target: editControl.target } }),
    asRecord('shell', shellWrite),
    asRecord('mcp', mcpWrite),
  ];
}

const STATE_FIELDS = [
  ['phase', 'phase'],
  ['verifyResult', 'verify_result'],
  ['archiveConfirmation', 'archive_confirmation'],
  ['archived', 'archived'],
  ['checkEpoch', 'check_epoch'],
];

// Managed read of the closeout state through the CLI (never a hand parse of
// the YAML): the seal facts the single closeout owner judges on. 0.5.0 state
// get answers data.fields (verified live: {"change":…,"fields":{"phase":"open"}})
// with the bare value on stdout — both are read, fields first.
export async function readArchiveSeal({ projectRoot, change, nodeExecutable, entrypoint, env }) {
  const seal = { change };
  for (const [key, field] of STATE_FIELDS) {
    const result = spawnSync(nodeExecutable, [entrypoint, 'state', 'get', change, field, '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 120_000,
      env: env ?? process.env,
    });
    let envelope = null;
    try { envelope = JSON.parse(result.stdout ?? ''); } catch { /* handled below */ }
    if (!envelope || envelope.exitCode !== 0) {
      const error = new Error(`state get ${change} ${field} failed: ${String(envelope?.stderr ?? result.stderr ?? '').slice(0, 200)}`);
      error.code = 'SEAL_READ_FAILED';
      throw error;
    }
    const fields = envelope?.data?.fields;
    const raw = fields !== null && typeof fields === 'object' && !Array.isArray(fields) && typeof fields[field] === 'string'
      ? fields[field].trim()
      : String(envelope.stdout ?? '').trim();
    seal[key] = key === 'checkEpoch' ? (raw === '' ? null : Number(raw)) : key === 'archived' ? raw === 'true' : raw;
  }
  return seal;
}

// 1.3.c — the single spec-closeout owner. The upstream CLI converges
// idempotently when `comet archive` repeats (archived: true, one archive
// directory); exclusivity is enforced here, at the driver gate: a second
// closeout execution is refused outright, and Knowledge.Closeout.v1 ordering
// (Kp before archive) is a precondition of sealing at all. Kt is NOT this
// seal: on the 0.5.0 face Kt is the post-archive 0005 predicate
// (knowledgeCloseoutBlocked) that parks the SAME Run before 'completed'.
// Unsupported scenarios fail closed — no second scheduler is built.
export function sealCloseout({ seal, execution, knowledgeCloseout }) {
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
  if (!seal || seal.change === undefined) fail('ARCHIVE_ENTRY_INVALID', 'sealCloseout requires a seal read by readArchiveSeal');
  if (typeof execution !== 'string' || execution.length === 0) fail('ARCHIVE_ENTRY_INVALID', 'sealCloseout requires the closing execution identity');
  if (!knowledgeCloseout || typeof knowledgeCloseout.id !== 'string' || !/^[a-f0-9]{64}$/.test(knowledgeCloseout.digest ?? '')) {
    fail('KNOWLEDGE_CLOSEOUT_REQUIRED', 'Knowledge.Closeout.v1: the knowledge obligation (Kp) must be recorded before the archive seal');
  }
  if (seal.archived === true) {
    fail('ARCHIVE_ALREADY_SEALED', `change ${seal.change} was already sealed by a previous closeout; a second closeout execution (${execution}) is refused — the archive is single-owner even though the upstream CLI converges idempotently`);
  }
  if (seal.phase !== 'archive' || seal.verifyResult !== 'pass' || seal.archiveConfirmation !== 'confirmed') {
    fail('ARCHIVE_ENTRY_INVALID', `change ${seal.change} is not at a sealable archive entry: phase=${seal.phase} verify_result=${seal.verifyResult} archive_confirmation=${seal.archiveConfirmation}`);
  }
  return Object.freeze({
    change: seal.change,
    execution,
    archived: true,
    knowledgeCloseout: Object.freeze({ ...knowledgeCloseout }),
    sealedFromEpoch: seal.checkEpoch,
  });
}

// SDD.Gate.v1 reuse: the pure delivery gate judgment, imported unmodified.
// The driver never dispatches from it and never writes a stage — it only
// consumes the verdict/receipt for the single verification execution. On the
// 0.5.0 composition face the same judgment is reached through the packaged
// bindings validators (integrations/comet/application/bindings.mjs).
export const evaluateGate = evaluate;

// Minimal SDD.Delivery.TestContract v1 fixture for gate-level judgments made
// by the driver tests (frozen required capabilities, real denominator).
export function gateTestContractFixture(requiredChecks) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'F05', oracle: 'required capabilities are observed before pass' }],
    requiredChecks,
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dirs removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'comet-build', digest: '0'.repeat(64) }],
  };
}
