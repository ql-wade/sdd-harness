// SDD.Gate.v1 — pure gate evaluation for the delivery foundation
// (task 2.2.b, A18/B03/B06 plus A06 and stale-receipt defense).
//
// evaluate(inputs, receipts, policy) returns only a verdict and a GateReceipt
// validated against contracts/delivery. It never dispatches, never writes a
// current-stage, never touches the filesystem: the module imports no
// execution or persistence channel at all, and identical inputs produce a
// byte-identical receipt. Gate stores judgments and grounds only — execution
// phases belong to the single Runtime (delivery-architecture.md section 5).
//
// Receipts are the entries admission produced (lib/delivery/evidence.js).
// The gate re-verifies what it can structurally: entry digest vs envelope
// content (tamper), dispatch binding vs current policy/input digests (stale),
// and that no receipt execution is the builder execution (A06). Required
// capabilities stay blocked on missing receipts (A18), UNVERIFIED results
// (A18), observation-kind substitution (B06: the capability string is the
// substitution boundary — a service log is never a console) and
// authoring-only coverage (B03).
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { parseContract } from './contracts-delivery-index.mjs';
import { admitEvidence, envelopeDigest } from './lib-delivery-evidence.mjs';
import { evaluateExecutionDenominator } from './lib-delivery-test_contract.mjs';

const SHA256_RE = /^[a-f0-9]{64}$/;

// The digest of the empty judged set: the receipt schema always carries an
// evidence set; an honest empty set is digested rather than fabricated.
export const EMPTY_EVIDENCE_SET_DIGEST = createHash('sha256').update('[]').digest('hex');

function validPlanGraph(tasks) {
  const pending = new Map();
  const dependents = new Map();
  for (const task of tasks) {
    if (pending.has(task.id)) return false;
    const deps = task.dependsOn ?? [];
    if (new Set(deps).size !== deps.length) return false;
    pending.set(task.id, deps.length);
    dependents.set(task.id, []);
  }
  for (const task of tasks) for (const dep of task.dependsOn ?? []) {
    if (!dependents.has(dep)) return false;
    dependents.get(dep).push(task.id);
  }
  const ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length) {
    const id = ready.pop(); visited++;
    for (const next of dependents.get(id)) {
      pending.set(next, pending.get(next) - 1);
      if (pending.get(next) === 0) ready.push(next);
    }
  }
  return visited === pending.size;
}

function isAsyncResult(value) {
  if (types.isPromise(value)) {
    Promise.prototype.then.call(value, undefined, () => {});
    return true;
  }
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

export function evaluate(inputs, receipts, policy, options = {}) {
  const boundary = { scope: options.requireManaged === true ? 'component/source-bound-coverage' : 'component/receipt-coverage', managedClosureEligible: false };
  // Frozen inputs must be valid before the gate judges anything.
  const requirementsOrArchitecture = options.requireManaged === true && ['R', 'A'].includes(options.currentGate) && inputs?.testContract === undefined;
  const planGate = options.requireManaged === true && options.currentGate === 'P';
  const parsedPlan = planGate ? parseContract('SDD.Delivery.PlanBundle', inputs?.planBundle) : null;
  if (parsedPlan && !parsedPlan.ok) throw new Error(`INVALID_PLAN_BUNDLE: the gate refuses to judge — ${parsedPlan.errors.join('; ')}`);
  const parsedContract = requirementsOrArchitecture || planGate ? { ok: true, value: null } : parseContract('SDD.Delivery.TestContract', inputs?.testContract);
  if (!parsedContract.ok) {
    throw new Error(`INVALID_TEST_CONTRACT: the gate refuses to judge — ${parsedContract.errors.join('; ')}`);
  }
  const preBuildGate = options.requireManaged === true && ['R', 'A', 'T', 'P'].includes(options.currentGate);
  const builderMissingBeforeBuild = preBuildGate && inputs?.builderExecution === undefined;
  if (!inputs || typeof inputs.inputDigest !== 'string' || !SHA256_RE.test(inputs.inputDigest)
    || (!builderMissingBeforeBuild && (typeof inputs.builderExecution !== 'string' || inputs.builderExecution.length === 0))) {
    throw new Error('INVALID_INPUTS: the gate refuses to judge — inputs must carry a sha256 inputDigest and a non-empty builderExecution');
  }
  if (!policy || typeof policy !== 'object' || typeof policy.ref !== 'string' || policy.ref.length === 0
    || typeof policy.digest !== 'string' || !SHA256_RE.test(policy.digest)) {
    throw new Error('INVALID_POLICY: the gate refuses to judge — policy must be { ref: string, digest: sha256 }');
  }
  if (!Array.isArray(receipts)) {
    throw new Error('INVALID_RECEIPTS: the gate refuses to judge — receipts must be an array of admission entries');
  }

  // Structural defense: tampered, stale and builder-identity receipts can
  // never satisfy a capability. First failure per entry wins; the entry is
  // excluded from satisfaction but stays visible in the blocked reasons.
  const blocked = [];
  const invalidPolicy = options.requireManaged !== undefined && typeof options.requireManaged !== 'boolean';
  if (invalidPolicy) blocked.push('INVALID_PROTECTED_POLICY: requireManaged must be a protected boolean option');
  const managed = options.requireManaged === true;
  const requirementsGate = managed && options.currentGate === 'R';
  const testDesignGate = managed && options.currentGate === 'T';
  const architectureGate = managed && options.currentGate === 'A';
  const designReviewGate = requirementsGate || testDesignGate || architectureGate || planGate;
  if (planGate && (typeof options.currentChange !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.currentChange)
    || ![`openspec/changes/${options.currentChange}`, `docs/openspec/changes/${options.currentChange}`].includes(options.currentChangeDir)
    || parsedPlan.value.change !== options.currentChange || parsedPlan.value.schedulerOwner !== 'comet-classic'
    || inputs.planSources?.tasks?.ref !== `${options.currentChangeDir}/tasks.md`
    || inputs.planSources?.dag?.ref !== `${options.currentChangeDir}/task-dag.json`
    || !SHA256_RE.test(inputs.planSources?.tasks?.digest ?? '')
    || !SHA256_RE.test(inputs.planSources?.dag?.digest ?? ''))) {
    blocked.push('PLAN_BINDING_REQUIRED: the plan must belong to the current Change and the Comet controller');
  }
  if (planGate && !validPlanGraph(parsedPlan.value.tasks)) blocked.push('PLAN_GRAPH_INVALID: duplicate, missing or cyclic task dependencies');
  const manualDesign = managed && options.currentGate === 'V' && parsedContract.value.sourceReadiness === 'design_only';
  let manualApproval = null;
  if (manualDesign) {
    const contract = parsedContract.value;
    const requiredCases = contract.cases.filter((entry) => entry.required !== false).map((entry) => entry.id).sort();
    try {
      const result = typeof options.verifyManualApproval === 'function'
        ? options.verifyManualApproval({runId:options.currentRunId, inputs, policy}) : null;
      if (!isAsyncResult(result) && result?.ok === true && result.authority === 'human'
        && typeof result.principal === 'string' && result.principal.trim()
        && result.runId === options.currentRunId && result.inputDigest === inputs.inputDigest
        && result.policyDigest === policy.digest && result.contractDigest === envelopeDigest(contract)
        && SHA256_RE.test(result.evidenceDigest ?? '') && Array.isArray(result.caseIds)
        && result.caseIds.every((id) => typeof id === 'string') && new Set(result.caseIds).size === result.caseIds.length
        && JSON.stringify([...result.caseIds].sort()) === JSON.stringify(requiredCases)
        && contract.requiredChecks.every((check) => check.mode === 'manual')) manualApproval = result;
    } catch { /* unavailable approval is a refusal, never an implicit pass */ }
    if (!manualApproval) blocked.push('TEST_DESIGN_ONLY_NOT_EXECUTABLE: manual cases need a current protected human approval and exclusively manual scope');
  }
  const synchronous = (port) => typeof port === 'function' && !['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(port.constructor?.name);
  const managedPorts = synchronous(options.admissionOptionsFor) && synchronous(options.verifyReview);
  const managedScope = typeof options.currentRunId === 'string' && !!options.currentRunId.trim()
    && typeof options.currentGate === 'string' && !!options.currentGate.trim();
  const strictContract = !managed || requirementsOrArchitecture || planGate || parsedContract.value.commandBindingsRequired === true;
  if (!strictContract) blocked.push('STRICT_TEST_CONTRACT_REQUIRED: managed source coverage requires command-bound intent');
  if (managed && !managedPorts) blocked.push('MANAGED_SOURCE_REQUIRED: protected admission context and independent review verifier are required');
  if (managed && !managedScope) blocked.push('MANAGED_SCOPE_REQUIRED: protected current Run and gate are required');
  const clean = [];
  const reviewEvidence = new Map();
  for (const submitted of receipts) {
    let entry = submitted;
    if (invalidPolicy) continue;
    if (managed) {
      if (!managedPorts || !strictContract || !managedScope) continue;
      try {
        let protectedContext = options.admissionOptionsFor(submitted);
        if (isAsyncResult(protectedContext)) { blocked.push('ASYNC_MANAGED_PORT_REFUSED: source context must be synchronous'); continue; }
        if (manualDesign && manualApproval && (!Array.isArray(protectedContext?.authoringPrincipals)
          || !protectedContext.authoringPrincipals.length
          || protectedContext.authoringPrincipals.some((principal) => typeof principal !== 'string' || !principal.trim()))) {
          blocked.push('MANUAL_AUTHOR_IDENTITY_REQUIRED: independent acceptance requires known authors'); continue;
        }
        // A protected readback of an already accepted receipt is not a new
        // issuance. Only exact equality with the owning Run's recorded entry
        // permits its own IDs to be excluded from replay checks here. A
        // worker-submitted 'accepted' flag/reference never enables this path.
        if (protectedContext?.acceptedEntry) {
          if (envelopeDigest(protectedContext.acceptedEntry) !== envelopeDigest(submitted)
            || !protectedContext.consumedCollections?.includes(submitted.collectionId)
            || !protectedContext.issuedExecutions?.includes(submitted.execution)) {
            blocked.push('RECOVERY_REQUIRED: owning Run admission/consumption projection is inconsistent'); continue;
          }
          protectedContext = { ...protectedContext,
            consumedCollections: protectedContext.consumedCollections?.filter((id) => id !== submitted.collectionId),
            issuedExecutions: protectedContext.issuedExecutions?.filter((id) => id !== submitted.execution) };
        }
        const admitted = admitEvidence({ ...submitted?.sourcePacket, envelope: submitted?.envelope, dispatch: submitted?.dispatch }, { ...protectedContext, requireManaged: true });
        if (!admitted.ok) { blocked.push(`MANAGED_SOURCE_REFUSED: ${admitted.error}`); continue; }
        if (submitted.digest !== admitted.entry.digest || submitted.class !== admitted.entry.class) { blocked.push('TAMPERED_RECEIPT: managed admission content/class mismatch'); continue; }
        entry = admitted.entry;
        if (entry.dispatch.run !== options.currentRunId || entry.dispatch.gate !== options.currentGate) {
          blocked.push('MANAGED_SCOPE_MISMATCH: evidence belongs to another Run or gate'); continue;
        }
        // Source authentication is not semantic sufficiency. This protected
        // synchronous pure verifier consumes an ALREADY completed independent
        // review (host prepared via existing adapters), never starts one.
        // It may be the same independent verifier execution as this source.
        // This does not accept a
        // worker's role, oracle-strength label or read-skill trace.
        const review = options.verifyReview({ entry, inputs, policy });
        if (isAsyncResult(review)) { blocked.push('ASYNC_MANAGED_PORT_REFUSED: review must be synchronous'); continue; }
        const source = entry.sourcePacket.collection;
        if (review?.ok !== true || review.sufficient !== true || !SHA256_RE.test(review.evidenceDigest ?? '')
          || review.envelopeDigest !== entry.digest || review.reportDigest !== source.reportDigest || review.actionDigest !== source.actionDigest
          || typeof review.execution !== 'string' || !review.execution
          || typeof review.principal !== 'string' || !review.principal
          || [protectedContext.builderExecution, ...(protectedContext.authoringExecutions ?? [])].includes(review.execution)
          || [protectedContext.builderPrincipal, ...(protectedContext.authoringPrincipals ?? [])].includes(review.principal)) {
          blocked.push('INDEPENDENT_REVIEW_REQUIRED: raw report/method sufficiency has no current bound independent review'); continue;
        }
        if (testDesignGate && (review.kind !== 'independent-test-design-review'
          || review.contractDigest !== envelopeDigest(parsedContract.value) || entry.envelope.result !== 'pass')) {
          blocked.push('TEST_DESIGN_REVIEW_REQUIRED: an independent review must bind the current complete test contract'); continue;
        }
        if (architectureGate && (review.kind !== 'grill-exact-unanimous-consensus' || entry.envelope.result !== 'pass')) {
          blocked.push('ARCHITECTURE_REVIEW_REQUIRED: the current independent architecture consensus is required'); continue;
        }
        if (requirementsGate && (review.kind !== 'requirements-scope-confirmation' || entry.envelope.result !== 'pass')) {
          blocked.push('REQUIREMENTS_CONFIRMATION_REQUIRED: the current authorized scope confirmation is required'); continue;
        }
        if (planGate && (review.kind !== 'plan-unique-review' || review.change !== options.currentChange
          || review.planDigest !== envelopeDigest(parsedPlan.value)
          || review.tasksDigest !== inputs.planSources?.tasks?.digest || review.dagDigest !== inputs.planSources?.dag?.digest
          || entry.envelope.result !== 'pass')) {
          blocked.push('PLAN_REVIEW_REQUIRED: the current Change plan and its digest require a bound review'); continue;
        }
        reviewEvidence.set(entry.collectionId, review.evidenceDigest);
      } catch { blocked.push('MANAGED_SOURCE_REFUSED: protected source/review verification failed'); continue; }
    }
    const label = entry?.execution ?? '<unknown>';
    if (!entry || typeof entry !== 'object'
      || typeof entry.digest !== 'string'
      || !entry.envelope || typeof entry.envelope !== 'object'
      || !entry.dispatch || typeof entry.dispatch !== 'object') {
      blocked.push(`TAMPERED_RECEIPT: malformed admission entry (${label})`);
      continue;
    }
    if (entry.digest !== envelopeDigest(entry.envelope)) {
      blocked.push(`TAMPERED_RECEIPT: entry digest does not match its envelope content (${label})`);
      continue;
    }
    if (entry.origin !== entry.dispatch.runnerId || entry.execution !== entry.dispatch.execution) {
      blocked.push(`TAMPERED_RECEIPT: entry identity does not match its dispatch binding (${label})`);
      continue;
    }
    if (entry.dispatch.policyDigest !== policy.digest) {
      blocked.push(`STALE_POLICY: receipt bound to policy digest ${entry.dispatch.policyDigest} but current policy digest is ${policy.digest} (${label})`);
      continue;
    }
    if (entry.dispatch.inputDigest !== inputs.inputDigest || entry.envelope.candidateDigest !== inputs.inputDigest) {
      blocked.push(`STALE_INPUT: receipt bound to input digest ${entry.dispatch.inputDigest} but current input digest is ${inputs.inputDigest} (${label})`);
      continue;
    }
    if (entry.execution === inputs.builderExecution) {
      blocked.push(`IDENTITY_CONFLICT: receipt execution ${entry.execution} is the builder execution; verifier and builder must differ (A06)`);
      continue;
    }
    clean.push(entry);
  }

  // Per-capability satisfaction over the structurally clean receipts.
  const required = parsedContract.value?.requiredChecks ?? [];
  let valid = 0;
  if (requirementsGate && clean.length === 0) blocked.push('REQUIREMENTS_CONFIRMATION_REQUIRED: no admitted authorized confirmation');
  if (testDesignGate && clean.length === 0) blocked.push('TEST_DESIGN_REVIEW_REQUIRED: no admitted independent design review');
  if (architectureGate && clean.length === 0) blocked.push('ARCHITECTURE_REVIEW_REQUIRED: no admitted independent architecture review');
  if (planGate && clean.length === 0) blocked.push('PLAN_REVIEW_REQUIRED: no admitted current plan review');
  for (const check of required) {
    // R, A and T judge their frozen reviews; product command execution belongs to V.
    if (designReviewGate) continue;
    if (managed) {
      if (!strictContract) continue;
      const requiredCases = check.caseIds.filter((id) => parsedContract.value.cases.some((item) => item.id === id && item.required !== false));
      let covered = true;
      for (const caseId of requiredCases) {
        const observed = clean.some((entry) => entry.envelope.caseId === caseId && entry.envelope.check === check.capability
          && entry.class === 'independent-acceptance' && entry.envelope.result === 'pass'
          && entry.envelope.executions.valid >= 1 && entry.envelope.executions.valid <= entry.envelope.executions.total
          && entry.sourcePacket.collection.source.facts.observations.some((item) => item.caseId === caseId && item.check === check.capability && item.command === check.command
            && (!manualDesign || item.method === 'manual')));
        if (!observed) { covered = false; blocked.push(`REQUIRED_COMMAND_OBSERVATION_MISSING: ${caseId}/${check.id}/${check.capability}`); }
      }
      if (covered && requiredCases.length) valid++;
      continue;
    }
    const matching = clean.filter((entry) => entry.envelope.check === check.capability);
    if (matching.length === 0) {
      blocked.push(`MISSING_OBSERVATION: required check ${check.level}/${check.capability} has no receipt`);
      continue;
    }
    const independent = matching.filter((entry) => entry.class === 'independent-acceptance');
    if (independent.length === 0) {
      blocked.push(`AUTHORING_SELF_CHECK_ONLY: ${check.capability} is covered only by authoring self-check receipts, which cannot sign independent acceptance (B03)`);
      continue;
    }
    const observed = independent.filter((entry) => entry.envelope.result === 'pass'
      && Number.isInteger(entry.envelope.executions?.valid)
      && entry.envelope.executions.valid >= 1
      && entry.envelope.executions.valid <= entry.envelope.executions.total);
    if (observed.length === 0) {
      const sample = independent[0].envelope;
      blocked.push(`UNVERIFIED_CAPABILITY: ${check.capability} receipt result is ${sample.result} with ${sample.executions?.valid ?? 0} valid execution(s) (A18)`);
      continue;
    }
    valid += 1;
  }

  if (managed && !designReviewGate) {
    // Count only authenticated passing observations on the reciprocal frozen
    // case/check/command graph. Coverage declarations are never executions.
    const eligible = clean.filter((entry) => entry.class === 'independent-acceptance'
      && entry.envelope.result === 'pass'
      && parsedContract.value.cases.some((item) => item.required !== false && item.id === entry.envelope.caseId
        && required.some((check) => item.checkIds.includes(check.id) && check.caseIds.includes(item.id)
          && check.capability === entry.envelope.check
          && entry.sourcePacket.collection.source.facts.observations.some((observed) => observed.caseId === item.id
            && observed.check === check.capability && observed.command === check.command
            && (!manualDesign || observed.method === 'manual')))));
    const summary = { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0 };
    const seen = new Set();
    for (const entry of eligible) {
      const collection = entry.sourcePacket.collection;
      // Content equality is not execution equality. The protected source
      // binds actual launches and raw bytes; independent deterministic runs
      // may legitimately produce identical reports/results.
      const sourceRun = [entry.origin, collection.source.qualification.sourceId, collection.run];
      const identities = [
        ['execution', JSON.stringify([...sourceRun, entry.execution])],
        ['launch', JSON.stringify([...sourceRun, collection.launchId])],
        ['collection', entry.collectionId], ['envelope', entry.digest],
      ].map(([kind, id]) => `${kind}:${id}`);
      if (identities.some((id) => seen.has(id))) {
        blocked.push(`DUPLICATE_EXECUTION_EVIDENCE: repeated source execution/launch/collection/envelope (${entry.execution})`);
        continue;
      }
      for (const id of identities) seen.add(id);
      const observed = entry.sourcePacket.collection.source.facts.observations.find((item) => item.caseId === entry.envelope.caseId && item.check === entry.envelope.check);
      summary.tests += observed.executions.total;
      summary.pass += observed.executions.valid;
      summary.skipped += observed.executions.total - observed.executions.valid;
    }
    // Adapt already authenticated effective counts to the existing helper;
    // this neither parses invented TAP nor authenticates source on its own.
    const denominator = evaluateExecutionDenominator({ summary });
    const declared = parsedContract.value.executionDenominator.totalCases;
    if (!denominator.valid || denominator.validExecutions < declared) {
      blocked.push(`EXECUTION_DENOMINATOR_UNMET: declared ${declared}, observed ${denominator.validExecutions}`);
    }
  }

  // The receipt. Judged evidence and attestation are derived, sorted and
  // deterministic; an empty judged set is digested honestly.
  const judged = receipts
    .map((entry) => (entry && typeof entry === 'object' && typeof entry.digest === 'string' && SHA256_RE.test(entry.digest) ? entry.digest : null))
    .filter((digest) => digest !== null)
    .sort();
  if (managed) {
    for (const entry of clean) judged.push(entry.collectionId, reviewEvidence.get(entry.collectionId));
    if (manualApproval) judged.push(manualApproval.evidenceDigest);
    judged.sort();
  }
  const attested = clean;
  const origins = [...new Set(attested.map((entry) => entry.origin))].sort();
  const executions = [...new Set(attested.map((entry) => entry.execution))].sort();
  const receipt = {
    ...boundary,
    schemaVersion: 1,
    policy: { ref: policy.ref, digest: policy.digest },
    inputDigest: inputs.inputDigest,
    evidence: judged.length > 0 ? judged : [EMPTY_EVIDENCE_SET_DIGEST],
    requiredDenominator: designReviewGate
      ? { required: 1, valid: clean.length > 0 ? 1 : 0 }
      : { required: required.length, valid },
    blocked,
    sourceAttestation: {
      origin: origins.length > 0 ? origins.join(',') : 'none',
      execution: executions.length > 0 ? executions.join(',') : 'none',
    },
    verdict: blocked.length === 0 ? 'pass' : 'blocked',
  };
  // Contract boundary: the gate only ever returns a receipt that satisfies
  // the frozen SDD.Delivery.GateReceipt v1 schema; anything else is a gate
  // bug and fails closed instead of emitting an unvalidatable verdict.
  const validated = parseContract('SDD.Delivery.GateReceipt', receipt);
  if (!validated.ok) {
    throw new Error(`GATE_RECEIPT_INVALID (gate bug): ${validated.errors.join('; ')}`);
  }
  return { ...boundary, verdict: receipt.verdict, receipt: validated.value };
}
