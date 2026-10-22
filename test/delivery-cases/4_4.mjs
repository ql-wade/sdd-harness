// P4_4 delivery case: the R06 closeout strategy over the SAME managed run —
// required project knowledge (Kp), OpenSpec archive, Outline publication (Kt)
// and overall completion are verified SEPARATELY (E01/E02/E06). An archived
// run with an unmet knowledge obligation keeps the same run open (D07): the
// re-run archive never re-archives (no archive/publish loop), a valid deploy
// receipt is retained read-only (knowledge failure never re-deploys), and a
// timed-out Outline publication recovers by reading the ORIGINAL fixed
// document back — unknown is never absence, no page is ever re-created
// (D06/E06). The adapter-built closeout receipt is re-verified by the real
// Runtime (external K dispatch gate + registered publication + matching
// readback) before the seat fills and the run completes.
//
// Real entrances, zero mocks of the tested objects: the real patched Comet
// build (0002+0003), the real KnowledgeAuthz.v1 decide CLI (P4_7) for the
// publication authorization, the real bin/cli.js knowledge-closeout
// judgment, and the real P4_4 adapter modules. All state lives in $TMPDIR
// worlds with an isolated HOME and PATH stubs. No live Outline/LLMWiki
// service exists in this environment: the adapter executes the runtime
// directive judgment and the runtime re-verifies every receipt; the live
// service call itself stays honestly UNVERIFIED (successor: deployment
// verification wave).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lockPath = process.env.SDD_COMET_LOCK ?? 'integrations/comet/upstream.lock.json';
const lock = JSON.parse(await fs.readFile(path.resolve(projectRoot, lockPath), 'utf8'));

const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const F2 = '9b95a0ff54ee00abd03ba9fb507cd93f03c8a464a743658898c474a51dc89b10';
const buildDir = path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
const entrypoint = path.join(buildDir, 'work/bin/comet.js');

const pinnedNode = lock.toolchain.node;
let nodeExecutable = process.execPath;
if (process.versions.node !== pinnedNode) {
  const candidate = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${pinnedNode}`, 'bin/node');
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === `v${pinnedNode}`) nodeExecutable = candidate;
}

const plain = (text) => String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const knowledgeSeed = await import('../../lib/knowledge-seed.js');
const llmwiki = await import('../../lib/adapters/llmwiki.js');
const outlineAdapter = await import('../../lib/adapters/outline.js');

// --- scratch world -------------------------------------------------------------
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p44-case-'));
const fakeHome = path.join(scratch, 'home');
const stubs = path.join(scratch, 'stubs');
const project = path.join(scratch, 'managed');
const wikiHome = path.join(scratch, 'wiki-home');
const wikiDir = path.join(wikiHome, 'wiki');
await fs.mkdir(fakeHome, { recursive: true });
await fs.mkdir(stubs, { recursive: true });
await fs.mkdir(project, { recursive: true });
await fs.mkdir(wikiDir, { recursive: true });
// The openspec stub creates the layout for init and performs the archive move
// exactly like the upstream CLI; npm/npx are neutralized (registered B6 gap).
await fs.writeFile(path.join(stubs, 'openspec'), `#!/bin/sh
pos1=""; pos2=""; count=0
for arg in "$@"; do
  case "$arg" in --*) ;; *) count=$((count+1)); if [ "$count" -eq 1 ]; then pos1="$arg"; elif [ "$count" -eq 2 ]; then pos2="$arg"; fi ;; esac
done
if [ "$pos1" = "init" ] && [ -n "$pos2" ]; then
  mkdir -p "$pos2/openspec" "$pos2/.claude/commands" "$pos2/.claude/skills"
  printf 'schema: openspec-1.0\\n' > "$pos2/openspec/config.yaml"
  echo "fake skill" > "$pos2/.claude/commands/openspec.md"
fi
if [ "$pos1" = "archive" ] && [ -n "$pos2" ] && [ -n "$COMET_PROJECT_ROOT" ]; then
  cd "$COMET_PROJECT_ROOT" || exit 0
  if [ -d "docs/openspec/changes/$pos2" ]; then
    mkdir -p "docs/openspec/changes/archive"
    mv "docs/openspec/changes/$pos2" "docs/openspec/changes/archive/$(date +%Y-%m-%d)-$pos2"
  fi
fi
exit 0
`, { mode: 0o755 });
for (const name of ['npm', 'npx']) {
  await fs.writeFile(path.join(stubs, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

const childEnv = (extra = {}, overProject = project) => {
  const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
  return { ...inherited, HOME: fakeHome, COMET_PROJECT_ROOT: overProject, PATH: `${stubs}:${process.env.PATH ?? ''}`, ...extra };
};

function comet(args, { env = {}, timeout = 180_000, cwd = project } = {}) {
  const result = spawnSync(nodeExecutable, [entrypoint, ...args], { cwd, encoding: 'utf8', timeout, env: childEnv(env, cwd) });
  let json = null;
  try { json = JSON.parse(result.stdout ?? ''); } catch { /* non-JSON output stays raw */ }
  return { ...result, json };
}
const refusalText = (result) => {
  const envelope = (result.json?.data?.issues ?? []).map((issue) => issue.message ?? '').join('\n');
  return `${plain(envelope)}\n${plain(result.stderr)}\n${plain(result.stdout)}`;
};
const changeDir = (change) => path.join(project, 'docs/openspec/changes', change);
const archivedDir = async (change) => {
  const entries = await fs.readdir(path.join(project, 'docs/openspec/changes/archive'));
  return path.join(project, 'docs/openspec/changes/archive', entries.find((name) => name.endsWith(change)));
};
const runStateOf = async (dir) => JSON.parse(await fs.readFile(path.join(dir, '.comet', 'run-state.json'), 'utf8'));

const writeArtifacts = async (change) => {
  const dir = changeDir(change);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n\nKnowledge closeout probe.\n');
  await fs.writeFile(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement probe product code\n');
  await fs.writeFile(path.join(dir, 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nCloseout probe design v1.\n`);
  await fs.writeFile(path.join(dir, 'test-intent.md'), '# Test Intent\n\ncases: c1\noracle: probe behavior observed\n');
  const plansDir = path.join(project, 'docs/superpowers/plans');
  await fs.mkdir(plansDir, { recursive: true });
  await fs.writeFile(path.join(plansDir, `${change}-plan.md`), '# Plan\n\n- 1.1 Implement probe product code\n');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src/feature.js'), 'export const v1 = 1;\n');
};

const acceptGate = (change, gate, { verdict = 'pass' } = {}) => {
  const dispatched = comet(['state', 'dispatch-gate', change, gate, '--json']);
  assert.equal(dispatched.json?.exitCode, 0, `dispatch-gate ${gate} failed: ${refusalText(dispatched).slice(0, 400)}`);
  const binding = dispatched.json?.data?.dispatch ?? JSON.parse((dispatched.stdout ?? '').trim().split('\n').pop());
  const resultFile = path.join(scratch, `result-${change}-${gate}-${Math.random().toString(36).slice(2)}.json`);
  fsSync.writeFileSync(resultFile, JSON.stringify({ execution: binding.execution, attempt: binding.attempt, verdict }));
  const accepted = comet(['state', 'accept-gate', change, gate, '--file', resultFile, '--json']);
  assert.equal(accepted.json?.exitCode, 0, `accept-gate ${gate} failed: ${refusalText(accepted).slice(0, 300)}`);
  return binding;
};
const acceptAll = (change, gates) => { for (const gate of gates) acceptGate(change, gate); };

const writeCheckPolicy = async () => {
  await fs.mkdir(path.join(project, '.comet'), { recursive: true });
  await fs.writeFile(path.join(project, '.comet/check-policy.json'), JSON.stringify({
    version: 2,
    commands: [
      { argv: ['node', '-e', 'process.stdout.write("build-ok\\n")'], cwd: '.', requiredScope: 'build', files: ['src/feature.js'] },
      { argv: ['node', '-e', 'process.stdout.write("verify-ok\\n")'], cwd: '.', requiredScope: 'verify', files: ['src/feature.js'] },
    ],
  }, null, 2));
};

async function driveToArchived(change) {
  await writeArtifacts(change);
  assert.equal(comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', change, '--json']).json?.exitCode, 0);
  const rel = `docs/openspec/changes/${change}`;
  assert.equal(comet(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', change, 'open-complete', '--json']).json?.exitCode, 0);
  acceptAll(change, ['R', 'A', 'T', 'P']);
  assert.equal(comet(['state', 'complete-design', change, '--design-doc', `${rel}/design.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'set', change, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  await writeCheckPolicy();
  const tasks = comet(['state', 'tasks', change, '--assign-ids', '--json']).json;
  // The task mutations rotate the input digest: P must be re-accepted after
  // the assignment and again after the completion (the proven 4_6 drive).
  acceptAll(change, ['P']);
  assert.equal(comet(['state', 'task-complete', change, tasks?.data?.tasks?.[0]?.id, '--expect', tasks?.data?.revision, '--json']).json?.exitCode, 0);
  acceptAll(change, ['P']);
  assert.equal(comet(['check', 'run', change, 'build', '--local', '--', 'node', '-e', 'process.stdout.write("build-ok\\n")']).status, 0);
  assert.equal(comet(['state', 'transition', change, 'build-complete', '--json']).json?.exitCode, 0);
  await fs.writeFile(path.join(changeDir(change), 'verification.md'), '# Verification Report\n\nProbe.\n');
  assert.equal(comet(['state', 'set', change, 'verification_report', `docs/openspec/changes/${change}/verification.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['check', 'run', change, 'verify', '--local', '--', 'node', '-e', 'process.stdout.write("verify-ok\\n")']).status, 0);
  acceptAll(change, ['V']);
  assert.equal(comet(['state', 'transition', change, 'verify-pass', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', change, 'archive-confirm', '--json']).json?.exitCode, 0);
  assert.equal(comet(['archive', change, '--json']).status, 0, plain(comet(['archive', change]).stderr ?? ''));
  return archivedDir(change);
}

const skipIfNoBuild = (t) => {
  if (!prepared || !built) {
    t.skip('patched Comet build is not present in this project; run tools/comet/prepare-source.mjs && tools/comet/build.mjs --archive first');
    return true;
  }
  return false;
};

// --- KnowledgeAuthz.v1 fixture world (P4_7 committed artifacts, LOCAL_FIXTURE) ---
const knowledgeDir = path.join(projectRoot, 'infra', 'delivery', 'knowledge');
const authzCli = path.join(projectRoot, 'tools', 'infra', 'knowledge-authz.mjs');
const FIXTURE_GROUP = 'group:sdd-harness-pilot/engineering';
const REVIEWER = 'svc:sdd-harness-pilot/worker-reviewer';
const PUBLISHER = 'svc:sdd-harness-pilot/outline-publisher';

function authzWorld() {
  const readCommitted = (name) => JSON.parse(fsSync.readFileSync(path.join(knowledgeDir, name), 'utf8'));
  const policy = readCommitted('preauthorization-policy.json');
  const ledger = readCommitted('grant-ledger.example.json');
  const fixedPolicy = structuredClone(policy);
  fixedPolicy.target.allowedAudience = {
    readers: [FIXTURE_GROUP],
    status: 'LOCAL_FIXTURE',
    reason: 'operator-declared audience for the local structural decision proof only',
  };
  for (const grant of ledger.grants) {
    if (grant.revocation === null) grant.purpose.disclosureAudience = [FIXTURE_GROUP];
  }
  const write = (name, value) => {
    const file = path.join(scratch, `authz-${name}`);
    fsSync.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  };
  return {
    model: write('model.json', readCommitted('authorization-model.json')),
    policy: write('policy.json', fixedPolicy),
    ledger: write('ledger.json', ledger),
  };
}

function runAuthz(args) {
  const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
  return spawnSync(process.execPath, [authzCli, ...args], {
    cwd: projectRoot, encoding: 'utf8', timeout: 60_000,
    env: { ...inherited, HOME: fakeHome, TMPDIR: path.join(scratch, 'tmp') },
  });
}

// --- payloads and the required-knowledge manifest --------------------------------
const KP_PAYLOAD = 'approved closeout payload v1 (project knowledge)';
const TEAM_PAYLOAD = 'approved team publication payload v1';
const KP_DIGEST = sha256(KP_PAYLOAD);
const TEAM_DIGEST = sha256(TEAM_PAYLOAD);
const CHANGE = 'p44-closeout';

// Before the K execution writes the entry, the manifest binds a digest that
// cannot be read back (deliberately unmet); afterwards it binds the REAL
// entry bytes — the same frozen candidate the K execution wrote.
const requiredManifest = ({ kpDigest } = {}) => knowledgeSeed.defineRequiredKnowledge([
  { capability: 'closeout-order', digest: kpDigest ?? KP_DIGEST, source: 'docs/architecture/delivery-architecture.md', channel: 'llmwiki' },
  { capability: 'team-publication', digest: TEAM_DIGEST, source: 'infra/delivery/knowledge/preauthorization-policy.json', channel: 'outline' },
]);
const kpWikiEntryFile = () => path.join(wikiDir, 'concepts', 'closeout-order.md');

function writeWikiEntry(capability, content) {
  const dir = path.join(wikiDir, 'concepts');
  fsSync.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${capability}.md`);
  fsSync.writeFileSync(file, [`---`, `capability: ${capability}`, `source: docs/architecture/delivery-architecture.md`, `---`, ``, `# ${capability}`, ``, content, ``].join('\n'));
  return file;
}

const kpManifestDigest = () => sha256(fsSync.readFileSync(kpWikiEntryFile()));

function runCloseoutCli({ ledgerFile, deployFile, mandatory = false, requiredFile } = {}) {
  const manifest = requiredFile ?? (() => {
    const file = path.join(scratch, `required-${Math.random().toString(36).slice(2)}.json`);
    const kpDigest = fsSync.existsSync(kpWikiEntryFile()) ? kpManifestDigest() : undefined;
    fsSync.writeFileSync(file, JSON.stringify(requiredManifest({ kpDigest }), null, 2));
    return file;
  })();
  const args = [
    'knowledge-closeout', '--project', project, '--change', CHANGE,
    '--required', manifest, '--wiki-dir', wikiDir,
  ];
  if (ledgerFile) args.push('--knowledge-ledger', ledgerFile);
  if (deployFile) args.push('--deploy-receipt', deployFile);
  if (mandatory) args.push('--code-knowledge-mandatory');
  args.push('--json');
  const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'bin', 'cli.js'), ...args], {
    cwd: projectRoot, encoding: 'utf8', timeout: 60_000, env: { ...inherited, HOME: fakeHome },
  });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* surfaced by assertions */ }
  return { ...result, json };
}

// World setup runs at load (guarded on the build) so every probe below
// exercises real behavior; without a build every test skips instead.
const prepared = await fs.access(path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'provenance.json')).then(() => true, () => false);
const built = await fs.access(path.join(buildDir, 'distribution.json')).then(() => true, () => false);
let worldReady = false;
if (prepared && built) {
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  if (init.status === 0) worldReady = true;
}

test('setup: the managed delivery build carries the post-archive closeout extension and the scratch world is comet-init', (t) => {
  if (skipIfNoBuild(t)) return;
  assert.equal(lock.patches.some((entry) => String(entry.path).endsWith('0003-post-archive-closeout.patch')), true);
  assert.notEqual(fingerprint, F2);
  assert.equal(worldReady, true, 'the scratch world must be a comet-init (classic) project');
});

test('E01/E02/E06: archived is not completed — the closeout is judged separately, the missing Kp entry is named, no archive/publish loop', async (t) => {
  if (skipIfNoBuild(t)) return;
  const dir = await driveToArchived(CHANGE);
  const runBefore = await runStateOf(dir);
  assert.notEqual(runBefore.status, 'completed', 'archived with an unmet knowledge obligation is not completed');
  assert.equal(runBefore.currentStep, 'full.closeout.knowledge');
  assert.equal(comet(['state', 'next', CHANGE, '--json']).json?.data?.nextAction?.kind, 'knowledge-closeout',
    'D07: next points at the unmet closeout obligation, never at completed');

  // E01: the empty wiki blocks Kp and the report NAMES the missing entry;
  // E02: Kt is judged separately (no publish operation yet); the archive
  // itself is untouched by both.
  const blocked = runCloseoutCli({});
  assert.equal(blocked.status, 2, `expected blocked, got ${blocked.status}: ${blocked.stdout?.slice(0, 300)}`);
  assert.equal(blocked.json.kp.ok, false);
  assert.ok(blocked.json.kp.missing.some((entry) => entry.capability === 'closeout-order'), 'the missing entry is named');
  assert.equal(blocked.json.kt.ok, false);
  assert.equal(blocked.json.kt.blocked[0].code, 'NO_PUBLISH_OPERATION');
  assert.deepEqual(blocked.json.blocked.filter((line) => line.startsWith('KT_')).length > 0, true);

  // 4.4.c precondition: a mandatory code knowledge profile is required.
  const mandatory = runCloseoutCli({ mandatory: true });
  assert.equal(mandatory.status, 2);
  assert.ok(mandatory.json.blocked.some((line) => line.includes('CODE_KNOWLEDGE_PROFILE_REQUIRED')),
    `the precondition must block a mandatory run without a profile: ${JSON.stringify(mandatory.json.blocked)}`);

  // E06: the same run continues — the re-run archive re-enters without
  // re-archiving, the run id never changes, and no publish loop starts.
  assert.equal(comet(['archive', CHANGE, '--json']).status, 0, 'archive re-entry must succeed without re-archiving');
  const archiveEntries = await fs.readdir(path.join(project, 'docs/openspec/changes/archive'));
  assert.equal(archiveEntries.filter((name) => name.endsWith(CHANGE)).length, 1, 'no second archive');
  const runAfter = await runStateOf(dir);
  assert.equal(runAfter.runId, runBefore.runId, 'E06: the SAME run continues the closeout');
  assert.equal(runAfter.status, runBefore.status);
  assert.equal(comet(['state', 'next', CHANGE, '--json']).json?.data?.nextAction?.kind, 'knowledge-closeout',
    'no archive/publish loop: the next action is still the knowledge closeout');
});

test('E01/E06: a valid deploy receipt is retained read-only — knowledge failure never re-deploys', async (t) => {
  if (skipIfNoBuild(t)) return;
  const dir = await archivedDir(CHANGE);
  const deployReceipt = { head: 'a'.repeat(40), merge: 'b'.repeat(40), project: 'managed-pilot', requiredChecks: ['delivery-gate'], checks: [] };
  const deployFile = path.join(scratch, 'deploy-chain.json');
  fsSync.writeFileSync(deployFile, JSON.stringify(deployReceipt, null, 2));
  const bytesBefore = fsSync.readFileSync(deployFile);

  const report = runCloseoutCli({ deployFile });
  assert.equal(report.status, 2, 'the run stays blocked on the knowledge obligations');
  assert.equal(report.json.deploy.status, 'RECEIPT_RETAINED');
  assert.match(report.json.deploy.action, /read-only/);
  assert.deepEqual(fsSync.readFileSync(deployFile), bytesBefore, 'the deploy receipt is byte-identical: no redeploy, no release re-run');
});

test('E01/E02: the Kp pass is granted on the real wiki entry and RETAINED while Kt stays blocked', async (t) => {
  if (skipIfNoBuild(t)) return;
  const dir = await archivedDir(CHANGE);
  writeWikiEntry('closeout-order', KP_PAYLOAD);
  void dir;
  const report = runCloseoutCli({});
  assert.equal(report.status, 2, 'overall completion still waits for the team publication');
  assert.equal(report.json.kp.ok, true, 'the Kp pass is not revoked by the later Kt block (E02)');
  assert.equal(report.json.kt.ok, false);
  assert.equal(report.json.kt.blocked[0].code, 'NO_PUBLISH_OPERATION');
});

test('D06/E02/E06: the timed-out Outline publication recovers by readback on the SAME fixed document; the Runtime re-verifies the adapter receipt and the same run completes', async (t) => {
  if (skipIfNoBuild(t)) return;
  const dir = await archivedDir(CHANGE);
  const runBefore = await runStateOf(dir);

  // Fixed target identity, derived before the first request (H04/D06).
  const documentId = outlineAdapter.deriveOutlineTargetId({ change: CHANGE, capability: 'team-publication' });

  // Real authorization: the KnowledgeAuthz.v1 decide CLI binds the review to
  // this exact payload (E02: review authorization before any write).
  const world = authzWorld();
  const request = {
    schemaVersion: 1,
    requestedBy: PUBLISHER,
    execution: 'exec-p44-authz',
    operation: {
      knowledgeId: 'team-publication',
      knowledgeType: 'project-knowledge',
      documentId,
      action: 'documents.create',
      target: {
        collection: 'outline-managed-collection',
        audienceSource: 'collection-default',
        effectiveAudience: { readers: [FIXTURE_GROUP], incompletePagination: false, unmappedPrincipals: [] },
      },
    },
    payloadDigest: TEAM_DIGEST,
    sources: [
      { domain: 'sdd-harness-repo', permissionEvidence: { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] } },
    ],
    review: {
      execution: 'exec-p44-review',
      reviewerPrincipal: REVIEWER,
      verdict: 'pass',
      boundPayloadDigest: TEAM_DIGEST,
      reviewedAt: new Date().toISOString(),
    },
  };
  const requestFile = path.join(scratch, 'publish-request.json');
  await fs.writeFile(requestFile, JSON.stringify(request, null, 2));
  const decided = runAuthz(['decide', '--request', requestFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(decided.status, 0, `decide must allow the pre-authorized publication: ${decided.stdout || decided.stderr}`);
  const decision = JSON.parse(decided.stdout);
  assert.equal(decision.interface, 'KnowledgePublishDecision.v1');
  assert.equal(decision.verdict, 'allow');

  // The runtime registers the publication operation (single ledger, fixed UUID).
  const opFile = path.join(scratch, 'publish-op.json');
  await fs.writeFile(opFile, JSON.stringify({ knowledgeId: 'team-publication', documentId, collection: 'outline-managed-collection', payloadDigest: TEAM_DIGEST }));
  const registered = comet(['state', 'knowledge-publish', CHANGE, '--file', opFile, '--json']);
  assert.equal(registered.json?.exitCode, 0, `knowledge-publish refused: ${refusalText(registered).slice(0, 300)}`);
  const operation = registered.json?.data?.operation;
  assert.equal(operation.documentId, documentId, 'the derived target identity is the fixed document UUID');

  // The adapter executes the directive with the authorization bound.
  const publishRequest = outlineAdapter.buildPublishRequest({
    directive: registered.json.data.directive, operation, decision,
  });
  assert.equal(publishRequest.tool, 'documents.create');
  assert.equal(publishRequest.documentId, documentId);
  assert.equal(publishRequest.decisionId, decision.decisionId);

  // The write TIMES OUT (no live Outline here; the recorded observation is a
  // real unknown): the adapter records unknown — never absence, never a
  // re-create — and the runtime directive says read back (D06/E06).
  const unknownObservation = outlineAdapter.buildTimeoutObservation({ operation, at: new Date().toISOString() });
  assert.equal(unknownObservation.outcome, 'unknown');
  const unknownFile = path.join(scratch, 'observe-unknown.json');
  await fs.writeFile(unknownFile, JSON.stringify(unknownObservation));
  const observedUnknown = comet(['state', 'knowledge-observe', CHANGE, '--file', unknownFile, '--json']);
  assert.equal(observedUnknown.json?.exitCode, 0, plain(observedUnknown.stderr ?? ''));
  assert.notEqual(observedUnknown.json?.data?.directive?.action, 'create', 'unknown must never degrade to create');
  assert.equal(observedUnknown.json?.data?.directive?.action, 'reconcile-info');

  // A receipt over the unknown result is refused — result unknown stays
  // blocked; the adapter refuses to even build it (D06).
  assert.throws(() => outlineAdapter.buildCloseoutReceipt({
    operation, observation: { outcome: 'unknown', readbackDigest: null, revision: null }, execution: 'exec-k', recordedAt: new Date().toISOString(),
  }), (e) => e.code === 'PUBLICATION_UNKNOWN');

  // The Runtime K dispatch is issued in the post-archive closeout window
  // (the closeout itself consumes it — H04 never accept-gates K).
  const kDispatch = comet(['state', 'dispatch-gate', CHANGE, 'K', '--json']);
  assert.equal(kDispatch.json?.exitCode, 0, `dispatch-gate K refused: ${refusalText(kDispatch).slice(0, 300)}`);
  const kBinding = kDispatch.json?.data?.dispatch;

  // A receipt whose execution holds no K dispatch is refused (P2_4 gate).
  const noDispatchReceipt = outlineAdapter.buildCloseoutReceipt({
    operation, observation: { outcome: 'exists', readbackDigest: TEAM_DIGEST, revision: 'rev-1' },
    execution: 'unregistered-k-exec', recordedAt: new Date().toISOString(),
  });
  const noDispatchFile = path.join(scratch, 'closeout-nodispatch.json');
  await fs.writeFile(noDispatchFile, JSON.stringify(noDispatchReceipt));
  const refusedDispatch = comet(['state', 'knowledge-closeout', CHANGE, '--file', noDispatchFile, '--json']);
  assert.equal(refusedDispatch.json?.exitCode !== 0, true, 'an external receipt without a Runtime K dispatch must be refused');
  assert.match(refusalText(refusedDispatch), /K dispatch/);

  // The independent readback lands on the SAME fixed document: the adapter
  // binds it into the observation and the runtime confirms the operation.
  // Step 11: the observation is declared from >= 2 distinct independent
  // channel records (api + attachment/export). This case world drives the
  // JUDGMENT with case-world channel records; the live multi-channel proof
  // against the real Outline stack is the Step 11 evidence
  // (worker-reports/P4_4-rework/evidence/outline-real-stack-*.txt) and the
  // full E01/E02/E06 journey belongs to the VERIFY node.
  const readbackObservation = outlineAdapter.buildReadbackObservation({
    operation, revision: 'rev-1', readbackDigest: TEAM_DIGEST,
    readbacks: [{ channel: 'api', digest: TEAM_DIGEST }, { channel: 'attachment', digest: TEAM_DIGEST }],
  });
  assert.equal(readbackObservation.outcome, 'exists');
  const readbackFile = path.join(scratch, 'observe-exists.json');
  await fs.writeFile(readbackFile, JSON.stringify(readbackObservation));
  const observedExists = comet(['state', 'knowledge-observe', CHANGE, '--file', readbackFile, '--json']);
  assert.equal(observedExists.json?.exitCode, 0, plain(observedExists.stderr ?? ''));
  assert.equal(observedExists.json?.data?.directive?.action, 'record-closeout');

  // The adapter-built closeout receipt — re-verified by the Runtime.
  const receipt = outlineAdapter.buildCloseoutReceipt({
    operation,
    observation: { outcome: 'exists', readbackDigest: TEAM_DIGEST, revision: 'rev-1' },
    execution: kBinding.execution,
    recordedAt: new Date().toISOString(),
  });
  assert.equal(receipt.targetKind, 'external');
  assert.equal(receipt.target, documentId);
  const receiptFile = path.join(scratch, 'closeout-receipt.json');
  await fs.writeFile(receiptFile, JSON.stringify(receipt));
  const recorded = comet(['state', 'knowledge-closeout', CHANGE, '--file', receiptFile, '--json']);
  assert.equal(recorded.json?.exitCode, 0, `closeout refused: ${refusalText(recorded).slice(0, 400)}`);

  // D07 completion predicate: the seat filled, the SAME run completes.
  const runAfter = await runStateOf(dir);
  assert.equal(runAfter.runId, runBefore.runId, 'the publication completed the SAME run');
  assert.equal(runAfter.status, 'completed', 'the run completes only after the knowledge seat is filled');
  assert.notEqual(comet(['state', 'next', CHANGE, '--json']).json?.data?.nextAction?.kind, 'knowledge-closeout');

  // The authoritative publish ledger records the publication once.
  const ledger = JSON.parse(await fs.readFile(path.join(dir, '.comet', 'knowledge-publish-operations.json'), 'utf8'));
  const publishedOps = ledger.operations.filter((entry) => entry.knowledgeId === 'team-publication' && entry.state === 'published');
  assert.equal(publishedOps.length, 1, 'exactly one published operation for the logical knowledge entry');
});

test('E01/E02: the final closeout judgment is green — Kp + Kt hold, deploy evidence retained, nothing re-run', async (t) => {
  if (skipIfNoBuild(t)) return;
  const dir = await archivedDir(CHANGE);
  const report = runCloseoutCli({
    ledgerFile: path.join(dir, '.comet', 'knowledge-publish-operations.json'),
    deployFile: path.join(scratch, 'deploy-chain.json'),
  });
  assert.equal(report.status, 0, `expected pass, got ${report.status}: ${report.stdout?.slice(0, 400)}`);
  assert.equal(report.json.pass, true);
  assert.equal(report.json.kp.ok, true);
  assert.equal(report.json.kt.ok, true);
  assert.deepEqual(report.json.blocked, []);
  assert.equal(report.json.deploy.status, 'RECEIPT_RETAINED');
});
