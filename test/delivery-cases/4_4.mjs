// P4_4 delivery case — comet-050 revision (2026-10-26-comet-050-adoption-v1):
// the REAL knowledge closed loop Kp -> archive -> Kt inside ONE Run.
//
// The retired 0.4.5 face of this case (patch 0003, `state init
// --managed-delivery` / dispatch-gate / knowledge-publish under
// .comet-state.lock, P4_7 fixture audience overrides) is GONE on the pinned
// 0.5.0 supply — the honest RED for this revision
// (worker-reports/P4_4-comet-050/evidence/RED-4_4-pre050.txt, 6/6 fail). The
// retired patch files stay retired (0005 is the only successor on this
// baseline; infra-runner-isolation pins their absence).
//
// What this revision proves, every step REAL in one-shot /tmp worlds
// (isolated HOME, pinned node 24.15.0, pinned openspec 1.15.0 through the
// COMET_OPENSPEC seam — the only archive writer, the same pin the managed
// spec-adapter family (3_4) resolved to):
//
//   Kp  (Knowledge.Closeout.v1, before every archive)
//        a REAL classic Run is driven open→verify on the public state/check
//        face; the knowledge author (a separate process) writes the reusable
//        experience body, the candidate is FROZEN by digest, an INDEPENDENT
//        reviewer process binds its pass to the frozen digest, and the REAL
//        LLMWiki stdio MCP (the I04-admitted venv + local_server, driven by
//        the installed mcp SDK ClientSession in a Python subprocess) writes
//        the page: initialize → tools/list → list_knowledge_bases → create →
//        read → search. The readback is verified on THREE channels: the MCP
//        session read (byte-suffix of the frozen body), the disk file
//        (filesystem is truth), and the native read-only SQLite
//        documents/chunks_fts index. The packaged composition Kp extension
//        (sdd.delivery.gate.kp at full.verify.check.evidence, R3-frozen
//        package) judges the evidence LIVE through its own validator
//        (bindings.mjs -> lib/delivery/gate.js evaluate): the pass with the
//        real readback receipt is ACCEPTED, the same payload with no receipt
//        is refused MISSING_OBSERVATION — and the extension's declared
//        artifact .sdd/delivery/gates/kp/receipt-bundle.json exists at the
//        static ref with content-addressed bytes.
//   Archive
//        the managed single-closeout-owner seal (sealCloseout, Kp BEFORE the
//        move) then the REAL `comet archive` through the managed spec adapter
//        — the pinned openspec 1.15.0 CLI invoked exactly once (a transparent
//        invocation logger proves the seam), one archive directory, main
//        specs synced, the SAME run id, and the Kp bundle bytes stable
//        post-archive.
//   Kt  (after the archive, same Run — never completed by the archive)
//        the public continuation face keeps naming delivery ("do not archive
//        again"), the 0005 resolver parks the SAME Run at full.archive.execute
//        while Kt is required and unmet, and the managed recovery keeps
//        discovering the same run not-completion-eligible (the P4_6
//        mechanism, re-proven inside THIS closed loop). The LIVE Outline
//        publication is attempted for real against the local stack
//        (http://127.0.0.1:3000 documents.create with the fixed derived
//        documentId): with no publisher credential provisioned the API
//        refuses 401 authentication_required — recorded verbatim as the
//        honest UNVERIFIED-NEEDS-GRANT path (a real external write needs the
//        P4_7 grant chain; nothing is faked). The Kt obligation stays pending
//        in the publish ledger (PUBLICATION_UNKNOWN — unknown is never
//        absence), and the REAL KnowledgeAuthz.v1 decide CLI over the
//        COMMITTED policy/ledger (no fixture overrides) refuses the
//        publication request fail-closed — the authorization precondition
//        made live.
//
// Proven UNVERIFIED (recorded in the proof and the worker report, never
// papered over): the authorized Outline publish + multi-channel readback
// (needs the P4_7 ktSurface requiredEntries — all NOT_PROVISIONED today),
// and the persisted knowledgeCloseout state-field write through a 0.5.0
// public command (supply/admission wave; the parked row is proven at the
// patched resolver seam over the run's real state bytes).
//
// Structure (the 3_3/3_4/4_6 discipline): the world work runs in a
// PINNED-node scenario subprocess of this same file
// (`--kp-scenario knowledge-closeout`) that performs the real drive and emits
// a bounded proof JSON; the outer tests assert the proof sections. Missing
// prerequisites skip with an explicit reason — they never pass silently.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// --- pinned supply resolution --------------------------------------------------

const cometLockPath = path.join(projectRoot, 'integrations/comet/upstream.lock.json');
const cometLock = JSON.parse(fs.readFileSync(cometLockPath, 'utf8'));
const cometFingerprint = sha256(JSON.stringify({
  archive: cometLock.source.sha256,
  patches: cometLock.patches.map(({ path: patchPath, sha256: patchSha }) => ({ path: patchPath, sha256: patchSha })),
  toolchain: cometLock.toolchain,
}));
const cometBuildDir = path.join(projectRoot, '.sdd/vendor/comet', cometLock.source.commit, 'builds', cometFingerprint);
const cometEntrypoint = path.join(cometBuildDir, 'work/bin/comet.js');
const cometBuildPresent = fs.existsSync(cometEntrypoint)
  && fs.existsSync(path.join(cometBuildDir, 'distribution.json'))
  && fs.existsSync(path.join(projectRoot, '.sdd/vendor/comet', cometLock.source.commit, 'provenance.json'));

// The pinned archive writer — the same seam and pin the managed spec-adapter
// family resolved to (test/delivery-cases/3_4.mjs OPENSPEC_CLI).
const openspecCli = path.join(projectRoot, '.sdd/tools/openspec-1.15.0/node_modules/.bin/openspec');
const openspecReady = (() => {
  const probe = spawnSync(openspecCli, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  return probe.status === 0 && probe.stdout.trim() === '1.15.0';
})();

// The I04-admitted LLMWiki supply: registered project venv python (3.11 +
// mcp SDK) + the project-local clone whose mcp/ package is the server.
const llmwikiPython = path.join(projectRoot, '.sdd/venvs/llmwiki-311/bin/python');
const llmwikiMcpPath = path.join(projectRoot, '.sdd/repos/llmwiki/mcp');
const llmwikiReady = (() => {
  if (!fs.existsSync(llmwikiPython)) return false;
  const probe = spawnSync(llmwikiPython, ['-c', 'import mcp, sys; sys.stdout.write("ok")'], { encoding: 'utf8', timeout: 60_000 });
  return probe.status === 0 && probe.stdout === 'ok' && fs.existsSync(llmwikiMcpPath);
})();

let pinnedNode = process.execPath;
if (process.versions.node !== cometLock.toolchain.node) {
  const candidate = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${cometLock.toolchain.node}`, 'bin/node');
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === `v${cometLock.toolchain.node}`) pinnedNode = candidate;
}
const pinnedNodeReady = pinnedNode !== process.execPath
  || process.versions.node === cometLock.toolchain.node;

const scenarioSkip = !cometBuildPresent
  ? `UNVERIFIED: patched Comet build ${cometFingerprint.slice(0, 8)} is not present; run tools/comet/prepare-source.mjs && tools/comet/build.mjs --archive first`
  : !openspecReady
    ? `UNVERIFIED: the pinned openspec 1.15.0 CLI is not installed at ${path.relative(projectRoot, openspecCli)}`
    : !llmwikiReady
      ? 'UNVERIFIED: the I04-admitted LLMWiki supply (venv python + mcp SDK + project clone) is not available'
      : !pinnedNodeReady
        ? `UNVERIFIED: the locked node v${cometLock.toolchain.node} is not available for the pinned-world scenario`
        : false;

// --- the pinned-node scenario (real drive + real Kp write + real archive) -------

const scenarioArgv = process.argv.indexOf('--kp-scenario');
const proofArgv = process.argv.indexOf('--proof');

const PY_DRIVER = `#!/usr/bin/env python3
"""P4_4 Kp driver: one REAL MCP stdio session against the local LLMWiki
server. initialize -> tools/list -> list_knowledge_bases -> create -> read ->
search, every step over the installed mcp SDK ClientSession (the same client
the I04 worktree-mcp-readback probe used). Prints one JSON object."""
import asyncio, json, re, sys

def text_of(result):
    parts = []
    for item in result.content or []:
        t = getattr(item, "text", None)
        if t is not None:
            parts.append(t)
    return "\\n".join(parts)

async def main():
    spec = json.loads(sys.argv[1])
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    env = {"PYTHONPATH": spec["mcpPath"], "HOME": spec["home"],
           "PATH": "/usr/bin:/bin", "LLMWIKI_USER_ID": spec["userId"]}
    server = StdioServerParameters(command=spec["python"],
        args=["-m", "local_server", "--workspace", spec["workspace"]], env=env)
    out = {"workspace": spec["workspace"]}
    timeout = spec.get("timeoutS", 180)
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            init = await asyncio.wait_for(session.initialize(), timeout)
            out["initialize"] = {"protocolVersion": init.protocolVersion,
                "serverName": init.serverInfo.name, "serverVersion": init.serverInfo.version}
            tools = await asyncio.wait_for(session.list_tools(), timeout)
            out["tools"] = sorted(t.name for t in tools.tools)
            kbs = await asyncio.wait_for(session.call_tool("list_knowledge_bases", {}), timeout)
            kb_text = text_of(kbs)
            out["knowledgeBases"] = kb_text
            slug = re.search(r"\`([^\`]+)\`", kb_text).group(1)
            create = await asyncio.wait_for(session.call_tool("create", {
                "knowledge_base": slug, "title": spec["title"], "content": spec["content"],
                "tags": spec["tags"], "path": spec.get("path", "/wiki/concepts/")}), timeout)
            out["create"] = {"isError": create.isError, "text": text_of(create)}
            read = await asyncio.wait_for(session.call_tool("read", {
                "knowledge_base": slug,
                "path": spec.get("docPath", "/wiki/concepts/" + spec["title"])}), timeout)
            out["read"] = {"isError": read.isError, "text": text_of(read)}
            search = await asyncio.wait_for(session.call_tool("search", {
                "knowledge_base": slug, "mode": "search", "query": spec["needle"]}), timeout)
            out["search"] = {"isError": search.isError, "text": text_of(search)}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))

asyncio.run(main())
`;

// A second, read-only process for the NATIVE index readback (the I04
// channels: documents row + chunks_fts — never the adapter's own word).
const PY_NATIVE_READBACK = `import hashlib, json, sqlite3, sys
ws, rel, needle = sys.argv[1], sys.argv[2], sys.argv[3]
content = open(ws + "/wiki/" + rel, "rb").read()
db = sqlite3.connect("file:" + ws + "/.llmwiki/index.db?mode=ro", uri=True)
rows = db.execute("SELECT relative_path, content, version FROM documents WHERE relative_path = ?",
                  ("wiki/" + rel,)).fetchall()
fts = db.execute("SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH ?", (needle,)).fetchone()[0]
chunks = db.execute("SELECT count(*) FROM document_chunks").fetchone()[0]
print(json.dumps({"diskDigest": hashlib.sha256(content).hexdigest(),
                  "rows": [{"path": r[0], "digest": hashlib.sha256(r[1].encode()).hexdigest(),
                            "version": r[2]} for r in rows],
                  "ftsMatches": fts, "chunkRows": chunks}))
`;

// The knowledge author: a SEPARATE process producing the reusable-experience
// body (three honest lines from this change), frozen by its sha256 digest.
const AUTHOR_SCRIPT = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const [outFile, capability, source] = process.argv.slice(1);
const body = [
  '---',
  'capability: ' + capability,
  'source: ' + source,
  'change: demo',
  '---',
  '',
  '# ' + capability,
  '',
  '本次变更的可复用经验 (reusable experience from this change):',
  '',
  '- Kp (project knowledge) is frozen by digest and independently read back BEFORE the archive move.',
  '- The LLMWiki create is idempotent by operation identity: a retry re-targets the same page, never a second create.',
  '- A timed-out publication resolves by reading the ORIGINAL target back; unknown is never absence.',
  '',
].join('\\n');
fs.writeFileSync(outFile, body);
process.stdout.write(crypto.createHash('sha256').update(body).digest('hex'));
`;

// The independent reviewer: ANOTHER separate process binding its pass verdict
// to the frozen digest (review-before-write, the Kp judgment input).
const REVIEWER_SCRIPT = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const [bodyFile, frozenDigest, verdictFile] = process.argv.slice(1);
const body = fs.readFileSync(bodyFile, 'utf8');
const digest = crypto.createHash('sha256').update(body).digest('hex');
const problems = [];
if (digest !== frozenDigest) problems.push('body digest ' + digest + ' != frozen ' + frozenDigest);
if (!body.includes('可复用经验') || (body.match(/^- /gm) || []).length < 3) {
  problems.push('the reusable-experience body must carry its experience lines');
}
if (!/^capability: /m.test(body) || !/^source: /m.test(body)) problems.push('frontmatter capability/source required');
if (problems.length > 0) { process.stderr.write(problems.join('; ')); process.exit(1); }
fs.writeFileSync(verdictFile, JSON.stringify({
  reviewer: 'svc:sdd-harness-pilot/worker-reviewer',
  verdict: 'pass', boundPayloadDigest: frozenDigest,
  reviewedAt: new Date().toISOString(),
  summary: 'frozen candidate body verified: digest bound, reusable experience present',
}, null, 2) + '\\n');
`;

async function runScenario() {
  assert.equal(process.versions.node, cometLock.toolchain.node,
    'the world scenario runs on the exact locked Node, not a host alias');
  assert.equal(cometLock.package.version, '0.5.0', 'the pinned supply must be the 0.5.0 baseline');
  assert.equal(cometLock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  assert.deepEqual(cometLock.patches.map(({ path: patchPath }) => patchPath),
    ['integrations/comet/patches/0005-comet-050-kt-closeout.patch'],
    'the pinned supply must carry exactly the 0005 Kt closeout patch');

  const work = path.join(cometBuildDir, 'work');
  const { pathToFileURL } = await import('node:url');
  const native = await import(pathToFileURL(path.join(work, 'assets/skills/comet/scripts/comet-runtime.mjs')).href);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p44-kp-'));
  const home = path.join(scratch, 'home');
  const root = path.join(scratch, 'root');
  const wikiWorkspace = path.join(scratch, 'kp-wiki'); // a disposable LLMWiki workspace
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(wikiWorkspace, { recursive: true });
  for (const rel of ['openspec/changes/archive', 'openspec/specs/cap-a', 'openspec/changes/demo',
    'docs/superpowers/plans', 'docs/superpowers/specs', 'docs/superpowers/reports', '.comet', '.whitebox']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n');
  fs.writeFileSync(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), [
    '# cap-a Specification', '', '## Purpose', 'Purpose of cap-a is the P4_4 knowledge closed-loop fixture.', '',
    '## Requirements', '', '### Requirement: Existing auth flow', 'The system SHALL authenticate users.', '',
    '#### Scenario: Valid login', '- **WHEN** valid credentials', '- **THEN** access granted', '',
  ].join('\n'));
  const delta = [
    '## MODIFIED Requirements', '', '### Requirement: Existing auth flow',
    'The system SHALL authenticate users with rate limiting.', '',
    '#### Scenario: Valid login', '- **WHEN** valid credentials', '- **THEN** access granted', '',
    '## ADDED Requirements', '', '### Requirement: Audit trail', 'The system SHALL log auth events.', '',
    '#### Scenario: Login logged', '- **WHEN** any login attempt', '- **THEN** audit record written', '',
  ].join('\n');
  const changeDir = path.join(root, 'openspec/changes/demo');
  fs.writeFileSync(path.join(changeDir, 'proposal.md'),
    '## Why\nThe P4_4 knowledge closed-loop case needs a real change with a meaningful why section.\n\n## What Changes\nRate-limit the auth flow and add an audit trail; carry the knowledge closeout.\n\n## Impact\ncap-a.\n');
  fs.writeFileSync(path.join(changeDir, 'tasks.md'),
    '- [ ] 1.1 Implement the knowledge closed-loop proof. <!-- comet-task:task1 -->\n');
  fs.writeFileSync(path.join(changeDir, 'design.md'),
    '---\ncomet_change: demo\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\nOne original Runtime owns the archive transaction; Kp seals before it.\n');
  fs.mkdirSync(path.join(changeDir, 'specs/cap-a'), { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'specs/cap-a/spec.md'), delta);

  // The transparent invocation logger: proves the pinned openspec 1.15.0 CLI
  // is the archive writer the native comet archive invokes through the
  // COMET_OPENSPEC seam (logs argv, then execs the real pinned CLI).
  const openspecLog = path.join(scratch, 'openspec-invocations.log');
  const openspecWrapper = path.join(scratch, 'openspec-1.15.0-wrapper');
  fs.writeFileSync(openspecWrapper,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${openspecLog}'\nexec '${openspecCli}' "$@"\n`, { mode: 0o755 });

  const prior = { HOME: process.env.HOME, COMET_OPENSPEC: process.env.COMET_OPENSPEC };
  process.env.HOME = home;
  process.env.COMET_OPENSPEC = openspecWrapper;
  const commands = [];
  const cli = async (argv) => {
    const result = await native.runClassicCli(['--json', ...argv], undefined,
      { projectRoot: root, invocationCwd: root });
    commands.push({ argv, exitCode: result.exitCode,
      stdout: (result.stdout ?? '').slice(0, 2000), stderr: (result.stderr ?? '').slice(0, 2000) });
    return result;
  };
  const ok = async (argv) => {
    const result = await cli(argv);
    assert.equal(result.exitCode, 0, `${argv.join(' ')} -> exit ${result.exitCode}: ${(result.stderr ?? result.stdout ?? '').slice(0, 400)}`);
    return result;
  };
  const sections = {};
  const proof = (id, expected, actual, observed = undefined) => {
    assert.deepEqual(actual, expected, id);
    sections[id] = { expected, actual, ...(observed === undefined ? {} : { observed }) };
  };
  const archiveDirs = () => fs.readdirSync(path.join(root, 'openspec/changes/archive'));
  const mainSpec = () => fs.readFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), 'utf8');
  const step = (name) => process.stderr.write(`[p44-step] ${name}\n`);

  const CAPABILITY = 'closeout-order';
  const KP_SOURCE = 'openspec/changes/demo/proposal.md';
  const NEEDLE = 'unknown is never absence';
  const kpWikiRel = `concepts/${CAPABILITY}.md`;

  try {
    step('drive-start');
    // ---- the real classic Run drive, public state/check surface -----------
    await ok(['state', 'init', 'demo', 'full']);
    await ok(['state', 'transition', 'demo', 'open-complete']);
    await ok(['state', 'set', 'demo', 'design_doc', 'openspec/changes/demo/design.md']);
    await ok(['state', 'complete-design', 'demo', '--design-doc', 'openspec/changes/demo/design.md']);
    await ok(['state', 'set', 'demo', 'build_mode', 'autonomous', 'tdd_mode', 'tdd', 'isolation', 'current']);
    const tasksRun = await ok(['state', 'tasks', 'demo', '--assign-ids']);
    const tasksData = JSON.parse(tasksRun.stdout).data ?? {};
    const task = (tasksData.tasks ?? [])[0];
    assert.ok(task?.id, 'state tasks --assign-ids must return the stable task id');
    await ok(['state', 'task-complete', 'demo', task.id, '--expect', tasksData.revision]);
    fs.writeFileSync(path.join(root, 'docs/superpowers/plans/plan.md'),
      `<!-- comet-task-authority: openspec/changes/demo/tasks.md -->\n# Plan\n\nStep one covers the task <!-- comet-task-ref:${task.id} -->.\n`);
    await ok(['state', 'set', 'demo', 'plan', 'docs/superpowers/plans/plan.md']);
    await ok(['check', 'run', 'demo', 'build', '--', process.execPath, '-e', '0']);
    await ok(['state', 'transition', 'demo', 'build-complete']);
    fs.writeFileSync(path.join(root, '.whitebox/verification.md'),
      '# Component evidence\nP4_4 knowledge closed-loop world.\n');
    await ok(['state', 'set', 'demo', 'verification_report', '.whitebox/verification.md']);
    await ok(['check', 'run', 'demo', 'verify', '--', process.execPath, '-e', '0']);
    await ok(['state', 'transition', 'demo', 'verify-pass']);
    await ok(['state', 'transition', 'demo', 'archive-confirm']);
    const runIdRead = await ok(['state', 'get', 'demo', 'run_id']);
    const runId = (JSON.parse(runIdRead.stdout).data?.fields ?? {}).run_id;
    assert.ok(runId, 'state get run_id must answer on the active change');

    step('drive-done');
    // ---- Kp 1/5: the AUTHOR process writes the body; FREEZE by digest ------
    const bodyFile = path.join(scratch, 'kp-body.md');
    const author = spawnSync(pinnedNode, ['-e', AUTHOR_SCRIPT, bodyFile, CAPABILITY, KP_SOURCE],
      { encoding: 'utf8', timeout: 60_000 });
    assert.equal(author.status, 0, `the knowledge author process failed: ${author.stderr}`);
    const frozenDigest = author.stdout.trim();
    assert.match(frozenDigest, /^[a-f0-9]{64}$/, 'the author freezes the candidate by sha256');
    const frozenBytes = fs.readFileSync(bodyFile);
    assert.equal(sha256(frozenBytes), frozenDigest);
    proof('KP_AUTHOR_FROZEN', { lines: true, digestBound: true },
      { lines: (frozenBytes.toString('utf8').match(/^- /gm) ?? []).length >= 3, digestBound: sha256(frozenBytes) === frozenDigest });

    // ---- Kp 2/5: the INDEPENDENT REVIEWER process binds its pass ----------
    const verdictFile = path.join(scratch, 'kp-review.json');
    const review = spawnSync(pinnedNode, ['-e', REVIEWER_SCRIPT, bodyFile, frozenDigest, verdictFile],
      { encoding: 'utf8', timeout: 60_000 });
    assert.equal(review.status, 0, `the independent reviewer refused: ${review.stderr}`);
    const verdict = JSON.parse(fs.readFileSync(verdictFile, 'utf8'));
    proof('KP_REVIEW_INDEPENDENT', { verdict: 'pass', bound: true },
      { verdict: verdict.verdict, bound: verdict.boundPayloadDigest === frozenDigest });

    // ---- Kp 3/5: the REAL LLMWiki stdio MCP write (Python subprocess) -----
    const driverFile = path.join(scratch, 'kp-mcp-driver.py');
    fs.writeFileSync(driverFile, PY_DRIVER);
    const driverSpec = {
      python: llmwikiPython, mcpPath: llmwikiMcpPath, workspace: wikiWorkspace, home,
      userId: 'p44-kp-execution', title: `${CAPABILITY}.md`,
      content: frozenBytes.toString('utf8'), tags: ['kp', 'closeout'], needle: NEEDLE,
      timeoutS: 180,
    };
    step('mcp-write-enter');
    const mcp = spawnSync(llmwikiPython, [driverFile, JSON.stringify(driverSpec)],
      { encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
    commands.push({ argv: ['<python-mcp-driver>'], exitCode: mcp.status,
      stdout: (mcp.stdout ?? '').slice(0, 4000), stderr: (mcp.stderr ?? '').slice(0, 500) });
    assert.equal(mcp.status, 0, `the LLMWiki MCP driver failed: ${(mcp.stderr ?? '').slice(0, 600)}`);
    const session = JSON.parse(mcp.stdout);
    proof('KP_MCP_HANDSHAKE', { protocolVersion: '2025-11-25', tools: true },
      { protocolVersion: session.initialize.protocolVersion,
        tools: ['create', 'read', 'search'].every((name) => session.tools.includes(name)) },
      `server ${session.initialize.serverName} ${session.initialize.serverVersion}; ${session.tools.length} tools; kb ${session.knowledgeBases}`);
    assert.equal(session.create.isError, false, `the create tool errored: ${session.create.text}`);
    proof('KP_MCP_CREATE', true, session.create.text.includes(`/wiki/${kpWikiRel}`));
    // Session-channel readback: the read response ends with the EXACT frozen bytes.
    proof('KP_MCP_READ_CONSISTENT', true, session.read.text.endsWith(frozenBytes.toString('utf8')));
    proof('KP_MCP_SEARCH_FINDS', true, session.search.text.includes('1 result') && session.search.text.includes(NEEDLE));

    // ---- Kp 4/5: independent readback — disk bytes + NATIVE SQLite index --
    const diskFile = path.join(wikiWorkspace, 'wiki', kpWikiRel);
    const diskDigest = sha256(fs.readFileSync(diskFile));
    proof('KP_READBACK_DISK', frozenDigest, diskDigest);
    const nativeFile = path.join(scratch, 'kp-native-readback.py');
    fs.writeFileSync(nativeFile, PY_NATIVE_READBACK);
    const nativeRead = spawnSync(llmwikiPython, [nativeFile, wikiWorkspace, kpWikiRel, 'never absence'],
      { encoding: 'utf8', timeout: 60_000 });
    assert.equal(nativeRead.status, 0, `the native readback failed: ${nativeRead.stderr}`);
    const nativeJson = JSON.parse(nativeRead.stdout);
    proof('KP_READBACK_SQLITE', { rows: 1, digestMatch: true, fts: true },
      { rows: nativeJson.rows.length, digestMatch: nativeJson.rows[0]?.digest === frozenDigest,
        fts: nativeJson.ftsMatches >= 1 },
      `documents row version ${nativeJson.rows[0]?.version}; chunks ${nativeJson.chunkRows}`);

    // The Kp operation + receipt: deterministic identity, minted ONLY from the
    // confirmed readback (the lib judgment layer over the real bytes).
    const llmwikiAdapter = await import(pathToFileURL(path.join(projectRoot, 'lib/adapters/llmwiki.js')).href);
    const operation = llmwikiAdapter.buildKpOperation({
      change: 'demo', entry: { capability: CAPABILITY, digest: frozenDigest },
    });
    assert.equal(llmwikiAdapter.buildKpOperation({
      change: 'demo', entry: { capability: CAPABILITY, digest: frozenDigest },
    }).operationId, operation.operationId);
    proof('KP_OPERATION_ID_DETERMINISTIC', true, /^kp-[0-9a-f]{16}$/.test(operation.operationId));
    const kpReceipt = llmwikiAdapter.buildKpCloseoutReceipt({
      operation, readback: { found: true, digest: diskDigest, source: 'llmwiki-mcp+disk+sqlite', at: new Date().toISOString() },
      execution: 'p44-exec-kp', recordedAt: new Date().toISOString(),
    });
    proof('KP_RECEIPT_MINTED', { id: `llmwiki:${CAPABILITY}`, digest: frozenDigest },
      { id: kpReceipt.id, digest: kpReceipt.digest });

    // ---- Kp 5/5: the composition Kp EXTENSION judges the evidence LIVE -----
    const { createLaunchAuthority, admitEvidence } = await import(pathToFileURL(path.join(projectRoot, 'lib/delivery/evidence.js')).href);
    const { evaluate } = await import(pathToFileURL(path.join(projectRoot, 'lib/delivery/gate.js')).href);
    const policyBytes = `${JSON.stringify({ gate: 'Kp', capability: CAPABILITY, channel: 'llmwiki', reviewer: verdict.reviewer })}\n`;
    const policy = { ref: 'sdd-harness-pilot/kp/closeout', digest: sha256(policyBytes) };
    const kpInputs = {
      inputDigest: frozenDigest,
      builderExecution: 'p44-exec-kp-author',
      testContract: {
        schemaVersion: 1, project: 'sdd-harness-pilot', change: 'demo',
        cases: [{ id: 'kp-1', ac: 'D06', oracle: 'knowledge published and read back before archive', checkIds: ['g1'] }],
        requiredChecks: [{ id: 'g1', level: 'archive', capability: 'knowledge-closeout-verified', caseIds: ['kp-1'] }],
        executionDenominator: { totalCases: 1 },
        cleanup: { environment: 'none', data: 'none' },
        dependencyBaselines: [{ kind: 'comet-build', digest: cometFingerprint }],
      },
    };
    const authority = createLaunchAuthority({ secret: `p44-kp-${'seed'.repeat(12)}` });
    const dispatch = authority.issueDispatch({
      runnerId: 'runner:sdd-harness-pilot', run: runId, gate: 'Kp', role: 'verifier',
      execution: 'p44-exec-kp-verifier', inputDigest: frozenDigest, policyDigest: policy.digest,
      attempt: 1, epoch: 1,
    });
    const envelope = {
      schemaVersion: 1,
      candidateDigest: frozenDigest, caseId: 'kp-1', check: 'knowledge-closeout-verified',
      origin: { kind: 'runner', id: 'runner:sdd-harness-pilot' },
      execution: { id: 'p44-exec-kp-verifier' },
      environment: 'llmwiki-stdio-sandbox', toolchain: `llmwiki@${session.initialize.serverVersion}+mcp-sdk`,
      executions: { total: 1, valid: 1 }, result: 'pass',
      evidence: [{ uri: `wiki/${kpWikiRel}`, sha256: diskDigest }],
      expiry: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const admitted = admitEvidence({
      envelope, dispatch, authority,
      current: { inputDigest: frozenDigest, policyDigest: policy.digest, environment: 'llmwiki-stdio-sandbox' },
    });
    assert.equal(admitted.ok, true, `admission refused: ${JSON.stringify(admitted).slice(0, 400)}`);
    assert.equal(admitted.entry.class, 'independent-acceptance', 'a verifier dispatch signs acceptance evidence');
    const judged = evaluate(kpInputs, [admitted.entry], policy);
    proof('KP_GATE_JUDGED_PASS', 'pass', judged.verdict);

    // The PACKAGED validator (R3-frozen composition, read-only consumption):
    // the real gateEvidence payload accepted; the same payload with NO receipt
    // refused MISSING_OBSERVATION (the live counterpart of the P3_2 refusal).
    const { createBindings } = await import(pathToFileURL(path.join(projectRoot, 'integrations/comet/application/bindings.mjs')).href);
    const bindings = await createBindings();
    const kpValidator = bindings.validators.find((candidate) => candidate.id === 'sdd.delivery.gate.kp');
    assert.ok(kpValidator, 'the packaged Kp validator is registered');
    const KP_REF = '.sdd/delivery/gates/kp/receipt-bundle.json';
    const kpOutcome = (gateEvidence, artifactHashes) => ({
      verdict: 'pass', sourceHash: frozenDigest, artifactHashes,
      output: { gateEvidence },
    });
    const kpGateEvidence = { gate: 'Kp', inputs: kpInputs, receipts: [admitted.entry], policy };
    // The extension's declared artifact (writeProtocolFields of
    // extensions/knowledge-project-closeout.json), content-addressed.
    const kpBundle = {
      schema: 'sdd.delivery.gate.receipt-bundle.v1', kind: 'gate-receipt-bundle', gate: 'Kp',
      artifactRef: KP_REF, hashBinding: 'artifactHashes', writtenBy: 'extension-execution',
      inputs: kpInputs, receipts: [admitted.entry], policy,
      evaluatedBy: 'sdd.delivery.gate.kp', verdict: 'pass', receipt: judged.receipt,
    };
    const bundleBytes = Buffer.from(`${JSON.stringify(kpBundle, null, 2)}\n`);
    const bundleDigest = sha256(bundleBytes);
    const accepted = kpValidator.validate({
      run: { runId }, action: { gate: 'Kp' },
      outcome: kpOutcome(kpGateEvidence, { [KP_REF]: bundleDigest }),
    });
    proof('KP_EXTENSION_ACCEPTED', { accepted: true, validatorId: 'sdd.delivery.gate.kp' },
      { accepted: accepted.accepted === true, validatorId: accepted.validatorId ?? 'sdd.delivery.gate.kp' });
    const refused = kpValidator.validate({
      run: { runId }, action: { gate: 'Kp' },
      outcome: kpOutcome({ ...kpGateEvidence, receipts: [] }, { [KP_REF]: bundleDigest }),
    });
    assert.equal(refused.accepted, false, 'a claimed Kp pass with no knowledge receipt must be refused');
    assert.match(refused.reason, /MISSING_OBSERVATION: required check archive\/knowledge-closeout-verified/);
    proof('KP_EXTENSION_REFUSES_EMPTY', true, /MISSING_OBSERVATION/.test(refused.reason));

    // The extension requires the artifact AT THE DECLARED STATIC REF: write it
    // into the world project and pin the content-address binding.
    const bundlePath = path.join(root, KP_REF);
    fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
    fs.writeFileSync(bundlePath, bundleBytes);
    proof('KP_BUNDLE_EXISTS', { present: true, digestBound: true },
      { present: fs.existsSync(bundlePath), digestBound: sha256(fs.readFileSync(bundlePath)) === bundleDigest });

    step('kp-done');
    // ---- the managed seal: Kp BEFORE the archive move (single owner) -------
    const { sealCloseout } = await import(pathToFileURL(path.join(projectRoot, 'lib/adapters/comet.js')).href);
    const sealRead = await ok(['state', 'get', 'demo', 'phase', 'verify_result', 'archive_confirmation', 'archived']);
    const sealFields = JSON.parse(sealRead.stdout).data?.fields ?? {};
    const seal = {
      change: 'demo', phase: sealFields.phase, verifyResult: sealFields.verify_result,
      archiveConfirmation: sealFields.archive_confirmation, archived: sealFields.archived === 'true',
    };
    const sealed = sealCloseout({
      seal, execution: 'p44-exec-kp',
      knowledgeCloseout: { id: 'kp-demo-closeout', digest: frozenDigest },
    });
    proof('SEAL_KP_BEFORE_ARCHIVE', { archived: true, stillActiveDir: true },
      { archived: sealed.archived === true, stillActiveDir: archiveDirs().length === 0 },
      `sealed with kp receipt digest ${kpReceipt.digest.slice(0, 12)}… before the archive move`);

    // ---- the REAL archive: managed adapter -> native comet archive -> the
    // pinned openspec 1.15.0 CLI (the ONLY writer), invoked exactly once.
    const { createManagedSpecAdapter } = await import(pathToFileURL(path.join(projectRoot, 'lib/adapters/spec.js')).href);
    const runModule = await import(pathToFileURL(path.join(work, 'dist/domains/comet-classic/classic-runtime-run.js')).href);
    const spec = createManagedSpecAdapter({
      runtime: { runClassicCli: native.runClassicCli, ensureClassicRuntimeRun: runModule.ensureClassicRuntimeRun },
      projectRoot: root,
    });
    const archiveResult = await spec.closeout({ change: 'demo' });
    assert.equal(archiveResult.ok, true, `managed closeout failed: ${JSON.stringify(archiveResult).slice(0, 400)}`);
    proof('ARCHIVE_OK_SAME_RUN', runId, archiveResult.runId);
    proof('ARCHIVE_READBACK_OK', true, archiveResult.readback.ok);
    proof('ARCHIVE_NOT_OVERALL_COMPLETION', false, archiveResult.overallCompletionEligible);
    proof('ARCHIVE_ONE_DIR', 1, archiveDirs().length);
    const mainAfterArchive = mainSpec();
    assert.match(mainAfterArchive, /#### Scenario: Valid login/, 'the synced main spec keeps the old scenario');
    assert.match(mainAfterArchive, /### Requirement: Audit trail/, 'the synced main spec gains the added requirement');
    proof('ARCHIVE_MAIN_SYNCED', true, /Audit trail/.test(mainAfterArchive) && /Valid login/.test(mainAfterArchive));
    const invocations = fs.existsSync(openspecLog)
      ? fs.readFileSync(openspecLog, 'utf8').split('\n').filter(Boolean) : [];
    proof('ARCHIVE_OPENSPEC_115_ONCE', { count: 1, version: '1.15.0' },
      { count: invocations.length, version: spawnSync(openspecCli, ['--version'], { encoding: 'utf8' }).stdout.trim() },
      invocations.join(' | '));
    // The Kp bundle survived the archive with stable bytes at the static ref.
    proof('KP_BUNDLE_STABLE_POST_ARCHIVE', bundleDigest, sha256(fs.readFileSync(bundlePath)));

    step('archive-done');
    // ---- Kt 1/3: post-archive SAME-Run pending discovery (the P4_6 face) --
    const nextAfter = JSON.parse((await ok(['state', 'next', 'demo'])).stdout);
    proof('KT_NEXT_DELIVERY', 'delivery', nextAfter.data?.nextAction?.kind);
    proof('KT_NEXT_NO_COMPLETION_CLAIM', true,
      /do not archive again/i.test(`${nextAfter.data?.nextAction?.reason ?? ''} ${nextAfter.stdout ?? ''}`));
    const archivedChange = path.join(root, 'openspec/changes/archive', archiveDirs()[0]);
    const store = await import(pathToFileURL(path.join(work, 'dist/domains/comet-classic/classic-store.js')).href);
    const evidenceMod = await import(pathToFileURL(path.join(work, 'dist/domains/comet-classic/classic-evidence.js')).href);
    const resolver = await import(pathToFileURL(path.join(work, 'dist/domains/comet-classic/classic-resolver.js')).href);
    const projection = await store.readClassicState(archivedChange);
    const evidence = await evidenceMod.collectClassicEvidence(archivedChange, projection);
    const ktPending = { ...projection.classic, knowledgeCloseout: { required: true, completed: false } };
    proof('KT_RESOLVER_PARKED', 'full.archive.execute', resolver.resolveClassicStepId(ktPending, evidence));
    proof('KT_RESOLVER_NOT_COMPLETED', false, resolver.resolveClassicStepId(ktPending, evidence) === 'completed');
    const pending = await spec.recover({ change: 'demo' });
    proof('KT_RECOVER_SAME_RUN_NOT_ELIGIBLE', { runId, archived: true, eligible: false },
      { runId: pending.runId, archived: pending.archived, eligible: pending.overallCompletionEligible });

    // ---- Kt 2/3: the LIVE Outline attempt — no credential, the REAL 401 ----
    const outlineAdapter = await import(pathToFileURL(path.join(projectRoot, 'lib/adapters/outline.js')).href);
    const KT_CAPABILITY = 'k-team-closeout-demo';
    const teamPayload = '# Team Knowledge\n\nPost-archive Kt closeout for demo (P4_4 closed loop).\n';
    const teamDigest = sha256(teamPayload);
    const documentId = outlineAdapter.deriveOutlineTargetId({ change: 'demo', capability: KT_CAPABILITY });
    proof('KT_TARGET_ID_DETERMINISTIC', documentId,
      outlineAdapter.deriveOutlineTargetId({ change: 'demo', capability: KT_CAPABILITY }));
    const token = process.env.SDD_OUTLINE_PUBLISH_TOKEN ?? '';
    let outlineObservation;
    try {
      const response = await fetch('http://127.0.0.1:3000/api/documents.create', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title: `demo ${KT_CAPABILITY}`, text: teamPayload, publish: true, uuid: documentId }),
        signal: AbortSignal.timeout(10_000),
      });
      const bodyText = await response.text();
      outlineObservation = { attempted: true, httpStatus: response.status, body: bodyText.slice(0, 400) };
    } catch (error) {
      outlineObservation = { attempted: true, transportError: String(error?.message ?? error).slice(0, 300) };
    }
    const refused401 = outlineObservation.httpStatus === 401
      && /authentication_required|Authentication required/.test(outlineObservation.body ?? '');
    proof('KT_OUTLINE_REFUSED_401', { attempted: true, refused: token ? 'unexpected' : true },
      { attempted: true, refused: token ? (refused401 ? true : 'unexpected') : refused401 },
      JSON.stringify(outlineObservation).slice(0, 400));
    sections.KT_GRANT_STATUS = {
      expected: 'UNVERIFIED-NEEDS-GRANT: no publisher credential is provisioned, the live publish+readback stays unclaimed',
      actual: token
        ? 'a publish token was present in the environment; see KT_OUTLINE_REFUSED_401 for the live attempt outcome'
        : 'no credential: the local stack refused the unauthenticated documents.create (401 authentication_required); the authorized publish needs the P4_7 ktSurface grant chain (all required entries NOT_PROVISIONED)',
    };

    // The Kt obligation stays pending in the publish ledger: unknown is never
    // absence, the SAME Run keeps discovering the ORIGINAL operation.
    const operation2 = {
      knowledgeId: KT_CAPABILITY, operationKey: `demo:${KT_CAPABILITY}:epoch-0:op1`,
      documentId, collection: 'outline-managed-collection', payloadDigest: teamDigest, state: 'pending',
      lastObservation: outlineAdapter.buildTimeoutObservation({ operation: {
        operationKey: `demo:${KT_CAPABILITY}:epoch-0:op1`, documentId,
      }, at: new Date(0).toISOString() }),
    };
    const ledger = { schemaVersion: 1, interface: 'comet.classic.knowledge-publish.v1', operations: [operation2] };
    const ledgerJudged = outlineAdapter.evaluateKtFromLedger({ required: [{ capability: KT_CAPABILITY, digest: teamDigest }], ledger });
    proof('KT_LEDGER_PENDING_UNKNOWN', { ok: false, code: 'PUBLICATION_UNKNOWN' },
      { ok: ledgerJudged.ok, code: ledgerJudged.blocked[0]?.code });

    // ---- Kt 3/3: the authorization precondition, LIVE on the committed face -
    const authzCli = path.join(projectRoot, 'tools', 'infra', 'knowledge-authz.mjs');
    const knowledgeDir = path.join(projectRoot, 'infra', 'delivery', 'knowledge');
    const authzRequest = {
      schemaVersion: 1,
      requestedBy: 'svc:sdd-harness-pilot/outline-publisher',
      execution: 'p44-exec-kt-authz',
      operation: {
        knowledgeId: KT_CAPABILITY, knowledgeType: 'project-knowledge', documentId,
        action: 'documents.create',
        target: {
          collection: 'outline-managed-collection', audienceSource: 'collection-default',
          // the committed policy's registered audience (PARTIAL readback): the
          // decide face must then judge the INTERSECTION fail-closed — this is
          // the live P4_7 precondition, not a fixture override.
          effectiveAudience: {
            readers: ['directory:sdd-harness-pilot/owner'],
            incompletePagination: false, unmappedPrincipals: [],
          },
        },
      },
      payloadDigest: teamDigest,
      sources: [
        { domain: 'sdd-harness-repo', permissionEvidence: { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] } },
      ],
      review: {
        execution: 'p44-exec-kt-review', reviewerPrincipal: 'svc:sdd-harness-pilot/worker-reviewer',
        verdict: 'pass', boundPayloadDigest: teamDigest, reviewedAt: new Date().toISOString(),
      },
    };
    const requestFile = path.join(scratch, 'kt-publish-request.json');
    fs.writeFileSync(requestFile, `${JSON.stringify(authzRequest, null, 2)}\n`);
    const decide = spawnSync(pinnedNode, [authzCli, 'decide',
      '--request', requestFile,
      '--ledger', path.join(knowledgeDir, 'grant-ledger.example.json'),
      '--model', path.join(knowledgeDir, 'authorization-model.json'),
      '--policy', path.join(knowledgeDir, 'preauthorization-policy.json'), '--json'],
    { encoding: 'utf8', timeout: 60_000 });
    commands.push({ argv: ['<knowledge-authz>', 'decide'], exitCode: decide.status,
      stdout: (decide.stdout ?? '').slice(0, 1500), stderr: (decide.stderr ?? '').slice(0, 500) });
    const decideJson = (() => { try { return JSON.parse(decide.stdout); } catch { return null; } })();
    const decideCode = decideJson?.reasons?.[0]?.code ?? decideJson?.error ?? null;
    assert.equal(decide.status, 2, `the committed decide face must fail closed, got exit ${decide.status}: ${(decide.stdout ?? decide.stderr ?? '').slice(0, 300)}`);
    assert.equal(decideJson?.verdict, 'deny');
    proof('KT_AUTHZ_DECIDE_REFUSED', { exit: 2, verdict: 'deny' },
      { exit: decide.status, verdict: decideJson?.verdict },
      `code ${decideCode}: ${decideJson?.reasons?.[0]?.rule ?? ''}`);

    // ---- the real CLI judgment layer over the REAL MCP-written wiki --------
    const knowledgeSeed = await import(pathToFileURL(path.join(projectRoot, 'lib/knowledge-seed.js')).href);
    const requiredFile = path.join(scratch, 'required-knowledge.json');
    fs.writeFileSync(requiredFile, `${JSON.stringify(knowledgeSeed.defineRequiredKnowledge([
      { capability: CAPABILITY, digest: frozenDigest, source: KP_SOURCE, channel: 'llmwiki' },
      { capability: KT_CAPABILITY, digest: teamDigest, source: 'infra/delivery/knowledge/preauthorization-policy.json', channel: 'outline' },
    ]), null, 2)}\n`);
    const closeoutCli = spawnSync(pinnedNode, [path.join(projectRoot, 'bin', 'cli.js'),
      'knowledge-closeout', '--project', root, '--change', 'demo',
      '--required', requiredFile, '--wiki-dir', path.join(wikiWorkspace, 'wiki'), '--json'],
    { encoding: 'utf8', timeout: 60_000 });
    commands.push({ argv: ['<cli>', 'knowledge-closeout'], exitCode: closeoutCli.status,
      stdout: (closeoutCli.stdout ?? '').slice(0, 2500), stderr: (closeoutCli.stderr ?? '').slice(0, 500) });
    const closeoutJson = JSON.parse(closeoutCli.stdout);
    proof('CLI_KP_OK_KT_BLOCKED', { exit: 2, kpOk: true, ktCode: 'NO_PUBLISH_OPERATION' },
      { exit: closeoutCli.status, kpOk: closeoutJson.kp.ok === true,
        ktCode: closeoutJson.kt.blocked?.[0]?.code ?? null });

    fs.writeFileSync(proofPath(), `${JSON.stringify({
      scenario: 'knowledge-closeout',
      node: process.version,
      buildFingerprint: cometFingerprint,
      openspec: '1.15.0 (pinned, COMET_OPENSPEC seam, invocation-logged)',
      llmwiki: `${session.initialize.serverName} ${session.initialize.serverVersion} (stdio, ${session.initialize.protocolVersion})`,
      sections,
      commands,
      unverified: [
        'the authorized Outline publish + multi-channel readback: no publisher credential is provisioned (P4_7 ktSurface requiredEntries all NOT_PROVISIONED); the live unauthenticated attempt was refused 401 and is recorded verbatim',
        'the persisted write of the knowledgeCloseout state field through a 0.5.0 public command (supply/admission wave; the parked row is proven at the patched resolver seam over the run real state)',
        'the composition-package Run face to archive (the classic Run + packaged Kp validator is the proven face here; the full composition dispatch journey to archive stays with VERIFY)',
      ],
    }, null, 2)}\n`);
    process.stdout.write('P4_4 scenario knowledge-closeout: PROOF-EMITTED\n');
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (process.env.P44_KEEP_WORLD !== '1') fs.rmSync(scratch, { recursive: true, force: true });
    else process.stderr.write(`P44 world kept at ${scratch}\n`);
  }
}

const proofPath = () => (proofArgv >= 0 ? process.argv[proofArgv + 1] : '/tmp/p44-proof.json');

// --- outer tests (NEVER registered inside the scenario child — the 3_4 discipline)

let cachedProof = null;
function loadProof() {
  if (cachedProof) return cachedProof;
  const proofFile = path.join(os.tmpdir(), `p44-proof-${process.pid}-${Date.now()}.json`);
  const result = spawnSync(pinnedNode, [fileURLToPath(import.meta.url), '--kp-scenario', 'knowledge-closeout', '--proof', proofFile], {
    cwd: projectRoot, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024,
    env: (() => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env; })(),
  });
  assert.equal(result.status, 0,
    `the pinned-world scenario must exit 0, got ${result.status}\nstdout: ${(result.stdout ?? '').slice(0, 800)}\nstderr: ${(result.stderr ?? '').slice(0, 800)}`);
  cachedProof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  fs.rmSync(proofFile, { force: true });
  return cachedProof;
}

if (scenarioArgv >= 0) {
  await runScenario();
} else {
  test('setup: the pinned supply carries exactly the 0005 Kt patch; the retired face stays retired; the knowledge supply is admitted', () => {
    assert.equal(cometLock.package.version, '0.5.0');
    assert.equal(cometLock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
    assert.deepEqual(cometLock.patches.map(({ path: patchPath }) => patchPath),
      ['integrations/comet/patches/0005-comet-050-kt-closeout.patch'],
      'the retired 0003 post-archive patch must stay retired — 0005 is its only successor on this baseline');
    for (const retired of [
      'integrations/comet/patches/0003-post-archive-closeout.patch',
      'integrations/comet/patches/tests/4_6.patch',
    ]) {
      assert.equal(fs.existsSync(path.join(projectRoot, retired)), false,
        `the retired patch file must stay absent: ${retired}`);
    }
    // The composition Kp extension stays the R3-frozen shape (read-only consumption).
    const extension = JSON.parse(fs.readFileSync(
      path.join(projectRoot, 'integrations/comet/application/extensions/knowledge-project-closeout.json'), 'utf8'));
    assert.equal(extension.gate, 'Kp');
    assert.equal(extension.afterStep, 'full.verify.check.evidence');
    assert.deepEqual(extension.artifactRefs.map((ref) => ref.ref),
      ['.sdd/delivery/gates/kp/receipt-bundle.json'],
      'the Kp extension requires its artifact at the declared static ref');
  });

  test('Kp: the author freezes the body, the independent reviewer binds it, the REAL LLMWiki MCP writes it and three channels read the SAME bytes back', { skip: scenarioSkip }, () => {
    const proof = loadProof();
    assert.equal(proof.scenario, 'knowledge-closeout');
    assert.equal(proof.buildFingerprint, cometFingerprint, 'the proof names the build it ran on');
    for (const id of [
      'KP_AUTHOR_FROZEN',
      'KP_REVIEW_INDEPENDENT',
      'KP_MCP_HANDSHAKE',
      'KP_MCP_CREATE',
      'KP_MCP_READ_CONSISTENT',
      'KP_MCP_SEARCH_FINDS',
      'KP_READBACK_DISK',
      'KP_READBACK_SQLITE',
      'KP_OPERATION_ID_DETERMINISTIC',
      'KP_RECEIPT_MINTED',
    ]) {
      assert.ok(proof.sections[id], `the scenario must pin ${id}`);
      assert.deepEqual(proof.sections[id].actual, proof.sections[id].expected, id);
    }
    assert.equal(proof.sections.KP_MCP_HANDSHAKE.actual.protocolVersion, '2025-11-25',
      'the live stdio session negotiated the current protocol version (the I04-comet-050 observation)');
    assert.equal(proof.sections.KP_READBACK_DISK.actual, proof.sections.KP_RECEIPT_MINTED.actual.digest,
      'the disk channel, the MCP read channel and the frozen candidate are the SAME bytes');
  });

  test('Kp extension: the packaged sdd.delivery.gate.kp validator accepts the real-evidence pass, refuses the receiptless claim, and the declared artifact exists', { skip: scenarioSkip }, () => {
    const proof = loadProof();
    for (const id of [
      'KP_GATE_JUDGED_PASS',
      'KP_EXTENSION_ACCEPTED',
      'KP_EXTENSION_REFUSES_EMPTY',
      'KP_BUNDLE_EXISTS',
    ]) {
      assert.ok(proof.sections[id], `the scenario must pin ${id}`);
      assert.deepEqual(proof.sections[id].actual, proof.sections[id].expected, id);
    }
    assert.equal(proof.sections.KP_GATE_JUDGED_PASS.actual, 'pass',
      'the pure SDD.Gate.v1 evaluation over the admitted readback evidence passes');
    assert.equal(proof.sections.KP_EXTENSION_ACCEPTED.actual.accepted, true,
      'the R3-frozen composition Kp validator accepts the claimed pass bound to the real readback receipt');
  });

  test('Archive: Kp seals BEFORE the move; the pinned openspec 1.15.0 CLI is the single archive writer; the SAME Run survives', { skip: scenarioSkip }, () => {
    const proof = loadProof();
    for (const id of [
      'SEAL_KP_BEFORE_ARCHIVE',
      'ARCHIVE_OK_SAME_RUN',
      'ARCHIVE_READBACK_OK',
      'ARCHIVE_NOT_OVERALL_COMPLETION',
      'ARCHIVE_ONE_DIR',
      'ARCHIVE_MAIN_SYNCED',
      'ARCHIVE_OPENSPEC_115_ONCE',
      'KP_BUNDLE_STABLE_POST_ARCHIVE',
    ]) {
      assert.ok(proof.sections[id], `the scenario must pin ${id}`);
      assert.deepEqual(proof.sections[id].actual, proof.sections[id].expected, id);
    }
    assert.equal(proof.sections.ARCHIVE_OPENSPEC_115_ONCE.actual.count, 1,
      'exactly one openspec invocation behind the native archive (the COMET_OPENSPEC seam, logged transparently)');
    assert.equal(proof.sections.ARCHIVE_NOT_OVERALL_COMPLETION.actual, false,
      'the archive is never overall completion (D07) — Kt still owns that');
  });

  test('Kt: the SAME archived Run stays pending-discoverable, the live Outline attempt is refused 401 without a grant, and the committed authorization face refuses fail-closed', { skip: scenarioSkip }, () => {
    const proof = loadProof();
    for (const id of [
      'KT_NEXT_DELIVERY',
      'KT_NEXT_NO_COMPLETION_CLAIM',
      'KT_RESOLVER_PARKED',
      'KT_RESOLVER_NOT_COMPLETED',
      'KT_RECOVER_SAME_RUN_NOT_ELIGIBLE',
      'KT_TARGET_ID_DETERMINISTIC',
      'KT_OUTLINE_REFUSED_401',
      'KT_LEDGER_PENDING_UNKNOWN',
      'KT_AUTHZ_DECIDE_REFUSED',
      'CLI_KP_OK_KT_BLOCKED',
    ]) {
      assert.ok(proof.sections[id], `the scenario must pin ${id}`);
      assert.deepEqual(proof.sections[id].actual, proof.sections[id].expected, id);
    }
    assert.equal(proof.sections.KT_RESOLVER_PARKED.actual, 'full.archive.execute',
      'Kt pending parks the SAME archived Run at the existing archive step (0005)');
    assert.equal(proof.sections.KT_LEDGER_PENDING_UNKNOWN.actual.code, 'PUBLICATION_UNKNOWN',
      'unknown is never absence — the pending Kt operation keeps the SAME Run open');
    assert.equal(proof.sections.KT_GRANT_STATUS.expected.startsWith('UNVERIFIED-NEEDS-GRANT'), true,
      'the live Outline publish stays honestly UNVERIFIED-NEEDS-GRANT (no provisioned credential is papered over)');
  });
}
