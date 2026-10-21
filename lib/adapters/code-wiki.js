// Code wiki adapter — the code knowledge freshness gate (task P4_4, 4.4.c,
// precondition CODE_KNOWLEDGE_PROFILE_REQUIRED_IF_MANDATORY).
//
// Pure judgment over the pinned deepwiki-open/CodeGraph profile (I05
// registered artifacts): a mandatory run without a profile decision blocks
// final acceptance; an undecided branch (language / scale / deployment)
// stays PENDING ADMISSION and is never a pass ("不得把计划字段当已满足");
// a freshness receipt must bind the EXACT pinned commit and artifact digests
// and carry a real API/MCP independent readback — a receipt on another
// commit is stale and refused.
import { KnowledgeCloseoutError } from './llmwiki.js';

export const CODE_KNOWLEDGE_PRECONDITION = 'CODE_KNOWLEDGE_PROFILE_REQUIRED_IF_MANDATORY';

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// Resolve the profile decision from the pre-delivery policy.
//   mandatory && no policy        -> { blocked: 'CODE_KNOWLEDGE_PROFILE_REQUIRED' }
//   non-mandatory && no policy    -> { applicable: false, status: 'NOT_CONFIGURED' } (no block)
//   policy.required === true      -> { required: true, pinned } (fail-closed freshness)
//   policy.required === false     -> { pending: true, undecided } (stays out of closeout)
export function resolveCodeKnowledgeProfile({ policy, mandatory = false }) {
  if (!policy) {
    if (mandatory) {
      return { applicable: true, blocked: 'CODE_KNOWLEDGE_PROFILE_REQUIRED', reason: `${CODE_KNOWLEDGE_PRECONDITION}: the run marks code knowledge mandatory but no profile decision exists; final acceptance and later closeout are blocked` };
    }
    return { applicable: false, status: 'NOT_CONFIGURED' };
  }
  if (policy.required === true) {
    const pinned = policy.pinned;
    if (!pinned || !SHA_RE.test(pinned.commit ?? '') || !Array.isArray(pinned.artifacts)) {
      throw new KnowledgeCloseoutError('CODE_KNOWLEDGE_PROFILE_INVALID', 'a required code knowledge profile must pin the exact commit (40-hex) and the artifact digest list');
    }
    for (const artifact of pinned.artifacts) {
      if (!artifact.kind || !DIGEST_RE.test(artifact.digest ?? '')) {
        throw new KnowledgeCloseoutError('CODE_KNOWLEDGE_PROFILE_INVALID', `pinned artifact ${String(artifact.kind)} must carry a sha256:<hex> digest`);
      }
    }
    return { applicable: true, required: true, pinned, freshnessPolicy: policy.freshness ?? 'FAIL_CLOSED' };
  }
  if (policy.required === false) {
    if (!Array.isArray(policy.undecided) || policy.undecided.length === 0) {
      throw new KnowledgeCloseoutError('CODE_KNOWLEDGE_PROFILE_INVALID', 'a pending code knowledge profile must name its undecided branches (language / scale / deployment)');
    }
    return { applicable: false, pending: true, undecided: [...policy.undecided], reason: policy.pendingReason ?? 'pilot branch not selected; stays pending admission' };
  }
  throw new KnowledgeCloseoutError('CODE_KNOWLEDGE_PROFILE_INVALID', 'the code knowledge policy must decide required true or false');
}

// Judge the freshness receipt against the resolved profile.
export function evaluateCodeWikiReceipt({ profile, receipt }) {
  if (profile?.pending) {
    return { ok: false, code: 'CODE_KNOWLEDGE_PENDING_ADMISSION', reason: `branches ${profile.undecided.join('/')} are undecided; pending admission is never a pass (4.4.c)` };
  }
  if (!profile?.required) {
    return { ok: true, fresh: false, applicable: false };
  }
  if (!receipt || typeof receipt !== 'object') {
    throw new KnowledgeCloseoutError('CODE_WIKI_RECEIPT_REQUIRED', 'a required code knowledge profile demands a generation receipt');
  }
  if (receipt.commit !== profile.pinned.commit) {
    throw new KnowledgeCloseoutError('STALE_CODE_KNOWLEDGE', `the receipt was generated at ${String(receipt.commit).slice(0, 12)}… but the profile pins ${String(profile.pinned.commit).slice(0, 12)}…; stale code knowledge is refused (FAIL_CLOSED)`);
  }
  for (const artifact of profile.pinned.artifacts) {
    const observed = (receipt.artifacts ?? []).find((entry) => entry.kind === artifact.kind);
    if (!observed || observed.digest !== artifact.digest) {
      throw new KnowledgeCloseoutError('ARTIFACT_DIGEST_MISMATCH', `artifact ${artifact.kind} does not match the pinned digest`);
    }
  }
  if (!receipt.readback || typeof receipt.readback !== 'object' || !receipt.readback.channel) {
    throw new KnowledgeCloseoutError('CODE_WIKI_READBACK_REQUIRED', 'policy requires a real API/MCP independent readback of the generated code wiki');
  }
  return { ok: true, fresh: true, commit: receipt.commit };
}
