import { knowledgeTools } from './classic-managed-knowledge.js';
import { createHash } from 'node:crypto';
import { stableStringify } from './classic-gate-runtime.js';
import { requireRunAuthority } from './classic-gate-runtime.js';
import { managedDeliveryHost } from './classic-managed-host.js';
import { syncGateInvalidations } from './classic-gate-runtime.js';
import { discoverClassicProject } from './classic-layout.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectClassicEvidence, type ClassicEvidence } from './classic-evidence.js';
import { ManagedGatePremisesError } from './classic-gate-runtime.js';
import { ensureClassicRun, type ClassicRunContext } from './classic-migrate.js';
import { resolveClassicStepId } from './classic-resolver.js';
import { readClassicState, writeClassicState, withClassicStateLock } from './classic-store.js';
import {
  CLASSIC_MIGRATION_VERSION,
  type ClassicState,
  type ClassicStateProjection,
} from './classic-state.js';
import { appendTrajectory, readTrajectory } from '../../domains/engine/run-store.js';
import type { RunState } from '../../domains/engine/types.js';
import { MANAGED_ACTION_PROTOCOL } from '../../domains/engine/types.js';
import { loadRuntimePackage, loadSkillPackage } from '../../domains/skill/load.js';
import { readSkillSnapshot } from '../../domains/skill/snapshot.js';
import type { SkillPackage } from '../../domains/skill/types.js';

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isClassicRuntimePackageRoot(root: string): Promise<boolean> {
  if (!(await directoryExists(root))) return false;
  if (await fileExists(path.join(root, 'skill.yaml'))) return true;
  return (
    (await fileExists(path.join(root, 'SKILL.md'))) &&
    (await fileExists(path.join(root, 'comet', 'skill.yaml')))
  );
}

function embeddedClassicRuntimePackage(root: string): SkillPackage {
  return {
    root,
    packageKind: 'runtime',
    definition: {
      apiVersion: 'comet/v1alpha1',
      kind: 'Skill',
      metadata: {
        name: 'comet-classic',
        version: '1',
        description:
          'Internal compatibility orchestration for classic Comet full, hotfix, and tweak workflows',
      },
      goal: {
        statement:
          'Advance or restore a classic Comet Run without changing the user command surface',
        inputs: [
          {
            name: 'classic-state',
            description: 'Validated ClassicState consistent with the Run projection',
            required: true,
          },
          {
            name: 'evidence',
            description: 'Structured evidence produced by the Classic Evidence collector',
            required: true,
          },
        ],
        outputs: [
          {
            name: 'run-state',
            description: 'Atomically synchronized Classic and Run state',
            required: true,
          },
        ],
        success: [
          'Legacy fields and Run fields remain consistent',
          'Every step invokes only a declared public Comet Skill',
          'The completed state passes its completion eval',
        ],
      },
      orchestration: {
        mode: 'deterministic',
        entry: 'full.open',
        steps: [
          {
            id: 'full.open',
            action: { type: 'invoke_skill', ref: 'comet-open' },
            next: 'full.design.handoff',
          },
          {
            id: 'full.design.handoff',
            action: { type: 'invoke_skill', ref: 'comet-design' },
            next: 'full.design.document',
          },
          {
            id: 'full.design.document',
            action: { type: 'invoke_skill', ref: 'comet-design' },
            next: 'full.build.configure',
          },
          {
            id: 'full.build.plan',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.plan-ready',
          },
          {
            id: 'full.build.plan-ready',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.execute',
          },
          {
            id: 'full.build.configure',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.plan',
          },
          {
            id: 'full.build.execute',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.complete',
          },
          {
            id: 'full.build.complete',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.verify.run',
          },
          {
            id: 'full.build.fix',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.execute',
          },
          {
            id: 'full.verify.run',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'full.verify.branch',
          },
          {
            id: 'full.verify.branch',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'full.archive.confirm',
          },
          {
            id: 'full.archive.confirm',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'full.archive.execute',
          },
          {
            id: 'full.archive.execute',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'completed',
          },
          {
            // Post-archive knowledge closeout (0002, D07/E02): a managed run
            // with an unmet run-level knowledge obligation parks here instead
            // of completed — the archive is NOT the overall completion. The
            // next() guidance names the knowledge-closeout command.
            id: 'full.closeout.knowledge',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'completed',
          },
          {
            id: 'hotfix.open',
            action: { type: 'invoke_skill', ref: 'comet-hotfix' },
            next: 'hotfix.build.execute',
          },
          {
            id: 'hotfix.build.execute',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'hotfix.build.complete',
          },
          {
            id: 'hotfix.build.complete',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'hotfix.verify.run',
          },
          {
            id: 'hotfix.verify.run',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'hotfix.verify.branch',
          },
          {
            id: 'hotfix.verify.branch',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'hotfix.archive.confirm',
          },
          {
            id: 'hotfix.archive.confirm',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'hotfix.archive.execute',
          },
          {
            id: 'hotfix.archive.execute',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'completed',
          },
          {
            id: 'tweak.open',
            action: { type: 'invoke_skill', ref: 'comet-tweak' },
            next: 'tweak.build.execute',
          },
          {
            id: 'tweak.build.execute',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'tweak.build.complete',
          },
          {
            id: 'tweak.build.complete',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'tweak.verify.run',
          },
          {
            id: 'tweak.verify.run',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'tweak.verify.branch',
          },
          {
            id: 'tweak.verify.branch',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'tweak.archive.confirm',
          },
          {
            id: 'tweak.archive.confirm',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'tweak.archive.execute',
          },
          {
            id: 'tweak.archive.execute',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'completed',
          },
          {
            id: 'completed',
            action: { type: 'checkpoint' },
            completionEvals: ['classic-completed'],
          },
        ],
      },
      skills: [
        { id: 'comet-open' },
        { id: 'comet-design' },
        { id: 'comet-build' },
        { id: 'comet-verify' },
        { id: 'comet-archive' },
        { id: 'comet-hotfix' },
        { id: 'comet-tweak' },
      ],
      agents: [],
      tools: [],
    },
    guardrails: {
      allowedSkills: [
        'comet-open',
        'comet-design',
        'comet-build',
        'comet-verify',
        'comet-archive',
        'comet-hotfix',
        'comet-tweak',
      ],
      allowedAgents: [],
      allowedTools: [],
      maxIterations: 500,
      maxRetriesPerAction: 3,
      confirmationRequiredFor: [],
    },
    evals: [
      {
        id: 'classic-completed',
        scope: 'completion',
        type: 'state_equals',
        field: 'status',
        equals: 'completed',
      },
    ],
  };
}

async function classicRuntimeRoot(): Promise<string | null> {
  const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.COMET_RUNTIME_CLASSIC_ROOT,
    path.resolve(runtimeDirectory, '..', 'runtime', 'classic'),
    path.resolve(runtimeDirectory, '..', '..', 'comet', 'runtime', 'classic'),
    path.resolve(runtimeDirectory, '..', '..', 'assets', 'skills', 'comet', 'runtime', 'classic'),
    path.resolve('assets', 'skills', 'comet', 'runtime', 'classic'),
    process.env.COMET_CLASSIC_SKILL_ROOT,
    path.resolve(runtimeDirectory, '..', '..', 'comet-classic'),
    path.resolve(runtimeDirectory, '..', '..', 'assets', 'skills', 'comet-classic'),
    path.resolve('assets', 'skills', 'comet-classic'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await isClassicRuntimePackageRoot(candidate)) return candidate;
  }
  return null;
}

async function loadClassicRuntimePackage(root: string) {
  if (await fileExists(path.join(root, 'skill.yaml'))) {
    return loadRuntimePackage(root);
  }
  return loadSkillPackage(root);
}


async function managedProducerRuntimePackage(changeDir: string, pkg: SkillPackage): Promise<SkillPackage> {
  const projection = await readClassicState(changeDir, { migrate: false });
  if (!projection.classic?.managedDelivery) return pkg;
  const root = await discoverClassicProject(changeDir);
  const policy = managedDeliveryHost()?.policy({ projectRoot: root, changeDir, runId: projection.run?.runId });
  const profile = policy?.producerProfile;
  if (profile?.id !== 'comet-managed-v2' || !profile.methods || !Array.isArray(profile.actions)) return pkg;
  const result = structuredClone(pkg);
  const names = Object.keys(profile.methods).filter((name) => !name.startsWith('comet-'));
  result.definition.goal.inputs.push({ name: MANAGED_ACTION_PROTOCOL, description: 'Protected managed producer binding protocol; not a worker controller', required: true });
  for (const name of names) if (!result.definition.skills.some((skill) => skill.id === name)) result.definition.skills.push({ id: name });
  result.guardrails.allowedSkills = [...new Set([...result.guardrails.allowedSkills, ...names])];
  for(const tool of knowledgeTools(profile,policy!)){
    if(result.definition.tools.some(existing=>existing.id===tool.id))throw new Error('UNVERIFIED: fixed knowledge tool id collides with the original Runtime');
    result.definition.tools.push(tool as import('../skill/types.js').ToolDefinition);
    result.guardrails.allowedTools.push(tool.id);
  }
  return result;
}

export async function ensureClassicRuntimeRun(changeDir: string): Promise<ClassicRunContext> {
  const root = await classicRuntimeRoot();
  await requireRunAuthority(changeDir);
  const prior = await readClassicState(changeDir, { migrate: false });
  if (prior.run && prior.classic?.managedDelivery && managedDeliveryHost()) await syncGateInvalidations(changeDir, await discoverClassicProject(changeDir));
  const ensured = await ensureClassicRun(changeDir, {
    skillPackage: await managedProducerRuntimePackage(changeDir, root
      ? await loadClassicRuntimePackage(root)
      : embeddedClassicRuntimePackage(path.dirname(fileURLToPath(import.meta.url)))),
  });
  if (ensured.classic.managedDelivery && managedDeliveryHost()) {
    await syncGateInvalidations(changeDir, await discoverClassicProject(changeDir));
    const current = await readClassicState(changeDir, { migrate: false });
    if (current.classic && current.run) return { ...ensured, classic: current.classic, run: current.run };
  }
  return ensured;
}

export async function ensureStrictClassicRuntimeRun(changeDir: string): Promise<ClassicRunContext> {
  const projection = await readClassicState(changeDir);
  const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(', ')}`);
  }
  return ensureClassicRuntimeRun(changeDir);
}

interface ValidatedClassicRuntime {
  classic: ClassicState;
  run: RunState;
  snapshotDir: string;
}

async function loadValidatedClassicRuntime(
  changeDir: string,
  projection: ClassicStateProjection,
): Promise<ValidatedClassicRuntime> {
  const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(', ')}`);
  }
  if (!projection.classic || !projection.run) {
    throw new Error('Classic runtime validation requires synchronized Classic and Run projections');
  }
  if (projection.classic.classicMigration !== CLASSIC_MIGRATION_VERSION) {
    throw new Error('Classic Run exists without a supported classic_migration marker');
  }

  const root = await classicRuntimeRoot();
  const skillPackage = root
    ? await loadClassicRuntimePackage(root)
    : embeddedClassicRuntimePackage(path.dirname(fileURLToPath(import.meta.url)));
  if (projection.run.skill !== skillPackage.definition.metadata.name) {
    throw new Error(
      `Classic Run skill mismatch: expected ${skillPackage.definition.metadata.name}, got ${projection.run.skill}`,
    );
  }

  const snapshot = await readSkillSnapshot(changeDir, projection.run.skillHash);
  if (snapshot.definition.metadata.name !== projection.run.skill) {
    throw new Error(
      `Classic Run snapshot skill mismatch: expected ${projection.run.skill}, got ${snapshot.definition.metadata.name}`,
    );
  }
  return {
    classic: projection.classic,
    run: projection.run,
    snapshotDir: path.join(changeDir, '.comet', 'skill-snapshots', projection.run.skillHash),
  };
}

export async function validateClassicRuntimeRun(
  changeDir: string,
  existingProjection?: ClassicStateProjection,
): Promise<ClassicRunContext> {
  await requireRunAuthority(changeDir);
  if (managedDeliveryHost()) await syncGateInvalidations(changeDir, await discoverClassicProject(changeDir));
  const projection = await readClassicState(changeDir, { migrate: false });
  const validated = await loadValidatedClassicRuntime(changeDir, projection);
  const evidence = await collectClassicEvidence(changeDir, projection);
  if (validated.classic.managedDelivery && validated.run.status === 'completed') {
    await checkCompletedIntegrity(changeDir, { ...validated, evidence, migrated: false }, evidence, false);
    return { ...validated, evidence, migrated: false };
  }
  const currentStep = resolveClassicStepId(validated.classic, evidence);
  if (validated.run.currentStep !== currentStep) {
    throw new Error(
      `Classic Run step mismatch: expected ${currentStep}, got ${validated.run.currentStep}`,
    );
  }
  return { ...validated, evidence, migrated: false };
}

export class ManagedCompletionIntegrityError extends Error {
  readonly view: Record<string, unknown>;
  constructor(run: RunState, completion: Record<string, unknown>, faults: Array<Record<string, unknown>>) {
    super('RECOVERY_REQUIRED: completed delivery history is retained; current integrity is unverified; linked maintenance is blocked');
    this.name = 'ManagedCompletionIntegrityError';
    this.view = { status: 'blocked', lifecycle: { runId: run.runId, status: run.status, currentStep: run.currentStep, completion },
      currentIntegrity: { status: 'UNVERIFIED', faults }, continuation: null,
      maintenance: { status: 'blocked', executionRegistered: false } };
  }
}

// Completion is lifecycle history; current eligibility is a fresh predicate.
// This never reopens a completed product or manufactures a maintenance job.
async function checkCompletedIntegrity(changeDir: string, context: ClassicRunContext, evidence: ClassicEvidence[], audit: boolean): Promise<void> {
  const { run, classic } = context;
  if (!classic.managedDelivery || run.status !== 'completed') return;
  const faults: Array<Record<string, unknown>> = [];
  try {
    if (resolveClassicStepId(classic, evidence) !== 'completed') {
      faults.push(...evidence.filter((entry) => !entry.satisfied).map((entry) => ({ code: entry.code, detail: entry.detail ?? 'current evidence is unavailable' })));
      if (faults.length === 0) faults.push({ code: 'CURRENT_PREDICATE_UNVERIFIED' });
    }
    if (run.pending !== null) faults.push({ code: 'PENDING_OPERATION_UNRECONCILED', operation: run.pending });
  } catch (error) { faults.push({ code: 'CURRENT_PREDICATE_UNVERIFIED', detail: error instanceof Error ? error.message : String(error) }); }
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  const completed = [...trajectory].reverse().find((event) => event.runId === run.runId && event.type === 'state_transitioned' && event.data.toStep === 'completed');
  const completion = { runId: run.runId, sequence: completed?.sequence ?? null, source: completed ? 'original-trajectory' : 'original-RunState', skillHash: run.skillHash };
  const bindingDigest = createHash('sha256').update(stableStringify({ completion, policy: classic.deliveryPolicy, invalidations: classic.gateInvalidations, faults })).digest('hex');
  if (audit && managedDeliveryHost() && !trajectory.some((event) => event.type === 'eval_completed' && event.data.evalId === 'classic-current-integrity' && event.data.bindingDigest === bindingDigest)) {
    await appendTrajectory(changeDir, run.trajectoryRef, { sequence: trajectory.length + 1, timestamp: new Date().toISOString(), type: 'eval_completed', runId: run.runId,
      data: { scope: 'completion', results: [{ evalId: 'classic-current-integrity', passed: faults.length === 0, evidence: bindingDigest }], evalId: 'classic-current-integrity', passed: faults.length === 0, bindingDigest, completion, faults } });
  }
  if (faults.length > 0) throw new ManagedCompletionIntegrityError(run, completion, faults);
}

export interface ClassicRuntimeReconciliation {
  context: ClassicRunContext;
  reconciled: boolean;
  fromStep: string | null;
}

// Evidence edits (e.g. checking off the final tasks.md entry) advance the
// derived step without a state command, so the recorded currentStep can lag
// behind legitimate evidence progression. Re-sync it instead of failing like
// validateClassicRuntimeRun, which exists to diagnose drift, not to block on it.
export async function reconcileClassicRuntimeRun(
  changeDir: string,
  existingProjection?: ClassicStateProjection,
): Promise<ClassicRuntimeReconciliation> {
  return withClassicStateLock(changeDir, () =>
    reconcileClassicRuntimeRunLocked(changeDir, existingProjection),
  );
}

async function reconcileClassicRuntimeRunLocked(
  changeDir: string,
  existingProjection?: ClassicStateProjection,
): Promise<ClassicRuntimeReconciliation> {
  await requireRunAuthority(changeDir);
  if (managedDeliveryHost()) await syncGateInvalidations(changeDir, await discoverClassicProject(changeDir));
  const projection = await readClassicState(changeDir, { migrate: false });
  if (existingProjection?.run && existingProjection.run.runId !== projection.run?.runId) {
    throw new Error('Classic reconciliation Run changed; reload the current state');
  }
  const validated = await loadValidatedClassicRuntime(changeDir, projection);
  const evidence = await collectClassicEvidence(changeDir, projection);
  if (validated.classic.managedDelivery && validated.run.status === 'completed') {
    await checkCompletedIntegrity(changeDir, { ...validated, evidence, migrated: false }, evidence, true);
    return { context: { ...validated, evidence, migrated: false }, reconciled: false, fromStep: null };
  }
  let currentStep: string;
  try {
    currentStep = resolveClassicStepId(validated.classic, evidence);
  } catch (error) {
    if (!(error instanceof ManagedGatePremisesError)) throw error;
    // Blocked managed premises are a resolution state, not drift: keep the
    // recorded step and let the entrance surfaces enforce the block.
    currentStep = validated.run.currentStep ?? 'unknown';
  }
  if (validated.run.currentStep === currentStep) {
    return {
      context: { ...validated, evidence, migrated: false },
      reconciled: false,
      fromStep: null,
    };
  }
  const reconciledRun: RunState = {
    ...validated.run,
    currentStep,
    iteration: validated.run.iteration + 1,
    // H07: the post-archive knowledge closeout parks the run on waiting —
    // the aggregate closeout predicate, not the archive, decides completion.
    status:
      currentStep === 'completed'
        ? 'completed'
        : currentStep === 'full.closeout.knowledge'
          ? 'waiting'
          : 'running',
  };
  await writeClassicState(changeDir, {
    classic: validated.classic,
    run: reconciledRun,
    unknownKeys: projection.unknownKeys,
  });
  const trajectory = await readTrajectory(changeDir, reconciledRun.trajectoryRef);
  await appendTrajectory(changeDir, reconciledRun.trajectoryRef, {
    sequence: trajectory.length + 1,
    timestamp: new Date().toISOString(),
    type: 'state_transitioned',
    runId: reconciledRun.runId,
    data: {
      kind: 'classic',
      fromStep: validated.run.currentStep,
      toStep: currentStep,
      source: 'record-check',
      reason: 'evidence-reconcile',
    },
  });
  return {
    context: { ...validated, run: reconciledRun, evidence, migrated: false },
    reconciled: true,
    fromStep: validated.run.currentStep,
  };
}

export async function transitionClassicRuntimeRun(
  changeDir: string,
  classic: ClassicState,
  run: RunState,
  data: Record<string, unknown>,
): Promise<RunState> {
  return withClassicStateLock(changeDir, () =>
    transitionClassicRuntimeRunLocked(changeDir, classic, run, data),
  );
}

async function transitionClassicRuntimeRunLocked(
  changeDir: string,
  classic: ClassicState,
  run: RunState,
  data: Record<string, unknown>,
): Promise<RunState> {
  const projection = await readClassicState(changeDir);
  if (!projection.classic || !projection.run) {
    throw new Error('Classic transition requires synchronized Classic and Run projections');
  }
  if (projection.classic.managedDelivery && projection.run.status === 'completed') {
    throw new Error('RUN_COMPLETED: completed product lifecycle cannot be reopened by a transition; linked maintenance is required');
  }
  if (
    projection.run.runId !== run.runId ||
    projection.run.iteration !== run.iteration ||
    (classic.checkEpoch ?? 0) < (projection.classic.checkEpoch ?? 0)
  ) {
    throw new Error('Classic transition became stale; reload the current state');
  }

  const evidence = await collectClassicEvidence(changeDir, {
    classic,
    run,
    unknownKeys: projection.unknownKeys,
  });
  const currentStep = resolveClassicStepId(classic, evidence);
  const nextRun: RunState = {
    ...run,
    currentStep,
    iteration: run.iteration + 1,
    // H07: the post-archive knowledge closeout parks the run on waiting —
    // the aggregate closeout predicate, not the archive, decides completion.
    status:
      currentStep === 'completed'
        ? 'completed'
        : currentStep === 'full.closeout.knowledge'
          ? 'waiting'
          : 'running',
  };

  await writeClassicState(changeDir, {
    classic,
    run: nextRun,
    unknownKeys: projection.unknownKeys,
  });

  const trajectory = await readTrajectory(changeDir, nextRun.trajectoryRef);
  await appendTrajectory(changeDir, nextRun.trajectoryRef, {
    sequence: trajectory.length + 1,
    timestamp: new Date().toISOString(),
    type: 'state_transitioned',
    runId: nextRun.runId,
    data: {
      kind: 'classic',
      fromStep: run.currentStep,
      toStep: currentStep,
      ...data,
    },
  });
  return nextRun;
}
