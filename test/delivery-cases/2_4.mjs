// P2_4 delivery case, revision 2026-10-26-comet-050-adoption-v1 (ADR-0022):
// the managed delivery gates are expressed as a Comet 0.5.0 native
// classic-full composition application, NOT as the retired 0.4.5 patch chain.
//
// What this case proves (mechanism/supply level — no runtime acceptance):
//   1. the composition declares the six gate extensions (R/A/T/P/V/Kp) at
//      exactly the upstream checkpoint whitelist positions, cross-checked
//      against the PRISTINE 0.5.0 source, not against our own copies;
//   2. replacements cover exactly the comet-design/comet-build invoke_skill
//      steps, keep the original stepIds and output contracts (parsed from the
//      pristine full-profile workflow), and never touch machine checks,
//      approvals or archive steps (upstream non-replaceable surface);
//   3. every referenced skill is a real P1_6 packaged asset;
//   4. bindings.mjs registers exactly the declared validators and every
//      verdict is delegated to the real lib/delivery pure components — a
//      claimed pass is accepted ONLY when the pure SDD.Gate.v1 evaluation of
//      the payload passes; malformed/blocked/mismatched/refused payloads all
//      fail closed;
//   5. the 0005 Kt patch applies cleanly to the pristine classic-resolver.ts,
//      keeps the old unconditional completion for states without the optional
//      field, and blocks completion only while the knowledge closeout
//      obligation is required and unmet; a corrupted patch is rejected.
//
// What it does NOT claim: compilation through the official
// compileWorkflowApplication, extension behavior inside a real Run, and the
// rebuilt upstream tree with 0005 applied are P1_3/P1_4/P1_5/VERIFY waves
// (composition.json#unverified). The legacy 0.4.5 patch-chain assertions that
// previously lived in this file are RED against the 0.5.0 lock — recorded at
// worker-reports/P2_4-comet-050/evidence/red-1-legacy-2_4-against-050-lock.txt.
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

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const applicationRoot = path.join(projectRoot, 'integrations/comet/application');
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

const tempRoots = new Set();
after(() => { for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true }); });
function makeTmp(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  tempRoots.add(root);
  return root;
}

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
const EXPECTED_REPLACEMENTS = {
  'full.design.handoff': 'comet-design',
  'full.design.document': 'comet-design',
  'full.build.configure': 'comet-build',
  'full.build.plan': 'comet-build',
  'full.build.execute': 'comet-build',
};
const DOMAIN_OWNED_STEPS = [
  'full.open',
  'full.verify.run',
  'full.archive.prepare',
  'full.archive.deliver',
];

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

  const replacements = compositionBody.replacements ?? [];
  const replacedSteps = replacements.map((entry) => entry.stepId);
  for (const stepId of Object.keys(EXPECTED_REPLACEMENTS)) {
    if (!replacedSteps.includes(stepId)) {
      problems.push(`missing replacement for ${stepId} (upstream ${EXPECTED_REPLACEMENTS[stepId]} execution step)`);
    }
  }
  for (const stepId of DOMAIN_OWNED_STEPS) {
    if (replacedSteps.includes(stepId)) {
      problems.push(`domain-owned step ${stepId} must not be replaced`);
    }
  }
  for (const replacement of replacements) {
    const block = pristineStepBlock(replacement.stepId);
    if (!block) {
      problems.push(`replacement stepId ${String(replacement.stepId)} does not exist in the pristine workflow`);
      continue;
    }
    if (!block.includes("type: 'invoke_skill'")) {
      problems.push(`replacement stepId ${replacement.stepId} is not an invoke_skill step (not replaceable upstream)`);
    }
    const expectedRef = EXPECTED_REPLACEMENTS[replacement.stepId];
    // full.design.handoff is keyed by the computed followingStep variable and
    // its ref is computed too (profile === 'full' ? 'comet-design' : ...);
    // the alias-resolution assertion already pins the full-profile meaning,
    // so the block must carry either the literal ref or that computed form.
    const refForms = [
      `ref: '${expectedRef}'`,
      /ref: profile === 'full' \? 'comet-design' : 'comet-build',/,
    ];
    if (expectedRef && !refForms.some((form) => (form instanceof RegExp ? form.test(block) : block.includes(form)))) {
      problems.push(`replacement stepId ${replacement.stepId} is not a ${expectedRef} step`);
    }
    const contract = doc.replacementContracts?.steps?.[replacement.stepId];
    if (!contract || contract.originalSkillRef !== expectedRef) {
      problems.push(`replacement ${replacement.stepId} lacks the preserved output-contract declaration`);
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
const bindingsResult = await bindingsModule.createBindings({ probe: 'p2_4-case' });
const validatorRegistry = new Map(
  (bindingsResult.validators ?? []).map((validator) => [`${validator.id}@${validator.version}`, validator]),
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

function extensionInput(gate, evidence) {
  return {
    run: { runId: 'run-p2_4' },
    action: { id: 'action-extension-1', stepId: `classic.extension.${gate}` },
    outcome: {
      actionId: 'action-extension-1',
      status: 'succeeded',
      output: { verdict: 'pass', sourceHash: 'domain-checked', artifactHashes: {}, gateEvidence: evidence },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. supplier fixtures and cross-artifact pins
// ---------------------------------------------------------------------------

test('composition, bindings, typed declarations and the 0005 patch exist with cross-pinned bytes', () => {
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
  for (const file of composition.extensionDeclarations.files) {
    assert.ok(fs.existsSync(path.join(applicationRoot, 'extensions', file)), `declaration ${file} missing`);
  }
  assert.ok(fs.statSync(path.join(applicationRoot, 'bindings.mjs')).isFile());
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

test('replacements keep the original stepIds and output contracts of exactly the comet-design/comet-build execution skills', () => {
  const problems = compositionViolations(composition, validatorRegistry);
  assert.deepEqual(problems, []);
  const replaced = composition.composition.replacements.map((entry) => entry.stepId);
  assert.deepEqual([...replaced].sort(), Object.keys(EXPECTED_REPLACEMENTS).sort());
  // Machine checks, approvals and archive steps stay domain-owned.
  for (const forbidden of [
    'full.build.check',
    'full.verify.check',
    'full.archive.execute',
    'full.archive.confirm',
    'full.open.confirm',
    'full.design.confirm',
    'full.build.confirm',
  ]) {
    assert.ok(!replaced.includes(forbidden), `${forbidden} must stay domain-owned`);
  }
  for (const stepId of DOMAIN_OWNED_STEPS) {
    const block = pristineStepBlock(stepId);
    assert.ok(block, `pristine still defines ${stepId}`);
    assert.match(block, /type: 'invoke_skill'/);
  }
});

test('every referenced skill is a real P1_6 packaged asset with no retired tokens', () => {
  const used = new Set([
    ...composition.composition.replacements.map((entry) => entry.skillId),
    ...composition.composition.extensions.map((entry) => entry.skillId),
  ]);
  assert.ok(used.size > 0);
  for (const skillId of used) {
    assert.ok(packagedSkills.has(skillId), `skill ${skillId} is not in the P1_6 packaged manifest`);
    const skillRoot = path.join(applicationRoot, 'skills', skillId);
    assert.ok(fs.statSync(skillRoot).isDirectory(), `packaged asset directory missing for ${skillId}`);
    assert.ok(fs.existsSync(path.join(skillRoot, 'SKILL.md')), `packaged skill ${skillId} has no SKILL.md`);
  }
  for (const token of assetsManifest.naming_rule.retired_tokens) {
    for (const entry of fs.readdirSync(path.join(applicationRoot, 'skills'))) {
      assert.ok(
        !entry.toLowerCase().includes(token.toLowerCase()),
        `retired token ${token} re-entered the packaged assets as ${entry}`,
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

test('createBindings registers exactly the declared validators (unregistered refs are impossible to miss)', () => {
  assert.deepEqual(Object.keys(bindingsResult).sort(), ['validators']);
  assert.equal(bindingsResult.validators.length, EXPECTED_GATES.length);
  const declared = composition.composition.extensions.map((entry) => `${entry.validator.id}@${entry.validator.version}`);
  const registered = bindingsResult.validators.map((entry) => `${entry.id}@${entry.version}`);
  assert.deepEqual([...declared].sort(), [...registered].sort(), 'declared and registered validator sets must be identical');
  for (const validator of bindingsResult.validators) {
    assert.equal(typeof validator.validate, 'function', `${validator.id} must expose validate`);
  }
  // The delegation seam itself: bindings.mjs imports the real pure component
  // and carries no verdict logic of its own.
  const bindingsSource = fs.readFileSync(path.join(applicationRoot, 'bindings.mjs'), 'utf8');
  assert.match(bindingsSource, /from '\.\.\/\.\.\/\.\.\/lib\/delivery\/gate\.js'/);
  assert.match(bindingsSource, /\bevaluate\(/);
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
    const decision = await validator.validate(extensionInput(expected.gate, evidence));
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
// 3. negative mutants: the composition checker must reject every drift
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
// 4. the 0005 Kt patch: applicability + semantics against the pristine tree
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

test('the Kt obligation stays declared and honest: patch-only, write path and lock integration unclaimed', () => {
  const closeout = composition.knowledgeCloseout;
  assert.equal(closeout.gate, 'Kt');
  assert.match(closeout.lockIntegration, /NOT APPLIED YET/, 'the lock must not silently claim 0005 is applied');
  assert.match(closeout.writePath, /NOT IN THIS REVISION/);
  // Kt must NOT appear as a composition extension (no post-archive hook
  // upstream): the whitelist has no archive checkpoint to hang it on.
  assert.ok(!checkpointWhitelist.has('full.archive.execute'));
  assert.ok(
    !composition.composition.extensions.some((entry) => entry.id.includes('team') || entry.afterStep.includes('archive')),
    'Kt is patch-only; no extension may claim a post-archive checkpoint',
  );
  const unverified = composition.unverified.map((entry) => entry.item).join('\n');
  assert.match(unverified, /compileWorkflowApplication/, 'compilation must stay an explicit UNVERIFIED item');
  assert.match(unverified, /extension behavior inside a real Run/);
});
