// Knowledge closeout tests (task P4_4, acceptance C06/D06/D07/E01/E02/E06).
//
// The R06 closeout strategy separates four facts (product acceptance / spec
// archive / team publication / overall completion) and closes them
// separately: required project knowledge (Kp) blocks the archive; required
// Outline publication (Kt) may proceed after the archive but parks overall
// completion on the SAME run. This suite drives the real judgment and
// protocol layer end to end with zero mocks of the tested objects:
//
//   lib/knowledge-seed.js     required-knowledge manifest (E01) + wiki readback
//   lib/adapters/llmwiki.js   Kp publish protocol (real MCP launcher spawn,
//                             D06 timeout -> read back first, never re-create)
//   lib/adapters/outline.js   Kt Outline publication judgment (authorization
//                             binding, fixed target identity, ledger readback)
//   lib/adapters/code-wiki.js 4.4.c code knowledge freshness over the pinned
//                             deepwiki-open/CodeGraph profile
//   bin/cli.js                `knowledge-closeout` subcommand chaining the
//                             judgments under the 0/1/2 exit contract
//   tools/mcp/llmwiki.sh      the canonical wiki root resolution (4.4.a: the
//                             CLI and the MCP launcher must resolve ONE root)
//
// Everything runs in $TMPDIR worlds; no live configuration is touched and no
// real LLMWiki/Outline service is claimed. Where no service exists, the
// protocol layer's refusal/blocking semantics ARE the tested object and the
// real service call stays honestly UNVERIFIED (successor: deployment
// verification wave).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(projectRoot, 'bin', 'cli.js');
const launcherPath = path.join(projectRoot, 'tools', 'mcp', 'llmwiki.sh');

const knowledgeSeed = await import('../lib/knowledge-seed.js');
const llmwiki = await import('../lib/adapters/llmwiki.js');
const outline = await import('../lib/adapters/outline.js');
const codeWiki = await import('../lib/adapters/code-wiki.js');
const comet = await import('../lib/adapters/comet.js');
const { getWikiHome } = await import('../lib/sdd-paths.js');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// --- scratch world -------------------------------------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-closeout-'));
const fakeHome = path.join(scratch, 'home');
const wikiHome = path.join(scratch, 'wiki-home');
const wikiDir = path.join(wikiHome, 'wiki');
fs.mkdirSync(fakeHome, { recursive: true });
fs.mkdirSync(wikiDir, { recursive: true });

// 环境卫生：NODE_TEST_CONTEXT 会让子进程误认测试上下文；ambient LLMWIKI_PYTHON 会让
// launcher 绕过测试自备的 venv 拒绝路径（4.4.a 的根一致性断言依赖 launcher 的拒绝输出）。
const { NODE_TEST_CONTEXT: _stripped, LLMWIKI_PYTHON: _strippedLauncherPy, ...inheritedEnv } = process.env;
const childEnv = (extra = {}) => ({ ...inheritedEnv, ...extra });

let tmpCounter = 0;
function writeTmp(name, value) {
  const file = path.join(scratch, `${++tmpCounter}-${name}`);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function runCli(args, extraEnv = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: childEnv({ SDD_WIKI_HOME: wikiHome, ...extraEnv }),
  });
}

// A curated wiki knowledge entry: frontmatter capability is the judgment key,
// the bytes are the independent readback digest (Kp).
function writeWikiEntry(capability, content, { source } = {}) {
  const dir = path.join(wikiDir, 'concepts');
  fs.mkdirSync(dir, { recursive: true });
  const frontmatter = [`---`, `capability: ${capability}`, ...(source ? [`source: ${source}`] : []), `---`, ``];
  const file = path.join(dir, `${capability}.md`);
  fs.writeFileSync(file, [...frontmatter, `# ${capability}`, ``, content, ``].join('\n'));
  return file;
}

const PAYLOAD_V1 = 'approved closeout payload v1';
const requiredFixture = (overrides = []) => ([
  { capability: 'closeout-order', digest: sha256(PAYLOAD_V1), source: 'docs/architecture/delivery-architecture.md', channel: 'llmwiki' },
  { capability: 'team-publication', digest: sha256('team publication payload v1'), source: 'infra/delivery/knowledge/preauthorization-policy.json', channel: 'outline' },
  ...overrides,
]);

// --- E01: the required-knowledge manifest structure -----------------------------

test('E01: defineRequiredKnowledge enforces capability/digest/source/channel and rejects plan-shaped entries', () => {
  assert.throws(() => knowledgeSeed.defineRequiredKnowledge([{ digest: sha256('x'), source: 'a', channel: 'llmwiki' }]),
    (e) => /capability/.test(e.message));
  assert.throws(() => knowledgeSeed.defineRequiredKnowledge([{ capability: 'c', digest: 'not-a-digest', source: 'a', channel: 'llmwiki' }]),
    (e) => /digest/.test(e.message));
  assert.throws(() => knowledgeSeed.defineRequiredKnowledge([{ capability: 'c', digest: sha256('x'), channel: 'llmwiki' }]),
    (e) => /source/.test(e.message), 'a required entry must carry its provenance source');
  assert.throws(() => knowledgeSeed.defineRequiredKnowledge([{ capability: 'c', digest: sha256('x'), source: 'a', channel: 'wiki' }]),
    (e) => /channel/.test(e.message), 'the knowledge channel is part of the entry (llmwiki|outline)');
  assert.throws(() => knowledgeSeed.defineRequiredKnowledge([{ capability: 'c', digest: sha256('x'), source: 'a', channel: 'llmwiki', applicable: false }]),
    (e) => /applicabilityBasis/.test(e.message), 'KG0: a not-applicable decision without a recorded basis is not a decision');
  const required = knowledgeSeed.defineRequiredKnowledge(requiredFixture());
  assert.equal(required.length, 2);
  assert.deepEqual(required.map((entry) => entry.channel).sort(), ['llmwiki', 'outline']);
});

// --- E01: the Kp judgment names every missing entry ------------------------------

test('E01 negative: a missing wiki entry blocks closeout and names the capability; digest drift is a mismatch, not a pass', () => {
  writeWikiEntry('other-capability', 'unrelated knowledge');
  const evaluation = knowledgeSeed.evaluateRequiredKnowledge({
    required: knowledgeSeed.defineRequiredKnowledge(requiredFixture().filter((entry) => entry.channel === 'llmwiki')),
    wikiDir,
  });
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.satisfied.length, 0);
  assert.deepEqual(evaluation.missing.map((entry) => entry.capability), ['closeout-order']);
  assert.equal(evaluation.missing[0].reason, 'NO_WIKI_ENTRY');

  // The entry exists but drifted from the frozen candidate digest: the
  // independent readback refuses it (a stale page is not the required fact).
  writeWikiEntry('closeout-order', 'stale content, not the approved payload');
  const drifted = knowledgeSeed.evaluateRequiredKnowledge({
    required: knowledgeSeed.defineRequiredKnowledge(requiredFixture().filter((entry) => entry.channel === 'llmwiki')),
    wikiDir,
  });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.missing[0].reason, 'KNOWLEDGE_DIGEST_MISMATCH');
  assert.equal(drifted.missing[0].expected, sha256(PAYLOAD_V1));
  assert.equal(drifted.missing[0].observed, sha256(fs.readFileSync(path.join(wikiDir, 'concepts', 'closeout-order.md'))));
});

test('E01 positive: a matching wiki entry with provenance satisfies Kp; a not-applicable entry needs its recorded basis', () => {
  // The frozen candidate IS the exact entry bytes: the manifest digest binds
  // what the K execution wrote, re-derived here from the real file.
  const entryFile = writeWikiEntry('closeout-order', PAYLOAD_V1, { source: 'docs/architecture/delivery-architecture.md' });
  const ok = knowledgeSeed.evaluateRequiredKnowledge({
    required: knowledgeSeed.defineRequiredKnowledge([
      { capability: 'closeout-order', digest: sha256(fs.readFileSync(entryFile)), source: 'docs/architecture/delivery-architecture.md', channel: 'llmwiki' },
    ]),
    wikiDir,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.satisfied.map((entry) => entry.capability), ['closeout-order']);
  assert.equal(ok.checked, 1);

  // A source declared in the manifest must not be contradicted by the entry.
  const sourcedFile = writeWikiEntry('sourced-entry', PAYLOAD_V1, { source: 'somewhere/else.md' });
  const sourceConflict = knowledgeSeed.evaluateRequiredKnowledge({
    required: knowledgeSeed.defineRequiredKnowledge([
      { capability: 'sourced-entry', digest: sha256(fs.readFileSync(sourcedFile)), source: 'docs/architecture/delivery-architecture.md', channel: 'llmwiki' },
    ]),
    wikiDir,
  });
  assert.equal(sourceConflict.ok, false);
  assert.equal(sourceConflict.missing[0].reason, 'KNOWLEDGE_SOURCE_MISMATCH');

  const inapplicable = knowledgeSeed.evaluateRequiredKnowledge({
    required: knowledgeSeed.defineRequiredKnowledge([
      { capability: 'scale-notes', digest: sha256('unused'), source: 'a.md', channel: 'llmwiki', applicable: false, applicabilityBasis: 'impact-note digest 4f11…' },
    ]),
    wikiDir,
  });
  assert.equal(inapplicable.ok, true, 'a not-applicable entry with a recorded basis does not block');
  assert.deepEqual(inapplicable.inapplicable.map((entry) => entry.capability), ['scale-notes']);
});

// --- D06: the LLMWiki publish protocol layer ------------------------------------

const kpEntry = { capability: 'closeout-order', digest: sha256(PAYLOAD_V1), source: 'docs', channel: 'llmwiki' };

test('D06: the MCP protocol layer reports a real launcher refusal structurally — never a fake success', async () => {
  const operation = llmwiki.buildKpOperation({ change: 'p44-change', entry: kpEntry });
  assert.match(operation.operationId, /^kp-[0-9a-f]{16}$/);
  assert.equal(llmwiki.buildKpOperation({ change: 'p44-change', entry: kpEntry }).operationId, operation.operationId,
    'the operation id is deterministic: retries re-target the same operation');
  assert.equal(operation.tool, 'mcp__llmwiki__create');
  assert.equal(operation.contentDigest, sha256(PAYLOAD_V1));

  // The REAL launcher entrance: SDD_HOME points at an empty tmp home, so the
  // launcher resolves and refuses for real (no venv) — the adapter must turn
  // that into a structured unavailable record, not a pass.
  const unavailable = await llmwiki.invokeMcpPublish({
    operation,
    launcherPath,
    timeoutMs: 15_000,
    env: childEnv({ SDD_HOME: path.join(scratch, 'empty-sdd-home') }),
  });
  assert.equal(unavailable.status, 'LAUNCHER_UNAVAILABLE');
  assert.equal(unavailable.exitCode, 1);
  assert.match(unavailable.reason, /venv/);
});

test('D06: a publication timeout resolves by independent readback of the original target — unknown stays blocked, no re-create', async () => {
  const operation = llmwiki.buildKpOperation({ change: 'p44-change', entry: kpEntry });

  // A real launcher-shaped process that keeps the session open but never
  // answers the tools/call (fixture script, 30s sleep vs 400ms timeout): the
  // invoke must time out and MUST NOT retry the create on its own.
  const silentLauncher = path.join(scratch, 'silent-launcher.sh');
  fs.writeFileSync(silentLauncher, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  const result = await llmwiki.invokeMcpPublish({
    operation,
    launcherPath: silentLauncher,
    timeoutMs: 400,
    env: childEnv(),
  });
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(result.operationId, operation.operationId);
  assert.match(result.guidance, /readback/i);
  assert.match(result.guidance, /never re-create/i);

  // Readback confirms the payload landed (the K execution re-derived the
  // digest from the real target bytes): resolved WITHOUT a second create.
  const confirmed = llmwiki.resolveTimedOutPublish({
    operation,
    readback: { found: true, digest: sha256(PAYLOAD_V1), source: 'independent-readback', at: '2026-10-21T00:00:00.000Z' },
  });
  assert.equal(confirmed.resolved, true);
  assert.equal(confirmed.outcome, 'CONFIRMED_BY_READBACK');
  assert.deepEqual(confirmed.receipt, { id: 'llmwiki:closeout-order', digest: sha256(PAYLOAD_V1) });

  // Readback cannot find the target: the result is unknown, the run stays
  // blocked and a re-create is refused by the journal guard (E06).
  const unknown = llmwiki.resolveTimedOutPublish({
    operation,
    readback: { found: false, digest: null, source: 'independent-readback', at: '2026-10-21T00:00:00.000Z' },
  });
  assert.equal(unknown.resolved, false);
  assert.equal(unknown.outcome, 'PUBLICATION_UNKNOWN');

  const refused = llmwiki.refuseDuplicateCreate({ issuedOperationIds: [operation.operationId], operationId: operation.operationId });
  assert.equal(refused.refused, true);
  assert.equal(refused.code, 'DUPLICATE_CREATE_REFUSED');
  assert.equal(llmwiki.refuseDuplicateCreate({ issuedOperationIds: [], operationId: operation.operationId }).refused, false);

  // A readback that returns DIFFERENT bytes is a mismatch, never a pass.
  const mismatch = llmwiki.resolveTimedOutPublish({
    operation,
    readback: { found: true, digest: sha256('something else'), source: 'independent-readback', at: '2026-10-21T00:00:00.000Z' },
  });
  assert.equal(mismatch.resolved, false);
  assert.equal(mismatch.outcome, 'READBACK_MISMATCH');
});

// --- C06: the Kp receipt feeds the P1_3 seal and the knowledge boundary -----------

test('C06: the adapter Kp receipt seals the archive exactly once; a second seal is refused (no archive loop)', () => {
  const operation = llmwiki.buildKpOperation({ change: 'p44-change', entry: kpEntry });
  const receipt = llmwiki.buildKpCloseoutReceipt({ operation, execution: 'exec-kp-1', recordedAt: '2026-10-21T00:00:00.000Z' });
  assert.deepEqual(receipt, { id: 'llmwiki:closeout-order', digest: sha256(PAYLOAD_V1) });

  const sealableSeal = {
    change: 'p44-change', phase: 'archive', verifyResult: 'pass', archiveConfirmation: 'confirmed', archived: false, checkEpoch: 3,
  };
  assert.throws(() => comet.sealCloseout({ seal: sealableSeal, execution: 'exec-closeout-1', knowledgeCloseout: null }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED');
  const sealed = comet.sealCloseout({ seal: sealableSeal, execution: 'exec-closeout-1', knowledgeCloseout: receipt });
  assert.equal(sealed.archived, true);
  assert.throws(() => comet.sealCloseout({ seal: { ...sealableSeal, archived: true }, execution: 'exec-closeout-2', knowledgeCloseout: receipt }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED');
});

test('C06: knowledge evidence is source-bound — an Outline publication cannot satisfy an llmwiki capability', () => {
  assert.equal(llmwiki.refuseCrossSourceEvidence({ channel: 'llmwiki', evidenceSource: 'llmwiki' }).allowed, true);
  const violation = llmwiki.refuseCrossSourceEvidence({ channel: 'llmwiki', evidenceSource: 'outline' });
  assert.equal(violation.allowed, false);
  assert.equal(violation.code, 'KNOWLEDGE_SOURCE_SUBSTITUTION');
  // ...and the reverse: an llmwiki entry is not a team publication (Kt).
  const reverse = outline.refuseCrossSourceEvidence({ channel: 'outline', evidenceSource: 'llmwiki' });
  assert.equal(reverse.allowed, false);
  assert.equal(reverse.code, 'KNOWLEDGE_SOURCE_SUBSTITUTION');
});

// --- E02: the Outline publication judgment (authorization -> fixed identity) ------

// Same canonical JSON as the committed KnowledgeAuthz.v1 (sorted keys, arrays
// in order): the adapter recomputes decisionId over the receipt fields.
const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

function decisionFixture({ payloadDigest, audience, verdict } = {}) {
  const fields = {
    schemaVersion: 1,
    interface: 'KnowledgePublishDecision.v1',
    operation: { knowledgeId: 'team-publication', action: 'documents.create' },
    payloadDigest: payloadDigest ?? sha256('team publication payload v1'),
    grants: ['grant-pilot-001'],
    audience: { rule: 'intersection', allowed: audience ?? ['group:sdd-harness-pilot/engineering'], effective: audience ?? ['group:sdd-harness-pilot/engineering'], sources: {} },
    bindings: { ledgerDigest: sha256('ledger'), modelDigest: sha256('model'), policyDigest: sha256('policy') },
    decidedAt: '2026-10-21T00:00:00.000Z',
    execution: 'exec-authz-1',
    readback: { plan: 'documents.info after write' },
    limits: { autoRenewal: false },
    provenance: { permissionEvidence: 'LOCAL_ONLY fixture' },
  };
  const decisionId = sha256(stableStringify(fields));
  return { ...fields, decisionId, verdict: verdict ?? 'allow' };
}

test('E02: publication requires an authorization receipt bound to the payload digest and a policy audience', () => {
  const operation = {
    capability: 'team-publication',
    payloadDigest: sha256('team publication payload v1'),
    documentId: outline.deriveOutlineTargetId({ change: 'p44-change', capability: 'team-publication' }),
    collection: 'outline-managed-collection',
  };
  assert.match(operation.documentId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(outline.deriveOutlineTargetId({ change: 'p44-change', capability: 'team-publication' }), operation.documentId,
    'the target identity is fixed before the first request (retries reuse it)');
  assert.notEqual(outline.deriveOutlineTargetId({ change: 'p44-change', capability: 'other' }), operation.documentId);

  assert.throws(() => outline.evaluatePublishAuthorization({ operation, decision: null }),
    (e) => e.code === 'OUTLINE_AUTHZ_REQUIRED');
  const tampered = { ...decisionFixture(), verdict: 'allow', decisionId: sha256('forged') };
  assert.throws(() => outline.evaluatePublishAuthorization({ operation, decision: tampered }),
    (e) => e.code === 'TAMPERED_DECISION', 'decisionId covers every receipt field: tampering invalidates');
  assert.throws(() => outline.evaluatePublishAuthorization({ operation, decision: decisionFixture({ verdict: 'deny' }) }),
    (e) => e.code === 'OUTLINE_AUTHZ_NOT_GRANTED');
  assert.throws(() => outline.evaluatePublishAuthorization({ operation, decision: decisionFixture({ payloadDigest: sha256('other payload') }) }),
    (e) => e.code === 'AUTHZ_PAYLOAD_MISMATCH', 'review/decision bind the frozen payload digest (U04)');
  assert.throws(() => outline.evaluatePublishAuthorization({ operation, decision: decisionFixture({ audience: [] }) }),
    (e) => e.code === 'OUTLINE_AUDIENCE_REQUIRED', 'the empty allowed audience stays fail-closed');

  const allowed = outline.evaluatePublishAuthorization({ operation, decision: decisionFixture() });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.decisionId, decisionFixture().decisionId);
});

test('E02/D06: the adapter executes runtime directives only — reconcile-info never degrades to create, and timeout is unknown', () => {
  const operation = {
    operationKey: sha256('op-key'),
    knowledgeId: 'team-publication',
    documentId: outline.deriveOutlineTargetId({ change: 'p44-change', capability: 'team-publication' }),
    collection: 'outline-managed-collection',
    payloadDigest: sha256('team publication payload v1'),
    baseRevision: null,
    state: 'pending',
    lastObservation: null,
  };
  const decision = decisionFixture();

  // The runtime directive after an unknown outcome: read back, never create.
  assert.throws(() => outline.buildPublishRequest({ directive: { action: 'reconcile-info', documentId: operation.documentId }, operation, decision }),
    (e) => e.code === 'DIRECTIVE_NOT_EXECUTABLE');
  assert.throws(() => outline.buildPublishRequest({
    directive: { action: 'create', documentId: 'a-different-document' }, operation, decision,
  }), (e) => e.code === 'TARGET_ID_MISMATCH', 'a re-created page is never the original target');

  const request = outline.buildPublishRequest({ directive: { action: 'create', documentId: operation.documentId }, operation, decision });
  assert.equal(request.interface, 'OutlinePublish.v1');
  assert.equal(request.tool, 'documents.create');
  assert.equal(request.documentId, operation.documentId);
  assert.equal(request.decisionId, decision.decisionId);

  // Timeout observation: unknown, never absence (H04/D06).
  assert.deepEqual(outline.buildTimeoutObservation({ operation, at: '2026-10-21T00:00:00.000Z' }), {
    operationKey: operation.operationKey, documentId: operation.documentId, outcome: 'unknown', at: '2026-10-21T00:00:00.000Z',
  });

  // The readback observation binds the registered payload digest.
  assert.equal(outline.buildReadbackObservation({ operation, revision: 'rev-1', readbackDigest: operation.payloadDigest }).outcome, 'exists');
  assert.equal(outline.buildReadbackObservation({ operation, revision: 'rev-1', readbackDigest: sha256('drifted') }).outcome, 'conflict');
});

test('E02: the closeout receipt is only built from a confirmed independent readback', () => {
  const operation = {
    operationKey: sha256('op-key'),
    knowledgeId: 'team-publication',
    documentId: outline.deriveOutlineTargetId({ change: 'p44-change', capability: 'team-publication' }),
    collection: 'outline-managed-collection',
    payloadDigest: sha256('team publication payload v1'),
  };
  assert.throws(() => outline.buildCloseoutReceipt({
    operation, observation: { outcome: 'unknown', readbackDigest: null, revision: null }, execution: 'exec-k-1', recordedAt: '2026-10-21T00:00:00.000Z',
  }), (e) => e.code === 'PUBLICATION_UNKNOWN', 'an unknown result stays blocked (D06)');
  assert.throws(() => outline.buildCloseoutReceipt({
    operation, observation: { outcome: 'exists', readbackDigest: sha256('drifted'), revision: 'rev-1' }, execution: 'exec-k-1', recordedAt: '2026-10-21T00:00:00.000Z',
  }), (e) => e.code === 'READBACK_MISMATCH');
  // D06 补注（P4_4 评审 nb-1）：absent 与 conflict 两个 fail-closed 分支此前已实现未测。
  assert.throws(() => outline.buildCloseoutReceipt({
    operation, observation: { outcome: 'absent', readbackDigest: null, revision: null }, execution: 'exec-k-1', recordedAt: '2026-10-21T00:00:00.000Z',
  }), (e) => e.code === 'PUBLICATION_ABSENT', 'a confirmed-absent readback is a failure, never a quiet pass (D06)');
  assert.throws(() => outline.buildCloseoutReceipt({
    operation, observation: { outcome: 'conflict', readbackDigest: sha256('drifted'), revision: 'rev-1' }, execution: 'exec-k-1', recordedAt: '2026-10-21T00:00:00.000Z',
  }), (e) => e.code === 'READBACK_CONFLICT', 'drifted remote content requires reconciliation before recording (H05)');
  const receipt = outline.buildCloseoutReceipt({
    operation, observation: { outcome: 'exists', readbackDigest: operation.payloadDigest, revision: 'rev-1' }, execution: 'exec-k-1', recordedAt: '2026-10-21T00:00:00.000Z',
  });
  assert.equal(receipt.targetKind, 'external');
  assert.equal(receipt.target, operation.documentId);
  assert.equal(receipt.readbackDigest, operation.payloadDigest);
});

// --- E02: the Kt completion predicate over the authoritative runtime ledger -------

test('E02: evaluateKtFromLedger reads the single runtime publish ledger — pending stays blocked, published with the bound digest satisfies', () => {
  const required = knowledgeSeed.defineRequiredKnowledge(requiredFixture().filter((entry) => entry.channel === 'outline'));
  const documentId = outline.deriveOutlineTargetId({ change: 'p44-change', capability: 'team-publication' });

  const blocked = outline.evaluateKtFromLedger({ required, ledger: { schema: 'comet.classic.knowledge-publish.v1', operations: [] } });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blocked.map((entry) => entry.capability), ['team-publication']);
  assert.equal(blocked.blocked[0].code, 'NO_PUBLISH_OPERATION');

  const pending = outline.evaluateKtFromLedger({
    required,
    ledger: {
      schema: 'comet.classic.knowledge-publish.v1',
      operations: [{
        operationKey: sha256('k'), knowledgeId: 'team-publication', documentId, collection: 'outline-managed-collection',
        payloadDigest: sha256('team publication payload v1'), baseRevision: null, lastRevision: null, state: 'pending',
        attempts: 2, lastObservation: { outcome: 'unknown', revision: null, readbackDigest: null, at: '2026-10-21T00:00:00.000Z' },
        createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
      }],
    },
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.blocked[0].code, 'PUBLICATION_UNKNOWN', 'an unknown result is never absence');

  const drifted = outline.evaluateKtFromLedger({
    required,
    ledger: {
      schema: 'comet.classic.knowledge-publish.v1',
      operations: [{
        operationKey: sha256('k'), knowledgeId: 'team-publication', documentId, collection: 'outline-managed-collection',
        payloadDigest: sha256('team publication payload v1'), baseRevision: null, lastRevision: 'rev-1', state: 'published',
        attempts: 1, lastObservation: { outcome: 'exists', revision: 'rev-1', readbackDigest: sha256('other payload'), at: '2026-10-21T00:00:00.000Z' },
        createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
      }],
    },
  });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.blocked[0].code, 'KT_DIGEST_MISMATCH');

  const satisfied = outline.evaluateKtFromLedger({
    required,
    ledger: {
      schema: 'comet.classic.knowledge-publish.v1',
      operations: [{
        operationKey: sha256('k'), knowledgeId: 'team-publication', documentId, collection: 'outline-managed-collection',
        payloadDigest: sha256('team publication payload v1'), baseRevision: null, lastRevision: 'rev-1', state: 'published',
        attempts: 1, lastObservation: { outcome: 'exists', revision: 'rev-1', readbackDigest: sha256('team publication payload v1'), at: '2026-10-21T00:00:00.000Z' },
        createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
      }],
    },
  });
  assert.equal(satisfied.ok, true);
  assert.deepEqual(satisfied.satisfied.map((entry) => entry.capability), ['team-publication']);
});

// --- 4.4.c: the code knowledge freshness gate -------------------------------------

const PINNED_COMMIT = 'a'.repeat(40);

test('4.4.c: a mandatory code knowledge profile is required; undecided branches stay pending admission, never satisfied', () => {
  assert.equal(codeWiki.CODE_KNOWLEDGE_PRECONDITION, 'CODE_KNOWLEDGE_PROFILE_REQUIRED_IF_MANDATORY');

  const blocked = codeWiki.resolveCodeKnowledgeProfile({ policy: null, mandatory: true });
  assert.equal(blocked.blocked, 'CODE_KNOWLEDGE_PROFILE_REQUIRED', 'the precondition blocks final acceptance without a profile');

  const notConfigured = codeWiki.resolveCodeKnowledgeProfile({ policy: null, mandatory: false });
  assert.equal(notConfigured.applicable, false);
  assert.equal(notConfigured.blocked, undefined, 'a non-mandatory run without a profile is not a block');

  assert.throws(() => codeWiki.resolveCodeKnowledgeProfile({ policy: { required: false }, mandatory: false }),
    (e) => /undecided/.test(e.message), 'a pending profile must name its undecided branches');

  const profile = codeWiki.resolveCodeKnowledgeProfile({
    policy: { required: true, pinned: { commit: PINNED_COMMIT, artifacts: [{ kind: 'deepwiki-open-image', digest: `sha256:${sha256('image')}` }] } },
    mandatory: true,
  });
  assert.equal(profile.required, true);
  assert.equal(profile.pinned.commit, PINNED_COMMIT);

  const pending = codeWiki.resolveCodeKnowledgeProfile({
    policy: { required: false, undecided: ['language', 'scale', 'deployment'], pendingReason: 'pilot branch not selected' },
    mandatory: false,
  });
  assert.equal(pending.pending, true);
  const judged = codeWiki.evaluateCodeWikiReceipt({ profile: pending, receipt: { commit: PINNED_COMMIT, artifacts: [] } });
  assert.equal(judged.ok, false);
  assert.equal(judged.code, 'CODE_KNOWLEDGE_PENDING_ADMISSION', 'an undecided branch is not a pass');
});

test('4.4.c: the freshness receipt binds the exact pinned commit and artifact digests (stale is refused)', () => {
  const profile = codeWiki.resolveCodeKnowledgeProfile({
    policy: { required: true, pinned: { commit: PINNED_COMMIT, artifacts: [{ kind: 'deepwiki-open-image', digest: `sha256:${sha256('image')}` }] } },
    mandatory: true,
  });
  assert.throws(() => codeWiki.evaluateCodeWikiReceipt({ profile, receipt: null }),
    (e) => e.code === 'CODE_WIKI_RECEIPT_REQUIRED');
  assert.throws(() => codeWiki.evaluateCodeWikiReceipt({ profile, receipt: { commit: 'b'.repeat(40), artifacts: [] } }),
    (e) => e.code === 'STALE_CODE_KNOWLEDGE', 'a receipt on another commit is stale');
  assert.throws(() => codeWiki.evaluateCodeWikiReceipt({
    profile, receipt: { commit: PINNED_COMMIT, artifacts: [{ kind: 'deepwiki-open-image', digest: `sha256:${sha256('other')}` }] },
  }), (e) => e.code === 'ARTIFACT_DIGEST_MISMATCH');
  assert.throws(() => codeWiki.evaluateCodeWikiReceipt({ profile, receipt: { commit: PINNED_COMMIT, artifacts: profile.pinned.artifacts, readback: null } }),
    (e) => e.code === 'CODE_WIKI_READBACK_REQUIRED', 'policy requires a real API/MCP independent readback');
  const fresh = codeWiki.evaluateCodeWikiReceipt({
    profile, receipt: { commit: PINNED_COMMIT, artifacts: profile.pinned.artifacts, readback: { channel: 'api', at: '2026-10-21T00:00:00.000Z' } },
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.fresh, true);
});

// --- the CLI subcommand chains the judgments (exit 0/1/2) --------------------------

function closeoutArgs({ requiredFile, ledgerFile, deployFile, codePolicy, codeReceipt, mandatory } = {}) {
  const args = [
    'knowledge-closeout',
    '--project', projectRoot,
    '--change', 'p44-change',
    '--required', requiredFile,
    '--wiki-dir', wikiDir,
  ];
  if (ledgerFile) args.push('--knowledge-ledger', ledgerFile);
  if (deployFile) args.push('--deploy-receipt', deployFile);
  if (codePolicy) args.push('--code-policy', codePolicy);
  if (codeReceipt) args.push('--code-receipt', codeReceipt);
  if (mandatory) args.push('--code-knowledge-mandatory');
  args.push('--json');
  return args;
}

const emptyLedger = { schema: 'comet.classic.knowledge-publish.v1', operations: [] };

// The CLI manifest binds the frozen candidate exactly as the K execution
// wrote it: the closeout-order digest is re-derived from the real entry file.
const requiredManifestForCli = () => knowledgeSeed.defineRequiredKnowledge([
  { capability: 'closeout-order', digest: sha256(fs.readFileSync(path.join(wikiDir, 'concepts', 'closeout-order.md'))), source: 'docs/architecture/delivery-architecture.md', channel: 'llmwiki' },
  { capability: 'team-publication', digest: sha256('team publication payload v1'), source: 'infra/delivery/knowledge/preauthorization-policy.json', channel: 'outline' },
]);

test('CLI: a missing Kp entry blocks with exit 2 and names the capability; deploy evidence is retained read-only (no redeploy)', () => {
  const deployReceipt = { head: 'a'.repeat(40), merge: 'b'.repeat(40), project: 'managed-pilot', requiredChecks: ['delivery-gate'], checks: [] };
  const deployFile = writeTmp('deploy-chain.json', deployReceipt);
  const deployBytes = fs.readFileSync(deployFile);

  const report = runCli(closeoutArgs({
    requiredFile: writeTmp('required.json', requiredFixture()),
    ledgerFile: writeTmp('ledger.json', emptyLedger),
    deployFile,
  }));
  assert.equal(report.status, 2, `expected blocked exit 2, got ${report.status}: ${report.stdout.slice(0, 400)}`);
  const parsed = JSON.parse(report.stdout);
  assert.equal(parsed.interface, 'Knowledge.Closeout.v1');
  assert.equal(parsed.pass, false);
  assert.ok(parsed.kp.missing.some((entry) => entry.capability === 'closeout-order'), 'the blocked report names the missing entry');
  assert.ok(parsed.blocked.some((line) => line.includes('closeout-order')));
  assert.equal(parsed.deploy.status, 'RECEIPT_RETAINED');
  assert.match(parsed.deploy.action, /read-only/);
  assert.deepEqual(fs.readFileSync(deployFile), deployBytes, 'the deploy receipt file is byte-identical: knowledge failure never re-deploys');
});

test('CLI: valid Kp but pending Kt blocks overall completion while the Kp pass stands (E02 separated verification)', () => {
  // 'closeout-order' already matches in wikiDir from the E01 positive test.
  const report = runCli(closeoutArgs({
    requiredFile: writeTmp('required.json', requiredManifestForCli()),
    ledgerFile: writeTmp('ledger.json', emptyLedger),
  }));
  assert.equal(report.status, 2);
  const parsed = JSON.parse(report.stdout);
  assert.equal(parsed.kp.ok, true, 'the valid Kp pass is retained, not revoked');
  assert.equal(parsed.kt.ok, false);
  assert.equal(parsed.kt.blocked[0].code, 'NO_PUBLISH_OPERATION');
  assert.ok(parsed.blocked.some((line) => line.startsWith('KT_')), 'overall completion stays blocked on the publication');
});

test('CLI: an absent publish ledger blocks as NO_PUBLISH_OPERATION; a malformed one is invalid input', () => {
  const absent = runCli(closeoutArgs({
    requiredFile: writeTmp('required.json', requiredManifestForCli()),
    ledgerFile: path.join(scratch, 'does-not-exist', 'knowledge-publish-operations.json'),
  }));
  assert.equal(absent.status, 2, 'no ledger = no registered publication: the Kt judgment blocks, honestly');
  const parsed = JSON.parse(absent.stdout);
  assert.equal(parsed.kt.blocked[0].code, 'NO_PUBLISH_OPERATION');

  const malformed = runCli(closeoutArgs({
    requiredFile: writeTmp('required.json', requiredManifestForCli()),
    ledgerFile: writeTmp('ledger-bad.json', '{not the runtime ledger'),
  }));
  assert.equal(malformed.status, 1, 'a present-but-unreadable ledger is an input failure, not a block');
});

test('CLI: exit 0 requires Kp + Kt + code sections all green; invalid input exits 1', () => {
  // Kt satisfied over the real ledger shape; code knowledge not mandatory.
  const ledger = {
    schema: 'comet.classic.knowledge-publish.v1',
    operations: [{
      operationKey: sha256('k'), knowledgeId: 'team-publication',
      documentId: outline.deriveOutlineTargetId({ change: 'p44-change', capability: 'team-publication' }),
      collection: 'outline-managed-collection', payloadDigest: sha256('team publication payload v1'),
      baseRevision: null, lastRevision: 'rev-1', state: 'published', attempts: 1,
      lastObservation: { outcome: 'exists', revision: 'rev-1', readbackDigest: sha256('team publication payload v1'), at: '2026-10-21T00:00:00.000Z' },
      createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    }],
  };
  const green = runCli(closeoutArgs({
    requiredFile: writeTmp('required.json', requiredManifestForCli()),
    ledgerFile: writeTmp('ledger.json', ledger),
  }));
  assert.equal(green.status, 0, `expected pass, got ${green.status}: ${green.stdout.slice(0, 400)}`);
  const parsed = JSON.parse(green.stdout);
  assert.equal(parsed.pass, true);
  assert.deepEqual(parsed.blocked, []);

  // Invalid inputs are exit 1, never a silent pass or a fake block.
  assert.equal(runCli(closeoutArgs({ requiredFile: '/nonexistent/required.json' })).status, 1);
  assert.equal(runCli(closeoutArgs({ requiredFile: writeTmp('bad.json', '{not json') })).status, 1);
  const missingManifest = runCli(['knowledge-closeout', '--project', projectRoot, '--change', 'c', '--json']);
  assert.equal(missingManifest.status, 1, 'the required manifest is a required option');
});

test('4.4.a: the CLI and the MCP launcher resolve the SAME canonical wiki root (worktree-safe slug)', () => {
  // JS side: lib/sdd-paths.js getWikiHome under the fixture SDD_HOME (env
  // hygiene: the ambient SDD_WIKI_HOME must not leak into this comparison).
  const previousHome = process.env.SDD_HOME;
  const previousWikiHome = process.env.SDD_WIKI_HOME;
  process.env.SDD_HOME = fakeHome;
  process.env.SDD_WIKI_HOME = '';
  let jsRoot;
  try {
    jsRoot = getWikiHome(projectRoot);
  } finally {
    if (previousHome === undefined) delete process.env.SDD_HOME; else process.env.SDD_HOME = previousHome;
    if (previousWikiHome === undefined) delete process.env.SDD_WIKI_HOME; else process.env.SDD_WIKI_HOME = previousWikiHome;
  }
  assert.ok(jsRoot.startsWith(path.join(fakeHome, 'wiki') + path.sep),
    `the wiki root resolves under the fixture SDD_HOME, got ${jsRoot}`);

  // Shell side: the launcher's resolution is printed in its venv refusal.
  const launcher = spawnSync('bash', [launcherPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: childEnv({ SDD_HOME: fakeHome, SDD_WIKI_HOME: '' }),
  });
  assert.equal(launcher.status, 1);
  assert.ok(launcher.stderr.includes(jsRoot),
    `the launcher must resolve the canonical root like the CLI (${jsRoot}), got: ${launcher.stderr}`);

  // An explicit SDD_WIKI_HOME override wins on both sides.
  const overrideRoot = path.join(scratch, 'override-wiki');
  const overridden = spawnSync('bash', [launcherPath], {
    cwd: projectRoot, encoding: 'utf8', timeout: 30_000,
    env: childEnv({ SDD_HOME: fakeHome, SDD_WIKI_HOME: overrideRoot }),
  });
  assert.ok(overridden.stderr.includes(overrideRoot), `override must win: ${overridden.stderr}`);
});
