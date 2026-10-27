// P4_3 rework r1 (acceptance B10): the four evidence-status layers are
// regenerated and indexed separately, and the RW_COMPLETION_REQUIRED gate
// decides completion for the whole change.
//
// Sources (never edited by this file):
//   execution-contract.json     — 130 required checks (acceptance_ids,
//                                 availability, implementedBy, evidence rules)
//   verification-case-plan.json — 104 scenario cases + 3 journey definitions
//   execution-state.json        — controller node_status / open_p1 / history
//   specs/delivery-foundation/spec.md — 104 scenarios (sole semantic source)
//
// Evidence-status layers (rework Step 8), distinct from the historical
// kernel/cli/host/ci execution layers, which stay in verification.md as
// history:
//   component_pass     — construction tasks' mechanism evidence at declared
//                        scope (current candidate commits); never overrides a
//                        failed/missing real-path check;
//   env_qualification  — live Outline stack, .sdd prepared builds, pinned
//                        toolchain, real Registry/Runner availability;
//   same_run_finality  — the three same-product-Run journeys, executionOwner
//                        = VERIFY; a delivered recipe is not a run journey;
//   deployment_status  — the delivered claim; NOT delivered until the target
//                        environment confirms, separate from every other layer.
//
// RW_COMPLETION_REQUIRED (rework Step 7): any required check FAIL/GATED/
// UNVERIFIED/skipped, any missing journey, any missing real readback, any
// open P1, or insufficient evidence layering keeps the whole change NOT
// complete. Holders, explicit dispositions and historical results (76/87)
// are never read by the evaluator and can never upgrade completion.
//
// Regenerate the index:  node test/delivery-cases/4_3.mjs --generate
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CHANGE = 'openspec/changes/delivery-foundation-rearchitecture';
const INDEX_PATH = path.join(ROOT, CHANGE, 'acceptance-index.json');
const SPEC_PATH = path.join(ROOT, CHANGE, 'specs', 'delivery-foundation', 'spec.md');
const VERIFICATION_MD_PATH = path.join(ROOT, CHANGE, 'verification.md');
const CONTRACT_PATH = path.join(ROOT, CHANGE, 'execution-contract.json');
const PLAN_PATH = path.join(ROOT, CHANGE, 'verification-case-plan.json');
const STATE_PATH = path.join(ROOT, CHANGE, 'execution-state.json');

const EVIDENCE_LAYERS = ['component_pass', 'env_qualification', 'same_run_finality', 'deployment_status'];
// Each layer speaks its own status vocabulary on purpose — collapsing them is
// exactly the layering failure B10 forbids.
const LAYER_STATUS = {
  component_pass: new Set(['MECHANISM_AT_DECLARED_SCOPE', 'PARTIAL_AT_DECLARED_SCOPE', 'DOCUMENT_ONLY', 'UNVERIFIED']),
  env_qualification: new Set(['QUALIFIED', 'UNVERIFIED']),
  same_run_finality: new Set(['VERIFIED', 'UNVERIFIED']),
  deployment_status: new Set(['DELIVERED', 'NOT_DELIVERED']),
};
const CHECK_STATUS = new Set(['PASS', 'FAIL', 'GATED', 'SKIPPED', 'UNVERIFIED']);
const JOURNEY_IDS = ['V_SAME_RUN_DELIVERY', 'V_RW_REAL_COMET_RECOVERY', 'V_POST_DELIVERY_PERMISSIONS'];
const ENV_LAYER_CHECKS = (id) =>
  id.startsWith('V_INFRA_') ||
  id === 'V_COMET_NATIVE' ||
  id === 'V_I02_METHOD_STATE_SCOPE' ||
  id === 'V_RW_RUNNER_BUILD';

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function specScenarioIds() {
  const text = fs.readFileSync(SPEC_PATH, 'utf8');
  const ids = [...text.matchAll(/^#### Scenario: ([A-Z]\d{2})$/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 90, `spec.md scenario parse collapsed: ${ids.length}`);
  return ids;
}

function loadSources() {
  return {
    contract: loadJson(CONTRACT_PATH),
    plan: loadJson(PLAN_PATH),
    state: loadJson(STATE_PATH),
    scenarioIds: specScenarioIds(),
  };
}

// A check contributes to a layer by its identity in the contract, never by
// hand-labelling: V_<AC> scenario checks are component evidence, V_INFRA_*/
// build/toolchain qualifications are environment, the three journey checks
// are same-run finality, everything else is gate support (it gates
// rw_completion but is not per-layer scenario evidence). A scenario-pattern
// check the contract binds to NO case module (the N-series new-profile
// checks, case_module null) has no component evidence channel and is
// classified gate_support — component_pass without a module would overclaim.
function classifyCheck(id, hasModule) {
  if (JOURNEY_IDS.includes(id)) return 'same_run_finality';
  if (ENV_LAYER_CHECKS(id)) return 'env_qualification';
  if (/^V_[A-Z]\d{2}$/.test(id) && hasModule !== false) return 'component_pass';
  return 'gate_support';
}

// Contract check status -> index verdict. Only an explicit PASS in the
// contract closes a check, and even a PASS without recorded readback evidence
// stays blocking (missing real readback). Everything else — including the
// current RETEST_REQUIRED_NEW_REPLAN reset and absent statuses — is UNVERIFIED.
function checkVerdict(check) {
  const status = check.current_status === 'PASS' ? 'PASS' : 'UNVERIFIED';
  const readback =
    typeof check.execution_evidence === 'string' &&
    check.execution_evidence.trim() &&
    fs.existsSync(path.join(ROOT, check.execution_evidence))
      ? 'RECORDED'
      : 'ABSENT';
  return { status, readback_evidence: readback };
}

function componentStatus(taskStatuses) {
  const vals = Object.values(taskStatuses);
  if (vals.length === 0) return 'UNVERIFIED';
  if (vals.some((s) => s.startsWith('REOPENED') || s === 'MISSING')) return 'UNVERIFIED';
  if (vals.some((s) => s === 'PARTIAL_ACCEPTED')) return 'PARTIAL_AT_DECLARED_SCOPE';
  if (vals.some((s) => s === 'ACCEPTED')) return 'MECHANISM_AT_DECLARED_SCOPE';
  if (vals.every((s) => s === 'ACCEPTED_DOCUMENT_ONLY')) return 'DOCUMENT_ONLY';
  return 'PARTIAL_AT_DECLARED_SCOPE';
}

// Pure generator: rebuild the whole index from the four sources. The same
// mechanism re-runs at the final VERIFY baseline — the committed file is a
// snapshot of this function, nothing else.
function deriveIndexFromSources({ contract, plan, state, scenarioIds }) {
  const checks = contract.checks;
  const byId = new Map(checks.map((c) => [c.id, c]));
  const aggregation = contract.acceptance_aggregation.scenario_required_checks;
  const nodeStatus = state.node_status ?? {};

  const required_checks = {};
  for (const c of checks) {
    const verdict = checkVerdict(c);
    required_checks[c.id] = {
      acceptance_ids: c.acceptance_ids,
      implementedBy: c.implementedBy,
      availability: c.availability,
      case_module: c.case_module,
      contract_status: c.current_status ?? null,
      layer: classifyCheck(c.id, Boolean(c.case_module)),
      status: verdict.status,
      readback_evidence: verdict.readback_evidence,
    };
  }

  const journeys = {};
  for (const [name, def] of Object.entries(plan.journey_definitions)) {
    journeys[name] = {
      required_check: def.required_check,
      construction_owner: def.owner,
      execution_owner: contract.journey_execution.owner,
      case_path: def.path,
      status: required_checks[def.required_check]?.status === 'PASS' ? 'PASS' : 'UNVERIFIED',
    };
  }

  const environment_gates = {
    from_partial_nodes: Object.entries(nodeStatus)
      .filter(([, v]) => v.steps_gated)
      .map(([task, v]) => ({ task, gated: v.steps_gated })),
    open_decisions: (state.open_decisions ?? []).map((d) => d.id),
    source: 'execution-state.json',
  };

  const scenarios = {};
  for (const ac of scenarioIds) {
    const own = byId.get(`V_${ac}`);
    assert.ok(own, `contract lacks the scenario check V_${ac}`);
    const aggregated = aggregation[ac];
    assert.ok(Array.isArray(aggregated) && aggregated.length > 0, `contract aggregation lacks scenario ${ac}`);
    const taskStatuses = {};
    for (const t of own.task_ids) {
      if (t === 'VERIFY') continue;
      taskStatuses[t] = nodeStatus[t]?.status ?? 'MISSING';
    }
    const evidence = [];
    for (const [t, st] of Object.entries(taskStatuses)) {
      // merged_to_master is sometimes annotated ("37ba350+", "cbe4dc5 (second
      // merge ...)") — the commit anchor is the leading SHA token, and the
      // validator re-resolves it against the git object store.
      const raw = nodeStatus[t]?.merged_to_master;
      const sha = typeof raw === 'string' ? (raw.match(/^[0-9a-f]{7,40}/) ?? [null])[0] : null;
      if (st === 'ACCEPTED' && sha) evidence.push(`${CHANGE}/execution-state.json :: commit:${sha}`);
    }
    const envChecks = aggregated.filter((id) => classifyCheck(id) === 'env_qualification');
    const journeyChecks = aggregated.filter((id) => classifyCheck(id) === 'same_run_finality');
    scenarios[ac] = {
      case_module: own.case_module,
      required_checks: [...aggregated],
      component_pass: {
        status: componentStatus(taskStatuses),
        tasks: taskStatuses,
        evidence,
      },
      env_qualification: {
        status: envChecks.length > 0 && envChecks.every((id) => required_checks[id]?.status === 'PASS') ? 'QUALIFIED' : 'UNVERIFIED',
        checks: envChecks,
      },
      same_run_finality: {
        // Every original scenario consumes the global same-Run terminal
        // evidence (mandatory terminal layer), so finality requires ALL THREE
        // journeys PASS plus the scenario's own journey checks if any. An
        // empty journey_checks list must NOT read as VERIFIED (vacuous truth).
        status:
          journeyChecks.every((id) => required_checks[id]?.status === 'PASS') && Object.values(journeys).every((j) => j.status === 'PASS')
            ? 'VERIFIED'
            : 'UNVERIFIED',
        journey_checks: journeyChecks,
        owner: contract.journey_execution.owner,
      },
      deployment_status: 'NOT_DELIVERED',
      scenario_status: aggregated.every((id) => required_checks[id]?.status === 'PASS' && required_checks[id]?.readback_evidence === 'RECORDED')
        ? 'PASS'
        : 'UNVERIFIED',
    };
  }

  const historicalResult = nodeStatus.VERIFY?.result ?? null;

  return {
    schema_version: 2,
    change: 'delivery-foundation-rearchitecture',
    acceptance_id: 'B10',
    semantics_source: 'specs/delivery-foundation/spec.md (104 scenarios, sole semantic source)',
    generated_from: {
      execution_contract: `${CHANGE}/execution-contract.json (130 required checks)`,
      verification_case_plan: `${CHANGE}/verification-case-plan.json (104 cases, 3 journeys)`,
      execution_state: `${CHANGE}/execution-state.json (node_status/open_p1 snapshot)`,
      regenerate_command: 'node test/delivery-cases/4_3.mjs --generate',
    },
    generated_at: new Date().toISOString(),
    generated_by: 'P4_3 rework r1 (rework/p4-3)',
    layer_definitions: {
      component_pass:
        '组件通过 — 构建任务在其声明范围内交付的机制证据（当前候选提交指针）；组件通过永不覆盖缺失/未执行的真实路径检查',
      env_qualification: '环境资格 — 真实 Outline 活栈、.sdd 预备构建、钉定工具链、真实 Registry/Runner 等环境资格；与组件通过分开登记',
      same_run_finality:
        '同 Run 终局 — 三旅程（same-run-delivery / real-comet-recovery / post-delivery-permissions）在同一产品 Run 内的终局 oracle，executionOwner=VERIFY；构建方交付配方不等于旅程已跑',
      deployment_status: '部署状态 — delivered 判定；目标环境确认前不得 delivered（B10）',
    },
    status_rule: {
      PASS: '当前修订真实执行且独立读回在案（readback_evidence=RECORDED）',
      MECHANISM_AT_DECLARED_SCOPE: '构建任务 ACCEPTED：机制已在声明范围交付（指针=当前候选合并提交）；不是旅程/场景 PASS',
      PARTIAL_AT_DECLARED_SCOPE: '存在 PARTIAL_ACCEPTED 任务（steps_gated 在案）；不是场景 PASS',
      DOCUMENT_ONLY: '仅有文档型验收（ACCEPTED_DOCUMENT_ONLY），无可执行机制',
      UNVERIFIED: '本修订未执行/无当前证据；UNVERIFIED 保持 UNVERIFIED',
      QUALIFIED: '该场景全部环境资格检查 PASS',
      VERIFIED: '该场景消费的同 Run 旅程检查 PASS',
      NOT_DELIVERED: '目标环境未确认，不得声明 delivered',
    },
    required_checks,
    journeys,
    environment_gates,
    open_p1: (state.open_p1 ?? []).filter((p) => p.status === 'OPEN').map((p) => p.id),
    historical: {
      verify_result: historicalResult,
      inherited: false,
      rule: '历史 VERIFY 结果（108 检查 87 PASS、92 场景 76/15/1 分割）只作历史记录；本修订状态只由当前来源推导，不自动继承',
    },
    deployment: {
      status: 'NOT_DELIVERED',
      rule: 'B10: delivered 只能在目标环境确认后声明；与代码验收/规格归档分开',
      confirmation_evidence: null,
    },
    scenarios,
  };
}

// The judge. Deliberately reads ONLY: required_checks[].status/readback,
// scenario→required_checks wiring, journeys[].status and open_p1. Holder
// fields, explicit dispositions and the historical section are invisible to
// it — they can never upgrade completion (Step 7 semantics).
function evaluateCompletion(index) {
  const checks = index.required_checks ?? {};
  const notPass = [];
  const noReadback = [];
  for (const [id, c] of Object.entries(checks)) {
    if (c.status !== 'PASS') notPass.push(id);
    if (c.readback_evidence !== 'RECORDED') noReadback.push(id);
  }
  const scenariosNotClosed = Object.entries(index.scenarios ?? {})
    .filter(([, s]) =>
      (s.required_checks ?? []).some((id) => {
        const c = checks[id];
        return !c || c.status !== 'PASS' || c.readback_evidence !== 'RECORDED';
      }),
    )
    .map(([id]) => id);
  const journeysNotRun = Object.entries(index.journeys ?? {})
    .filter(([, j]) => j.status !== 'PASS')
    .map(([id]) => id);
  const openP1 = index.open_p1 ?? [];
  // The blocking panel carries both instrument vocabularies: the original
  // not-pass/missing-readback counts and the comet-050 revision tallies
  // (checks_failed / checks_not_executed) that 5_1.a-4 re-validates against
  // the same artifact — one judge, both readbacks, no hand-tuned numbers.
  const failed = Object.values(checks).filter((c) => c.status === 'FAIL').length;
  const notExecuted = Object.values(checks).filter((c) => c.status !== 'PASS' && c.status !== 'FAIL').length;
  const complete =
    notPass.length === 0 &&
    noReadback.length === 0 &&
    scenariosNotClosed.length === 0 &&
    journeysNotRun.length === 0 &&
    openP1.length === 0;
  return {
    complete,
    blocking: {
      required_checks_not_pass: notPass.length,
      checks_failed: failed,
      checks_not_executed: notExecuted,
      missing_readback: noReadback.length,
      scenarios_not_closed: scenariosNotClosed.length,
      journeys_not_run: journeysNotRun.length,
      open_p1: openP1.length,
    },
  };
}

function resolvePointer(pointer, problems, label) {
  if (typeof pointer !== 'string' || !pointer.includes(' :: ')) {
    problems.push(`${label}: malformed pointer (expected "path :: anchor"): ${pointer}`);
    return;
  }
  const sep = pointer.indexOf(' :: ');
  const rel = pointer.slice(0, sep);
  const anchor = pointer.slice(sep + 4);
  if (anchor.startsWith('commit:')) {
    const sha = anchor.slice('commit:'.length).trim();
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT, stdio: 'pipe' });
    } catch {
      problems.push(`${label}: commit anchor does not resolve: ${sha}`);
    }
    return;
  }
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    problems.push(`${label}: evidence file missing: ${rel}`);
    return;
  }
  if (!fs.readFileSync(abs, 'utf8').includes(anchor)) {
    problems.push(`${label}: anchor "${anchor}" not found in ${rel}`);
  }
}

function validateIndex(index, sources) {
  const problems = [];
  const { contract, plan, state, scenarioIds } = sources;

  if (index.schema_version !== 2) problems.push(`index schema_version must be 2, got ${index.schema_version}`);
  for (const layer of EVIDENCE_LAYERS) {
    if (!index.layer_definitions?.[layer]) problems.push(`layer_definitions missing "${layer}"`);
  }

  const scenarios = index.scenarios ?? {};
  const indexed = new Set(Object.keys(scenarios));
  for (const id of scenarioIds) {
    if (!indexed.has(id)) problems.push(`scenario ${id} from spec.md is not mapped in the index`);
  }
  for (const id of indexed) {
    if (!scenarioIds.includes(id)) problems.push(`index maps unknown acceptance ID ${id} (not in spec.md)`);
  }

  const contractChecks = new Map(contract.checks.map((c) => [c.id, c]));
  const aggregation = contract.acceptance_aggregation.scenario_required_checks;
  const recordedChecks = index.required_checks ?? {};
  for (const c of contract.checks) {
    if (!recordedChecks[c.id]) problems.push(`required check ${c.id} from contract is not indexed`);
  }
  for (const id of Object.keys(recordedChecks)) {
    if (!contractChecks.has(id)) problems.push(`index lists unknown required check ${id} (not in contract)`);
  }
  for (const [id, rec] of Object.entries(recordedChecks)) {
    const c = contractChecks.get(id);
    if (!c) continue;
    if (JSON.stringify(rec.acceptance_ids) !== JSON.stringify(c.acceptance_ids)) problems.push(`check ${id}: acceptance_ids drift vs contract`);
    if (rec.implementedBy !== c.implementedBy) problems.push(`check ${id}: implementedBy drift vs contract`);
    if (rec.availability !== c.availability) problems.push(`check ${id}: availability drift vs contract`);
    if (rec.case_module !== c.case_module) problems.push(`check ${id}: case_module drift vs contract`);
    if (rec.layer !== classifyCheck(id, Boolean(c.case_module))) problems.push(`check ${id}: layer classification ${rec.layer} != contract rule`);
    if (!CHECK_STATUS.has(rec.status)) problems.push(`check ${id}: bad status "${rec.status}"`);
    if (rec.status === 'PASS' && rec.readback_evidence !== 'RECORDED') {
      problems.push(`check ${id}: PASS without recorded readback evidence`);
    }
  }

  const nodeStatus = state.node_status ?? {};
  const expectedOpenP1 = (state.open_p1 ?? []).filter((p) => p.status === 'OPEN').map((p) => p.id);
  if (JSON.stringify(index.open_p1 ?? []) !== JSON.stringify(expectedOpenP1)) {
    problems.push('open_p1 disagrees with execution-state OPEN items');
  }

  for (const [ac, s] of Object.entries(scenarios)) {
    const label = `scenario ${ac}`;
    const aggregated = aggregation[ac] ?? [];
    const got = [...(s.required_checks ?? [])].sort();
    if (JSON.stringify(got) !== JSON.stringify([...aggregated].sort())) {
      problems.push(`${label}: required_checks mismatch vs contract aggregation`);
    }
    for (const layer of EVIDENCE_LAYERS) {
      if (layer === 'deployment_status') {
        if (!LAYER_STATUS[layer].has(s[layer])) problems.push(`${label}: bad deployment_status "${s[layer]}"`);
        continue;
      }
      const val = s[layer];
      if (!val || typeof val !== 'object') {
        problems.push(`${label}: layer ${layer} missing`);
        continue;
      }
      if (!LAYER_STATUS[layer].has(val.status)) problems.push(`${label}: bad ${layer} status "${val.status}"`);
    }
    // component layer: no overclaim vs the controller ledger
    const own = contractChecks.get(`V_${ac}`);
    for (const t of (own?.task_ids ?? []).filter((t) => t !== 'VERIFY')) {
      const recorded = s.component_pass?.tasks?.[t];
      const actual = nodeStatus[t]?.status ?? 'MISSING';
      if (recorded !== actual) {
        problems.push(`${label}: component overclaim — task ${t} recorded ${recorded} but execution-state says ${actual}`);
      }
    }
    for (const p of s.component_pass?.evidence ?? []) resolvePointer(p, problems, `${label} component evidence`);
    // scenario_status must equal the derived closure of its required checks
    const derived = aggregated.every((id) => recordedChecks[id]?.status === 'PASS' && recordedChecks[id]?.readback_evidence === 'RECORDED')
      ? 'PASS'
      : 'UNVERIFIED';
    if (s.scenario_status !== derived) {
      problems.push(`${label}: scenario_status "${s.scenario_status}" != derived "${derived}"`);
    }
  }

  // journeys must be exactly the plan's three, wired to the contract checks
  const planJourneys = plan.journey_definitions ?? {};
  for (const [name, def] of Object.entries(planJourneys)) {
    const j = index.journeys?.[name];
    if (!j) {
      problems.push(`journey ${name} from verification-case-plan is missing in the index`);
      continue;
    }
    if (j.required_check !== def.required_check || !contractChecks.has(def.required_check)) {
      problems.push(`journey ${name}: required_check wiring drift`);
    }
    if (j.execution_owner !== contract.journey_execution.owner) problems.push(`journey ${name}: execution_owner must be ${contract.journey_execution.owner}`);
    if (j.status !== 'PASS' && j.status !== 'UNVERIFIED') problems.push(`journey ${name}: bad status "${j.status}"`);
  }
  for (const name of Object.keys(index.journeys ?? {})) {
    if (!planJourneys[name]) problems.push(`index lists unknown journey ${name}`);
  }

  // historical results are quarantined and never verdict-bearing
  if (index.historical?.inherited !== false) problems.push('historical.inherited must be false — history never auto-closes this revision');

  // deployment separation: DELIVERED needs recorded confirmation evidence
  const dep = index.deployment ?? {};
  if (dep.status === 'DELIVERED') {
    const ev = dep.confirmation_evidence;
    if (typeof ev !== 'string' || !ev.trim()) problems.push('deployment DELIVERED without confirmation_evidence is forbidden (B10)');
    else resolvePointer(ev, problems, 'deployment confirmation');
  }

  // summary and the recorded gate verdict must equal recomputation
  if (index.summary) {
    const perLayer = {};
    for (const layer of EVIDENCE_LAYERS) perLayer[layer] = {};
    for (const s of Object.values(scenarios)) {
      for (const layer of EVIDENCE_LAYERS) {
        const st = layer === 'deployment_status' ? s[layer] : s[layer]?.status;
        perLayer[layer][st] = (perLayer[layer][st] ?? 0) + 1;
      }
    }
    if (JSON.stringify(index.summary.layer_statuses) !== JSON.stringify(perLayer)) {
      problems.push('summary.layer_statuses disagrees with scenario entries');
    }
    const checkStatuses = {};
    for (const rec of Object.values(recordedChecks)) checkStatuses[rec.status] = (checkStatuses[rec.status] ?? 0) + 1;
    if (JSON.stringify(index.summary.required_check_statuses) !== JSON.stringify(checkStatuses)) {
      problems.push('summary.required_check_statuses disagrees with required_checks');
    }
  } else {
    problems.push('index.summary missing');
  }

  const evaluated = evaluateCompletion(index);
  if (!index.rw_completion || index.rw_completion.rule !== 'RW_COMPLETION_REQUIRED') {
    problems.push('index.rw_completion missing or not governed by RW_COMPLETION_REQUIRED');
  } else if (index.rw_completion.complete !== evaluated.complete) {
    problems.push(`rw_completion.complete=${index.rw_completion.complete} disagrees with recomputation (${evaluated.complete})`);
  } else if (JSON.stringify(index.rw_completion.blocking) !== JSON.stringify(evaluated.blocking)) {
    problems.push('rw_completion.blocking disagrees with recomputation');
  }

  return problems;
}

// ---------------------------------------------------------------- tests ----

function loadIndexOrThrow() {
  return loadJson(INDEX_PATH);
}

function layerStatusCounts(index) {
  const perLayer = {};
  for (const layer of EVIDENCE_LAYERS) perLayer[layer] = {};
  for (const s of Object.values(index.scenarios)) {
    for (const layer of EVIDENCE_LAYERS) {
      const st = layer === 'deployment_status' ? s[layer] : s[layer]?.status;
      perLayer[layer][st] = (perLayer[layer][st] ?? 0) + 1;
    }
  }
  return perLayer;
}

function passingFixture(base) {
  const passing = JSON.parse(JSON.stringify(base));
  for (const rec of Object.values(passing.required_checks)) {
    rec.status = 'PASS';
    rec.readback_evidence = 'RECORDED';
  }
  for (const s of Object.values(passing.scenarios)) s.scenario_status = 'PASS';
  for (const j of Object.values(passing.journeys)) j.status = 'PASS';
  passing.open_p1 = [];
  return passing;
}

test('RW_COMPLETION_REQUIRED setup: schema-2 index and verification.md exist, four evidence-status layers declared, deployment separated', () => {
  const index = loadIndexOrThrow();
  assert.equal(index.schema_version, 2);
  for (const layer of EVIDENCE_LAYERS) {
    assert.ok(index.layer_definitions?.[layer], `layer_definitions must declare "${layer}"`);
    assert.ok(JSON.stringify(index).includes(`"${layer}"`), `index must carry layer "${layer}" data`);
  }
  const md = fs.readFileSync(VERIFICATION_MD_PATH, 'utf8');
  for (const layer of EVIDENCE_LAYERS) assert.ok(md.includes(layer), `verification.md must document the "${layer}" layer`);
  assert.ok(md.includes('delivered'), 'verification.md must separate the delivered claim from target-environment confirmation');
});

test('RW_COMPLETION_REQUIRED (a): 104 scenarios map 1:1 to spec.md and all 130 required checks are indexed with faithful contract fields', () => {
  const index = loadIndexOrThrow();
  const problems = validateIndex(index, loadSources());
  assert.deepEqual(
    problems.filter(
      (p) => p.includes('not mapped') || p.includes('unknown acceptance') || p.includes('not indexed') || p.includes('unknown required check'),
    ),
    [],
  );
  assert.equal(Object.keys(index.scenarios).length, 104);
  assert.equal(Object.keys(index.required_checks).length, 130);
  assert.deepEqual(problems.filter((p) => p.includes('drift')), []);
});

test('RW_COMPLETION_REQUIRED (b): every scenario wires exactly the contract aggregation of required checks', () => {
  const index = loadIndexOrThrow();
  const problems = validateIndex(index, loadSources());
  assert.deepEqual(problems.filter((p) => p.includes('required_checks mismatch')), []);
});

test('RW_COMPLETION_REQUIRED (c): component evidence resolves to real commits and never overclaims the controller ledger', () => {
  const index = loadIndexOrThrow();
  const problems = validateIndex(index, loadSources());
  assert.deepEqual(problems.filter((p) => p.includes('component overclaim') || p.includes('component evidence') || p.includes('commit anchor')), []);
});

test('RW_COMPLETION_REQUIRED (d): statuses and the gate verdict are computed from current sources, not asserted', () => {
  const index = loadIndexOrThrow();
  const problems = validateIndex(index, loadSources());
  assert.deepEqual(
    problems.filter((p) => p.includes('scenario_status') || p.includes('rw_completion') || p.includes('bad status') || p.includes('layer classification')),
    [],
  );
  const evaluated = evaluateCompletion(index);
  assert.equal(index.rw_completion.complete, evaluated.complete);
  assert.deepEqual(index.rw_completion.blocking, evaluated.blocking);
});

test('RW_COMPLETION_REQUIRED (e): the current index is honestly incomplete — every unexecuted required check, scenario and journey still blocks', () => {
  const index = loadIndexOrThrow();
  const evaluated = evaluateCompletion(index);
  assert.equal(evaluated.complete, false, 'with unexecuted required checks the change must stay NOT complete');
  const state = loadJson(STATE_PATH);
  const openP1 = (state.open_p1 ?? []).filter((p) => p.status === 'OPEN').length;
  // Denominator: 130 required checks — after the FINAL-VERIFY round 21 direct
  // checks are real PASS with recorded readback evidence; the 106 journey/
  // scenario checks and V_F10 stay honestly unexecuted on the managed plane.
  assert.equal(evaluated.blocking.required_checks_not_pass, 109);
  assert.equal(evaluated.blocking.checks_failed, 0);
  assert.equal(evaluated.blocking.checks_not_executed, 109);
  assert.equal(evaluated.blocking.missing_readback, 109);
  assert.equal(evaluated.blocking.scenarios_not_closed, 104);
  assert.equal(evaluated.blocking.journeys_not_run, 3);
  assert.equal(evaluated.blocking.open_p1, openP1);
  // The seven-P1 register moved out of execution-state.json during the
  // comet-050 replan (successor ledger: the tiered gap registry in
  // verification-results.json). The stale "> 0" world-oracle is replaced by
  // the exact current truth — the state and the index agree on zero.
  assert.equal(openP1, 0, 'execution-state carries no open_p1 register anymore (moved to the tiered gap registry); the ledger and the index must agree on zero');
});

test('RW_COMPLETION_REQUIRED (f): holder and explicit disposition never upgrade — injecting them changes no status and no verdict', () => {
  const index = loadIndexOrThrow();
  const before = evaluateCompletion(index);
  const mutated = JSON.parse(JSON.stringify(index));
  for (const rec of Object.values(mutated.required_checks)) {
    rec.holder = 'someone';
    rec.explicit_disposition = 'accepted-by-holder';
  }
  for (const s of Object.values(mutated.scenarios)) {
    s.holder = 'someone';
    s.explicit_disposition = 'waived-by-holder';
  }
  for (const j of Object.values(mutated.journeys)) {
    j.holder = 'someone';
    j.explicit_disposition = 'accepted-by-holder';
  }
  const after = evaluateCompletion(mutated);
  assert.deepEqual(after, before, 'holder/disposition fields must be invisible to the evaluator');
  assert.equal(mutated.required_checks['V_A01'].status, index.required_checks['V_A01'].status, 'statuses untouched');
});

test('RW_COMPLETION_REQUIRED (g): historical 76/87 never inherits — replaying historical VERIFIED/PASS labels changes nothing', () => {
  const index = loadIndexOrThrow();
  const before = evaluateCompletion(index);
  const mutated = JSON.parse(JSON.stringify(index));
  for (const rec of Object.values(mutated.required_checks)) {
    rec.contract_status = 'PASS';
    rec.historical_result = 'PASS @old-baseline (87/108 historical)';
  }
  for (const s of Object.values(mutated.scenarios)) {
    s.historical_status = 'VERIFIED (76/92 historical)';
  }
  mutated.historical.verify_result = '108 checks real-executed (87 PASS/18 GATED/1 UNVERIFIED/2 FAILED documented)';
  const after = evaluateCompletion(mutated);
  assert.deepEqual(after, before, 'historical labels must be invisible to the evaluator');
  assert.equal(mutated.historical.inherited, false);
});

test('RW_COMPLETION_REQUIRED (h): an all-PASS index with recorded readbacks, closed journeys and zero open P1 flips the verdict — the gate judges', () => {
  const index = loadIndexOrThrow();
  const passing = passingFixture(index);
  const evaluated = evaluateCompletion(passing);
  assert.equal(evaluated.complete, true, 'the judge must be able to complete when everything really passed');
  assert.equal(evaluated.blocking.open_p1, 0);
});

test('RW_COMPLETION_REQUIRED (i): any single FAIL/GATED/UNVERIFIED/skipped check or missing readback keeps the verdict NOT complete', () => {
  const base = loadIndexOrThrow();
  const someCheck = Object.keys(base.required_checks)[0];
  for (const bad of ['FAIL', 'GATED', 'UNVERIFIED', 'SKIPPED']) {
    const idx = passingFixture(base);
    idx.required_checks[someCheck].status = bad;
    assert.equal(evaluateCompletion(idx).complete, false, `${bad} on one required check must keep the change incomplete`);
  }
  const noReadback = passingFixture(base);
  noReadback.required_checks[someCheck].readback_evidence = 'ABSENT';
  assert.equal(evaluateCompletion(noReadback).complete, false, 'missing real readback must keep the change incomplete');

  const openP1 = passingFixture(base);
  openP1.open_p1 = ['P1-07'];
  assert.equal(evaluateCompletion(openP1).complete, false, 'one open P1 must keep the change incomplete');

  const journeyPending = passingFixture(base);
  journeyPending.journeys[Object.keys(journeyPending.journeys)[0]].status = 'UNVERIFIED';
  assert.equal(evaluateCompletion(journeyPending).complete, false, 'one unrun journey must keep the change incomplete');
});

test('RW_COMPLETION_REQUIRED (j): a missing journey definition keeps the verdict incomplete and fails validation', () => {
  const index = loadIndexOrThrow();
  const mutated = JSON.parse(JSON.stringify(index));
  const dropped = Object.keys(mutated.journeys)[0];
  delete mutated.journeys[dropped];
  const problems = validateIndex(mutated, loadSources());
  assert.ok(problems.some((p) => p.includes(`journey ${dropped}`)), 'validator must flag the dropped journey');
  const evaluated = evaluateCompletion(mutated);
  assert.equal(evaluated.complete, false, 'completion requires all three journeys present AND passed');
});

test('RW_COMPLETION_REQUIRED (k): deployment stays NOT_DELIVERED and cannot claim delivered without confirmation evidence', () => {
  const index = loadIndexOrThrow();
  assert.equal(index.deployment.status, 'NOT_DELIVERED');
  const mutated = JSON.parse(JSON.stringify(index));
  mutated.deployment.status = 'DELIVERED';
  mutated.deployment.confirmation_evidence = null;
  const problems = validateIndex(mutated, loadSources());
  assert.ok(
    problems.some((p) => p.includes('DELIVERED without confirmation_evidence')),
    'delivered must be impossible to declare without target-environment confirmation',
  );
});

test('B10 negative: deleting one scenario mapping fails validation', () => {
  const index = loadIndexOrThrow();
  const sources = loadSources();
  const dropped = sources.scenarioIds[sources.scenarioIds.length - 1];
  delete index.scenarios[dropped];
  const problems = validateIndex(index, sources);
  assert.ok(problems.some((p) => p.includes(`${dropped} from spec.md is not mapped`)), 'validator must fail on a deleted scenario mapping');
});

test('B10 negative: a fabricated evidence pointer fails validation', () => {
  const index = loadIndexOrThrow();
  const sources = loadSources();
  const first = sources.scenarioIds[0];
  index.scenarios[first].component_pass.evidence.push(
    'openspec/changes/delivery-foundation-rearchitecture/worker-reports/DOES_NOT_EXIST.json :: fabricated',
  );
  const problems = validateIndex(index, sources);
  assert.ok(
    problems.some((p) => p.includes('evidence file missing') || p.includes('anchor')),
    'validator must fail on a fabricated evidence pointer',
  );
});

test('B10 negative: an invalid layer enum fails validation', () => {
  const index = loadIndexOrThrow();
  const sources = loadSources();
  const first = sources.scenarioIds[0];
  index.scenarios[first].component_pass.status = 'quantum';
  const problems = validateIndex(index, sources);
  assert.ok(problems.some((p) => p.includes(`${first}: bad component_pass status "quantum"`)));
});

test('B10 negative: summary drift (hand-tuned green) fails validation', () => {
  const index = loadIndexOrThrow();
  const sources = loadSources();
  const counts = layerStatusCounts(index);
  index.summary.layer_statuses = counts;
  index.summary.layer_statuses.component_pass.MECHANISM_AT_DECLARED_SCOPE += 1;
  const problems = validateIndex(index, sources);
  assert.ok(problems.some((p) => p.includes('summary.layer_statuses disagrees')));
});

// ------------------------------------------------------ regeneration CLI ---
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile && process.argv.includes('--generate')) {
  const sources = loadSources();
  const index = deriveIndexFromSources(sources);
  const evaluated = evaluateCompletion(index);
  index.rw_completion = {
    rule: 'RW_COMPLETION_REQUIRED',
    complete: evaluated.complete,
    blocking: evaluated.blocking,
  };
  index.summary = {
    scenarios: Object.keys(index.scenarios).length,
    required_checks: Object.keys(index.required_checks).length,
    layer_statuses: layerStatusCounts(index),
    required_check_statuses: (() => {
      const byStatus = {};
      for (const rec of Object.values(index.required_checks)) byStatus[rec.status] = (byStatus[rec.status] ?? 0) + 1;
      return byStatus;
    })(),
    required_checks_by_layer: (() => {
      const byLayer = {};
      for (const rec of Object.values(index.required_checks)) byLayer[rec.layer] = (byLayer[rec.layer] ?? 0) + 1;
      return byLayer;
    })(),
  };
  const problems = validateIndex(index, sources);
  if (problems.length > 0) {
    console.error('refusing to write a self-inconsistent index:\n' + problems.join('\n'));
    process.exit(2);
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
  console.log(
    `regenerated ${path.relative(ROOT, INDEX_PATH)} — scenarios=${index.summary.scenarios} checks=${index.summary.required_checks} complete=${evaluated.complete}`,
  );
}
