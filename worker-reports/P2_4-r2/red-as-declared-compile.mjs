// P2_4-r2 RED probe (revision 2026-10-26-comet-050-adoption-v1).
//
// Re-runs the OFFICIAL Comet 0.5.0 compiler (prepareWorkflowApplicationPlan,
// imported from the pinned built distribution de39629a…, same method as the
// P1_4 probe mode-probes/compile-probe-050.mjs) against the CURRENT declared
// composition deliverable (integrations/comet/application/{composition.json,
// bindings.mjs, skills/}) exactly as committed, to record the live REFUSED
// evidence that reopens P2_4 (repair list R1-R6 in mode-qualification.json).
//
// Attempt "as-declared" only: modules['bindings.mjs'] is the verbatim
// repository file; the composition replacements are used verbatim; domain
// skill roots are synthetic self-contained directories exactly like the P1_4
// probe recorded them (upstream pristine assets are not embeddable — R6).
// Nothing is written into the repository; the world is os.tmpdir().
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const applicationRoot = path.join(repositoryRoot, 'integrations/comet/application');

const lock = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const buildWork = path.join(repositoryRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint, 'work');
const fromBuild = (relative) => pathToFileURL(path.join(buildWork, relative)).href;

const { prepareWorkflowApplicationPlan } = await import(fromBuild('dist/domains/workflow-generation/index.js'));
const { inspectApplicationSkill } = await import(fromBuild('dist/domains/workflow-application/index.js'));
const { defineClassicWorkflowApplication } = await import(fromBuild('dist/domains/comet-classic/classic-sdk-application.js'));
const { getCurrentVersion } = await import(fromBuild('dist/platform/version/version.js'));

const compositionDocument = JSON.parse(await fs.readFile(path.join(applicationRoot, 'composition.json'), 'utf8'));
const composition = compositionDocument.composition;
const bindingsSource = await fs.readFile(path.join(applicationRoot, 'bindings.mjs'), 'utf8');

const base = defineClassicWorkflowApplication('full');
const invokeSkillSteps = Object.entries(base.workflow.steps)
  .filter(([, step]) => step.type === 'invoke_skill')
  .map(([stepId, step]) => ({ stepId, ref: step.ref, outputSchema: step.outputSchema ?? null }));

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p24r2-red-'));
const syntheticWorld = await fs.mkdtemp(path.join(os.tmpdir(), 'p24r2-red-skills-'));

async function syntheticSkillDirectory(id, purpose) {
  const root = path.join(syntheticWorld, id);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'SKILL.md'), [
    '---',
    `name: ${id}`,
    `description: P2_4-r2 RED probe synthetic skill (${purpose}).`,
    '---',
    '',
    `# ${id} (RED-probe synthetic)`,
    '',
    purpose,
    '',
  ].join('\n'));
  return root;
}

const GATE_RECEIPT_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'sourceHash', 'artifactHashes', 'gateEvidence'],
  additionalProperties: false,
  properties: {
    verdict: { enum: ['pass', 'repair', 'revise-requirements'] },
    sourceHash: { type: 'string' },
    artifactHashes: { type: 'object' },
    gateEvidence: { type: 'object' },
  },
};

const supplyGaps = [];

async function skillDependency({ id, root, outputSchema, completion, scope, capability = `${id}.work`, sideEffect = 'write' }) {
  let inspected;
  try {
    inspected = await inspectApplicationSkill(root);
  } catch (error) {
    // The declared skill directory cannot be embedded at all (P1_4 recorded
    // the same gaps): record it and substitute a synthetic stand-in so the
    // OFFICIAL compiler's own refusal is what this RED probe reports.
    supplyGaps.push({ skill: id, root: path.relative(repositoryRoot, root), error: `${error.code ?? 'ERROR'}: ${error.message}` });
    const standIn = await syntheticSkillDirectory(`${id}-stand-in`, `stand-in for ${id}: the declared skill directory is not embeddable (see supplyGaps)`);
    inspected = await inspectApplicationSkill(standIn);
  }
  const lines = inspected.files['SKILL.md'].split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 16 && !line.startsWith('---'));
  const excerpt = lines[0]?.slice(0, 80);
  const second = lines[1]?.slice(0, 80) ?? excerpt;
  return {
    id,
    root: inspected.root,
    contentHash: inspected.contentHash,
    adapter: {
      kind: 'action',
      inputSchema: { type: 'object' },
      outputSchema,
      scope,
      requiredCapabilities: ['skill-host'],
      interaction: 'none',
      sideEffect,
      controlsApproval: false,
      completion,
      failure: 'repair',
      recovery: 'manual',
      review: {
        status: 'accepted',
        reviewedBy: 'p2-4-r2-red-probe-source-review',
        contentHash: inspected.contentHash,
        capabilities: [{ id: capability, file: 'SKILL.md', excerpt }],
        effects: [{ file: 'SKILL.md', excerpt: second }],
      },
    },
  };
}

const replacementByStepId = new Map(composition.replacements.map((r) => [r.stepId, r.skillId]));
const skills = new Map();
const bindings = [];
for (const step of invokeSkillSteps) {
  const replaced = replacementByStepId.has(step.stepId);
  const skillId = replaced ? replacementByStepId.get(step.stepId) : step.ref;
  const outputSchema = step.outputSchema ?? (replaced ? base.workflow.steps[step.stepId].outputSchema : { type: 'object' });
  if (!skills.has(skillId)) {
    const root = replaced
      ? path.join(applicationRoot, 'skills', skillId)
      : await syntheticSkillDirectory(skillId, `domain-owned step ${step.stepId}`);
    skills.set(skillId, await skillDependency({ id: skillId, root, outputSchema, completion: 'self-report', scope: ['.'] }));
  }
  bindings.push({ workflowId: 'comet-classic-full', stepId: step.stepId, skillId, capability: `${skillId}.work`, usage: 'action' });
}
for (const extension of composition.extensions) {
  const skillId = extension.skillId;
  if (!skills.has(skillId)) {
    skills.set(skillId, await skillDependency({
      id: skillId,
      root: path.join(applicationRoot, 'skills', skillId),
      outputSchema: GATE_RECEIPT_OUTPUT_SCHEMA,
      completion: 'machine-check',
      scope: ['.sdd/delivery/gates'],
      capability: `${skillId}.gate`,
      sideEffect: 'read',
    }));
  }
  bindings.push({ workflowId: 'comet-classic-full', stepId: `classic.extension.${extension.id}`, skillId, capability: `${skillId}.gate`, usage: 'action' });
}

const proposal = {
  schema: 'comet.workflow.application.plan.v1',
  manifest: {
    schema: 'comet.workflow.application.v1',
    id: 'sdd-managed-delivery',
    version: '1',
    base: 'classic-full',
    runtimeVersion: getCurrentVersion(),
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    skills: [...skills.values()],
    bindings,
  },
  composition: structuredClone(composition),
  modules: { 'bindings.mjs': bindingsSource },
};

const result = { probe: 'p2_4-r2-red-as-declared-compile', revision: '2026-10-26-comet-050-adoption-v1', node: process.version, build: { version: lock.package.version, commit: lock.source.commit, fingerprint }, supplyGaps, outcome: null };
await fs.mkdir(path.join(scratch, 'project'), { recursive: true });
try {
  const plan = await prepareWorkflowApplicationPlan({ proposal, packageRoot: path.join(scratch, 'pkg'), projectRoot: path.join(scratch, 'project') });
  result.outcome = 'UNEXPECTEDLY_PREPARED';
  result.compositionHash = plan.compositionHash ?? null;
} catch (error) {
  result.outcome = 'REFUSED_AT_PREPARE';
  result.error = `${error.code ?? 'ERROR'}: ${error.message}`;
}
result.scratchWorlds = { compile: scratch, skills: syntheticWorld };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.outcome === 'REFUSED_AT_PREPARE' ? 0 : 1;
