// Real-host protected source ports for the sdd-managed-delivery application
// (six-step ①: the provider the official generated application.mjs never had
// — it calls `createBindings(context)` with no ports, so until now every
// hosted gate refused statically for lack of a provider).
//
// Division of trust (never a fixture, never a worker self-report): the ports
// corroborate ONLY against
//   (a) the loaded application identity (context.identity, pinned by the
//       upstream loader's contentHash check),
//   (b) the host's own run record carried by the validator input — the
//       action's claim and the frozen `inputHash` the host recorded at claim
//       time (envelopeDigest recompute), and
//   (c) the logged-in user's Codex session records, read through the
//       read-only locators/readers of lib/adapters/codex-host-source.js.
// Nothing here judges semantics (that stays lib/delivery/gate.js), nothing
// dispatches, and every result stays `sourceQualified:false` /
// `managedClosureEligible:false` — corroboration is not qualification.
//
// Step-① scope, stated honestly: this module proves the provider exists and
// verifies the in-process host facts above plus locator-embedded raw command
// records and prepared independent-review bindings. Full frozen-input
// equality against a real recorded Run, launch binding and per-ID report
// authentication are six-step ② against actual host records.
import { envelopeDigest } from '../delivery/evidence.js';
import {
  readCodexClaimedTest,
  readCodexCommandEvent,
  readCodexIndependentTurn,
  readCodexTestEvent,
} from './codex-host-source.js';

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const HOST_SOURCE_SCOPE = 'comet-host-protected-ports';

// The review kind each pre-build gate requires (gate.js refuses any other).
const REVIEW_KIND_BY_GATE = Object.freeze({
  R: 'requirements-scope-confirmation',
  A: 'grill-exact-unanimous-consensus',
  T: 'independent-test-design-review',
  P: 'plan-unique-review',
});

function refused(reason) {
  return { ok: false, scope: HOST_SOURCE_SCOPE, sourceQualified: false, managedClosureEligible: false, reason };
}

// One codex-host locator embedded by the managed dispatch at record time.
// Offsets are bounded record spans, never free-form read commands.
function codexLocatorProblem(locator) {
  if (!locator || typeof locator !== 'object') return 'locator missing';
  if (!UUID_RE.test(locator.threadId ?? '')) return 'locator threadId is not a session id';
  if (typeof locator.sessionPath !== 'string' || !locator.sessionPath.endsWith(`-${locator.threadId}.jsonl`)) return 'locator sessionPath does not name the thread session';
  if (!Number.isSafeInteger(locator.offset) || locator.offset < 0
    || !Number.isSafeInteger(locator.length) || locator.length < 1 || locator.length > 2 * 1024 * 1024) return 'locator span is not a bounded record';
  if (!UUID_RE.test(locator.turnId ?? '')) return 'locator turnId is not a turn id';
  if (!new RegExp(`^exec-${UUID_RE.source.slice(1, -1)}$`).test(locator.itemId ?? '')) return 'locator itemId is not a command item id';
  if (!SHA256_RE.test(locator.commandDigest ?? '')) return 'locator commandDigest is not a sha256 digest';
  return null;
}

export function createProtectedHostPorts({ context, readers } = {}) {
  const identity = context?.identity ?? null;
  // Reader injection exists for component tests only; the default wiring is
  // the real read-only host readers.
  const read = {
    command: readers?.command ?? readCodexCommandEvent,
    test: readers?.test ?? readCodexTestEvent,
    claimedTest: readers?.claimedTest ?? readCodexClaimedTest,
    independentTurn: readers?.independentTurn ?? readCodexIndependentTurn,
  };
  // verifyGateInputs always runs before admission/review in the packaged
  // bindings, so the corroborated run/action of the CURRENT validation is
  // latched here; admission and review ports refuse when it is absent.
  let latched = null;

  return Object.freeze({
    scope: HOST_SOURCE_SCOPE,

    // Synchronous, boolean. Recomputes what the host recorded; refuses
    // everything it cannot corroborate.
    verifyGateInputs({ run, action, gate, inputs, policy } = {}) {
      try {
        latched = null;
        if (!run || typeof run.runId !== 'string' || !run.runId.trim()) return false;
        if (typeof gate !== 'string' || !gate.trim()) return false;
        if (!action || typeof action.id !== 'string' || !action.id.trim()
          || typeof action.stepId !== 'string' || !action.stepId.trim()) return false;
        // The frozen claim input must recompute the digest the host recorded.
        if (!SHA256_RE.test(action.inputHash ?? '') || action.input === undefined) return false;
        if (envelopeDigest(action.input) !== action.inputHash) return false;
        // The claim binds the executing host thread; the token digest is
        // recorded, the token itself is never exposed.
        const claim = action.claim;
        if (!claim || typeof claim.executorId !== 'string' || !claim.executorId.trim()
          || !UUID_RE.test(claim.sessionId ?? '')
          || typeof claim.token !== 'string' || claim.token.length === 0) return false;
        // A loaded application always carries the loader-pinned identity.
        if (!identity || !SHA256_RE.test(identity.contentHash ?? '')) return false;
        if (identity.runtimeVersion !== undefined && (typeof identity.runtimeVersion !== 'string' || !identity.runtimeVersion.trim())) return false;
        // The judged frozen input and policy keep their gate shapes.
        if (!inputs || typeof inputs !== 'object' || !SHA256_RE.test(inputs.inputDigest ?? '')) return false;
        if (!policy || typeof policy !== 'object'
          || typeof policy.ref !== 'string' || policy.ref.length === 0
          || !SHA256_RE.test(policy.digest ?? '')) return false;
        // When the frozen claim input carries its own gate/run/input/policy
        // binding, each must match what is being judged.
        const frozen = action.input && typeof action.input === 'object' && !Array.isArray(action.input) ? action.input : null;
        if (frozen) {
          if (typeof frozen.gate === 'string' && frozen.gate !== gate) return false;
          if (typeof frozen.runId === 'string' && frozen.runId !== run.runId) return false;
          if (frozen.inputs !== undefined && envelopeDigest(frozen.inputs) !== envelopeDigest(inputs)) return false;
          if (frozen.policy !== undefined && envelopeDigest(frozen.policy) !== envelopeDigest(policy)) return false;
        }
        latched = structuredClone({ run, action, gate });
        return true;
      } catch {
        latched = null;
        return false;
      }
    },

    // Corroborates the submitted receipt's raw source against the logged-in
    // user's Codex session records and returns the packet only then. Any
    // missing locator or contradicting byte throws — bindings refuses.
    readSourcePacket({ entry } = {}) {
      if (!latched) throw new Error('protected source readback ran before verifyGateInputs corroborated the run');
      const packet = entry?.sourcePacket;
      if (!packet || typeof packet !== 'object') throw new Error('receipt carries no source packet');
      const collection = packet.collection;
      if (!collection || typeof collection !== 'object') throw new Error('source packet has no collection');
      const locator = collection.host?.codex ?? null;
      const locatorProblem = codexLocatorProblem(locator);
      if (locatorProblem) throw new Error(`source collection embeds no usable codex host locator: ${locatorProblem}`);
      const observed = read.command({
        sessionPath: locator.sessionPath, threadId: locator.threadId,
        offset: locator.offset, length: locator.length,
        turnId: locator.turnId, itemId: locator.itemId, commandDigest: locator.commandDigest,
      });
      if (!observed?.ok) throw new Error(`host command record did not corroborate: ${String(observed?.reason ?? 'refused')}`);
      const recorded = collection.source?.facts?.outputDigest;
      if (recorded !== undefined && recorded !== observed.outputDigest) {
        throw new Error(`raw record output digest ${String(observed.outputDigest).slice(0, 8)}… does not match the collection's recorded output digest ${String(recorded).slice(0, 8)}…`);
      }
      return packet;
    },

    // Protected admission context derived ONLY from the latched host run
    // record: the reporting action's claim is the builder identity, every
    // other claimed execution in the run is an author identity — so a review
    // sharing any of them is refused downstream (independence).
    admissionOptionsFor() {
      if (!latched) throw new Error('protected admission context ran before verifyGateInputs corroborated the run');
      const current = latched.action.claim;
      const others = (Array.isArray(latched.run.actions) ? latched.run.actions : [])
        .filter((item) => item?.claim && typeof item.claim.executorId === 'string' && item.claim.executorId !== current.executorId)
        .map((item) => ({ execution: item.claim.executorId, principal: item.claim.sessionId }));
      return {
        builderExecution: current.executorId,
        builderPrincipal: current.sessionId,
        authoringExecutions: [...new Set(others.map((item) => item.execution))],
        authoringPrincipals: [...new Set(others.map((item) => item.principal))],
        now: new Date().toISOString(),
      };
    },

    // Consumes an ALREADY completed independent review whose binding was
    // prepared into the receipt's collection at record time, corroborating it
    // against the host session records. It never starts a review.
    verifyReview({ entry } = {}) {
      if (!latched) return refused('protected review verification ran before verifyGateInputs corroborated the run');
      const source = entry?.sourcePacket?.collection?.source;
      const binding = source?.independentReview?.codex ?? null;
      if (!binding || typeof binding !== 'object') return refused('receipt embeds no prepared independent-review binding');
      const turn = read.independentTurn({
        parentSessionPath: binding.parentSessionPath,
        childSessionPath: binding.childSessionPath,
        spawn: binding.spawn,
        completion: binding.completion,
        childMeta: binding.childMeta,
        start: binding.start,
        finish: binding.finish,
        rootThreadId: binding.rootThreadId,
        parentTurnId: binding.parentTurnId,
        childThreadId: binding.childThreadId,
        childTurnId: binding.childTurnId,
        spawnId: binding.spawnId,
        authorThreadId: latched.action.claim.sessionId,
        reportDigest: binding.reportDigest,
      });
      if (!turn?.ok) return refused(`prepared independent-review turn did not corroborate: ${String(turn?.reason ?? 'refused')}`);
      if (binding.envelopeDigest !== entry.digest
        || binding.reportDigest !== source.reportDigest
        || binding.actionDigest !== source.actionDigest) {
        return refused('prepared review binding does not bind this receipt (envelope/report/action digests differ)');
      }
      const requiredKind = REVIEW_KIND_BY_GATE[latched.gate];
      if (requiredKind !== undefined && binding.kind !== requiredKind) {
        return refused(`prepared review kind ${String(binding.kind)} does not match the ${latched.gate} gate's required review`);
      }
      return {
        ok: true,
        sufficient: true,
        kind: binding.kind,
        evidenceDigest: binding.evidenceDigest,
        envelopeDigest: entry.digest,
        reportDigest: source.reportDigest,
        actionDigest: source.actionDigest,
        execution: binding.childThreadId,
        principal: binding.childThreadId,
      };
    },
  });
}
