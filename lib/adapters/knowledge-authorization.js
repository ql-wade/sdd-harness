// KnowledgeAuthorization adapter — the programmatic composition surface over
// the real KnowledgeAuthz.v1 CLI (tools/infra/knowledge-authz.mjs, unmodified
// behavior contract). P4_7's decision surface stays self-contained (review
// nb-6: no gate.js/evidence.js imports); this adapter exists so the Comet
// checker side (P4_4 composition wave) can consume preauthorization decisions
// without shelling out ad hoc or reimplementing any rule. It adds zero
// authorization logic: every call spawns the real CLI and maps its documented
// exit contract and JSON receipts.
//
// Exit contract (Repository CLI):
//   0 = PASS (validate clean / grant valid / decide allow / recheck fresh /
//       resolve authorized)
//   1 = invalid input or prerequisite (missing/unreadable file, malformed
//       request, unknown option)
//   2 = verification failure (violations, deny, expired/revoked/stale,
//       principal refused)
// Missing environment is explicitly UNVERIFIED and nonzero; a skip is never a
// pass. No secret value ever passes through this adapter: the CLI resolves
// refs through the I01 read-only gate and redacts host paths in receipts.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const PREAUTH_EXIT = Object.freeze({ PASS: 0, INPUT: 1, DENIED: 2 });

const ADAPTER_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ADAPTER_DIR, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'tools', 'infra', 'knowledge-authz.mjs');
const KNOWLEDGE_DIR = path.join(REPO_ROOT, 'infra', 'delivery', 'knowledge');

const DEFAULTS = Object.freeze({
  model: path.join(KNOWLEDGE_DIR, 'authorization-model.json'),
  policy: path.join(KNOWLEDGE_DIR, 'preauthorization-policy.json'),
  ledger: path.join(KNOWLEDGE_DIR, 'grant-ledger.example.json'),
  refs: path.join(REPO_ROOT, 'infra', 'delivery', 'secrets.refs.example.json'),
  registry: path.join(REPO_ROOT, 'infra', 'delivery', 'registry.json'),
});

export function runKnowledgeAuthz(args, { timeoutMs = 60_000 } = {}) {
  const run_ = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  let json = null;
  try {
    json = JSON.parse(run_.stdout);
  } catch {
    // exit 1 inputs print usage to stderr without a JSON receipt
  }
  return { status: run_.status, stdout: run_.stdout, stderr: run_.stderr, json };
}

function opt(args, flag, value) {
  if (value !== undefined) args.push(flag, value);
}

// validate [--model --policy --ledger --refs --registry]: committed-artifact
// structural check (isolated-role principals, owner registration, grant chain,
// policy boundaries). Every option defaults to the committed artifact.
export function validateArtifacts({ model, policy, ledger, refs, registry, timeoutMs } = {}) {
  const args = ['validate', '--model', model ?? DEFAULTS.model, '--policy', policy ?? DEFAULTS.policy, '--ledger', ledger ?? DEFAULTS.ledger];
  opt(args, '--refs', refs ?? DEFAULTS.refs);
  opt(args, '--registry', registry ?? DEFAULTS.registry);
  args.push('--json');
  return runKnowledgeAuthz(args, { timeoutMs });
}

// verify-grant --grant <id>: real-clock validity of one ledger grant
// (registered issuer with domain authority, validity window, not revoked).
export function verifyGrant(grantId, { ledger, model, timeoutMs } = {}) {
  return runKnowledgeAuthz(['verify-grant', '--grant', grantId, '--ledger', ledger ?? DEFAULTS.ledger, '--model', model ?? DEFAULTS.model, '--json'], { timeoutMs });
}

// revoke --grant <id> --as <principal> --reason <text>: authority-gated real
// state migration on the ledger (atomic write-back).
export function revokeGrant(grantId, { as, reason, ledger, model, timeoutMs } = {}) {
  return runKnowledgeAuthz(['revoke', '--grant', grantId, '--ledger', ledger ?? DEFAULTS.ledger, '--model', model ?? DEFAULTS.model, '--as', as, '--reason', reason, '--json'], { timeoutMs });
}

// decide --request <file>: the pre-write publication decision. The request is
// serialized to a scratch file because the CLI reads it as input; callers own
// scratch cleanup.
export function decidePublication(request, { ledger, model, policy, timeoutMs } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-authz-')), 'request.json');
  fs.writeFileSync(file, `${JSON.stringify(request, null, 2)}\n`);
  return runKnowledgeAuthz(['decide', '--request', file, '--ledger', ledger ?? DEFAULTS.ledger, '--model', model ?? DEFAULTS.model, '--policy', policy ?? DEFAULTS.policy, '--json'], { timeoutMs });
}

// recheck --decision <file> [--payload-digest]: pre-write re-verification of a
// decision receipt against the current ledger/model/policy digests and clock.
export function recheckDecision(decision, { ledger, model, policy, payloadDigest, timeoutMs } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-authz-')), 'decision.json');
  fs.writeFileSync(file, `${JSON.stringify(decision, null, 2)}\n`);
  const args = ['recheck', '--decision', file, '--ledger', ledger ?? DEFAULTS.ledger, '--model', model ?? DEFAULTS.model, '--policy', policy ?? DEFAULTS.policy];
  opt(args, '--payload-digest', payloadDigest);
  args.push('--json');
  return runKnowledgeAuthz(args, { timeoutMs });
}

// resolve --ref <secret-ref> --as <principal> --role <role>: the I01 read-only
// resolution gate (allowed principals + bound role + project match).
export function resolvePrincipal(ref, { as, role, refs, timeoutMs } = {}) {
  return runKnowledgeAuthz(['resolve', '--ref', ref, '--as', as, '--role', role, '--refs', refs ?? DEFAULTS.refs, '--json'], { timeoutMs });
}

// authorize-policy-change --as <principal> --reason <text>: the named policy
// mutation entrance — a refusal for every principal (agents and the registered
// owner alike; the owner's path is the protected issuance workflow, never this
// surface). Always exit 2 with POLICY_MUTATION_NOT_AUTHORIZED and mutated: [].
export function authorizePolicyChange({ as, reason, timeoutMs } = {}) {
  return runKnowledgeAuthz(['authorize-policy-change', '--as', as, '--reason', reason, '--json'], { timeoutMs });
}

// True only for a real allow receipt (exit 0 + verdict allow); everything else
// (input error, denial, unparsable) is not an authorization.
export function isAutoPublishAllowed(result) {
  return result?.status === PREAUTH_EXIT.PASS && result?.json?.verdict === 'allow';
}

// Refusal codes from a deny receipt or a recheck failure ([] otherwise).
export function denialCodes(result) {
  if (Array.isArray(result?.json?.reasons)) {
    return result.json.reasons.map((entry) => (typeof entry === 'string' ? entry : entry.code));
  }
  if (typeof result?.json?.code === 'string') return [result.json.code];
  return [];
}
