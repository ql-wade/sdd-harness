#!/usr/bin/env node
// integrations/comet/application/internal/build-application.mjs — the P2_4-r2
// package build driver (revision 2026-10-29-comet-051-adoption-v1, ADR-0023).
//
// Uses the public ESM exports of the first PATH-selected global Comet 0.5.1.
// The project-owned application is compiled into a new caller-selected
// directory outside this source repository; existing outputs are never removed.
// The Classic example and app package are built in external temporary space.
// This constructs an artifact only: trusted host, Kt and end-to-end Run remain
// unverified. The global package metadata is checked, not supply-qualified.
//
// Usage: node integrations/comet/application/internal/build-application.mjs
//   --out <absolute-new-external-directory>
// Exit codes: 0 built / 1 input unavailable / 2 compilation refused.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const applicationRoot = path.join(repositoryRoot, 'integrations/comet/application');
const fail = (code, message) => {
  console.error(`[build-application] ${message}`);
  process.exit(code);
};
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// The output is a caller-owned new path outside the source repository.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out' || !path.isAbsolute(args[1])) fail(1, 'provide an absolute new --out directory outside the source repository');
const sourceRoot = await fs.realpath(repositoryRoot);
const lock = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
if (lock.package?.name !== '@rpamis/comet' || lock.package?.version !== '0.5.1') fail(1, 'Comet 0.5.1 version lock required');
const requested = path.resolve(args[1]);
let outputParent;
try { outputParent = await fs.realpath(path.dirname(requested)); }
catch { fail(1, 'output parent must exist'); }
const inside = (base, value) => { const relative = path.relative(base, value); return relative === '' || (!relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
if (inside(sourceRoot, outputParent)) fail(1, 'output must be outside the source repository');
const outputRoot = path.join(outputParent, path.basename(requested));
const packageRoot = path.join(outputRoot, 'package');
const compileManifestFile = path.join(outputRoot, 'compile-manifest.json');
for (const value of [outputRoot]) {
  try { await fs.lstat(value); fail(1, 'output already exists; preserved'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Resolve the first executable on PATH, then its own npm package metadata.
let realCli;
for (const segment of (process.env.PATH ?? '').split(path.delimiter)) {
  const candidate = path.resolve(segment || '.', 'comet');
  try { fss.accessSync(candidate, fss.constants.X_OK); realCli = fss.realpathSync(candidate); break; } catch { /* try next PATH entry */ }
}
if (!realCli || inside(sourceRoot, realCli)) fail(1, 'global Comet executable is required');
const globalRoot = fss.realpathSync(path.resolve(path.dirname(realCli), '..'));
let globalPackage;
try { globalPackage = JSON.parse(fss.readFileSync(path.join(globalRoot, 'package.json'), 'utf8')); }
catch { fail(1, 'global Comet package metadata is unavailable'); }
const declaredBin = typeof globalPackage.bin === 'string' ? globalPackage.bin : globalPackage.bin?.comet;
if (globalPackage.name !== lock.package.name || globalPackage.version !== lock.package.version || typeof declaredBin !== 'string') fail(1, 'global @rpamis/comet 0.5.1 is required');
let declaredReal;
try { declaredReal = fss.realpathSync(path.resolve(globalRoot, declaredBin)); } catch { fail(1, 'global Comet executable mismatch'); }
if (!inside(globalRoot, declaredReal) || declaredReal !== realCli) fail(1, 'global Comet executable mismatch');
const [major, minor] = process.versions.node.split('.').map(Number);
if (!((major === 22 && minor >= 16) || major >= 24)) fail(1, 'Comet requires Node ^22.16 or >=24');
const versionEnv = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR']
  .filter((key) => typeof process.env[key] === 'string').map((key) => [key, process.env[key]]));
versionEnv.NODE_DISABLE_COMPILE_CACHE = '1';
const versionProbe = spawnSync(realCli, ['--version'], {encoding: 'utf8', timeout: 10000, env: versionEnv});
if (versionProbe.status !== 0 || versionProbe.stdout.trim() !== '0.5.1') fail(1, 'global Comet CLI does not report 0.5.1');
const importPublic = async (subpath) => {
  const entry = globalPackage.exports?.[subpath]?.import;
  if (typeof entry !== 'string' || !entry.startsWith('./')) fail(1, `missing official ESM export ${subpath}`);
  let target;
  try { target = fss.realpathSync(path.resolve(globalRoot, entry)); } catch { fail(1, `unavailable official ESM export ${subpath}`); }
  if (!inside(globalRoot, target)) fail(1, `official ESM export escapes its installed package: ${subpath}`);
  return import(pathToFileURL(target).href);
};
const { prepareWorkflowApplicationPlan, compileWorkflowApplication, prepareWorkflowApplicationExample } = await importPublic('./applications/compiler');
const { hashRuntimeValue } = await importPublic('./runtime');
const { inspectApplicationSkill } = await importPublic('./applications');

// --- composition -------------------------------------------------------------
const compositionDocument = JSON.parse(await fs.readFile(path.join(applicationRoot, 'composition.json'), 'utf8'));
if (compositionDocument.schema !== 'sdd.comet.classic-application.composition.v1') fail(1, 'unexpected composition schema');
if (compositionDocument.base !== 'classic-full') fail(1, 'unexpected composition base');
if (compositionDocument.upstream?.package !== globalPackage.name || compositionDocument.upstream?.version !== globalPackage.version) {
  fail(1, 'composition upstream identity does not match global Comet');
}
const composition = compositionDocument.composition;
if (composition.kind !== 'classic' || composition.profile !== 'full') fail(1, 'unexpected composition kind/profile');
const managed = compositionDocument.managedSkillVariants;
const variantsByStep = new Map(managed.work.map((entry) => [entry.stepId, entry]));
const replacementByStep = new Map(composition.replacements.map((entry) => [entry.stepId, entry.skillId]));

// Ask the public compiler for its stock Classic example in an external
// scratch directory; use its original work-step schemas, never copy upstream
// sources into the project.
const scratch = await fs.mkdtemp(path.join(outputParent, '.sdd-comet-build-'));
const exampleProject = path.join(scratch, 'example-project');
const examplePackage = path.join(scratch, 'example-package');
await fs.mkdir(exampleProject, { recursive: true });
try { await prepareWorkflowApplicationExample({ base: 'classic-full', projectRoot: exampleProject, packageRoot: examplePackage }); }
catch (error) { fail(2, `official Classic example failed: ${error.code ?? 'ERROR'}: ${error.message}`); }
const example = JSON.parse(await fs.readFile(path.join(examplePackage, 'workflow.json'), 'utf8'));
const baseWorkflow = example.workflows.find((workflow) => workflow.id === 'comet-classic-full');
if (!baseWorkflow) fail(2, 'official Classic example has no full workflow');
const invokeSkillSteps = managed.work.map((entry) => {
  const step = baseWorkflow.steps?.[entry.stepId];
  if (step?.type !== 'invoke_skill') fail(2, `official Classic work step missing: ${entry.stepId}`);
  return { stepId: entry.stepId, ref: step.ref, outputSchema: entry.presetOutputSchema ? (step.outputSchema ?? null) : null };
});

// R3 shape checks: every invoke_skill step has exactly one per-step managed
// skill id, unique across the workflow, and the declaration sets agree.
{
  const stepIds = invokeSkillSteps.map((step) => step.stepId).sort();
  const replaced = [...replacementByStep.keys()].sort();
  if (JSON.stringify(stepIds) !== JSON.stringify(replaced)) {
    fail(1, `replacements must cover exactly the invoke_skill steps: workflow [${stepIds}] vs composition [${replaced}]`);
  }
  const declared = [...variantsByStep.keys()].sort();
  if (JSON.stringify(stepIds) !== JSON.stringify(declared)) {
    fail(1, `managedSkillVariants.work must cover exactly the invoke_skill steps: [${declared}] vs [${stepIds}]`);
  }
  const ids = [...replacementByStep.values()];
  if (new Set(ids).size !== ids.length) fail(1, 'per-step skill ids must be unique across the workflow (R3)');
  for (const [stepId, skillId] of replacementByStep) {
    if (!/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(skillId)) fail(1, `invalid skill id: ${skillId}`);
    if (variantsByStep.get(stepId).skillId !== skillId) fail(1, `composition replacement and managedSkillVariants disagree on ${stepId}`);
  }
}

// --- managed skill roots ------------------------------------------------------
// Determinism: every skill dependency is staged under one scratch deps tree
// and referenced by the deterministic relative root 'skills/<id>' plus
// dependencyRoot. The plan hash (which lands in installation.json/SKILL.md
// via the compiler) then contains no machine- or run-specific path, so
// rebuilding from identical inputs reproduces byte-identical packages.
const depsRoot = path.join(scratch, 'deps');
await fs.mkdir(depsRoot, { recursive: true });
const stagedSkillRoot = (id) => path.join(depsRoot, 'skills', id);

// R6: extract the pinned original output contract from a domain-work skill
// and verify it still equals the factory schema (stable deep comparison).
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
function pinnedContractBlock(markdown) {
  const blocks = [...markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
  return blocks.length ? blocks[blocks.length - 1] : null;
}
function verifyDomainContract(skillId, markdown, factorySchema) {
  const pinned = pinnedContractBlock(markdown);
  if (factorySchema === null) {
    if (pinned !== null) fail(2, `domain skill ${skillId} pins a contract block but its factory step has no preset outputSchema`);
    return;
  }
  if (pinned === null) fail(2, `domain skill ${skillId} does not pin its original output contract`);
  let parsed;
  try {
    parsed = JSON.parse(pinned);
  } catch (error) {
    fail(2, `domain skill ${skillId} contract block is not valid JSON: ${error.message}`);
  }
  if (stable(parsed) !== stable(factorySchema)) {
    fail(2, `domain skill ${skillId} pinned contract drifted from the factory schema (update the SKILL.md block)`);
  }
}

// Method variants (R3): verbatim copy of the P1_6 packaged skill with ONLY
// the SKILL.md frontmatter name line rewritten to the per-step id.
async function materializeMethodVariant(entry) {
  const sourceRoot = path.join(applicationRoot, entry.source);
  const source = await inspectApplicationSkill(sourceRoot);
  const target = stagedSkillRoot(entry.skillId);
  await fs.mkdir(target, { recursive: true });
  const files = [];
  for (const ref of Object.keys(source.files).sort()) {
    const destination = path.join(target, ref);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, source.files[ref], 'utf8');
    files.push(ref);
  }
  const skillFile = path.join(target, 'SKILL.md');
  const original = await fs.readFile(skillFile, 'utf8');
  const nameLine = `name: ${entry.base}`;
  const rewritten = original.replace(nameLine, `name: ${entry.skillId}`);
  if (rewritten === original) fail(2, `method variant ${entry.skillId}: could not rewrite the frontmatter name line of ${entry.source}`);
  await fs.writeFile(skillFile, rewritten, 'utf8');
  return { target, sourceContentHash: source.contentHash, files };
}

const skillProvenance = [];
const proposalSkills = [];
// Stage one skill directory into the deps tree and return its deterministic
// proposal root ('skills/<id>'; the file bytes come from `sourceRoot`).
async function stageSkill(id, sourceRoot) {
  const target = stagedSkillRoot(id);
  await fs.mkdir(target, { recursive: true });
  const source = await inspectApplicationSkill(sourceRoot);
  for (const ref of Object.keys(source.files).sort()) {
    const destination = path.join(target, ref);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, source.files[ref], 'utf8');
  }
  return `skills/${id}`;
}
async function buildWorkSkill(entry) {
  const step = invokeSkillSteps.find((candidate) => candidate.stepId === entry.stepId);
  const factorySchema = step.outputSchema;
  let repoSource;
  let rootDescription;
  if (entry.kind === 'domain-work') {
    repoSource = path.join(applicationRoot, entry.root);
    if (!fss.existsSync(repoSource)) fail(1, `domain-work skill directory missing: ${entry.root}`);
    verifyDomainContract(entry.skillId, await fs.readFile(path.join(repoSource, 'SKILL.md'), 'utf8'), factorySchema);
    rootDescription = entry.root;
  } else if (entry.kind === 'method-variant') {
    await materializeMethodVariant(entry); // stages into the deps tree directly
    rootDescription = `${entry.source} (verbatim, frontmatter name rewritten)`;
  } else {
    fail(1, `unknown managed skill kind for ${entry.stepId}: ${entry.kind}`);
  }
  if (entry.kind !== 'method-variant') await stageSkill(entry.skillId, repoSource);
  const stagedRoot = stagedSkillRoot(entry.skillId);
  const inspected = await inspectApplicationSkill(stagedRoot);
  const lines = inspected.files['SKILL.md'].split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 16 && !line.startsWith('---'));
  const excerpt = lines[0]?.slice(0, 80) ?? fail(2, `skill ${entry.skillId} carries no excerpt-able SKILL.md line`);
  const second = lines[1]?.slice(0, 80) ?? excerpt;
  proposalSkills.push({
    id: entry.skillId,
    root: `skills/${entry.skillId}`,
    contentHash: inspected.contentHash,
    adapter: {
      kind: 'action',
      inputSchema: { type: 'object' },
      outputSchema: factorySchema ?? { type: 'object' },
      scope: ['.'],
      requiredCapabilities: ['skill-host'],
      interaction: 'none',
      sideEffect: 'write',
      controlsApproval: false,
      completion: 'self-report',
      failure: 'repair',
      recovery: 'manual',
      review: {
        status: 'accepted',
        reviewedBy: 'sdd-p2-4-r2-build-source-review',
        contentHash: inspected.contentHash,
        capabilities: [{ id: `${entry.skillId}.work`, file: 'SKILL.md', excerpt }],
        effects: [{ file: 'SKILL.md', excerpt: second }],
      },
    },
  });
  skillProvenance.push({
    id: entry.skillId,
    kind: entry.kind,
    base: entry.base,
    stepId: entry.stepId,
    root: rootDescription,
    contentHash: inspected.contentHash,
    presetOutputSchema: entry.presetOutputSchema === true,
  });
}

// Gate-receipt schema adopted by every extension step (extension steps carry
// no preset outputSchema upstream; the single adapter schema of the bound
// skill id is what the step adopts).
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

async function buildExtensionSkill(extension) {
  const skillId = extension.skillId;
  await stageSkill(skillId, path.join(applicationRoot, 'skills', skillId));
  const inspected = await inspectApplicationSkill(stagedSkillRoot(skillId));
  const lines = inspected.files['SKILL.md'].split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 16 && !line.startsWith('---'));
  const excerpt = lines[0]?.slice(0, 80) ?? fail(2, `extension skill ${skillId} carries no excerpt-able SKILL.md line`);
  const second = lines[1]?.slice(0, 80) ?? excerpt;
  proposalSkills.push({
    id: skillId,
    root: `skills/${skillId}`,
    contentHash: inspected.contentHash,
    adapter: {
      kind: 'action',
      inputSchema: { type: 'object' },
      outputSchema: GATE_RECEIPT_OUTPUT_SCHEMA,
      scope: ['.sdd/delivery/gates'],
      requiredCapabilities: ['skill-host'],
      interaction: 'none',
      sideEffect: 'read',
      controlsApproval: false,
      completion: 'machine-check',
      failure: 'repair',
      recovery: 'manual',
      review: {
        status: 'accepted',
        reviewedBy: 'sdd-p2-4-r2-build-source-review',
        contentHash: inspected.contentHash,
        capabilities: [{ id: `${skillId}.gate`, file: 'SKILL.md', excerpt }],
        effects: [{ file: 'SKILL.md', excerpt: second }],
      },
    },
  });
  skillProvenance.push({
    id: skillId,
    kind: 'extension',
    stepId: `classic.extension.${extension.id}`,
    root: `skills/${skillId} (P1_6 packaged asset)`,
    contentHash: inspected.contentHash,
    presetOutputSchema: false,
  });
}

for (const entry of managed.work) await buildWorkSkill(entry);
for (const extension of composition.extensions) await buildExtensionSkill(extension);

// --- R1: vendored lib/delivery closure + rebased bindings ---------------------
// Bundle the pure SDD.Gate.v1 graph (lib/delivery/gate.js plus its repo-local
// imports) into in-package modules, byte-verbatim except for the rewritten
// relative specifiers (the compiler moduleRef accepts only .mjs/.json refs
// with dot-free path segments). The sources stay the single home of the
// judgment logic; every generated module records its source sha256.
const bundledModules = [];
const commonmarkRef = 'sdd/vendor-commonmark.mjs';
function bundleGraph(entries) {
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
      if (specifier === 'commonmark') { renames.push([specifier, commonmarkRef]); continue; }
      if (!specifier.startsWith('.')) continue; // node builtins stay untouched
      renames.push([specifier, walk(path.resolve(dir, specifier))]);
    }
    for (const [specifier, ref] of renames) {
      let target = path.posix.relative(path.posix.dirname(ownRef), ref);
      if (!target.startsWith('.')) target = `./${target}`;
      source = source.split(`'${specifier}'`).join(`'${target}'`).split(`"${specifier}"`).join(`"${target}"`);
    }
    modules[ownRef] = source;
    bundledModules.push({
      moduleRef: ownRef,
      sourcePath: path.relative(repositoryRoot, real),
      sourceSha256: sha256(fss.readFileSync(real)),
      moduleSha256: sha256(source),
    });
    return ownRef;
  };
  for (const entry of entries) walk(entry);
  return modules;
}
const vendored = bundleGraph([path.join(repositoryRoot, 'lib/delivery/gate.js'), path.join(repositoryRoot, 'lib/adapters/plan-source.js'), path.join(repositoryRoot, 'lib/adapters/comet-host-ports.js')]);
const commonmarkFile = path.join(repositoryRoot, 'node_modules/commonmark/dist/commonmark.min.js');
const commonmarkLicense = path.join(repositoryRoot, 'node_modules/commonmark/LICENSE');
let commonmarkBytes, licenseBytes, packageLock, bundledLicenses;
try {
  commonmarkBytes = fss.readFileSync(commonmarkFile);
  licenseBytes = fss.readFileSync(commonmarkLicense);
  bundledLicenses = ['entities', 'mdurl', 'minimist'].map((name) => fss.readFileSync(path.join(repositoryRoot, 'node_modules', name, 'LICENSE')));
  packageLock = JSON.parse(fss.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
} catch { fail(1, 'the pinned commonmark package and package-lock are required'); }
if (packageLock.packages?.['node_modules/commonmark']?.version !== '0.31.2'
  || sha256(commonmarkBytes) !== '2de0f8ecbca0a6470da57c8b2ad043777ae999c5132f9abf12e8c332d4e46164'
  || sha256(licenseBytes) !== '6cc4b9b28cf68e5bd20f9e94859a85cde35095ef4f9d0f7385b0b6166642f50b'
  || JSON.stringify(bundledLicenses.map(sha256)) !== JSON.stringify(['cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164','6b6a356c4337e2446841f30f3cdf7e7023af8c5260b5e347c0f987b9f6aa2644','435a6722c786b0a56fbe7387028f1d9d3f3a2d0fb615bb8fee118727c3f59b7b'])) fail(1, 'commonmark package does not match the pinned 0.31.2 bytes');
const notices = [licenseBytes, ...bundledLicenses].map((bytes) => bytes.toString('utf8').replaceAll('*/', '* /')).join('\n\n');
const commonmarkModule = `/*\n${notices}\n*/\nconst exports = {}; const module = { exports };\n${commonmarkBytes.toString('utf8')}\nexport const Parser = exports.Parser;\n`;
vendored[commonmarkRef] = commonmarkModule;
bundledModules.push({ moduleRef:commonmarkRef, sourcePath:'node_modules/commonmark/dist/commonmark.min.js', sourceSha256:sha256(commonmarkBytes), moduleSha256:sha256(commonmarkModule) });
const gateModuleRef = 'sdd/lib-delivery-gate.mjs';
const planSourceModuleRef = 'sdd/lib-adapters-plan_source.mjs';
const hostPortsModuleRef = 'sdd/lib-adapters-comet_host_ports.mjs';
if (!vendored[gateModuleRef]) fail(2, `bundler did not produce ${gateModuleRef}; keys: ${Object.keys(vendored).join(', ')}`);
if (!vendored[planSourceModuleRef]) fail(2, `bundler did not produce ${planSourceModuleRef}`);
if (!vendored[hostPortsModuleRef]) fail(2, `bundler did not produce ${hostPortsModuleRef}`);

const bindingsSource = await fs.readFile(path.join(applicationRoot, 'bindings.mjs'), 'utf8');
const REPO_IMPORT = "from '../../../lib/delivery/gate.js'";
const REBASED_IMPORT = `from './${gateModuleRef}'`;
const occurrences = bindingsSource.split(REPO_IMPORT).length - 1;
if (occurrences !== 1) fail(1, `bindings.mjs must carry the pinned lib/delivery import exactly once (found ${occurrences}); update this build`);
const PLAN_IMPORT = "import('../../../lib/adapters/plan-source.js')";
if (bindingsSource.split(PLAN_IMPORT).length !== 2) fail(1, 'bindings.mjs must carry the plan-source import exactly once');
const HOST_PORTS_IMPORT = "from '../../../lib/adapters/comet-host-ports.js'";
if (bindingsSource.split(HOST_PORTS_IMPORT).length !== 2) fail(1, 'bindings.mjs must carry the comet-host-ports import exactly once; update this build');
const embeddedBindings = bindingsSource.split(REPO_IMPORT).join(REBASED_IMPORT)
  .split(PLAN_IMPORT).join(`import('./${planSourceModuleRef}')`)
  .split(HOST_PORTS_IMPORT).join(`from './${hostPortsModuleRef}'`);
// No other repo-escaping import may remain in the embedded module.
for (const match of embeddedBindings.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
  if (!match[1].startsWith('./sdd/')) fail(2, `embedded bindings.mjs still carries a non-vendored relative import: ${match[1]}`);
}

// --- R4: bindings with the upstream work-approval anchor ----------------------
const WORKFLOW_ID = 'comet-classic-full';
const APPROVAL_ANCHOR = 'classic.composition.confirm';
const proposalBindings = [];
for (const entry of managed.work) {
  proposalBindings.push({
    workflowId: WORKFLOW_ID,
    stepId: entry.stepId,
    skillId: entry.skillId,
    capability: `${entry.skillId}.work`,
    usage: 'action',
    authorizationFrom: APPROVAL_ANCHOR,
    authorizationChoices: ['approved'],
  });
}
for (const extension of composition.extensions) {
  proposalBindings.push({
    workflowId: WORKFLOW_ID,
    stepId: `classic.extension.${extension.id}`,
    skillId: extension.skillId,
    capability: `${extension.skillId}.gate`,
    usage: 'action',
  });
}

// --- official compile (scratch world) -----------------------------------------
const projectRoot = path.join(scratch, 'project');
await fs.mkdir(projectRoot, { recursive: true });
const proposal = {
  schema: 'comet.workflow.application.plan.v1',
  manifest: {
    schema: 'comet.workflow.application.v1',
    id: compositionDocument.package.manifestId,
    version: compositionDocument.package.manifestVersion,
    base: 'classic-full',
    runtimeVersion: globalPackage.version,
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    skills: proposalSkills,
    bindings: proposalBindings,
  },
  composition: structuredClone(composition),
  modules: { 'bindings.mjs': embeddedBindings, ...vendored },
};

const prepareRoot = path.join(scratch, 'pkg-prepare');
const compileRoot = path.join(scratch, 'pkg-compile');
let plan;
try {
  plan = await prepareWorkflowApplicationPlan({ proposal, packageRoot: prepareRoot, projectRoot, dependencyRoot: depsRoot });
} catch (error) {
  fail(2, `official compiler REFUSED the composition at prepare: ${error.code ?? 'ERROR'}: ${error.message}`);
}
const compiledWorkflows = plan.workflows.map((workflow) => `${workflow.id}@${workflow.version}`);
if (JSON.stringify(compiledWorkflows) !== JSON.stringify([`${WORKFLOW_ID}@1`])) {
  fail(2, `unexpected compiled workflows: ${compiledWorkflows.join(', ')}`);
}
let compiled;
try {
  compiled = await compileWorkflowApplication({
    plan: structuredClone(plan),
    confirmationHash: hashRuntimeValue(plan),
    packageRoot: compileRoot,
    projectRoot,
    dependencyRoot: depsRoot,
  });
} catch (error) {
  fail(2, `official compiler REFUSED the composition at compile: ${error.code ?? 'ERROR'}: ${error.message}`);
}

// Publish to a new external directory; never remove a pre-existing target.
try { await fs.mkdir(outputRoot, { mode: 0o700 }); }
catch (error) { fail(1, `output unavailable; existing content preserved: ${error.code ?? error.message}`); }
await fs.cp(compileRoot, packageRoot, { recursive: true, force: false, errorOnExist: true });
await fs.mkdir(path.join(outputRoot, 'node_modules', '@rpamis'), { recursive: true });
await fs.symlink(globalRoot, path.join(outputRoot, 'node_modules', '@rpamis', 'comet'), 'dir');

const packageFiles = [];
const walkFiles = async (relative) => {
  for (const entry of (await fs.readdir(path.join(packageRoot, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const ref = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walkFiles(ref);
    else if (entry.isFile()) packageFiles.push(ref);
    else fail(2, `non-regular file in the package: ${ref}`);
  }
};
await walkFiles('');
for (const required of ['SKILL.md', 'application.json', 'application.mjs', 'bindings.mjs', 'installation.json', 'workflow.json', 'rules/workflow-guard.md', 'scripts/comet-run.mjs', 'sdd/lib-delivery-gate.mjs']) {
  if (!packageFiles.includes(required)) fail(2, `compiled package is missing ${required}`);
}
const packagedSkillIds = new Set(packageFiles.filter((ref) => ref.startsWith('skills/')).map((ref) => ref.split('/')[1]));
for (const skill of proposalSkills) {
  if (!packagedSkillIds.has(skill.id)) fail(2, `compiled package is missing the embedded skill directory skills/${skill.id}`);
}

const compileManifest = {
  schema: 'sdd.comet.application.compile-manifest.v1',
  revision: compositionDocument.revision,
  build: { package: globalPackage.name, version: globalPackage.version, packageMetadataSha256: sha256(fss.readFileSync(path.join(globalRoot, 'package.json'))), cliSha256: sha256(fss.readFileSync(realCli)), supplierQualification: 'not-verified' },
  node: process.version,
  compiler: 'prepareWorkflowApplicationPlan + compileWorkflowApplication (official global ESM exports)',
  command: 'node integrations/comet/application/internal/build-application.mjs --out <absolute-external-new-directory>',
  packageRoot: 'package',
  applicationFile: 'package/application.json',
  compositionHash: compiled.compositionHash,
  contentHash: compiled.contentHash,
  workflowHashes: compiled.workflowHashes,
  approvals: {
    anchor: APPROVAL_ANCHOR,
    choices: ['approved'],
    anchoredWorkBindings: managed.work.length,
    readOnlyExtensionBindings: composition.extensions.length,
  },
  bindingsEmbedding: {
    sourceModule: 'integrations/comet/application/bindings.mjs',
    rebaseFrom: REPO_IMPORT,
    rebaseTo: REBASED_IMPORT,
    sourceSha256: sha256(bindingsSource),
    embeddedSha256: sha256(embeddedBindings),
  },
  vendoredModules: bundledModules.sort((a, b) => a.moduleRef.localeCompare(b.moduleRef, 'en')),
  skills: skillProvenance,
  packageFiles,
};
await fs.writeFile(compileManifestFile, `${JSON.stringify(compileManifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

console.log(JSON.stringify({
  built: compileManifest.applicationFile,
  compositionHash: compiled.compositionHash,
  contentHash: compiled.contentHash,
  workflowHashes: compiled.workflowHashes,
  files: packageFiles.length,
  skills: proposalSkills.length,
  vendoredModules: bundledModules.length,
}, null, 2));
// This one-off build retains its own temporary workspace.
