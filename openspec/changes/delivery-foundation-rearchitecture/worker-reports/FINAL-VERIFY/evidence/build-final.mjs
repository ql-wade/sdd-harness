#!/usr/bin/env node
// FINAL-VERIFY projection builder: writes acceptance-index.json (schema 2,
// both instrument vocabularies: 4_3 RW_COMPLETION_REQUIRED + 5_1.a-4 parent
// re-validation) and verification-results.json (schema 4) from the batch
// results + the final direct re-runs. VERIFY-owned artifacts only.
import fs from 'node:fs';
import path from 'node:path';

const repo = '/Users/mac/Code/sdd-harness';
const change = path.join(repo, 'openspec/changes/delivery-foundation-rearchitecture');
const ev = path.join(change, 'worker-reports/FINAL-VERIFY/evidence');
const contract = JSON.parse(fs.readFileSync(path.join(change, 'execution-contract.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(change, 'verification-case-plan.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(change, 'execution-state.json'), 'utf8'));
const batch = JSON.parse(fs.readFileSync(path.join(ev, 'batch-results.json'), 'utf8'));
const rerun = JSON.parse(fs.readFileSync(path.join(ev, 'direct-rerun-final.json'), 'utf8'));

const byId = new Map(contract.checks.map((c) => [c.id, c]));
const phaseById = {};
for (const [phase, rows] of Object.entries(batch.phases)) {
  for (const r of rows) phaseById[r.id] ??= {}, phaseById[r.id][phase] = r;
}
for (const r of rerun.results) phaseById[r.id] ??= {}, phaseById[r.id].D_direct = { ...phaseById[r.id]?.D_direct, ...r };

const JOURNEY_IDS = ['V_SAME_RUN_DELIVERY', 'V_RW_REAL_COMET_RECOVERY', 'V_POST_DELIVERY_PERMISSIONS'];
const classifyCheck = (id, hasModule) => {
  if (JOURNEY_IDS.includes(id)) return 'same_run_finality';
  if (id.startsWith('V_INFRA_') || id === 'V_COMET_NATIVE' || id === 'V_I02_METHOD_STATE_SCOPE' || id === 'V_RW_RUNNER_BUILD') return 'env_qualification';
  if (/^V_[A-Z]\d{2}$/.test(id) && hasModule !== false) return 'component_pass';
  return 'gate_support';
};

// --- final per-check statuses ---------------------------------------------------
// Convention (unchanged from the prior VERIFY round): the managed plane is the
// registered denominator's verdict source — honest structured refusals stay
// UNVERIFIED; direct commands PASS/FAIL by exit code; component/journey plane
// results are recorded as supporting evidence and never upgrade a scenario.
const managedEvidenceDir = {};
for (const c of contract.checks) {
  const m = /--evidence-dir (\S+)/.exec(c.command);
  if (m) managedEvidenceDir[c.id] = m[1];
}
const checks = [];
const statusCounts = { PASS: 0, FAIL: 0, UNVERIFIED: 0, NOT_EXERCISED_SCOPE: 0 };
const bindingGaps = [];
const componentPlane = {};
for (const c of contract.checks) {
  const byPhase = phaseById[c.id] ?? {};
  const rec = {
    id: c.id,
    command: c.command,
    task_ids: c.task_ids,
    acceptance_ids: c.acceptance_ids,
    required: c.required,
    managed_registered: byPhase.A_managed_registered ? {
      exit_code: byPhase.A_managed_registered.exitCode,
      verdict: byPhase.A_managed_registered.verdict,
      reason: byPhase.A_managed_registered.reason ?? null,
    } : null,
    component_real: byPhase.B_component_registered ? {
      exit_code: byPhase.B_component_registered.exitCode,
      verdict: byPhase.B_component_registered.verdict,
      reason: byPhase.B_component_registered.reason ?? null,
      module: byPhase.B_component_registered.module ?? null,
      proof_level: byPhase.B_component_registered.proofLevel ?? null,
      tap: byPhase.B_component_registered.tapSummary ?? null,
    } : null,
    journey_component: byPhase.C_journey_component ? {
      exit_code: byPhase.C_journey_component.exitCode,
      verdict: byPhase.C_journey_component.verdict,
      reason: byPhase.C_journey_component.reason ?? null,
      journey: byPhase.C_journey_component.journey ?? null,
    } : null,
    direct: byPhase.D_direct ? {
      exit_code: byPhase.D_direct.exitCode,
      verdict: byPhase.D_direct.verdict ?? null,
      command: c.command,
    } : null,
    final_status: null,
    final_status_basis: null,
  };
  if (rec.component_real?.verdict) componentPlane[c.acceptance_ids[0]] = rec.component_real.verdict;
  if (c.id === 'V_F10') {
    rec.final_status = 'NOT_EXERCISED_SCOPE';
    rec.final_status_basis = 'f10-current-scope-decision.json decision A: F10 cross-machine Control API deferred to a separate change; any enablement needs its own positive qualification';
  } else if (rec.direct) {
    rec.final_status = rec.direct.exit_code === 0 ? 'PASS' : 'FAIL';
    rec.final_status_basis = rec.direct.exit_code === 0
      ? 'direct registered command exited 0 in this FINAL-VERIFY round (evidence: worker-reports/FINAL-VERIFY/evidence/batch-run.log + direct-rerun-final.json)'
      : `direct registered command exited ${rec.direct.exit_code} in this FINAL-VERIFY round`;
  } else {
    rec.final_status = 'UNVERIFIED';
    const reasons = new Set();
    if (rec.managed_registered?.reason) reasons.add(rec.managed_registered.reason.split(' (')[0]);
    rec.final_status_basis = `managed plane refused honestly (exit 2): ${[...reasons].join('; ') || 'not-run'}`;
    const cverdict = rec.component_real?.verdict ?? rec.journey_component?.verdict;
    if (cverdict === 'PASS') {
      rec.final_status_basis += '; REGISTERED denominator exercised PASS at component/observer-qualification scope (real module execution, typed TAP readback) — supporting evidence only, never a managed scenario PASS (status_rule.supporting_cli)';
    } else if (cverdict === 'FAIL') {
      rec.final_status_basis += `; registered denominator exercised behavior-RED: ${(rec.component_real?.reason ?? rec.journey_component?.reason ?? '').slice(0, 160)}`.trim();
    } else if (cverdict === 'NOT-EXERCISED' && rec.component_real?.reason?.startsWith('component-proof-cannot-satisfy-registered-layer')) {
      rec.final_status_basis += '; registered as host-level: the component plane cannot satisfy this layer — honest refusal';
      bindingGaps.push({
        check: c.id, scenario: c.acceptance_ids[0], registered_module: rec.component_real.module,
        reason: 'registered at host level (required_proof_level=host): the component case_module carries no test point for the registered denominator, so the host layer is the declared proof plane; the managed runback slot is registered (required_readbacks)',
      });
    } else if (cverdict === 'NOT-EXERCISED' && rec.component_real) {
      bindingGaps.push({
        check: c.id, scenario: c.acceptance_ids[0], registered_module: rec.component_real.module,
        reason: 'registered case_module carries no test point for the registered assertion denominator (P1-04 refuses green-suite-without-target)',
      });
      rec.final_status_basis += `; component re-run NOT-EXERCISED: ${(rec.component_real.reason ?? '').split(' — ')[0]}`;
    }
  }
  statusCounts[rec.final_status] += 1;
  checks.push(rec);
}

// --- acceptance-index.json -------------------------------------------------------
const aggregation = contract.acceptance_aggregation.scenario_required_checks;
const nodeStatus = state.node_status ?? {};
const specScenarioIds = [...fs.readFileSync(path.join(change, 'specs/delivery-foundation/spec.md'), 'utf8')
  .matchAll(/^#### Scenario: ([A-Z]\d{2})$/gm)].map((m) => m[1]);
if (specScenarioIds.length !== 104) throw new Error(`spec.md scenario parse collapsed: ${specScenarioIds.length}`);

const checkRec = {};
for (const rec of checks) {
  const c = byId.get(rec.id);
  checkRec[rec.id] = {
    acceptance_ids: c.acceptance_ids,
    implementedBy: c.implementedBy,
    availability: c.availability,
    case_module: c.case_module,
    contract_status: 'FINAL_VERIFY_2026_10_27_DERIVED',
    layer: classifyCheck(rec.id, Boolean(c.case_module)),
    status: rec.final_status === 'NOT_EXERCISED_SCOPE' ? 'UNVERIFIED' : rec.final_status,
    readback_evidence: rec.final_status === 'PASS' ? 'RECORDED' : 'ABSENT',
    evidence: rec.final_status === 'PASS'
      ? ['openspec/changes/delivery-foundation-rearchitecture/worker-reports/FINAL-VERIFY/evidence/batch-run.log']
      : (managedEvidenceDir[rec.id] ? [`${managedEvidenceDir[rec.id]}/verdict.json`] : []),
  };
}

const journeys = {};
for (const [name, def] of Object.entries(plan.journey_definitions)) {
  journeys[name] = {
    required_check: def.required_check,
    construction_owner: def.owner,
    execution_owner: contract.journey_execution.owner,
    case_path: def.path,
    status: checkRec[def.required_check]?.status === 'PASS' ? 'PASS' : 'UNVERIFIED',
  };
}

const componentStatusOf = (taskStatuses) => {
  const vals = Object.values(taskStatuses);
  if (vals.length === 0) return 'UNVERIFIED';
  if (vals.some((s) => s.startsWith('REOPENED') || s === 'MISSING' || s.startsWith('DEFERRED'))) return 'UNVERIFIED';
  if (vals.some((s) => s.startsWith('PARTIAL'))) return 'PARTIAL_AT_DECLARED_SCOPE';
  if (vals.some((s) => s.startsWith('ACCEPTED'))) return vals.every((s) => s === 'ACCEPTED_DOCUMENT_ONLY') ? 'DOCUMENT_ONLY' : 'MECHANISM_AT_DECLARED_SCOPE';
  return 'PARTIAL_AT_DECLARED_SCOPE';
};

const scenarios = {};
const entries = {};
for (const ac of specScenarioIds) {
  const own = byId.get(`V_${ac}`);
  const aggregated = aggregation[ac];
  const taskStatuses = {};
  for (const t of own.task_ids) {
    if (t === 'VERIFY') continue;
    taskStatuses[t] = nodeStatus[t]?.status ?? 'MISSING';
  }
  const envChecks = aggregated.filter((id) => classifyCheck(id) === 'env_qualification');
  const journeyChecks = aggregated.filter((id) => classifyCheck(id) === 'same_run_finality');
  scenarios[ac] = {
    case_module: own.case_module,
    required_checks: [...aggregated],
    component_pass: { status: componentStatusOf(taskStatuses), tasks: taskStatuses, evidence: [] },
    env_qualification: {
      status: envChecks.length > 0 && envChecks.every((id) => checkRec[id]?.status === 'PASS') ? 'QUALIFIED' : 'UNVERIFIED',
      checks: envChecks,
    },
    same_run_finality: {
      status: journeyChecks.every((id) => checkRec[id]?.status === 'PASS') && Object.values(journeys).every((j) => j.status === 'PASS')
        ? 'VERIFIED' : 'UNVERIFIED',
      journey_checks: journeyChecks,
      owner: contract.journey_execution.owner,
    },
    deployment_status: 'NOT_DELIVERED',
    scenario_status: aggregated.every((id) => checkRec[id]?.status === 'PASS' && checkRec[id]?.readback_evidence === 'RECORDED')
      ? 'PASS' : 'UNVERIFIED',
  };
  entries[ac] = {
    status: scenarios[ac].scenario_status === 'PASS' ? 'VERIFIED' : 'NOT_VERIFIED',
    layer: 'real-flow-required',
    historical_results_may_close: false,
    source_binding: plan.cases[ac]?.source_binding ?? [],
    required_checks: [...aggregated],
  };
}

const notPass = Object.values(checkRec).filter((c) => c.status !== 'PASS').length;
const failed = Object.values(checkRec).filter((c) => c.status === 'FAIL').length;
const notExecuted = Object.values(checkRec).filter((c) => c.status !== 'PASS' && c.status !== 'FAIL').length;
const noReadback = Object.values(checkRec).filter((c) => c.readback_evidence !== 'RECORDED').length;
const perLayer = {};
for (const layer of ['component_pass', 'env_qualification', 'same_run_finality', 'deployment_status']) perLayer[layer] = {};
for (const s of Object.values(scenarios)) {
  for (const layer of ['component_pass', 'env_qualification', 'same_run_finality', 'deployment_status']) {
    const st = layer === 'deployment_status' ? s[layer] : s[layer]?.status;
    perLayer[layer][st] = (perLayer[layer][st] ?? 0) + 1;
  }
}
const checkStatusTally = {};
for (const rec of Object.values(checkRec)) checkStatusTally[rec.status] = (checkStatusTally[rec.status] ?? 0) + 1;

const index = {
  schema_version: 2,
  change: 'delivery-foundation-rearchitecture',
  acceptance_id: 'B10',
  semantics_source: 'specs/delivery-foundation/spec.md (104 scenarios, sole semantic source)',
  generated_from: {
    execution_contract: 'openspec/changes/delivery-foundation-rearchitecture/execution-contract.json (130 required checks)',
    verification_case_plan: 'openspec/changes/delivery-foundation-rearchitecture/verification-case-plan.json (104 cases, 3 journeys; G-T1-02 denominators registered)',
    execution_state: 'openspec/changes/delivery-foundation-rearchitecture/execution-state.json (node_status/open_p1 snapshot)',
    regenerate_command: 'node openspec/changes/delivery-foundation-rearchitecture/worker-reports/FINAL-VERIFY/evidence/build-final.mjs (VERIFY-owned projection; the P4_3 generator form is test/delivery-cases/4_3.mjs --generate)',
  },
  generated_at: new Date().toISOString(),
  generated_by: 'FINAL-VERIFY projection (registered denominators, real current-version runs, pinned node v24.15.0); managed plane still refuses honestly — scenario statuses stay UNVERIFIED until a qualified managed Run closes them',
  layer_definitions: JSON.parse(fs.readFileSync(path.join(change, 'acceptance-index.json'), 'utf8')).layer_definitions,
  status_rule: JSON.parse(fs.readFileSync(path.join(change, 'acceptance-index.json'), 'utf8')).status_rule,
  required_checks: checkRec,
  journeys,
  environment_gates: {
    // comet-050 revision observations (5_3 J4 requires these verbatim-mirrored
    // in operations-runbook.md) + the generator's partial-node/open-decision view.
    qualification_status: 'UNVERIFIED',
    source: 'execution-state.json',
    open_decisions_source: 'execution-state.json#open_decisions',
    readonly_observations: {
      docker_daemon: 'available',
      outline: 'running healthy',
      runner: 'sixrole containers exited; inspected controller/author no command',
      evidence: '.local/comet-reset/runtime-readonly/container-state.json',
    },
    observation_rule: 'container health and readback availability do not prove source ACLs, grants, role execution or any business Journey',
    from_partial_nodes: Object.entries(nodeStatus).filter(([, v]) => v.steps_gated).map(([task, v]) => ({ task, gated: v.steps_gated })),
    open_decisions: (state.open_decisions ?? []).filter((d) => d.status === 'OPEN').map((d) => d.id),
  },
  open_p1: [],
  historical: {
    verify_result: 'see verification-results.json history: 2026-10-27 r1 (19 PASS/2 FAIL/108 UNVERIFIED/1 SCOPE) superseded by this round',
    inherited: false,
    rule: '历史 VERIFY 结果只作历史记录；本修订状态只由当前来源推导，不自动继承',
  },
  deployment: {
    status: 'NOT_DELIVERED',
    rule: 'B10: delivered 只能在目标环境确认后声明；与代码验收/规格归档分开',
    confirmation_evidence: null,
  },
  scenarios,
  entries,
  convergence_revision: plan.convergence_revision,
  rw_completion: {
    rule: 'RW_COMPLETION_REQUIRED',
    complete: false,
    blocking: {
      required_checks_not_pass: notPass,
      checks_failed: failed,
      checks_not_executed: notExecuted,
      missing_readback: noReadback,
      scenarios_not_closed: 104,
      journeys_not_run: 3,
      open_p1: 0,
    },
  },
  summary: {
    total: 104,
    VERIFIED: 0,
    NOT_VERIFIED: 104,
    scenarios: 104,
    required_checks: 130,
    layer_statuses: perLayer,
    required_check_statuses: checkStatusTally,
    required_checks_by_layer: (() => {
      const byLayer = {};
      for (const rec of Object.values(checkRec)) byLayer[rec.layer] = (byLayer[rec.layer] ?? 0) + 1;
      return byLayer;
    })(),
    supporting_pass: Object.values(checkRec).filter((c) => c.status === 'PASS').length,
    failed,
    not_executed: notExecuted,
  },
};
fs.writeFileSync(path.join(change, 'acceptance-index.json'), `${JSON.stringify(index, null, 2)}\n`);

// --- verification-results.json ---------------------------------------------------
const gapRegistry = JSON.parse(fs.readFileSync(path.join(ev, 'gap-registry-final.json'), 'utf8'));
const results = {
  schema_version: 4,
  change: 'delivery-foundation-rearchitecture',
  revision: '2026-10-26-comet-050-adoption-v2 (FINAL-VERIFY: G-T1-02 denominator registration + both FAIL root-caused)',
  artifact_kind: 'VERIFY_FINAL_ACCEPTANCE_RESULTS',
  generated_at: new Date().toISOString(),
  generated_by: 'FINAL-VERIFY worker — final acceptance derivation from real current-version runs (pinned node v24.15.0) against the REGISTERED denominators',
  environment: {
    node: batch.node,
    git_head: `${rerun.head} (working tree; VERIFY is forbidden to commit)`,
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
    scenario_proof_registration: { component: 76, host: 27, exact_name_bindings: ['F01', 'F03'] },
  },
  execution_summary: {
    A_managed_registered: {
      total: batch.phases.A_managed_registered.length,
      verdicts: batch.phases.A_managed_registered.reduce((a, r) => { const k = r.verdict ?? `exit${r.exitCode}`; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      note: 'exact registered commands; honest structured refusals, never converted to PASS. After registration the host-level scenarios (27 + F01/F03 exact-name) refuse with protected-source-unavailable (the true blocker: no qualified Comet launcher observation interface); component-registered scenarios (76) still refuse proof-registration-missing because a component level can never close the managed plane',
    },
    B_component_registered: {
      total: batch.phases.B_component_registered.length,
      PASS: batch.phases.B_component_registered.filter((r) => r.verdict === 'PASS').length,
      FAIL: batch.phases.B_component_registered.filter((r) => r.verdict === 'FAIL').length,
      NOT_EXERCISED: batch.phases.B_component_registered.filter((r) => r.verdict === 'NOT-EXERCISED').length,
      note: 'component/observer-qualification scope against the REGISTERED plan (--case-plan pin): real case-module execution with typed TAP readback against the frozen assertion denominator; supporting evidence only',
    },
    C_journey_component: {
      total: batch.phases.C_journey_component.length,
      verdicts: batch.phases.C_journey_component.reduce((a, r) => { const k = r.verdict ?? `exit${r.exitCode}`; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      note: 'the 3 registered recipes at component/observer-qualification scope; the E06/L11 plan↔recipe module conflicts are reconciled (both recipes now PASS on the component plane); the managed sha-freeze gate stays a G-T1-02 residual',
    },
    D_direct: {
      total: checks.filter((c) => c.direct).length,
      exit0: checks.filter((c) => c.direct && c.direct.exit_code === 0).length,
      nonzero: checks.filter((c) => c.direct && c.direct.exit_code !== 0).length,
      note: 'V_RW_COMPLETION_REQUIRED re-run against the FINAL index after projection (direct-rerun-final.json); all other directs ran once in the batch',
    },
  },
  final_check_status_counts: statusCounts,
  checks,
  scenario_binding_gaps: bindingGaps,
  scenario_component_plane: componentPlane,
  gap_registry_final: gapRegistry,
  grill: {
    report: 'grill-report.md',
    previous_round: '5/5 UPHELD (2026-10-27 r1, worker-reports/VERIFY-comet-050); this round: see grill-report.md FINAL-VERIFY supplement',
    evidence_dirs: ['worker-reports/VERIFY-comet-050/evidence/grill/', 'worker-reports/FINAL-VERIFY/evidence/grill/'],
  },
  archive_recommendation: null, // filled by the report step
};
fs.writeFileSync(path.join(change, 'verification-results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log('final statuses:', statusCounts);
console.log('blocking:', JSON.stringify(index.rw_completion.blocking));
const cp = Object.values(componentPlane); console.log('component plane:', cp.filter((v) => v === 'PASS').length, 'PASS /', cp.filter((v) => v === 'FAIL').length, 'FAIL /', cp.filter((v) => v === 'NOT-EXERCISED').length, 'NOT-EXERCISED');
