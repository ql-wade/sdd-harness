#!/usr/bin/env node
// ReleaseProtocol.v1 — isolated-environment build/promotion/rollback protocol
// (delivery-foundation-rearchitecture, P4_2; acceptance A14/A16/A17/F09).
//
// TWO surfaces, one contract (revision 2026-10-26-comet-050-adoption-v1):
//
// (1) isolated-environment surface — `promote|reconcile|rollback`.
// The release-side executor that follows the P4_1 CI delivery gate
// (tools/ci/verify-delivery.mjs): it builds the gate-verified candidate from
// the EXACT integration merge SHA into a content-addressed artifact, stores
// it in the isolated Registry (OCI-form blobs + tag refs, directory shape),
// deploys it into the isolated environment with a correlation-ID receipt and
// reads the independent business terminal state back. This run holds no
// production or platform authorization: every receipt is LOCAL_ONLY and the
// real production promotion/deployment stays UNVERIFIED — environment owner +
// runtime admission after P4_2 (ISOLATED_RELEASE_ENVIRONMENT_REQUIRED). The
// local directory-form Registry/environment ARE the real mechanism under
// test: digests are real sha256 over real bytes, the ledger and the business
// state are real files, and nothing is mocked.
//
// (2) foundation-distribution surface — `foundation-promote|
// foundation-reconcile|foundation-rollback`. This scaffold IS the
// distribution producer, so deployment semantics for the repo mean
// build/publish/rollback of the foundation-export distribution package:
//   build   — the REAL exporter (tools/foundation-export.mjs, imported:
//             buildLock/resolveBaseline — its native module interface) freezes
//             the distribution at a content-addressed exportDigest and seals a
//             baseline under foundation/baselines/<exportDigest> (multi-
//             version retention). A promotion requires the recomputed LIVE
//             build to equal the committed lock (BUILD_DIGEST_DRIFT refused
//             otherwise) and the pinned runner's supply build fingerprint to
//             agree with the committed toolchain (SUPPLY_RUNNER_MISMATCH /
//             SUPPLY_BUILD_DRIFT);
//   publish — the publication protocol registry
//             (ReleaseProtocols.v1, e.g. the committed
//             openspec/.../release-journey/release-protocols.json) must be
//             registered (RELEASE_PROTOCOLS_UNREGISTERED) and every remote
//             leg (npm publish, GitHub release, target environments) stays
//             honestly UNVERIFIED: this run holds no publication
//             authorization (REMOTE_PUBLICATION_UNAUTHORIZED in the note).
//             "Deployment" is the local distribution ledger binding:
//             tag ref -> exportDigest -> active release -> independent
//             distribution readback, with the release record binding
//             exportDigest + supply build fingerprint + frozen release
//             commit under one correlation ID;
//   rollback — only the retained previous approved exportDigest is a legal
//             target (ROLLBACK_DIGEST_MISMATCH), and only when its sealed
//             baseline still resolves byte-for-byte from the baselines
//             directory or git history (ROLLBACK_BASELINE_UNRESOLVABLE);
//             confirmed only by the independent readback of digest +
//             distribution + served state (ROLLBACK_TERMINAL_STATE_UNCONFIRMED
//             otherwise).
//
// Semantics (spec.md A14/A16/A17/F09):
//   A14  a deployment tag pointing at another digest never promotes — the
//        promotion is refused and the actual identity mismatch (tag-resolved
//        digest vs built digest) is recorded (TAG_DIGEST_DRIFT);
//   A16  a deployment whose response was lost is reconciled by its original
//        correlation ID: query first, bind the original result, never
//        redeploy (READBACK_UNCONFIRMED when the query cannot confirm);
//   A17  an unapproved rollback is refused (ROLLBACK_NOT_APPROVED), a
//        rollback to any digest other than the retained previous approved
//        one is refused (ROLLBACK_DIGEST_MISMATCH), and an approved
//        same-digest rollback is confirmed only by the independent readback
//        of digest + environment + key business terminal state
//        (ROLLBACK_TERMINAL_STATE_UNCONFIRMED otherwise);
//   F09  the exact integration SHA and the same digest thread through the
//        whole chain — every command emits the updated IntegrationIdentity
//        chain via --chain-out.
//
// Layering: the refusal codes are code-by-code aligned with the accepted I06
// IntegrationIdentity evaluator in tools/infra/platform.mjs. That tool cannot
// be imported (it runs process.exit(main(...)) at module load), so the
// contract is mirrored here and declared; the emitted chain is re-evaluated
// by the REAL platform.mjs `probe --case registry-environment-identity`
// subprocess, which is the authoritative evaluator of the resulting facts.
// Environment policy (approval-gated rollback, same-digest retention,
// correlation-ID readback oracle) follows the committed Environment.v1
// contract shape (infra/delivery/platform/environment-registration.example.json).
// On the foundation surface the same code-alignment pattern applies to the
// supply fingerprint: the formula mirrors tools/comet/build.mjs
// `fingerprintOf` (not exported, and that module runs a CLI main) — sha256
// over JSON {archive, patches[{path,sha256}], toolchain} of
// integrations/comet/upstream.lock.json; the committed .sdd vendored build
// (distribution.json) is verified against it whenever present.
//
// Exit codes: 0 = VERIFIED, 1 = invalid input/prerequisite, 2 = BLOCKED or
// UNVERIFIED. A registration/permission gap blocks exactly the related
// action and is never reported as a pass; plan fields never substitute for
// registration.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { buildLock, resolveBaseline } from '../foundation-export.mjs';

const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const EXPORT_DIGEST_RE = /^[0-9a-f]{64}$/;
const NOTE = 'LOCAL_ONLY: isolated local Registry/environment mechanism proof only; the real production promotion/deployment and its environment readback stay UNVERIFIED — environment owner + runtime admission after P4_2 (ISOLATED_RELEASE_ENVIRONMENT_REQUIRED).';
const FOUNDATION_NOTE = 'LOCAL_ONLY: foundation-distribution release mechanism proof (build digest lock + local release ledger + sealed-baseline rollback); the real remote publication (npm publish, GitHub release, target environments) and the platform artifact readback stay UNVERIFIED — no publication authorization in this run (REMOTE_PUBLICATION_UNAUTHORIZED).';

// 宿主私有路径绝不进入结构化回执/报告（与 tools/infra/platform.mjs 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// --- generic helpers -------------------------------------------------------

function failInput(message) {
  process.stderr.write(`${redactHostPaths(message)}\n`);
  return EXIT_INPUT;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const nowIso = () => new Date().toISOString();

// --- input validation (I06 chain-input contract, promote-side subset) -----

function validateChainInput(chain) {
  if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return 'chain must be a JSON object';
  if (!SHA_RE.test(chain.head ?? '')) return 'head must be a 40-hex SHA';
  if (!SHA_RE.test(chain.merge ?? '')) return 'merge must be a 40-hex SHA';
  if (typeof chain.project !== 'string' || chain.project.length === 0) return 'project is a required string';
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
  return null;
}

// --- isolated Registry (directory form, OCI-shaped) ------------------------

// Build = deterministic manifest over the real source bytes; the artifact
// digest is the sha256 of that manifest (content-addressed identity).
function buildArtifact({ source, merge }) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, entry.name);
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(abs, `${rel}/`);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(abs);
        files.push({ path: rel, sha256: sha256Hex(bytes), bytes: bytes.length });
      }
    }
  };
  walk(source, '');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = {
    schemaVersion: 1,
    mediaType: 'application/vnd.sdd.release.artifact.v1+json',
    artifactType: 'release-bundle',
    builtFromMerge: merge,
    files,
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, bytes, digest: `sha256:${sha256Hex(bytes)}` };
}

function putArtifact(registry, artifact) {
  const blob = path.join(registry, 'blobs', 'sha256', artifact.digest.slice(7));
  fs.mkdirSync(path.dirname(blob), { recursive: true });
  if (!fs.existsSync(blob)) fs.writeFileSync(blob, artifact.bytes);
  return blob;
}

function resolveTag(registry, tag) {
  const ref = path.join(registry, 'refs', 'tags', tag);
  try {
    const value = fs.readFileSync(ref, 'utf8').trim();
    return DIGEST_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeTag(registry, tag, digest) {
  const ref = path.join(registry, 'refs', 'tags', tag);
  fs.mkdirSync(path.dirname(ref), { recursive: true });
  fs.writeFileSync(ref, `${digest}\n`);
}

// --- isolated environment (directory form) ---------------------------------

// Registration is a hard precondition (ISOLATED_RELEASE_ENVIRONMENT_REQUIRED):
// an unreadable or malformed registration blocks exactly the
// environment-dependent actions; a registered-but-foreign project is the I06
// code. Neither is ever treated as satisfied by a plan field.
function loadEnvironment(environmentDir) {
  let registration;
  try {
    registration = readJson(path.join(environmentDir, 'registration.json'));
  } catch {
    return { error: 'ISOLATED_RELEASE_ENVIRONMENT_REQUIRED' };
  }
  const env = registration?.environment;
  if (!env || typeof env.id !== 'string' || typeof env.project !== 'string'
    || !env.rollback || !env.readbackOracle) {
    return { error: 'ISOLATED_RELEASE_ENVIRONMENT_REQUIRED' };
  }
  return { registration: env };
}

function activeDeployment(environmentDir) {
  try {
    return readJson(path.join(environmentDir, 'active.json'));
  } catch {
    return null;
  }
}

function loadRecord(environmentDir, correlationId) {
  try {
    return readJson(path.join(environmentDir, 'deployments', `${correlationId}.json`));
  } catch {
    return null;
  }
}

// The business terminal state is the environment's own store with its own
// content contract; confirmation always comes from a fresh read of it —
// never from the receipt that requested the deployment.
function readBusinessState(environmentDir) {
  try {
    const state = readJson(path.join(environmentDir, 'business', 'state.json'));
    if (state?.interface !== 'BusinessTerminalState.v1' || typeof state.serving !== 'string' || typeof state.environment !== 'string') return null;
    return state;
  } catch {
    return null;
  }
}

function writeBusinessState(environmentDir, envId, digest) {
  const previous = readBusinessState(environmentDir);
  writeJsonAtomic(path.join(environmentDir, 'business', 'state.json'), {
    schemaVersion: 1,
    interface: 'BusinessTerminalState.v1',
    environment: envId,
    serving: digest,
    revision: (previous?.revision ?? 0) + 1,
    observedAt: nowIso(),
  });
}

const stateConfirms = (state, digest) => state !== null && state.serving === digest;

// --- output ----------------------------------------------------------------

function receipt({ command, chain, status, codes = [], extra = {} }) {
  return {
    interface: 'ReleaseProtocol.v1',
    tool: 'tools/ci/release.mjs',
    command,
    mode: 'LOCAL_ONLY',
    project: chain.project,
    head: chain.head,
    merge: chain.merge,
    status,
    codes,
    note: NOTE,
    checkedAt: nowIso(),
    ...extra,
  };
}

function writeChainOut(file, chain, patch = {}) {
  if (!file) return;
  writeJsonAtomic(file, { ...chain, ...patch });
}

let JSON_OUTPUT = false;

function printVerdict(verdict) {
  process.stdout.write(JSON_OUTPUT
    ? `${JSON.stringify(verdict, null, 2)}\n`
    : `release ${verdict.command} ${verdict.project} merge=${verdict.merge}: ${verdict.status} codes=[${verdict.codes.join(', ')}]\n`);
}

// --- commands ---------------------------------------------------------------

function parseTag(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/') || value.includes('..')) {
    throw new Error('--tag must be a non-empty reference name without path separators');
  }
  return value;
}

function parseCorrelationId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/') || value.includes('..')) {
    throw new Error('--correlation-id must be a non-empty identifier without path separators');
  }
  return value;
}

function parseDigest(value) {
  if (!DIGEST_RE.test(value ?? '')) throw new Error('--digest must be a sha256:<64 hex> digest');
  return value;
}

function promote(opts) {
  let chain;
  try {
    chain = readJson(opts.chain);
  } catch (error) {
    return failInput(`chain unreadable: ${redactHostPaths(String(error?.message ?? error))}`);
  }
  const inputError = validateChainInput(chain);
  if (inputError) return failInput(`invalid chain: ${inputError}`);

  let tag;
  try {
    tag = parseTag(opts.tag);
  } catch (error) {
    return failInput(String(error.message));
  }

  // A caller-supplied artifact section must not contradict the candidate it
  // accompanies: a builtFromMerge other than the exact integration SHA is
  // exactly the I06 refusal; a claimed digest is checked against the real
  // build below.
  if (chain.artifact && chain.artifact.builtFromMerge !== chain.merge) {
    writeChainOut(opts['chain-out'], chain, { artifact: chain.artifact });
    printVerdict(receipt({
      command: 'promote', chain, status: 'BLOCKED', codes: ['ARTIFACT_NOT_FROM_MERGE'],
      extra: { artifact: { digest: chain.artifact.digest ?? null, tag, tagResolvedDigest: chain.artifact.tagResolvedDigest ?? null, builtFromMerge: chain.artifact.builtFromMerge } },
    }));
    return EXIT_VERIFY;
  }

  const envDir = opts.environment;
  const registry = opts.registry;
  const loaded = loadEnvironment(envDir);
  if (loaded.error) {
    printVerdict(receipt({ command: 'promote', chain, status: 'BLOCKED', codes: [loaded.error], extra: { tag } }));
    return EXIT_VERIFY;
  }
  if (loaded.registration.project !== chain.project) {
    printVerdict(receipt({ command: 'promote', chain, status: 'BLOCKED', codes: ['ENVIRONMENT_PROJECT_MISMATCH'], extra: { tag } }));
    return EXIT_VERIFY;
  }

  let artifact;
  try {
    artifact = buildArtifact({ source: opts.source, merge: chain.merge });
  } catch (error) {
    return failInput(`source unreadable (${redactHostPaths(opts.source)}): ${redactHostPaths(String(error?.message ?? error))}`);
  }
  if (chain.artifact?.digest && chain.artifact.digest !== artifact.digest) {
    return failInput(`inconsistent input: chain.artifact.digest ${chain.artifact.digest} does not match the artifact actually built from --source (${artifact.digest})`);
  }

  const active = activeDeployment(envDir);
  // A14: the tag is the deployment identity of what this protocol last
  // deployed (the environment's active binding). If it now resolves to any
  // other digest, the world drifted out-of-band between deployments and the
  // promotion is refused with the actual identity mismatch recorded; the
  // emitted chain carries the actual identities so I06 independently blocks
  // too. A legitimate sequential release keeps tag == active and moves the
  // tag to the new digest as part of this promotion's own effect.
  const tagResolved = resolveTag(registry, tag);
  if (active && tagResolved !== active.artifactDigest) {
    const activeRecord = active ? loadRecord(envDir, active.correlationId) : null;
    writeChainOut(opts['chain-out'], chain, {
      artifact: { digest: artifact.digest, tagResolvedDigest: tagResolved, builtFromMerge: chain.merge },
      deployment: {
        project: chain.project,
        artifactDigest: active?.artifactDigest ?? null,
        receipt: { correlationId: activeRecord?.correlationId ?? null },
      },
      readback: { correlationId: activeRecord?.correlationId ?? null, observed: readBusinessState(envDir) ? { businessTerminalState: readBusinessState(envDir) } : {} },
    });
    printVerdict(receipt({
      command: 'promote', chain, status: 'BLOCKED', codes: ['TAG_DIGEST_DRIFT'],
      extra: {
        artifact: { digest: artifact.digest, tag, tagResolvedDigest: tagResolved, expectedDigest: active.artifactDigest, builtFromMerge: chain.merge, files: artifact.manifest.files.length },
        deployment: { deployed: false, idempotent: false, receipt: null },
      },
    }));
    return EXIT_VERIFY;
  }

  // Same-digest lock: the deployed digest already owns this environment.
  if (active && active.artifactDigest === artifact.digest) {
    const record = loadRecord(envDir, active.correlationId);
    if (!record || record.correlationId !== active.correlationId || !DIGEST_RE.test(record.artifactDigest ?? '')) {
      printVerdict(receipt({ command: 'promote', chain, status: 'BLOCKED', codes: ['RECEIPT_CORRELATION_MISSING'], extra: { tag } }));
      return EXIT_VERIFY;
    }
    const state = readBusinessState(envDir);
    if (!stateConfirms(state, artifact.digest)) {
      // Unconfirmed: never a pass, and never a second deployment — reconcile.
      writeChainOut(opts['chain-out'], chain, {
        artifact: { digest: artifact.digest, tagResolvedDigest: artifact.digest, builtFromMerge: chain.merge },
        deployment: { project: chain.project, artifactDigest: artifact.digest, receipt: { correlationId: record.correlationId } },
        readback: { correlationId: record.correlationId, observed: {} },
      });
      printVerdict(receipt({
        command: 'promote', chain, status: 'UNVERIFIED', codes: ['READBACK_UNCONFIRMED'],
        extra: {
          artifact: { digest: artifact.digest, tag, tagResolvedDigest: artifact.digest, builtFromMerge: chain.merge, files: artifact.manifest.files.length },
          deployment: { deployed: false, idempotent: true, receipt: record },
          readback: { correlationId: record.correlationId, observed: {} },
        },
      }));
      return EXIT_VERIFY;
    }
    if (record.status !== 'deployed') {
      writeJsonAtomic(path.join(envDir, 'deployments', `${record.correlationId}.json`), {
        ...record, status: 'deployed', observed: { businessTerminalState: state },
      });
    }
    const bound = loadRecord(envDir, active.correlationId);
    writeChainOut(opts['chain-out'], chain, {
      artifact: { digest: artifact.digest, tagResolvedDigest: artifact.digest, builtFromMerge: chain.merge },
      deployment: { project: chain.project, artifactDigest: artifact.digest, receipt: { correlationId: bound.correlationId } },
      readback: { correlationId: bound.correlationId, observed: { businessTerminalState: state } },
    });
    printVerdict(receipt({
      command: 'promote', chain, status: 'VERIFIED',
      extra: {
        artifact: { digest: artifact.digest, tag, tagResolvedDigest: artifact.digest, builtFromMerge: chain.merge, files: artifact.manifest.files.length },
        deployment: { deployed: false, idempotent: true, receipt: bound },
        readback: { correlationId: bound.correlationId, observed: { businessTerminalState: state } },
      },
    }));
    return EXIT_PASS;
  }

  // Retain the previously approved artifact before switching (rollback target).
  if (active && loaded.registration.rollback?.retainLastApprovedArtifact !== false) {
    writeJsonAtomic(path.join(envDir, 'retained', 'previous-approved.json'), {
      schemaVersion: 1,
      artifactDigest: active.artifactDigest,
      correlationId: active.correlationId,
      builtFromMerge: active.builtFromMerge ?? null,
      retainedAt: nowIso(),
    });
  }

  // Deploy: request (ledger) -> environment binding -> business effect ->
  // independent fresh readback. The response is only issued after the
  // readback confirms; an unconfirmed deployment stays 'requested' and is
  // recovered through reconcile, never by a blind second deployment.
  putArtifact(registry, artifact);
  writeTag(registry, tag, artifact.digest);
  const correlationId = randomUUID();
  const requestedAt = nowIso();
  const record = {
    schemaVersion: 1,
    interface: 'DeploymentReceipt.v1',
    correlationId,
    project: chain.project,
    environment: loaded.registration.id,
    artifactDigest: artifact.digest,
    builtFromMerge: chain.merge,
    tag,
    requestedAt,
    status: 'requested',
    observed: null,
  };
  writeJsonAtomic(path.join(envDir, 'deployments', `${correlationId}.json`), record);
  writeJsonAtomic(path.join(envDir, 'active.json'), {
    schemaVersion: 1, artifactDigest: artifact.digest, correlationId, builtFromMerge: chain.merge, since: requestedAt,
  });
  let effectApplied = true;
  try {
    writeBusinessState(envDir, loaded.registration.id, artifact.digest);
  } catch {
    effectApplied = false;
  }
  const state = readBusinessState(envDir);
  const artifactSection = { digest: artifact.digest, tag, tagResolvedDigest: artifact.digest, builtFromMerge: chain.merge, files: artifact.manifest.files.length };
  if (!effectApplied || !stateConfirms(state, artifact.digest)) {
    writeChainOut(opts['chain-out'], chain, {
      artifact: { digest: artifact.digest, tagResolvedDigest: artifact.digest, builtFromMerge: chain.merge },
      deployment: { project: chain.project, artifactDigest: artifact.digest, receipt: { correlationId } },
      readback: { correlationId, observed: {} },
    });
    printVerdict(receipt({
      command: 'promote', chain, status: 'UNVERIFIED', codes: ['READBACK_UNCONFIRMED'],
      extra: {
        artifact: artifactSection,
        deployment: { deployed: false, idempotent: false, receipt: record },
        readback: { correlationId, observed: {} },
      },
    }));
    return EXIT_VERIFY;
  }
  const confirmed = { ...record, status: 'deployed', observed: { businessTerminalState: state } };
  writeJsonAtomic(path.join(envDir, 'deployments', `${correlationId}.json`), confirmed);
  writeChainOut(opts['chain-out'], chain, {
    artifact: { digest: artifact.digest, tagResolvedDigest: artifact.digest, builtFromMerge: chain.merge },
    deployment: { project: chain.project, artifactDigest: artifact.digest, receipt: { correlationId } },
    readback: { correlationId, observed: { businessTerminalState: state } },
  });
  printVerdict(receipt({
    command: 'promote', chain, status: 'VERIFIED',
    extra: {
      artifact: artifactSection,
      deployment: { deployed: true, idempotent: false, receipt: confirmed },
      readback: { correlationId, observed: { businessTerminalState: state } },
    },
  }));
  return EXIT_PASS;
}

function reconcile(opts) {
  let chain;
  try {
    chain = readJson(opts.chain);
  } catch (error) {
    return failInput(`chain unreadable: ${redactHostPaths(String(error?.message ?? error))}`);
  }
  const inputError = validateChainInput(chain);
  if (inputError) return failInput(`invalid chain: ${inputError}`);
  let correlationId;
  try {
    correlationId = parseCorrelationId(opts['correlation-id']);
  } catch (error) {
    return failInput(String(error.message));
  }

  const envDir = opts.environment;
  const registry = opts.registry;
  const loaded = loadEnvironment(envDir);
  if (loaded.error) {
    printVerdict(receipt({ command: 'reconcile', chain, status: 'BLOCKED', codes: [loaded.error] }));
    return EXIT_VERIFY;
  }

  // A16: the query by the original correlation ID runs first. An unknown ID
  // is honestly UNCONFIRMED and never becomes a deployment.
  const record = loadRecord(envDir, correlationId);
  if (!record) {
    writeChainOut(opts['chain-out'], chain, {
      deployment: { project: chain.project, artifactDigest: null, receipt: { correlationId, responseLost: true } },
      readback: { correlationId, observed: {} },
    });
    printVerdict(receipt({
      command: 'reconcile', chain, status: 'UNVERIFIED', codes: ['READBACK_UNCONFIRMED'],
      extra: { found: false, deployment: { deployed: false, idempotent: false, receipt: null }, readback: { correlationId, observed: {} } },
    }));
    return EXIT_VERIFY;
  }
  if (record.correlationId !== correlationId) {
    printVerdict(receipt({
      command: 'reconcile', chain, status: 'BLOCKED', codes: ['READBACK_CORRELATION_MISMATCH'],
      extra: { found: true, deployment: { deployed: false, idempotent: false, receipt: record } },
    }));
    return EXIT_VERIFY;
  }
  if (!DIGEST_RE.test(record.artifactDigest ?? '')) {
    return failInput(`deployment record ${correlationId} is corrupt: artifactDigest must be a sha256:<64 hex> digest`);
  }
  // The deployment identity must still agree with the Registry tag it was
  // deployed under; divergence is the I06 mismatch, never silently repaired.
  if (typeof record.tag === 'string' && record.tag.length > 0) {
    const resolved = resolveTag(registry, record.tag);
    if (resolved !== null && resolved !== record.artifactDigest) {
      writeChainOut(opts['chain-out'], chain, {
        artifact: { digest: resolved, tagResolvedDigest: resolved, builtFromMerge: chain.merge },
        deployment: { project: chain.project, artifactDigest: record.artifactDigest, receipt: { correlationId, responseLost: true } },
        readback: { correlationId, observed: {} },
      });
      printVerdict(receipt({
        command: 'reconcile', chain, status: 'BLOCKED', codes: ['DEPLOYMENT_DIGEST_MISMATCH'],
        extra: { found: true, deployment: { deployed: false, idempotent: false, receipt: record }, readback: { correlationId, observed: {} } },
      }));
      return EXIT_VERIFY;
    }
  }

  const state = readBusinessState(envDir);
  if (!stateConfirms(state, record.artifactDigest)) {
    writeChainOut(opts['chain-out'], chain, {
      deployment: { project: chain.project, artifactDigest: record.artifactDigest, receipt: { correlationId, responseLost: true } },
      readback: { correlationId, observed: {} },
    });
    printVerdict(receipt({
      command: 'reconcile', chain, status: 'UNVERIFIED', codes: ['READBACK_UNCONFIRMED'],
      extra: { found: true, deployment: { deployed: false, idempotent: false, receipt: record }, readback: { correlationId, observed: {} } },
    }));
    return EXIT_VERIFY;
  }
  // Bind the ORIGINAL result: the same correlation ID, the same requestedAt;
  // at most the record's own confirmation is completed, no new deployment.
  if (record.status !== 'deployed') {
    writeJsonAtomic(path.join(envDir, 'deployments', `${correlationId}.json`), {
      ...record, status: 'deployed', observed: { businessTerminalState: state },
    });
  }
  const bound = loadRecord(envDir, correlationId);
  writeChainOut(opts['chain-out'], chain, {
    deployment: { project: chain.project, artifactDigest: bound.artifactDigest, receipt: { correlationId, responseLost: true } },
    readback: { correlationId, observed: { businessTerminalState: state } },
  });
  printVerdict(receipt({
    command: 'reconcile', chain, status: 'VERIFIED',
    extra: {
      found: true,
      deployment: { deployed: false, idempotent: true, receipt: bound },
      readback: { correlationId, observed: { businessTerminalState: state } },
    },
  }));
  return EXIT_PASS;
}

function rollback(opts) {
  let chain;
  try {
    chain = readJson(opts.chain);
  } catch (error) {
    return failInput(`chain unreadable: ${redactHostPaths(String(error?.message ?? error))}`);
  }
  const inputError = validateChainInput(chain);
  if (inputError) return failInput(`invalid chain: ${inputError}`);
  let target;
  try {
    target = parseDigest(opts.digest);
  } catch (error) {
    return failInput(String(error.message));
  }

  const envDir = opts.environment;
  const loaded = loadEnvironment(envDir);
  if (loaded.error) {
    printVerdict(receipt({ command: 'rollback', chain, status: 'BLOCKED', codes: [loaded.error] }));
    return EXIT_VERIFY;
  }
  const policy = loaded.registration.rollback ?? {};

  // Approval gate (fail-closed): an absent policy flag never means "not
  // required". The refusal carries the requested rollback so I06 blocks the
  // same world (ROLLBACK_NOT_APPROVED).
  let approval = null;
  if (opts.approval) {
    try {
      approval = readJson(opts.approval);
    } catch (error) {
      return failInput(`approval unreadable: ${redactHostPaths(String(error?.message ?? error))}`);
    }
    if (typeof approval.approver !== 'string' || approval.approver.length === 0
      || typeof approval.approvedAt !== 'string' || approval.approvedAt.length === 0) {
      return failInput('approval must carry a non-empty approver and approvedAt');
    }
    if (!DIGEST_RE.test(approval.digest ?? '')) {
      return failInput('approval.digest must be a sha256:<64 hex> digest');
    }
  }
  const approved = approval !== null
    && approval.environment === loaded.registration.id
    && approval.digest === target;
  if (policy.approvalRequired !== false && !approved) {
    writeChainOut(opts['chain-out'], chain, {
      rollback: { requested: true, approved: false, digest: target, previousApprovedDigest: null },
    });
    printVerdict(receipt({
      command: 'rollback', chain, status: 'BLOCKED', codes: ['ROLLBACK_NOT_APPROVED'],
      extra: { rollback: { requested: true, approved: false, digest: target } },
    }));
    return EXIT_VERIFY;
  }

  // A17: the retained previous approved artifact is the only legal target.
  let retained;
  try {
    retained = readJson(path.join(envDir, 'retained', 'previous-approved.json'));
  } catch {
    retained = null;
  }
  if (!retained || !DIGEST_RE.test(retained.artifactDigest ?? '')) {
    writeChainOut(opts['chain-out'], chain, {
      rollback: { requested: true, approved: true, digest: target, previousApprovedDigest: null },
    });
    printVerdict(receipt({
      command: 'rollback', chain, status: 'BLOCKED', codes: ['ROLLBACK_RETENTION_MISSING'],
      extra: { rollback: { requested: true, approved: true, digest: target, previousApprovedDigest: null } },
    }));
    return EXIT_VERIFY;
  }
  if (target !== retained.artifactDigest) {
    writeChainOut(opts['chain-out'], chain, {
      rollback: { requested: true, approved: true, digest: target, previousApprovedDigest: retained.artifactDigest },
    });
    printVerdict(receipt({
      command: 'rollback', chain, status: 'BLOCKED', codes: ['ROLLBACK_DIGEST_MISMATCH'],
      extra: { rollback: { requested: true, approved: true, digest: target, previousApprovedDigest: retained.artifactDigest } },
    }));
    return EXIT_VERIFY;
  }

  // Effect: record -> environment binding -> business effect -> fresh
  // independent readback of digest + environment + business terminal state.
  const correlationId = randomUUID();
  const performedAt = nowIso();
  const prior = activeDeployment(envDir);
  const rollbackRecord = {
    schemaVersion: 1,
    interface: 'RollbackReceipt.v1',
    correlationId,
    digest: target,
    previousDigest: prior?.artifactDigest ?? null,
    approvedBy: approval.approver,
    approvedAt: approval.approvedAt,
    environment: loaded.registration.id,
    performedAt,
    status: 'performed',
    observed: null,
  };
  writeJsonAtomic(path.join(envDir, 'rollbacks', `${correlationId}.json`), rollbackRecord);
  writeJsonAtomic(path.join(envDir, 'active.json'), {
    schemaVersion: 1, artifactDigest: target, correlationId, builtFromMerge: retained.builtFromMerge ?? null, since: performedAt, rolledBackFrom: prior?.artifactDigest ?? null,
  });
  let effectApplied = true;
  try {
    writeBusinessState(envDir, loaded.registration.id, target);
  } catch {
    effectApplied = false;
  }
  const state = readBusinessState(envDir);
  const rollbackSection = {
    requested: true, approved: true, digest: target, previousApprovedDigest: retained.artifactDigest, approvedBy: approval.approver,
  };
  if (!effectApplied || !stateConfirms(state, target)) {
    writeChainOut(opts['chain-out'], chain, {
      rollback: { ...rollbackSection, observed: {} },
    });
    printVerdict(receipt({
      command: 'rollback', chain, status: 'UNVERIFIED', codes: ['ROLLBACK_TERMINAL_STATE_UNCONFIRMED'],
      extra: { rollback: { ...rollbackSection, observed: {} } },
    }));
    return EXIT_VERIFY;
  }
  writeJsonAtomic(path.join(envDir, 'rollbacks', `${correlationId}.json`), {
    ...rollbackRecord, status: 'rolled-back', observed: { businessTerminalState: state },
  });
  writeChainOut(opts['chain-out'], chain, {
    rollback: { ...rollbackSection, observed: { businessTerminalState: state } },
  });
  printVerdict(receipt({
    command: 'rollback', chain, status: 'VERIFIED',
    extra: {
      rollback: { ...rollbackSection, observed: { businessTerminalState: state, environment: loaded.registration.id } },
      readback: { correlationId, observed: { businessTerminalState: state, environment: loaded.registration.id } },
    },
  }));
  return EXIT_PASS;
}

// --- foundation-distribution surface ----------------------------------------
//
// The scaffold's own deployment semantics: the foundation-export package.
// The exporter is reused through its native module interface (buildLock /
// resolveBaseline); the supply build fingerprint mirrors
// tools/comet/build.mjs fingerprintOf (declared layering — see header).

const UPSTREAM_LOCK_REL = path.join('integrations', 'comet', 'upstream.lock.json');

function supplyIdentity(root) {
  let upstream;
  try {
    upstream = readJson(path.join(root, UPSTREAM_LOCK_REL));
  } catch {
    return { error: 'UPSTREAM_LOCK_UNREADABLE', runnerVersion: null, sourceCommit: null, fingerprint: null, buildPresent: false };
  }
  const patches = Array.isArray(upstream.patches)
    ? upstream.patches.map(({ path: patchPath, sha256 }) => ({ path: patchPath, sha256 }))
    : [];
  // Mirrors tools/comet/build.mjs fingerprintOf — key order is load-bearing
  // (JSON.stringify preserves insertion order): archive, patches, toolchain.
  const fingerprint = sha256Hex(JSON.stringify({
    archive: upstream.source?.sha256,
    patches,
    toolchain: upstream.toolchain,
  }));
  const sourceCommit = typeof upstream.source?.commit === 'string' ? upstream.source.commit : null;
  // Verify-if-present against the local vendored build: presence is an
  // environment property (CI provisions the build), but a PRESENT build that
  // disagrees with the lock is drift and blocks (never silently trusted).
  let buildPresent = false;
  if (sourceCommit && /^[0-9a-f]{40}$/.test(sourceCommit)) {
    const buildRoot = path.join(root, '.sdd', 'vendor', 'comet', sourceCommit, 'builds', fingerprint);
    if (fs.existsSync(buildRoot)) {
      buildPresent = true;
      try {
        const manifest = readJson(path.join(buildRoot, 'distribution.json'));
        if (manifest.fingerprint !== fingerprint || manifest.sourceCommit !== sourceCommit) {
          return { error: 'SUPPLY_BUILD_DRIFT', fingerprint, runnerVersion: upstream.package?.version ?? null, sourceCommit, buildPresent };
        }
      } catch {
        return { error: 'SUPPLY_BUILD_DRIFT', fingerprint, runnerVersion: upstream.package?.version ?? null, sourceCommit, buildPresent };
      }
    }
  }
  return {
    fingerprint,
    runnerVersion: typeof upstream.package?.version === 'string' ? upstream.package.version : null,
    sourceCommit,
    buildPresent,
  };
}

function loadLedger(ledgerDir) {
  let registration;
  try {
    registration = readJson(path.join(ledgerDir, 'registration.json'));
  } catch {
    return { error: 'DISTRIBUTION_LEDGER_REQUIRED' };
  }
  const distribution = registration?.distribution;
  if (!distribution || typeof distribution.id !== 'string' || typeof distribution.project !== 'string'
    || !distribution.rollback || !distribution.readbackOracle) {
    return { error: 'DISTRIBUTION_LEDGER_REQUIRED' };
  }
  return { registration: distribution };
}

function loadProtocols(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { error: 'RELEASE_PROTOCOLS_UNREGISTERED' };
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { error: 'RELEASE_PROTOCOLS_UNREGISTERED' };
  }
  if (doc?.interface !== 'ReleaseProtocols.v1' || typeof doc.project !== 'string' || doc.project.length === 0
    || !Array.isArray(doc.protocols) || doc.protocols.length === 0
    || doc.protocols.some((p) => typeof p?.kind !== 'string' || p.kind.length === 0
      || typeof p.path !== 'string' || (p.status !== 'LOCAL_VERIFIED' && p.status !== 'UNVERIFIED'))) {
    return { error: 'RELEASE_PROTOCOLS_UNREGISTERED' };
  }
  return { doc, digest: sha256Hex(raw) };
}

const ledgerTagRef = (ledgerDir, tag) => path.join(ledgerDir, 'refs', 'tags', tag);
const ledgerActive = (ledgerDir) => {
  try {
    return readJson(path.join(ledgerDir, 'active.json'));
  } catch {
    return null;
  }
};
const ledgerReleaseRecord = (ledgerDir, correlationId) => {
  try {
    return readJson(path.join(ledgerDir, 'releases', `${correlationId}.json`));
  } catch {
    return null;
  }
};

function foundationReadback(ledgerDir) {
  const state = (() => {
    try {
      const parsed = readJson(path.join(ledgerDir, 'business', 'state.json'));
      if (parsed?.interface !== 'BusinessTerminalState.v1' || typeof parsed.serving !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  })();
  return state;
}

function writeFoundationState(ledgerDir, distributionId, digest) {
  const previous = foundationReadback(ledgerDir);
  writeJsonAtomic(path.join(ledgerDir, 'business', 'state.json'), {
    schemaVersion: 1,
    interface: 'BusinessTerminalState.v1',
    distribution: distributionId,
    serving: digest,
    revision: (previous?.revision ?? 0) + 1,
    observedAt: nowIso(),
  });
}

function foundationReceipt({ command, project, status, codes = [], extra = {} }) {
  return {
    interface: 'ReleaseProtocol.v1',
    tool: 'tools/ci/release.mjs',
    command,
    mode: 'LOCAL_ONLY',
    distribution: 'foundation-export',
    project,
    status,
    codes,
    note: FOUNDATION_NOTE,
    checkedAt: nowIso(),
    ...extra,
  };
}

function writeFoundationChainOut(file, payload) {
  if (!file) return;
  writeJsonAtomic(file, payload);
}

function parseExportDigest(value) {
  const normalized = String(value ?? '').replace(/^sha256:/, '');
  if (!EXPORT_DIGEST_RE.test(normalized)) {
    throw new Error('--digest must be a 64-hex exportDigest (sha256: prefix tolerated)');
  }
  return normalized;
}

async function foundationPromote(opts) {
  const root = path.resolve(opts.root);
  const ledgerDir = path.resolve(opts.ledger);
  let tag;
  try {
    tag = parseTag(opts.tag);
  } catch (error) {
    return failInput(String(error.message));
  }

  const ledger = loadLedger(ledgerDir);
  if (ledger.error) {
    printVerdict(foundationReceipt({ command: 'foundation-promote', project: null, status: 'BLOCKED', codes: [ledger.error], extra: { tag } }));
    return EXIT_VERIFY;
  }
  const protocols = loadProtocols(opts.protocols);
  if (protocols.error) {
    printVerdict(foundationReceipt({ command: 'foundation-promote', project: ledger.registration.project, status: 'BLOCKED', codes: [protocols.error], extra: { tag } }));
    return EXIT_VERIFY;
  }
  if (protocols.doc.project !== ledger.registration.project) {
    printVerdict(foundationReceipt({ command: 'foundation-promote', project: ledger.registration.project, status: 'BLOCKED', codes: ['DISTRIBUTION_PROJECT_MISMATCH'], extra: { tag } }));
    return EXIT_VERIFY;
  }

  let committed;
  try {
    committed = readJson(path.join(root, 'foundation', 'foundation-lock.json'));
  } catch (error) {
    return failInput(`committed foundation lock unreadable (${redactHostPaths(root)}/foundation/foundation-lock.json): ${redactHostPaths(String(error?.message ?? error))}`);
  }
  if (!EXPORT_DIGEST_RE.test(committed?.release?.exportDigest ?? '')) {
    return failInput('committed foundation lock carries no valid release.exportDigest');
  }

  let built;
  try {
    // Recompute with the PINNED release commit (the same semantics as the
    // exporter's own verify path) so only content digests drive drift.
    built = await buildLock(root, { releaseCommit: committed.release.commit });
  } catch (error) {
    return failInput(`live sources no longer produce a foundation lock: ${redactHostPaths(String(error?.message ?? error))}`);
  }

  const supply = supplyIdentity(root);

  // Precondition cluster (all honest, all blocking, nothing deployed):
  // supply identity, digest lock against the committed distribution, and
  // recoverability of the artifact being published.
  const codes = [];
  if (supply.error) codes.push(supply.error);
  if (supply.runnerVersion !== (committed.toolchain?.runner?.version ?? null)) codes.push('SUPPLY_RUNNER_MISMATCH');
  if (built.release.exportDigest !== committed.release.exportDigest) codes.push('BUILD_DIGEST_DRIFT');
  const baseline = await resolveBaseline(root, committed);
  if (!baseline.ok) codes.push('SEALED_BASELINE_UNRESOLVABLE');
  if (codes.length > 0) {
    const verdict = foundationReceipt({
      command: 'foundation-promote', project: ledger.registration.project, status: 'BLOCKED', codes,
      extra: {
        tag,
        artifact: {
          exportDigest: committed.release.exportDigest,
          committedExportDigest: committed.release.exportDigest,
          builtExportDigest: built.release.exportDigest,
          builtFromReleaseCommit: built.release.commit,
        },
        supply: { fingerprint: supply.fingerprint, runnerVersion: supply.runnerVersion, sourceCommit: supply.sourceCommit, buildPresent: supply.buildPresent, expectedRunnerVersion: committed.toolchain?.runner?.version ?? null },
        sealedBaseline: { resolvable: baseline.ok, reason: baseline.ok ? null : baseline.reason },
        protocols: { registrationDigest: protocols.digest, kinds: protocols.doc.protocols.map((p) => p.kind), remotePublication: 'UNVERIFIED' },
      },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }

  // A14: the tag is the deployment identity of what this protocol last
  // released. If it now resolves to any other digest than the active
  // binding, the world drifted out-of-band and the promotion is refused with
  // the actual identities recorded. A legitimate sequential release keeps
  // tag == active and moves the tag as its own effect.
  const active = ledgerActive(ledgerDir);
  let tagResolved = null;
  try {
    const value = fs.readFileSync(ledgerTagRef(ledgerDir, tag), 'utf8').trim();
    tagResolved = EXPORT_DIGEST_RE.test(value) ? value : null;
  } catch {
    tagResolved = null;
  }
  if (active && tagResolved !== active.exportDigest) {
    const verdict = foundationReceipt({
      command: 'foundation-promote', project: ledger.registration.project, status: 'BLOCKED', codes: ['TAG_DIGEST_DRIFT'],
      extra: {
        tag,
        artifact: {
          exportDigest: committed.release.exportDigest,
          builtExportDigest: built.release.exportDigest,
          tagResolvedDigest: tagResolved,
          expectedDigest: active.exportDigest,
          builtFromReleaseCommit: built.release.commit,
        },
        supply: { fingerprint: supply.fingerprint, runnerVersion: supply.runnerVersion, buildPresent: supply.buildPresent },
        deployment: { released: false, idempotent: false, receipt: null },
      },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }

  const digest = committed.release.exportDigest;

  // Same-digest lock: the released digest already owns this distribution.
  if (active && active.exportDigest === digest) {
    const record = ledgerReleaseRecord(ledgerDir, active.correlationId);
    if (!record || record.correlationId !== active.correlationId || !EXPORT_DIGEST_RE.test(record.exportDigest ?? '')) {
      printVerdict(foundationReceipt({ command: 'foundation-promote', project: ledger.registration.project, status: 'BLOCKED', codes: ['RECEIPT_CORRELATION_MISSING'], extra: { tag } }));
      return EXIT_VERIFY;
    }
    const state = foundationReadback(ledgerDir);
    if (!state || state.serving !== digest) {
      const verdict = foundationReceipt({
        command: 'foundation-promote', project: ledger.registration.project, status: 'UNVERIFIED', codes: ['READBACK_UNCONFIRMED'],
        extra: {
          tag,
          artifact: { exportDigest: digest, builtFromReleaseCommit: record.releaseCommit },
          supply: { fingerprint: record.supplyBuildFingerprint, runnerVersion: record.runnerVersion },
          deployment: { released: false, idempotent: true, receipt: record },
          readback: { correlationId: record.correlationId, observed: {} },
        },
      });
      writeFoundationChainOut(opts['chain-out'], verdict);
      printVerdict(verdict);
      return EXIT_VERIFY;
    }
    if (record.status !== 'published') {
      writeJsonAtomic(path.join(ledgerDir, 'releases', `${record.correlationId}.json`), {
        ...record, status: 'published',
        observed: { activeBinding: digest, tagRef: digest, businessTerminalState: state, sealedBaseline: { resolvable: true, source: baseline.source } },
      });
    }
    const bound = ledgerReleaseRecord(ledgerDir, active.correlationId);
    const verdict = foundationReceipt({
      command: 'foundation-promote', project: ledger.registration.project, status: 'VERIFIED',
      extra: {
        tag,
        artifact: { exportDigest: digest, builtFromReleaseCommit: record.releaseCommit, supplyBuildFingerprint: record.supplyBuildFingerprint, runnerVersion: record.runnerVersion },
        deployment: { released: false, idempotent: true, receipt: bound },
        readback: { correlationId: bound.correlationId, activeBinding: digest, tagRef: digest, sealedBaseline: { resolvable: true, source: baseline.source } },
        protocols: { registrationDigest: protocols.digest, kinds: protocols.doc.protocols.map((p) => p.kind), remotePublication: 'UNVERIFIED' },
      },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_PASS;
  }

  // Retain the previously approved exportDigest before switching (the only
  // legal rollback target), when the ledger policy asks for retention.
  if (active && ledger.registration.rollback?.retainPreviousApproved !== false) {
    writeJsonAtomic(path.join(ledgerDir, 'retained', 'previous-approved.json'), {
      schemaVersion: 1,
      exportDigest: active.exportDigest,
      correlationId: active.correlationId,
      releaseCommit: active.releaseCommit ?? null,
      tag,
      retainedAt: nowIso(),
    });
  }

  // Release: request (ledger) -> distribution binding -> served state ->
  // independent fresh readback. An unconfirmed release stays 'requested' and
  // is recovered through foundation-reconcile, never by a blind second one.
  const correlationId = randomUUID();
  const requestedAt = nowIso();
  const record = {
    schemaVersion: 1,
    interface: 'FoundationReleaseReceipt.v1',
    correlationId,
    project: ledger.registration.project,
    distribution: ledger.registration.id,
    exportDigest: digest,
    releaseCommit: committed.release.commit,
    supplyBuildFingerprint: supply.fingerprint,
    runnerVersion: supply.runnerVersion,
    tag,
    protocolsRegistrationDigest: protocols.digest,
    requestedAt,
    status: 'requested',
    observed: null,
  };
  writeJsonAtomic(path.join(ledgerDir, 'releases', `${correlationId}.json`), record);
  writeJsonAtomic(path.join(ledgerDir, 'active.json'), {
    schemaVersion: 1, exportDigest: digest, correlationId, releaseCommit: committed.release.commit, since: requestedAt,
  });
  fs.mkdirSync(path.dirname(ledgerTagRef(ledgerDir, tag)), { recursive: true });
  fs.writeFileSync(ledgerTagRef(ledgerDir, tag), `${digest}\n`);
  let effectApplied = true;
  try {
    writeFoundationState(ledgerDir, ledger.registration.id, digest);
  } catch {
    effectApplied = false;
  }
  const state = foundationReadback(ledgerDir);
  const artifactSection = {
    exportDigest: digest,
    builtFromReleaseCommit: committed.release.commit,
    supplyBuildFingerprint: supply.fingerprint,
    runnerVersion: supply.runnerVersion,
  };
  const readbackConfirmed = effectApplied && state?.serving === digest
    && ledgerActive(ledgerDir)?.exportDigest === digest
    && fs.readFileSync(ledgerTagRef(ledgerDir, tag), 'utf8').trim() === digest;
  if (!readbackConfirmed) {
    const verdict = foundationReceipt({
      command: 'foundation-promote', project: ledger.registration.project, status: 'UNVERIFIED', codes: ['READBACK_UNCONFIRMED'],
      extra: {
        tag,
        artifact: artifactSection,
        deployment: { released: false, idempotent: false, receipt: record },
        readback: { correlationId, observed: {} },
        protocols: { registrationDigest: protocols.digest, kinds: protocols.doc.protocols.map((p) => p.kind), remotePublication: 'UNVERIFIED' },
      },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }
  const confirmed = {
    ...record, status: 'published',
    observed: { activeBinding: digest, tagRef: digest, businessTerminalState: state, sealedBaseline: { resolvable: true, source: baseline.source } },
  };
  writeJsonAtomic(path.join(ledgerDir, 'releases', `${correlationId}.json`), confirmed);
  const verdict = foundationReceipt({
    command: 'foundation-promote', project: ledger.registration.project, status: 'VERIFIED',
    extra: {
      tag,
      artifact: artifactSection,
      deployment: { released: true, idempotent: false, receipt: confirmed },
      readback: {
        correlationId,
        activeBinding: digest,
        tagRef: digest,
        sealedBaseline: { resolvable: true, source: baseline.source, exportDigest: digest },
        observed: { businessTerminalState: state },
      },
      protocols: { registrationDigest: protocols.digest, kinds: protocols.doc.protocols.map((p) => p.kind), remotePublication: 'UNVERIFIED' },
    },
  });
  writeFoundationChainOut(opts['chain-out'], verdict);
  printVerdict(verdict);
  return EXIT_PASS;
}

function foundationReconcile(opts) {
  const ledgerDir = path.resolve(opts.ledger);
  let correlationId;
  try {
    correlationId = parseCorrelationId(opts['correlation-id']);
  } catch (error) {
    return failInput(String(error.message));
  }
  const ledger = loadLedger(ledgerDir);
  if (ledger.error) {
    printVerdict(foundationReceipt({ command: 'foundation-reconcile', project: null, status: 'BLOCKED', codes: [ledger.error] }));
    return EXIT_VERIFY;
  }

  // A16: the query by the original correlation ID runs first; an unknown ID is
  // honestly UNCONFIRMED and never becomes a release.
  const record = ledgerReleaseRecord(ledgerDir, correlationId);
  if (!record) {
    const verdict = foundationReceipt({
      command: 'foundation-reconcile', project: ledger.registration.project, status: 'UNVERIFIED', codes: ['READBACK_UNCONFIRMED'],
      extra: { found: false, deployment: { released: false, idempotent: false, receipt: null }, readback: { correlationId, observed: {} } },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }
  if (record.correlationId !== correlationId) {
    printVerdict(foundationReceipt({
      command: 'foundation-reconcile', project: ledger.registration.project, status: 'BLOCKED', codes: ['READBACK_CORRELATION_MISMATCH'],
      extra: { found: true, deployment: { released: false, idempotent: false, receipt: record } },
    }));
    return EXIT_VERIFY;
  }
  if (!EXPORT_DIGEST_RE.test(record.exportDigest ?? '')) {
    return failInput(`release record ${correlationId} is corrupt: exportDigest must be a 64-hex digest`);
  }
  const active = ledgerActive(ledgerDir);
  let tagResolved = null;
  try {
    const value = fs.readFileSync(ledgerTagRef(ledgerDir, record.tag), 'utf8').trim();
    tagResolved = EXPORT_DIGEST_RE.test(value) ? value : null;
  } catch {
    tagResolved = null;
  }
  const state = foundationReadback(ledgerDir);
  if (!active || active.exportDigest !== record.exportDigest || tagResolved !== record.exportDigest
    || !state || state.serving !== record.exportDigest) {
    const verdict = foundationReceipt({
      command: 'foundation-reconcile', project: ledger.registration.project, status: 'UNVERIFIED', codes: ['READBACK_UNCONFIRMED'],
      extra: { found: true, deployment: { released: false, idempotent: false, receipt: record }, readback: { correlationId, observed: {} } },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }
  // Bind the ORIGINAL result: same correlation ID, same requestedAt; at most
  // the record's own confirmation is completed, no new release.
  if (record.status !== 'published') {
    writeJsonAtomic(path.join(ledgerDir, 'releases', `${correlationId}.json`), {
      ...record, status: 'published',
      observed: { activeBinding: record.exportDigest, tagRef: record.exportDigest, businessTerminalState: state },
    });
  }
  const bound = ledgerReleaseRecord(ledgerDir, correlationId);
  const verdict = foundationReceipt({
    command: 'foundation-reconcile', project: ledger.registration.project, status: 'VERIFIED',
    extra: {
      found: true,
      deployment: { released: false, idempotent: true, receipt: bound },
      readback: { correlationId, observed: { businessTerminalState: state } },
    },
  });
  writeFoundationChainOut(opts['chain-out'], verdict);
  printVerdict(verdict);
  return EXIT_PASS;
}

async function foundationRollback(opts) {
  const root = path.resolve(opts.root);
  const ledgerDir = path.resolve(opts.ledger);
  let target;
  try {
    target = parseExportDigest(opts.digest);
  } catch (error) {
    return failInput(String(error.message));
  }
  const ledger = loadLedger(ledgerDir);
  if (ledger.error) {
    printVerdict(foundationReceipt({ command: 'foundation-rollback', project: null, status: 'BLOCKED', codes: [ledger.error] }));
    return EXIT_VERIFY;
  }
  const policy = ledger.registration.rollback ?? {};

  // Approval gate (fail-closed): an absent policy flag never means "not
  // required"; the refusal carries the requested rollback.
  let approval = null;
  if (opts.approval) {
    try {
      approval = readJson(opts.approval);
    } catch (error) {
      return failInput(`approval unreadable: ${redactHostPaths(String(error?.message ?? error))}`);
    }
    if (typeof approval.approver !== 'string' || approval.approver.length === 0
      || typeof approval.approvedAt !== 'string' || approval.approvedAt.length === 0) {
      return failInput('approval must carry a non-empty approver and approvedAt');
    }
    if (!EXPORT_DIGEST_RE.test(String(approval.digest ?? '').replace(/^sha256:/, ''))) {
      return failInput('approval.digest must be a 64-hex exportDigest');
    }
  }
  const approved = approval !== null
    && approval.distribution === ledger.registration.id
    && String(approval.digest).replace(/^sha256:/, '') === target;
  if (policy.approvalRequired !== false && !approved) {
    const verdict = foundationReceipt({
      command: 'foundation-rollback', project: ledger.registration.project, status: 'BLOCKED', codes: ['ROLLBACK_NOT_APPROVED'],
      extra: { rollback: { requested: true, approved: false, digest: target } },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }

  // A17: the retained previous approved exportDigest is the only legal target.
  let retained;
  try {
    retained = readJson(path.join(ledgerDir, 'retained', 'previous-approved.json'));
  } catch {
    retained = null;
  }
  if (!retained || !EXPORT_DIGEST_RE.test(retained.exportDigest ?? '')) {
    const verdict = foundationReceipt({
      command: 'foundation-rollback', project: ledger.registration.project, status: 'BLOCKED', codes: ['ROLLBACK_RETENTION_MISSING'],
      extra: { rollback: { requested: true, approved: true, digest: target, previousApprovedDigest: null } },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }
  if (target !== retained.exportDigest) {
    const verdict = foundationReceipt({
      command: 'foundation-rollback', project: ledger.registration.project, status: 'BLOCKED', codes: ['ROLLBACK_DIGEST_MISMATCH'],
      extra: { rollback: { requested: true, approved: true, digest: target, previousApprovedDigest: retained.exportDigest } },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }

  // Recoverability precondition: the previous exportDigest's sealed baseline
  // must still resolve (multi-version retention under foundation/baselines,
  // or the frozen release commit through git history).
  let targetLock;
  try {
    targetLock = readJson(path.join(root, 'foundation', 'baselines', target, 'foundation-lock.json'));
  } catch {
    targetLock = null;
  }
  let baseline = null;
  if (!targetLock || targetLock.release?.exportDigest !== target) {
    baseline = { ok: false, reason: `sealed baseline directory for ${target.slice(0, 12)}… is missing or does not pin that exportDigest` };
  } else {
    const resolved = await resolveBaseline(root, targetLock);
    baseline = { ok: resolved.ok, reason: resolved.ok ? null : resolved.reason, source: resolved.source ?? null };
  }
  if (!baseline.ok) {
    const verdict = foundationReceipt({
      command: 'foundation-rollback', project: ledger.registration.project, status: 'BLOCKED', codes: ['ROLLBACK_BASELINE_UNRESOLVABLE'],
      extra: { rollback: { requested: true, approved: true, digest: target, previousApprovedDigest: retained.exportDigest, baselineReason: baseline.reason } },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }

  // Same-digest lock: already serving the rollback target.
  const activeBefore = ledgerActive(ledgerDir);
  if (activeBefore && activeBefore.exportDigest === target) {
    const state = foundationReadback(ledgerDir);
    if (state && state.serving === target) {
      const verdict = foundationReceipt({
        command: 'foundation-rollback', project: ledger.registration.project, status: 'VERIFIED',
        extra: {
          rollback: {
            requested: true, approved: true, digest: target, previousApprovedDigest: retained.exportDigest,
            sealedBaseline: { resolvable: true, source: baseline.source, exportDigest: target },
            observed: { distribution: ledger.registration.id, businessTerminalState: state },
          },
          deployment: { released: false, idempotent: true, receipt: null },
        },
      });
      writeFoundationChainOut(opts['chain-out'], verdict);
      printVerdict(verdict);
      return EXIT_PASS;
    }
  }

  // Effect: record -> distribution binding -> tag -> served state -> fresh
  // independent readback of digest + distribution + served state.
  const correlationId = randomUUID();
  const performedAt = nowIso();
  const rollbackRecord = {
    schemaVersion: 1,
    interface: 'RollbackReceipt.v1',
    correlationId,
    digest: target,
    previousDigest: activeBefore?.exportDigest ?? null,
    approvedBy: approval?.approver ?? null,
    approvedAt: approval?.approvedAt ?? null,
    distribution: ledger.registration.id,
    performedAt,
    status: 'performed',
    observed: null,
  };
  writeJsonAtomic(path.join(ledgerDir, 'rollbacks', `${correlationId}.json`), rollbackRecord);
  writeJsonAtomic(path.join(ledgerDir, 'active.json'), {
    schemaVersion: 1, exportDigest: target, correlationId, releaseCommit: retained.releaseCommit ?? null, since: performedAt, rolledBackFrom: activeBefore?.exportDigest ?? null,
  });
  fs.mkdirSync(path.dirname(ledgerTagRef(ledgerDir, retained.tag ?? 'stable')), { recursive: true });
  if (typeof retained.tag === 'string' && retained.tag.length > 0 && !retained.tag.includes('/') && !retained.tag.includes('..')) {
    fs.writeFileSync(ledgerTagRef(ledgerDir, retained.tag), `${target}\n`);
  }
  let effectApplied = true;
  try {
    writeFoundationState(ledgerDir, ledger.registration.id, target);
  } catch {
    effectApplied = false;
  }
  const state = foundationReadback(ledgerDir);
  const rollbackSection = {
    requested: true, approved: true, digest: target, previousApprovedDigest: retained.exportDigest,
    sealedBaseline: { resolvable: true, source: baseline.source, exportDigest: target },
  };
  const confirmed = effectApplied && state?.serving === target
    && ledgerActive(ledgerDir)?.exportDigest === target;
  if (!confirmed) {
    const verdict = foundationReceipt({
      command: 'foundation-rollback', project: ledger.registration.project, status: 'UNVERIFIED', codes: ['ROLLBACK_TERMINAL_STATE_UNCONFIRMED'],
      extra: { rollback: { ...rollbackSection, observed: {} } },
    });
    writeFoundationChainOut(opts['chain-out'], verdict);
    printVerdict(verdict);
    return EXIT_VERIFY;
  }
  writeJsonAtomic(path.join(ledgerDir, 'rollbacks', `${correlationId}.json`), {
    ...rollbackRecord, status: 'rolled-back', observed: { businessTerminalState: state, distribution: ledger.registration.id },
  });
  const verdict = foundationReceipt({
    command: 'foundation-rollback', project: ledger.registration.project, status: 'VERIFIED',
    extra: {
      rollback: {
        ...rollbackSection,
        observed: { distribution: ledger.registration.id, businessTerminalState: state },
      },
      readback: { correlationId, observed: { distribution: ledger.registration.id, businessTerminalState: state } },
    },
  });
  writeFoundationChainOut(opts['chain-out'], verdict);
  printVerdict(verdict);
  return EXIT_PASS;
}

// --- CLI --------------------------------------------------------------------

const COMMAND_OPTIONS = {
  promote: {
    chain: { type: 'string' },
    source: { type: 'string' },
    tag: { type: 'string' },
    registry: { type: 'string' },
    environment: { type: 'string' },
    'chain-out': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
  reconcile: {
    chain: { type: 'string' },
    registry: { type: 'string' },
    environment: { type: 'string' },
    'correlation-id': { type: 'string' },
    'chain-out': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
  rollback: {
    chain: { type: 'string' },
    registry: { type: 'string' },
    environment: { type: 'string' },
    digest: { type: 'string' },
    approval: { type: 'string' },
    'chain-out': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
  'foundation-promote': {
    root: { type: 'string' },
    ledger: { type: 'string' },
    protocols: { type: 'string' },
    tag: { type: 'string' },
    'chain-out': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
  'foundation-reconcile': {
    ledger: { type: 'string' },
    'correlation-id': { type: 'string' },
    'chain-out': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
  'foundation-rollback': {
    root: { type: 'string' },
    ledger: { type: 'string' },
    digest: { type: 'string' },
    approval: { type: 'string' },
    'chain-out': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
};

async function main(argv) {
  const command = argv[0];
  if (!COMMAND_OPTIONS[command]) return failInput(`unknown command: ${command ?? '<missing>'} (expected promote|reconcile|rollback|foundation-promote|foundation-reconcile|foundation-rollback)`);
  let values;
  try {
    ({ values } = parseArgs({ args: argv.slice(1), strict: true, options: COMMAND_OPTIONS[command] }));
  } catch (error) {
    return failInput(`argument error: ${String(error?.message ?? error)}`);
  }
  JSON_OUTPUT = values.json === true;

  if (command === 'foundation-promote') {
    for (const required of ['root', 'ledger', 'protocols', 'tag']) {
      if (!values[required]) return failInput(`--${required} is required`);
    }
    return foundationPromote(values);
  }
  if (command === 'foundation-reconcile') {
    for (const required of ['ledger', 'correlation-id']) {
      if (!values[required]) return failInput(`--${required} is required`);
    }
    return foundationReconcile(values);
  }
  if (command === 'foundation-rollback') {
    for (const required of ['root', 'ledger', 'digest']) {
      if (!values[required]) return failInput(`--${required} is required`);
    }
    return foundationRollback(values);
  }

  for (const required of ['chain', 'registry', 'environment']) {
    if (!values[required]) return failInput(`--${required} is required`);
  }
  if (command === 'promote' && !values.source) return failInput('--source is required');

  if (command === 'promote') return promote(values);
  if (command === 'reconcile') return reconcile(values);
  return rollback(values);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${redactHostPaths(String(error?.message ?? error))}\n`);
    if (process.env.SDD_RELEASE_DEBUG) process.stderr.write(`${redactHostPaths(String(error?.stack ?? ''))}\n`);
    process.exit(EXIT_INPUT);
  },
);
