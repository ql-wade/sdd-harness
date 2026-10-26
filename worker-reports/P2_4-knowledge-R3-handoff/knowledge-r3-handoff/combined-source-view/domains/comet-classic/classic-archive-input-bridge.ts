import { knowledgeOutputScope } from './classic-managed-knowledge.js';
import { readRunState } from '../engine/state.js';
import { type OpenSpecInvocation } from './classic-openspec-binding.js';
import { readClassicDelivery } from './classic-progress.js';
// A signed native archive transformation, never an approval or dispatch queue.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectCheckSnapshot } from './classic-check-snapshot.js';
import { readArtifacts, writeArtifacts } from '../engine/run-store.js';
import type { RunState } from '../engine/types.js';
import { readClassicProjectBytes, inspectClassicProjectTarget } from './classic-protected-path.js';
import { managedDeliveryHost, requireManagedDeliveryHost } from './classic-managed-host.js';
import { stableStringify } from './classic-stable-json.js';
import type { GateInputs, GateId } from './classic-gate-runtime.js';
import { executeClassicOpenSpec } from './classic-openspec-command.js';

const KEY = 'managed_archive_input_bridge';
const digest = (value: unknown) =>
  createHash('sha256').update(stableStringify(value)).digest('hex');
type RawInputs = Record<string, string>;
interface Bridge {
  schema: 'comet.classic.archive-input-bridge.v1';
  purpose: 'archive-transformation-only';
  toolBindingDigest: string;
  runId: string;
  actionId: string;
  epoch: number;
  active: string;
  archived: string;
  policy: unknown;
  controlOutput: string | null;
  deliveryIdentity: string | null;
  authorizationId: string | null;
  before: RawInputs;
  after: RawInputs;
  gates: Partial<Record<GateId, GateInputs>>;
}

// Use the existing native input inventory, but bind ORIGINAL bytes (not task
// progress normalization or mtimes). Runtime state/logs remain in its own store.
async function rawInputs(
  root: string,
  changeDir: string,
  controlOutput: string | null = null,
): Promise<RawInputs> {
  const run=await readRunState(changeDir),policy=managedDeliveryHost()?.policy({projectRoot:root,changeDir,runId:run?.runId});
  const outputs=policy?await knowledgeOutputScope(root,changeDir,run,policy):null;
  const snapshot = await collectCheckSnapshot(root, changeDir,undefined,outputs?{commandOutputs:outputs.identity}:{});
  const inputs: RawInputs = Object.create(null);
  for (const entry of snapshot.entries) {
    // Existing native delivery receipts are controller outputs. Their own
    // delivery verifier remains authoritative; they are not source inputs.
    if (controlOutput !== null && entry.p === controlOutput) continue;
    if (entry.p.startsWith('\0git:')) {
      inputs[entry.p] = entry.h;
      continue;
    }
    if (entry.h === 'missing') {
      inputs[entry.p] = 'missing';
      continue;
    }
    const result = await readClassicProjectBytes(root, path.resolve(root, entry.p), {
      label: 'Archive original input',
    });
    inputs[entry.p] = createHash('sha256').update(result).digest('hex');
  }
  return inputs;
}

async function walkFiles(root: string, directory: string): Promise<string[]> {
  const inspected = await inspectClassicProjectTarget(root, directory, {
    label: 'Archive preview input',
    expected: 'directory',
  });
  if (!inspected.exists) return [];
  const files: string[] = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (
      item.name === '.comet' ||
      item.name === '.comet.yaml' ||
      item.name.startsWith('.comet-state')
    )
      continue;
    const target = path.join(directory, item.name);
    if (item.isSymbolicLink())
      throw new Error('UNVERIFIED: archive preview refuses symbolic links');
    if (item.isDirectory()) files.push(...(await walkFiles(root, target)));
    else if (item.isFile()) files.push(target);
    else throw new Error('UNVERIFIED: archive preview input is not an ordinary file');
  }
  return files;
}

export async function prepareArchiveInputBridge(options: {
  toolInvocation: OpenSpecInvocation;
  projectRoot: string;
  changeDir: string;
  archiveDir: string;
  run: RunState;
  policy: unknown;
  epoch: number;
  gates: Bridge['gates'];
  annotations: Array<{ file: string; transform: (source: string) => string }>;
}): Promise<Bridge> {
  const { projectRoot: root, changeDir } = options;
  const delivery = (await readClassicDelivery(root, changeDir)).delivery;
  const controlOutput =
    delivery?.action === 'archive-only'
      ? `.comet/classic-deliveries/${createHash('sha256').update(delivery.changeIdentity).digest('hex')}.json`
      : null;
  const before = await rawInputs(root, changeDir, controlOutput);
  const active = path.relative(root, changeDir).replaceAll('\\', '/');
  const archived = path.relative(root, options.archiveDir).replaceAll('\\', '/');
  if (
    !/^openspec\/changes\/[^/]+$/u.test(active) ||
    !/^openspec\/changes\/archive\/[^/]+$/u.test(archived)
  )
    throw new Error('UNVERIFIED: archive input bridge requires the fixed native OpenSpec layout');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-archive-preview-'));
  try {
    // Only authorized OpenSpec source bytes enter this disposable project.
    const files = [
      path.join(root, 'openspec/config.yaml'),
      ...(await walkFiles(root, changeDir)),
      ...(await walkFiles(root, path.join(root, 'openspec/specs'))),
    ];
    const originalSpecs: RawInputs = Object.create(null);
    for (const file of files) {
      const relative = path.relative(root, file).replaceAll('\\', '/');
      const bytes = await readClassicProjectBytes(root, file, { label: 'Archive preview source' });
      if (before[relative] !== createHash('sha256').update(bytes).digest('hex'))
        throw new Error(
          'UNVERIFIED: archive source is outside or changed from the frozen input inventory',
        );
      const target = path.join(temporary, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
      originalSpecs[relative] = before[relative];
    }
    await fs.mkdir(path.join(temporary, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(temporary, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    const version = await executeClassicOpenSpec(['--version'], temporary, options.toolInvocation);
    if (version.exitCode !== 0 || version.stdout?.trim() !== '1.11.0')
      throw new Error('UNVERIFIED: archive preview requires the qualified OpenSpec 1.11.0 CLI');
    const preview = await executeClassicOpenSpec(
      ['archive', path.basename(changeDir), '--yes'],
      temporary,
      options.toolInvocation,
    );
    if ((preview.data as {toolIdentity?:{bindingDigest?:string}} | undefined)?.toolIdentity?.bindingDigest !== options.toolInvocation.digest) throw new Error('UNVERIFIED: preview did not use the captured tool binding');
    if (preview.exitCode !== 0)
      throw new Error(
        `UNVERIFIED: deterministic OpenSpec archive preview failed (${preview.exitCode})`,
      );
    const moved = path.join(temporary, archived);
    if (!(await fs.stat(moved).catch(() => null))?.isDirectory())
      throw new Error('UNVERIFIED: archive preview produced a different archive target');
    const after = { ...before };
    for (const relative of Object.keys(originalSpecs)) {
      if (relative.startsWith(active + '/') || relative.startsWith('openspec/specs/'))
        delete after[relative];
    }
    for (const file of [
      ...(await walkFiles(temporary, moved)),
      ...(await walkFiles(temporary, path.join(temporary, 'openspec/specs'))),
    ]) {
      const relative = path.relative(temporary, file).replaceAll('\\', '/');
      const bytes = await readClassicProjectBytes(temporary, file, {
        label: 'Archive preview output',
      });
      after[relative] = createHash('sha256').update(bytes).digest('hex');
    }
    for (const { file, transform } of options.annotations) {
      const relative = path.relative(root, file).replaceAll('\\', '/');
      const bytes = await readClassicProjectBytes(root, file, {
        label: 'Archive annotation input',
      });
      if (before[relative] !== createHash('sha256').update(bytes).digest('hex'))
        throw new Error('UNVERIFIED: archive annotation input changed');
      const target = relative.startsWith(active + '/')
        ? archived + relative.slice(active.length)
        : relative;
      after[target] = createHash('sha256')
        .update(transform(bytes.toString('utf8')))
        .digest('hex');
    }
    return {
      schema: 'comet.classic.archive-input-bridge.v1',
      purpose: 'archive-transformation-only',
      toolBindingDigest: options.toolInvocation.digest,
      runId: options.run.runId,
      actionId: `classic-archive:${path.basename(changeDir)}`,
      epoch: options.epoch,
      active,
      archived,
      policy: options.policy,
      controlOutput,
      deliveryIdentity: delivery?.changeIdentity ?? null,
      authorizationId: delivery?.authorizationId ?? null,
      before,
      after,
      gates: options.gates,
    };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function registerArchiveInputBridge(
  root: string,
  changeDir: string,
  run: RunState,
  bridge: Bridge,
  action: Record<string, any>,
): Promise<void> {
  if (
    run.runId !== bridge.runId ||
    digest(await rawInputs(root, changeDir, bridge.controlOutput)) !== digest(bridge.before)
  )
    throw new Error('UNVERIFIED: archive inputs changed during preview');
  const host = requireManagedDeliveryHost();
  const actionBinding = {
    ...action,
    action: 'archive-transformation-only',
    execution: `${bridge.actionId}:${bridge.epoch}`,
    inputDigest: digest(bridge),
  };
  // Purpose-bound artifact MAC only: never placed in gate_dispatches, collected,
  // consumed or counted as a gate receipt / actual method execution.
  const signature = host.authority.issueDispatch({ ...actionBinding, actionBinding });
  const artifacts = await readArtifacts(changeDir, run.artifactsRef);
  await writeArtifacts(changeDir, run.artifactsRef, {
    ...artifacts,
    [KEY]: JSON.stringify({ bridge, signature }),
  });
}

export async function archivedGateInputs(
  root: string,
  changeDir: string,
  run: RunState | null,
  policy: unknown,
  gate: GateId,
): Promise<GateInputs | null> {
  if (!run || !managedDeliveryHost()) return null;
  const artifacts = await readArtifacts(changeDir, run.artifactsRef);
  if (!artifacts[KEY]) return null;
  const { bridge, signature } = JSON.parse(artifacts[KEY]);
  const relative = path.relative(root, changeDir).replaceAll('\\', '/');
  let delivery;
  try {
    delivery = (await readClassicDelivery(root, changeDir)).delivery;
  } catch {
    // Unverifiable delivery can never preserve a previous approval. Let the
    // original resolver consume blocked evidence and persist the same Run.
    return null;
  }
  const expectedControl =
    delivery?.action === 'archive-only'
      ? `.comet/classic-deliveries/${createHash('sha256').update(delivery.changeIdentity).digest('hex')}.json`
      : null;
  if (
    bridge.controlOutput !== expectedControl ||
    bridge.deliveryIdentity !== (delivery?.changeIdentity ?? null) ||
    bridge.authorizationId !== (delivery?.authorizationId ?? null)
  )
    return null;
  const current = await rawInputs(root, changeDir, bridge.controlOutput);
  // Git keeps deleted tracked paths in its inventory until the archive commit.
  // Fold only absent tombstones of this signed move, never a present old file.
  for (const [file, value] of Object.entries(current)) {
    if (value !== 'missing' || !file.startsWith(`${bridge.active}/`)) continue;
    const suffix = file.slice(bridge.active.length + 1);
    const movedSource =
      bridge.before[file] &&
      bridge.before[file] !== 'missing' &&
      bridge.after[`${bridge.archived}/${suffix}`];
    const movedControl =
      suffix === '.comet.yaml' ||
      suffix === '.comet-state.lock' ||
      suffix === '.comet-state-transaction.json' ||
      suffix.startsWith('.comet/');
    if (movedSource || movedControl) delete current[file];
  }
  if (
    bridge.schema !== 'comet.classic.archive-input-bridge.v1' ||
    bridge.purpose !== 'archive-transformation-only' ||
    bridge.runId !== run.runId ||
    relative !== bridge.archived ||
    artifacts.archive_directory !== relative ||
    digest(policy) !== digest(bridge.policy) ||
    signature.actionBinding?.action !== 'archive-transformation-only' ||
    signature.actionBinding?.inputDigest !== digest(bridge) ||
    signature.run !== run.runId ||
    !managedDeliveryHost()!.authority.verifyDispatch(signature).ok ||
    digest(current) !== digest(bridge.after)
  )
    return null;
  return bridge.gates[gate] ?? null;
}
