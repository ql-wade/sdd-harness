// Isolated pre-study: exercise upstream-generated scripts, not a hosted delivery.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const [buildArg, outputArg] = process.argv.slice(2);
assert(buildArg && outputArg, 'usage: node probe.mjs <pinned-upstream-build> <isolated-output>');
const build = path.resolve(buildArg);
const output = path.resolve(outputArg);
await fs.mkdir(output, { recursive: true });
const { generateFactorySkillPackage } = await import(pathToFileURL(path.join(build, 'dist/domains/factory/package.js')));
const { builtinCometFivePhaseWorkflow, normalizeWorkflowDefinition } = await import(pathToFileURL(path.join(build, 'dist/domains/workflow-contract/index.js')));
const { parseClassicTasks, validateClassicTaskPlan, classicTaskRevision } = await import(pathToFileURL(path.join(build, 'dist/domains/comet-classic/classic-tasks.js')));
const cases = [];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function run(label, script, args, cwd) {
  const p = spawnSync(process.execPath, [script, ...args], { cwd, env: { ...process.env, COMET_RUN_ROOT: cwd }, encoding: 'utf8', timeout: 15000 });
  assert.ifError(p.error);
  const record = { label, args, exit: p.status, stdout: p.stdout, stderr: p.stderr };
  cases.push(record);
  return record;
}
const definition = {
  ...builtinCometFivePhaseWorkflow({ name: 'overlay-prestudy', goal: 'Observe the original Classic state and required-method evidence boundary.' }),
  nodes: { open: { requiredSkillCalls: [{ skill: 'grill-me', reason: 'Pre-study required method; no model is invoked.' }] } },
};
const workflow = normalizeWorkflowDefinition(definition);
const generated = await generateFactorySkillPackage({ root: output, name: definition.name, version: '1.0.0', description: 'Isolated upstream overlay qualification probe.', goal: definition.goal, defaultLocale: 'zh', callChain: workflow.requiredSkills.map((skill, preferenceIndex) => ({ skill, preferenceIndex })), workflowDefinition: workflow.input, workflowProtocol: workflow.protocol, skillCreator: { intent: 'customize-comet' }, resolvedSkills: [], deviations: [], engineMode: 'deterministic' });
const stateScript = path.join(generated.packageRoot, 'scripts/workflow-state.mjs');
const guardScript = path.join(generated.packageRoot, 'scripts/workflow-guard.mjs');
const workspace = path.join(output, 'workspace');
const change = path.join(workspace, 'openspec/changes/overlay-case');
await fs.mkdir(change, { recursive: true });
await fs.mkdir(path.join(workspace, '.comet'), { recursive: true });
await fs.writeFile(path.join(workspace, '.comet/config.yaml'), 'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n  language: en\n');
const stateFile = path.join(change, '.comet.yaml');
await fs.writeFile(stateFile, 'phase: open\nworkflow: full\nreview_mode: standard\n');
const before = await fs.readFile(stateFile);
assert.notEqual(run('overlay-init-refused', stateScript, ['init'], workspace).exit, 0);
assert.match(run('next-reads-original-phase', stateScript, ['next'], workspace).stdout, /NODE: open/);
assert.equal(run('record-without-required-skill', stateScript, ['record', 'open', JSON.stringify({ 'intake-summary': 'fixture only', completedChecks: [] })], workspace).exit, 0);
const missing = run('missing-required-skill-rejected', guardScript, ['exit', 'open', '--apply'], workspace);
assert.notEqual(missing.exit, 0);
assert.match(missing.stderr, /required Skill/);
assert.equal(run('manual-skill-marker-recorded', stateScript, ['record', 'open', JSON.stringify({ 'intake-summary': null, completedChecks: ['required-skill:open.grill-me'] })], workspace).exit, 0);
const manual = run('manual-marker-and-null-summary', guardScript, ['exit', 'open', '--apply'], workspace);
assert.equal(manual.exit, 0);
assert.match(manual.stdout, /COMET STATE: unchanged/);
assert.equal(sha(await fs.readFile(stateFile)), sha(before));
await assert.rejects(fs.access(path.join(workspace, '.comet/runs/overlay-prestudy/state.json')));
const sidecar = path.join(workspace, '.comet/workflow-evidence/overlay-case/overlay-prestudy.json');
await fs.access(sidecar);
let controlOverrideRejected = false;
try { normalizeWorkflowDefinition({ ...definition, nodes: { open: { implementation: { skill: 'grill-me', operation: 'override' } } } }); } catch { controlOverrideRejected = true; }
assert(controlOverrideRejected);
normalizeWorkflowDefinition({ ...definition, nodes: { plan: { implementation: { skill: 'planning-method', operation: 'override' }, satisfies: ['comet.plan.v1'] } } });
const tasksText = '- [ ] Implement fixture <!-- comet-task:T1 -->\n';
const authority = 'openspec/changes/overlay-case/tasks.md';
const canonicalPlan = `<!-- comet-task-authority: ${authority} -->\n<!-- comet-task-ref:T1 -->\n`;
assert.equal(validateClassicTaskPlan(canonicalPlan, authority, parseClassicTasks(tasksText)), 'canonical');
assert.throws(() => validateClassicTaskPlan(canonicalPlan + '- [ ] Duplicate progress\n', authority, parseClassicTasks(tasksText)));
assert.equal(classicTaskRevision(tasksText), classicTaskRevision(tasksText.replace('[ ]', '[x]')));
const findings = {
  upstreamVersion: '0.4.5', upstreamCommit: 'c90af44a4474662d7853aae76ce785404974fb0a', node: process.versions.node,
  scope: 'actual upstream package generator and generated scripts in an isolated fixture; no model/hosted role or publication executed',
  generatedClassification: generated.wrapperClassification,
  observations: { overlayInitRejected: true, originalPhaseUsed: true, missingMarkerRejected: true, manualMarkerAndNullSummaryAccepted: true, originalStateUnchanged: true, noIndependentRunState: true, controlOverrideRejected, producerOverrideSchemaAccepted: true, canonicalPlanAccepted: true, secondCheckboxLedgerRejected: true, checkboxDoesNotInvalidateTaskRevision: true },
  limitations: ['Generated fixture is not an authored/published/installed method bundle', 'Skill source resolution and actual invocation identity not exercised', 'Direct Classic transition and cross-change artifact binding require separate qualification', 'No managed runtime or acceptance scenario is marked passed'],
  scripts: { state: sha(await fs.readFile(stateScript)), guard: sha(await fs.readFile(guardScript)) }, cases,
};
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(findings, null, 2) + '\n');
console.log(JSON.stringify({ observations: findings.observations, classification: findings.generatedClassification, results: path.join(output, 'results.json') }));
