import { archivedGateInputs } from './classic-archive-input-bridge.js';
// Managed delivery gate runtime (patch 0002-managed-delivery-runtime).
//
// The single Classic Run gains one shared gate surface per
// classic-gate-runtime-contract.md: classic-gate-policy (fixed required gate
// sets, rework routes and budgets), classic-gate-receipts (Runtime-dispatched,
// input-bound receipts carried inside the change's own .comet.yaml
// transaction) and classic-gate-evaluate (the premise evaluation every
// managed entrance consumes). Roles submit artifacts; they can never set a
// gate or a phase to passing: acceptance requires a Runtime-issued dispatch
// record whose input binding is re-verified against the current artifacts at
// acceptance time, and receipts are re-evaluated — never deleted — on every
// dispatch, acceptance, managed write, transition, recovery and completion
// decision. Stale or rejected receipts degrade to explicit rework routes on
// the same Run; there is no second controller and no second ledger, and all
// of it stays dormant unless the change is in managed delivery
// (managed_delivery: true in .comet.yaml).
import { createHash } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'path';
import {
  readOptionalEngineRunText,
  writeEngineRunText,
} from '../../domains/engine/protected-run-file.js';
import type { RunState } from '../../domains/engine/types.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { latestCommandCheck } from './classic-command-checks.js';
import { checkInputFingerprint } from './classic-check-snapshot.js';
import { readClassicState, writeClassicState, withClassicStateLock } from './classic-store.js';
import { readRunState } from '../../domains/engine/state.js';
import { managedDeliveryHost, requireManagedDeliveryHost, evaluateManagedSource, ManagedSourceUnverifiedError, type ManagedRecord } from './classic-managed-host.js';

export const GATE_POLICY_VERSION = 'comet-managed-v2';
// Fixed per gate and input version: rejection budget is counted on the
// accepting Runtime surface, never reset by starting a new session.
export const GATE_REWORK_BUDGET = 3;
export const MAX_GATE_RECEIPTS = 100;
export const MAX_GATE_DISPATCHES = 500;

// Typed block: entrance surfaces surface it as recovery-required; purely
// derived recomputations (state writes, run reconciliation) catch it and keep
// the recorded step — the block resolves through the rework route, and every
// entrance re-evaluates before anything dispatches.
export class ManagedGatePremisesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedGatePremisesError';
  }
}

export type GateId = 'R' | 'A' | 'T' | 'P' | 'V' | 'Kp' | 'Kt' | 'K';
export const GATE_IDS = ['R', 'A', 'T', 'P', 'V', 'Kp', 'Kt', 'K'] as const;

export function isGateId(value: string): value is GateId {
  return (GATE_IDS as readonly string[]).includes(value);
}

// Execution roles are Runtime-assigned at dispatch time and are never read
// from worker-submitted files (D01: a role label inside a report grants
// nothing).
export const GATE_ROLES: Record<GateId, string> = {
  R: 'requirements-owner',
  A: 'reviewer',
  T: 'reviewer',
  P: 'planner',
  V: 'verifier',
  Kp: 'knowledge-author',
  Kt: 'knowledge-publisher',
  K: 'legacy-unqualified',
};

// Fixed policy: the required gate set per managed action. K is deliberately
// not part of phase premises — Knowledge.Closeout.v1 keeps Kp before archive
// at the driver gate, while Kt is the run-level seat that blocks overall
// completion (knowledgeCloseoutBlocked) and is recorded on the Run itself.
export type GateAction = 'enter-design' | 'enter-build' | 'enter-verify' | 'enter-archive' | 'archive-spec' | 'complete' | 'product-write';

export function requiredGates(action: GateAction): readonly GateId[] {
  switch (action) {
    case 'enter-design':
      // C01/P1-01: no current R receipt means no entry into the formal
      // architecture phase — the requirement gate precedes design, not build.
      return ['R'];
    case 'enter-build':
      return ['R', 'A', 'T'];
    case 'enter-verify':
      return ['R', 'A', 'T', 'P'];
    case 'enter-archive':
      return ['R', 'A', 'T', 'P', 'V'];
    case 'archive-spec':
      return ['R', 'A', 'T', 'P', 'V', 'Kp'];
    case 'complete':
      return ['R', 'A', 'T', 'P', 'V', 'Kp', 'Kt'];
    case 'product-write':
      return ['R', 'A', 'T', 'P'];
  }
}

// Entering authoring work cannot require the gate that work must produce.
// Completion guards continue to use enter-build/verify/archive separately.
export function entryGateAction(phase: string): GateAction | null {
  if (phase === 'design') return 'enter-design';
  if (phase === 'build') return 'enter-build';
  if (phase === 'verify') return 'enter-verify';
  if (phase === 'archive') return 'enter-archive';
  return null;
}

// Fixed rework routes (contract section 5). Every route names a Runtime
// action on the SAME run; none of them creates a parallel controller.
export function repairRoute(gate: GateId, phase?: unknown): string {
  if (gate === 'A' || gate === 'T') {
    if (phase === 'design') {
      return gate === 'A'
        ? 'architecture-repair: remain in Design; the existing Runtime-authorized design author revises the registered design, then the original Runtime dispatches and accepts a new independent A review'
        : 'test-design-repair: remain in Design; the existing Runtime-authorized test author revises the registered test intent, then the original Runtime dispatches and accepts a new independent T review';
    }
    if (phase !== 'build' && phase !== 'verify') {
      return 'read the current Native state before selecting an architecture/test repair action; this hint authorizes no transition';
    }
  }
  switch (gate) {
    case 'R':
      return 'requirements-repair: comet state transition <change> requirements-repair, revise proposal/specs and re-confirm R';
    case 'A':
      return 'architecture-repair: comet state transition <change> architecture-repair, revise the design, re-dispatch and re-accept A';
    case 'T':
      return 'test-design-repair: comet state transition <change> test-design-repair, revise the test intent, re-dispatch and re-accept T';
    case 'P':
      return 'plan-repair: revise the plan/tasks definitions, then re-dispatch and re-accept P';
    case 'V':
      return 'verify rework: comet state transition <change> verify-fail, produce a new candidate, then re-verify';
    case 'Kp':
      return 'project-knowledge: execute and independently read back required LLMWiki knowledge before archive';
    case 'Kt':
      return 'team-knowledge: reconcile original Outline operation and independently read back before completion';
    case 'K':
      return 'legacy generic knowledge closeout is historical only; use separate Kp/Kt obligations';
  }
}

const SHA256_RE = /^[a-f0-9]{64}$/u;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const sha256Text = (value: string): string => createHash('sha256').update(value).digest('hex');

// ---- receipts ---------------------------------------------------------------

export interface GateReceipt {
  gate: GateId;
  verdict: 'pass' | 'reject';
  digest: string;
  dependsOn: Partial<Record<GateId, string>>;
  execution: string;
  attempt: number;
  epoch: number;
  // P1-03: the invalidation generation this receipt was accepted under. A
  // receipt only counts while the gate's persisted generation still equals it;
  // restoring old bytes does not roll the generation back.
  generation: number;
  policyVersion: string;
  acceptedAt: string;
  report: string | null;
  reportDigest: string | null;
  findings: string[];
  sourceEntry?: ManagedRecord;
  intent?: GateDispatch;
  evaluated?: ManagedRecord;
}

function receiptFrom(value: unknown, label: string): GateReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Classic gate receipts: ${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const fail = (detail: string): never => {
    throw new Error(`Invalid Classic gate receipts: ${label}.${detail}`);
  };
  if (typeof record.gate !== 'string' || !isGateId(record.gate)) fail('gate must be one of R/A/T/P/V/K');
  if (record.verdict !== 'pass' && record.verdict !== 'reject') fail('verdict must be pass or reject');
  if (!nonEmpty(record.digest) || !SHA256_RE.test(record.digest)) fail('digest must be a sha256 hex digest');
  const dependsOn: Partial<Record<GateId, string>> = {};
  if (record.dependsOn !== null && record.dependsOn !== undefined) {
    if (typeof record.dependsOn !== 'object' || Array.isArray(record.dependsOn)) {
      fail('dependsOn must be an object');
    }
    for (const [key, digest] of Object.entries(record.dependsOn as Record<string, unknown>)) {
      if (!isGateId(key)) fail('dependsOn must bind gate ids to sha256 digests');
      if (!nonEmpty(digest) || !SHA256_RE.test(digest)) {
        fail('dependsOn must bind gate ids to sha256 digests');
      }
      dependsOn[key as GateId] = digest as string;
    }
  }
  if (!nonEmpty(record.execution)) fail('execution must be a non-empty string');
  if (!Number.isInteger(record.attempt) || (record.attempt as number) < 1) fail('attempt must be an integer >= 1');
  if (!Number.isInteger(record.epoch) || (record.epoch as number) < 0) fail('epoch must be an integer >= 0');
  if (record.generation !== undefined && (!Number.isInteger(record.generation) || (record.generation as number) < 0)) {
    fail('generation must be an integer >= 0');
  }
  if (![GATE_POLICY_VERSION, 'managed-delivery.v1'].includes(record.policyVersion as string)) fail('unsupported policyVersion');
  if (!nonEmpty(record.acceptedAt)) fail('acceptedAt must be a timestamp string');
  for (const key of ['report', 'reportDigest'] as const) {
    const value = record[key];
    if (value !== null && value !== undefined && !nonEmpty(value)) fail(`${key} must be a non-empty string or null`);
  }
  if (record.reportDigest !== null && record.reportDigest !== undefined) {
    if (!nonEmpty(record.reportDigest) || !SHA256_RE.test(record.reportDigest)) {
      fail('reportDigest must be a sha256 hex digest or null');
    }
  }
  if (record.findings !== undefined && !Array.isArray(record.findings)) fail('findings must be an array of strings');
  const findings = (record.findings as unknown[] | undefined) ?? [];
  if (!findings.every((finding) => nonEmpty(finding))) fail('findings must be non-empty strings');
  return {
    gate: record.gate as GateId,
    verdict: record.verdict as 'pass' | 'reject',
    digest: record.digest as string,
    dependsOn,
    execution: record.execution as string,
    attempt: record.attempt as number,
    epoch: record.epoch as number,
    generation: (record.generation as number | undefined) ?? 0,
    policyVersion: record.policyVersion as string,
    ...(record.sourceEntry ? { sourceEntry: record.sourceEntry as ManagedRecord, intent: record.intent as GateDispatch, evaluated: record.evaluated as ManagedRecord } : {}),
    acceptedAt: record.acceptedAt as string,
    report: (record.report as string | null | undefined) ?? null,
    reportDigest: (record.reportDigest as string | null | undefined) ?? null,
    findings: findings as string[],
  };
}

// The wire form of gate_receipts is a JSON document (the run_retries
// precedent): .comet.yaml stays scalar-friendly for `state get`, and the
// receipts ride the existing YAML transaction unchanged.
export function parseGateReceipts(raw: unknown): GateReceipt[] {
  if (raw === null || raw === undefined || raw === '') return [];
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error('Invalid Classic gate receipts: gate_receipts must be a JSON document', { cause: error });
    }
  }
  if (!Array.isArray(value)) {
    throw new Error('Invalid Classic gate receipts: gate_receipts must be a JSON array');
  }
  if (value.length > MAX_GATE_RECEIPTS) {
    throw new Error(`Invalid Classic gate receipts: more than ${MAX_GATE_RECEIPTS} receipts`);
  }
  return value.map((entry, index) => receiptFrom(entry, `receipts[${index}]`));
}

// ---- knowledge closeout (Kt run-level seat) ---------------------------------

export interface KnowledgeCloseout {
  targetKind: 'file' | 'external';
  target: string;
  revision: string;
  readbackDigest: string;
  execution: string;
  recordedAt: string;
}

export function parseKnowledgeCloseout(raw: unknown): KnowledgeCloseout | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error('Invalid Classic knowledge closeout: must be a JSON document', { cause: error });
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Classic knowledge closeout: must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    (record.targetKind !== 'file' && record.targetKind !== 'external') ||
    !nonEmpty(record.target) ||
    !nonEmpty(record.revision) ||
    !nonEmpty(record.readbackDigest) ||
    !SHA256_RE.test(record.readbackDigest) ||
    !nonEmpty(record.execution) ||
    !nonEmpty(record.recordedAt)
  ) {
    throw new Error(
      'Invalid Classic knowledge closeout: requires targetKind file|external, target, revision, readbackDigest (sha256), execution, recordedAt',
    );
  }
  return {
    targetKind: record.targetKind,
    target: record.target,
    revision: record.revision,
    readbackDigest: record.readbackDigest,
    execution: record.execution,
    recordedAt: record.recordedAt,
  };
}

// Sync completion predicate (resolver status): a managed Run with a required
// knowledge obligation is not completed while the seat is empty. E02/D07:
// archived stays "not completed" until this returns false.
export function knowledgeCloseoutBlocked(classic: {
  managedDelivery?: boolean;
  knowledgeCloseoutRequired?: boolean;
  knowledgeCloseout?: unknown;
  gateReceipts?: unknown;
  deliveryPolicy?: unknown;
  gateRunId?: string | null;
}): boolean {
  if (!classic.managedDelivery) return false;
  const value = classic as typeof classic & { gateReceipts?: unknown; deliveryPolicy?: unknown; gateRunId?: string | null };
  if (!value.deliveryPolicy || !value.gateReceipts) return true;
  try {
    const policy = typeof value.deliveryPolicy === 'string' ? JSON.parse(value.deliveryPolicy) : value.deliveryPolicy;
    if (policy.projectKnowledgeRequired !== true || policy.teamKnowledgeRequired !== true || !managedDeliveryHost()) return true;
    const receipts = parseGateReceipts(value.gateReceipts);
    for (const gate of ['Kp', 'Kt'] as const) {
      const receipt = [...receipts].reverse().find((entry) => entry.gate === gate);
      if (!receipt || receipt.verdict !== 'pass' || receipt.policyVersion !== GATE_POLICY_VERSION || !receipt.intent || !receipt.sourceEntry) return true;
      if (evaluateManagedSource({ ...receipt.intent, nativeRunId: value.gateRunId }, receipt.sourceEntry, receipts, true).evaluated.verdict !== 'pass') return true;
    }
    return false;
  } catch { return true; }

}

// ---- invalidation generation registry (P1-03) --------------------------------
//
// Monotonic per-gate invalidation generations persisted in the SAME .comet.yaml
// transaction as the receipts: once a managed surface has OBSERVED a gate's
// inputs diverging from its latest pass receipt, that observation is recorded
// and never rolled back — restoring the original bytes keeps the generation
// and the old receipt stays invalid until a fresh review binds the new
// generation.

export interface GateInvalidation {
  count: number;
  digest: string;
}

export function parseGateInvalidations(raw: unknown): Partial<Record<GateId, GateInvalidation>> {
  if (raw === null || raw === undefined || raw === '') return {};
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error('Invalid Classic gate invalidations: gate_invalidations must be a JSON document', { cause: error });
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Classic gate invalidations: gate_invalidations must be an object');
  }
  const result: Partial<Record<GateId, GateInvalidation>> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isGateId(key)) throw new Error('Invalid Classic gate invalidations: keys must be gate ids');
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isInteger((entry as Record<string, unknown>).count) ||
      (entry as Record<string, unknown>).count as number < 0 ||
      !nonEmpty((entry as Record<string, unknown>).digest) ||
      !SHA256_RE.test((entry as Record<string, unknown>).digest as string)
    ) {
      throw new Error('Invalid Classic gate invalidations: entries must be { count, digest }');
    }
    result[key as GateId] = {
      count: (entry as Record<string, unknown>).count as number,
      digest: (entry as Record<string, unknown>).digest as string,
    };
  }
  return result;
}

export function controlledGateRevision(classic: { gateInvalidations: unknown; gateDispatches?: string | null }, from: GateId): { gateInvalidations: string; gateDispatches: string } {
  const invalidations = parseGateInvalidations(classic.gateInvalidations);
  const affected = new Set<GateId>(GATE_IDS.slice(GATE_IDS.indexOf(from)).filter((gate) => gate !== 'K'));
  for (const gate of affected) {
    const count = (invalidations[gate]?.count ?? 0) + 1;
    invalidations[gate] = { count, digest: sha256Text(`controlled-revision:${gate}:${count}`) };
  }
  const registry = dispatchFileFrom(classic.gateDispatches ?? null);
  for (const dispatch of registry.dispatches) if (dispatch.state === 'open' && affected.has(dispatch.gate)) dispatch.state = 'stale';
  return { gateInvalidations: stableStringify(invalidations), gateDispatches: stableStringify(registry) };
}

export const gateGenerationOf = (invalidations: Partial<Record<GateId, GateInvalidation>>, gate: GateId): number =>
  invalidations[gate]?.count ?? 0;

// Persist every OBSERVED input invalidation of a pass receipt as a new
// monotonic generation. Callers that already hold the Classic state lock use
// the Locked core; everything else goes through the locking wrapper.
export async function syncGateInvalidations(directory: string, projectRoot: string): Promise<void> {
  await withClassicStateLock(directory, () => syncGateInvalidationsLocked(directory, projectRoot));
}

export async function syncGateInvalidationsLocked(
  directory: string,
  projectRoot: string,
): Promise<void> {
  const projection = await readClassicState(directory, { migrate: false });
  let classic = projection.classic;
  if (!classic || classic.managedDelivery !== true) return;
  const host = managedDeliveryHost();
  if (!host) return; // an unqualified standalone hook cannot mutate gate generations
  let policyChanged = false;
  if (host) {
    const snapshot = host.policy({ projectRoot, changeDir: directory, runId: projection.run?.runId });
    if (!snapshot || snapshot.projectKnowledgeRequired !== true || snapshot.teamKnowledgeRequired !== true
      || !nonEmpty(snapshot.ref) || typeof snapshot.digest !== 'string' || !SHA256_RE.test(snapshot.digest) || !nonEmpty(snapshot.revision)) {
      throw new ManagedSourceUnverifiedError('UNVERIFIED: fixed comet-managed-v2 policy requires both Kp/Kt and ref/digest/revision');
    }
    const serialized = stableStringify(snapshot);
    if (serialized !== classic.deliveryPolicy) {
      classic = { ...classic, deliveryPolicy: serialized, checkEpoch: (classic.checkEpoch ?? 0) + 1 };
      policyChanged = true;
      // Existing pass history is retained. The ordinary digest/generation
      // invalidation below makes policy rollback unable to revive it.
    }
  }
  const receipts = parseGateReceipts(classic.gateReceipts);
  const registry = await readGateDispatches(directory);
  const invalidations = parseGateInvalidations(classic.gateInvalidations);
  let changed = false;
  const state: GateStateInput = {
    designDoc: classic.designDoc,
    plan: classic.plan,
    testIntent: classic.testIntent,
    gateReceipts: classic.gateReceipts,
    gateInvalidations: invalidations,
    deliveryPolicy: classic.deliveryPolicy,
  };
  const run = await readRunState(directory);
  // A pass is topological: dependencies are settled before their consumers.
  // Cache input digests only within this pass; generation reads stay live.
  const inputCache = new Map<GateId, Promise<GateInputs>>();
  const inputsFor = (gate: GateId): Promise<GateInputs> => {
    const cached = inputCache.get(gate);
    if (cached) return cached;
    const pending = computeGateInputs({ projectRoot, changeDir: directory, gate, state, run,
      currentDigestOf: (dependency) => inputsFor(dependency).then((inputs) => inputs.digest) });
    inputCache.set(gate, pending);
    return pending;
  };
  for (const gate of GATE_IDS) {
    if (gate === 'K') continue;
    const accepted = [...receipts].reverse().find((receipt) => receipt.gate === gate && receipt.verdict === 'pass');
    const pending = [...registry.dispatches].reverse().find((dispatch) => dispatch.gate === gate && dispatch.state === 'open');
    const usePending = pending && (!accepted || pending.generation >= accepted.generation && pending.epoch >= accepted.epoch);
    const latest = usePending ? { digest: pending.inputDigest, intent: pending, sourceEntry: undefined } : accepted;
    if (!latest) continue;
    const inputs = await inputsFor(gate);
    const entry = invalidations[gate];
    let sourceChanged = false;
    let currentSource: unknown = null;
    if (latest.intent) {
      try {
        const context = host.context({ ...latest.intent, inputDigest: inputs.digest, nativeRunId: projection.run?.runId });
        currentSource = { action: context.actionBinding, qualification: context.admissionOptions?.sourceQualification };
        const previousSource = { action: latest.intent.actionBinding, qualification: latest.sourceEntry?.sourcePacket?.collection?.source?.qualification ?? latest.intent.sourceQualification };
        sourceChanged = stableStringify(currentSource) !== stableStringify(previousSource);
      } catch { /* unavailable source is blocked by admission, not rewritten as a new approval */ }
    }
    const observed = sha256Text(stableStringify({ inputs: inputs.digest, source: currentSource }));
    if ((inputs.digest !== latest.digest || sourceChanged) && entry?.digest !== observed) {
      invalidations[gate] = { count: (entry?.count ?? 0) + 1, digest: observed };
      changed = true;
    }
  }
  // P1-03: an observed invalidation also retires in-flight dispatches of a
  // gate that were issued at an older generation — their review context is
  // pre-invalidation, a late result must not revive the gate, and the job-key
  // recovery of the 0003 stack must not resurface them. Idempotent and
  // self-healing: it runs on every sync, writing only on change.
  let registryChanged = false;
  for (const dispatch of registry.dispatches) {
    if (
      dispatch.state === 'open' &&
      (dispatch.generation ?? 0) < (invalidations[dispatch.gate]?.count ?? 0)
    ) {
      dispatch.state = 'stale';
      registryChanged = true;
    }
  }
  if (!changed && !registryChanged && !policyChanged) return;
  await writeClassicState(directory, {
    classic: { ...classic, gateInvalidations: stableStringify(invalidations), gateDispatches: stableStringify(registry) },
    run: projection.run, unknownKeys: projection.unknownKeys,
  });
}

// ---- dispatch registry --------------------------------------------------------

export interface GateDispatch {
  gate: GateId;
  role: string;
  execution: string;
  attempt: number;
  inputDigest: string;
  dependsOn: Partial<Record<GateId, string>>;
  issuedAt: string;
  epoch: number;
  // P1-03: the invalidation generation at issue time; acceptance requires it
  // to still equal the gate's current generation, so a late attempt from a
  // pre-invalidation generation cannot revive a gate by matching restored
  // bytes.
  generation: number;
  state: 'open' | 'consumed' | 'stale';
  runId?: string;
  sourceQualification?: ManagedRecord;
  jobKey?: string;
  actionBinding?: ManagedRecord;
  protectedDispatch?: ManagedRecord;
  verdict?: 'pass' | 'reject';
  transport?: import('../engine/types.js').ManagedActionTransport;
}

export interface GateDispatchFile {
  schema: 'comet.classic.gate-dispatches.v1';
  dispatches: GateDispatch[];
}

const DISPATCHES_FILE = '.comet/gate-dispatches.json';

export function dispatchFileFrom(raw: string | null): GateDispatchFile {
  if (raw === null) return { schema: 'comet.classic.gate-dispatches.v1', dispatches: [] };
  const value = JSON.parse(raw) as GateDispatchFile;
  if (!value || value.schema !== 'comet.classic.gate-dispatches.v1' || !Array.isArray(value.dispatches)) {
    throw new Error('Invalid Classic gate dispatch registry');
  }
  return value;
}

export async function readGateDispatches(changeDir: string): Promise<GateDispatchFile> {
  const projection = await readClassicState(changeDir, { migrate: false });
  // Old independent dispatch files remain historical, never imported as
  // qualified intents into the current authority transaction.
  return dispatchFileFrom(projection.classic?.gateDispatches ?? null);
}

export async function writeGateDispatches(changeDir: string, file: GateDispatchFile): Promise<void> {
  if (file.dispatches.length > MAX_GATE_DISPATCHES) throw new Error('Gate dispatch history limit reached; reconcile the same Run');
  const projection = await readClassicState(changeDir, { migrate: false });
  if (!projection.classic) throw new Error('Classic state is missing');
  await writeClassicState(changeDir, { ...projection, classic: { ...projection.classic, gateDispatches: stableStringify(file) } });
}

// ---- input bindings -----------------------------------------------------------

export interface GateStateInput {
  designDoc: string | null;
  plan: string | null;
  testIntent: string | null;
  gateReceipts: unknown;
  deliveryPolicy?: unknown;
  gateInvalidations?: unknown;
}

const readChangeArtifact = async (root: string, absolute: string, label: string): Promise<string | null> => {
  try {
    const file = await readProtectedProjectFile(
      root,
      path.relative(root, absolute).replaceAll('\\', '/'),
      64 * 1024 * 1024,
      { label },
    );
    return file.bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

async function hashProjectFile(root: string, absolute: string): Promise<string | null> {
  const content = await readChangeArtifact(root, absolute, 'Gate input artifact');
  return content === null ? null : sha256Text(content);
}

async function hashDirectoryFiles(root: string, directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let listed: Dirent[];
  try {
    listed = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of listed.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await hashDirectoryFiles(root, target));
    } else if (entry.isFile()) {
      const digest = await hashProjectFile(root, target);
      if (digest !== null) files[path.relative(root, target).replaceAll('\\', '/')] = digest;
    }
  }
  return files;
}

// Tasks DEFINITION digest only: normal progress ticks must not invalidate the
// plan gate (C04/D05), while definition edits do.
async function gateTasksDefinition(changeDir: string): Promise<string> {
  const source = await readChangeArtifact(changeDir, path.join(changeDir, 'tasks.md'), 'Gate tasks artifact');
  if (source === null) return sha256Text('missing:tasks.md');
  const host = managedDeliveryHost();
  // P2_1 supplies its production AST-based definition digest. No second
  // incomplete Markdown scanner is introduced inside Comet.
  return host ? host.definitionDigest(source) : sha256Text(source);

}

export interface GateInputs {
  digest: string;
  dependsOn: Partial<Record<GateId, string>>;
  missing: string[];
}

const dependencyGates: Partial<Record<GateId, readonly GateId[]>> = {
  A: ['R'],
  T: ['R', 'A'],
  P: ['R', 'A', 'T'],
  V: ['R', 'A', 'T', 'P'],
  Kp: ['R', 'A', 'T', 'P', 'V'],
  Kt: ['R', 'A', 'T', 'P', 'V', 'Kp'],
};

// The declared, conservative input binding of one gate: full content digests
// of the change's declared artifacts plus the CURRENT input digests of its
// dependency gates. First version computes conservative full-artifact
// digests; any change of a declared artifact invalidates the gate because the
// recomputed binding no longer matches the accepted receipt.
export async function computeGateInputs(options: {
  projectRoot: string;
  changeDir: string;
  gate: GateId;
  state: GateStateInput;
  run?: RunState | null;
  currentDigestOf?: (gate: GateId) => Promise<string>;
}): Promise<GateInputs> {
  const { projectRoot, changeDir, gate, state } = options;
  const run = options.run ?? null;
  const archived = await archivedGateInputs(projectRoot, changeDir, run, state.deliveryPolicy ?? null, gate);
  if (archived) return archived;
  const resolveDependency = options.currentDigestOf ?? ((dependency) => computeGateInputs({ ...options, gate: dependency }).then((inputs) => inputs.digest));
  const missing: string[] = [];
  const files: Record<string, string> = {};
  const extra: Record<string, unknown> = { deliveryPolicy: state.deliveryPolicy ?? null };

  const addFile = async (label: string, relative: string | null): Promise<void> => {
    if (!relative || relative === 'null') {
      missing.push(`${label}: not declared`);
      return;
    }
    const digest = await hashProjectFile(projectRoot, path.resolve(projectRoot, relative));
    if (digest === null) {
      missing.push(`${label}: ${relative} is missing`);
      return;
    }
    files[relative.replaceAll('\\', '/')] = digest;
  };

  if (gate === 'R' || gate === 'A' || gate === 'T' || gate === 'P') {
    Object.assign(files, await hashDirectoryFiles(projectRoot, path.join(changeDir, 'specs')));
    await addFile('proposal.md', path.relative(projectRoot, path.join(changeDir, 'proposal.md')));
  }
  if (gate === 'A' || gate === 'T' || gate === 'P') {
    await addFile('design_doc', state.designDoc);
  }
  if (gate === 'T' || gate === 'P') {
    await addFile('test_intent', state.testIntent);
  }
  if (gate === 'P') {
    if (state.plan?.endsWith('.md')) {
      const plan = await readChangeArtifact(projectRoot, path.resolve(projectRoot, state.plan), 'Plan definition');
      if (plan === null) missing.push('plan: missing');
      else files.plan = managedDeliveryHost()?.definitionDigest(plan) ?? sha256Text(plan);
    } else await addFile('plan', state.plan);
    extra.tasksDefinition = await gateTasksDefinition(changeDir);
  }
  if (gate === 'V' || gate === 'Kp' || gate === 'Kt') {
    extra.candidate = await checkInputFingerprint(projectRoot, changeDir);
    // The receipt binds the IDENTITY of the latest runtime verification
    // record — deliberately not evaluateCommandCheck, whose phase-boundary
    // epoch rule must not make the V receipt self-stale after verify-pass
    // advances the epoch. Candidate staleness on later code changes stays
    // with the native check layer (it refuses stale inputs on rerun).
    if (run) {
      const record = await latestCommandCheck(projectRoot, changeDir, run, 'verify');
      extra.verifyRecord = record
        ? {
            argv: record.argv ?? null,
            cwd: record.cwd,
            exitCode: record.exitCode,
            inputAfter: record.inputAfter ?? null,
            provenance: record.provenance,
            timestamp: record.timestamp,
          }
        : 'unavailable: no runtime verification record';
    } else {
      extra.verifyRecord = 'unavailable: no Run context';
    }
  }

  const dependsOn: Partial<Record<GateId, string>> = {};
  for (const dependency of dependencyGates[gate] ?? []) {
    const currentInput = await resolveDependency(dependency);
    const receipt = [...parseGateReceipts(state.gateReceipts)].reverse().find((entry) => entry.gate === dependency);
    dependsOn[dependency] = sha256Text(stableStringify({ currentInput, generation: gateGenerationOf(parseGateInvalidations(state.gateInvalidations), dependency), receipt: receipt ? {
      digest: receipt.digest, verdict: receipt.verdict, execution: receipt.execution, attempt: receipt.attempt,
      generation: receipt.generation, policyVersion: receipt.policyVersion,
      collection: receipt.sourceEntry?.collectionId ?? null,
    } : null }));
  }

  const digest = sha256Text(stableStringify({ gate, files, extra, dependsOn }));
  return { digest, dependsOn, missing };
}

// ---- evaluation -----------------------------------------------------------------

export interface GateEvaluation {
  managed: boolean;
  action: GateAction;
  allowed: boolean;
  missing: GateId[];
  stale: GateId[];
  rejected: GateId[];
  routes: string[];
  details: string[];
}

const gateStateInput = (classic: Record<string, unknown>): GateStateInput => ({
  designDoc: (classic.designDoc as string | null) ?? null,
  plan: (classic.plan as string | null) ?? null,
  testIntent: (classic.testIntent as string | null) ?? null,
  gateReceipts: classic.gateReceipts,
  gateInvalidations: classic.gateInvalidations,
  deliveryPolicy: classic.deliveryPolicy,
});

// The premise evaluation every managed entrance consumes. Receipts are never
// modified here: staleness and rejection are derived from the last receipt per
// gate against the freshly recomputed input binding (D02/D04/D05), and each
// blocked gate degrades to its fixed rework route (D03).
export async function evaluateGatePremises(options: {
  projectRoot: string;
  changeDir: string;
  classic: Record<string, unknown>;
  run?: RunState | null;
  action: GateAction;
  dependencyOf?: GateId;
}): Promise<GateEvaluation> {
  if (options.classic.managedDelivery === true) {
    await syncGateInvalidations(options.changeDir, options.projectRoot);
    const projection = await readClassicState(options.changeDir, { migrate: false });
    if (projection.classic) options = { ...options, classic: projection.classic as unknown as Record<string, unknown>, run: projection.run };
  }
  const managed = options.classic.managedDelivery === true;
  const evaluation: GateEvaluation = {
    managed,
    action: options.action,
    allowed: true,
    missing: [],
    stale: [],
    rejected: [],
    routes: [],
    details: [],
  };
  if (!managed) return evaluation;

  const receipts = parseGateReceipts(options.classic.gateReceipts);
  const cache = new Map<GateId, Promise<string>>();
  const currentDigestOf = (gate: GateId): Promise<string> => {
    const cached = cache.get(gate);
    if (cached) return cached;
    const pending = computeGateInputs({ ...options, state: gateStateInput(options.classic), gate, currentDigestOf }).then(
      (inputs) => inputs.digest,
    );
    cache.set(gate, pending);
    return pending;
  };

  // P1-03: a receipt is current only against BOTH the recomputed input
  // binding AND the persisted invalidation generation; an observed
  // invalidation survives byte restoration.
  const invalidations = parseGateInvalidations(options.classic.gateInvalidations);
  for (const gate of options.dependencyOf ? (dependencyGates[options.dependencyOf] ?? []) : requiredGates(options.action)) {
    const latest = [...receipts].reverse().find((receipt) => receipt.gate === gate);
    if (!latest) {
      evaluation.missing.push(gate);
      evaluation.routes.push(repairRoute(gate, options.classic.phase));
      evaluation.details.push(`gate ${gate}: no accepted receipt (dispatch and accept through the Runtime before this action)`);
      continue;
    }
    let authenticated = false;
    if (latest.policyVersion === GATE_POLICY_VERSION && latest.sourceEntry && latest.intent && managedDeliveryHost()) {
      try { const judged = evaluateManagedSource({ ...latest.intent, nativeRunId: options.run?.runId }, latest.sourceEntry, receipts, true); authenticated = latest.verdict === 'reject' || judged.evaluated.verdict === 'pass'; } catch { /* unverified remains blocked */ }
    }
    if (!authenticated) {
      evaluation.stale.push(gate);
      evaluation.routes.push(repairRoute(gate, options.classic.phase));
      evaluation.details.push(`UNVERIFIED: gate ${gate} has no current protected source and independent review`);
      continue;
    }
    if (latest.verdict === 'reject') {
      evaluation.rejected.push(gate);
      evaluation.routes.push(repairRoute(gate, options.classic.phase));
      evaluation.details.push(`gate ${gate}: rejected at epoch ${latest.epoch} — ${latest.findings[0] ?? 'structured rejection recorded'}`);
      continue;
    }
    const current = await currentDigestOf(gate);
    const generation = gateGenerationOf(invalidations, gate);
    if (current !== latest.digest) {
      evaluation.stale.push(gate);
      evaluation.routes.push(repairRoute(gate, options.classic.phase));
      evaluation.details.push(`gate ${gate}: receipt from epoch ${latest.epoch} is stale against the current input binding (inputs changed after acceptance)`);
    } else if ((latest.generation ?? 0) !== generation) {
      evaluation.stale.push(gate);
      evaluation.routes.push(repairRoute(gate, options.classic.phase));
      evaluation.details.push(`gate ${gate}: receipt from epoch ${latest.epoch} predates the current invalidation generation ${generation} (inputs changed and were observed after acceptance; restoring old bytes does not revive a receipt)`);
    }
  }
  evaluation.allowed = evaluation.missing.length === 0 && evaluation.stale.length === 0 && evaluation.rejected.length === 0;
  return evaluation;
}

// Sync resolver status over PRE-COLLECTED evidence items: the resolver has no
// I/O, so collectGateEvidence computes gate currency asynchronously and the
// resolver consumes the satisfied flags only.
export interface GateEvidenceItem {
  code: string;
  satisfied: boolean;
  detail?: string;
}

export async function collectGateEvidence(options: {
  projectRoot: string;
  changeDir: string;
  classic: Record<string, unknown>;
  run?: RunState | null;
}): Promise<GateEvidenceItem[]> {
  if (options.classic.managedDelivery !== true) return [];
  const projection = await readClassicState(options.changeDir, { migrate: false });
  const classic = projection.classic as unknown as Record<string, unknown> ?? options.classic;
  options = { ...options, run: projection.run };
  const items: GateEvidenceItem[] = [];
  const receipts = parseGateReceipts(classic.gateReceipts);
  const cache = new Map<GateId, Promise<string>>();
  const currentDigestOf = (gate: GateId): Promise<string> => {
    const cached = cache.get(gate);
    if (cached) return cached;
    const pending = computeGateInputs({ ...options, state: gateStateInput(classic), gate, currentDigestOf }).then((inputs) => inputs.digest);
    cache.set(gate, pending);
    return pending;
  };
  const invalidations = parseGateInvalidations(classic.gateInvalidations);
  for (const gate of GATE_IDS) {
    if (gate === 'K') continue;
    const latest = [...receipts].reverse().find((receipt) => receipt.gate === gate);
    if (!latest || latest.verdict !== 'pass') {
      items.push({ code: `gate.${gate}.current`, satisfied: false, detail: latest ? 'rejected' : 'missing' });
      continue;
    }
    const current = await currentDigestOf(gate);
    const generation = gateGenerationOf(invalidations, gate);
    let authenticated = false;
    if (latest.policyVersion === GATE_POLICY_VERSION && latest.sourceEntry && latest.intent && managedDeliveryHost()) {
      try { authenticated = evaluateManagedSource({ ...latest.intent, nativeRunId: options.run?.runId }, latest.sourceEntry, receipts, true).evaluated.verdict === 'pass'; } catch { /* fail closed */ }
    }
    const currentNow = authenticated && current === latest.digest && (latest.generation ?? 0) === generation;
    items.push({
      code: `gate.${gate}.current`,
      satisfied: currentNow,
      detail: currentNow ? undefined : 'stale against current inputs',
    });
  }
  return items;
}

// The resolver's managed premise check for phases that would dispatch
// implementation or verification work against invalid premises (contract
// section 1, resolver row: never dispatch old implementation steps while
// stale). Design phase is exempt — it IS the repair route.
export function managedPremisesBlocked(
  classic: { managedDelivery?: boolean; archived?: boolean },
  evidence: ReadonlyArray<{ code: string; satisfied: boolean }>,
  phase: string,
): { blocked: boolean; route: string | null } {
  if (!classic.managedDelivery) return { blocked: false, route: null };
  // verify dispatches verification work: its premises are the verify-entry
  // inputs (R/A/T/P), not V itself — V is what verify produces. Design
  // dispatches architecture work: its premise is the requirements gate (P1-01
  // recovery surface — reconciling history never authorizes design work
  // without a current R).
  const action: GateAction | null = phase === 'archive' && classic.archived ? 'complete' : entryGateAction(phase);
  if (!action) return { blocked: false, route: null };
  for (const gate of requiredGates(action)) {
    const item = evidence.find((entry) => entry.code === `gate.${gate}.current`);
    if (item && !item.satisfied) return { blocked: true, route: repairRoute(gate, phase) };
    if (!item) return { blocked: true, route: repairRoute(gate, phase) };
  }
  return { blocked: false, route: null };
}

// Independent readback helper for file-kind knowledge closeout targets (D06):
// the Runtime re-derives the digest itself before recording the seat.
export async function knowledgeTargetDigest(projectRoot: string, target: string): Promise<string | null> {
  return hashProjectFile(projectRoot, path.resolve(projectRoot, target));
}
