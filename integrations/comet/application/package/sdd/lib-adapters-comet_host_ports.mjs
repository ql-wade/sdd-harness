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
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { envelopeDigest } from './lib-delivery-evidence.mjs';
import { compileDomainCases } from './lib-delivery-domain_cases.mjs';
import {
  readCodexClaimedTest,
  readCodexCommandEvent,
  readCodexIndependentTurn,
  readCodexTestEvent,
} from './lib-adapters-codex_host_source.mjs';

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
  // The V-gate promotion computed by verifyDomainAutomation for the current
  // validation; admission must serve the SAME object (gate.js deep-compares
  // it against the judged promotion).
  let promotion = null;

  return Object.freeze({
    scope: HOST_SOURCE_SCOPE,

    // Synchronous, boolean. Recomputes what the host recorded; refuses
    // everything it cannot corroborate.
    verifyGateInputs({ run, action, gate, inputs, policy } = {}) {
      try {
        latched = null;
        promotion = null;
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
        promotion = null;
        return false;
      }
    },

    // Six-step ③ — the V-gate domain-automation promotion, computed ONLY
    // from: (a) the change's own Markdown projection recomputed from source
    // files, (b) author self-check claims corroborated record-by-record
    // against real host session records, and (c) the recorded T review
    // action of the SAME run with an independently corroborated reviewer
    // turn. Nothing here trusts a caller- or worker-supplied promotion
    // object: every field is derived or refused.
    verifyDomainAutomation({ runId, inputs, policy } = {}) {
      const refusedPromotion = (reason) => { promotion = null; return refused(reason); };
      try {
        if (!latched) return refusedPromotion('promotion ran before verifyGateInputs corroborated the run');
        if (latched.gate !== 'V') return refusedPromotion('domain automation is judged only at the V gate');
        if (!runId || runId !== latched.run.runId) return refusedPromotion('promotion must bind the current Run');
        if (!inputs || typeof inputs !== 'object' || !SHA256_RE.test(inputs.inputDigest ?? '')) return refusedPromotion('the claimed inputs are malformed');
        if (!policy || !SHA256_RE.test(policy.digest ?? '')) return refusedPromotion('the claimed policy is malformed');
        const change = latched.run.input?.change;
        const changeDir = latched.run.input?.changeDir;
        if (typeof change !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(change)
          || typeof changeDir !== 'string' || ![`openspec/changes/${change}`, `docs/openspec/changes/${change}`].includes(changeDir)) {
          return refusedPromotion('the run is not bound to a canonical OpenSpec change');
        }
        const override = latched.run.input?.domainCases;
        const caseFile = override && typeof override.cases === 'string' ? override.cases : `${changeDir}/tests/domain-cases.md`;
        const configFile = override && typeof override.config === 'string' ? override.config : `${changeDir}/tests/domain-cases.config.json`;
        // (a) Recompute the projection from the change's own sources.
        let projection;
        try {
          const configBytes = fs.readFileSync(path.join(context.projectRoot, configFile));
          const config = JSON.parse(configBytes.toString('utf8'));
          projection = compileDomainCases({ projectRoot: context.projectRoot, caseFile, config });
        } catch (error) {
          return refusedPromotion(`the change's Markdown projection is not computable: ${String(error?.message ?? error).slice(0, 200)}`);
        }
        const contract = projection.testContract;
        if (!contract) return refusedPromotion('the projection has no runnable TestContract');
        const contractDigest = envelopeDigest(contract);
        if (!inputs.testContract || typeof inputs.testContract !== 'object' || envelopeDigest(inputs.testContract) !== contractDigest) {
          return refusedPromotion('the claimed test contract differs from the change source');
        }
        const packs = (contract.dependencyBaselines ?? []).filter(entry => entry?.kind === 'domain-cases/v1:testpack');
        if (packs.length !== 1) return refusedPromotion('the contract does not bind exactly one test pack');
        const candidate = projection.automationCandidate;
        if (!candidate || candidate.scope !== 'unqualified-automation-map' || !Array.isArray(candidate.entries) || !candidate.entries.length) {
          return refusedPromotion('the projection carries no automation map');
        }
        const automationMapDigest = envelopeDigest(candidate);
        // Full denominator: the map must cover exactly the required cases and
        // every covered case needs an author self-check claim.
        const requiredCaseIds = contract.cases.filter(item => item?.required !== false).map(item => item.id).sort();
        const automatedCaseIds = candidate.entries.map(entry => entry.caseId).sort();
        if (JSON.stringify(requiredCaseIds) !== JSON.stringify(automatedCaseIds)) {
          return refusedPromotion('the automation map must cover exactly the required cases before any promotion');
        }
        const claims = Array.isArray(projection.testPack.self_checks) ? projection.testPack.self_checks : [];
        const covered = new Set(claims.map(claim => claim.caseId));
        for (const entry of candidate.entries) if (!covered.has(entry.caseId)) return refusedPromotion(`case ${String(entry.caseId)} has no author self-check claim`);
        const authorExecution = claims[0].execution;
        const authorPrincipal = claims[0].principal;
        // (b) Corroborate every claim against real host records: each claim's
        // first evidence ref is a JSON claimedTest locator; the measured
        // record must be a fully valid pass for this exact command.
        const evidenceRefs = [];
        for (const claim of claims) {
          const entry = candidate.entries.find(item => item.caseId === claim.caseId);
          const ref = claim.evidenceRefs[0];
          let locator;
          try {
            locator = JSON.parse(ref.ref);
            if (!locator || typeof locator !== 'object' || Array.isArray(locator)) throw new Error('shape');
          } catch { return refusedPromotion(`case ${String(claim.caseId)}: the self-check evidence ref is not a claimedTest locator`); }
          const expected = {
            sessionPath: locator.sessionPath, offset: locator.offset, length: locator.length,
            threadId: locator.threadId, turnId: locator.turnId, itemId: locator.itemId,
            commandDigest: crypto.createHash('sha256').update(JSON.stringify({ argv: entry.command, cwd: context.projectRoot })).digest('hex'),
          };
          const before = locator.before, after = locator.after;
          if (!before || !after) return refusedPromotion(`case ${String(claim.caseId)}: the locator lacks the before/after command spans`);
          const measured = read.claimedTest({
            sessionPath: locator.sessionPath,
            before: { offset: before.offset, length: before.length },
            test: { offset: locator.offset, length: locator.length },
            after: { offset: after.offset, length: after.length },
            expectedBefore: { threadId: locator.threadId, turnId: before.turnId, itemId: before.itemId, commandDigest: before.commandDigest },
            expectedTest: expected,
            expectedAfter: { threadId: locator.threadId, turnId: after.turnId, itemId: after.itemId, commandDigest: after.commandDigest },
            claimBefore: locator.claimBefore, claimAfter: locator.claimAfter,
          });
          if (!measured?.ok || measured.outcome !== 'pass') return refusedPromotion(`case ${String(claim.caseId)}: the host record did not corroborate a passing execution`);
          if (measured.threadId !== authorExecution) return refusedPromotion(`case ${String(claim.caseId)}: the corroborated record does not belong to the claiming author execution`);
          if (measured.summary?.pass !== claim.executions.valid || measured.summary?.tests !== claim.executions.total) {
            return refusedPromotion(`case ${String(claim.caseId)}: the measured counts differ from the claim`);
          }
          if (ref.digest !== measured.outputDigest) return refusedPromotion(`case ${String(claim.caseId)}: the claimed evidence digest differs from the measured record`);
          evidenceRefs.push({ ref: `codex-test:${locator.threadId}:${locator.itemId}`, digest: measured.outputDigest });
        }
        // (c) The recorded T review action of the SAME run, with an
        // independently corroborated reviewer turn and the same contract.
        const actions = Array.isArray(latched.run.actions) ? latched.run.actions : [];
        const tAction = actions.find(item => item?.stepId === 'classic.extension.test-design-review'
          && item.status === 'succeeded' && item.outcome?.output?.verdict === 'pass' && item.outcome?.output?.gateEvidence?.gate === 'T');
        if (!tAction) return refusedPromotion('the run records no successful T review action');
        const tEvidence = tAction.outcome.output.gateEvidence;
        if (!tEvidence.inputs?.testContract || envelopeDigest(tEvidence.inputs.testContract) !== contractDigest) {
          return refusedPromotion('the recorded T review does not bind the current contract');
        }
        const currentClaim = latched.action.claim;
        const runClaims = actions.filter(item => item?.claim && typeof item.claim.executorId === 'string')
          .map(item => ({ execution: item.claim.executorId, principal: item.claim.sessionId }));
        let reviewer = null;
        for (const receiptEntry of (Array.isArray(tEvidence.receipts) ? tEvidence.receipts : [])) {
          const binding = receiptEntry?.sourcePacket?.collection?.source?.independentReview?.codex ?? null;
          if (!binding || typeof binding !== 'object') continue;
          const turn = read.independentTurn({
            parentSessionPath: binding.parentSessionPath, childSessionPath: binding.childSessionPath,
            spawn: binding.spawn, completion: binding.completion, childMeta: binding.childMeta,
            start: binding.start, finish: binding.finish,
            rootThreadId: binding.rootThreadId, parentTurnId: binding.parentTurnId,
            childThreadId: binding.childThreadId, childTurnId: binding.childTurnId,
            spawnId: binding.spawnId, authorThreadId: tAction.claim?.sessionId, reportDigest: binding.reportDigest,
          });
          if (!turn?.ok || turn.childThreadId !== binding.childThreadId) continue;
          reviewer = binding;
          break;
        }
        if (!reviewer) return refusedPromotion('the T review action has no corroborated independent reviewer turn');
        if (reviewer.childThreadId === authorExecution || reviewer.childThreadId === authorPrincipal
          || reviewer.childThreadId === currentClaim.executorId || reviewer.childThreadId === currentClaim.sessionId
          || runClaims.some(item => item.execution === reviewer.childThreadId || item.principal === reviewer.childThreadId)) {
          return refusedPromotion('the independent T reviewer must differ from the author, the builder and every claimed run execution');
        }
        const designReviewDigest = envelopeDigest({
          actionId: tAction.id, inputHash: tAction.inputHash ?? null,
          evidenceDigest: reviewer.evidenceDigest ?? null, contractDigest,
        });
        promotion = {
          ok: true,
          kind: 'verified-domain-automation',
          runId,
          inputDigest: inputs.inputDigest,
          policyDigest: policy.digest,
          contractDigest,
          testPackDigest: packs[0].digest,
          caseIds: [...requiredCaseIds].sort(),
          authorExecution,
          authorPrincipal,
          selfCheckDigest: envelopeDigest(projection.testPack.self_checks),
          automationMapDigest,
          designReviewDigest,
          sourceQualified: true,
          managedClosureEligible: false,
          designReviewRunId: runId,
          designReviewContractDigest: contractDigest,
          designReviewActionId: tAction.id,
          designReviewerExecution: reviewer.childThreadId,
          designReviewerPrincipal: reviewer.childThreadId,
          qualification: {
            id: 'author-self-check',
            sourceId: 'codex-host-session',
            revision: String(latched.run.revision ?? 0),
            scope: 'protected-source',
            status: 'qualified',
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            evidenceRefs,
          },
        };
        return structuredClone(promotion);
      } catch (error) {
        promotion = null;
        return refused(`domain automation refused to judge: ${String(error?.message ?? error).slice(0, 200)}`);
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
      const authoringExecutions = [...new Set(others.map((item) => item.execution))];
      const authoringPrincipals = [...new Set(others.map((item) => item.principal))];
      // When the V promotion qualified an author source, that author belongs
      // in the protected authoring identity set (gate.js requires it).
      if (promotion) {
        authoringExecutions.push(promotion.authorExecution);
        authoringPrincipals.push(promotion.authorPrincipal);
      }
      return {
        builderExecution: current.executorId,
        builderPrincipal: current.sessionId,
        authoringExecutions,
        authoringPrincipals,
        now: new Date().toISOString(),
        ...(promotion ? { domainAutomation: structuredClone(promotion) } : {}),
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
      if (!turn?.ok || turn.childThreadId !== binding.childThreadId) {
        return refused(`prepared independent-review turn did not corroborate: ${String(turn?.reason ?? (turn?.ok ? 'thread mismatch' : 'refused'))}`);
      }
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
