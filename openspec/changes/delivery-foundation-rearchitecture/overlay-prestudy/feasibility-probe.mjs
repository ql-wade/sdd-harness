// Qualification observer: all mutations stay in the supplied isolated output.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const [repoArg, buildArg, openspecArg, ponytailArg, outArg] = process.argv.slice(2);
assert(repoArg && buildArg && openspecArg && ponytailArg && outArg, 'usage: node feasibility-probe.mjs <repo> <pinned-build> <openspec-cli> <ponytail-plugin> <isolated-output>');
const repo = path.resolve(repoArg), build = path.resolve(buildArg), out = path.resolve(outArg);
assert(!out.startsWith(repo + path.sep), 'Use a separate temporary output, never the live project');
await fs.mkdir(out, { recursive: true });
const workspace = path.join(out, 'workspace');
await fs.mkdir(workspace, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const records = [];
const environment = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, CI: 'true', DO_NOT_TRACK: '1', OPENSPEC_TELEMETRY: '0', COMET_OPENSPEC: path.resolve(openspecArg), COMET_RUN_ROOT: workspace };
delete environment.COMET_SKIP_BUILD;
delete environment.COMET_FORCE_PHASE;
function invoke(label, program, args, { cwd = workspace, env = environment, input } = {}) {
  const result = spawnSync(program, args, { cwd, env, input, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(result.error);
  records.push({ label, exit: result.status, stdout: result.stdout, stderr: result.stderr });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}
function ok(label, program, args, options) {
  const r = invoke(label, program, args, options);
  assert.equal(r.exit, 0, `${label}: ${r.stderr}`);
  return r;
}
const load = (rel) => import(pathToFileURL(path.join(build, 'dist', rel)));
const { findPreferredSkills } = await load('domains/skill/find.js');
const { builtinCometFivePhaseWorkflow, normalizeWorkflowDefinition } = await load('domains/workflow-contract/index.js');
const { generateFactorySkillPackage } = await load('domains/factory/package.js');
const { classicLayoutPaths } = await load('domains/comet-classic/classic-layout.js');
const found = await findPreferredSkills({ projectRoot: workspace, homeDir: path.join(out, 'empty-home'), builtinRoot: path.join(out, 'empty-builtins'), preferences: ['grill-me', 'tdd', 'test-authoring', 'whitebox-verify'].map((query, preferenceIndex) => ({ query, preferenceIndex })), extraRoots: [{ root: path.join(repo, '.agents/skills'), origin: 'explicit' }] });
assert(found.every((s) => s.status === 'available' && s.sources.length === 1 && /^[0-9a-f]{64}$/.test(s.sources[0].hash)));
const definition = { ...builtinCometFivePhaseWorkflow({ name: 'feasibility-overlay', goal: 'Observe current-Change and method invocation boundaries without running models.' }), nodes: { open: { requiredSkillCalls: [{ skill: 'grill-me' }] } } };
const workflow = normalizeWorkflowDefinition(definition);
const generated = await generateFactorySkillPackage({ root: path.join(out, 'package'), name: definition.name, version: '1.0.0', description: definition.goal, goal: definition.goal, defaultLocale: 'zh', callChain: workflow.requiredSkills.map((skill, preferenceIndex) => ({ skill, preferenceIndex })), workflowDefinition: workflow.input, workflowProtocol: workflow.protocol, resolvedSkills: found, deviations: [], skillCreator: { intent: 'customize-comet' }, engineMode: 'deterministic' });
const stateScript = path.join(generated.packageRoot, 'scripts/workflow-state.mjs');
const guardScript = path.join(generated.packageRoot, 'scripts/workflow-guard.mjs');
const comet = path.join(build, 'bin/comet.js'), openspec = path.resolve(openspecArg);
ok('git-init', 'git', ['init', '--initial-branch=pilot']);
ok('git-initial', 'git', ['-c', 'user.name=SDD Probe', '-c', 'user.email=probe@localhost.invalid', 'commit', '--allow-empty', '-m', 'Isolated feasibility baseline']);
ok('openspec-init', process.execPath, [openspec, 'init', '--tools', 'none', '--profile', 'core', '--language', 'en', '--no-animation']);
ok('openspec-new', process.execPath, [openspec, 'new', 'change', 'boundary-probe', '--schema', 'spec-driven', '--json']);
await fs.mkdir(path.join(workspace, '.comet'), { recursive: true });
await fs.writeFile(path.join(workspace, '.comet/config.yaml'), 'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n  language: en\n');
const change = path.join(workspace, 'openspec/changes/boundary-probe');
for (const [name, text] of Object.entries({ 'proposal.md': '# Why\nObserve the required-method boundary in an isolated repository.\n', 'design.md': '# Design\nNo requirement or independent review receipt has been accepted.\n', 'tasks.md': '- [ ] Verify the boundary <!-- comet-task:probe-test -->\n' })) await fs.writeFile(path.join(change, name), text);
const specDir = path.join(change, 'specs/boundary');
await fs.mkdir(specDir, { recursive: true });
await fs.writeFile(path.join(specDir, 'spec.md'), '## ADDED Requirements\n\n### Requirement: Boundary\nThe system SHALL reject missing trusted method evidence.\n\n#### Scenario: Missing method\n- **GIVEN** no required method ran\n- **WHEN** advancement is requested\n- **THEN** reject\n');
ok('comet-init', process.execPath, [comet, 'state', 'init', 'boundary-probe', 'full', '--isolation', 'current']);
ok('overlay-record-missing-method', process.execPath, [stateScript, 'record', 'open', JSON.stringify({ 'intake-summary': 'fixture only', completedChecks: [] })]);
const overlayBlocked = invoke('overlay-open-exit', process.execPath, [guardScript, 'exit', 'open', '--apply']);
assert.notEqual(overlayBlocked.exit, 0);
assert.match(overlayBlocked.stderr, /required Skill/);
const direct = ok('direct-classic-open-complete', process.execPath, [comet, 'state', 'transition', 'boundary-probe', 'open-complete', '--json']);
const phase = ok('direct-phase-readback', process.execPath, [comet, 'state', 'get', 'boundary-probe', 'phase']);
assert.equal(phase.stdout.trim(), 'design');
// Only another Change has a matching delta; no current state.design_doc is set.
await fs.rename(path.join(specDir, 'spec.md'), path.join(specDir, 'spec.md.disabled'));
const other = path.join(workspace, 'openspec/changes/other-change/specs/other');
await fs.mkdir(other, { recursive: true });
await fs.writeFile(path.join(other, 'spec.md'), '# Unrelated delta\n');
const layout = classicLayoutPaths(workspace, 'legacy');
await fs.mkdir(path.join(layout.superpowersRoot, 'specs'), { recursive: true });
await fs.writeFile(path.join(layout.superpowersRoot, 'specs/other-change.md'), '# Unrelated design\n');
ok('overlay-record-null-design', process.execPath, [stateScript, 'record', 'design', JSON.stringify({ 'design-summary': null, 'user-confirmation': null })]);
const wrongChange = invoke('overlay-exit-with-other-change-artifacts', process.execPath, [guardScript, 'exit', 'design', '--apply']);
assert.equal(wrongChange.exit, 0, wrongChange.stderr);
const beforeHooks = sha(await fs.readFile(path.join(change, '.comet.yaml')));
const hookData = path.join(out, 'ponytail-state');
const hookEnv = { ...environment, CLAUDE_CONFIG_DIR: path.join(out, 'claude-config'), PLUGIN_DATA: hookData, CLAUDE_PROJECT_DIR: workspace, XDG_CONFIG_HOME: path.join(out, 'config'), PONYTAIL_DEFAULT_MODE: 'full', PONYTAIL_MAP: '0' };
delete hookEnv.COPILOT_PLUGIN_DATA;
delete hookEnv.PONYTAIL_SUBAGENT_MATCHER;
const hook = (file) => path.join(path.resolve(ponytailArg), 'hooks', file);
const activated = ok('ponytail-session-start', process.execPath, [hook('ponytail-activate.js')], { env: hookEnv, input: JSON.stringify({ source: 'startup' }) });
assert.match(activated.stdout, /PONYTAIL MODE ACTIVE.*full/s);
const child = ok('ponytail-subagent-start', process.execPath, [hook('ponytail-subagent.js')], { env: hookEnv, input: '{}' });
assert.match(child.stdout, /PONYTAIL MODE ACTIVE.*full/s);
ok('ponytail-user-lite', process.execPath, [hook('ponytail-mode-tracker.js')], { env: hookEnv, input: JSON.stringify({ prompt: '/ponytail lite' }) });
const compact = ok('ponytail-compact', process.execPath, [hook('ponytail-activate.js')], { env: hookEnv, input: JSON.stringify({ source: 'compact' }) });
assert.match(compact.stdout, /PONYTAIL MODE ACTIVE.*lite/s);
const sibling = ok('ponytail-same-scope-sibling', process.execPath, [hook('ponytail-subagent.js')], { env: hookEnv, input: JSON.stringify({ session_id: 'different-session' }) });
assert.match(sibling.stdout, /PONYTAIL MODE ACTIVE.*lite/s);
ok('ponytail-off', process.execPath, [hook('ponytail-mode-tracker.js')], { env: hookEnv, input: JSON.stringify({ prompt: 'stop ponytail' }) });
const off = ok('ponytail-subagent-after-off', process.execPath, [hook('ponytail-subagent.js')], { env: hookEnv, input: '{}' });
assert.equal(off.stdout.trim(), '');
assert.equal(sha(await fs.readFile(path.join(change, '.comet.yaml'))), beforeHooks);
const runner = invoke('runner-qualification', process.execPath, [path.join(repo, 'tools/infra/runner.mjs'), 'qualify', '--registry', path.join(repo, 'infra/delivery/registry.json'), '--json'], { cwd: repo });
const outline = invoke('outline-qualification', process.execPath, [path.join(repo, 'tools/infra/outline.mjs'), 'qualify', '--registry', path.join(repo, 'infra/delivery/registry.json'), '--json'], { cwd: repo });
const sources = found.map((s) => ({ query: s.query, status: s.status, source: path.relative(repo, s.sources[0].root), hash: s.sources[0].hash }));
const report = { baseline: { comet: '0.4.5', commit: 'c90af44a4474662d7853aae76ce785404974fb0a', node: process.versions.node, ponytail: JSON.parse(await fs.readFile(path.join(path.resolve(ponytailArg), '.codex-plugin/plugin.json'), 'utf8')).version },
  sources, observations: { requiredMethodResolution: 'AVAILABLE_WITH_HASHES', generatedClassification: generated.wrapperClassification, overlayRejectsMissingMethod: true, directClassicTransitionDespiteOverlayFailure: 'GAP_CONFIRMED', phaseAfterDirectTransition: phase.stdout.trim(), unrelatedChangeArtifactsAndNullDesignEvidenceAccepted: 'GAP_CONFIRMED', ponytailLifecycleScriptOutput: 'START_SUBAGENT_COMPACT_OFF_OBSERVED', sharedMethodScopeCrossSession: 'GAP_CONFIRMED_MODE_SHARED', ponytailChangedCometState: false, runnerQualificationExit: runner.exit, outlineQualificationExit: outline.exit },
  limitations: ['No hosted model/actual Skill execution or event registration tested', 'No OS/container role isolation or real MCP business call tested', 'Native gaps reproduced; no implementation fixed and no product acceptance claimed', 'Ponytail was executed as isolated scripts with controlled host-shaped environment, not as native host events'],
  records: records.map((r) => r.label.startsWith('ponytail-') ? { label: r.label, exit: r.exit, stdoutSha256: sha(r.stdout), outputContainsMode: /PONYTAIL MODE/.test(r.stdout) } : { ...r, stdout: r.stdout.replaceAll(out, '<isolated-output>').replaceAll(repo, '<repo>'), stderr: r.stderr.replaceAll(out, '<isolated-output>').replaceAll(repo, '<repo>') }) };
await fs.writeFile(path.join(out, 'feasibility-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ observations: report.observations, sources: sources.map(({ query, status }) => ({ query, status })), result: path.join(out, 'feasibility-results.json') }));
