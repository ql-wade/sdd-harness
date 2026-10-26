// P2_4 delivery case, revision 2026-10-26-comet-050-adoption-v1 (ADR-0022):
// the managed delivery gates are expressed as a Comet 0.5.0 native
// classic-full composition application, NOT as the retired 0.4.5 patch chain.
// Rework round P2_4-r2: the composition now REALLY compiles through the
// official compiler (repair list R1-R6, mode-qualification.json), and this
// case pins the compiled package.
//
// What this case proves (mechanism/supply level — no runtime acceptance):
//   1. the composition declares the six gate extensions (R/A/T/P/V/Kp) at
//      exactly the upstream checkpoint whitelist positions, cross-checked
//      against the PRISTINE 0.5.0 source, not against our own copies;
//   2. every invoke_skill step of classic-full is replaced by a DISTINCT
//      per-step managed skill id (R3) that keeps the original stepId and the
//      ORIGINAL output contract (parsed from the pristine full-profile
//      workflow), while machine checks, approvals and archive tool steps stay
//      domain-owned; ponytail stays OUT of the replacements with a recorded
//      boundary (R5);
//   3. bindings.mjs registers exactly the declared validators AND the
//      executor port (R2: context.createSkillExecutor, host contract that
//      refuses automated execution) and every gate verdict is delegated to
//      the real lib/delivery pure components — fail closed on everything else;
//   4. the compiled package exists as a deliverable
//      (integrations/comet/application/package) with pinned fingerprints:
//      application.json/workflow.json/installation.json contents, the
//      upstream work-approval anchor on every write binding (R4), the
//      vendored lib/delivery closure reproducible byte-for-byte from the
//      repository sources with only specifiers rebased (R1), and every
//      packaged skill re-inspected by the official inspectApplicationSkill
//      (link completeness, no symlinks — R6);
//   5. the 0005 Kt patch applies cleanly to the pristine classic-resolver.ts,
//      keeps the old unconditional completion for states without the optional
//      field, and blocks completion only while the knowledge closeout
//      obligation is required and unmet; a corrupted patch is rejected.
//
// What it does NOT claim: real host install/dispatch of the package,
// extension behavior inside a real Run, and the 0005 predicate inside a live
// dispatched Run stay UNVERIFIED (composition.json#unverified; P1_4/P3_2/VERIFY
// waves). This case requires the pinned built distribution under
// .sdd/vendor/comet/<commit>/builds/de39629a…/work (same environment the P1_4
// compile probe and test/delivery-cases/1_3.mjs already require).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLaunchAuthority, admitEvidence } from '../../lib/delivery/evidence.js';
import { evaluate } from '../../lib/delivery/gate.js';
import { classicCompositionStartRequest } from '../../lib/adapters/comet.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const applicationRoot = path.join(projectRoot, 'integrations/comet/application');
const packageRoot = path.join(applicationRoot, 'package');
const patchPath = path.join(projectRoot, 'integrations/comet/patches/0005-comet-050-kt-closeout.patch');
const pristineRoot = path.join(
  projectRoot,
  '.sdd/vendor/comet/aeb1a6598034e28ce46b8422d4dbd8785e607bd7/pristine',
);
const classicApplicationSource = fs.readFileSync(
  path.join(pristineRoot, 'domains/comet-classic/classic-application.ts'),
  'utf8',
);
const classicWorkflowSource = fs.readFileSync(
  path.join(pristineRoot, 'domains/comet-classic/classic-sdk-application.ts'),
  'utf8',
);
const resolverSource = fs.readFileSync(
  path.join(pristineRoot, 'domains/comet-classic/classic-resolver.ts'),
  'utf8',
);
const composition = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'composition.json'), 'utf8'));
const assetsManifest = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'manifest.json'), 'utf8'));
const upstreamLock = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'),
);
const shaBytes = (data) => crypto.createHash('sha256').update(data).digest('hex');
const readText = (relative) => fs.readFileSync(path.join(projectRoot, relative), 'utf8');

const tempRoots = new Set();
after(() => { for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true }); });
function makeTmp(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  tempRoots.add(root);
  return root;
}

// ---- the pinned official build (same world the P1_4 compile probe used) ----

const buildFingerprint = shaBytes(JSON.stringify({
  archive: upstreamLock.source.sha256,
  patches: upstreamLock.patches.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
  toolchain: upstreamLock.toolchain,
}));
const buildDist = path.join(
  projectRoot,
  '.sdd/vendor/comet',
  upstreamLock.source.commit,
  'builds',
  buildFingerprint,
  'work/dist',
);
if (!fs.existsSync(path.join(buildDist, 'domains/workflow-generation/compiler.js'))) {
  throw new Error(
    `pinned built distribution missing: ${path.relative(projectRoot, buildDist)} (fingerprint ${buildFingerprint}); ` +
    'this case pins the compiled package and needs the official compiler of the locked build',
  );
}
const fromBuild = (relative) => pathToFileURL(path.join(buildDist, relative)).href;
const { inspectApplicationSkill } = await import(fromBuild('domains/workflow-application/index.js'));
const { readApplicationFiles, applicationFilesHash } = await import(
  fromBuild('domains/workflow-application/skill-adapter.js')
);
const { defineClassicWorkflowApplication } = await import(
  fromBuild('domains/comet-classic/classic-sdk-application.js')
);
const factory = defineClassicWorkflowApplication('full');
const factoryStep = (stepId) => factory.workflow.steps[stepId];

// ---- upstream facts parsed from the pristine 0.5.0 tree --------------------

// The checkpoint whitelist of createClassicApplication (profile=full):
// resolve `${options.profile}` to 'full'. This is upstream evidence — if the
// whitelist changes upstream, this test re-derives it instead of trusting our
// composition copy.
const checkpointWhitelist = (() => {
  const match = classicApplicationSource.match(/const checkpoints = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, 'pristine classic-application.ts still declares the checkpoint whitelist');
  return new Set(
    [...match[1].matchAll(/[`']([^`']+)[`']/g)].map(([, entry]) =>
      entry.replaceAll('${options.profile}', 'full'),
    ),
  );
})();

// The upstream extension identity rule, quoted from the pristine source.
const extensionIdPattern = /^[a-z][a-z\d]*(?:-[a-z\d]+)*$/u;
assert.match(
  classicApplicationSource,
  /!\/\^\[a-z\]\[a-z\\d\]\*\(\?:-\[a-z\\d\]\+\)\*\$\/u\.test\(extension\.id\)/,
  'pristine source still enforces the extension id pattern this case applies',
);

// Some full-profile steps are keyed by computed variables (openStep,
// evidenceStep, followingStep); their full-profile resolution is asserted
// against the pristine definitions so the block lookup stays upstream truth.
const STEP_KEY_ALIASES = (() => {
  assert.match(
    classicWorkflowSource,
    /const openStep = `\$\{profile\}\.open`;\n\s*const evidenceStep = `\$\{profile\}\.open\.evidence`;\n\s*const followingStep = profile === 'full' \? 'full\.design\.handoff' : `\$\{profile\}\.build\.execute`;/,
    'pristine step-key variables must keep the documented full-profile resolution',
  );
  return new Map([
    ['full.open', 'openStep'],
    ['full.open.evidence', 'evidenceStep'],
    ['full.design.handoff', 'followingStep'],
  ]);
})();

// Extract one workflow step block from the pristine full-profile definition
// (brace-balanced) so replacement assertions read upstream's own contract.
function pristineStepBlock(stepId) {
  const alias = STEP_KEY_ALIASES.get(stepId);
  const start = alias
    ? classicWorkflowSource.indexOf(`[${alias}]: {`)
    : classicWorkflowSource.indexOf(`'${stepId}': {`);
  if (start === -1) return undefined;
  const open = classicWorkflowSource.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < classicWorkflowSource.length; index += 1) {
    const char = classicWorkflowSource[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return classicWorkflowSource.slice(start, index + 1);
    }
  }
  return undefined;
}

// ---- the composition requirements, encoded once -----------------------------

const EXPECTED_GATES = [
  { gate: 'R', extensionId: 'requirements-open', afterStep: 'full.open.evidence' },
  { gate: 'A', extensionId: 'architecture-consensus', afterStep: 'full.design.evidence' },
  { gate: 'T', extensionId: 'test-design-review', afterStep: 'full.design.evidence' },
  { gate: 'P', extensionId: 'build-plan-unique', afterStep: 'full.build.plan.evidence' },
  { gate: 'V', extensionId: 'verify-whitebox', afterStep: 'full.verify.check.evidence' },
  { gate: 'Kp', extensionId: 'knowledge-project-closeout', afterStep: 'full.verify.check.evidence' },
];
// R3: every invoke_skill step binds ONE per-step managed skill id (unique
// across the workflow). `originalRef` is the upstream step ref the pristine
// workflow declares; `kind` follows composition.json managedSkillVariants.
const EXPECTED_REPLACEMENTS = {
  'full.open': { originalRef: 'comet-open', kind: 'domain-work', skillId: 'comet-open-full-open' },
  'full.design.handoff': { originalRef: 'comet-design', kind: 'method-variant', variantBase: 'grill-me', skillId: 'grill-me-full-design-handoff' },
  'full.design.document': { originalRef: 'comet-design', kind: 'method-variant', variantBase: 'grill-me', skillId: 'grill-me-full-design-document' },
  'full.build.configure': { originalRef: 'comet-build', kind: 'domain-work', skillId: 'comet-build-full-build-configure' },
  'full.build.plan': { originalRef: 'comet-build', kind: 'method-variant', variantBase: 'claude-parallel-tdd-planner', skillId: 'claude-parallel-tdd-planner-full-build-plan' },
  'full.build.execute': { originalRef: 'comet-build', kind: 'method-variant', variantBase: 'tdd', skillId: 'tdd-full-build-execute' },
  'full.verify.run': { originalRef: 'comet-verify', kind: 'domain-work', skillId: 'comet-verify-full-verify-run' },
  'full.archive.prepare': { originalRef: 'comet-archive', kind: 'domain-work', skillId: 'comet-archive-full-archive-prepare' },
  'full.archive.deliver': { originalRef: 'comet-archive', kind: 'domain-work', skillId: 'comet-archive-full-archive-deliver' },
};
// Upstream non-replaceable surface: machine checks, approvals and archive
// tool steps never appear in replacements.
const NON_REPLACEABLE_STEPS = [
  'full.build.check',
  'full.verify.check',
  'full.archive.execute',
  'full.archive.confirm',
  'full.open.confirm',
  'full.design.confirm',
  'full.build.confirm',
];
const WORKFLOW_ID = 'comet-classic-full';
const APPROVAL_ANCHOR = 'classic.composition.confirm';
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
// Stable structural comparison (key order independent).
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

function relativeRefProblems(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return 'not a non-empty string';
  if (ref.startsWith('/') || /^[A-Za-z]:/.test(ref)) return 'absolute path';
  if (ref.split(/[\\/]/u).includes('..')) return 'contains ..';
  return null;
}

// ALL structural requirements for the composition source artifact. Both the
// real composition and every negative mutant go through this one checker.
function compositionViolations(doc, validatorRegistry) {
  const problems = [];
  if (doc.schema !== 'sdd.comet.classic-application.composition.v1') problems.push('schema envelope mismatch');
  if (doc.base !== 'classic-full') problems.push('base must be classic-full');
  const compositionBody = doc.composition ?? {};
  if (compositionBody.kind !== 'classic') problems.push('composition.kind must be classic');
  if (compositionBody.profile !== 'full') problems.push('composition.profile must be full');

  const extensions = compositionBody.extensions ?? [];
  const seen = new Map();
  for (const extension of extensions) {
    if (typeof extension.id !== 'string' || !extensionIdPattern.test(extension.id)) {
      problems.push(`extension id violates the upstream identity rule: ${String(extension.id)}`);
    }
    if (seen.has(extension.id)) problems.push(`duplicate extension id: ${extension.id}`);
    seen.set(extension.id, extension);
  }
  for (const expected of EXPECTED_GATES) {
    const extension = seen.get(expected.extensionId);
    if (!extension) {
      problems.push(`missing gate extension ${expected.gate} (${expected.extensionId})`);
      continue;
    }
    if (extension.afterStep !== expected.afterStep) {
      problems.push(
        `gate ${expected.gate} must sit at ${expected.afterStep}, found ${String(extension.afterStep)}`,
      );
    }
    if (!checkpointWhitelist.has(extension.afterStep)) {
      problems.push(`gate ${expected.gate} checkpoint ${String(extension.afterStep)} is not in the pristine whitelist`);
    }
    const refs = extension.artifactRefs;
    if (!Array.isArray(refs) || refs.length === 0) {
      problems.push(`gate ${expected.gate} must pin at least one artifact ref`);
    } else {
      if (new Set(refs).size !== refs.length) problems.push(`gate ${expected.gate} artifact refs are not unique`);
      for (const ref of refs) {
        const problem = relativeRefProblems(ref);
        if (problem) problems.push(`gate ${expected.gate} artifact ref ${String(ref)}: ${problem}`);
      }
    }
    const validator = extension.validator;
    if (!validator || !validatorRegistry?.has(`${validator.id}@${validator.version}`)) {
      problems.push(`gate ${expected.gate} validator ${JSON.stringify(validator)} is not registered by bindings.mjs`);
    }
    if (typeof extension.skillId !== 'string' || extension.skillId.length === 0) {
      problems.push(`gate ${expected.gate} has no executing skill`);
    }
  }
  if (seen.size !== EXPECTED_GATES.length) {
    problems.push(`expected exactly ${EXPECTED_GATES.length} extensions, found ${seen.size}`);
  }
  const order = compositionBody.order;
  if (
    !Array.isArray(order) ||
    order.length !== seen.size ||
    new Set(order).size !== order.length ||
    [...order].some((id) => !seen.has(id))
  ) {
    problems.push('order must list every extension id exactly once');
  } else if (
    // order may only permute within checkpoints: the (id@checkpoint) multiset
    // must be preserved, otherwise an extension moved across checkpoints.
    [...extensions.map((extension) => `${extension.id}@${extension.afterStep}`)].sort().join() !==
    [...order.map((id) => `${id}@${seen.get(id).afterStep}`)].sort().join()
  ) {
    problems.push('order moved an extension across checkpoints');
  }

  // ---- replacements (R3/R5) ----
  const replacements = compositionBody.replacements ?? [];
  const replacedSteps = replacements.map((entry) => entry.stepId);
  for (const stepId of Object.keys(EXPECTED_REPLACEMENTS)) {
    if (!replacedSteps.includes(stepId)) {
      problems.push(
        `missing replacement for ${stepId} (upstream ${EXPECTED_REPLACEMENTS[stepId].originalRef} execution step)`,
      );
    }
  }
  for (const stepId of NON_REPLACEABLE_STEPS) {
    if (replacedSteps.includes(stepId)) {
      problems.push(`non-replaceable domain step ${stepId} must not be replaced`);
    }
  }
  const replacementSkillIds = replacements.map((entry) => entry.skillId);
  if (new Set(replacementSkillIds).size !== replacementSkillIds.length) {
    problems.push('per-step skill ids must be unique across the workflow (one id can never serve two schema-different steps)');
  }
  const variants = doc.managedSkillVariants?.work ?? [];
  for (const replacement of replacements) {
    const expected = EXPECTED_REPLACEMENTS[replacement.stepId];
    if (expected && replacement.skillId !== expected.skillId) {
      problems.push(`step ${replacement.stepId} must bind the managed skill ${expected.skillId}, found ${String(replacement.skillId)}`);
    }
    if (typeof replacement.skillId === 'string' && replacement.skillId.startsWith('ponytail')) {
      problems.push('ponytail re-entered replacements (R5 boundary: not embeddable, removed with a recorded boundary)');
    }
    const variant = variants.find((entry) => entry.stepId === replacement.stepId);
    if (!variant || variant.skillId !== replacement.skillId) {
      problems.push(`no managedSkillVariants entry agrees with the replacement of ${String(replacement.stepId)}`);
    }
    if (expected && variant && variant.kind !== expected.kind) {
      problems.push(`managed skill for ${replacement.stepId} must be of kind ${expected.kind}`);
    }
    const block = pristineStepBlock(replacement.stepId);
    if (!block) {
      problems.push(`replacement stepId ${String(replacement.stepId)} does not exist in the pristine workflow`);
      continue;
    }
    if (!block.includes("type: 'invoke_skill'")) {
      problems.push(`replacement stepId ${replacement.stepId} is not an invoke_skill step (not replaceable upstream)`);
    }
    // full.open and full.design.handoff are keyed by computed variables whose
    // refs are computed too; the alias-resolution assertion above pins the
    // full-profile meaning, so the block must carry either the literal ref or
    // the documented computed form.
    const refForms = [
      `ref: '${expected?.originalRef}'`,
      /ref: profile === 'full' \? 'comet-design' : 'comet-build',/,
      /ref: profile === 'full' \? 'comet-open' : `comet-\$\{profile\}`,/,
    ];
    if (expected && !refForms.some((form) => (form instanceof RegExp ? form.test(block) : block.includes(form)))) {
      problems.push(`replacement stepId ${replacement.stepId} is not a ${expected.originalRef} step`);
    }
    const contract = doc.replacementContracts?.steps?.[replacement.stepId];
    if (!contract || contract.originalSkillRef !== expected?.originalRef) {
      problems.push(`replacement ${replacement.stepId} lacks the preserved output-contract declaration`);
    } else if (contract.outputContract?.preset === false) {
      // Steps without a preset upstream schema pin that fact instead of a
      // required/properties list (the adapter schema is adopted).
      if (factoryStep(replacement.stepId).outputSchema !== undefined) {
        problems.push(`replacement ${replacement.stepId} declares no preset schema but the factory step carries one`);
      }
    } else {
      const pristineRequired = block.match(/required:\s*\[([^\]]*)\]/);
      const requiredKeys = pristineRequired
        ? pristineRequired[1].split(',').map((item) => item.trim().replace(/['"]/g, '')).filter(Boolean)
        : [];
      if (JSON.stringify(requiredKeys) !== JSON.stringify(contract.outputContract.required)) {
        problems.push(
          `replacement ${replacement.stepId} output contract ${JSON.stringify(contract.outputContract.required)} != pristine required ${JSON.stringify(requiredKeys)}`,
        );
      }
      for (const property of contract.outputContract.properties) {
        if (!block.includes(`${property}:`)) {
          problems.push(`replacement ${replacement.stepId} contract names property ${property} absent from the pristine step`);
        }
      }
    }
  }
  return problems;
}

// ---- mini JSON-schema checker for the typed extension declarations ----------

function schemaViolations(schema, value, at = 'declaration') {
  const problems = [];
  if (schema.type === 'object' || schema.properties) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at}: expected object`];
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${at}.${key}: required`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) problems.push(...schemaViolations(sub, value[key], `${at}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) problems.push(`${at}.${key}: undeclared field`);
      }
    }
    return problems;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${at}: expected array`];
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((item, index) => problems.push(...schemaViolations(schema.items, item, `${at}[${index}]`)));
    return problems;
  }
  if (schema.const !== undefined && value !== schema.const) problems.push(`${at}: expected const ${JSON.stringify(schema.const)}`);
  if (schema.enum !== undefined && !schema.enum.includes(value)) problems.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (schema.type === 'string') {
    if (typeof value !== 'string') problems.push(`${at}: expected string`);
    else {
      if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${at}: shorter than ${schema.minLength}`);
      if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) problems.push(`${at}: violates pattern ${schema.pattern}`);
    }
  }
  return problems;
}

// ---- bindings: the real module, the real registry ---------------------------

const bindingsModule = await import(pathToFileURL(path.join(applicationRoot, 'bindings.mjs')).href);
// Repo-side call (lib/adapters/comet-executor.js calls createBindings() with
// no factory context): pure validators only, never a fabricated port.
const repoBindings = await bindingsModule.createBindings();
// Factory-context call: a stub mirroring the official
// WorkflowApplicationFactoryContext.createSkillExecutor wrapper
// (domains/workflow-application/skill-executor.js returns
// { id, capabilities, preflight, supports, execute } around the host).
const stubBindingsList = [{
  workflowId: WORKFLOW_ID,
  stepId: 'full.open',
  skillId: 'comet-open-full-open',
  capability: 'comet-open-full-open.work',
  usage: 'action',
}];
const stubSkills = new Map([['comet-open-full-open', { id: 'comet-open-full-open' }]]);
const executorHosts = [];
const executorContext = {
  manifest: { bindings: stubBindingsList },
  skills: stubSkills,
  createSkillExecutor: (host) => {
    executorHosts.push(host);
    return {
      id: host.id,
      capabilities: host.capabilities,
      preflight: async () => ({}),
      supports: () => true,
      execute: host.invokeSkill,
    };
  },
};
const hostedBindings = await bindingsModule.createBindings(executorContext);
const validatorRegistry = new Map(
  hostedBindings.validators.map((validator) => [`${validator.id}@${validator.version}`, validator]),
);
const packagedSkills = new Set(assetsManifest.skills.map((skill) => skill.name));

// ---- gate payload fixtures (same admission path as test/delivery-gate.test.js)

const INPUT = shaBytes('p2_4-composition-input-r1');
const POLICY_DIGEST = shaBytes('policy/managed-p2_4@r1');
const POLICY = { ref: 'policy/managed-p2_4', digest: POLICY_DIGEST };
const NOW = '2026-10-26T12:00:00.000Z';

function contractFixture(requiredChecks) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'D01', oracle: 'requirements closed and bound before pass' }],
    requiredChecks,
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dir removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: shaBytes('product-r1') }],
  };
}

function envelopeFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateDigest: INPUT,
    caseId: 'c1',
    check: 'unit:node:test',
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: 'exec-verifier-1' },
    environment: 'p2_4-case-env',
    toolchain: 'node v22.13.1',
    executions: { total: 3, valid: 3 },
    result: 'pass',
    evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: shaBytes('tap-output') }],
    expiry: '2026-11-26T00:00:00.000Z',
    ...overrides,
  };
}

function admitOne(launcher, { gate = 'R', execution = 'exec-verifier-1', envelope } = {}) {
  const dispatch = launcher.issueDispatch({
    runnerId: 'runner-1',
    run: 'run-p2_4',
    gate,
    inputDigest: INPUT,
    policyDigest: POLICY_DIGEST,
    attempt: 1,
    epoch: 1,
    role: 'verifier',
    execution,
  });
  const admitted = admitEvidence({
    envelope: envelope ?? envelopeFixture({ execution: { id: execution } }),
    dispatch,
    authority: launcher,
    current: { inputDigest: INPUT, policyDigest: POLICY_DIGEST, environment: 'p2_4-case-env' },
    now: NOW,
  });
  assert.equal(admitted.ok, true, `test setup admission failed: ${admitted.reason ?? ''}`);
  return admitted.entry;
}

function inputsFixture(requiredChecks) {
  return { inputDigest: INPUT, testContract: contractFixture(requiredChecks), builderExecution: 'exec-builder-1' };
}

function extensionInput(gate, evidence, options = {}) {
  return {
    run: options.run ?? { runId: 'run-p2_4' },
    action: options.action ?? { id: 'action-extension-1', stepId: `classic.extension.${gate}` },
    outcome: {
      actionId: 'action-extension-1',
      status: 'succeeded',
      output: {
        verdict: 'pass',
        sourceHash: 'domain-checked',
        artifactHashes: options.artifactHashes ?? {},
        gateEvidence: evidence,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// P2_4-r3 blocker contract helpers (B-①/B-②/B-③, evidence comet-050-run)
//
// The canonical bundle serialization this file and the packaged validators
// MUST agree on byte-for-byte (B-③): recursively key-sorted JSON, 2-space
// indent, trailing newline — a pure function of the judged evidence payload
// and the evaluate() result, with NO epoch-derived or random field.
// ---------------------------------------------------------------------------

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

function canonicalGateBundle(gate, artifactRef, evidence, verdict) {
  return {
    schema: 'sdd.delivery.gate.receipt-bundle.v1',
    kind: 'gate-receipt-bundle',
    gate,
    artifactRef,
    hashBinding: 'artifactHashes',
    writtenBy: 'extension-execution',
    inputs: evidence.inputs,
    receipts: evidence.receipts,
    policy: evidence.policy,
    evaluatedBy: `sdd.delivery.gate.${gate.toLowerCase()}@1 (packaged bindings -> lib/delivery/gate.js evaluate)`,
    verdict: verdict.verdict,
    receipt: verdict.receipt,
  };
}

function canonicalBundleBytes(gate, artifactRef, evidence, verdict) {
  return Buffer.from(`${JSON.stringify(canonicalize(canonicalGateBundle(gate, artifactRef, evidence, verdict)), null, 2)}\n`, 'utf8');
}

function canonicalBundleHash(gate, artifactRef, evidence, verdict) {
  return shaBytes(canonicalBundleBytes(gate, artifactRef, evidence, verdict));
}

// The static artifact ref each gate extension declares (single source:
// composition.json, cross-pinned against bindings.mjs by the B-③ test).
const gateArtifactRef = (gate) => {
  const expected = EXPECTED_GATES.find((entry) => entry.gate === gate);
  const extension = composition.composition.extensions.find((entry) => entry.id === expected.extensionId);
  return extension.artifactRefs[0];
};

// A live-shape passing outcome for one gate: real admission, real evaluate
// pass, canonical artifact hashes (the B-③ contract).
function canonicalPassInput(gate, evidence, verdict) {
  const ref = gateArtifactRef(gate);
  return extensionInput(gate, evidence, {
    artifactHashes: { [ref]: canonicalBundleHash(gate, ref, evidence, verdict) },
  });
}

// ---------------------------------------------------------------------------
// 1. supplier fixtures and cross-artifact pins
// ---------------------------------------------------------------------------

test('composition, bindings, typed declarations, the 0005 patch and the compiled package exist with cross-pinned bytes', () => {
  assert.equal(composition.revision, '2026-10-26-comet-050-adoption-v1');
  assert.equal(composition.runtimeAccepted, false, 'a source artifact must not claim runtime acceptance');
  assert.equal(composition.upstream.commit, upstreamLock.source.commit, 'composition must pin the locked upstream commit');
  assert.equal(composition.upstream.version, upstreamLock.package.version);
  // Supply wave landed (P1_4, controller-granted exception): the lock now
  // carries exactly the 0005 bytes this file pins below — same strength as
  // before, pinned to the post-supply state instead of the pre-supply one.
  assert.deepEqual(upstreamLock.patches, [
    { path: 'integrations/comet/patches/0005-comet-050-kt-closeout.patch', sha256: composition.knowledgeCloseout.patchSha256 },
  ], 'the lock must carry exactly the 0005 Kt closeout patch pinned by this composition');
  const patchBytes = fs.readFileSync(patchPath);
  assert.equal(
    composition.knowledgeCloseout.patchSha256,
    shaBytes(patchBytes),
    'composition pins the exact 0005 patch bytes; silent patch edits break this pin',
  );
  assert.equal(composition.knowledgeCloseout.gate, 'Kt');
  assert.equal(composition.knowledgeCloseout.mechanism, 'upstream-minimal-patch');
  assert.equal(
    composition.knowledgeCloseout.patch,
    'integrations/comet/patches/0005-comet-050-kt-closeout.patch',
  );
  assert.match(composition.knowledgeCloseout.writePath, /NOT IN THIS REVISION/, 'the Kt write path must stay an explicit supply-wave obligation');
  assert.match(
    composition.knowledgeCloseout.lockIntegration,
    /APPLIED BY THE P1_4 SUPPLY RE-LOCK/,
    'the lock integration must state the post-relock truth (0005 in the lock), never silently',
  );
  for (const file of composition.extensionDeclarations.files) {
    assert.ok(fs.existsSync(path.join(applicationRoot, 'extensions', file)), `declaration ${file} missing`);
  }
  assert.ok(fs.statSync(path.join(applicationRoot, 'bindings.mjs')).isFile());
  // The compiled package is a deliverable (R1-R6 rework): its files and
  // fingerprints are pinned by the dedicated tests below.
  for (const required of [
    'application.json',
    'application.mjs',
    'bindings.mjs',
    'installation.json',
    'workflow.json',
    'SKILL.md',
    'rules/workflow-guard.md',
    'scripts/comet-run.mjs',
  ]) {
    assert.ok(fs.statSync(path.join(packageRoot, required)).isFile(), `compiled package missing ${required}`);
  }
  assert.ok(fs.statSync(path.join(applicationRoot, 'internal/compile-manifest.json')).isFile());
});

test('the six gate extensions sit exactly on the pristine checkpoint whitelist (A/T and V/Kp same-checkpoint AND)', () => {
  const problems = compositionViolations(composition, validatorRegistry);
  assert.deepEqual(problems, [], `composition violations: ${problems.join(' | ')}`);
  // Explicit AND semantics evidence: two independent extensions per shared
  // checkpoint, each with its own artifactRefs and validator.
  const designGates = composition.composition.extensions.filter((entry) => entry.afterStep === 'full.design.evidence');
  const verifyGates = composition.composition.extensions.filter((entry) => entry.afterStep === 'full.verify.check.evidence');
  assert.deepEqual(
    designGates.map((entry) => entry.id).sort(),
    ['architecture-consensus', 'test-design-review'],
  );
  assert.deepEqual(
    verifyGates.map((entry) => entry.id).sort(),
    ['knowledge-project-closeout', 'verify-whitebox'],
  );
  assert.notEqual(
    designGates[0].artifactRefs[0],
    designGates[1].artifactRefs[0],
    'A and T must pin independent artifact bundles',
  );
  assert.notEqual(
    verifyGates[0].validator.id,
    verifyGates[1].validator.id,
    'V and Kp must be judged by independent validators',
  );
});

test('every invoke_skill step is replaced by a distinct per-step managed skill keeping the ORIGINAL output contract (R3)', () => {
  const problems = compositionViolations(composition, validatorRegistry);
  assert.deepEqual(problems, []);
  const replacements = composition.composition.replacements;
  assert.deepEqual(
    [...replacements.map((entry) => entry.stepId)].sort(),
    Object.keys(EXPECTED_REPLACEMENTS).sort(),
    'replacements must cover exactly the nine invoke_skill steps of classic-full',
  );
  const ids = replacements.map((entry) => entry.skillId);
  assert.equal(new Set(ids).size, ids.length, 'per-step skill ids must be pairwise distinct');
  // Upstream non-replaceable surface stays untouched.
  for (const forbidden of NON_REPLACEABLE_STEPS) {
    assert.ok(!replacements.some((entry) => entry.stepId === forbidden), `${forbidden} must stay domain-owned`);
  }
  // Every replaced step is still an invoke_skill step upstream, and the
  // per-step id derivation is the declared base+step-slug shape.
  for (const [stepId, expected] of Object.entries(EXPECTED_REPLACEMENTS)) {
    const block = pristineStepBlock(stepId);
    assert.ok(block, `pristine still defines ${stepId}`);
    assert.match(block, /type: 'invoke_skill'/);
    const declared = replacements.find((entry) => entry.stepId === stepId);
    assert.equal(declared.skillId, expected.skillId);
    const base = expected.variantBase ?? expected.originalRef;
    const slug = stepId.replace(/[^\w]+/g, '-').replace(/-+/g, '-');
    assert.equal(declared.skillId, `${base}-${slug}`, `the per-step id must be the declared base+slug derivation`);
  }
  // R5 boundary: ponytail is gone from the replacements and the boundary is recorded.
  assert.equal(composition.removedReplacements.stepId, 'full.build.configure');
  assert.equal(composition.removedReplacements.skillId, 'ponytail');
  assert.match(composition.removedReplacements.reason, /benchmarks\/results\/2026-10-07-agentic\.md/);
  assert.ok(ids.every((id) => !id.startsWith('ponytail')), 'no ponytail id may remain bound');
});

test('extension skills are real P1_6 packaged assets; work skills are managed domain/variant assets with no retired tokens', () => {
  const used = new Set([
    ...composition.composition.extensions.map((entry) => entry.skillId),
  ]);
  assert.ok(used.size > 0);
  for (const skillId of used) {
    assert.ok(packagedSkills.has(skillId), `extension skill ${skillId} is not in the P1_6 packaged manifest`);
    const skillRoot = path.join(applicationRoot, 'skills', skillId);
    assert.ok(fs.statSync(skillRoot).isDirectory(), `packaged asset directory missing for ${skillId}`);
    assert.ok(fs.existsSync(path.join(skillRoot, 'SKILL.md')), `packaged skill ${skillId} has no SKILL.md`);
  }
  // Domain-work skills are authored managed directories with a pinned
  // original output contract; method-variant skills derive from packaged
  // assets and are pinned inside the compiled package (see the package tests).
  for (const entry of composition.managedSkillVariants.work) {
    if (entry.kind !== 'domain-work') continue;
    const root = path.join(applicationRoot, entry.root);
    assert.ok(fs.statSync(root).isDirectory(), `domain-work skill missing: ${entry.root}`);
    assert.ok(fs.existsSync(path.join(root, 'SKILL.md')));
    const blocks = [...fs.readFileSync(path.join(applicationRoot, entry.root, 'SKILL.md'), 'utf8').matchAll(/```json\r?\n([\s\S]*?)```/g)];
    const factorySchema = factoryStep(entry.stepId).outputSchema;
    if (factorySchema === undefined) {
      assert.equal(blocks.length, 0, `${entry.skillId} must not pin a contract for a schema-less step`);
    } else {
      assert.equal(blocks.length, 1, `${entry.skillId} pins exactly its original output contract`);
      assert.equal(
        stable(JSON.parse(blocks[0][1])),
        stable(factorySchema),
        `${entry.skillId} pinned contract drifted from the pristine factory schema`,
      );
    }
  }
  for (const token of assetsManifest.naming_rule.retired_tokens) {
    for (const entry of fs.readdirSync(path.join(applicationRoot, 'skills'))) {
      assert.ok(
        !entry.toLowerCase().includes(token.toLowerCase()),
        `retired token ${token} re-entered the packaged assets as ${entry}`,
      );
    }
    for (const entry of fs.readdirSync(path.join(applicationRoot, 'internal/domain-skills'))) {
      assert.ok(
        !entry.toLowerCase().includes(token.toLowerCase()),
        `retired token ${token} re-entered the managed domain skills as ${entry}`,
      );
    }
  }
});

test('typed extension declarations match the composition and validate against the declaration schema', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'extensions/schema.json'), 'utf8'));
  const byId = new Map(composition.composition.extensions.map((entry) => [entry.id, entry]));
  for (const file of composition.extensionDeclarations.files) {
    const declaration = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'extensions', file), 'utf8'));
    const problems = schemaViolations(schema, declaration);
    assert.deepEqual(problems, [], `${file} schema violations: ${problems.join(' | ')}`);
    const compilerShaped = byId.get(declaration.id);
    assert.ok(compilerShaped, `${file} declares unknown extension ${declaration.id}`);
    assert.equal(declaration.afterStep, compilerShaped.afterStep, `${file} afterStep drifted from composition`);
    assert.equal(declaration.skillId, compilerShaped.skillId, `${file} skillId drifted from composition`);
    assert.deepEqual(
      declaration.artifactRefs.map((entry) => entry.ref),
      compilerShaped.artifactRefs,
      `${file} artifactRefs drifted from composition`,
    );
    assert.deepEqual(declaration.validator, compilerShaped.validator, `${file} validator drifted from composition`);
    assert.ok(declaration.semantics.length >= 20, `${file} must declare its gate semantics`);
    assert.match(declaration.judgment, /lib\/delivery\/gate\.js/, `${file} must name the pure judgment owner`);
    assert.equal(declaration.bindings, 'integrations/comet/application/bindings.mjs');
    const expectedGate = EXPECTED_GATES.find((entry) => entry.extensionId === declaration.id);
    assert.equal(declaration.gate, expectedGate.gate, `${file} gate identity mismatch`);
  }
});

// ---------------------------------------------------------------------------
// 2. bindings: delegation to lib/delivery, fail-closed on everything else
// ---------------------------------------------------------------------------

test('createBindings registers exactly the declared validators and, under a factory context, the executor port (R2)', async () => {
  assert.deepEqual(Object.keys(repoBindings).sort(), ['validators']);
  assert.deepEqual(Object.keys(hostedBindings).sort(), ['executors', 'validators']);
  assert.equal(repoBindings.validators.length, EXPECTED_GATES.length);
  const declared = composition.composition.extensions.map((entry) => `${entry.validator.id}@${entry.validator.version}`);
  const registered = repoBindings.validators.map((entry) => `${entry.id}@${entry.version}`);
  assert.deepEqual([...declared].sort(), [...registered].sort(), 'declared and registered validator sets must be identical');
  for (const validator of repoBindings.validators) {
    assert.equal(typeof validator.validate, 'function', `${validator.id} must expose validate`);
  }
  // The delegation seam itself: bindings.mjs imports the real pure component
  // and carries no verdict logic of its own.
  const bindingsSource = fs.readFileSync(path.join(applicationRoot, 'bindings.mjs'), 'utf8');
  assert.match(bindingsSource, /from '\.\.\/\.\.\/\.\.\/lib\/delivery\/gate\.js'/);
  assert.match(bindingsSource, /\bevaluate\(/);

  // The executor port: exactly one, officially wrapped, compile-probe
  // sufficient (truthy preflight, executable execute, supports, capabilities
  // covering the required 'skill-host').
  assert.equal(hostedBindings.executors.length, 1);
  const port = hostedBindings.executors[0];
  assert.equal(port.id, 'sdd-managed-skill-host');
  assert.ok(port.capabilities.includes('skill-host'));
  assert.equal(typeof port.preflight, 'function');
  assert.equal(typeof port.execute, 'function');
  assert.equal(port.supports({ type: 'invoke_skill' }), true);
  // Host contract semantics: refuse automated execution, authorize only
  // bindings the loaded application actually declared with a pinned skill.
  assert.equal(executorHosts.length, 1);
  const host = executorHosts[0];
  assert.equal(
    await host.authorize({ binding: stubBindingsList[0], skill: stubSkills.get('comet-open-full-open') }),
    true,
    'a declared binding resolved to a pinned skill authorizes',
  );
  assert.equal(
    await host.authorize({
      binding: { workflowId: WORKFLOW_ID, stepId: 'full.open', skillId: 'ghost-skill', usage: 'action' },
      skill: stubSkills.get('comet-open-full-open'),
    }),
    false,
    'an undeclared skill id never authorizes',
  );
  assert.equal(await host.authorize({}), false, 'a bindingless request never authorizes');
  await assert.rejects(
    () => port.execute({ skill: { id: 'comet-open-full-open' } }),
    /never auto-executes managed skills/,
    'the port must refuse automated execution (the real host loads the pinned SKILL.md)',
  );
});

test('a claimed extension pass is accepted only when the real SDD.Gate.v1 evaluation passes (per gate)', async () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher);
  const inputs = inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]);
  for (const expected of EXPECTED_GATES) {
    const validator = validatorRegistry.get(
      `${composition.composition.extensions.find((item) => item.id === expected.extensionId).validator.id}@1`,
    );
    const evidence = { gate: expected.gate, inputs, receipts: [entry], policy: POLICY };
    const verdict = evaluate(inputs, [entry], POLICY);
    const decision = await validator.validate(canonicalPassInput(expected.gate, evidence, verdict));
    assert.deepEqual(decision, { accepted: true }, `${expected.gate} must accept a genuinely covered payload`);
  }
  // Delegation equivalence: the same payload judged directly by the pure gate.
  assert.equal(evaluate(inputs, [entry], POLICY).verdict, 'pass');
});

test('bindings fail closed: no payload, cross-gate replay, blocked coverage, tampered receipt, refused judgment', async () => {
  const rValidator = validatorRegistry.get('sdd.delivery.gate.r@1');
  const vValidator = validatorRegistry.get('sdd.delivery.gate.v@1');
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher, { gate: 'R' });

  // No gateEvidence payload at all.
  const empty = await rValidator.validate({
    outcome: { status: 'succeeded', output: { verdict: 'pass', sourceHash: 'x', artifactHashes: {} } },
  });
  assert.equal(empty.accepted, false);
  assert.match(empty.reason, /no gateEvidence payload/);

  // Cross-gate replay: an R payload cannot satisfy the V extension.
  const replay = await vValidator.validate(
    extensionInput('V', { gate: 'R', inputs: inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), receipts: [entry], policy: POLICY }),
  );
  assert.equal(replay.accepted, false);
  assert.match(replay.reason, /bound to gate R/);

  // Blocked coverage: a required capability with no receipt never passes.
  const blocked = await rValidator.validate(
    extensionInput('R', {
      gate: 'R',
      inputs: inputsFixture([{ level: 'unit', capability: 'unit:node:test' }, { level: 'ui', capability: 'console' }]),
      receipts: [entry],
      policy: POLICY,
    }),
  );
  assert.equal(blocked.accepted, false);
  assert.match(blocked.reason, /SDD gate R blocked: .*MISSING_OBSERVATION/);

  // Tampered receipt: mutating the admitted entry content is rejected inside
  // the delegated evaluation, not by local logic.
  const tampered = structuredClone(entry);
  tampered.envelope.result = 'fail';
  const tamperDecision = await rValidator.validate(
    extensionInput('R', { gate: 'R', inputs: inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), receipts: [tampered], policy: POLICY }),
  );
  assert.equal(tamperDecision.accepted, false);
  assert.match(tamperDecision.reason, /TAMPERED_RECEIPT/);

  // Refused judgment: a malformed test contract makes the gate throw; the
  // validator surfaces the refusal instead of guessing.
  const refused = await rValidator.validate(
    extensionInput('R', { gate: 'R', inputs: { inputDigest: INPUT, testContract: { schemaVersion: 999 }, builderExecution: 'exec-builder-1' }, receipts: [entry], policy: POLICY }),
  );
  assert.equal(refused.accepted, false);
  assert.match(refused.reason, /refused to judge/);
});

// ---------------------------------------------------------------------------
// 2b. P2_4-r3 upstream blockers B-①/B-②/B-③ (pilot evidence comet-050-run)
// ---------------------------------------------------------------------------

test('B-① managed start: the start request carries a canonical initialState with isolation=current; the null-isolation configure deadlock is unreachable through the managed face', () => {
  // Three-sided upstream deadlock proof from the pristine 0.5.0 source: with
  // state.isolation=null the configure step can never be passed.
  const configureBlock = pristineStepBlock('full.build.configure');
  assert.ok(configureBlock, 'the pristine workflow still declares full.build.configure');
  // (a) the step validator demands non-null state isolation and output parity.
  assert.match(
    classicWorkflowSource,
    /!output \|\|\s*\n\s*!state\.isolation \|\|/,
    'the buildConfigurationValidator must still refuse outcomes while state.isolation is null',
  );
  // (b) the step output schema forbids null isolation (no echo-null escape).
  assert.match(
    configureBlock,
    /isolation: \{ enum: \['current', 'branch', 'worktree'\] \}/,
    'the configure output schema must still forbid null isolation',
  );
  // (c) the confirm transition refuses null isolation and refuses failed
  // configures, and the factory workflow carries no definition initialState
  // (so a definition-side default cannot exist through the compile seam).
  assert.match(
    classicWorkflowSource,
    /state\.isolation === null \|\|/,
    'the confirm transition must still throw on null isolation',
  );
  assert.match(
    classicWorkflowSource,
    /Classic Build configuration did not succeed/,
    'a failed configure outcome must still be refused by the transition',
  );
  assert.equal(factory.workflow.initialState, undefined, 'the classic factory workflow declares no definition initialState');

  // The schema-legal-but-dead pin: null isolation PARSES against the pristine
  // stateSchema (the deadlock is not caught at start).
  assert.deepEqual(
    schemaViolations(factory.workflow.stateSchema, { ...canonicalManagedInitialState(), isolation: null }, 'initialState'),
    [],
    'null isolation is schema-legal at start — exactly why the deadlock was silent',
  );

  // The managed face: the adapter start request builder now ALWAYS constructs
  // the canonical initialState with isolation 'current'.
  const CHANGE = 'p24-r3-start-probe';
  const start = classicCompositionStartRequest({
    change: CHANGE,
    changeDir: `openspec/changes/${CHANGE}`,
    workflowId: WORKFLOW_ID,
    workflowVersion: '1',
    baseRef: '8be26dc13a20732c1497ae708693ffca7a071ffd',
    createdAt: '2026-10-26',
  });
  assert.equal(start.initialState.isolation, 'current', 'the managed start must carry isolation=current');
  assert.deepEqual(
    schemaViolations(factory.workflow.stateSchema, start.initialState, 'initialState'),
    [],
    'the managed initialState must satisfy the pristine full-profile stateSchema',
  );

  // The composition package declares the same start contract (P2_4 Owns
  // face): declaration and adapter constructor must agree field-for-field on
  // the default construction; the two provenance fields are the only
  // refinable ones.
  const declared = composition.startContract;
  assert.ok(declared, 'composition.json declares the managed start contract');
  assert.equal(declared.initialState.isolation, 'current');
  const defaultStart = classicCompositionStartRequest({
    change: CHANGE,
    changeDir: `openspec/changes/${CHANGE}`,
    workflowId: WORKFLOW_ID,
    workflowVersion: '1',
  });
  assert.deepEqual(Object.keys(declared.initialState).sort(), Object.keys(defaultStart.initialState).sort());
  for (const [key, value] of Object.entries(declared.initialState)) {
    assert.deepEqual(defaultStart.initialState[key], value, `startContract.${key} must equal the constructed initialState`);
  }
  assert.equal(start.initialState.baseRef, '8be26dc13a20732c1497ae708693ffca7a071ffd', 'baseRef is the one refinable provenance field');
  assert.equal(start.initialState.isolation, 'current', 'isolation is never refinable');
  assert.deepEqual(
    schemaViolations(factory.workflow.stateSchema, declared.initialState, 'startContract.initialState'),
    [],
    'the declared start contract must itself satisfy the pristine stateSchema',
  );

  // Fail closed: a caller cannot smuggle a null-isolation (or any foreign)
  // initialState through the managed constructor.
  assert.throws(
    () => classicCompositionStartRequest({
      change: CHANGE,
      changeDir: `openspec/changes/${CHANGE}`,
      workflowId: WORKFLOW_ID,
      workflowVersion: '1',
      initialState: { isolation: null },
    }),
    (error) => error.code === 'START_STATE_CONSTRUCTED',
    'the constructor derives the initialState itself and refuses caller-supplied state',
  );
});

// The canonical managed initialState field set, mirroring the live-proven
// pilot start (r2/r3) minus the deadlock: isolation fixed to 'current'.
function canonicalManagedInitialState() {
  return {
    workflow: 'full', language: 'en', phase: 'open', contextCompression: 'off',
    buildMode: null, buildPause: null, subagentDispatch: null, tddMode: null,
    reviewMode: 'standard', isolation: 'current', boundBranch: null, verifyMode: null,
    autoTransition: true, baseRef: null, designDoc: null, plan: null,
    verifyResult: 'pending', verifyFailures: 0, checkEpoch: 0, verificationReport: null,
    branchStatus: 'pending', createdAt: null, verifiedAt: null,
    archiveConfirmation: null, archived: false, directOverride: null,
    handoffContext: null, handoffHash: null, classicProfile: 'full', classicMigration: 1,
  };
}

test('B-② evidence dispatch: submissionIds are epoch-qualified and content-derived; the packaged validators refuse stale, colliding and cross-epoch activation bindings', async () => {
  const adaptersModule = await import(pathToFileURL(path.join(projectRoot, 'lib/adapters/comet.js')).href);
  const classicCompositionRecordEvidenceRequest = adaptersModule.classicCompositionRecordEvidenceRequest;
  assert.equal(typeof classicCompositionRecordEvidenceRequest, 'function', 'the adapter face must construct record-evidence dispatch requests (B-②)');
  const base = {
    change: 'p24-r3-evidence-probe',
    expectedRevision: 7,
    evidenceId: 'wait-plan-evidence-1',
    kind: 'classic-build-plan',
    ref: 'docs/superpowers/plans/p24-r3-evidence-probe.md',
    contentHash: shaBytes('plan-bytes-r3'),
  };
  // The adapter derives the submissionId itself: epoch-qualified and derived
  // from the content it names, deterministic within one epoch, distinct
  // across epochs (the P3_2 collision class).
  const epoch4 = classicCompositionRecordEvidenceRequest({ ...base, checkEpoch: 4 });
  const epoch5 = classicCompositionRecordEvidenceRequest({ ...base, checkEpoch: 5 });
  const epoch4again = classicCompositionRecordEvidenceRequest({ ...base, checkEpoch: 4 });
  assert.match(epoch4.submissionId, /epoch-4/u, 'the submissionId must carry the dispatch epoch');
  assert.notEqual(epoch4.submissionId, epoch5.submissionId, 'submissionIds must differ across epochs');
  assert.equal(epoch4.submissionId, epoch4again.submissionId, 'the submissionId is deterministic within one epoch+content');
  assert.match(epoch4.submissionId, /[0-9a-f]{16}$/u, 'the submissionId derives from the evidence content');
  // The request carries exactly the upstream record-evidence operation fields.
  assert.deepEqual(
    Object.keys(epoch4).sort(),
    ['contentHash', 'evidenceId', 'expectedRevision', 'kind', 'operation', 'ref', 'runId', 'submissionId'],
  );
  assert.equal(epoch4.operation, 'record-evidence');
  assert.equal(epoch4.runId, base.change);
  // Fail closed: a raw caller submissionId is refused (no injection face).
  assert.throws(
    () => classicCompositionRecordEvidenceRequest({ ...base, checkEpoch: 4, submissionId: 'p32-reused-id' }),
    (error) => error.code === 'SUBMISSION_ID_DERIVED',
  );
  assert.throws(
    () => classicCompositionRecordEvidenceRequest({ ...base }),
    (error) => error.code === 'CHECK_EPOCH_REQUIRED',
    'an epoch-less evidence request reproduces the collision class and must be refused',
  );
  assert.throws(
    () => classicCompositionRecordEvidenceRequest({ ...base, checkEpoch: 4, contentHash: 'not-a-digest' }),
    (error) => error.code === 'EVIDENCE_INPUT_INVALID',
  );

  // The packaged validators guard the activation binding (defense in depth:
  // even a raw dispatch request cannot record a stale-bound pass).
  const rValidator = validatorRegistry.get('sdd.delivery.gate.r@1');
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher, { gate: 'R' });
  const evidence = { gate: 'R', inputs: inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), receipts: [entry], policy: POLICY };
  const verdict = evaluate(evidence.inputs, evidence.receipts, evidence.policy);
  assert.equal(verdict.verdict, 'pass');
  const ref = gateArtifactRef('R');
  const hashes = { [ref]: canonicalBundleHash('R', ref, evidence, verdict) };
  const waitOf = (sequence, submissionId, contentHash = shaBytes('open-artifacts'), refName = 'openspec/changes/p24-r3-evidence-probe/proposal.md') => ({
    id: `wait-${sequence}`, stepId: 'full.open.evidence', sequence, status: 'resolved',
    receipt: { ref: refName, contentHash, submissionId },
  });
  const sourceEvent = {
    kind: 'evidence-recorded', stepId: 'full.open.evidence', evidenceKind: 'classic-open-artifacts',
    ref: 'openspec/changes/p24-r3-evidence-probe/proposal.md', contentHash: shaBytes('open-artifacts'),
    submissionId: 'open-ev-epoch-5',
  };
  const liveRun = (waits, checkEpoch = 5) => ({
    runId: 'run-p2_4',
    state: { ...canonicalManagedInitialState(), checkEpoch },
    evidenceWaits: waits,
  });
  const liveAction = (source) => ({
    id: 'action-extension-1', stepId: 'classic.extension.requirements-open',
    input: { activation: { source } },
  });

  // (a) A current-epoch, unambiguous binding is accepted.
  const current = await rValidator.validate(extensionInput('R', evidence, {
    run: liveRun([waitOf(10, 'open-ev-epoch-4'), waitOf(38, 'open-ev-epoch-5')]),
    action: liveAction({ event: sourceEvent, sequence: 38, checkEpoch: 5 }),
    artifactHashes: hashes,
  }));
  assert.deepEqual(current, { accepted: true }, 'a current, unambiguous activation binding must pass');

  // (b) submissionId collision across waits (the exact P3_2 defect): refused.
  const collision = await rValidator.validate(extensionInput('R', evidence, {
    run: liveRun([waitOf(10, 'open-ev-epoch-5'), waitOf(38, 'open-ev-epoch-5')]),
    action: liveAction({ event: sourceEvent, sequence: 38, checkEpoch: 5 }),
    artifactHashes: hashes,
  }));
  assert.equal(collision.accepted, false, 'a colliding submissionId must never yield a recorded pass');
  assert.match(collision.reason, /colliding submissionId|ambiguous/u);

  // (c) Stale binding: a NEWER resolved wait of the same checkpoint exists —
  // the activation points at a superseded epoch's evidence.
  const stale = await rValidator.validate(extensionInput('R', evidence, {
    run: liveRun([waitOf(10, 'open-ev-epoch-3'), waitOf(38, 'open-ev-epoch-4'), waitOf(63, 'open-ev-epoch-5')]),
    action: liveAction({ event: { ...sourceEvent, submissionId: 'open-ev-epoch-4' }, sequence: 38, checkEpoch: 5 }),
    artifactHashes: hashes,
  }));
  assert.equal(stale.accepted, false, 'an activation bound to a superseded evidence wait must be refused');
  assert.match(stale.reason, /superseded|stale/u);

  // (d) Cross-epoch activation: the source epoch is behind the run state.
  const crossEpoch = await rValidator.validate(extensionInput('R', evidence, {
    run: liveRun([waitOf(10, 'open-ev-epoch-4')], 5),
    action: liveAction({ event: { ...sourceEvent, submissionId: 'open-ev-epoch-4' }, sequence: 10, checkEpoch: 4 }),
    artifactHashes: hashes,
  }));
  assert.equal(crossEpoch.accepted, false, 'a pass from a stale checkEpoch must be refused');
  assert.match(crossEpoch.reason, /epoch/u);
});

test('B-③ content-address stability: identical judged evidence must bind identical per-gate bundle bytes — the revise-loop rewrite that orphaned the pilot P pass is refused at record time', async () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher);
  const inputs = inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]);
  const rValidator = validatorRegistry.get('sdd.delivery.gate.r@1');
  const evidence = { gate: 'R', inputs, receipts: [entry], policy: POLICY };
  const verdict = evaluate(inputs, [entry], POLICY);
  assert.equal(verdict.verdict, 'pass');
  const ref = gateArtifactRef('R');
  const stepId = 'classic.extension.requirements-open';

  // A first recorded pass on the run (succeeded action with a pass output).
  const firstHash = canonicalBundleHash('R', ref, evidence, verdict);
  const recordedPassRun = {
    runId: 'run-p2_4',
    state: { ...canonicalManagedInitialState(), checkEpoch: 4 },
    actions: [{
      id: 'action-extension-round1', stepId, status: 'succeeded',
      outcome: { output: { verdict: 'pass', sourceHash: 'domain-checked', artifactHashes: { [ref]: firstHash }, gateEvidence: evidence } },
    }],
  };

  // (a) The SAME evidence re-bound in a LATER epoch to the SAME bytes: the
  // byte-stable re-run of the pilot's final workaround — accepted.
  const stable = await rValidator.validate(extensionInput('R', evidence, {
    run: recordedPassRun,
    action: { id: 'action-extension-round2', stepId },
    artifactHashes: { [ref]: firstHash },
  }));
  assert.deepEqual(stable, { accepted: true }, 'a byte-stable same-evidence re-run must record');

  // (b) The SAME evidence re-bound to DIVERGING bytes (the pilot class: the
  // round-2 bundle embedded epoch/random fields, 536b5b49…→60c9ac68…):
  // refused fail-closed at record time with the precise reason.
  const divergedHash = shaBytes(Buffer.concat([canonicalBundleBytes('R', ref, evidence, verdict), Buffer.from('epoch-5-rebuild')]));
  const diverged = await rValidator.validate(extensionInput('R', evidence, {
    run: recordedPassRun,
    action: { id: 'action-extension-round2', stepId },
    artifactHashes: { [ref]: divergedHash },
  }));
  assert.equal(diverged.accepted, false, 'a same-evidence diverging rewrite must be refused before it orphans the earlier pass');
  assert.match(diverged.reason, /diverging .*bytes|content-address/u);
  assert.match(diverged.reason, /stable for unchanged evidence|epoch-derived/u);

  // (c) GENUINELY CHANGED evidence (a real revise: new receipts/policy) may
  // bind new bytes — the guard constrains only identical evidence.
  const entry2 = admitOne(launcher, { gate: 'R', execution: 'exec-verifier-2' });
  const changedEvidence = { gate: 'R', inputs, receipts: [entry, entry2], policy: POLICY };
  const changedVerdict = evaluate(changedEvidence.inputs, changedEvidence.receipts, changedEvidence.policy);
  assert.equal(changedVerdict.verdict, 'pass');
  const changed = await rValidator.validate(extensionInput('R', changedEvidence, {
    run: recordedPassRun,
    action: { id: 'action-extension-round2', stepId },
    artifactHashes: { [ref]: canonicalBundleHash('R', ref, changedEvidence, changedVerdict) },
  }));
  assert.deepEqual(changed, { accepted: true }, 'a genuinely changed gate judgment records new bytes legitimately');

  // (d) The write protocol the pilot converged on (byte-stable canonical
  // serialization) reproduces IDENTICAL bytes in any epoch: the hash is a
  // pure function of the judged evidence — no epoch input exists.
  assert.equal(
    canonicalBundleHash('R', ref, evidence, { ...verdict, receipt: structuredClone(verdict.receipt) }),
    firstHash,
    'the canonical bundle hash is deterministic over the judged payload',
  );

  // The declared contract: every typed extension declaration and the
  // composition document declare the content-address stability scheme, and
  // the declaration refs, the composition refs and the packaged validator
  // refs are the same three-way pin.
  assert.ok(composition.gateArtifactContract, 'composition.json declares the gate artifact contract');
  assert.match(composition.gateArtifactContract.scheme, /^content-address-stable-v1/u);
  assert.match(composition.gateArtifactContract.scheme, /IDENTICAL judged evidence/u);
  assert.match(composition.gateArtifactContract.contract, /deep-equals an earlier recorded pass/u);
  assert.match(composition.gateArtifactContract.writeProtocol, /recursively key-sorted/u);
  assert.match(
    composition.gateArtifactContract.motivation,
    /epoch/i,
    'the contract must record the revise-loop blocker it eliminates',
  );
  for (const expected of EXPECTED_GATES) {
    const declared = JSON.parse(readText(`integrations/comet/application/extensions/${expected.extensionId}.json`));
    assert.equal(declared.artifactRefs[0].contentAddressing.scheme, 'content-address-stable-v1');
    assert.match(declared.artifactRefs[0].contentAddressing.stability, /identical judged evidence/u);
    assert.deepEqual(
      declared.artifactRefs[0].contentAddressing.writeProtocolFields,
      ['schema', 'kind', 'gate', 'artifactRef', 'hashBinding', 'writtenBy', 'inputs', 'receipts', 'policy', 'evaluatedBy', 'verdict', 'receipt'],
    );
    // three-way ref agreement: declaration == composition == packaged validator pin
    assert.equal(declared.artifactRefs[0].ref, gateArtifactRef(expected.gate));
  }
  const bindingsSource = fs.readFileSync(path.join(applicationRoot, 'bindings.mjs'), 'utf8');
  for (const expected of EXPECTED_GATES) {
    assert.ok(
      bindingsSource.includes(gateArtifactRef(expected.gate)),
      `bindings.mjs pins the declared artifactRef of gate ${expected.gate}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. the compiled package (official compiler output, pinned)
// ---------------------------------------------------------------------------

const compileManifest = JSON.parse(readText('integrations/comet/application/internal/compile-manifest.json'));
const applicationJson = JSON.parse(readText('integrations/comet/application/package/application.json'));
const installationJson = JSON.parse(readText('integrations/comet/application/package/installation.json'));
const workflowDefinition = JSON.parse(readText('integrations/comet/application/package/workflow.json'));

function walkPackageFiles(relative = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(packageRoot, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const ref = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkPackageFiles(ref));
    else out.push(ref);
  }
  return out;
}
const packageFileSet = new Set(walkPackageFiles());

test('the package on disk is byte-identical to the officially compiled plan (drift detector)', async () => {
  // Recompute the official content hash over the real on-disk package files:
  // any single byte change anywhere in the deliverable breaks this pin.
  const files = await readApplicationFiles(packageRoot);
  assert.deepEqual(
    [...Object.keys(files)].sort(),
    [...packageFileSet].sort(),
    'the walked package files must be exactly the files the official reader accepts',
  );
  assert.equal(
    applicationFilesHash(files),
    compileManifest.contentHash,
    'package content hash drifted from the compile manifest; rebuild deliberately and update the manifest',
  );
  assert.equal(installationJson.recovery.compositionHash, compileManifest.compositionHash);
  assert.deepEqual(installationJson.workflowHashes, compileManifest.workflowHashes);
  assert.deepEqual(
    compileManifest.packageFiles.slice().sort(),
    [...packageFileSet].sort(),
    'compile-manifest package file inventory must match the on-disk package',
  );
  assert.equal(compileManifest.build.fingerprint, buildFingerprint, 'the compile ran on the locked build');
});

test('application.json: identity, per-step skills with content hashes, and the R4 approval anchors on every write binding', () => {
  assert.equal(applicationJson.id, composition.package.manifestId);
  assert.equal(applicationJson.base, 'classic-full');
  assert.equal(applicationJson.runtimeVersion, upstreamLock.package.version);
  const expectedSkillIds = new Set([
    ...Object.values(EXPECTED_REPLACEMENTS).map((entry) => entry.skillId),
    ...composition.composition.extensions.map((entry) => entry.skillId),
  ]);
  assert.deepEqual(
    [...applicationJson.skills.map((skill) => skill.id)].sort(),
    [...expectedSkillIds].sort(),
    'the compiled manifest carries exactly the managed per-step and extension skills',
  );
  for (const skill of applicationJson.skills) {
    assert.equal(skill.root, `skills/${skill.id}`);
    assert.match(skill.contentHash, /^[a-f0-9]{64}$/);
  }
  const bindings = applicationJson.bindings;
  assert.equal(bindings.length, 9 + EXPECTED_GATES.length);
  const workBindings = bindings.filter((binding) => !binding.stepId.startsWith('classic.extension.'));
  const extensionBindings = bindings.filter((binding) => binding.stepId.startsWith('classic.extension.'));
  assert.equal(workBindings.length, 9);
  for (const binding of workBindings) {
    const expected = EXPECTED_REPLACEMENTS[binding.stepId];
    assert.ok(expected, `unexpected work binding ${binding.stepId}`);
    assert.equal(binding.skillId, expected.skillId);
    assert.equal(binding.capability, `${expected.skillId}.work`);
    assert.equal(binding.authorizationFrom, APPROVAL_ANCHOR, `${binding.stepId} must carry the work-approval anchor (R4)`);
    assert.deepEqual(binding.authorizationChoices, ['approved']);
    const skill = applicationJson.skills.find((entry) => entry.id === binding.skillId);
    assert.ok(
      skill.adapter.review.capabilities.some((capability) => capability.id === binding.capability),
      `${binding.stepId} capability must be a reviewed capability of its skill`,
    );
    assert.equal(skill.adapter.sideEffect, 'write');
  }
  assert.equal(extensionBindings.length, EXPECTED_GATES.length);
  for (const binding of extensionBindings) {
    assert.equal(binding.authorizationFrom, undefined, 'read-only gate bindings carry no approval anchor');
    assert.equal(binding.usage, 'action');
    assert.equal(binding.capability, `${binding.skillId}.gate`);
  }
});

test('workflow.json: the approval anchor gates the entry and every invoke_skill step hash-keeps its ORIGINAL schema', () => {
  const workflow = workflowDefinition.workflows[0];
  assert.equal(workflow.id, WORKFLOW_ID);
  assert.equal(workflow.version, '1');
  // R4 live shape: the compiled workflow starts at the work-approval anchor.
  assert.deepEqual(workflow.entry, ['classic.composition.prepare']);
  assert.equal(workflow.steps['classic.composition.confirm'].type, 'ask_user');
  assert.deepEqual(workflow.steps['classic.composition.confirm'].choices, ['approved', 'rejected']);
  for (const [stepId, expected] of Object.entries(EXPECTED_REPLACEMENTS)) {
    const step = workflow.steps[stepId];
    assert.equal(step.type, 'invoke_skill');
    assert.equal(step.ref, expected.skillId, `${stepId} routes to its per-step managed skill`);
    const factorySchema = factoryStep(stepId).outputSchema;
    if (factorySchema === undefined) {
      assert.deepEqual(step.outputSchema, { type: 'object' }, `${stepId} adopts the adapter schema (no preset upstream)`);
    } else {
      assert.equal(
        stable(step.outputSchema),
        stable(factorySchema),
        `${stepId} output schema must be the ORIGINAL factory schema (hash-checked by the official factory at compile time)`,
      );
    }
  }
  for (const extension of composition.composition.extensions) {
    const step = workflow.steps[`classic.extension.${extension.id}`];
    assert.ok(step, `extension step missing for ${extension.id}`);
    assert.equal(step.type, 'invoke_skill');
    assert.equal(step.ref, extension.skillId);
    assert.equal(stable(step.outputSchema), stable(GATE_RECEIPT_OUTPUT_SCHEMA));
  }
  // Upstream non-replaceable surface survived the composition untouched.
  for (const stepId of NON_REPLACEABLE_STEPS) {
    if (stepId === 'full.archive.execute') {
      assert.notEqual(workflow.steps[stepId].type, 'invoke_skill');
    }
    assert.ok(workflow.steps[stepId], `${stepId} still present in the compiled workflow`);
  }
});

test('R1: the vendored sdd/ closure reproduces byte-for-byte from the repository sources; the embedded bindings import is rebased', () => {
  const REPO_IMPORT = "from '../../../lib/delivery/gate.js'";
  const REBASED_IMPORT = "from './sdd/lib-delivery-gate.mjs'";
  // The embedded module is the repository module with exactly one mechanical
  // rebase — no other difference is allowed.
  const repoBindingsSource = readText('integrations/comet/application/bindings.mjs');
  const packagedBindings = readText('integrations/comet/application/package/bindings.mjs');
  assert.equal(packagedBindings, repoBindingsSource.split(REPO_IMPORT).join(REBASED_IMPORT));
  // The vendored closure set matches the on-disk sdd/ directory exactly.
  const sddFiles = new Set([...packageFileSet].filter((ref) => ref.startsWith('sdd/')));
  assert.deepEqual(
    compileManifest.vendoredModules.map((entry) => entry.moduleRef).sort(),
    [...sddFiles].sort(),
  );
  // Single-source proof: every vendored module is the byte-verbatim source
  // file with only the relative specifiers rewritten (mapping re-derived from
  // the provenance list itself).
  const refBySource = new Map(compileManifest.vendoredModules.map((entry) => [entry.sourcePath, entry.moduleRef]));
  const IMPORT_RE = /(import|export)\s+(?:[\w$]+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const entry of compileManifest.vendoredModules) {
    const sourcePath = path.join(projectRoot, entry.sourcePath);
    assert.ok(fs.existsSync(sourcePath), `vendored source missing: ${entry.sourcePath}`);
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.equal(shaBytes(source), entry.sourceSha256, `provenance sha256 drifted for ${entry.sourcePath}`);
    const renames = [];
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source))) {
      const specifier = match[2];
      if (!specifier.startsWith('.')) continue;
      const resolved = path.relative(projectRoot, path.resolve(path.dirname(sourcePath), specifier)).split(path.sep).join('/');
      const ref = refBySource.get(resolved);
      assert.ok(ref, `vendored module ${entry.moduleRef} imports ${specifier} which is outside the vendored closure`);
      renames.push([specifier, ref]);
    }
    let expected = source;
    for (const [specifier, ref] of renames) {
      let target = path.posix.relative(path.posix.dirname(entry.moduleRef), ref);
      if (!target.startsWith('.')) target = `./${target}`;
      expected = expected.split(`'${specifier}'`).join(`'${target}'`).split(`"${specifier}"`).join(`"${target}"`);
    }
    const packaged = readText(`integrations/comet/application/package/${entry.moduleRef}`);
    assert.equal(packaged, expected, `vendored module ${entry.moduleRef} must be the byte-verbatim rebased ${entry.sourcePath}`);
    assert.equal(shaBytes(packaged), entry.moduleSha256);
  }
  // No package module escapes the package (mini official import scan).
  for (const ref of packageFileSet) {
    if (!ref.endsWith('.mjs')) continue;
    const source = readText(`integrations/comet/application/package/${ref}`);
    for (const match2 of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match2[1];
      if (!specifier.startsWith('.')) continue; // node builtins + @rpamis/comet/* are loader-allowed
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(ref), specifier));
      assert.ok(
        packageFileSet.has(target) && !target.startsWith('../'),
        `package module ${ref} escapes the package via ${specifier}`,
      );
    }
  }
});

test('R6: every packaged skill is self-contained (official inspectApplicationSkill re-inspection; no link escape, no symlinks)', async () => {
  const packagedSkillDirs = [...new Set([...packageFileSet]
    .filter((ref) => ref.startsWith('skills/'))
    .map((ref) => ref.split('/')[1]))].sort();
  assert.deepEqual(
    packagedSkillDirs,
    applicationJson.skills.map((skill) => skill.id).sort(),
    'the package embeds exactly the manifest skills as directories',
  );
  for (const skill of applicationJson.skills) {
    const inspected = await inspectApplicationSkill(path.join(packageRoot, 'skills', skill.id));
    assert.equal(
      inspected.contentHash,
      skill.contentHash,
      `packaged skill ${skill.id} content drifted from the compiled content hash`,
    );
  }
  // R5 boundary keeps holding inside the package: ponytail is not embedded.
  assert.ok(!packagedSkillDirs.some((id) => id.startsWith('ponytail')), 'ponytail must not be embedded (R5)');
});

test('method-variant skills are verbatim copies of the P1_6 packaged skill with only the frontmatter name rewritten', () => {
  for (const entry of composition.managedSkillVariants.work) {
    if (entry.kind !== 'method-variant') continue;
    const sourceRoot = path.join(applicationRoot, entry.source);
    const variantRoot = path.join(packageRoot, 'skills', entry.skillId);
    const sourceFiles = walkRelative(sourceRoot);
    const variantFiles = walkRelative(variantRoot);
    assert.deepEqual(variantFiles, sourceFiles, `variant ${entry.skillId} file set must equal the packaged ${entry.base} file set`);
    for (const ref of sourceFiles) {
      const sourceBytes = fs.readFileSync(path.join(sourceRoot, ref), 'utf8');
      const variantBytes = fs.readFileSync(path.join(variantRoot, ref), 'utf8');
      if (ref === 'SKILL.md') {
        assert.equal(
          variantBytes,
          sourceBytes.replace(`name: ${entry.base}`, `name: ${entry.skillId}`),
          `variant ${entry.skillId} SKILL.md must differ from ${entry.base} only in the frontmatter name`,
        );
      } else {
        assert.equal(variantBytes, sourceBytes, `variant ${entry.skillId} file ${ref} must be byte-verbatim`);
      }
    }
  }
});

function walkRelative(root, relative = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const ref = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkRelative(root, ref));
    else out.push(ref);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. negative mutants: the composition checker must reject every drift
// ---------------------------------------------------------------------------

test('negative mutants: missing extension, moved checkpoint, stripped artifactRefs, unregistered validator, broken order', () => {
  const baseline = compositionViolations(composition, validatorRegistry);
  assert.deepEqual(baseline, []);

  const clone = () => structuredClone(composition);

  const missing = clone();
  missing.composition.extensions = missing.composition.extensions.filter((entry) => entry.id !== 'test-design-review');
  assert.ok(
    compositionViolations(missing, validatorRegistry).some((problem) => problem.includes('test-design-review')),
    'a missing gate extension must be reported',
  );

  const moved = clone();
  moved.composition.extensions.find((entry) => entry.id === 'build-plan-unique').afterStep = 'full.open.evidence';
  assert.ok(
    compositionViolations(moved, validatorRegistry).some((problem) => problem.includes('gate P must sit at')),
    'a moved checkpoint must be reported',
  );

  const stripped = clone();
  stripped.composition.extensions.find((entry) => entry.id === 'architecture-consensus').artifactRefs = [];
  assert.ok(
    compositionViolations(stripped, validatorRegistry).some((problem) => problem.includes('gate A must pin')),
    'stripped artifactRefs must be reported',
  );

  const unregistered = clone();
  unregistered.composition.extensions.find((entry) => entry.id === 'verify-whitebox').validator = {
    id: 'sdd.delivery.gate.ghost',
    version: '1',
  };
  assert.ok(
    compositionViolations(unregistered, validatorRegistry).some((problem) => problem.includes('not registered by bindings.mjs')),
    'an unregistered validator ref must be reported',
  );

  const reordered = clone();
  reordered.composition.order = reordered.composition.order.filter((id) => id !== 'knowledge-project-closeout');
  assert.ok(
    compositionViolations(reordered, validatorRegistry).some((problem) => problem.includes('order must list every extension')),
    'an incomplete order must be reported',
  );

  // A checkpoint outside the pristine whitelist is rejected on upstream
  // evidence, even though the id and registry entries are fine.
  const invented = clone();
  invented.composition.extensions.find((entry) => entry.id === 'requirements-open').afterStep = 'full.archive.execute';
  assert.ok(
    compositionViolations(invented, validatorRegistry).some((problem) => problem.includes('not in the pristine whitelist')),
    'a checkpoint invented outside the upstream whitelist must be reported',
  );
});

test('replacement mutants: id collision across schema-different steps, dropped step, ponytail re-entry, non-replaceable step', () => {
  const baseline = compositionViolations(composition, validatorRegistry);
  assert.deepEqual(baseline, []);
  const clone = () => structuredClone(composition);

  // R3 core: one skill id serving two schema-different steps can never
  // compile (the factory hash-compares each step's ORIGINAL schema).
  const collided = clone();
  collided.composition.replacements.find((entry) => entry.stepId === 'full.design.document').skillId = 'grill-me-full-design-handoff';
  assert.ok(
    compositionViolations(collided, validatorRegistry).some((problem) => problem.includes('per-step skill ids must be unique')),
    'an id shared across steps must be reported',
  );

  const dropped = clone();
  dropped.composition.replacements = dropped.composition.replacements.filter((entry) => entry.stepId !== 'full.verify.run');
  assert.ok(
    compositionViolations(dropped, validatorRegistry).some((problem) => problem.includes('missing replacement for full.verify.run')),
    'an unreplaced domain invoke_skill step must be reported',
  );

  const ponytailBack = clone();
  ponytailBack.composition.replacements.find((entry) => entry.stepId === 'full.build.configure').skillId = 'ponytail-full-build-configure';
  assert.ok(
    compositionViolations(ponytailBack, validatorRegistry).some((problem) => problem.includes('ponytail re-entered replacements')),
    'a ponytail re-entry must be reported (R5 boundary)',
  );

  const forbidden = clone();
  forbidden.composition.replacements.push({ stepId: 'full.verify.check', skillId: 'ghost-check' });
  assert.ok(
    compositionViolations(forbidden, validatorRegistry).some((problem) => problem.includes('full.verify.check')),
    'replacing a machine-check step must be reported',
  );
});

test('declaration mutants: schema rejections for stripped refs, escaping paths and the patch-only Kt gate', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'extensions/schema.json'), 'utf8'));
  const declaration = JSON.parse(
    fs.readFileSync(path.join(applicationRoot, 'extensions/test-design-review.json'), 'utf8'),
  );

  const noRefs = structuredClone(declaration);
  noRefs.artifactRefs = [];
  assert.ok(schemaViolations(schema, noRefs).some((problem) => problem.includes('artifactRefs: fewer than 1')));

  const badPath = structuredClone(declaration);
  badPath.artifactRefs[0].ref = '../escape.json';
  assert.ok(
    schemaViolations(schema, badPath).some((problem) => problem.includes('violates pattern')),
    'an escaping artifact ref must fail the declaration schema',
  );

  const badGate = structuredClone(declaration);
  badGate.gate = 'Kt';
  assert.ok(
    schemaViolations(schema, badGate).some((problem) => problem.includes('not in enum')),
    'Kt is patch-only and must not be declarable as an extension gate',
  );

  const drifted = structuredClone(declaration);
  drifted.afterStep = 'full.open.evidence';
  const compilerShaped = composition.composition.extensions.find((entry) => entry.id === drifted.id);
  assert.notEqual(drifted.afterStep, compilerShaped.afterStep, 'mutant premise: declaration drift is detectable by comparison');
});

// ---------------------------------------------------------------------------
// 5. the 0005 Kt patch: applicability + semantics against the pristine tree
// ---------------------------------------------------------------------------

function applyPatchInTmp(patchBytes) {
  const root = makeTmp('sdd-p24-patch-');
  const target = path.join(root, 'domains/comet-classic/classic-resolver.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(pristineRoot, 'domains/comet-classic/classic-resolver.ts'), target);
  const patchFile = path.join(root, '0005.patch');
  fs.writeFileSync(patchFile, patchBytes);
  const check = spawnSync('git', ['apply', '--check', patchFile], { cwd: root, encoding: 'utf8' });
  if (check.status !== 0) return { root, check, applied: false, target };
  const applied = spawnSync('git', ['apply', patchFile], { cwd: root, encoding: 'utf8' });
  return { root, check, applied: applied.status === 0, target };
}

test('0005 applies to the pristine classic-resolver.ts and gates exactly the archived->completed seam', () => {
  // Pristine old behavior: unconditional completion right after the archive
  // invariant check (the L79-82 seam named by the task).
  assert.match(resolverSource, /if \(classic\.archived\) return 'completed';/);

  const result = applyPatchInTmp(fs.readFileSync(patchPath));
  assert.equal(result.check.status, 0, `git apply --check failed: ${result.check.stderr}`);
  assert.equal(result.applied, true, 'git apply must succeed on the pristine copy');
  const patched = fs.readFileSync(result.target, 'utf8');

  // The Kt predicate is consulted BEFORE 'completed' is returned.
  const branchMatch = patched.match(/if \(classic\.archived\) \{[\s\S]*?return 'completed';\s*\}/);
  assert.ok(branchMatch, 'patched resolver keeps the archived branch');
  assert.match(branchMatch[0], /knowledgeCloseoutBlocked\(classic\)/, 'the branch must consult the Kt predicate');
  assert.ok(
    branchMatch[0].indexOf('knowledgeCloseoutBlocked(classic)') < branchMatch[0].indexOf("return 'completed'"),
    'the predicate must run before completion',
  );
  assert.match(
    branchMatch[0],
    /`\$\{profile\}\.archive\.execute`/,
    'a pending closeout parks the SAME run at the existing archive step',
  );
  // The predicate itself is present exactly once, with the fail-open default.
  assert.equal(patched.match(/function knowledgeCloseoutBlocked/g)?.length, 1);
  assert.match(patched, /if \(closeout === null \|\| closeout === undefined\) return false;/);
});

test('0005 predicate truth table: fail-open default, blocks only required-and-unmet', () => {
  const result = applyPatchInTmp(fs.readFileSync(patchPath));
  assert.equal(result.applied, true);
  const patched = fs.readFileSync(result.target, 'utf8');
  const fnMatch = patched.match(/function knowledgeCloseoutBlocked\(classic: ClassicState\): boolean \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'predicate source found in the patched file');
  // Strip the two TypeScript-only annotations; the judgment logic itself is
  // evaluated verbatim from the patched bytes.
  const jsSource = fnMatch[0]
    .replace('function knowledgeCloseoutBlocked(classic: ClassicState): boolean {', 'function knowledgeCloseoutBlocked(classic) {')
    .replace(/\(\s*classic as ClassicState & \{[\s\S]*?\}\)\.knowledgeCloseout/, 'classic.knowledgeCloseout');
  const predicate = new Function(`${jsSource}; return knowledgeCloseoutBlocked;`)();

  assert.equal(predicate({ archived: true, phase: 'archive' }), false, 'absent field keeps the old completion behavior');
  assert.equal(predicate({ knowledgeCloseout: null }), false, 'null keeps the old behavior');
  assert.equal(predicate({ knowledgeCloseout: {} }), false, 'not required keeps the old behavior');
  assert.equal(predicate({ knowledgeCloseout: { required: true } }), true, 'required and unmet blocks completion');
  assert.equal(predicate({ knowledgeCloseout: { required: true, completed: false } }), true, 'required and explicitly unmet blocks completion');
  assert.equal(predicate({ knowledgeCloseout: { required: true, completed: true } }), false, 'a completed closeout releases completion');
  assert.equal(predicate({ knowledgeCloseout: { required: false, completed: false } }), false, 'an unrequired closeout never blocks');
});

test('0005 corruption is rejected: a broken patch never reaches an upstream tree', () => {
  const bytes = fs.readFileSync(patchPath, 'utf8');
  // Corrupt one context line (flip the archive invariant message).
  const corrupted = bytes.replace(
    "     throw new Error('archived=true requires phase=archive');",
    "     throw new Error('archived=true requires phase=archive-DRIFT');",
  );
  assert.notEqual(corrupted, bytes, 'mutant premise: the patch bytes changed');
  const result = applyPatchInTmp(Buffer.from(corrupted, 'utf8'));
  assert.notEqual(result.check.status, 0, 'git apply --check must reject the corrupted patch');
  assert.equal(result.applied, false);
  // And the pristine file in that tmp root is untouched.
  const target = fs.readFileSync(path.join(result.root, 'domains/comet-classic/classic-resolver.ts'), 'utf8');
  assert.match(target, /if \(classic\.archived\) return 'completed';/, 'rejected patch leaves the pristine behavior in place');
});

test('the Kt obligation stays declared and honest: patch-only, write path unclaimed, compile delivered, runtime unclaimed', () => {
  const closeout = composition.knowledgeCloseout;
  assert.equal(closeout.gate, 'Kt');
  assert.match(closeout.writePath, /NOT IN THIS REVISION/);
  // Kt must NOT appear as a composition extension (no post-archive hook
  // upstream): the whitelist has no archive checkpoint to hang it on.
  assert.ok(!checkpointWhitelist.has('full.archive.execute'));
  assert.ok(
    !composition.composition.extensions.some((entry) => entry.id.includes('team') || entry.afterStep.includes('archive')),
    'Kt is patch-only; no extension may claim a post-archive checkpoint',
  );
  // Post-rework honesty state: the compile is DELIVERED (pinned above), the
  // runtime surface stays explicitly unclaimed — never smoothed over.
  const unverified = composition.unverified.map((entry) => entry.item).join('\n');
  assert.match(unverified, /real host install\/dispatch/, 'the install/dispatch journey must stay an explicit UNVERIFIED item');
  assert.match(unverified, /extension behavior inside a real Run/);
  assert.match(unverified, /Kt state-field write path/);
  assert.equal(composition.runtimeAccepted, false);
  assert.ok(
    composition.package.outputRoot === 'integrations/comet/application/package'
      && composition.package.build === 'integrations/comet/application/internal/build-application.mjs',
    'the package section must pin the build entry and output root',
  );
});
