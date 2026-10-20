#!/usr/bin/env node
// DeliveryGate.v1 — CI-side delivery gate verifier (delivery-foundation-
// rearchitecture, P4_1; acceptance A13/F06/F09).
//
// This is the check the protected workflow (.github/workflows/delivery-gate.yml)
// runs on every integration candidate. It re-evaluates the frozen evidence
// contract/provenance against the EXACT integration merge SHA of the candidate
// it is handed — evidence bound to an older head/merge SHA never authorizes a
// new candidate (A13), skip and timeout are never passed (F06/F09), and the
// SDD.Gate.v1 verdict is imported from the accepted gate (lib/delivery/gate.js)
// over the accepted admission path (lib/delivery/evidence.js) — import reuse,
// zero changes to the accepted modules.
//
// Layering: tools/infra/platform.mjs (I06) is the platform-side read-only
// verification of the protected baseline; this tool is the CI-side delivery
// gate that consumes its semantics. The required-check evaluation mirrors
// I06's IntegrationIdentity check-step contract exactly (same codes, same
// binding): CHECK_MISSING / CHECK_STALE_EVIDENCE (exact merge-SHA binding) /
// CHECK_TIMED_OUT / CHECK_SKIPPED / CHECK_NOT_SUCCESS.
//
// Preconditions (fail-closed, never silently skipped):
//   - The required-check policy comes from the protected baseline
//     infra/delivery/platform/ci-policy.json. An unregistered set
//     (registrationStatus != REGISTERED) is the
//     PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED state: registration/permission
//     gaps block exactly the related action (the platform-merge authorization)
//     and plan fields never substitute for it.
//   - Gate receipts are only trusted through the real admission path: the
//     launcher secret arrives via an environment variable (default
//     SDD_DELIVERY_LAUNCH_AUTHORITY). Without it the gate is unjudgeable —
//     reported UNVERIFIED, never a pass.
//
// Exit code contract (repository CLI):
//   0 = PASS — checks bound to the exact merge SHA, gate verdict pass, the
//       required-check set admin-registered: the candidate may be merged.
//   1 = invalid input/prerequisite (unreadable/malformed chain or policy,
//       bad SHA/digest formats, missing arguments, missing gate receipts).
//   2 = verification failure — BLOCKED (missing/skipped/timed-out/stale
//       evidence, policy drift, refused admission, blocked gate) or UNVERIFIED
//       (missing platform registration, missing launch authority).
//       A skip is never converted into a pass.
//
// LOCAL_ONLY: this run holds no platform write authorization; the real
// protected-branch registration and merge rejection on GitHub stay with the
// platform admission owner and P4_2.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { admitEvidence, createLaunchAuthority } from '../../lib/delivery/evidence.js';
import { evaluate } from '../../lib/delivery/gate.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_POLICY_DIR = path.join(repoRoot, 'infra', 'delivery', 'platform');
const DEFAULT_LAUNCH_SECRET_ENV = 'SDD_DELIVERY_LAUNCH_AUTHORITY';
const SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
// The four blocking semantics every protected required-check policy must carry
// (I06 ci-policy contract: MISSING / SKIPPED / TIMED_OUT / STALE_EVIDENCE).
const BLOCKING_SEMANTICS_REQUIRED = ['MISSING', 'SKIPPED', 'TIMED_OUT', 'STALE_EVIDENCE'];

// 宿主私有路径绝不进入结构化回执/报告（与 tools/infra/platform.mjs 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

function usage() {
  return [
    'usage:',
    '  verify-delivery.mjs --chain <file> [--policy-dir <dir>] [--launch-secret-env <NAME>] [--json]',
    '',
    '  --chain <file>             integration candidate: head/merge SHA, required checks,',
    '                             check evidence (name/boundSha/conclusion/timedOut) and the',
    '                             gate receipts section (SDD.Gate.v1 inputs + envelopes/dispatches)',
    '  --policy-dir <dir>         protected baseline directory (default: infra/delivery/platform)',
    '  --launch-secret-env <NAME> env var carrying the trusted-launcher secret',
    '                             (default: SDD_DELIVERY_LAUNCH_AUTHORITY)',
    '  --json                     print the structured verdict to stdout',
    '',
    'Exit codes: 0=PASS, 1=invalid input/prerequisite, 2=BLOCKED/UNVERIFIED.',
  ].join('\n');
}

function parseArgv(argv) {
  try {
    const { values } = parseArgs({
      strict: true,
      options: {
        chain: { type: 'string' },
        'policy-dir': { type: 'string' },
        'launch-secret-env': { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
    return { opts: values };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

function failInput(message) {
  process.stderr.write(`${message}\n${usage()}\n`);
  return EXIT_INPUT;
}

// Input validation is a prerequisite question (exit 1); semantic blocking is a
// verdict question (exit 2). Same split as tools/infra/platform.mjs chain input.
function validateChainInput(chain) {
  if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return 'chain must be a JSON object';
  if (!SHA_RE.test(chain.head ?? '')) return 'head must be a 40-hex SHA';
  if (!SHA_RE.test(chain.merge ?? '')) return 'merge must be a 40-hex SHA';
  if (!Array.isArray(chain.requiredChecks) || chain.requiredChecks.length === 0
    || chain.requiredChecks.some((name) => typeof name !== 'string' || name.length === 0)) {
    return 'requiredChecks must be a non-empty array of check names';
  }
  if (!Array.isArray(chain.checks)) return 'checks must be an array';
  for (const check of chain.checks) {
    if (typeof check?.name !== 'string' || !SHA_RE.test(check?.boundSha ?? '') || typeof check?.conclusion !== 'string') {
      return 'each check needs a name, a 40-hex boundSha and a string conclusion';
    }
  }
  const gate = chain.gate;
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    return 'gate receipts section is missing: the delivery gate never judges without real gate evidence';
  }
  if (!SHA256_RE.test(gate.inputDigest ?? '')) return 'gate.inputDigest must be a sha256 hex digest (the candidate digest)';
  if (typeof gate.builderExecution !== 'string' || gate.builderExecution.length === 0) return 'gate.builderExecution must be a non-empty string';
  if (!gate.testContract || typeof gate.testContract !== 'object') return 'gate.testContract must be the frozen SDD.Delivery.TestContract object';
  if (typeof gate.policy?.ref !== 'string' || gate.policy.ref.length === 0 || !SHA256_RE.test(gate.policy?.digest ?? '')) {
    return 'gate.policy must be { ref: string, digest: sha256 }';
  }
  if (typeof gate.environment !== 'string' || gate.environment.length === 0) return 'gate.environment must be a non-empty string';
  if (gate.now !== undefined && Number.isNaN(Date.parse(gate.now))) return 'gate.now must be an ISO timestamp when provided';
  if (!Array.isArray(gate.entries)) return 'gate.entries must be an array of { envelope, dispatch }';
  for (const entry of gate.entries) {
    if (!entry || typeof entry !== 'object' || !entry.envelope || typeof entry.envelope !== 'object'
      || !entry.dispatch || typeof entry.dispatch !== 'object') {
      return 'each gate entry needs an envelope object and a dispatch object';
    }
  }
  return null;
}

// I06 IntegrationIdentity check-step semantics: the evidence contract for a
// required check is re-evaluated against the exact integration merge SHA.
function evaluateRequiredChecks(chain) {
  const perCheck = [];
  const codes = [];
  for (const name of [...new Set(chain.requiredChecks)]) {
    const evidences = chain.checks.filter((check) => check.name === name);
    const checkCodes = [];
    if (evidences.length === 0) {
      checkCodes.push('CHECK_MISSING');
    } else {
      const bound = evidences.find((check) => check.boundSha === chain.merge);
      if (!bound) {
        checkCodes.push('CHECK_STALE_EVIDENCE');
      } else if (bound.timedOut === true || bound.conclusion === 'timed_out') {
        checkCodes.push('CHECK_TIMED_OUT');
      } else if (bound.conclusion === 'skipped') {
        checkCodes.push('CHECK_SKIPPED');
      } else if (bound.conclusion !== 'success') {
        checkCodes.push('CHECK_NOT_SUCCESS');
      }
    }
    codes.push(...checkCodes);
    perCheck.push({ name, binding: 'EXACT_SHA', verdict: checkCodes.length > 0 ? 'BLOCKED' : 'PASS', codes: checkCodes });
  }
  return { perCheck, codes, verdict: codes.length > 0 ? 'BLOCKED' : 'PASS' };
}

// The protected baseline is the only authoritative source for the required-
// check set and its blocking semantics; an invalid policy can never ground a
// pass (fail-closed), and an unregistered set blocks exactly the related action.
function evaluateProtectedBaseline(policy, chain) {
  const codes = [];
  const structure = {
    interface: policy?.interface ?? null,
    requiredChecks: {
      registrationStatus: policy?.requiredChecks?.registrationStatus ?? null,
      names: policy?.requiredChecks?.names ?? [],
      blockingSemantics: policy?.requiredChecks?.blockingSemantics ?? [],
      failClosed: policy?.requiredChecks?.failClosed === true,
    },
  };
  const semantics = structure.requiredChecks.blockingSemantics;
  const missingSemantics = BLOCKING_SEMANTICS_REQUIRED.filter((code) => !semantics.includes(code));
  if (structure.interface !== 'PlatformInfra.v1' || missingSemantics.length > 0 || !structure.requiredChecks.failClosed) {
    codes.push('PROTECTED_BASELINE_INVALID');
  }
  const registered = structure.requiredChecks.registrationStatus === 'REGISTERED'
    && structure.requiredChecks.names.length > 0;
  if (!registered) {
    // Registration/permission gaps block only the related action: the
    // platform-merge authorization. Local evaluation still reports honestly.
    codes.push('PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED');
  } else {
    const policyNames = [...structure.requiredChecks.names].sort();
    const chainNames = [...chain.requiredChecks].sort();
    if (JSON.stringify(policyNames) !== JSON.stringify(chainNames)) {
      codes.push('REQUIRED_CHECKS_POLICY_MISMATCH');
    }
  }
  return { structure, registered, codes };
}

// Gate evidence only counts when the real admission path admits it; a refusal
// is a semantic finding (F06: missing/expired/failed required items block) and
// never silently dropped.
function evaluateGateReceipts(gate, launchSecretEnv) {
  const codes = [];
  const refused = [];
  const secret = process.env[launchSecretEnv];
  if (typeof secret !== 'string' || secret.length < 32) {
    return {
      codes: ['LAUNCH_AUTHORITY_MISSING'],
      refused,
      verdict: null,
      receipt: null,
      reason: `the trusted-launcher secret env ${launchSecretEnv} is missing or too short; the gate cannot be judged`,
    };
  }
  let authority;
  try {
    authority = createLaunchAuthority({ secret });
  } catch (error) {
    return {
      codes: ['LAUNCH_AUTHORITY_MISSING'],
      refused,
      verdict: null,
      receipt: null,
      reason: `the trusted-launcher secret was rejected: ${redactHostPaths(String(error?.message ?? error))}`,
    };
  }
  const now = gate.now ?? new Date().toISOString();
  const current = { inputDigest: gate.inputDigest, policyDigest: gate.policy.digest, environment: gate.environment };
  const admitted = [];
  const issuedExecutions = [];
  for (const entry of gate.entries) {
    const result = admitEvidence({
      envelope: entry.envelope,
      dispatch: entry.dispatch,
      authority,
      current,
      issuedExecutions,
      now,
    });
    if (!result.ok) {
      refused.push({ error: result.error, reason: redactHostPaths(String(result.reason ?? '')) });
      codes.push('ADMISSION_REFUSED');
      continue;
    }
    admitted.push(result.entry);
    issuedExecutions.push(result.entry.execution);
  }
  try {
    // `verdict` carries evaluate()'s whole result ({ verdict, receipt }); a
    // null verdict means the gate could not judge at all (fail-closed).
    const result = evaluate(
      { inputDigest: gate.inputDigest, testContract: gate.testContract, builderExecution: gate.builderExecution },
      admitted,
      gate.policy,
    );
    return { codes, refused, verdict: result, reason: null };
  } catch (error) {
    // The gate refuses to judge (e.g. an unfrozen test contract): fail closed.
    return {
      codes: [...codes, 'GATE_EVALUATION_REFUSED'],
      refused,
      verdict: null,
      receipt: null,
      reason: redactHostPaths(String(error?.message ?? error)),
    };
  }
}

function main(argv) {
  const { opts, error } = parseArgv(argv);
  if (error) return failInput(`argument error: ${error}`);
  if (!opts.chain) return failInput('--chain is required');

  const policyDir = path.resolve(opts['policy-dir'] ?? DEFAULT_POLICY_DIR);
  const launchSecretEnv = opts['launch-secret-env'] ?? DEFAULT_LAUNCH_SECRET_ENV;

  let chain;
  try {
    chain = JSON.parse(fs.readFileSync(opts.chain, 'utf8'));
  } catch (err) {
    return failInput(`chain unreadable (${displayPath(opts.chain)}): ${redactHostPaths(String(err?.message ?? err))}`);
  }
  const inputError = validateChainInput(chain);
  if (inputError) return failInput(`invalid chain: ${inputError}`);

  let policy;
  const policyFile = path.join(policyDir, 'ci-policy.json');
  try {
    policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  } catch (err) {
    return failInput(`protected baseline unreadable (${displayPath(policyFile)}): ${redactHostPaths(String(err?.message ?? err))}`);
  }

  const startedAt = new Date().toISOString();
  const checks = evaluateRequiredChecks(chain);
  const baseline = evaluateProtectedBaseline(policy, chain);
  const gate = evaluateGateReceipts(chain.gate, launchSecretEnv);

  const hardCodes = [
    ...checks.codes,
    ...baseline.codes.filter((code) => code !== 'PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED'),
    ...gate.codes.filter((code) => code !== 'LAUNCH_AUTHORITY_MISSING'),
  ];
  if (gate.verdict !== null && gate.verdict.verdict !== 'pass') hardCodes.push('GATE_BLOCKED');
  const preconditionCodes = [
    ...baseline.codes.filter((code) => code === 'PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED'),
    ...gate.codes.filter((code) => code === 'LAUNCH_AUTHORITY_MISSING'),
  ];

  const codes = [...hardCodes, ...preconditionCodes];
  const status = hardCodes.length > 0 ? 'BLOCKED' : preconditionCodes.length > 0 ? 'UNVERIFIED' : 'VERIFIED';
  const mergeBlocked = status !== 'VERIFIED';

  const verdict = {
    interface: 'DeliveryGate.v1',
    tool: 'tools/ci/verify-delivery.mjs',
    mode: 'LOCAL_ONLY',
    project: chain.project ?? null,
    head: chain.head,
    merge: chain.merge,
    status,
    mergeBlocked,
    codes,
    policy: { source: displayPath(policyFile), ...baseline.structure },
    checks: { required: chain.requiredChecks, binding: 'EXACT_SHA', verdict: checks.verdict, perCheck: checks.perCheck, codes: checks.codes },
    gate: {
      verdict: gate.verdict ? gate.verdict.verdict : 'unjudgeable',
      refused: gate.refused,
      blocked: gate.verdict ? gate.verdict.receipt.blocked : [],
      receipt: gate.verdict ? gate.verdict.receipt : null,
      codes: gate.codes,
      reason: gate.reason,
    },
    note: 'CI-side delivery gate; the real protected-branch registration and merge rejection need platform admin authorization (PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED) — platform admission owner + P4_2',
    checkedAt: startedAt,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  } else {
    process.stdout.write(`verify-delivery ${chain.project ?? ''} merge=${chain.merge}: ${status}${mergeBlocked ? ' (merge blocked)' : ''} codes=[${codes.join(', ')}]\n`);
  }
  return status === 'VERIFIED' ? EXIT_PASS : EXIT_VERIFY;
}

process.exit(main(process.argv.slice(2)));
