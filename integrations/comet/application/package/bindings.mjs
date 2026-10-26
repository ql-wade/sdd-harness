// integrations/comet/application/bindings.mjs — host-side validator and
// executor-port bindings for the sdd comet-050 classic-full composition
// application (P2_4, revision 2026-10-26-comet-050-adoption-v1, ADR-0022;
// executor layer added by the P2_4-r2 compiler rework, repair R2; blocker
// contracts B-②/B-③ added by the P2_4-r3 upstream-blocker rework).
//
// Contract (upstream workflow-generation/compiler.ts, classic composition):
// the compiled package embeds this module as modules['bindings.mjs'] and the
// generated application.mjs calls `createBindings(context)`, accepting ONLY
// { validators, executors } back. Every composition extension carries a
// validator ref { id, version }; the generated module resolves each ref
// against the validators returned here and REFUSES to build the application
// when a ref is unregistered — so the identities below must stay in exact
// sync with composition.json and extensions/*.json (pinned by
// test/delivery-cases/2_4.mjs).
//
// Division of judgment (SDD.Gate.v1 — pure evaluate, no dispatch): this
// module contains ZERO verdict logic. It maps the upstream extension result
// protocol onto lib/delivery pure components and fails closed on anything it
// cannot judge:
//   - evidence admission refusals: lib/delivery/evidence.js admitEvidence
//     (invoked inside evaluate on the managed path);
//   - tamper/stale/identity/coverage judgments: lib/delivery/gate.js evaluate;
//   - sourceHash/artifactHashes/verdict-shape binding: the upstream domain
//     wrapper (classic-application.ts) already enforces these BEFORE this
//     validator runs — they are not re-implemented here.
//
// The extension skill's pass output therefore looks like:
//   { verdict: 'pass', sourceHash, artifactHashes,
//     gateEvidence: { gate, inputs, receipts, policy, options? } }
// and a claimed pass is accepted ONLY when the pure gate evaluation of the
// payload returns verdict 'pass'. Anything else — missing payload, gate
// mismatch, malformed contract, blocked coverage, thrown evaluation — is
// accepted:false with a reason. There is no fallback path that could turn a
// refused judgment into an acceptance.
//
// Executor port (repair R2): the official compiler refuses to compile a
// classic composition whose invoke_skill steps have no routable execution
// port (compile-time routing probe: preflight + execute + supports +
// capabilities, domains/workflow-generation/compiler.js inspectAssembly). The
// port below is the HOST CONTRACT of this application, not an execution
// implementation: `authorize` covers only bindings declared by the loaded
// application manifest, and `invokeSkill` REFUSES automated execution — the
// pinned SKILL.md of each bound skill must be loaded and performed by the
// real host through the public SDK claim/report protocol (the generated
// entry protocol), never by this module. No runtime acceptance is claimed.

import { evaluate } from './sdd/lib-delivery-gate.mjs';

// Gate specs mirror extensions/<id>.json (single source: composition.json).
// `gate` is the Knowledge/managed gate identity the payload must carry;
// `artifactRef` is the declared static per-gate receipt-bundle path — the
// same string the upstream domain wrapper hash-re-checks on every future
// re-validation of a recorded pass (cross-pinned by test/delivery-cases/2_4.mjs).
const GATE_SPECS = [
  { gate: 'R', validatorId: 'sdd.delivery.gate.r', artifactRef: '.sdd/delivery/gates/r/receipt-bundle.json' },
  { gate: 'A', validatorId: 'sdd.delivery.gate.a', artifactRef: '.sdd/delivery/gates/a/receipt-bundle.json' },
  { gate: 'T', validatorId: 'sdd.delivery.gate.t', artifactRef: '.sdd/delivery/gates/t/receipt-bundle.json' },
  { gate: 'P', validatorId: 'sdd.delivery.gate.p', artifactRef: '.sdd/delivery/gates/p/receipt-bundle.json' },
  { gate: 'V', validatorId: 'sdd.delivery.gate.v', artifactRef: '.sdd/delivery/gates/v/receipt-bundle.json' },
  { gate: 'Kp', validatorId: 'sdd.delivery.gate.kp', artifactRef: '.sdd/delivery/gates/kp/receipt-bundle.json' },
];

const VALIDATOR_VERSION = '1';

// The execution-port identity pinned by composition.json#bindings.executors.
const EXECUTOR_PORT_ID = 'sdd-managed-skill-host';
const EXECUTOR_PORT_CAPABILITIES = ['skill-host'];

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// --- P2_4-r3 blocker contracts (pilot evidence comet-050-run) ------------------
//
// B-③ content-address stability of the per-gate bundle: upstream re-hashes
// the STATIC artifactRef against every recorded pass on every future
// re-validation (classic-application.ts), and again at archive. The official
// compiler accepts only static artifactRef strings, so epoch-qualified paths
// are inexpressible through the compile seam; the pilot failure class (a
// same-gate re-run in a new epoch overwrites the static ref with diverging
// bytes — the activation-embedding round-1 bundle — permanently orphaning
// the earlier pass hash, 536b5b49…→60c9ac68…) is eliminated by a RELATIVE
// content-address rule this validator enforces fail-closed: within one Run,
// IDENTICAL judged evidence for a gate must always bind IDENTICAL artifact
// bytes at the declared ref. Epoch-derived or random bundle fields make a
// same-evidence re-run diverge — refused here AT RECORD TIME with a precise
// reason, instead of silently orphaning the earlier pass at a later
// re-validation. A re-run whose evidence genuinely changed (a real revise)
// binds new bytes legitimately: revise loops always supersede the earlier
// passes (they re-run full.open), so no stale binding survives.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

const evidenceIdentity = (evidence) =>
  JSON.stringify(canonicalize({
    gate: evidence.gate,
    inputs: evidence.inputs,
    receipts: evidence.receipts,
    policy: evidence.policy,
  }));

function contentAddressProblem(spec, input, evidence) {
  const actions = Array.isArray(input?.run?.actions) ? input.run.actions : null;
  if (!actions) return null; // repo-side consumers judge the payload only (no run history)
  const output = input?.outcome?.output ?? input?.outcome;
  const artifactHashes = output?.artifactHashes;
  const current = artifactHashes && typeof artifactHashes === 'object' ? artifactHashes[spec.artifactRef] : undefined;
  if (typeof current !== 'string' || !/^[0-9a-f]{64}$/u.test(current)) return null; // structural binding is the domain wrapper's check
  const currentIdentity = evidenceIdentity(evidence);
  const currentActionId = input?.action?.id;
  for (const action of actions) {
    if (action?.stepId !== input?.action?.stepId || action.id === currentActionId) continue;
    const priorOutput = action?.outcome?.output;
    if (!priorOutput || priorOutput.verdict !== 'pass' || action.status !== 'succeeded') continue;
    const priorEvidence = priorOutput.gateEvidence;
    if (!priorEvidence || priorEvidence.gate !== spec.gate) continue;
    const priorHashes = priorOutput.artifactHashes ?? {};
    const priorHash = priorHashes[spec.artifactRef];
    if (typeof priorHash !== 'string') continue;
    if (evidenceIdentity(priorEvidence) === currentIdentity && priorHash !== current) {
      return `SDD gate ${spec.gate}: identical judged evidence is bound to diverging ${spec.artifactRef} bytes (earlier pass ${priorHash.slice(0, 8)}… vs this pass ${current.slice(0, 8)}…); the per-gate bundle is content-addressed — keep the bytes stable for unchanged evidence (embed no epoch-derived or random field) or re-run the gate on genuinely changed evidence`;
    }
  }
  return null;
}

// B-② activation binding guard: upstream resolves the extension activation
// source by FIRST match on receipt.submissionId and recordEvidence performs
// no uniqueness check — a submissionId reused across epochs binds the
// activation to a stale evidence wait (sourceCurrent false forever, pilot
// run r2). The guard fails closed on every contradiction it can see in the
// recorded run: a colliding submissionId, a binding whose wait is not the
// newest resolved wait of its checkpoint, and a cross-epoch activation.
// The lib/adapters/comet.js record-evidence constructor derives
// epoch-qualified submissionIds so this guard never fires on a managed
// dispatch; it exists so a raw hand-built request cannot smuggle a stale
// pass either.
function activationBindingProblem(run, action) {
  const source = action?.input?.activation?.source;
  if (!source || typeof source !== 'object' || !source.event) {
    // The upstream domain wrapper already refuses extension outcomes without
    // a bound activation before this validator runs (classic-application.ts
    // `!source` branch); the repo-side consumers pass no activation at all.
    return null;
  }
  // The epoch-equality refusal applies only to LIVE recordings (a claimed,
  // still-running action): checkEpoch advances on EVERY domain phase
  // transition (applyClassicTransition), so an already-recorded pass is
  // legitimately re-validated at a later epoch — refusing there would break
  // every valid run (upstream itself only re-validates the original evidence
  // while the epochs still match).
  const liveRecording = action?.status !== 'succeeded';
  const stateEpoch = Number.isInteger(run?.state?.checkEpoch) ? run.state.checkEpoch : null;
  if (liveRecording && stateEpoch !== null && source.checkEpoch !== stateEpoch) {
    return `SDD gate activation is bound to checkEpoch ${String(source.checkEpoch)} while the run is at checkEpoch ${String(stateEpoch)}; a stale-epoch gate pass must be re-armed in the current epoch`;
  }
  if (source.event.kind !== 'evidence-recorded') return null;
  const waits = Array.isArray(run?.evidenceWaits) ? run.evidenceWaits : [];
  const bySubmissionId = waits.filter((wait) => wait?.receipt?.submissionId === source.event.submissionId);
  if (bySubmissionId.length > 1) {
    return `SDD gate activation binds a colliding submissionId (${String(source.event.submissionId)}) shared by ${String(bySubmissionId.length)} evidence waits; submissionIds must be unique per wait (epoch-qualified)`;
  }
  const bound = bySubmissionId[0];
  if (!bound || bound.sequence !== source.sequence || bound.stepId !== source.event.stepId
    || bound.receipt.contentHash !== source.event.contentHash || bound.receipt.ref !== source.event.ref) {
    return `SDD gate activation binds submissionId ${String(source.event.submissionId)} but no evidence wait matches its recorded binding (sequence/step/hash/ref); the activation is stale`;
  }
  const newestOfStep = waits
    .filter((wait) => wait.stepId === source.event.stepId && wait.status === 'resolved')
    .reduce((best, wait) => (best === null || wait.sequence > best.sequence ? wait : best), null);
  if (newestOfStep && newestOfStep.sequence > bound.sequence) {
    return `SDD gate activation binds a superseded evidence wait (sequence ${String(bound.sequence)}; newest resolved of ${String(source.event.stepId)} is ${String(newestOfStep.sequence)}); re-record the checkpoint evidence with an epoch-qualified submissionId and re-arm`;
  }
  return null;
}

// Shared fail-closed delegation for one gate extension. `input` is the
// upstream RuntimeValidator input ({ run, action, outcome, context }); the
// outcome has already passed the domain wrapper's verdict/sourceHash/
// artifactHashes checks when this runs as an extension result validator, and
// the same function re-runs during archive-time validateOutcome re-checks.
//
// A claimed pass is accepted ONLY when, in order: the pure gate evaluation
// passes (judgment semantics unchanged — the delegation below is the sole
// verdict source); the activation binding guard (B-②) sees no contradiction;
// and the recorded artifact binding satisfies the content-address stability
// rule (B-③). Refused judgments keep their evaluation reason (the failure
// the caller must fix), so the contract checks only tighten ACCEPTED passes.
function validateGateExtension(spec, input) {
  const output = input?.outcome?.output;
  const evidence = output?.gateEvidence;
  if (output === null || typeof output !== 'object' || typeof evidence !== 'object' || evidence === null) {
    return {
      accepted: false,
      reason: `SDD gate ${spec.gate}: the extension result carries no gateEvidence payload; a claimed pass cannot be judged`,
    };
  }
  if (evidence.gate !== spec.gate) {
    return {
      accepted: false,
      reason: `SDD gate ${spec.gate}: payload is bound to gate ${String(evidence.gate)}; gate evidence cannot be replayed across extensions`,
    };
  }
  let result;
  try {
    // Pure delegation: options pass through verbatim (including any managed
    // admission context); this module never invents or relaxes options.
    result = evaluate(evidence.inputs, evidence.receipts, evidence.policy, evidence.options);
  } catch (error) {
    return {
      accepted: false,
      reason: `SDD gate ${spec.gate} refused to judge: ${reasonOf(error)}`,
    };
  }
  if (!(result?.verdict === 'pass' && result.receipt?.verdict === 'pass')) {
    const blocked = Array.isArray(result?.receipt?.blocked) ? result.receipt.blocked.join('; ') : 'no verdict';
    return {
      accepted: false,
      reason: `SDD gate ${spec.gate} blocked: ${blocked}`,
    };
  }
  // B-② activation binding guard (fail closed on observable contradictions).
  const bindingProblem = activationBindingProblem(input?.run, input?.action);
  if (bindingProblem) {
    return { accepted: false, reason: bindingProblem };
  }
  // B-③ content-address stability of the per-gate bundle binding (fail
  // closed on same-evidence byte divergence across the run's recorded passes).
  const addressProblem = contentAddressProblem(spec, input, evidence);
  if (addressProblem) {
    return { accepted: false, reason: addressProblem };
  }
  return { accepted: true };
}

export async function createBindings(context) {
  const validators = GATE_SPECS.map((spec) => ({
    id: spec.validatorId,
    version: VALIDATOR_VERSION,
    validate: (input) => validateGateExtension(spec, input),
  }));

  // The executor port exists ONLY as a port of a loaded workflow application:
  // its routing, preflight and capability semantics are constructed by the
  // runtime factory context (WorkflowApplicationFactoryContext.createSkillExecutor,
  // domains/workflow-application/application.js). Repo-side consumers that
  // read only the pure validators (lib/adapters/comet-executor.js) call this
  // function with no factory context — for them returning a fabricated stub
  // port would be a lie, so the port is registered exactly when the runtime
  // provides its constructor.
  if (!context || typeof context.createSkillExecutor !== 'function') {
    return { validators };
  }

  const declaredBindings = Array.isArray(context.manifest?.bindings)
    ? context.manifest.bindings
    : [];
  const port = context.createSkillExecutor({
    id: EXECUTOR_PORT_ID,
    capabilities: [...EXECUTOR_PORT_CAPABILITIES],
    // Fail-closed authorization: only a binding this application actually
    // declared, resolved to a pinned skill of the same loaded application,
    // may route through this port. Anything else is refused before execution.
    authorize: async ({ binding, skill } = {}) => {
      const known = binding && declaredBindings.some((entry) =>
        entry.workflowId === binding.workflowId &&
        entry.stepId === binding.stepId &&
        entry.skillId === binding.skillId &&
        entry.usage === binding.usage);
      const pinned = skill && typeof context.skills?.get === 'function'
        ? context.skills.get(binding?.skillId)?.id === binding.skillId
        : false;
      return Boolean(known && pinned && skill?.id === binding?.skillId);
    },
    // This port never auto-executes managed skills: the real host must load
    // the pinned SKILL.md and perform the work through the public SDK
    // claim/report protocol. Throwing keeps the original Action intact.
    invokeSkill: async ({ skill } = {}) => {
      throw new Error(
        `SDD managed skill host: skill ${String(skill?.id)} must be executed by the real host ` +
        'loading its pinned SKILL.md through the public SDK claim/report protocol; ' +
        'this execution port never auto-executes managed skills',
      );
    },
  });
  return { validators, executors: [port] };
}
