// P1_4 compile probe driver (revision 2026-10-26-comet-050-adoption-v1).
//
// Drives the OFFICIAL Comet 0.5.0 workflow-application compiler
// (domains/workflow-generation/compiler.ts, imported from the pinned built
// distribution) against the real sdd composition sources delivered by
// P2_4/P1_6: integrations/comet/application/{composition.json,bindings.mjs,
// skills/}. The probe answers the supply-wave question left UNVERIFIED by
// P2_4 and P1_3: can the declared composition actually be compiled through
// prepareWorkflowApplicationPlan + compileWorkflowApplication into a package
// (application.json), and if not, which exact upstream constraints block it.
//
// Three attempts, all in os.tmpdir() scratch worlds (nothing is written into
// the repository except this probe's JSON record):
//   a as-declared        — the P2_4 composition verbatim; modules['bindings.mjs']
//                          is the verbatim repository file.
//   b bundled+deconflict — two compile-wave duties applied: (1) the bindings
//                          hostContract rebasing composition.json already
//                          assigns (rebase the repository-relative lib/delivery
//                          import onto in-package bundled pure modules) and
//                          (2) splitting one-skill-id-many-schemas dual uses
//                          onto distinct synthetic ids, because the classic
//                          factory compares EVERY replaced step's ORIGINAL
//                          outputSchema against the single adapter of that
//                          skill id (hash equality) — the P2_4 mapping puts
//                          grill-me on both design steps and the domain keeps
//                          comet-archive on both archive steps, whose original
//                          schemas differ pairwise.
//   c diagnostic-host    — b plus a context.createSkillExecutor host executor
//                          stub (authorize:false, never executes). DIAGNOSTIC
//                          ONLY: it isolates whether the executor layer is the
//                          remaining blocker; its package is never a
//                          deliverable and claims no runtime acceptance.
//
// Usage (pinned node):
//   ~/.nvm/versions/node/v24.15.0/bin/node \
//     openspec/changes/delivery-foundation-rearchitecture/mode-probes/compile-probe-050.mjs
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const applicationRoot = path.join(repositoryRoot, 'integrations/comet/application');
const probeOut = path.join(path.dirname(fileURLToPath(import.meta.url)), '1_4-compiler-compile.json');

const lock = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const buildWork = path.join(repositoryRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint, 'work');
const fromBuild = (relative) => pathToFileURL(path.join(buildWork, relative)).href;

const { prepareWorkflowApplicationPlan, compileWorkflowApplication } = await import(fromBuild('dist/domains/workflow-generation/index.js'));
const { hashRuntimeValue } = await import(fromBuild('dist/domains/engine/runtime.js'));
const { inspectApplicationSkill } = await import(fromBuild('dist/domains/workflow-application/index.js'));
const { defineClassicWorkflowApplication } = await import(fromBuild('dist/domains/comet-classic/classic-sdk-application.js'));
const { getCurrentVersion } = await import(fromBuild('dist/platform/version/version.js'));

const fail = (message) => { throw new Error(message); };

const record = {
  schemaVersion: 1,
  probe: '1_4-compiler-compile',
  revision: '2026-10-26-comet-050-adoption-v1',
  recordedAt: new Date().toISOString(),
  node: process.version,
  build: { version: lock.package.version, commit: lock.source.commit, fingerprint, patches: lock.patches.map((p) => p.path) },
  compiler: 'prepareWorkflowApplicationPlan + compileWorkflowApplication (official, imported from the pinned built dist)',
  sourceUnderTest: {
    composition: 'integrations/comet/application/composition.json',
    bindings: 'integrations/comet/application/bindings.mjs',
    skills: 'integrations/comet/application/skills (P1_6 packaged method skills)',
  },
  attempts: [],
  conclusions: [],
};

// --- original classic-full step contracts (authoritative: the built factory)
const base = defineClassicWorkflowApplication('full');
const invokeSkillSteps = Object.entries(base.workflow.steps)
  .filter(([, step]) => step.type === 'invoke_skill')
  .map(([stepId, step]) => ({ stepId, ref: step.ref, outputSchema: step.outputSchema ?? null }));
const originalOutputSchema = (stepId) => {
  const step = base.workflow.steps[stepId];
  if (step.outputSchema === undefined) fail(`step ${stepId} carries no outputSchema`);
  return step.outputSchema;
};
record.baseInvokeSkillSteps = invokeSkillSteps.map((s) => ({
  stepId: s.stepId,
  ref: s.ref,
  outputSchema: s.outputSchema,
}));

// --- composition (declarative source of truth from P2_4)
const compositionDocument = JSON.parse(await fs.readFile(path.join(applicationRoot, 'composition.json'), 'utf8'));
if (compositionDocument.schema !== 'sdd.comet.classic-application.composition.v1') fail('unexpected composition schema');
const composition = compositionDocument.composition;
if (composition.kind !== 'classic' || composition.profile !== 'full') fail('unexpected composition kind/profile');

// --- scratch worlds --------------------------------------------------------
const syntheticSkillWorld = await fs.mkdtemp(path.join(os.tmpdir(), 'p14-skills-'));
const supplyGaps = [];
const reviewedBy = 'p1-4-compile-probe-source-review';

async function inspectSkill(root) {
  return inspectApplicationSkill(root);
}

async function syntheticSkillDirectory(id, purpose) {
  const root = path.join(syntheticSkillWorld, id);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'SKILL.md'), [
    '---',
    `name: ${id}`,
    `description: P1_4 compile-probe synthetic skill (${purpose}). Exists only so the official compiler can type the composition; the managed supply must provide the real reviewed skill. No links, no scripts.`,
    '---',
    '',
    `# ${id} (compile-probe synthetic)`,
    '',
    `${purpose}`,
    '',
  ].join('\n'));
  return root;
}

async function skillDependency({ id, root, outputSchema, completion, scope, note, capability = `${id}.work`, sideEffect = 'write', authorizationFrom } ) {
  let inspected;
  try {
    inspected = await inspectSkill(root);
  } catch (error) {
    // The declared skill directory cannot be embedded at all — record the
    // supply gap and substitute a clearly labeled synthetic stand-in so the
    // COMPILER's own constraints still get exercised.
    supplyGaps.push({ skill: id, root: path.relative(repositoryRoot, root), error: `${error.code ?? 'ERROR'}: ${error.message}` });
    root = await syntheticSkillDirectory(`${id}-stand-in`, `stand-in for ${id}: the packaged skill directory is not embeddable (see supplyGaps)`);
    inspected = await inspectSkill(root);
    note = `${note} [STAND-IN: declared skill not embeddable]`;
  }
  const lines = inspected.files['SKILL.md'].split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 16 && !line.startsWith('---'));
  const excerpt = lines[0]?.slice(0, 80) ?? fail(`skill ${id} carries no excerpt-able SKILL.md line`);
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
        reviewedBy,
        contentHash: inspected.contentHash,
        capabilities: [{ id: capability, file: 'SKILL.md', excerpt }],
        effects: [{ file: 'SKILL.md', excerpt: second }],
      },
    },
    probeNote: note,
  };
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

const packagedSkillRoot = (id) => path.join(applicationRoot, 'skills', id);
const replacementByStepId = new Map(composition.replacements.map((r) => [r.stepId, r.skillId]));

// As-declared assignment: one adapter per composition skill id (first use
// wins); every further use with a DIFFERENT required output schema is a real
// constraint conflict — the classic factory hash-compares each replaced
// step's ORIGINAL schema against that single adapter.
const asDeclaredSkills = new Map();
const schemaConflicts = [];
const asDeclaredBindings = [];
for (const step of invokeSkillSteps) {
  const replaced = replacementByStepId.has(step.stepId);
  const skillId = replaced ? replacementByStepId.get(step.stepId) : step.ref;
  const outputSchema = step.outputSchema ?? (replaced ? originalOutputSchema(step.stepId) : { type: 'object' });
  const note = replaced
    ? `replacement for ${step.stepId} (original ref ${step.ref}); outputSchema cloned from the built factory`
    : `domain-owned step ${step.stepId} kept on the upstream ref ${step.ref}; SYNTHETIC self-contained skill (pristine assets/skills assets carry links escaping the dependency root and are refused by inspectApplicationSkill — see upstreamAssetEscapeFinding)`;
  const completion = 'self-report';
  if (!asDeclaredSkills.has(skillId)) {
    asDeclaredSkills.set(skillId, await skillDependency({
      id: skillId,
      root: replaced ? packagedSkillRoot(skillId) : await syntheticSkillDirectory(skillId, `domain-owned step ${step.stepId}`),
      outputSchema,
      completion,
      scope: ['.'],
      note,
    }));
  } else {
    const existing = asDeclaredSkills.get(skillId);
    schemaConflicts.push({
      skill: skillId,
      existingUse: existing.probeNote,
      additionalUse: note,
      outputSchemasEqual: JSON.stringify(existing.adapter.outputSchema) === JSON.stringify(outputSchema),
      additionalOutputSchema: outputSchema,
    });
  }
  asDeclaredBindings.push({ workflowId: 'comet-classic-full', stepId: step.stepId, skillId, capability: `${skillId}.work`, usage: 'action' });
}
for (const extension of composition.extensions) {
  const stepId = `classic.extension.${extension.id}`;
  if (!asDeclaredSkills.has(extension.skillId)) {
    asDeclaredSkills.set(extension.skillId, await skillDependency({
      id: extension.skillId,
      root: packagedSkillRoot(extension.skillId),
      outputSchema: GATE_RECEIPT_OUTPUT_SCHEMA,
      completion: 'machine-check',
      scope: ['.sdd/delivery/gates'],
      note: `extension skill for ${stepId} @ ${extension.afterStep} (validator ${extension.validator.id}@${extension.validator.version})`,
      capability: `${extension.skillId}.gate`,
    }));
  } else {
    const existing = asDeclaredSkills.get(extension.skillId);
    schemaConflicts.push({
      skill: extension.skillId,
      existingUse: existing.probeNote,
      additionalUse: `extension skill for ${stepId} @ ${extension.afterStep} — extension steps carry NO preset outputSchema, so the single adapter schema of this skill id is what the extension step adopts`,
      outputSchemasEqual: false,
      additionalOutputSchema: GATE_RECEIPT_OUTPUT_SCHEMA,
    });
  }
  asDeclaredBindings.push({ workflowId: 'comet-classic-full', stepId, skillId: extension.skillId, capability: `${extension.skillId}.gate`, usage: 'action' });
}
record.upstreamAssetEscapeFinding = 'pristine assets/skills/<name> SKILL.md links to ../comet-classic/reference/* escape the dependency root and are refused by inspectApplicationSkill (INVALID_WORKFLOW: Skill 引用越过依赖目录) — upstream domain skill assets are NOT embeddable as package skills';
record.schemaConflicts = schemaConflicts;
record.supplyGaps = supplyGaps;
record.asDeclaredSkills = [...asDeclaredSkills.values()].map((d) => ({ id: d.id, root: path.relative(repositoryRoot, d.root), contentHash: d.contentHash, note: d.probeNote }));
record.asDeclaredBindings = asDeclaredBindings;

// --- bindings module variants ---------------------------------------------
const bindingsSource = await fs.readFile(path.join(applicationRoot, 'bindings.mjs'), 'utf8');
const REPO_IMPORT = "from '../../../lib/delivery/gate.js'";
if (!bindingsSource.includes(REPO_IMPORT)) fail('bindings.mjs no longer imports lib/delivery via the pinned relative specifier; update this probe');

// Bundle the pure SDD.Gate.v1 graph (lib/delivery/gate.js plus its repo-local
// imports) into in-package modules, byte-verbatim except for the rewritten
// relative specifiers (compiler moduleRef accepts only .mjs/.json refs with
// dot-free path segments).
function bundleGraph(entry) {
  const modules = Object.create(null);
  const refOf = (file) => {
    const relative = path.relative(repositoryRoot, file).split(path.sep).join('/');
    return `sdd/${relative.replace(/\.js$/, '.mjs').split('/').map((segment, index, all) => (index < all.length - 1 ? segment.replace(/[.-]/g, '_') : `${segment.replace(/\.mjs$/, '').replace(/[.-]/g, '_')}.mjs`)).join('-')}`;
  };
  const seen = new Set();
  const IMPORT_RE = /(import|export)\s+(?:[\w$]+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+['"]([^'"]+)['"]/g;
  const walk = (file) => {
    const real = fss.realpathSync(file);
    if (seen.has(real)) return refOf(real);
    seen.add(real);
    let source = fss.readFileSync(real, 'utf8');
    const dir = path.dirname(real);
    const ownRef = refOf(real);
    const renames = [];
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source))) {
      const specifier = match[2];
      if (!specifier.startsWith('.')) continue; // node builtins stay untouched
      renames.push([specifier, walk(path.resolve(dir, specifier))]);
    }
    for (const [specifier, ref] of renames) {
      let target = path.posix.relative(path.posix.dirname(ownRef), ref);
      if (!target.startsWith('.')) target = `./${target}`;
      source = source.split(`'${specifier}'`).join(`'${target}'`).split(`"${specifier}"`).join(`"${target}"`);
    }
    modules[ownRef] = source;
    return ownRef;
  };
  walk(entry);
  return modules;
}
const gateRef = bundleGraph(path.join(repositoryRoot, 'lib/delivery/gate.js'));
const gateModuleRef = 'sdd/lib-delivery-gate.mjs';
if (!gateRef[gateModuleRef]) fail(`bundler did not produce ${gateModuleRef}; keys: ${Object.keys(gateRef).join(', ')}`);
const bundledBindings = bindingsSource.split(REPO_IMPORT).join(`from './${gateModuleRef}'`);
const hostExecutorAppend = `    executors: [context.createSkillExecutor({
      id: 'sdd-compile-probe-host',
      capabilities: ['skill-host'],
      authorize: async () => false,
      invokeSkill: async () => { throw new Error('diagnostic probe host: the official compile never executes skills'); },
    })],`;
const tail = '    })),\n  };';
if (!bundledBindings.includes(tail)) fail('bindings.mjs tail changed; update this probe');
const diagnosticBindings = bundledBindings.replace(tail, `    })),\n${hostExecutorAppend}\n  };`);
record.bundledGateModules = Object.keys(gateRef).sort();

// --- variant builder --------------------------------------------------------
// deconflicted=true re-assigns EVERY invoke_skill step whose composition skill
// id is already used with a different original output schema onto a distinct
// synthetic split id (`<skillId>-<step-slug>`), which is the only shape the
// classic factory can accept (one adapter hash-matching every step it serves).
async function buildVariant({ deconflicted }) {
  if (!deconflicted) {
    return { skills: [...asDeclaredSkills.values()], bindings: asDeclaredBindings, composition, deviations: [] };
  }
  const skills = new Map();
  const bindings = [];
  const deviations = [];
  // The upstream compile example (domains/workflow-generation/examples.ts)
  // replaces EVERY invoke_skill step with a DISTINCT per-step skill id, each
  // adapter cloning that step's ORIGINAL outputSchema. The live refusals
  // recorded by attempts a/b prove this is not a stylistic choice but the
  // only compilable shape: a single skill id shared by two steps with
  // different original schemas fails the factory hash check, and an
  // UNREPLACED step must reuse the upstream ref id — which the domain itself
  // shares across schema-different steps (comet-archive on prepare+deliver).
  // The deconflicted variant therefore adopts the upstream shape for ALL
  // invoke_skill steps (per-step ids), keeping the composition's declared
  // method mapping visible in the id prefix.
  const replacements = [];
  for (const step of invokeSkillSteps) {
    const replaced = replacementByStepId.has(step.stepId);
    const declaredId = replaced ? replacementByStepId.get(step.stepId) : step.ref;
    const outputSchema = step.outputSchema ?? (replaced ? originalOutputSchema(step.stepId) : { type: 'object' });
    const slug = step.stepId.replace(/[^\w]+/g, '-').replace(/-+/g, '-');
    const perStepId = `${declaredId}-${slug}`;
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(perStepId)) fail(`per-step id invalid: ${perStepId}`);
    const packagedRoot = packagedSkillRoot(declaredId);
    const usePackaged = replaced && await fs.access(packagedRoot).then(() => true, () => false);
    const root = usePackaged ? packagedRoot : await syntheticSkillDirectory(perStepId, `per-step skill for ${step.stepId} (composition maps it to ${declaredId})`);
    skills.set(perStepId, await skillDependency({
      id: perStepId,
      root,
      outputSchema,
      completion: 'self-report',
      scope: ['.'],
      note: `per-step replacement for ${step.stepId}${usePackaged ? ` carrying the packaged ${declaredId} method skill` : ' (synthetic: no packaged skill for this id)'}`,
    }));
    replacements.push({ stepId: step.stepId, skillId: perStepId });
    bindings.push({ workflowId: 'comet-classic-full', stepId: step.stepId, skillId: perStepId, capability: `${perStepId}.work`, usage: 'action', authorizationFrom: 'classic.composition.confirm', authorizationChoices: ['approved'] });
    if (!replaced) deviations.push(`${step.stepId}: unreplaced in the declared composition (ref ${step.ref}); the compile shape requires a per-step replacement id ${perStepId} (the domain ref ${step.ref} is shared across schema-different steps and can never hash-match once)`);
    else if (perStepId !== declaredId) deviations.push(`${step.stepId}: declared skill ${declaredId} is one id serving multiple steps/schemas; per-step id ${perStepId} used instead`);
  }
  for (const extension of composition.extensions) {
    const stepId = `classic.extension.${extension.id}`;
    if (!skills.has(extension.skillId)) {
      skills.set(extension.skillId, await skillDependency({
        id: extension.skillId,
        root: packagedSkillRoot(extension.skillId),
        outputSchema: GATE_RECEIPT_OUTPUT_SCHEMA,
        completion: 'machine-check',
        scope: ['.sdd/delivery/gates'],
        note: `extension skill for ${stepId} @ ${extension.afterStep} (read-only judgment of the gate receipt bundle)`,
        capability: `${extension.skillId}.gate`,
        sideEffect: 'read',
      }));
    }
    bindings.push({ workflowId: 'comet-classic-full', stepId, skillId: extension.skillId, capability: `${extension.skillId}.gate`, usage: 'action' });
  }
  return {
    skills: [...skills.values()],
    bindings,
    composition: { ...composition, replacements },
    deviations,
  };
}

// --- the three compile attempts -------------------------------------------
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p14-compile-'));
const projectRoot = path.join(scratch, 'project');
await fs.mkdir(projectRoot, { recursive: true });

async function attempt({ id, description, modules, deconflicted }) {
  const packageRoot = path.join(scratch, `pkg-${id}`);
  const entry = { id, description, stages: {} };
  record.attempts.push(entry);
  const variant = await buildVariant({ deconflicted });
  if (variant.deviations.length) entry.deviations = variant.deviations;
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
      skills: variant.skills.map(({ id: skillId, root, contentHash, adapter }) => ({ id: skillId, root, contentHash, adapter })),
      bindings: variant.bindings,
    },
    composition: structuredClone(variant.composition),
    modules,
  };
  try {
    const plan = await prepareWorkflowApplicationPlan({ proposal, packageRoot, projectRoot });
    entry.stages.prepare = { status: 'PASS', compositionHash: hashRuntimeValue(plan) };
  } catch (error) {
    entry.stages.prepare = { status: 'FAIL', error: `${error.code ?? 'ERROR'}: ${error.message}` };
    entry.outcome = 'REFUSED_AT_PREPARE';
    return;
  }
  try {
    const prepared = await prepareWorkflowApplicationPlan({ proposal, packageRoot: path.join(scratch, `pkg-${id}-confirm`), projectRoot });
    const compiled = await compileWorkflowApplication({
      plan: prepared,
      confirmationHash: hashRuntimeValue(prepared),
      packageRoot,
      projectRoot,
    });
    entry.stages.compile = { status: 'PASS', file: path.relative(repositoryRoot, compiled.file), compositionHash: compiled.compositionHash, contentHash: compiled.contentHash, workflowHashes: compiled.workflowHashes };
    entry.outcome = 'COMPILED';
    entry.packageRoot = packageRoot;
  } catch (error) {
    entry.stages.compile = { status: 'FAIL', error: `${error.code ?? 'ERROR'}: ${error.message}` };
    entry.outcome = 'REFUSED_AT_COMPILE';
  }
}

await attempt({
  id: 'a',
  description: 'as-declared: the P2_4 composition verbatim; modules.bindings.mjs is the verbatim repository file',
  modules: { 'bindings.mjs': bindingsSource },
  deconflicted: false,
});
await attempt({
  id: 'b',
  description: 'bundled-gate + deconflicted: hostContract import rebasing applied AND one-skill-many-schemas dual uses split onto distinct synthetic ids',
  modules: { 'bindings.mjs': bundledBindings, ...gateRef },
  deconflicted: true,
});
await attempt({
  id: 'c',
  description: 'DIAGNOSTIC ONLY: bundled-gate + deconflicted + createSkillExecutor host stub (authorize:false, never executes)',
  modules: { 'bindings.mjs': diagnosticBindings, ...gateRef },
  deconflicted: true,
});

const outcomeOf = (id) => record.attempts.find((entry) => entry.id === id)?.outcome;
record.conclusions.push(
  `as-declared compile: ${outcomeOf('a')} (${record.attempts[0].stages.prepare.error ?? 'prepared'} ${record.attempts[0].stages.compile?.error ?? ''})`,
  `bundled+deconflicted compile: ${outcomeOf('b')} (${record.attempts[1].stages.prepare.error ?? record.attempts[1].stages.prepare.status} ${record.attempts[1].stages.compile?.error ?? record.attempts[1].stages.compile?.status ?? ''})`,
  `diagnostic host variant: ${outcomeOf('c')} (${record.attempts[2].stages.prepare.error ?? record.attempts[2].stages.prepare.status} ${record.attempts[2].stages.compile?.error ?? record.attempts[2].stages.compile?.status ?? ''})`,
);
if (outcomeOf('c') === 'COMPILED') {
  record.conclusions.push(
    'with (1) import rebasing, (2) per-step skill ids where one composition skill id would have to hash-match two different original output schemas, and (3) a host executor from createBindings, the official compiler ACCEPTS the composition — the delivered bindings.mjs lacks (1) and (3), and the declared composition lacks (2); variant c is a diagnostic, not a deliverable',
  );
  record.attempts[2].packageFiles = await fs.readdir(record.attempts[2].packageRoot);
} else {
  record.conclusions.push('diagnostic variant c still refused — the compile gap is deeper than the executor layer; see attempts[2] for the constraint');
}
record.scratchWorlds = { skills: syntheticSkillWorld, compile: scratch };

await fs.writeFile(probeOut, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ out: probeOut, outcomes: record.attempts.map((a) => ({ id: a.id, outcome: a.outcome, error: a.stages.prepare.error ?? a.stages.compile?.error })), conclusions: record.conclusions }, null, 2));
