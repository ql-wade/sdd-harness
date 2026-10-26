// integrations/comet/application/bindings.mjs — host-side validator and
// executor-port bindings for the sdd comet-050 classic-full composition
// application (P2_4, revision 2026-10-26-comet-050-adoption-v1, ADR-0022;
// executor layer added by the P2_4-r2 compiler rework, repair R2).
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
// `gate` is the Knowledge/managed gate identity the payload must carry.
const GATE_SPECS = [
  { gate: 'R', validatorId: 'sdd.delivery.gate.r' },
  { gate: 'A', validatorId: 'sdd.delivery.gate.a' },
  { gate: 'T', validatorId: 'sdd.delivery.gate.t' },
  { gate: 'P', validatorId: 'sdd.delivery.gate.p' },
  { gate: 'V', validatorId: 'sdd.delivery.gate.v' },
  { gate: 'Kp', validatorId: 'sdd.delivery.gate.kp' },
];

const VALIDATOR_VERSION = '1';

// The execution-port identity pinned by composition.json#bindings.executors.
const EXECUTOR_PORT_ID = 'sdd-managed-skill-host';
const EXECUTOR_PORT_CAPABILITIES = ['skill-host'];

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// Shared fail-closed delegation for one gate extension. `input` is the
// upstream RuntimeValidator input ({ run, action, outcome, context }); the
// outcome has already passed the domain wrapper's verdict/sourceHash/
// artifactHashes checks when this runs as an extension result validator, and
// the same function re-runs during archive-time validateOutcome re-checks.
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
  if (result?.verdict === 'pass' && result.receipt?.verdict === 'pass') {
    return { accepted: true };
  }
  const blocked = Array.isArray(result?.receipt?.blocked) ? result.receipt.blocked.join('; ') : 'no verdict';
  return {
    accepted: false,
    reason: `SDD gate ${spec.gate} blocked: ${blocked}`,
  };
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
