#!/usr/bin/env node
// VERIFY-comet-050 batch acceptance runner (observer only).
// Phase A: exact registered managed-mode commands (execution-contract checks).
// Phase B: component/observer-qualification runs per required scenario (real
//           case-module execution; supplementary evidence, never a managed PASS).
// Phase C: frozen-denominator journey runs (temp case-plan registering
//           case_definition_sha256, mirroring P3_3's VERIFIER-freeze preview).
// Phase D: the 21 direct commands.
// Emits machine results: batch-results.json (merged per check id).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';

const repo = '/Users/mac/Code/sdd-harness';
const change = path.join(repo, 'openspec/changes/delivery-foundation-rearchitecture');
const nodeBin = `${process.env.HOME}/.nvm/versions/node/v24.15.0/bin/node`;
const planPath = path.join(change, 'verification-case-plan.json');
const outRoot = path.join(change, 'worker-reports/VERIFY-comet-050/evidence');
const results = { startedAt: new Date().toISOString(), node: process.version, phases: {} };
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const contract = JSON.parse(fs.readFileSync(path.join(change, 'execution-contract.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const run = (argv, opts = {}) => spawnSync(nodeBin, argv, {
  cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900_000, ...opts,
});

function record(phase, id, kind, spawnResult, extra = {}) {
  let verdict = null; let reason = null; let parsed = null;
  try { parsed = JSON.parse(spawnResult.stdout); } catch { /* not json */ }
  if (parsed && parsed.verdict) { verdict = parsed.verdict; reason = parsed.reason ?? null; }
  results.phases[phase] ??= [];
  results.phases[phase].push({
    id, kind, exitCode: spawnResult.status,
    verdict, reason,
    durationHint: parsed?.timing?.durationMs ?? null,
    tapSummary: parsed?.execution ? {
      tests: parsed.execution.tests, pass: parsed.execution.pass, fail: parsed.execution.fail,
      skipped: parsed.execution.skipped, effectiveExecutions: parsed.execution.effectiveExecutions,
      target: parsed.execution.target,
    } : null,
    stdoutTail: (!parsed && spawnResult.stdout) ? String(spawnResult.stdout).slice(-400) : null,
    stderrTail: spawnResult.stderr ? String(spawnResult.stderr).slice(-600) : null,
    ...extra,
  });
  const line = results.phases[phase].at(-1);
  console.log(`[${phase}] ${id} exit=${spawnResult.status} verdict=${verdict ?? '-'} ${reason ?? ''}`.slice(0, 220));
}

// --- Phase A: exact registered managed commands --------------------------------
const scenarioChecks = [];
const journeyChecks = [];
const directChecks = [];
for (const c of contract.checks) {
  const cmd = c.command;
  if (cmd.startsWith('node tools/verify/delivery-journey.mjs')) {
    const s = /--scenario ([A-Z0-9]+)/.exec(cmd);
    const j = /--journey ([a-z-]+)/.exec(cmd);
    const ev = /--evidence-dir (\S+)/.exec(cmd)[1];
    const kind = s ? 'scenario' : 'journey';
    (s ? scenarioChecks : journeyChecks).push({ id: c.id, argv: ['tools/verify/delivery-journey.mjs', ...(s ? ['--scenario', s[1]] : ['--journey', j[1]]), '--profile', 'comet-managed-v2', '--evidence-dir', ev, '--json'], kind });
  } else {
    directChecks.push({ id: c.id, command: cmd });
  }
}

for (const c of [...scenarioChecks, ...journeyChecks]) {
  const evDir = path.join(repo, c.argv[c.argv.indexOf('--evidence-dir') + 1]);
  fs.rmSync(evDir, { recursive: true, force: true });
  const res = run(c.argv);
  record('A_managed_registered', c.id, c.kind, res);
}

// --- Phase B: component/observer-qualification per required scenario -----------
const requiredScenarios = Object.entries(plan.cases)
  .filter(([id, entry]) => entry.required_in_current_completion !== false)
  .map(([id]) => id);
for (const sc of requiredScenarios) {
  const evDir = path.join(repo, '.whitebox/verify-comet-050/component', sc);
  fs.rmSync(evDir, { recursive: true, force: true });
  const res = run(['tools/verify/delivery-journey.mjs', '--scenario', sc, '--profile', 'comet-managed-v2',
    '--evidence-dir', evDir, '--case-plan', planPath, '--json']);
  record('B_component_real', `V_${sc}`, 'scenario', res, { scenario: sc, module: plan.cases[sc].case_module });
}

// --- Phase C: frozen-denominator journey runs ----------------------------------
const tempPlan = path.join(outRoot, 'frozen-journeys-case-plan.json');
const frozen = JSON.parse(JSON.stringify(plan));
for (const [name, reg] of Object.entries(frozen.journey_definitions)) {
  reg.case_definition_sha256 = sha256(path.join(repo, reg.path));
}
fs.writeFileSync(tempPlan, `${JSON.stringify(frozen, null, 2)}\n`);
for (const name of Object.keys(plan.journey_definitions)) {
  const evDir = path.join(repo, '.whitebox/verify-comet-050/journey-frozen', name);
  fs.rmSync(evDir, { recursive: true, force: true });
  const res = run(['tools/verify/delivery-journey.mjs', '--journey', name, '--profile', 'comet-managed-v2',
    '--evidence-dir', evDir, '--case-plan', tempPlan, '--json']);
  record('C_journey_frozen_denominator', plan.journey_definitions[name].required_check, 'journey', res, { journey: name });
}

// --- Phase D: direct commands ---------------------------------------------------
for (const c of directChecks) {
  const argv = c.command.split(/\s+/);
  const res = run(argv, { timeout: 1_200_000 });
  record('D_direct', c.id, 'direct', res, { command: c.command });
}

results.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(outRoot, 'batch-results.json'), `${JSON.stringify(results, null, 2)}\n`);
const tally = {};
for (const [phase, rows] of Object.entries(results.phases)) {
  tally[phase] = { total: rows.length,
    pass: rows.filter((r) => r.exitCode === 0).length,
    nonzero: rows.filter((r) => r.exitCode !== 0).length,
    byVerdict: rows.reduce((acc, r) => { const k = r.verdict ?? `exit${r.exitCode}`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}) };
}
fs.writeFileSync(path.join(outRoot, 'batch-tally.json'), `${JSON.stringify(tally, null, 2)}\n`);
console.log('TALLY', JSON.stringify(tally));
