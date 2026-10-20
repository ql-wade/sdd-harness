// Comet Classic host adapter (task P1_3, work packages 1.3.a/1.3.b/1.3.c).
//
// Everything here is the REAL interface of the patched pinned build (source
// lock integrations/comet/upstream.lock.json, fingerprint cb1151b4…), not a
// parallel control plane: the Classic Run keeps its single RunState, its
// .comet-state lock and its YAML+run transaction, and there is no second
// currentPhase anywhere in this module (Comet.Run.managedDelivery.v1). The
// single discovery run recorded (probe session, 2026-10-20):
//   project config        <root>/.comet/config.yaml (comet.project.v1)
//   change control state  docs/openspec/changes/<change>/.comet.yaml
//                         (YAML, atomic rename = commit point; phase one of
//                         open|design|build|verify|archive)
//   engine Run state      docs/openspec/changes/<change>/.comet/run-state.json
//                         (atomic tmp+rename writer, run_id link in .comet.yaml)
//   state lock            <changeDir>/.comet-state.lock (recoverable file lock)
//   state transaction     <changeDir>/.comet-state-transaction.json
//   change selection      <root>/.comet/current-change.json (comet.selection.v2)
//   check logs            <changeDir>/.comet/checks/<uuid>.log (real runtime
//                         checks; manual record-check declarations never
//                         satisfy the guard — observed upstream refusal)
//   host hook             <root>/.claude/settings.local.json PreToolUse
//                         matcher "Write|Edit" -> comet-hook-router.mjs
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

export const RUNNER_ID = 'comet-classic';

// Runner.Dispatch.v1 for the single Comet Classic master: the authority is
// bound to one run id, so a dispatch or a verified record from any other run
// is refused before it can be confused with this run's receipts (F07).
export function cometLaunchAuthority({ secret, runId }) {
  if (typeof runId !== 'string' || runId.length === 0) {
    const error = new Error('cometLaunchAuthority: runId is required — the authority is bound to exactly one Comet run');
    error.code = 'RUN_ID_REQUIRED';
    throw error;
  }
  const authority = createLaunchAuthority({ secret });
  return {
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
  };
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
// the live project instead of assumed.
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
  return Object.freeze({
    projectRoot,
    projectConfig: path.join(projectRoot, '.comet/config.yaml'),
    changeStateFile: path.join(changeDir, '.comet.yaml'),
    runStateFile: path.join(changeDir, '.comet/run-state.json'),
    stateLockFile: path.join(changeDir, '.comet-state.lock'),
    stateTransactionFile: path.join(changeDir, '.comet-state-transaction.json'),
    selectionFile: path.join(projectRoot, '.comet/current-change.json'),
    checksDir: path.join(changeDir, '.comet/checks'),
    ...hook,
  });
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
// the YAML): the seal facts the single closeout owner judges on.
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
    const raw = String(envelope.stdout ?? '').trim();
    seal[key] = key === 'checkEpoch' ? Number(raw) : key === 'archived' ? raw === 'true' : raw;
  }
  return seal;
}

// 1.3.c — the single spec-closeout owner. The upstream CLI converges
// idempotently when `comet archive` repeats (archived: true, one archive
// directory); exclusivity is enforced here, at the driver gate: a second
// closeout execution is refused outright, and Knowledge.Closeout.v1 ordering
// (Kp before archive) is a precondition of sealing at all. Unsupported
// scenarios fail closed — no second scheduler is built.
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
// consumes the verdict/receipt for the single verification execution.
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
