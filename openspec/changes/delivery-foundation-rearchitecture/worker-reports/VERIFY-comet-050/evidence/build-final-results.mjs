#!/usr/bin/env node
// Build final verification-results.json (schema 4) + update acceptance-index.json
// from batch-results.json + final check.sh evidence. VERIFY-owned files only.
import fs from 'node:fs';
import path from 'path';

const repo = '/Users/mac/Code/sdd-harness';
const change = path.join(repo, 'openspec/changes/delivery-foundation-rearchitecture');
const ev = path.join(change, 'worker-reports/VERIFY-comet-050/evidence');
const batch = JSON.parse(fs.readFileSync(path.join(ev, 'batch-results.json'), 'utf8'));
const contract = JSON.parse(fs.readFileSync(path.join(change, 'execution-contract.json'), 'utf8'));

const phaseById = {};
for (const [phase, rows] of Object.entries(batch.phases)) {
  for (const r of rows) phaseById[r.id] ??= {}, phaseById[r.id][phase] = r;
}

const finalCheckLog = fs.readFileSync(path.join(ev, 'check-sh-final.log'), 'utf8');
const finalExitMatch = /exit=(\d+)/.exec(finalCheckLog);
const finalCheckExit = finalExitMatch ? Number(finalExitMatch[1]) : null;
const npmSummary = {};
for (const m of finalCheckLog.matchAll(/ℹ (tests|pass|fail|skipped) (\d+)/g)) npmSummary[m[1]] = Number(m[2]);

const managedReason = (r) => r?.reason ?? null;
const checks = [];
const statusCounts = { PASS: 0, FAIL: 0, UNVERIFIED: 0, NOT_EXERCISED_SCOPE: 0 };
const bindingGaps = [];
for (const c of contract.checks) {
  const byId = phaseById[c.id] ?? {};
  const rec = {
    id: c.id,
    command: c.command,
    task_ids: c.task_ids,
    acceptance_ids: c.acceptance_ids,
    required: c.required,
    managed_registered: byId.A_managed_registered ? {
      exit_code: byId.A_managed_registered.exitCode,
      verdict: byId.A_managed_registered.verdict,
      reason: managedReason(byId.A_managed_registered),
    } : null,
    component_real: byId.B_component_real ? {
      exit_code: byId.B_component_real.exitCode,
      verdict: byId.B_component_real.verdict,
      reason: byId.B_component_real.reason,
      module: byId.B_component_real.module ?? null,
      tap: byId.B_component_real.tapSummary ?? null,
    } : null,
    journey_frozen_denominator: byId.C_journey_frozen_denominator ? {
      exit_code: byId.C_journey_frozen_denominator.exitCode,
      verdict: byId.C_journey_frozen_denominator.verdict,
      reason: byId.C_journey_frozen_denominator.reason,
    } : null,
    direct: byId.D_direct ? {
      exit_code: byId.D_direct.exitCode,
      stderr_tail: byId.D_direct.stderrTail,
    } : null,
    final_status: null,
    final_status_basis: null,
  };
  if (c.id === 'V_F10') {
    rec.final_status = 'NOT_EXERCISED_SCOPE';
    rec.final_status_basis = 'f10-current-scope-decision.json decision A: F10 cross-machine Control API deferred to a separate change; any enablement needs its own positive qualification';
  } else if (rec.direct) {
    rec.final_status = rec.direct.exit_code === 0 ? 'PASS' : 'FAIL';
    rec.final_status_basis = rec.direct.exit_code === 0
      ? 'direct registered command exited 0 in this VERIFY round (see evidence/batch-run.log + check-sh-final.log)'
      : `direct registered command exited ${rec.direct.exit_code} in this VERIFY round`;
  } else {
    rec.final_status = 'UNVERIFIED';
    const reasons = new Set();
    if (rec.managed_registered?.reason) reasons.add(rec.managed_registered.reason.split(' (')[0]);
    rec.final_status_basis = `managed registration refused honestly (exit 2): ${[...reasons].join('; ') || 'not-run'}`;
    if (rec.component_real?.verdict === 'PASS') {
      rec.final_status_basis += '; component/observer-qualification re-run PASS (real module execution — supporting evidence only, never a scenario PASS per status_rule.supporting_cli)';
    } else if (rec.component_real?.verdict === 'FAIL') {
      rec.final_status_basis += `; component re-run behavior-RED: ${rec.component_real.reason ?? ''}`.trim();
    } else if (rec.component_real?.verdict === 'NOT-EXERCISED') {
      const gap = rec.component_real.reason ?? '';
      if (gap.startsWith('assertion-mapping-not-verifiable')) {
        bindingGaps.push({
          check: c.id,
          scenario: c.acceptance_ids[0],
          registered_module: rec.component_real.module,
          reason: 'registered case_module carries no test point named for the scenario token (P1-04 refuses green-suite-without-target)',
        });
      }
      rec.final_status_basis += `; component re-run NOT-EXERCISED: ${gap.split(' — ')[0]}`;
    }
  }
  statusCounts[rec.final_status] += 1;
  checks.push(rec);
}

const managed = batch.phases.A_managed_registered ?? [];
const component = batch.phases.B_component_real ?? [];
const journeys = batch.phases.C_journey_frozen_denominator ?? [];
const direct = batch.phases.D_direct ?? [];
const count = (rows, verdict) => rows.filter((r) => r.verdict === verdict).length;

const results = {
  schema_version: 4,
  change: 'delivery-foundation-rearchitecture',
  revision: '2026-10-26-comet-050-adoption-v1',
  artifact_kind: 'VERIFY_FINAL_ACCEPTANCE_RESULTS',
  generated_at: new Date().toISOString(),
  generated_by: 'VERIFY worker — final acceptance derivation from real current-version runs (pinned node v24.15.0); previous P4_3 pre-VERIFY index preserved in git history f43368c',
  environment: {
    node: batch.node,
    git_head: '29752c0 (working tree; VERIFY is forbidden to commit)',
    runner: 'tools/verify/delivery-journey.mjs + direct registered commands',
  },
  denominators: {
    checks_total: 130,
    checks_required_current: 129,
    checks_scope_not_exercised: ['V_F10'],
    scenarios_total: 104,
    scenarios_required_current: 103,
    scenarios_scope_not_exercised: ['F10'],
    journeys_registered: 3,
  },
  execution_summary: {
    A_managed_registered: {
      total: managed.length,
      verdicts: managed.reduce((a, r) => { const k = r.verdict ?? `exit${r.exitCode}`; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      note: 'exact registered commands; honest refusals, never converted to PASS',
    },
    B_component_real: {
      total: component.length,
      PASS: count(component, 'PASS'),
      FAIL: count(component, 'FAIL'),
      NOT_EXERCISED: count(component, 'NOT-EXERCISED'),
      note: 'component/observer-qualification scope (--case-plan pin): real case-module execution with typed TAP readback; supplementary only',
    },
    C_journey_frozen_denominator: {
      total: journeys.length,
      verdicts: journeys.reduce((a, r) => { const k = r.verdict ?? `exit${r.exitCode}`; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      note: 'recipes executed at component/observer-qualification scope via explicit --case-plan (the sha256-freeze gate is managed-mode only and remains unregistered in the real plan — see gap G-T1-02); two recipes additionally refused on plan↔recipe module-binding mismatch',
    },
    D_direct: {
      total: direct.length,
      exit0: direct.filter((r) => r.exitCode === 0).length,
      nonzero: direct.filter((r) => r.exitCode !== 0).length,
    },
    final_check_sh: { exit: finalCheckExit, npm_summary: npmSummary },
  },
  final_check_status_counts: statusCounts,
  checks,
  scenario_binding_gaps: bindingGaps,
  gap_registry_final: JSON.parse(fs.readFileSync(path.join(ev, 'gap-registry-final.json'), 'utf8')),
  grill: {
    report: 'grill-report.md',
    verdicts: { G1_P3_2_consensus: 'UPHELD', G2_P2_4_fingerprints: 'UPHELD', G3_P4_4_kp_loop: 'UPHELD', G4_I08_backup: 'UPHELD', G5_P4_8_revocation: 'UPHELD', G6_green_signal: 'FALSIFIED_FIRST_ROUND_THEN_ROOT_CAUSED_AND_UPHELD' },
    evidence_dir: 'worker-reports/VERIFY-comet-050/evidence/grill/',
  },
  archive_recommendation: 'DO_NOT_ARCHIVE_YET — VERIFY execution complete at denominator-honest level, but 12 tier-2/3 gaps (6 human-gated + 6 external-resource) remain UNVERIFIED and the managed-mode denominator registration (journey case_definition_sha256 + scenario proof registrations) has not landed in verification-case-plan.json. Archive only after the controller lands the registration and closes or explicitly waives the tier-2 gates.',
};
fs.writeFileSync(path.join(change, 'verification-results.json'), `${JSON.stringify(results, null, 2)}\n`);

// --- acceptance-index.json final projection (schema 2 invariants preserved) ---
const idx = JSON.parse(fs.readFileSync(path.join(change, 'acceptance-index.json'), 'utf8'));
const managedEvidenceDir = {};
for (const c of contract.checks) {
  const m = /--evidence-dir (\S+)/.exec(c.command);
  if (m) managedEvidenceDir[c.id] = m[1];
}
for (const rec of checks) {
  const entry = idx.required_checks[rec.id];
  if (!entry) continue;
  entry.status = rec.final_status === 'NOT_EXERCISED_SCOPE' ? 'UNVERIFIED' : rec.final_status;
  const evPaths = [];
  if (rec.managed_registered && managedEvidenceDir[rec.id]) evPaths.push(`${managedEvidenceDir[rec.id]}/verdict.json`);
  if (rec.component_real?.module && rec.id !== 'V_F10') evPaths.push(`.whitebox/verify-comet-050/component/${rec.acceptance_ids[0]}/verdict.json`);
  if (rec.journey_frozen_denominator) evPaths.push(`.whitebox/verify-comet-050/journey-frozen/${rec.id === 'V_SAME_RUN_DELIVERY' ? 'same-run-delivery' : rec.id === 'V_RW_REAL_COMET_RECOVERY' ? 'real-comet-recovery' : 'post-delivery-permissions'}/verdict.json`);
  if (rec.direct) evPaths.push('openspec/changes/delivery-foundation-rearchitecture/worker-reports/VERIFY-comet-050/evidence/batch-run.log');
  entry.evidence = evPaths;
  entry.contract_status = 'VERIFY_2026_10_26_COMET_050_DERIVED';
}
idx.generated_at = new Date().toISOString();
idx.generated_by = 'VERIFY final acceptance projection (real current-version runs, pinned node v24.15.0); scenario statuses stay NOT_VERIFIED until managed-same-Run journeys pass';
const tally = { supporting_pass: 0, failed: 0, not_executed: 0 };
for (const v of Object.values(idx.required_checks)) {
  const k = v.status === 'PASS' ? 'supporting_pass' : v.status === 'FAIL' ? 'failed' : 'not_executed';
  tally[k] += 1;
}
idx.summary.supporting_pass = tally.supporting_pass;
idx.summary.failed = tally.failed;
idx.summary.not_executed = tally.not_executed;
idx.rw_completion.blocking.required_checks_not_pass = tally.failed + tally.not_executed;
idx.rw_completion.blocking.checks_failed = tally.failed;
idx.rw_completion.blocking.checks_not_executed = tally.not_executed;
idx.rw_completion.complete = false;
fs.writeFileSync(path.join(change, 'acceptance-index.json'), `${JSON.stringify(idx, null, 2)}\n`);
console.log('final statuses:', statusCounts);
console.log('index tally:', tally, 'binding gaps:', bindingGaps.length);
