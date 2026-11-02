import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// gate-bundle.mjs 固化回归（sdd-test 实例 R 门实证配方的框架化，2026-11-02）。
// 实证范围：R 门全流程（rev37）；本文件覆盖确定性/映射/解析器/参数纪律，
// 端到端 managed 预校验用合成 fixture 走真实 lib（evidence/gate/host-ports）。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const toolUrl = pathToFileURL(path.join(repoRoot, 'tools', 'gate-bundle.mjs'));
const tool = await import(toolUrl.href);

test('gate defaults map six gates to their classic extension cases and skills', () => {
  const expected = [
    ['R', 'requirements-confirmation', 'requirements-scope-confirmation', 'grill-me', 'r'],
    ['A', 'architecture-consensus', 'architecture-consensus-confirmation', 'multi-agent-consensus-review', 'a'],
    ['T', 'test-design-review', 'test-design-review-confirmation', 'test-authoring', 't'],
    ['P', 'build-plan-unique', 'build-plan-unique-confirmation', 'claude-parallel-tdd-planner', 'p'],
    ['V', 'verify-whitebox', 'verify-whitebox-confirmation', 'whitebox-verify', 'v'],
    ['Kp', 'knowledge-project-closeout', 'knowledge-project-closeout-confirmation', 'openspec-lifecycle-guard', 'kp'],
  ];
  assert.deepEqual(Object.keys(tool.GATE_DEFAULTS), ['R', 'A', 'T', 'P', 'V', 'Kp']);
  for (const [gate, check, kind, skill, dir] of expected) {
    assert.equal(tool.GATE_DEFAULTS[gate].check, check);
    assert.equal(tool.GATE_DEFAULTS[gate].kind, kind, `R 的 kind 是试点实证值（requirements-scope-confirmation），不得漂移`);
    assert.equal(tool.GATE_DEFAULTS[gate].skill, skill);
    assert.equal(tool.GATE_DEFAULTS[gate].dir, dir);
  }
});

test('refuse semantics: a bare synthetic run blocks at evaluate with named review requirements (fail-loud, no fabrication)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-bundle-refuse-'));
  const { envelopeDigest } = await import(pathToFileURL(path.join(repoRoot, 'lib/delivery/evidence.js')).href);
  const actionInput = { gate: 'R', runId: 'bare-change', change: 'bare-change', changeDir: 'openspec/changes/bare-change' };
  const claim = {
    run: { current: { runId: 'bare-change', revision: 1, phase: 'open',
      actions: [{ id: 'bare-change:1', stepId: 'classic.extension.requirements-open', status: 'running',
        input: actionInput, inputHash: envelopeDigest(actionInput),
        claim: { executorId: 'sdd-managed-skill-host', sessionId: '33333333-3333-4333-8333-333333333333', token: 'tok' } }] } },
  };
  fs.writeFileSync(path.join(root, 'claim.json'), JSON.stringify(claim));
  fs.mkdirSync(path.join(root, 'openspec/changes/bare-change'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec/changes/bare-change/proposal.md'), '# bare\n');
  fs.writeFileSync(path.join(root, 'open-ev.json'), JSON.stringify({ contentHash: 'a'.repeat(64) }));
  fs.writeFileSync(path.join(root, 'reviewer.jsonl'), 'transcript');
  fs.writeFileSync(path.join(root, 'args.json'), JSON.stringify({
    reviewerTranscript: path.join(root, 'reviewer.jsonl'), reviewerId: 'agent-bare',
    statement: 'statement', hostSession: '44444444-4444-4444-8444-444444444444',
    taskIds: ['1.1'],
  }));
  const appDir = path.join(root, '.comet/applications/sdd-managed-delivery/versions/1');
  fs.mkdirSync(path.join(appDir, 'skills/grill-me'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'skills/grill-me/SKILL.md'), 'name: grill-me\nversion: 1.0.0\n');
  fs.writeFileSync(path.join(appDir, 'application.json'), JSON.stringify({ contentHash: 'e'.repeat(64), runtimeVersion: '0.5.1' }));

  // 裸 Run 无完整旅程上下文（open 证据绑定的评审历史）——admission 与 verifyGateInputs 都应通过
  // （形状纪律），然后在 evaluate 处被语义拒绝且拒绝原因点名。这是设计行为：宁可拒绝不伪造。
  await assert.rejects(() => tool.buildGateBundle({
    gate: 'R', action: 'bare-change:1', claim: path.join(root, 'claim.json'),
    openEvidence: path.join(root, 'open-ev.json'), args: path.join(root, 'args.json'),
    project: root,
  }, { now: () => '2026-11-02T00:00:00.000Z', clock: () => 1793577600000 }), (error) => {
    assert.match(error.message, /GATE BLOCKED/);
    assert.match(error.message, /INDEPENDENT_REVIEW_REQUIRED/);
    assert.match(error.message, /REQUIREMENTS_CONFIRMATION_REQUIRED/);
    return true;
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('bundle bytes are deterministic (B-③): same evidence same bytes, receipt change changes bytes', () => {
  const common = {
    gate: 'R', artifactRef: '.sdd/delivery/gates/r/receipt-bundle.json',
    inputs: { inputDigest: 'a'.repeat(64), builderExecution: 'sdd-managed-skill-host' },
    policy: { ref: 'policy', digest: 'b'.repeat(64) },
    verdict: { verdict: 'pass', receipt: { id: 'rcpt-1' } },
    evaluatedBy: 'sdd.delivery.gate.r@1 (packaged bindings -> lib/delivery/gate.js evaluate)',
  };
  const entryA = { admitted: 'entry-a' };
  const b1 = tool.buildBundleBytes({ ...common, receipts: [entryA] });
  const b2 = tool.buildBundleBytes({ ...common, receipts: [entryA] });
  assert.ok(b1.equals(b2), 'same inputs must give byte-identical bundles');
  const parsed = JSON.parse(b1.toString('utf8'));
  assert.equal(parsed.schema, 'sdd.delivery.gate.receipt-bundle.v1');
  assert.equal(parsed.gate, 'R');
  assert.deepEqual(parsed.receipts, [entryA]);
  const b3 = tool.buildBundleBytes({ ...common, receipts: [{ admitted: 'entry-b' }] });
  assert.ok(!b1.equals(b3), 'different evidence must change the bytes');
  const b4 = tool.buildBundleBytes({ ...common, receipts: [entryA], evaluatedBy: 'other' });
  assert.ok(!b1.equals(b4), 'evaluatedBy is part of the frozen bytes');
});

test('parameter discipline: missing args / wrong gate / non-running action refuse loudly', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-bundle-neg-'));
  await assert.rejects(() => tool.buildGateBundle({ gate: 'X' }), /--gate 必须是/);
  await assert.rejects(() => tool.buildGateBundle({ gate: 'R' }), /缺少 --claim/);
  const claim = { run: { current: { runId: 'neg', revision: 1, actions: [{ id: 'neg:1', status: 'pending' }] } } };
  fs.writeFileSync(path.join(root, 'claim.json'), JSON.stringify(claim));
  fs.writeFileSync(path.join(root, 'ev.json'), JSON.stringify({ contentHash: 'c'.repeat(64) }));
  await assert.rejects(
    () => tool.buildGateBundle({ gate: 'R', action: 'neg:1', claim: path.join(root, 'claim.json'), openEvidence: path.join(root, 'ev.json'), args: path.join(root, 'missing.json'), project: root }),
    /--args 文件不存在/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveCometRuntimeJson: explicit fake root resolves; garbage root refuses', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-bundle-comet-'));
  fs.mkdirSync(path.join(root, 'dist/domains/engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/domains/engine/runtime-json.js'), 'export function hashRuntimeValue(v){return v;}');
  const resolved = tool.resolveCometRuntimeJson(root);
  assert.equal(resolved, path.join(root, 'dist/domains/engine/runtime-json.js'));
  assert.equal(tool.resolveCometRuntimeJson(path.join(root, 'nope')), null);
  fs.rmSync(root, { recursive: true, force: true });
});
