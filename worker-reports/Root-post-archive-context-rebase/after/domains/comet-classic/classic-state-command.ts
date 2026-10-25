import { ManagedCompletionIntegrityError } from './classic-runtime-run.js';
import { bindRunAuthority, closeoutPredicateFromDocument } from './classic-gate-runtime.js';
import { ensureClassicRuntimeRun } from './classic-runtime-run.js';
import { requireManagedDeliveryHost, admitManagedPacket, ManagedSourceUnverifiedError } from './classic-managed-host.js';
import { measureCometGitCommand } from '../../platform/process/runtime-metrics.js';
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { Document, parseDocument } from 'yaml';
import { samePath } from '../../platform/paths/git-worktree.js';
import { describeCurrentManagedAction, requireManagedTaskReview, requireManagedGateTerminal } from './classic-managed-actions.js';
// P2_4 rework (0002): the invalidation-generation and pass-evidence surface.
// A second import statement keeps the original import lists byte-identical for
// the downstream patch stack (0003 binds its own import context there).
import {
  gateGenerationOf,
  parseGateInvalidations,
  syncGateInvalidations,
  syncGateInvalidationsLocked,
} from './classic-gate-runtime.js';
import type { CliOutputEnvelope } from '../workflow-contract/output-envelope.js';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import {
  clearCurrentChange,
  clearCurrentChangeIf,
  resolveCurrentChange,
  selectCurrentChange,
} from './classic-current-change.js';
import {
  driftBlockedMessage,
  evaluateBranchBinding,
  healBoundBranch,
  isGitWorkTree,
  liveGitBranch,
  requiresBranchBinding,
  resolveBranchBinding,
  unboundDetachedMessage,
} from './classic-branch-binding.js';
import { collectClassicEvidence } from './classic-evidence.js';
import {
  collectClassicSpecFiles,
  ensureClassicActiveChangeDirectory,
  openSpecChangeNameError,
  resolveClassicChangeDirectory,
} from './classic-paths.js';
import { assertClassicLayoutWritable, assertClassicLayoutReadable } from './classic-layout.js';
import {
  classicCommandInvocationCwd,
  classicCommandProjectRoot,
  withProjectContext,
} from './classic-command-context.js';
import { resolveClassicStepId } from './classic-resolver.js';
import { ManagedGatePremisesError } from './classic-gate-runtime.js';
import { reconcileClassicRuntimeRun, transitionClassicRuntimeRun } from './classic-runtime-run.js';
import { appendClassicStateEvent, type ClassicStateEventInput } from './classic-state-events.js';
import { parseClassicStateDocument, type ClassicState } from './classic-state.js';
import { FIELD_ENUMS, MACHINE_OWNED_FIELDS, SETTABLE_FIELDS } from './classic-state-options.js';
import { readClassicState, writeClassicState, withClassicStateLock } from './classic-store.js';
import {
  CLASSIC_TRANSITION_EVENTS,
  applyClassicTransition,
  type ClassicTransitionEvent,
} from './classic-transitions.js';
import { readRunState } from '../../domains/engine/state.js';
import {
  computeGateInputs,
  evaluateGatePremises,
  entryGateAction,
  GATE_POLICY_VERSION,
  GATE_REWORK_BUDGET,
  GATE_ROLES,
  isGateId,
  knowledgeCloseoutBlocked,
  knowledgeOperationKey,
  knowledgePublishDirective,
  knowledgeTargetDigest,
  parseGateReceipts,
  parseKnowledgeCloseout,
  readGateDispatches,
  readKnowledgePublishOperations,
  readRunAuthority,
  repairRoute,
  requiredGates,
  requireRunAuthority,
  stableStringify,
  transferRunAuthority,
  UUID_RE,
  writeGateDispatches,
  writeKnowledgePublishOperations,
  type GateId,
  type KnowledgePublishOperation,
  RunAuthorityError,
} from './classic-gate-runtime.js';
import { appendTrajectory, readTrajectory } from '../../domains/engine/run-store.js';
import {
  recordCommandCheck,
  recoverCommandChecks,
  type CommandCheckScope,
} from './classic-command-checks.js';
import { classicGuardCommand } from './classic-guard.js';
import { readClassicConfigValue } from './classic-project-config.js';
import {
  classicEntryCheckEnvelope,
  classicLocale,
  classicNextEnvelope,
  classicRecoveryEnvelope,
  classicScaleEnvelope,
  classicTransitionEnvelope,
} from './classic-output-language.js';
import {
  classicProjectFileNonempty,
  classicProjectTargetExists,
  inspectClassicProjectTarget,
  readClassicProjectFile,
  writeClassicProjectText,
} from './classic-protected-path.js';
import { resolveClassicWorkspace } from './classic-workspace.js';
import { classicRecoveryContext } from './classic-recovery.js';
import { classicConfigurationReadiness } from './classic-build-configuration.js';
import { classicHandoffCommand } from './classic-handoff.js';
import { classicIssue, type ClassicIssue } from './classic-issues.js';
import {
  readClassicCheckpoint,
  writeClassicCheckpoint,
  readClassicDelivery,
  reauthorizeClassicDelivery,
  writeClassicDelivery,
  invalidateClassicDelivery,
} from './classic-progress.js';
import { readClassicArtifactRequirements } from './classic-artifact-requirements.js';
import {
  assignClassicTaskIds,
  classicTaskRevision,
  completeClassicTask,
  parseClassicTasks,
  inspectClassicPlanTasks,
  synchronizeClassicPlanTasks,
} from './classic-tasks.js';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';
const PROFILES = ['full', 'hotfix', 'tweak'] as const;
const PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;
const ARTIFACT_LANGUAGES = ['en', 'zh-CN'] as const;
const EVENTS = CLASSIC_TRANSITION_EVENTS;
const PATH_FIELDS = new Set(['design_doc', 'plan', 'verification_report', 'handoff_context', 'test_intent']);
const CLASSIC_FIELD_WIRE_NAMES: Partial<Record<keyof ClassicState, string>> = {
  archived: 'archived',
  branchStatus: 'branch_status',
  classicProfile: 'classic_profile',
  designDoc: 'design_doc',
  language: 'language',
  phase: 'phase',
  verificationReport: 'verification_report',
  verifiedAt: 'verified_at',
  archiveConfirmation: 'archive_confirmation',
  verifyResult: 'verify_result',
  verifyFailures: 'verify_failures',
  checkEpoch: 'check_epoch',
  workflow: 'workflow',
};

class CommandFailure extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    readonly issue?: ClassicIssue,
  ) {
    super(message);
  }
}

class CommandOutput {
  stdout: string[] = [];
  stderr: string[] = [];
  envelope?: CliOutputEnvelope;
  data?: unknown;

  result(exitCode = 0): ClassicCommandResult {
    return {
      exitCode,
      ...(this.data === undefined ? {} : { data: this.data }),
      ...(this.stdout.length > 0 ? { stdout: this.stdout.join('\n') + '\n' } : {}),
      ...(this.stderr.length > 0 ? { stderr: this.stderr.join('\n') } : {}),
      ...(this.envelope === undefined ? {} : { envelope: this.envelope }),
    };
  }
}

function green(message: string): string {
  return `${GREEN}${message}${RESET}`;
}

function red(message: string): string {
  return `${RED}${message}${RESET}`;
}

function yellow(message: string): string {
  return `${YELLOW}${message}${RESET}`;
}

function fail(message: string): never {
  throw new CommandFailure(message);
}

function validateChangeName(name: string | undefined): asserts name is string {
  const error = openSpecChangeNameError(name);
  if (error) fail(`ERROR: ${error}`);
}

function validateEnum(value: string, values: readonly string[]): void {
  if (!values.includes(value)) {
    fail(`ERROR: Invalid value: '${value}'\nValid values: ${values.join(' ')}`);
  }
}

function validateLanguage(value: string, source: string): string {
  if (ARTIFACT_LANGUAGES.includes(value as (typeof ARTIFACT_LANGUAGES)[number])) {
    return value;
  }
  fail(`ERROR: Invalid language from ${source}: '${value}'\nValid values: en, zh-CN`);
}

function validateRelativePath(value: string, field: string): void {
  if (!value || value === 'null') return;
  if (/^(?:[A-Za-z]:|[\\/]|~)/u.test(value)) {
    throw new CommandFailure(
      `ERROR: ${field} must be a relative path within the repo: '${value}'`,
      1,
      {
        code: 'CLASSIC_ARTIFACT_REF_INVALID',
        field,
        actual: value,
        expected: 'repository-relative path',
        message: `${field} must use a repository-relative reference.`,
        remediation:
          'Use entry.artifactRefs for state registration; absolute paths are for file operations.',
      },
    );
  }
  if (value.split(/[\\/]/u).includes('..')) {
    throw new CommandFailure(
      `ERROR: ${field} cannot contain '..' (path traversal not allowed): '${value}'`,
      1,
      {
        code: 'CLASSIC_ARTIFACT_REF_INVALID',
        field,
        actual: value,
        expected: 'repository-relative path without traversal',
        message: `${field} cannot traverse outside its artifact root.`,
      },
    );
  }
}

async function exists(file: string): Promise<boolean> {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectTargetExists(projectRoot, file, {
    label: `Classic project path ${path.relative(projectRoot, path.resolve(projectRoot, file)).replaceAll('\\', '/')}`,
  });
}

async function nonempty(file: string): Promise<boolean> {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectFileNonempty(
    projectRoot,
    file,
    `Classic project file ${path.relative(projectRoot, path.resolve(projectRoot, file)).replaceAll('\\', '/')}`,
  );
}

async function changeDirectory(name: string): Promise<{ label: string; directory: string }> {
  return resolveClassicChangeDirectory(name, classicCommandProjectRoot());
}

async function readDocument(file: string): Promise<Document> {
  let source: string;
  const projectRoot = classicCommandProjectRoot();
  try {
    source = await readClassicProjectFile(projectRoot, file, {
      label: `Classic state ${path.relative(projectRoot, file).replaceAll('\\', '/')}`,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail(
        `ERROR: .comet.yaml not found at ${path.relative(projectRoot, file).replaceAll('\\', '/')}`,
      );
    }
    throw error;
  }
  const document = parseDocument(source, { uniqueKeys: false });
  if (document.errors.length > 0) fail(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  return document;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await writeClassicProjectText(classicCommandProjectRoot(), file, content, {
    label: 'Classic state write target',
  });
}

function scalar(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function wireField(field: keyof ClassicState): string {
  return CLASSIC_FIELD_WIRE_NAMES[field] ?? String(field);
}

function wireValue(value: unknown): string {
  return value === null ? 'null' : scalar(value);
}

function enumRecordValue<const T extends readonly string[]>(
  record: Record<string, unknown>,
  field: string,
  values: T,
  fallback: T[number] | null,
): T[number] | null {
  const value = record[field];
  return typeof value === 'string' && values.includes(value as T[number])
    ? (value as T[number])
    : fallback;
}

function nullableRecordString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value : String(value);
}

function nullableRecordBoolean(record: Record<string, unknown>, field: string): boolean | null {
  const value = record[field];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function nonNegativeRecordInteger(
  record: Record<string, unknown>,
  field: string,
  fallback = 0,
): number {
  const value = record[field];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function sparseClassicState(record: Record<string, unknown>): ClassicState {
  const workflow = enumRecordValue(record, 'workflow', PROFILES, 'full')!;
  return {
    workflow,
    language: enumRecordValue(record, 'language', ARTIFACT_LANGUAGES, null),
    phase: enumRecordValue(record, 'phase', PHASES, 'open')!,
    contextCompression: enumRecordValue(
      record,
      'context_compression',
      ['off', 'beta'] as const,
      null,
    ),
    buildMode: enumRecordValue(
      record,
      'build_mode',
      ['subagent-driven-development', 'executing-plans', 'autonomous', 'direct'] as const,
      null,
    ),
    buildPause: enumRecordValue(record, 'build_pause', ['plan-ready'] as const, null),
    subagentDispatch: enumRecordValue(record, 'subagent_dispatch', ['confirmed'] as const, null),
    tddMode: enumRecordValue(record, 'tdd_mode', ['tdd', 'direct'] as const, null),
    reviewMode: enumRecordValue(
      record,
      'review_mode',
      ['off', 'standard', 'thorough'] as const,
      null,
    ),
    isolation: enumRecordValue(
      record,
      'isolation',
      ['current', 'branch', 'worktree'] as const,
      null,
    ),
    boundBranch: nullableRecordString(record, 'bound_branch'),
    verifyMode: enumRecordValue(record, 'verify_mode', ['light', 'full'] as const, null),
    autoTransition: nullableRecordBoolean(record, 'auto_transition'),
    baseRef: nullableRecordString(record, 'base_ref'),
    designDoc: nullableRecordString(record, 'design_doc'),
    plan: nullableRecordString(record, 'plan'),
    verifyResult: enumRecordValue(
      record,
      'verify_result',
      ['pending', 'pass', 'fail'] as const,
      'pending',
    )!,
    verifyFailures: nonNegativeRecordInteger(record, 'verify_failures'),
    checkEpoch: nonNegativeRecordInteger(record, 'check_epoch'),
    verificationReport: nullableRecordString(record, 'verification_report'),
    branchStatus: enumRecordValue(record, 'branch_status', ['pending', 'handled'] as const, null),
    createdAt: nullableRecordString(record, 'created_at'),
    verifiedAt: nullableRecordString(record, 'verified_at'),
    archiveConfirmation: enumRecordValue(
      record,
      'archive_confirmation',
      ['pending', 'confirmed'] as const,
      null,
    ),
    archived: nullableRecordBoolean(record, 'archived') ?? false,
    directOverride: nullableRecordBoolean(record, 'direct_override'),
    handoffContext: nullableRecordString(record, 'handoff_context'),
    handoffHash: nullableRecordString(record, 'handoff_hash'),
    classicProfile: enumRecordValue(record, 'classic_profile', PROFILES, workflow),
    classicMigration:
      typeof record.classic_migration === 'number' ? record.classic_migration : null,
    managedDelivery: record.managed_delivery === true,
    knowledgeCloseoutRequired: record.knowledge_closeout_required === true,
    testIntent: typeof record.test_intent === 'string' && record.test_intent !== 'null' ? record.test_intent : null,
    gateReceipts: typeof record.gate_receipts === 'string' ? record.gate_receipts : null,
    gateDispatches: typeof record.gate_dispatches === 'string' ? record.gate_dispatches : null,
    deliveryPolicy: typeof record.delivery_policy === 'string' ? record.delivery_policy : null,
    gateInvalidations: typeof record.gate_invalidations === 'string' ? record.gate_invalidations : null,
    knowledgeCloseout: typeof record.knowledge_closeout === 'string' ? record.knowledge_closeout : null,
  };
}

async function projectConfigValue(
  field: 'context_compression' | 'auto_transition' | 'review_mode' | 'language',
): Promise<string | null> {
  return (await readClassicConfigValue(field, { cwd: classicCommandProjectRoot() }))?.value ?? null;
}

async function projectLanguageDefault(): Promise<string> {
  if (process.env.COMET_LANGUAGE)
    return validateLanguage(process.env.COMET_LANGUAGE, 'COMET_LANGUAGE');
  const configured = await readClassicConfigValue('language', {
    cwd: classicCommandProjectRoot(),
  });
  if (configured) return validateLanguage(configured.value, configured.source);
  return 'en';
}

async function contextCompression(): Promise<string> {
  const value =
    process.env.COMET_CONTEXT_COMPRESSION ??
    (await projectConfigValue('context_compression')) ??
    'off';
  if (!['off', 'beta'].includes(value)) {
    fail(`ERROR: Invalid context_compression: '${value}'\nValid values: off, beta`);
  }
  return value;
}

async function autoTransition(): Promise<string> {
  const value =
    process.env.COMET_AUTO_TRANSITION ?? (await projectConfigValue('auto_transition')) ?? 'true';
  if (!['true', 'false'].includes(value)) {
    fail(`ERROR: Invalid auto_transition: '${value}'\nValid values: true, false`);
  }
  return value;
}

async function reviewModeDefault(): Promise<string | null> {
  const value =
    process.env.COMET_REVIEW_MODE ?? (await projectConfigValue('review_mode')) ?? 'standard';
  if (!['null', 'off', 'standard', 'thorough'].includes(value)) {
    fail(`ERROR: Invalid review_mode: '${value}'\nValid values: off, standard, thorough`);
  }
  return value === 'null' ? null : value;
}

function gitOutput(args: string[]): string | null {
  const result = measureCometGitCommand(() =>
    spawnSync('git', args, {
      cwd: classicCommandProjectRoot(),
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    }),
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

async function stateFile(
  name: string,
): Promise<{ file: string; label: string; directory: string }> {
  const change = await changeDirectory(name);
  await inspectClassicProjectTarget(
    classicCommandProjectRoot(),
    path.join(change.directory, '.comet'),
    {
      label: `Classic runtime directory for ${name}`,
      expected: 'directory',
    },
  );
  return {
    ...change,
    file: path.join(change.directory, '.comet.yaml'),
  };
}

async function readField(name: string, field: string): Promise<string> {
  const { file } = await stateFile(name);
  const document = await readDocument(file);
  // Read via toJS so an explicit `field: null` round-trips as JS null (-> "null"),
  // matching the shell `yaml_field` grep contract. A bare Document#get returns
  // undefined for null-valued keys, erasing the distinction between "present but
  // null" and "absent" that the frozen 0.3.8 behavior preserves.
  const record = document.toJS() as Record<string, unknown>;
  return readRecordField(record, field);
}

async function readRecordField(record: Record<string, unknown>, field: string): Promise<string> {
  const value = record[field];
  if (field === 'language') {
    if (value === null || value === undefined || value === '') return projectLanguageDefault();
    return validateLanguage(scalar(value), '.comet.yaml');
  }
  if (field === 'auto_transition' && (value === null || value === undefined || value === '')) {
    return autoTransition();
  }
  return scalar(value);
}

function parsedValue(field: string, value: string): unknown {
  const document = parseDocument(`${field}: ${value}\n`);
  if (document.errors.length > 0) fail(`ERROR: Invalid value: '${value}'`);
  return document.get(field);
}

async function validateSetValue(field: string, value: string): Promise<void> {
  if (field === 'language') {
    validateLanguage(value, 'language');
    return;
  }
  const enumValues = FIELD_ENUMS[field];
  if (enumValues && !enumValues.includes(value))
    throw new CommandFailure(
      `ERROR: Invalid value: '${value}'\nValid values: ${enumValues.join(' ')}`,
      1,
      {
        code: 'CLASSIC_FIELD_VALUE_INVALID',
        field,
        actual: value,
        expected: enumValues,
        message: `Invalid value for ${field}.`,
      },
    );
  if (PATH_FIELDS.has(field)) {
    validateRelativePath(value, field);
    if (value && value !== 'null') {
      await inspectClassicProjectTarget(classicCommandProjectRoot(), value, {
        label: `${field} artifact pointer`,
        expected: 'file',
      });
    }
  }
  if ((field === 'skill_hash' || field === 'handoff_hash') && !/^[a-f0-9]{64}$/u.test(value)) {
    fail(`ERROR: ${field} must be a sha256 hex digest`);
  }
  if (field === 'iteration' && !/^[0-9]+$/u.test(value)) {
    fail('ERROR: iteration must be a non-negative integer');
  }
}

async function setFields(
  output: CommandOutput,
  name: string,
  updates: Array<[string, string]>,
  options: { internal?: boolean; machineOwned?: boolean } = {},
): Promise<void> {
  const { directory } = await stateFile(name);
  return withClassicStateLock(directory, () => setFieldsLocked(output, name, updates, options));
}

async function setFieldsLocked(
  output: CommandOutput,
  name: string,
  updates: Array<[string, string]>,
  options: { internal?: boolean; machineOwned?: boolean },
): Promise<void> {
  const seen = new Set<string>();
  for (const [field, value] of updates) {
    if (seen.has(field)) fail(`ERROR: Duplicate field: '${field}'`);
    seen.add(field);
    if (MACHINE_OWNED_FIELDS.has(field) && !options.machineOwned) {
      fail(`ERROR: '${field}' is a machine-owned field and cannot be set directly`);
    }
    if (!SETTABLE_FIELDS.has(field) && !MACHINE_OWNED_FIELDS.has(field)) {
      throw new CommandFailure(`ERROR: Unknown field: '${field}'`, 1, {
        code: 'CLASSIC_FIELD_UNKNOWN',
        field,
        actual: field,
        expected: [...SETTABLE_FIELDS],
        message: `Unknown Classic state field: ${field}.`,
      });
    }
    if (field === 'phase' && !options.internal && process.env.COMET_FORCE_PHASE !== '1') {
      fail(
        "ERROR: Setting 'phase' directly is not allowed; it bypasses state machine evidence checks.\n" +
          '  Use: comet state transition <change-name> <event>\n' +
          '  Repair-only escape hatch: COMET_FORCE_PHASE=1 comet state set <change-name> phase <value>',
      );
    }
    await validateSetValue(field, value);
  }
  const { file, directory } = await stateFile(name);
  const document = await readDocument(file);
  const previousRecord = (document.toJS() ?? {}) as Record<string, unknown>;
  const managedDelivery = previousRecord.managed_delivery === true;
  if (managedDelivery && updates.some(([field]) => field === 'test_intent')) {
    requireManagedDeliveryHost();
    await requireRunAuthority(directory);
    if (previousRecord.archived === true) fail('ERROR: archived test intent registration is immutable');
  }
  for (const [field, value] of updates) {
    if (managedDelivery && (field === 'verify_result' || (field === 'archived' && !options.internal))) {
      fail(
        "ERROR: 'verify_result' and 'archived' are Runtime-stamped in managed delivery; use the guarded native transitions",
      );
    }
    if (field === 'phase' && managedDelivery && !options.internal) {
      // B4 upstream hygiene: inside managed delivery the FORCE_PHASE escape
      // never rewrites the phase — rework goes through the Runtime
      // transitions (architecture-repair / test-design-repair / verify-fail).
      fail(
        "ERROR: Setting 'phase' directly is not allowed in managed delivery; the COMET_FORCE_PHASE escape hatch does not lower managed gates.\n" +
          (previousRecord.phase === 'design'
            ? '  Retain Design; the existing authorized author revises the artifact before a new independent A/T review.'
            : '  Read the native phase and use its controlled Runtime rework transition.'),
      );
    }
    document.set(field, parsedValue(field, value));
    if (field === 'phase' && previousRecord.phase !== value) {
      const epoch = nonNegativeRecordInteger(previousRecord, 'check_epoch');
      if (!Number.isSafeInteger(epoch + 1)) fail('ERROR: Invalid Classic check epoch');
      document.set('check_epoch', epoch + 1);
    }
    if (field === 'isolation') {
      if (requiresBranchBinding(value)) {
        const previousIsolation =
          typeof previousRecord.isolation === 'string' ? previousRecord.isolation : null;
        const existing = previousRecord.bound_branch;
        const alreadyBound = typeof existing === 'string' && existing !== '';
        // Switching between workspace modes is an explicit new workspace
        // decision and re-points the binding; repeating the same mode keeps
        // the sticky binding that drift checks rely on.
        if (!alreadyBound || previousIsolation !== value) {
          const invocationCwd = classicCommandInvocationCwd();
          const currentBranch = liveGitBranch(invocationCwd);
          const verdict = evaluateBranchBinding({
            isolation: value,
            boundBranch: null,
            currentBranch,
            gitWorkTree: currentBranch === null ? isGitWorkTree(invocationCwd) : true,
          });
          if (verdict.status === 'needs-heal') {
            document.set('bound_branch', verdict.branch);
          } else if (verdict.status === 'unbound-detached') {
            fail(
              `ERROR: cannot bind isolation=${value} while HEAD is detached; checkout a branch first`,
            );
          } else {
            document.set('bound_branch', null);
          }
        }
      } else {
        document.set('bound_branch', null);
      }
    }
  }
  const run = await readRunState(directory);
  const projection = parseClassicStateDocument(document.toJS() as Record<string, unknown>, run);
  if (projection.run) {
    if (!projection.classic) fail('ERROR: migrated Run is missing its Classic projection');
    const evidence = await collectClassicEvidence(directory, projection);
    let currentStep: string;
    try {
      currentStep = resolveClassicStepId(projection.classic, evidence);
    } catch (error) {
      if (!(error instanceof ManagedGatePremisesError)) throw error;
      // Remediation writes stay possible while managed premises are blocked;
      // the entrance surfaces still enforce the block.
      currentStep = projection.run.currentStep ?? 'unknown';
    }
    const stepChanged = currentStep !== projection.run.currentStep;
    const run = {
      ...projection.run,
      currentStep,
      iteration: projection.run.iteration + (stepChanged ? 1 : 0),
      status: currentStep === 'completed' ? ('completed' as const) : ('running' as const),
    };
    await writeClassicState(directory, {
      classic: projection.classic,
      run,
      unknownKeys: projection.unknownKeys,
    });
    if (stepChanged) {
      const trajectory = await readTrajectory(directory, run.trajectoryRef);
      await appendTrajectory(directory, run.trajectoryRef, {
        sequence: trajectory.length + 1,
        timestamp: new Date().toISOString(),
        type: 'state_transitioned',
        runId: run.runId,
        data: {
          kind: 'classic-config',
          ...(updates.length === 1
            ? { field: updates[0][0] }
            : { fields: updates.map(([field]) => field) }),
          fromStep: projection.run.currentStep,
          toStep: currentStep,
        },
      });
    }
  } else {
    await atomicWrite(file, document.toString());
  }
  if (seen.has('phase') && !options.internal) {
    output.stderr.push(
      yellow("WARNING: Setting 'phase' directly bypasses state machine constraints."),
      yellow('  Consider using: comet state transition <change-name> <event>'),
    );
  }
  output.data = {
    change: name,
    updated: Object.fromEntries(updates.map(([field]) => [field, document.get(field)])),
  };
  for (const [field, value] of updates) output.stderr.push(green(`[SET] ${field}=${value}`));
}

async function init(
  output: CommandOutput,
  name: string,
  workflow: string,
  isolation: string | null = null,
  managedDelivery = false,
  knowledgeCloseoutRequired = false,
): Promise<void> {
  validateChangeName(name);
  validateEnum(workflow, PROFILES);
  if (isolation !== null) validateEnum(isolation, ['current', 'branch', 'worktree']);
  if (managedDelivery && workflow !== 'full') {
    fail(`ERROR: managed delivery requires the full workflow (R/A/T separation), got '${workflow}'`);
  }
  const boundBranch = isolation !== null ? liveGitBranch(classicCommandProjectRoot()) : null;
  if (isolation !== null && isolation !== 'current' && boundBranch === null) {
    fail(
      `ERROR: cannot bind isolation=${isolation} while HEAD is detached; checkout a branch first`,
    );
  }
  const change = await ensureClassicActiveChangeDirectory(name, classicCommandProjectRoot());
  const { label, directory } = change;
  const file = path.join(directory, '.comet.yaml');
  if (await exists(file)) fail(`ERROR: .comet.yaml already exists at ${label}/.comet.yaml`);

  const preset = workflow !== 'full';
  const reviewMode = preset ? 'off' : await reviewModeDefault();
  const document = new Document({
    workflow,
    language: await projectLanguageDefault(),
    phase: 'open',
    context_compression: await contextCompression(),
    build_mode: preset ? 'direct' : null,
    build_pause: null,
    subagent_dispatch: null,
    tdd_mode: preset ? 'direct' : null,
    review_mode: reviewMode,
    isolation,
    verify_mode: preset ? 'light' : null,
    auto_transition: (await autoTransition()) === 'true',
    base_ref: gitOutput(['rev-parse', '--verify', 'HEAD']),
    design_doc: null,
    plan: null,
    verify_result: 'pending',
    verify_failures: 0,
    verification_report: null,
    branch_status: 'pending',
    created_at: new Date().toISOString().slice(0, 10),
    verified_at: null,
    archive_confirmation: null,
    archived: false,
    // Managed delivery fields are written only when the run is initialized
    // as managed; unmanaged changes keep the exact historical document.
    ...(managedDelivery
      ? {
          managed_delivery: true,
          knowledge_closeout_required: true,
          delivery_policy: null,
          gate_dispatches: null,
          test_intent: null,
          gate_receipts: null,
          gate_invalidations: null,
          knowledge_closeout: null,
        }
      : {}),
  });
  if (isolation !== null) document.set('bound_branch', boundBranch);
  await atomicWrite(file, document.toString());
  if (managedDelivery) {
    // H09: the first Runtime environment to initialize the managed run
    // becomes its authoritative environment; the binding lives in the run's
    // own .comet directory and every mutating entrance re-verifies it.
    const authority = await bindRunAuthority(directory);
    output.stderr.push(green(`[BOUND] run authority: ${authority.authorityId}`));
  }
  output.stdout.push(green(`Initialized: ${label}/.comet.yaml (workflow=${workflow})`));
}

async function requirePhase(name: string, expected: string): Promise<void> {
  const actual = await readField(name, 'phase');
  if (actual !== expected) {
    fail(`ERROR: Cannot transition '${name}': expected phase ${expected}, got ${actual}`);
  }
}

// Managed gate premises on the direct-transition entrance (C07): the same
// evaluation the guard, write hook, resolver and completion consume — this
// works with or without a Run projection, so no managed entrance can bypass
// the premises when the run has not been reconciled yet.
async function requireGatePremises(
  name: string,
  action: 'enter-design' | 'enter-build' | 'enter-verify' | 'enter-archive',
): Promise<void> {
  const { directory, record } = await managedStateRecord(name);
  if (record.managed_delivery !== true) return;
  // P1-03: persist any observed input invalidation BEFORE evaluating, so the
  // generation the premises judge is the persisted one. Callers hold the
  // Classic state lock (transitionLocked / dispatch / accept surfaces).
  await syncGateInvalidationsLocked(directory, classicCommandProjectRoot());
  const evaluation = await evaluateGatePremises({
    projectRoot: classicCommandProjectRoot(),
    changeDir: directory,
    classic: { ...gateStateInputFrom(record), managedDelivery: true },
    run: await readRunState(directory),
    action,
  });
  if (!evaluation.allowed) {
    const reasons = [...evaluation.details, ...evaluation.routes].join('\n  ');
    fail(
      `ERROR: Cannot transition '${name}': managed delivery gate premises are not current for ${action}\n  ${reasons}`,
    );
  }
}

async function requireManagedDelivery(name: string, purpose: string): Promise<void> {
  const { file } = await stateFile(name);
  const record = (await readDocument(file)).toJS() as Record<string, unknown>;
  if (record.managed_delivery !== true) {
    fail(`ERROR: ${purpose} requires managed delivery; '${name}' is not initialized with --managed-delivery`);
  }
}

// Raw state record access shared by the managed gate subcommands. All of them
// judge on the same .comet.yaml document the Runtime transactions own.
async function managedStateRecord(name: string): Promise<{ directory: string; record: Record<string, unknown> }> {
  const { directory } = await stateFile(name);
  const { file } = await stateFile(name);
  const document = await readDocument(file);
  const record = (document.toJS() ?? {}) as Record<string, unknown>;
  return { directory, record };
}

function gateStateInputFrom(record: Record<string, unknown>) {
  return {
    designDoc: typeof record.design_doc === 'string' && record.design_doc !== 'null' ? record.design_doc : null,
    plan: typeof record.plan === 'string' && record.plan !== 'null' ? record.plan : null,
    testIntent: typeof record.test_intent === 'string' && record.test_intent !== 'null' ? record.test_intent : null,
    gateReceipts: record.gate_receipts ?? null,
    gateInvalidations: record.gate_invalidations ?? null,
    deliveryPolicy: record.delivery_policy ?? null,
  };
}

async function currentGateInputs(
  directory: string,
  record: Record<string, unknown>,
  gate: GateId,
) {
  return computeGateInputs({
    projectRoot: classicCommandProjectRoot(),
    changeDir: directory,
    gate,
    state: gateStateInputFrom(record),
    run: await readRunState(directory),
  });
}

async function requireBuildDecisions(name: string): Promise<void> {
  const { file } = await stateFile(name);
  const record = (await readDocument(file)).toJS() as Record<string, unknown>;
  const state = sparseClassicState(record);
  const buildMode = state.buildMode;
  const isolation = state.isolation;
  const readiness = classicConfigurationReadiness(state);
  const allowedIsolation = ['current', 'branch', 'worktree'];
  if (!isolation || !allowedIsolation.includes(isolation)) {
    fail(
      `ERROR: Cannot transition '${name}': isolation must be current, branch, or worktree, got '${isolation || 'null'}'`,
    );
  }
  if (readiness.missingFields.includes('build_mode')) {
    fail(
      `ERROR: Cannot transition '${name}': build_mode must be selected before leaving build, got '${buildMode || 'null'}'`,
    );
  }
  if (readiness.invalidFields.some(({ field }) => field === 'direct_override')) {
    fail(
      `ERROR: Cannot transition '${name}': build_mode=direct is only allowed for hotfix/tweak unless direct_override=true`,
    );
  }
  if (readiness.missingFields.includes('subagent_dispatch')) {
    fail(
      `ERROR: Cannot transition '${name}': subagent_dispatch must be confirmed before using build_mode=subagent-driven-development`,
    );
  }
  if (readiness.missingFields.includes('tdd_mode')) {
    fail(
      `ERROR: Cannot transition '${name}': tdd_mode must be selected before leaving build (full workflow)`,
    );
  }
  if (readiness.missingFields.includes('review_mode')) {
    fail(
      `ERROR: Cannot transition '${name}': review_mode must be selected before leaving build (full workflow); review_mode must be off, standard, or thorough, got 'null'`,
    );
  }
  if (readiness.invalidFields.some(({ field }) => field === 'review_mode')) {
    fail(
      `ERROR: Cannot transition '${name}': review_mode must be standard or thorough for autonomous full build`,
    );
  }
}

async function requireOpenArtifacts(name: string): Promise<void> {
  const { directory } = await stateFile(name);
  const workflow = await readField(name, 'workflow');
  const requirements = await readClassicArtifactRequirements(
    classicCommandProjectRoot(),
    directory,
  );
  if (requirements.problems.length) fail(`ERROR: ${requirements.problems.join('\n')}`);
  for (const artifact of ['proposal.md', 'tasks.md']) {
    if (!(await nonempty(path.join(directory, artifact)))) {
      fail(
        `ERROR: Cannot transition '${name}': ${artifact} must exist and be non-empty before leaving open`,
      );
    }
  }
  if (
    workflow === 'full' &&
    (await readField(name, 'managed_delivery')) !== 'true' &&
    requirements.designRequired &&
    !(await nonempty(path.join(directory, 'design.md')))
  ) {
    fail(
      `ERROR: Cannot transition '${name}': design.md must exist and be non-empty before leaving open`,
    );
  }
}

async function requireDesignEvidence(name: string): Promise<void> {
  const designDoc = await readField(name, 'design_doc');
  if (!designDoc || designDoc === 'null' || !(await nonempty(designDoc))) {
    fail(
      `ERROR: Cannot transition '${name}': design_doc must point to an existing Design Doc before leaving design`,
    );
  }
}

async function writeSparseTransitionEffects(
  directory: string,
  effects: Array<{ field: keyof ClassicState; to: unknown }>,
): Promise<void> {
  const file = path.join(directory, '.comet.yaml');
  const document = await readDocument(file);
  for (const effect of effects) {
    const field = wireField(effect.field);
    document.set(field, parsedValue(field, wireValue(effect.to)));
  }
  await atomicWrite(file, document.toString());
}

async function applyTransitionEvent(
  output: CommandOutput,
  name: string,
  event: ClassicTransitionEvent,
): Promise<{ fromPhase: string; toPhase: string }> {
  const { directory } = await stateFile(name);
  const projection = await readClassicState(directory);
  let classic = projection.classic;
  let sparse = false;
  if (!classic) {
    if (projection.run) fail('ERROR: Classic state projection is missing');
    const document = await readDocument(path.join(directory, '.comet.yaml'));
    classic = sparseClassicState(document.toJS() as Record<string, unknown>);
    sparse = true;
  }

  const result = applyClassicTransition(classic, event);
  if (event === 'archive-reopen')
    await invalidateClassicDelivery(classicCommandProjectRoot(), directory);
  if (projection.run) {
    await transitionClassicRuntimeRun(directory, result.classic, projection.run, {
      event,
      source: 'comet-state',
    });
  } else if (sparse) {
    await writeSparseTransitionEffects(directory, result.effects);
  } else {
    await writeClassicState(directory, {
      classic: result.classic,
      run: null,
      unknownKeys: projection.unknownKeys,
    });
  }
  try {
    await appendClassicStateEvent(directory, {
      change: name,
      event,
      source: 'comet-state',
      from: classic,
      to: result.classic,
      effects: result.effects,
    });
  } catch (error) {
    // The transition itself already committed (phase + epoch are on disk). A
    // failing audit-log append must not flip the command to failure, which
    // would make callers retry an already-applied transition.
    output.stderr.push(
      red(
        `[WARN] transition ${event} applied but the state event log append failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
  }

  for (const effect of result.effects) {
    output.stderr.push(green(`[SET] ${wireField(effect.field)}=${wireValue(effect.to)}`));
  }
  output.stderr.push(green(`[TRANSITION] ${event}`));
  return { fromPhase: classic.phase, toPhase: result.classic.phase };
}

async function transition(output: CommandOutput, name: string, event: string): Promise<void> {
  validateChangeName(name);
  const { directory } = await stateFile(name);
  return withClassicStateLock(directory, () => transitionLocked(output, name, event));
}

async function transitionLocked(output: CommandOutput, name: string, event: string): Promise<void> {
  validateChangeName(name);
  validateEnum(event, EVENTS);
  if (event === 'open-complete') {
    await requirePhase(name, 'open');
    await requireOpenArtifacts(name);
    // C01/P1-01: entering the formal architecture phase is a managed action —
    // a current R receipt is its premise on the same authoritative predicate
    // every other entrance consumes.
    await requireGatePremises(name, 'enter-design');
  } else if (event === 'design-complete') {
    await requirePhase(name, 'design');
    await requireDesignEvidence(name);
    await requireGatePremises(name, 'enter-build');
  } else if (event === 'build-complete') {
    await requirePhase(name, 'build');
    await requireBuildDecisions(name);
    const guarded = await classicGuardCommand([name, 'build', '--apply'], { json: false });
    if (guarded.exitCode !== 0) fail(guarded.stderr ?? `ERROR: Cannot complete build '${name}'`);
    if (guarded.stderr) output.stderr.push(guarded.stderr);
    return;
  } else if (event === 'verify-pass') {
    await requirePhase(name, 'verify');
    const verification = await classicGuardCommand([name, 'verify', '--apply'], { json: false });
    if (verification.exitCode !== 0) fail(verification.stderr ?? `ERROR: Cannot verify '${name}'`);
    if (verification.stderr) output.stderr.push(verification.stderr);
    return;
  } else if (event === 'verify-fail') {
    await requirePhase(name, 'verify');
    // Soft guard against agent loops: each verify-fail costs a full rebuild
    // and re-verification cycle on the next build-complete. After three
    // failures the transition still succeeds only with an explicit ack, so a
    // mechanical retry loop hits a decision point instead of burning cycles.
    const verifyFailures = Number((await readField(name, 'verify_failures')) ?? 0);
    if (
      Number.isFinite(verifyFailures) &&
      verifyFailures >= 3 &&
      process.env.COMET_ACK_VERIFY_FAILURES !== '1'
    ) {
      fail(
        `ERROR: '${name}' has already failed verification ${verifyFailures} times\n` +
          '  Repeated verify-fail transitions cost a full build + verification cycle each.\n' +
          '  Fix the reported failures, or set COMET_ACK_VERIFY_FAILURES=1 to accept another round deliberately.',
      );
    }
  } else if (event === 'archive-confirm') {
    await requirePhase(name, 'archive');
    if ((await readField(name, 'verify_result')) !== 'pass') {
      fail(`ERROR: Cannot transition '${name}': verify_result must be pass before archiving`);
    }
    if ((await readField(name, 'archived')) === 'true') {
      fail(`ERROR: Cannot transition '${name}': already archived`);
    }
  } else if (event === 'requirements-repair' || event === 'architecture-repair' || event === 'test-design-repair') {
    // Managed rework routes (contract section 5): the SAME run returns to
    // design for the named repair. Only managed delivery exposes them, so
    // hand phase edits stay impossible everywhere else.
    await requireManagedDelivery(name, `transition '${event}'`);
    const phaseNow = await readField(name, 'phase');
    const allowedPhases = event === 'requirements-repair' ? ['open', 'design', 'build', 'verify'] : ['build', 'verify'];
    if ((await readField(name, 'archived')) === 'true') fail('ERROR: archived history requires a new Change');
    if (!allowedPhases.includes(phaseNow)) {
      fail(
        `ERROR: Cannot transition '${name}': ${event} requires phase ${allowedPhases.join(' or ')}, got ${phaseNow}`,
      );
    }
  } else if (event === 'preset-escalate') {
    // preset (hotfix/tweak) → full: rewind phase to design so the agent can
    // supplement a Design Doc before continuing. Unlike verify-fail /
    // archive-reopen, this event also lifts workflow to full. classic_profile
    // MUST be synced alongside workflow, otherwise classic-resolver.ts throws
    // on the (phase=design, profile!=full) invariant — profileFor() reads
    // classicProfile first, which stays at the old preset value otherwise.
    await requirePhase(name, 'build');
    const workflow = await readField(name, 'workflow');
    if (!['hotfix', 'tweak'].includes(workflow)) {
      fail(
        `ERROR: Cannot transition '${name}': preset-escalate only applies to hotfix/tweak, got workflow='${workflow}'`,
      );
    }
  } else if (event === 'archive-reopen') {
    await requirePhase(name, 'archive');
    if ((await readField(name, 'archived')) === 'true') {
      fail(`ERROR: Cannot transition '${name}': already archived`);
    }
  } else {
    await requirePhase(name, 'archive');
    if ((await readField(name, 'verify_result')) !== 'pass') {
      fail(`ERROR: Cannot transition '${name}': verify_result must be pass before archiving`);
    }
    if ((await readField(name, 'archive_confirmation')) !== 'confirmed') {
      fail(
        `ERROR: Cannot transition '${name}': archive_confirmation must be confirmed before archiving`,
      );
    }
  }
  const { fromPhase, toPhase } = await applyTransitionEvent(
    output,
    name,
    event as ClassicTransitionEvent,
  );
  const locale = classicLocale(await readField(name, 'language'));
  output.envelope = classicTransitionEnvelope({ name, fromPhase, toPhase, locale });
  output.stdout.push(output.envelope.summary);
}

async function next(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { file, label, directory } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  let record = (await readDocument(file)).toJS() as Record<string, unknown>;
  if (record.managed_delivery === true && record.archived === true) {
    // The original resolver owns completion. Reconcile a consumed Kt after
    // crash/restart before presenting done; never stamp a status by hand.
    await withClassicStateLock(directory, async () => {
      await ensureClassicRuntimeRun(directory);
      await syncGateInvalidationsLocked(directory, classicCommandProjectRoot());
      await reconcileClassicRuntimeRun(directory);
    });
    record = (await readDocument(file)).toJS() as Record<string, unknown>;
  }
  const phase = scalar(record.phase);
  const workflow = scalar(record.workflow);
  const automatic = await readRecordField(record, 'auto_transition');
  const locale = classicLocale(await readRecordField(record, 'language'));
  output.data = {
    ...(await classicRecoveryContext(
      classicCommandProjectRoot(),
      directory,
      sparseClassicState(record),
    )),
    change: name,
    phase,
    configuration: sparseClassicState(record),
  };
  if (record.managed_delivery === true) output.data = { ...(output.data as Record<string, unknown>), managedAction: await describeCurrentManagedAction(directory) };
  if (scalar(record.archived) === 'true') {
    // D07/E02/H07: archived proves the spec operation only. A managed run
    // with an unmet run-level knowledge obligation keeps the SAME run open
    // and points next at the closeout — it is never completed here.
    if (knowledgeCloseoutBlocked({
      managedDelivery: record.managed_delivery === true,
      knowledgeCloseoutRequired: record.knowledge_closeout_required === true,
      knowledgeCloseout: record.knowledge_closeout ?? null,
    gateReceipts: record.gate_receipts ?? null,
    deliveryPolicy: record.delivery_policy ?? null,
      gateRunId: (await readRunState(directory))?.runId ?? null,
    })) {
      output.data = {
        change: name,
        phase,
        configuration: sparseClassicState(record),
        nextAction: { kind: 'knowledge-closeout' },
        completion: 'blocked: the run-level knowledge closeout obligation is unmet; archived does not complete this run',
      };
      output.stdout.push('NEXT: knowledge-closeout');
      output.stdout.push(`ROUTE: ${repairRoute('K')}`);
      return;
    }
    const delivery = await readClassicDelivery(classicCommandProjectRoot(), directory);
    const complete = ['complete', 'local-verified'].includes(delivery.verification.status);
    output.data = {
      change: name,
      phase,
      configuration: sparseClassicState(record),
      delivery,
      nextAction: { kind: complete ? 'done' : 'delivery' },
    };
    const envelope = classicNextEnvelope({
      name,
      phase: complete ? 'done' : 'archive',
      skill: complete ? '' : 'comet-archive',
      automatic: true,
      locale,
    });
    output.envelope = envelope;
    output.stdout.push(envelope.summary);
    output.stdout.push(
      complete
        ? 'NEXT: done'
        : `NEXT: delivery\nSKILL: comet-archive\nInspect authorized delivery and actual results; do not archive again. If the target branch or remote must change after Archive, record a new authorization with: comet state delivery ${name} --reauthorize --file <json>.`,
    );
    return;
  }
  const skill =
    phase === 'open'
      ? 'comet-open'
      : phase === 'design'
        ? 'comet-design'
        : phase === 'verify'
          ? 'comet-verify'
          : phase === 'archive'
            ? 'comet-archive'
            : phase === 'build'
              ? workflow === 'hotfix'
                ? 'comet-hotfix'
                : workflow === 'tweak'
                  ? 'comet-tweak'
                  : 'comet-build'
              : null;
  if (!skill) {
    fail(`ERROR: Cannot resolve next step for '${name}': unknown phase '${phase || 'null'}'`);
  }
  // Managed gates: next carries the same premise evaluation every other
  // entrance consumes, with the fixed rework route when blocked. The open
  // phase evaluates enter-design (P1-01): without a current R the next
  // surface routes to the requirements gate instead of forward.
  if (record.managed_delivery === true && entryGateAction(phase) !== null) {
    const { directory: gateDir } = await stateFile(name);
    await syncGateInvalidations(gateDir, classicCommandProjectRoot());
    const action = entryGateAction(phase)!;
    const evaluation = await evaluateGatePremises({
      projectRoot: classicCommandProjectRoot(),
      changeDir: gateDir,
      classic: { ...gateStateInputFrom(record), managedDelivery: true },
      run: await readRunState(gateDir),
      action,
    });
    output.data = {
      ...(output.data && typeof output.data === 'object' ? output.data : {}),
      gates: evaluation,
    };
    if (!evaluation.allowed) {
      output.stdout.push(`ROUTE: ${evaluation.routes[0]}`);
    }
  }
  output.envelope = classicNextEnvelope({
    name,
    phase,
    skill,
    automatic: automatic !== 'false',
    locale,
  });
  output.stdout.push(output.envelope.summary);
  output.stdout.push(`NEXT: ${automatic === 'false' ? 'manual' : 'auto'}`, `SKILL: ${skill}`);
  if (automatic === 'false') {
    output.stdout.push(`HINT: phase is '${phase}'; run /${skill} manually to continue`);
  }
}

async function taskCheckoff(
  output: CommandOutput,
  taskFile: string,
  taskText: string,
): Promise<void> {
  validateRelativePath(taskFile, 'task file');
  if (!taskText) fail('ERROR: Task text cannot be empty');
  const file = path.resolve(classicCommandProjectRoot(), taskFile);
  if (!(await exists(file))) fail(`ERROR: Task file not found: ${taskFile}`);
  const lines = (
    await readClassicProjectFile(classicCommandProjectRoot(), file, {
      label: 'Classic task-checkoff file',
    })
  ).split(/\r?\n/u);
  const matches = lines.filter((line) =>
    [`- [ ] ${taskText}`, `- [x] ${taskText}`, `- [X] ${taskText}`].includes(line),
  );
  const checked = matches.filter((line) => /^- \[[xX]\] /u.test(line));
  if (matches.length !== 1) {
    fail(
      `ERROR: task text must appear exactly once in ${taskFile} (found ${matches.length}): ${taskText}`,
    );
  }
  if (checked.length !== 1) fail(`ERROR: task is not checked in ${taskFile}: ${taskText}`);
  output.stdout.push('TASK_CHECKOFF: PASS', `FILE: ${taskFile}`, `TASK: ${taskText}`);
}

async function taskState(
  output: CommandOutput,
  name: string,
  action:
    { kind: 'list' | 'assign' | 'sync-plan' } | { kind: 'complete'; id: string; revision: string },
): Promise<void> {
  validateChangeName(name);
  const { directory } = await stateFile(name);
  const operation = async () => {
    const projection = await readClassicState(directory, { migrate: false });
    if (!projection.classic) fail('ERROR: Classic state is missing');
    if (projection.unknownKeys.length)
      fail(`ERROR: Unknown Classic state fields: ${projection.unknownKeys.join(', ')}`);
    const state = projection.classic;
    if (action.kind !== 'list') {
      const binding = await resolveBranchBinding(directory, {
        heal: false,
        cwd: classicCommandInvocationCwd(),
      });
      if (binding.status === 'drift')
        fail(driftBlockedMessage(name, binding.boundBranch, binding.currentBranch));
      if (binding.status === 'unbound-detached') fail(unboundDetachedMessage(name));
    }
    if (
      action.kind !== 'list' &&
      (state.archived || !['open', 'design', 'build'].includes(state.phase))
    ) {
      fail('ERROR: task updates require an active Open, Design or Build phase');
    }
    if (action.kind === 'complete' && state.phase !== 'build')
      fail('ERROR: task completion requires Build phase');
    if (action.kind === 'complete') await requireManagedTaskReview(directory, action.id);
    const tasksFile = path.join(directory, 'tasks.md');
    const source = await readClassicProjectFile(classicCommandProjectRoot(), tasksFile, {
      label: 'Classic task authority',
    });
    const updated =
      action.kind === 'assign'
        ? assignClassicTaskIds(source)
        : action.kind === 'complete'
          ? completeClassicTask(source, action.id, action.revision)
          : source;
    const tasks = parseClassicTasks(updated);
    if (!tasks.length) fail('ERROR: tasks.md has no implementation tasks');
    const planPath = state.plan;
    let planSync: 'none' | 'synced' | 'mapping-required' = 'none';
    let planUpdate: { file: string; source: string; updated: string } | null = null;
    if (
      planPath &&
      planPath !== 'null' &&
      (await exists(path.resolve(classicCommandProjectRoot(), planPath)))
    ) {
      const planFile = path.resolve(classicCommandProjectRoot(), planPath);
      const planSource = await readClassicProjectFile(classicCommandProjectRoot(), planFile, {
        label: 'Classic plan task mapping',
      });
      const mapping = inspectClassicPlanTasks(planSource, tasks);
      if (mapping.unmapped.length) {
        planSync = 'mapping-required';
        if (action.kind === 'sync-plan')
          fail(
            'ERROR: reconcile legacy plan tasks and assign explicit matching IDs before syncing',
          );
      } else if (mapping.total && ['complete', 'sync-plan'].includes(action.kind)) {
        planUpdate = {
          file: planFile,
          source: planSource,
          updated: synchronizeClassicPlanTasks(planSource, tasks),
        };
        planSync = 'synced';
      }
    }
    if (updated !== source)
      await writeClassicProjectText(classicCommandProjectRoot(), tasksFile, updated, {
        label: 'Classic task authority',
      });
    // Authority is committed first; retrying completion repairs an interrupted plan projection.
    if (planUpdate && planUpdate.source !== planUpdate.updated)
      await writeClassicProjectText(
        classicCommandProjectRoot(),
        planUpdate.file,
        planUpdate.updated,
        { label: 'Classic plan task projection' },
      );
    output.data = {
      change: name,
      authority: path.relative(classicCommandProjectRoot(), tasksFile).replaceAll('\\', '/'),
      revision: classicTaskRevision(updated),
      needsIds: tasks.some((task) => !task.id),
      planSync,
      tasks,
      progress: { total: tasks.length, completed: tasks.filter((task) => task.completed).length },
    };
    output.stdout.push(
      `Tasks: ${tasks.filter((task) => task.completed).length}/${tasks.length} complete. Use --json for task IDs and revision.`,
    );
  };
  if (action.kind === 'list') await operation();
  else await withClassicStateLock(directory, operation);
}

async function progressCommand(
  output: CommandOutput,
  kind: 'checkpoint' | 'delivery',
  args: string[],
) {
  const reauthorize = kind === 'delivery' && args[1] === '--reauthorize';
  const inputIndex = reauthorize ? 3 : 2;
  if (
    args.length !== 1 &&
    !(args.length === 3 && args[1] === '--file') &&
    !(reauthorize && args.length === 4 && args[2] === '--file') &&
    !(kind === 'delivery' && args.length === 2 && args[1] === '--verify')
  )
    fail(
      `Usage: comet state ${kind} <change-name> [--file <json>${kind === 'delivery' ? ' | --verify | --reauthorize --file <json>' : ''}]`,
    );
  validateChangeName(args[0]);
  const { directory, file } = await stateFile(args[0]);
  const root = classicCommandProjectRoot();
  const write = args[1] === '--file' || reauthorize;
  if (write && kind === 'delivery') {
    const inputPath = path.isAbsolute(args[inputIndex])
      ? path.resolve(args[inputIndex])
      : path.resolve(root, args[inputIndex]);
    if (samePath(inputPath, path.resolve(path.join(directory, '.comet', 'delivery.json'))))
      fail(
        'ERROR: delivery input file collides with the Runtime record path <change-dir>/.comet/delivery.json; save the input outside the change directory',
      );
  }
  const operation = async () => {
    const state = sparseClassicState((await readDocument(file)).toJS() as Record<string, unknown>);
    const input = write
      ? JSON.parse(
          await readClassicProjectFile(root, args[inputIndex], {
            label: 'Classic progress input',
          }),
        )
      : null;
    if (kind === 'checkpoint') {
      if (write && (state.phase !== 'build' || state.archived))
        fail('ERROR: checkpoint updates require active Build phase');
      const source = await readClassicProjectFile(root, path.join(directory, 'tasks.md'), {
        label: 'Classic checkpoint task authority',
      });
      output.data = write
        ? await writeClassicCheckpoint(root, directory, input, source)
        : await readClassicCheckpoint(root, directory, source);
    } else {
      output.data = write
        ? reauthorize
          ? await reauthorizeClassicDelivery(root, directory, input, state)
          : await writeClassicDelivery(root, directory, input, state)
        : await readClassicDelivery(root, directory, { verifyRemote: args[1] === '--verify' });
    }
    output.stdout.push(
      `${kind}: ${write ? 'recorded' : 'inspected'}. Use --json for exact state and verification.`,
    );
  };
  if (write) {
    await assertStateCommandWritable('set');
    if (!reauthorize) {
      const binding = await resolveBranchBinding(directory, {
        heal: false,
        cwd: classicCommandInvocationCwd(),
      });
      if (binding.status === 'drift' || binding.status === 'unbound-detached')
        fail(
          'ERROR: progress update requires the bound branch; inspect the workspace before retrying',
        );
    }
    await withClassicStateLock(directory, operation);
  } else await operation();
  if (
    kind === 'delivery' &&
    ['complete', 'local-verified'].includes(
      (output.data as { verification?: { status?: string } } | undefined)?.verification?.status ??
        '',
    )
  ) {
    await clearCurrentChangeIf(root, args[0]);
  }
}

async function check(
  output: CommandOutput,
  name: string,
  phase: string,
  details = false,
): Promise<void> {
  validateChangeName(name);
  validateEnum(phase, PHASES);
  const { file, directory, label } = await stateFile(name);
  output.stdout.push(`=== Entry Check: comet-${phase} ===`);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const record = (await readDocument(file)).toJS() as Record<string, unknown>;
  let blocked = false;
  let passed = 0;
  let total = 0;
  const issues: ClassicIssue[] = [];
  const pass = (message: string) => {
    output.stdout.push(`  ${green('[PASS]')} ${message}`);
    passed += 1;
    total += 1;
  };
  const reject = (message: string, issue?: Partial<ClassicIssue>) => {
    output.stdout.push(`  ${red('[FAIL]')} ${message}`);
    blocked = true;
    total += 1;
    issues.push(
      classicIssue(message, {
        code: 'CLASSIC_ENTRY_CHECK_FAILED',
        path: file,
        remediation: 'Repair the reported prerequisite, then retry this entry check.',
        ...issue,
      }),
    );
  };
  const expectField = async (field: string, expected: string) => {
    const actual = await readRecordField(record, field);
    if (actual === expected) pass(`${field}=${actual} (expected: ${expected})`);
    else reject(`${field}=${actual} (expected: ${expected})`, { field, actual, expected });
  };
  pass('.comet.yaml exists');
  await expectField('phase', phase);
  if (phase === 'design') {
    await expectField('workflow', 'full');
    const designDoc = scalar(record.design_doc);
    pass(
      designDoc && designDoc !== 'null'
        ? `design_doc=${designDoc}; preserve registered Design work`
        : 'design_doc is empty/null',
    );
    const requirements = await readClassicArtifactRequirements(
      classicCommandProjectRoot(),
      directory,
    );
    for (const problem of requirements.problems) reject(problem);
    for (const artifact of requirements.files) {
      if (record.managed_delivery === true && path.basename(artifact) === 'design.md' && !(await exists(artifact))) continue;
      const present = await nonempty(artifact);
      (present ? pass : reject)(`${artifact} ${present ? 'non-empty' : 'missing or empty'}`);
    }
  } else if (phase === 'build') {
    const workflow = scalar(record.workflow);
    const designDoc = scalar(record.design_doc);
    if (workflow === 'full') {
      (designDoc && designDoc !== 'null' && (await exists(designDoc)) ? pass : reject)(
        `design_doc=${designDoc} (expected: non-null and file exists)`,
      );
    } else {
      pass(`workflow=${workflow} (design_doc not required)`);
    }
    for (const artifact of ['proposal.md', 'tasks.md']) {
      const present = await nonempty(path.join(directory, artifact));
      (present ? pass : reject)(`${artifact} ${present ? 'non-empty' : 'missing or empty'}`);
    }
  } else if (phase === 'verify') {
    const value = scalar(record.verify_result);
    (['', 'null', 'pending'].includes(value) ? pass : reject)(
      `verify_result=${value} (expected: pending or null)`,
    );
  } else if (phase === 'archive') {
    await expectField('verify_result', 'pass');
    const archived = scalar(record.archived);
    pass(
      archived === 'true'
        ? 'archived=true; resume delivery only, do not archive again'
        : `archived=${archived} (ready for archive confirmation)`,
    );
  }
  // Managed delivery entry gates (C07 7th entrance semantics): the entry
  // check set for a phase includes the same gate premises the guard,
  // transitions, write hook, resolver and completion predicate consume.
  if (record.managed_delivery === true && entryGateAction(phase) !== null) {
    await syncGateInvalidations(directory, classicCommandProjectRoot());
    const action = entryGateAction(phase)!;
    const evaluation = await evaluateGatePremises({
      projectRoot: classicCommandProjectRoot(),
      changeDir: directory,
      classic: { ...gateStateInputFrom(record), managedDelivery: true },
      run: await readRunState(directory),
      action,
    });
    for (const gate of requiredGates(action)) {
      if (evaluation.missing.includes(gate)) reject(`managed gate ${gate}: no accepted receipt (dispatch and accept through the Runtime)`);
      else if (evaluation.stale.includes(gate)) reject(`managed gate ${gate}: receipt is stale against current inputs`);
      else if (evaluation.rejected.includes(gate)) reject(`managed gate ${gate}: rejected — rework required`);
      else pass(`managed gate ${gate}: current`);
    }
  }
  const binding = await resolveBranchBinding(directory, {
    heal: true,
    cwd: classicCommandInvocationCwd(),
  });
  if (binding.bindingRequired) {
    switch (binding.status) {
      case 'drift':
        reject(driftBlockedMessage(name, binding.boundBranch, binding.currentBranch));
        break;
      case 'unbound-detached':
        reject(unboundDetachedMessage(name));
        break;
      case 'healed':
        record.bound_branch = binding.branch;
        pass(`bound_branch lazily set to ${binding.branch}`);
        break;
      case 'needs-heal':
      case 'ok':
      case 'not-applicable':
        pass('bound_branch matches current branch');
        break;
      default: {
        const exhaustive: never = binding;
        throw new Error(`unhandled branch binding status: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  output.stdout.push('');
  const locale = classicLocale(await readRecordField(record, 'language'));
  const recovery = await classicRecoveryContext(
    classicCommandProjectRoot(),
    directory,
    sparseClassicState(record),
    details,
  );
  for (const issue of recovery.issues ?? []) reject(issue.message, issue);
  output.data = {
    ...recovery,
    change: name,
    phase: record.phase,
    requestedPhase: phase,
    configuration: sparseClassicState(record),
    checks: { passed, total, blocked },
    issues,
  };
  output.envelope = classicEntryCheckEnvelope({ name, phase, passed, total, locale });
  output.stdout.push(output.envelope.summary);
  if (blocked) {
    output.stderr.push(red('BLOCKED — fix failing checks before proceeding'));
    throw new CommandFailure('', 1);
  }
  output.stderr.push(green('ALL CHECKS PASSED — ready to proceed'));
}

/** Coordinate only the already-authorized Design writes; each existing operation retains its lock and validation. */
async function completeDesign(
  output: CommandOutput,
  name: string,
  designRef: string,
  options: Parameters<ClassicCommandHandler>[1],
): Promise<void> {
  validateChangeName(name);
  validateRelativePath(designRef, 'design_doc');
  const phase = await readField(name, 'phase');
  const recorded = await readField(name, 'design_doc');
  if (!['design', 'build'].includes(phase) || (await readField(name, 'workflow')) !== 'full')
    fail(
      'ERROR: complete-design requires the full workflow in design or its completed build phase',
    );
  if (recorded && recorded !== 'null' && recorded !== designRef)
    fail(
      'ERROR: complete-design must preserve the registered Design Doc; explicitly correct design_doc before retrying',
    );
  if (phase === 'build') {
    if (recorded !== designRef) fail('ERROR: completed Design reference does not match');
    await check(output, name, 'build');
    return;
  }
  await check(output, name, 'design');
  if (recorded !== designRef) await setFields(output, name, [['design_doc', designRef]]);
  const handoff = await classicHandoffCommand([name, 'design', '--write'], options);
  if (handoff.stderr) output.stderr.push(handoff.stderr);
  if (handoff.exitCode !== 0) {
    output.data = {
      ...(output.data as Record<string, unknown>),
      issues: [
        classicIssue(handoff.stderr ?? 'Design handoff failed', {
          code: 'CLASSIC_DESIGN_HANDOFF_FAILED',
          field: 'handoff_context',
          remediation:
            'Preserve the registered design, repair the handoff cause, then retry complete-design.',
        }),
      ],
    };
    throw new CommandFailure('', handoff.exitCode);
  }
  const guard = await classicGuardCommand([name, 'design', '--apply'], options);
  if (guard.stderr) output.stderr.push(guard.stderr);
  output.data = guard.data;
  output.envelope = guard.envelope;
  if (guard.exitCode !== 0) throw new CommandFailure('', guard.exitCode);
}

async function fieldStatus(field: string, value: string, file?: string): Promise<string> {
  if (!value || value === 'null') return `  - ${field}: PENDING`;
  if (file && !(await exists(path.resolve(classicCommandProjectRoot(), file)))) {
    return `  - ${field}: BROKEN (path ${value} does not exist)`;
  }
  return `  - ${field}: DONE (${value})`;
}

async function recoveryArtifacts(output: CommandOutput, directory: string) {
  const requirements = await readClassicArtifactRequirements(
    classicCommandProjectRoot(),
    directory,
  );
  output.stdout.push('  Artifacts:');
  let complete = 0;
  for (const file of requirements.files) {
    const done = await nonempty(file);
    if (done) complete += 1;
    output.stdout.push(`  - ${path.relative(directory, file)}: ${done ? 'DONE' : 'PENDING'}`);
  }
  for (const skipped of requirements.skipped) output.stdout.push(`  - ${skipped}: SKIPPED`);
  for (const problem of requirements.problems) output.stdout.push(`  - ${problem}`);
  return {
    complete,
    ready: complete === requirements.files.length && !requirements.problems.length,
  };
}

async function recoverOpen(output: CommandOutput, directory: string): Promise<void> {
  const { complete, ready } = await recoveryArtifacts(output, directory);
  output.stdout.push(
    '',
    ready
      ? 'Recovery action: All artifacts complete. Run /comet-open user confirmation, then guard to transition.'
      : complete === 0
        ? 'Recovery action: No artifacts created yet. Start from /comet-open Step 1 (explore and clarify).'
        : 'Recovery action: Some artifacts incomplete. Resume /comet-open from the first missing artifact.',
  );
}

async function recoverDesign(
  output: CommandOutput,
  name: string,
  directory: string,
): Promise<void> {
  const { ready } = await recoveryArtifacts(output, directory);
  if (!ready) {
    output.stdout.push(
      'Recovery action: Required artifacts are incomplete. Repair the reported dependency or file before continuing design.',
    );
    return;
  }
  const handoff = await readField(name, 'handoff_context');
  const hash = await readField(name, 'handoff_hash');
  const design = await readField(name, 'design_doc');
  output.stdout.push(
    '',
    '  Design progress:',
    await fieldStatus('handoff_context', handoff, handoff),
    await fieldStatus('handoff_hash', hash),
    await fieldStatus('design_doc', design, design),
    '',
  );
  if (
    design &&
    design !== 'null' &&
    (await exists(path.resolve(classicCommandProjectRoot(), design)))
  ) {
    output.stdout.push(
      'Recovery action: Design Doc already created and linked. Run guard to transition to build.',
    );
  } else if (
    handoff &&
    handoff !== 'null' &&
    (await exists(path.resolve(classicCommandProjectRoot(), handoff)))
  ) {
    output.stdout.push(
      'Recovery action: Handoff generated but Design Doc not yet created. Resume from brainstorming confirmation (Step 1c).',
    );
  } else {
    output.stdout.push(
      'Recovery action: No handoff generated yet. Start from Step 1a (generate handoff package).',
    );
  }
}

async function recoverBuild(
  output: CommandOutput,
  state: ClassicState,
  context: Awaited<ReturnType<typeof classicRecoveryContext>>,
): Promise<void> {
  const value = (input: string | null) => input ?? 'null';
  output.stdout.push(
    '  Build decisions:',
    await fieldStatus('isolation', value(state.isolation)),
    await fieldStatus('build_mode', value(state.buildMode)),
    await fieldStatus('build_pause', value(state.buildPause)),
    await fieldStatus('tdd_mode', value(state.tddMode)),
    await fieldStatus('review_mode', value(state.reviewMode)),
    await fieldStatus('subagent_dispatch', value(state.subagentDispatch)),
    '',
    '  Plan:',
    await fieldStatus('plan', value(state.plan), state.plan ?? undefined),
    '',
    context.taskState.exists
      ? `  Tasks: ${context.taskState.completed}/${context.taskState.total} done, ${context.taskState.total - context.taskState.completed} pending`
      : '  Tasks: tasks.md MISSING',
    `  Plan task mapping: ${context.planMapping.status}`,
    '',
    `Recovery action: ${context.nextAction.reason}`,
  );
}

async function recoverVerify(output: CommandOutput, name: string): Promise<void> {
  const result = await readField(name, 'verify_result');
  const failures = await readField(name, 'verify_failures');
  const mode = await readField(name, 'verify_mode');
  const report = await readField(name, 'verification_report');
  const branch = await readField(name, 'branch_status');
  output.stdout.push(
    '  Verification:',
    await fieldStatus('verify_result', result),
    `  - verify_failures: ${failures || '0'}`,
    await fieldStatus('verify_mode', mode),
    await fieldStatus('verification_report', report, report),
    branch === 'handled'
      ? '  - branch_status: LEGACY (handled before archive; archive still owns final closure)'
      : '  - branch_status: DEFERRED (handled after the archive commit)',
    '',
    result === 'pass'
      ? 'Recovery action: Verification complete. Continue to archive; branch handling happens after archive changes are committed.'
      : result === 'fail'
        ? 'Recovery action: Verification failed and rolled back to build. Resume from /comet-build.'
        : 'Recovery action: Verification not yet started or in progress. Run scale assessment then verify.',
  );
}

async function recoverArchive(output: CommandOutput, name: string): Promise<void> {
  const archiveConfirmation = await readField(name, 'archive_confirmation');
  output.stdout.push(
    '  Archive:',
    await fieldStatus('verify_result', await readField(name, 'verify_result')),
    await fieldStatus('archive_confirmation', archiveConfirmation),
    await fieldStatus('archived', await readField(name, 'archived')),
    '',
    archiveConfirmation === 'confirmed'
      ? 'Recovery action: Archive is confirmed. Run /comet-archive to complete archiving.'
      : 'Recovery action: Ask for final archive confirmation in /comet-archive before running the archive command.',
  );
}

async function recover(
  output: CommandOutput,
  name: string,
  details = false,
  json = false,
): Promise<void> {
  validateChangeName(name);
  const { file, directory, label } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const projection = await readClassicState(directory, { migrate: false });
  const classic =
    projection.classic ??
    sparseClassicState((await readDocument(file)).toJS() as Record<string, unknown>);
  const phase = classic.phase;
  if (phase === 'design') await check(output, name, phase, details);
  const workflow = classic.workflow;
  const locale = classicLocale(classic.language);
  const evidenceScopes = projection.run
    ? await recoverCommandChecks(classicCommandProjectRoot(), directory, projection.run, {
        // Archive trajectories are sealed evidence. Recovery may inspect their
        // exact plans but must never append a new invalidation event to them.
        persistInvalidation: !classic.archived,
      })
    : { build: 'rerun-required', verify: 'rerun-required' };
  const checkpoint = path.join(directory, '.comet', 'subagent-progress.md');
  const context = await classicRecoveryContext(
    classicCommandProjectRoot(),
    directory,
    classic,
    details,
    projection.run ?? null,
  );
  output.data = {
    ...context,
    change: name,
    phase,
    workflow,
    projectRoot: classicCommandProjectRoot(),
    changeDir: directory,
    currentStep: projection.run?.currentStep ?? null,
    configuration: classic,
    checkpoint: (await exists(checkpoint))
      ? {
          path: checkpoint,
          ...(details
            ? {
                content: await readClassicProjectFile(classicCommandProjectRoot(), checkpoint, {
                  label: 'Recovery checkpoint',
                }),
              }
            : {}),
        }
      : null,
    evidence: {
      status: evidenceScopes[phase === 'build' ? 'build' : 'verify'],
      reason: 'cold-recovery',
      scopes: evidenceScopes,
    },
    requiredFiles: [file, ...context.requiredFiles],
  };
  output.envelope = classicRecoveryEnvelope({ name, phase, locale });
  if (json) return;
  output.stdout.push(
    output.envelope.summary,
    `=== Recovery Context: ${name} ===`,
    `Phase: ${phase}`,
    `Workflow: ${workflow}`,
    '',
    'State fields:',
  );
  if (phase === 'open') {
    await recoverOpen(output, directory);
  } else if (phase === 'design') {
    await recoverDesign(output, name, directory);
  } else if (phase === 'build') {
    await recoverBuild(output, classic, context);
  } else if (phase === 'verify') {
    await recoverVerify(output, name);
  } else if (phase === 'archive') {
    await recoverArchive(output, name);
  } else {
    fail(`ERROR: Unknown phase: ${phase}`);
  }
  output.stdout.push('', '=== End Recovery Context ===');
  output.stdout.push(`Next action: ${context.nextAction.kind}. ${context.nextAction.reason}`);
}

async function scale(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { file, directory, label } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const tasksFile = path.join(directory, 'tasks.md');
  const taskCount = (await exists(tasksFile))
    ? parseClassicTasks(
        await readClassicProjectFile(classicCommandProjectRoot(), tasksFile, {
          label: 'Classic scale task file',
        }),
      ).length
    : 0;
  const specs = path.join(directory, 'specs');
  const deltaSpecs = (await collectClassicSpecFiles(classicCommandProjectRoot(), specs)).length;
  const plan = await readField(name, 'plan');
  let baseRef = '';
  if (plan && plan !== 'null' && (await exists(plan))) {
    const match = (
      await readClassicProjectFile(classicCommandProjectRoot(), plan, {
        label: 'Classic scale plan',
      })
    ).match(/^base-ref:\s*(.+)$/mu);
    baseRef = match?.[1].trim() ?? '';
  }
  if (!baseRef) baseRef = await readField(name, 'base_ref');
  const changed = gitOutput([
    'diff',
    '--name-only',
    ...(baseRef && baseRef !== 'null' ? [`${baseRef}...HEAD`] : ['HEAD']),
  ]);
  const changedFiles = changed ? changed.split(/\r?\n/u).filter(Boolean).length : 0;
  const result = taskCount > 3 || deltaSpecs > 1 || changedFiles > 8 ? 'full' : 'light';
  const selected = await readField(name, 'verify_mode');
  output.data = {
    change: name,
    recommendation: result,
    selected: selected === 'light' || selected === 'full' ? selected : null,
    metrics: { tasks: taskCount, deltaSpecs, changedFiles },
  };
  const locale = classicLocale(await readField(name, 'language'));
  output.envelope = classicScaleEnvelope({ name, result, locale });
  output.stderr.push(
    output.envelope.summary,
    `=== Scale Assessment: ${name} ===`,
    `  Tasks: ${taskCount} (threshold: 3)`,
    `  Delta specs: ${deltaSpecs} capabilities (threshold: 1)`,
    `  Changed files: ${changedFiles} (threshold: 8)`,
    `  → Result: ${result}`,
    green(`[SCALE] recommendation=${result}; selected=${selected || 'null'} (unchanged)`),
  );
}

function parseRecordCheckOptions(args: string[]): {
  command: string;
  exitCode: number;
  cwd?: string;
} {
  let command: string | undefined;
  let exitCodeText: string | undefined;
  let cwd: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!['--command', '--exit-code', '--cwd'].includes(option)) {
      fail(`ERROR: Unknown option: ${option}`);
    }
    const value = args[index + 1];
    if (value === undefined) fail(`ERROR: Missing value for option: ${option}`);
    if (option === '--command') command = value;
    else if (option === '--exit-code') exitCodeText = value;
    else cwd = value;
  }
  if (command === undefined) fail('ERROR: Missing option: --command');
  if (exitCodeText === undefined) fail('ERROR: Missing option: --exit-code');
  if (!/^-?\d+$/u.test(exitCodeText)) fail('ERROR: --exit-code must be an integer');
  return { command, exitCode: Number(exitCodeText), ...(cwd === undefined ? {} : { cwd }) };
}

async function recordCheck(
  output: CommandOutput,
  name: string,
  scopeText: string,
  args: string[],
): Promise<void> {
  validateChangeName(name);
  if (scopeText !== 'build' && scopeText !== 'verify') {
    fail(`ERROR: Invalid command check scope: '${scopeText}'`);
  }
  const options = parseRecordCheckOptions(args);
  const { directory, file } = await stateFile(name);
  const projectRoot = classicCommandProjectRoot();
  const activeChangesDir = (await assertClassicLayoutReadable(projectRoot)).changesDir;
  if (path.dirname(directory) !== activeChangesDir || !(await exists(file))) {
    fail(`ERROR: command checks require an active change: ${name}`);
  }
  try {
    const projection = await readClassicState(directory, { migrate: false });
    if (!projection.classic || !projection.run) {
      throw new Error('command checks require an existing synchronized Classic Run');
    }
    const reconciliation = await reconcileClassicRuntimeRun(directory, projection);
    if (reconciliation.reconciled && reconciliation.fromStep !== null) {
      output.stderr.push(
        green(
          `[RECONCILED] currentStep ${reconciliation.fromStep} -> ${reconciliation.context.run.currentStep}`,
        ),
      );
    }
    const recorded = await recordCommandCheck(projectRoot, directory, reconciliation.context.run, {
      scope: scopeText as CommandCheckScope,
      ...options,
      cwd:
        options.cwd ??
        (path.relative(projectRoot, classicCommandInvocationCwd()).replaceAll('\\', '/') || '.'),
    });
    output.stderr.push(
      green(
        `[RECORDED] ${recorded.scope} exit=${recorded.exitCode} cwd=${recorded.cwd} command=${recorded.command}`,
      ),
    );
  } catch (error) {
    fail(`ERROR: ${(error as Error).message}`);
  }
}

// ---- managed delivery gate runtime commands (0002) -------------------------

async function gatesStatus(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { directory, record } = await managedStateRecord(name);
  const managed = record.managed_delivery === true;
  const phase = typeof record.phase === 'string' ? record.phase : null;
  const action =
    phase === 'open'
      ? 'enter-design'
      : phase === 'design'
        ? 'enter-build'
        : phase === 'build'
          ? 'enter-verify'
          : phase === 'verify'
            ? 'enter-archive'
            : phase === 'archive' ? (record.archived === true ? 'complete' : 'archive-spec') : null;
  let evaluation = null;
  if (managed && action) {
    // P1-03: the gates surface persists observed invalidations before it
    // evaluates, so the reported generation is the persisted one.
    await syncGateInvalidations(directory, classicCommandProjectRoot());
    evaluation = await evaluateGatePremises({
      projectRoot: classicCommandProjectRoot(),
      changeDir: directory,
      classic: { ...gateStateInputFrom(record), managedDelivery: true },
      run: await readRunState(directory),
      action,
    });
  }
  const completionBlocked = knowledgeCloseoutBlocked({
    managedDelivery: managed,
    knowledgeCloseoutRequired: record.knowledge_closeout_required === true,
    knowledgeCloseout: record.knowledge_closeout ?? null,
    gateReceipts: record.gate_receipts ?? null,
    deliveryPolicy: record.delivery_policy ?? null,
      gateRunId: (await readRunState(directory))?.runId ?? null,
  });
  output.data = {
    change: name,
    managed,
    phase,
    policyVersion: GATE_POLICY_VERSION,
    action,
    evaluation,
    knowledgeCloseoutRequired: record.knowledge_closeout_required === true,
    knowledgeCloseoutRecorded: Boolean(record.knowledge_closeout),
    completionBlocked,
    receipts: parseGateReceipts(record.gate_receipts ?? null),
  };
  if (completionBlocked) {
    output.stdout.push(`COMPLETION: blocked — ${repairRoute('K')}`);
  } else {
    output.stdout.push(`COMPLETION: ${managed ? 'allowed' : 'unmanaged'}`);
  }
  if (evaluation && !evaluation.allowed) {
    for (const detail of evaluation.details) output.stdout.push(`GATE: ${detail}`);
    for (const route of evaluation.routes) output.stdout.push(`ROUTE: ${route}`);
  }
}

async function dispatchGate(output: CommandOutput, name: string, gate: string): Promise<void> {
  validateChangeName(name);
  if (!isGateId(gate)) fail(`ERROR: gate must be one of R/A/T/P/V/K, got '${gate}'`);
  if (gate === 'K') fail('UNVERIFIED: generic K is historical only; separate Kp/Kt are required');
  const { directory, record } = await managedStateRecord(name);
  if ((await readRunState(directory))?.status === 'completed') throw new CommandFailure('RUN_COMPLETED: completed product Runs cannot dispatch new gates; linked maintenance is required', 2, { code: 'RUN_COMPLETED', message: 'Completed product lifecycle is immutable' });
  if (record.managed_delivery !== true) {
    fail(`ERROR: gate dispatching requires managed delivery; '${name}' is not managed`);
  }
  const actualRunId = (await readRunState(directory))?.runId;
  if (record.archived === true && !(gate === 'Kt' && knowledgeCloseoutBlocked(closeoutPredicateFromDocument(record, actualRunId)))) fail(`ERROR: '${name}' is archived; gate dispatching is closed`);
  await requireRunAuthority(directory);
  await withClassicStateLock(directory, async () => {
    requireManagedDeliveryHost();
    if ((await readRunState(directory))?.status === 'completed') throw new CommandFailure('RUN_COMPLETED: completed product Run cannot dispatch a new gate', 2, { code: 'RUN_COMPLETED', message: 'Completed product lifecycle is immutable' });
    await ensureClassicRuntimeRun(directory);
    await syncGateInvalidationsLocked(directory, classicCommandProjectRoot());
    const { record: freshRecord } = await managedStateRecord(name);
    const registry = await readGateDispatches(directory);
    const permittedPhase: Record<string, string[]> = { R: ['open'], A: ['design'], T: ['design'], P: ['build'], V: ['verify'], Kp: ['verify', 'archive'], Kt: ['archive'] };
    if (!permittedPhase[gate]?.includes(String(freshRecord.phase))) fail(`UNVERIFIED: gate ${gate} is not authorized in the current native phase; use its controlled repair route`);
    const inputs = await currentGateInputs(directory, freshRecord, gate);
    if (inputs.missing.length > 0) {
      fail(
        `ERROR: gate ${gate} inputs are incomplete:\n  ${inputs.missing.join('\n  ')}\n  Declare the artifacts (design_doc / test_intent / plan) before dispatching.`,
      );
    }
    const dependencies = await evaluateGatePremises({ projectRoot: classicCommandProjectRoot(), changeDir: directory,
      classic: { ...gateStateInputFrom(freshRecord), managedDelivery: true }, run: await readRunState(directory),
      action: 'enter-design', dependencyOf: gate });
    if (!dependencies.allowed) fail(`UNVERIFIED: prerequisite gates for ${gate} are not current: ${dependencies.details.join('; ')}`);
    const openDispatch = registry.dispatches.find((entry) => entry.gate === gate && entry.inputDigest === inputs.digest && entry.state === 'open');
    if (openDispatch) {
      output.data = { change: name, gate, dispatch: openDispatch, recovered: true };
      output.stdout.push(JSON.stringify({ execution: openDispatch.execution, attempt: openDispatch.attempt, role: openDispatch.role, inputDigest: openDispatch.inputDigest, dependsOn: openDispatch.dependsOn, recovered: true }));
      output.stderr.push(green(`[RECOVERED] gate ${gate} open execution ${openDispatch.execution}; same job_key`));
      return;
    }
    const priorForVersion = registry.dispatches.filter(
      (entry) => entry.gate === gate && entry.inputDigest === inputs.digest,
    );
    const rejections = priorForVersion.filter((entry) => entry.verdict === 'reject').length;
    if (rejections >= GATE_REWORK_BUDGET) {
      fail(
        `ERROR: gate ${gate} exhausted its rework budget (${rejections} rejections for this input version)\n  Route: waiting-decision — report the blocking findings to the owning role`,
      );
    }
    // P1-03: bind the dispatch to the CURRENT persisted invalidation
    // generation; a late acceptance from an older generation is refused even
    // when the bytes round-trip back to the dispatched digest.
    await syncGateInvalidationsLocked(directory, classicCommandProjectRoot());
    const { record: currentRecord } = await managedStateRecord(name);
    const epoch = typeof currentRecord.check_epoch === 'number' ? currentRecord.check_epoch : 0;
    const invalidations = parseGateInvalidations(
      typeof currentRecord.gate_invalidations === 'string' ? currentRecord.gate_invalidations : null,
    );
    const execution = `gate-${gate.toLowerCase()}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const dispatch: import('./classic-gate-runtime.js').GateDispatch = {
      gate,
      role: GATE_ROLES[gate],
      execution,
      attempt: priorForVersion.length + 1,
      inputDigest: inputs.digest,
      dependsOn: inputs.dependsOn,
      issuedAt: new Date().toISOString(),
      epoch,
      generation: gateGenerationOf(invalidations, gate),
      state: 'open' as const,
    };
    const host = requireManagedDeliveryHost();
    const nativeRun = await readRunState(directory);
    if (!nativeRun) fail('UNVERIFIED: a managed gate requires the original synchronized Run');
    const context = host.context({ ...dispatch, runId: nativeRun.runId, projectRoot: classicCommandProjectRoot(), changeDir: directory });
    const eligibility = context.admissionOptions;
    const qualified = eligibility?.sourceQualification;
    const clock = typeof eligibility?.now === 'string' ? Date.parse(eligibility.now) : NaN;
    if (!qualified || qualified.scope !== 'protected-source' || qualified.status !== 'qualified'
      || typeof qualified.expiresAt !== 'string' || !Number.isFinite(Date.parse(qualified.expiresAt)) || !Number.isFinite(clock) || Date.parse(qualified.expiresAt) <= clock
      || !Array.isArray(qualified.evidenceRefs) || qualified.evidenceRefs.length === 0) fail('UNVERIFIED: current protected source eligibility is missing or expired');
    const action = context.actionBinding;
    if (gate === 'P' && (!Array.isArray(action?.allowedTools) || action.allowedTools.some((tool: unknown) => typeof tool !== 'string' || /(?:^|__)(?:create_goal|update_goal|spawn_agent|send_message_to_thread|automation_update|dispatch|schedule|archive.*|publish.*)$/u.test(tool)))) fail('UNVERIFIED: planner P permits plan artifacts only; controller tools are not authorized');
    const frozenPolicy = JSON.parse(String(currentRecord.delivery_policy));
    if (!context.policy || context.policy.digest !== frozenPolicy.digest || action?.policyDigest !== frozenPolicy.digest) fail('UNVERIFIED: protected policy snapshot changed before dispatch');
    if (!action || action.profile !== GATE_POLICY_VERSION || action.run !== nativeRun.runId || action.gate !== gate
      || action.execution !== execution || action.role !== dispatch.role || action.inputDigest !== inputs.digest
      || action.attempt !== dispatch.attempt || action.epoch !== epoch) fail('UNVERIFIED: protected current ActionBinding mismatches native intent');
    dispatch.sourceQualification = qualified;
    dispatch.runId = nativeRun.runId;
    dispatch.actionBinding = action;
    dispatch.protectedDispatch = host.authority.issueDispatch({ ...action, actionBinding: action });
    registry.dispatches.push(dispatch);
    await writeGateDispatches(directory, registry);
    output.data = { change: name, gate, dispatch };
    output.stdout.push(
      JSON.stringify({
        execution,
        attempt: dispatch.attempt,
        role: dispatch.role,
        inputDigest: inputs.digest,
        dependsOn: inputs.dependsOn,
      }),
    );
    output.stderr.push(green(`[DISPATCHED] gate ${gate} execution ${execution} (attempt ${dispatch.attempt})`));
  });
}

async function acceptGate(
  output: CommandOutput,
  name: string,
  gate: string,
  resultFile: string,
): Promise<void> {
  let intent: import('./classic-gate-runtime.js').GateDispatch | undefined;
  validateChangeName(name);
  if (!isGateId(gate)) fail(`ERROR: gate must be one of R/A/T/P/V/K, got '${gate}'`);
  const terminalDirectory = (await stateFile(name)).directory;
  if ((await readRunState(terminalDirectory))?.status === 'completed') throw new CommandFailure('RUN_COMPLETED: completed product Run cannot accept new product gate results', 2, { code: 'RUN_COMPLETED', message: 'Completed product lifecycle is immutable' });
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(classicCommandInvocationCwd(), resultFile), 'utf8');
  } catch (error) {
    fail(`ERROR: cannot read gate result file ${resultFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    fail(`ERROR: gate result file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (
    typeof result.execution !== 'string' ||
    !result.execution ||
    !Number.isInteger(result.attempt) ||
    (result.attempt as number) < 1 ||
    (result.verdict !== 'pass' && result.verdict !== 'reject')
  ) {
    fail('ERROR: gate result requires { execution, attempt, verdict: pass|reject, findings? }');
  }
  if (result.verdict === 'reject' && (!Array.isArray(result.findings) || result.findings.length === 0)) {
    fail('ERROR: a gate rejection must carry structured findings (the rework route needs them)');
  }
  const { directory } = await stateFile(name);
  try {
    await requireRunAuthority(directory);
  } catch (error) {
    if (error instanceof RunAuthorityError) fail(error.message);
    throw error;
  }
  await withClassicStateLock(directory, async () => {
    const registry = await readGateDispatches(directory);
    const dispatch = registry.dispatches.find(
      (entry) =>
        entry.gate === gate &&
        entry.execution === result.execution &&
        entry.attempt === result.attempt,
    );
    if (!dispatch) fail('ERROR: no Runtime dispatch; author-written results do not establish a source');
    if (dispatch.state !== 'open') fail(`ERROR: dispatch is already ${dispatch.state}`);
    await requireManagedGateTerminal(directory, dispatch);
    await syncGateInvalidationsLocked(directory, classicCommandProjectRoot());
    intent = structuredClone(dispatch);
  });
  if (!intent) fail('RECOVERY_REQUIRED: missing native intent');
  const originalIntent = intent;
  const host = requireManagedDeliveryHost();
  // Long readback/collector phase happens outside the state lock. The fixed
  // host reads original registered launch artifacts, not caller claims.
  const rawPacket = await host.readResult(originalIntent, result);
  const packet: import('./classic-managed-host.js').ManagedRecord = { ...rawPacket, dispatch: originalIntent.protectedDispatch };
  const collected = await host.authority.collectResult(packet);
  if (!collected.ok) fail(`UNVERIFIED: protected source collection refused (${collected.error})`);
  await requireRunAuthority(directory);
  await withClassicStateLock(directory, async () => {
    await requireRunAuthority(directory);
    await syncGateInvalidationsLocked(directory, classicCommandProjectRoot());
    const registry = await readGateDispatches(directory);
    const dispatch = registry.dispatches.find((entry) => entry.execution === originalIntent.execution && entry.attempt === originalIntent.attempt && entry.gate === gate);
    if (!dispatch || dispatch.state !== 'open') fail('RECOVERY_REQUIRED: original intent was consumed or replaced during collection');
    const projection = await readClassicState(directory, { migrate: false });
    if (!projection.classic || !projection.run) fail('RECOVERY_REQUIRED: original Classic Run is missing');
    if (projection.run.status === 'completed') throw new CommandFailure('RUN_COMPLETED: completed product Run cannot consume a late product gate', 2, { code: 'RUN_COMPLETED', message: 'Completed product lifecycle is immutable' });
    const { record } = await managedStateRecord(name);
    const inputs = await currentGateInputs(directory, record, gate);
    const generation = gateGenerationOf(parseGateInvalidations(projection.classic.gateInvalidations), gate);
    const latestAttempt = registry.dispatches.filter((entry) => entry.gate === gate && entry.inputDigest === inputs.digest && entry.generation === generation).at(-1)?.attempt;
    if (dispatch.inputDigest !== inputs.digest || dispatch.generation !== generation || dispatch.attempt !== latestAttempt
      || dispatch.epoch !== (projection.classic.checkEpoch ?? 0)) fail('STALE_ATTEMPT: current inputs/generation/epoch or native attempt changed during collection');
    if (stableStringify(dispatch) !== stableStringify(originalIntent)) fail('RECOVERY_REQUIRED: native intent binding changed during collection');
    await requireManagedGateTerminal(directory, dispatch, packet);
    const receipts = parseGateReceipts(projection.classic.gateReceipts);
    if (originalIntent.runId !== projection.run.runId) fail('UNVERIFIED: collected intent belongs to another native Run');
    const judged = admitManagedPacket({ ...originalIntent, nativeRunId: projection.run.runId }, { ...packet, collection: collected.collection }, receipts);
    const verdict = judged.evaluated.verdict === 'pass' ? 'pass' : 'reject';
    const receipt = { gate, verdict, digest: inputs.digest, dependsOn: inputs.dependsOn,
      execution: dispatch.execution, attempt: dispatch.attempt, epoch: projection.classic.checkEpoch ?? 0,
      generation, policyVersion: GATE_POLICY_VERSION, acceptedAt: new Date().toISOString(),
      report: packet.reportBytes.toString('utf8'), reportDigest: collected.collection.reportDigest,
      findings: judged.evaluated.receipt.blocked, sourceEntry: JSON.parse(JSON.stringify(judged.entry)), intent: originalIntent, evaluated: judged.evaluated.receipt };
    dispatch.state = 'consumed'; dispatch.verdict = verdict;
    // Intent consumption and its original bound evidence commit in ONE
    // existing YAML/Run transaction. Recovery never reconstructs a pass.
    const classic: ClassicState = { ...projection.classic,
      gateReceipts: stableStringify([...receipts, receipt]), gateDispatches: stableStringify(registry),
      checkEpoch: projection.classic.checkEpoch ?? 0 };
    await writeClassicState(directory, { ...projection, classic });
    if (gate === 'Kt' && classic.archived) await reconcileClassicRuntimeRun(directory);
    output.data = { change: name, gate, verdict, receipt };
    output.stderr.push(green(`[ACCEPTED] gate ${gate} ${verdict}; source-bound single-gate judgment, not overall completion`));
    if (verdict === 'reject') output.stderr.push(yellow(`ROUTE: ${repairRoute(gate, projection.classic.phase)}`));
  });
}

async function recordKnowledgeCloseout(
  output: CommandOutput,
  name: string,
  receiptFile: string,
): Promise<void> {
  validateChangeName(name);
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(classicCommandInvocationCwd(), receiptFile), 'utf8');
  } catch (error) {
    fail(`ERROR: cannot read knowledge closeout file ${receiptFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let closeout;
  try {
    closeout = parseKnowledgeCloseout(JSON.parse(raw));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!closeout) fail('ERROR: knowledge closeout receipt is empty');
  const authorityLocation = await stateFile(name);
  await requireRunAuthority(authorityLocation.directory);
  const authorityProjection = await readClassicState(authorityLocation.directory, { migrate: false });
  const authorityRecord = (await readDocument(authorityLocation.file)).toJS() as Record<string, unknown>;
  if (!authorityProjection.run && typeof authorityRecord.run_id === 'string') fail('RECOVERY_REQUIRED: original Run state file is missing; restore it, never create another Run (recovery-required, H08)');
  if ((await readField(name, 'managed_delivery')) === 'true') fail('UNVERIFIED: generic/file-K closeout is historical only; accept separate protected Kp/Kt source results');
  const { directory } = await stateFile(name);
  await withClassicStateLock(directory, async () => {
    if (closeout.targetKind === 'file') {
      // D06: the Runtime reads the target back itself before recording; an
      // unknown or changed target is never accepted.
      const actual = await knowledgeTargetDigest(classicCommandProjectRoot(), closeout.target);
      if (actual === null) {
        fail(`ERROR: knowledge target ${closeout.target} is missing; the independent readback cannot confirm the publication`);
      }
      if (actual !== closeout.readbackDigest) {
        fail(
          `ERROR: knowledge target ${closeout.target} read back as ${actual.slice(0, 12)}… but the receipt recorded ${closeout.readbackDigest.slice(0, 12)}…; result unknown is never accepted (D06)`,
        );
      }
    } else {
      // External publication target (LLMWiki/Outline): only acceptable with a
      // Runtime-issued K dispatch — the driver registers the publication.
      const registry = await readGateDispatches(directory);
      const dispatch = registry.dispatches.find(
        (entry) => entry.gate === 'Kt' && entry.execution === closeout.execution,
      );
      if (!dispatch) {
        fail(
          `ERROR: external knowledge closeout execution ${closeout.execution} has no Runtime K dispatch; driver-registered publication is required`,
        );
      }
      if (dispatch.state === 'open') {
        dispatch.state = 'consumed';
        dispatch.verdict = 'pass';
        await writeGateDispatches(directory, registry);
      }
      // H04/H05: the receipt must close a REGISTERED publication operation on
      // the fixed document UUID, and only over a matching independent
      // readback observation. Lost, unknown, absent or conflicting results
      // are never accepted as publication.
      const ledger = await readKnowledgePublishOperations(directory);
      const operation = ledger.operations.find((entry) => entry.documentId === closeout.target);
      if (!operation) {
        fail(
          `ERROR: no registered knowledge publish operation for document ${closeout.target}; register it with 'comet state knowledge-publish' before closing the seat`,
        );
      }
      if (operation.state === 'conflict') {
        fail(
          `ERROR: knowledge publish operation ${operation.operationKey.slice(0, 12)}… for document ${closeout.target} is in conflict; reconcile the remote readback before recording the closeout (H05)`,
        );
      }
      const observation = operation.lastObservation;
      if (
        !observation ||
        observation.outcome !== 'exists' ||
        observation.readbackDigest !== closeout.readbackDigest ||
        observation.revision !== closeout.revision
      ) {
        fail(
          `ERROR: knowledge closeout for document ${closeout.target} has no matching independent readback; a lost, unknown or stale publication result is never accepted (H04)`,
        );
      }
      if (operation.state !== 'published') {
        operation.state = 'published';
        operation.lastRevision = closeout.revision;
        operation.updatedAt = new Date().toISOString();
        await writeKnowledgePublishOperations(directory, ledger);
      }
    }
    const projection = await readClassicState(directory, { migrate: false });
    if (!projection.classic) fail('ERROR: Classic state is missing');
    if (!projection.classic.managedDelivery) {
      fail(`ERROR: knowledge closeout requires managed delivery; '${name}' is not managed`);
    }
    const previous = parseKnowledgeCloseout(projection.classic.knowledgeCloseout);
    if (previous) {
      if (stableStringify(previous) !== stableStringify(closeout)) {
        fail('ERROR: a different knowledge closeout is already recorded; conflicting re-recording is refused');
      }
      output.data = { change: name, knowledgeCloseout: previous, alreadyRecorded: true };
      output.stderr.push(green(`[UNCHANGED] knowledge closeout already recorded for '${name}'`));
      return;
    }
    const classic: ClassicState = {
      ...projection.classic,
      knowledgeCloseout: stableStringify(closeout),
      checkEpoch: (projection.classic.checkEpoch ?? 0) + 1,
    };
    await writeClassicState(directory, {
      classic,
      run: projection.run,
      unknownKeys: projection.unknownKeys,
    });
    // Refresh the derived run status: with the seat filled, the resolver may
    // now legitimately return completed (D07 recovery).
    await reconcileClassicRuntimeRun(directory);
    output.data = { change: name, knowledgeCloseout: closeout, alreadyRecorded: false };
    output.stderr.push(green(`[RECORDED] knowledge closeout ${closeout.targetKind}:${closeout.target} rev ${closeout.revision}`));
  });
}

// ---- knowledge publish operations (0003, H04/H05) ---------------------------

function knowledgeOperationFrom(value: unknown, label: string): {
  knowledgeId: string;
  documentId: string;
  collection: string;
  payloadDigest: string;
  baseRevision: string | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`ERROR: ${label} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const nonEmpty = (input: unknown, field: string): string => {
    if (typeof input !== 'string' || input.trim() === '') fail(`ERROR: ${label}.${field} must be a non-empty string`);
    return input.trim();
  };
  const knowledgeId = nonEmpty(record.knowledgeId, 'knowledgeId');
  const documentId = nonEmpty(record.documentId, 'documentId').toLowerCase();
  if (!UUID_RE.test(documentId)) fail(`ERROR: ${label}.documentId must be a client UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)`);
  const collection = nonEmpty(record.collection, 'collection');
  const payloadDigest = nonEmpty(record.payloadDigest, 'payloadDigest');
  if (!/^[a-f0-9]{64}$/u.test(payloadDigest)) fail(`ERROR: ${label}.payloadDigest must be a sha256 hex digest`);
  let baseRevision: string | null = null;
  if (record.baseRevision !== undefined && record.baseRevision !== null) {
    baseRevision = nonEmpty(record.baseRevision, 'baseRevision');
  }
  return { knowledgeId, documentId, collection, payloadDigest, baseRevision };
}



function chainLastRevision(operations: KnowledgePublishOperation[], knowledgeId: string, collection: string): string | null {
  let last: string | null = null;
  for (const entry of operations) {
    if (entry.knowledgeId !== knowledgeId || entry.collection !== collection) continue;
    if (entry.lastObservation?.revision) last = entry.lastObservation.revision;
    if (entry.lastRevision) last = entry.lastRevision;
  }
  return last;
}

async function knowledgePublish(
  output: CommandOutput,
  name: string,
  operationFile: string,
): Promise<void> {
  validateChangeName(name);
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(classicCommandInvocationCwd(), operationFile), 'utf8');
  } catch (error) {
    fail(`ERROR: cannot read knowledge publish operation file ${operationFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const input = knowledgeOperationFrom(JSON.parse(raw), 'knowledge publish operation');
  const { directory, record } = await managedStateRecord(name);
  await requireManagedDelivery(name, 'knowledge publish');
  try {
    await requireRunAuthority(directory);
  } catch (error) {
    if (error instanceof RunAuthorityError) fail(error.message);
    throw error;
  }
  const key = knowledgeOperationKey(input);
  await withClassicStateLock(directory, async () => {
    const ledger = await readKnowledgePublishOperations(directory);
    const existing = ledger.operations.find((entry) => entry.operationKey === key);
    if (existing) {
      // Idempotent re-registration: the retry after a lost receipt recovers
      // the SAME operation and the SAME fixed document UUID (H04). Neither
      // the target identity nor the base revision of a registered operation
      // can drift through a retry (H05: no revision refresh).
      if (existing.documentId !== input.documentId) {
        fail(
          `ERROR: operation ${key.slice(0, 12)}… is bound to document ${existing.documentId}; a retried operation never changes its fixed target UUID (H04)`,
        );
      }
      if ((input.baseRevision ?? null) !== (existing.baseRevision ?? null)) {
        fail(
          `ERROR: operation ${key.slice(0, 12)}… is registered on base revision '${existing.baseRevision ?? 'null'}'; a retry never refreshes the base revision — reconcile the remote state through an independent readback (H05)`,
        );
      }
      existing.attempts += 1;
      existing.updatedAt = new Date().toISOString();
      await writeKnowledgePublishOperations(directory, ledger);
      output.data = { change: name, operation: existing, recovered: true, directive: knowledgePublishDirective(existing) };
      output.stderr.push(green(`[RECOVERED] knowledge operation ${existing.operationKey.slice(0, 12)}… attempt ${existing.attempts}; the same document UUID stays fixed`));
      return;
    }
    const chain = ledger.operations.filter(
      (entry) => entry.knowledgeId === input.knowledgeId && entry.collection === input.collection,
    );
    const identityOwner = ledger.operations.find(
      (entry) =>
        entry.documentId === input.documentId &&
        (entry.knowledgeId !== input.knowledgeId || entry.collection !== input.collection),
    );
    if (identityOwner) {
      fail(
        `ERROR: document ${input.documentId} already belongs to knowledge entry '${identityOwner.knowledgeId}' in '${identityOwner.collection}'; a document UUID is owned by exactly one logical knowledge entry`,
      );
    }
    if (chain.length > 0) {
      // A revision of an existing knowledge entry: same fixed document, and
      // the update must build on the last registered revision — never a
      // silent refresh over a conflict (H05).
      if (chain.some((entry) => entry.state === 'conflict')) {
        fail(
          `ERROR: knowledge entry '${input.knowledgeId}' in '${input.collection}' has an unresolved publication conflict; reconcile it through an independent readback before registering another revision (H05)`,
        );
      }
      if (chain.some((entry) => entry.documentId !== input.documentId)) {
        fail(
          `ERROR: knowledge entry '${input.knowledgeId}' in '${input.collection}' is bound to document ${chain[0].documentId}; revisions reuse the same fixed document UUID (H04)`,
        );
      }
      const lastRevision = chainLastRevision(ledger.operations, input.knowledgeId, input.collection);
      if (lastRevision && input.baseRevision !== lastRevision) {
        fail(
          `ERROR: update for '${input.knowledgeId}' must build on the registered last revision '${lastRevision}', got '${input.baseRevision ?? 'null'}'; reconcile conflicts through readback instead of refreshing the revision (H05)`,
        );
      }
    }
    const now = new Date().toISOString();
    const operation: KnowledgePublishOperation = {
      operationKey: key,
      knowledgeId: input.knowledgeId,
      documentId: input.documentId,
      collection: input.collection,
      payloadDigest: input.payloadDigest,
      baseRevision: input.baseRevision ?? (chain.length > 0 ? chainLastRevision(ledger.operations, input.knowledgeId, input.collection) : null),
      lastRevision: null,
      state: 'pending',
      attempts: 1,
      lastObservation: null,
      createdAt: now,
      updatedAt: now,
    };
    ledger.operations.push(operation);
    await writeKnowledgePublishOperations(directory, ledger);
    output.data = { change: name, operation, recovered: false, directive: knowledgePublishDirective(operation) };
    output.stderr.push(green(`[REGISTERED] knowledge operation ${operation.operationKey.slice(0, 12)}… document ${operation.documentId} (fixed before the first request)`));
  });
}

async function knowledgeObserve(
  output: CommandOutput,
  name: string,
  observationFile: string,
): Promise<void> {
  validateChangeName(name);
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(classicCommandInvocationCwd(), observationFile), 'utf8');
  } catch (error) {
    fail(`ERROR: cannot read knowledge observation file ${observationFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') fail('ERROR: knowledge observation must be a JSON object');
  const operationKey = typeof parsed.operationKey === 'string' ? parsed.operationKey : '';
  const outcome = parsed.outcome;
  if (!operationKey) fail('ERROR: knowledge observation requires operationKey');
  if (!['absent', 'exists', 'conflict', 'unknown'].includes(outcome as string)) {
    fail("ERROR: knowledge observation outcome must be absent|exists|conflict|unknown");
  }
  const revision = typeof parsed.revision === 'string' && parsed.revision !== '' ? parsed.revision : null;
  const readbackDigest = typeof parsed.readbackDigest === 'string' && parsed.readbackDigest !== '' ? parsed.readbackDigest : null;
  if (outcome === 'exists' && (!revision || !readbackDigest)) {
    fail('ERROR: an exists observation requires the read-back revision and readbackDigest');
  }
  const { directory } = await stateFile(name);
  await requireManagedDelivery(name, 'knowledge observe');
  try {
    await requireRunAuthority(directory);
  } catch (error) {
    if (error instanceof RunAuthorityError) fail(error.message);
    throw error;
  }
  await withClassicStateLock(directory, async () => {
    const ledger = await readKnowledgePublishOperations(directory);
    const operation = ledger.operations.find((entry) => entry.operationKey === operationKey);
    if (!operation) {
      fail(`ERROR: no registered knowledge publish operation ${operationKey.slice(0, 12)}…; register it first`);
    }
    operation.lastObservation = {
      outcome: outcome as 'absent' | 'exists' | 'conflict' | 'unknown',
      revision,
      readbackDigest,
      at: new Date().toISOString(),
    };
    operation.updatedAt = operation.lastObservation.at;
    if (
      outcome === 'conflict' ||
      (outcome === 'exists' && readbackDigest !== operation.payloadDigest)
    ) {
      // H05: the remote moved under another legitimate writer (or carries
      // unexpected content) — the conflict stays open until a readback
      // matches the registered payload; the revision is never refreshed.
      operation.state = 'conflict';
    } else if (operation.state === 'conflict' && outcome === 'exists') {
      // The independent readback over the registered payload resolves an
      // earlier conflict: the expected result exists, so the operation is
      // actionable again (record-closeout).
      operation.state = 'pending';
    }
    await writeKnowledgePublishOperations(directory, ledger);
    output.data = { change: name, operation, directive: knowledgePublishDirective(operation) };
    output.stderr.push(green(`[OBSERVED] knowledge operation ${operation.operationKey.slice(0, 12)}… outcome=${outcome}`));
  });
}

// ---- run authority transfer (0003, H09) --------------------------------------

async function authorityTransfer(
  output: CommandOutput,
  name: string,
  fileArgument: string,
): Promise<void> {
  validateChangeName(name);
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(classicCommandInvocationCwd(), fileArgument), 'utf8');
  } catch (error) {
    fail(`ERROR: cannot read authority transfer file ${fileArgument}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const to = typeof parsed.to === 'string' ? parsed.to.trim() : '';
  if (!to || parsed.confirm !== true) {
    fail('ERROR: authority transfer requires { to: <authority-id>, confirm: true }; migration is explicit, never implied');
  }
  const { directory } = await stateFile(name);
  const binding = await readRunAuthority(directory);
  if (!binding) fail(`ERROR: run '${name}' has no authority binding; initialize it with --managed-delivery first`);
  try {
    await requireRunAuthority(directory);
  } catch (error) {
    if (error instanceof RunAuthorityError) {
      fail(
        `${error.message}\nThe transfer must be performed BY the authoritative environment; a foreign environment cannot re-home the run`,
      );
    }
    throw error;
  }
  const transferred = await transferRunAuthority(directory, to);
  output.data = { change: name, authority: transferred };
  output.stderr.push(green(`[TRANSFERRED] run authority: ${binding.authorityId} -> ${transferred.authorityId}`));
}

function required(args: string[], count: number, usage: string): void {
  if (args.length < count) fail(usage);
}

function requiredExact(args: string[], count: number, usage: string): void {
  if (args.length !== count) fail(usage);
}

const MUTATING_STATE_COMMANDS = new Set([
  'init',
  'set',
  'task-complete',
  'sync-plan',
  'transition',
  'check',
  'scale',
  'record-check',
  'rebind',
  'select',
  'clear-selection',
  'complete-design',
  'dispatch-gate',
  'accept-gate',
  'knowledge-closeout',
  'knowledge-publish',
  'knowledge-observe',
  'authority-transfer',
]);

async function assertStateCommandWritable(subcommand: string | undefined): Promise<void> {
  if (!subcommand || !MUTATING_STATE_COMMANDS.has(subcommand)) return;
  try {
    await assertClassicLayoutWritable(classicCommandProjectRoot());
  } catch (error) {
    fail(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function selectChange(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  try {
    const requestedRoot = classicCommandProjectRoot();
    // Fast path: when the recorded selection already routes this change to this
    // workspace and its directory is present, the per-worktree enumeration is
    // pure overhead — selecting again only rewrites the same selection.
    const resolution = await resolveCurrentChange(requestedRoot);
    if (resolution.status === 'selected' && resolution.selection.change === name) {
      const selection = await selectCurrentChange(requestedRoot, name);
      const change = await resolveClassicChangeDirectory(name, requestedRoot);
      const state = await readClassicState(change.directory, { migrate: false });
      const bound = state.classic?.boundBranch ?? null;
      output.stderr.push(
        green(
          `[SELECTED] current change: ${selection.change}${bound ? ` (branch: ${bound})` : ''}`,
        ),
      );
      return;
    }
    const workspace = await resolveClassicWorkspace({ projectRoot: requestedRoot, name });
    const selection = await selectCurrentChange(workspace.projectRoot, name);
    const change = await resolveClassicChangeDirectory(name, workspace.projectRoot);
    const state = await readClassicState(change.directory, { migrate: false });
    const bound = state.classic?.boundBranch ?? null;
    output.stderr.push(
      green(
        `[SELECTED] current change: ${selection.change}${bound ? ` (branch: ${bound})` : ''}${workspace.routed ? ` (workspace: ${workspace.projectRoot})` : ''}`,
      ),
    );
  } catch (error) {
    fail(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function rebind(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { directory } = await stateFile(name);
  const boundBranch = await readField(name, 'bound_branch');
  if (!boundBranch || boundBranch === 'null') {
    fail(
      `ERROR: '${name}' is not yet bound; use 'comet state set ${name} isolation <current|branch|worktree>' to establish the first binding`,
    );
  }
  const branch = liveGitBranch(classicCommandInvocationCwd());
  if (branch === null) {
    fail('ERROR: cannot rebind while HEAD is detached; checkout a branch first');
  }
  const before = await readClassicState(directory);
  if (!before.classic) fail('ERROR: Classic state projection is missing');
  await healBoundBranch(directory, branch);
  const after: ClassicState = { ...before.classic, boundBranch: branch };
  await appendClassicStateEvent(directory, {
    change: name,
    event: 'rebind',
    source: 'comet-state',
    from: before.classic,
    to: after,
    effects: [{ field: 'boundBranch', from: boundBranch, to: branch }],
  });
  output.stderr.push(green(`[REBIND] bound_branch: ${boundBranch} → ${branch}`));
}

async function currentChange(output: CommandOutput): Promise<void> {
  const resolution = await resolveCurrentChange(classicCommandProjectRoot());
  if (resolution.status === 'selected') {
    output.stdout.push(resolution.selection.change);
    return;
  }
  if (resolution.status === 'missing') {
    fail('ERROR: no current change selected\nUse: comet state select <change-name>');
  }
  fail(
    `ERROR: current change selection is stale: ${resolution.reason}\nUse: comet state select <change-name>`,
  );
}

async function clearSelection(output: CommandOutput): Promise<void> {
  await clearCurrentChange(classicCommandProjectRoot());
  output.stderr.push(green('[CLEARED] current change selection'));
}

export const classicStateCommand: ClassicCommandHandler = withProjectContext(
  async (args, options) => {
    const output = new CommandOutput();
    try {
      const [subcommand, ...rest] = args;
      const arity: Record<string, number> = {
        get: 2,
        transition: 2,
        scale: 1,
        'task-checkoff': 2,
        rebind: 1,
        select: 1,
        current: 0,
        'clear-selection': 0,
        next: 1,
        artifacts: 1,
      };
      if (subcommand && Object.hasOwn(arity, subcommand)) {
        requiredExact(
          rest,
          arity[subcommand],
          `Invalid arguments for comet state ${subcommand}; run comet state --help`,
        );
      }
      if (
        subcommand === 'check' &&
        (rest.length < 2 ||
          rest.length > 4 ||
          rest.slice(2).some((option) => !['--recover', '--details'].includes(option)) ||
          new Set(rest.slice(2)).size !== rest.length - 2)
      ) {
        fail('Usage: comet state check <change-name> <phase> [--recover] [--details]');
      }
      await assertStateCommandWritable(subcommand);
      if (subcommand === 'tasks' && rest.includes('--assign-ids'))
        await assertStateCommandWritable('set');
      if (subcommand === 'init') {
        required(rest, 2, 'Usage: comet state init <change-name> <workflow>');
        const initOptions = rest.slice(2);
        let isolation: string | null = null;
        let managedDelivery = false;
        let knowledgeCloseoutRequired = false;
        for (let index = 0; index < initOptions.length; index++) {
          const option = initOptions[index];
          if (option === '--isolation') {
            if (index + 1 >= initOptions.length) fail('Usage: comet state init <change-name> <workflow> [--isolation <mode>] [--managed-delivery] [--knowledge-closeout-required <true|false>]');
            isolation = initOptions[++index];
          } else if (option === '--managed-delivery') {
            managedDelivery = true;
          } else if (option === '--knowledge-closeout-required') {
            if (index + 1 >= initOptions.length || !['true', 'false'].includes(initOptions[index + 1])) {
              fail('Usage: comet state init <change-name> <workflow> [--isolation <mode>] [--managed-delivery] [--knowledge-closeout-required <true|false>]');
            }
            knowledgeCloseoutRequired = initOptions[++index] === 'true';
            if (!knowledgeCloseoutRequired && initOptions.includes('--managed-delivery')) fail('ERROR: comet-managed-v2 requires both Kp and Kt; false cannot waive knowledge obligations');
          } else {
            fail('Usage: comet state init <change-name> <workflow> [--isolation <mode>] [--managed-delivery] [--knowledge-closeout-required <true|false>]');
          }
        }
        await init(output, rest[0], rest[1], isolation, managedDelivery, knowledgeCloseoutRequired);
      } else if (subcommand === 'get') {
        required(rest, 2, 'Usage: comet state get <change-name> <field>');
        validateChangeName(rest[0]);
        output.stdout.push(await readField(rest[0], rest[1]));
      } else if (subcommand === 'set') {
        if (rest.length < 3 || rest.length % 2 !== 1) {
          fail('Usage: comet state set <change-name> <field> <value> [<field> <value> ...]');
        }
        validateChangeName(rest[0]);
        const updates: Array<[string, string]> = [];
        for (let index = 1; index < rest.length; index += 2)
          updates.push([rest[index], rest[index + 1]]);
        await setFields(output, rest[0], updates);
      } else if (subcommand === 'complete-design') {
        if (rest.length !== 3 || rest[1] !== '--design-doc')
          fail('Usage: comet state complete-design <change-name> --design-doc <repo-relative-ref>');
        await completeDesign(output, rest[0], rest[2], options);
      } else if (subcommand === 'transition') {
        required(rest, 2, 'Usage: comet state transition <change-name> <event>');
        await transition(output, rest[0], rest[1]);
      } else if (subcommand === 'check') {
        required(rest, 2, 'Usage: comet state check <change-name> <phase> [--recover]');
        validateEnum(rest[1], PHASES);
        if (rest.includes('--recover'))
          await recover(output, rest[0], rest.includes('--details'), options.json);
        else await check(output, rest[0], rest[1], rest.includes('--details'));
      } else if (subcommand === 'scale') {
        required(rest, 1, 'Usage: comet state scale <change-name>');
        await scale(output, rest[0]);
      } else if (subcommand === 'artifacts') {
        validateChangeName(rest[0]);
        const { directory } = await stateFile(rest[0]);
        const requirements = await readClassicArtifactRequirements(
          classicCommandProjectRoot(),
          directory,
        );
        if (requirements.source === 'legacy') {
          const full = (await readField(rest[0], 'workflow')) === 'full';
          requirements.designRequired = full;
          if (!full) {
            requirements.required = requirements.required.filter((id) => id !== 'design');
            requirements.files = requirements.files.filter(
              (file) => path.basename(file) !== 'design.md',
            );
          }
          for (const file of requirements.files)
            if (!(await nonempty(file)))
              requirements.problems.push(`Required Classic artifact is missing or empty: ${file}`);
        }
        output.data = requirements;
        output.stdout.push(
          requirements.problems.length
            ? requirements.problems.join('\n')
            : 'Required artifact dependency closure is ready',
        );
        if (requirements.problems.length) throw new CommandFailure('', 1);
      } else if (subcommand === 'record-check') {
        required(
          rest,
          2,
          'Usage: comet state record-check <change> <build|verify> --command <text> --exit-code <int> [--cwd <path>]',
        );
        await recordCheck(output, rest[0], rest[1], rest.slice(2));
      } else if (subcommand === 'task-checkoff') {
        required(rest, 2, 'Usage: comet state task-checkoff <file> <task-text>');
        await taskCheckoff(output, rest[0], rest[1]);
      } else if (subcommand === 'tasks') {
        if (rest.length !== 1 && !(rest.length === 2 && rest[1] === '--assign-ids')) {
          fail('Usage: comet state tasks <change-name> [--assign-ids]');
        }
        await taskState(output, rest[0], { kind: rest.length === 2 ? 'assign' : 'list' });
      } else if (subcommand === 'sync-plan') {
        requiredExact(rest, 1, 'Usage: comet state sync-plan <change-name>');
        await taskState(output, rest[0], { kind: 'sync-plan' });
      } else if (subcommand === 'checkpoint' || subcommand === 'delivery') {
        await progressCommand(output, subcommand, rest);
      } else if (subcommand === 'task-complete') {
        if (rest.length !== 4 || rest[2] !== '--expect')
          fail('Usage: comet state task-complete <change-name> <task-id> --expect <revision>');
        await taskState(output, rest[0], { kind: 'complete', id: rest[1], revision: rest[3] });
      } else if (subcommand === 'rebind') {
        requiredExact(rest, 1, 'Usage: comet state rebind <change-name>');
        await rebind(output, rest[0]);
      } else if (subcommand === 'select') {
        requiredExact(rest, 1, 'Usage: comet state select <change-name>');
        await selectChange(output, rest[0]);
      } else if (subcommand === 'current') {
        requiredExact(rest, 0, 'Usage: comet state current');
        await currentChange(output);
      } else if (subcommand === 'clear-selection') {
        requiredExact(rest, 0, 'Usage: comet state clear-selection');
        await clearSelection(output);
      } else if (subcommand === 'next') {
        required(rest, 1, 'Usage: comet state next <change-name>');
        await next(output, rest[0]);
      } else if (subcommand === 'gates') {
        requiredExact(rest, 1, 'Usage: comet state gates <change-name>');
        await gatesStatus(output, rest[0]);
      } else if (subcommand === 'dispatch-gate') {
        requiredExact(rest, 2, 'Usage: comet state dispatch-gate <change-name> <R|A|T|P|V|K>');
        await dispatchGate(output, rest[0], rest[1]);
      } else if (subcommand === 'accept-gate') {
        if (rest.length !== 4 || rest[2] !== '--file') {
          fail('Usage: comet state accept-gate <change-name> <R|A|T|P|V|K> --file <result.json>');
        }
        await acceptGate(output, rest[0], rest[1], rest[3]);
      } else if (subcommand === 'knowledge-closeout') {
        if (rest.length !== 3 || rest[1] !== '--file') {
          fail('Usage: comet state knowledge-closeout <change-name> --file <receipt.json>');
        }
        await recordKnowledgeCloseout(output, rest[0], rest[2]);
      } else if (subcommand === 'knowledge-publish') {
        if (rest.length !== 3 || rest[1] !== '--file') {
          fail('Usage: comet state knowledge-publish <change-name> --file <operation.json>');
        }
        await knowledgePublish(output, rest[0], rest[2]);
      } else if (subcommand === 'knowledge-observe') {
        if (rest.length !== 3 || rest[1] !== '--file') {
          fail('Usage: comet state knowledge-observe <change-name> --file <observation.json>');
        }
        await knowledgeObserve(output, rest[0], rest[2]);
      } else if (subcommand === 'authority-transfer') {
        if (rest.length !== 3 || rest[1] !== '--file') {
          fail('Usage: comet state authority-transfer <change-name> --file <transfer.json>');
        }
        await authorityTransfer(output, rest[0], rest[2]);
      } else {
        fail(`Unknown subcommand: ${subcommand ?? ''}`);
      }
      if (options.json && ['init', 'set', 'transition', 'select'].includes(subcommand)) {
        const { directory } = await stateFile(rest[0]);
        const updated = await readClassicState(directory, { migrate: false });
        const state = updated.classic;
        if (state)
          output.data = {
            ...(output.data && typeof output.data === 'object' ? output.data : {}),
            ...(await classicRecoveryContext(
              classicCommandProjectRoot(),
              directory,
              state,
              false,
              updated.run ?? null,
            )),
            change: rest[0],
            phase: state.phase,
            configuration: state,
          };
      }
      if (options.json && ['check', 'complete-design'].includes(subcommand)) output.stdout = [];
      return output.result();
    } catch (error) {
      if (error instanceof ManagedCompletionIntegrityError) {
        output.data = { ...error.view, issues: [{ code: 'RECOVERY_REQUIRED', message: error.message }] };
        output.envelope = undefined;
        output.stdout = [];
        output.stderr.push(red(error.message));
        return output.result(2);
      }
      const issue = error instanceof CommandFailure ? error.issue : undefined;
      const previous =
        output.data && typeof output.data === 'object'
          ? (output.data as Record<string, unknown>)
          : {};
      if (!Array.isArray(previous.issues) || previous.issues.length === 0)
        output.data = { ...previous, issues: [issue ?? classicIssue(error)] };
      // The frozen 0.3.8 shell calls red() once per line and never embeds newlines
      // inside a single color call. Mirror that contract by wrapping each line of
      // the message in its own span so multi-line errors (e.g. validateEnum) render
      // as separate colored lines rather than one span across a newline.
      const message = error instanceof Error ? error.message : String(error);
      if (message) {
        for (const line of message.split('\n')) output.stderr.push(red(line));
      }
      return output.result(error instanceof CommandFailure ? error.exitCode : error instanceof ManagedSourceUnverifiedError ? 2 : 70);
    }
  },
);
