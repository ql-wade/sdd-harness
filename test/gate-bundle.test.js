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
    ['A', 'architecture-consensus', 'grill-exact-unanimous-consensus', 'multi-agent-consensus-review', 'a'],
    ['T', 'test-design-review', 'independent-test-design-review', 'test-authoring', 't'],
    ['P', 'build-plan-unique', 'plan-unique-review', 'claude-parallel-tdd-planner', 'p'],
    ['V', 'verify-whitebox', 'verify-whitebox-confirmation', 'whitebox-verify', 'v'],
    ['Kp', 'knowledge-project-closeout', 'knowledge-project-closeout-confirmation', 'openspec-lifecycle-guard', 'kp'],
  ];
  assert.deepEqual(Object.keys(tool.GATE_DEFAULTS), ['R', 'A', 'T', 'P', 'V', 'Kp']);
  for (const [gate, check, kind, skill, dir] of expected) {
    assert.equal(tool.GATE_DEFAULTS[gate].check, check);
    assert.equal(tool.GATE_DEFAULTS[gate].kind, kind, `kind 必须对齐 lib/delivery/gate.js 的 review.kind 硬约束（A 门曾错为自造值，r3 实证 evaluate 拒绝）`);
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
    project: root, identity: { contentHash: 'e'.repeat(64), runtimeVersion: '0.5.1' },
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

// bug #4（严重，sdd-test r3 实证）：delivery-authority 单条目覆盖丢前面门的签发 secret
// → outcome sweep 重准录先前门收据时 FORGED_COLLECTION，整个 Run 卡死。
// 回归：双门序列（R 束 → A 束）后 authority 必须保留两门条目，R 的 secret 原样。
test('multi-gate authority merge: per-gate entries preserved, same-gate same-digest replaced', async () => {
  const { envelopeDigest } = await import(pathToFileURL(path.join(repoRoot, 'lib/delivery/evidence.js')).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-bundle-dual-'));
  const mkAction = (id, gate, stepId) => {
    const input = { gate, runId: 'dual-change', change: 'dual-change', changeDir: 'openspec/changes/dual-change' };
    return { id, stepId, status: 'running', input, inputHash: envelopeDigest(input), claim: { executorId: 'sdd-managed-skill-host', sessionId: '99999999-9999-4999-8999-999999999999', token: `tok-${gate}` } };
  };
  const claim = {
    run: { current: { runId: 'dual-change', revision: 3, phase: 'design',
      actions: [mkAction('dual-change:1', 'R', 'classic.extension.requirements-open'), mkAction('dual-change:2', 'A', 'classic.extension.architecture-consensus')] } },
  };
  fs.writeFileSync(path.join(root, 'claim.json'), JSON.stringify(claim));
  fs.mkdirSync(path.join(root, 'openspec/changes/dual-change'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec/changes/dual-change/proposal.md'), '# dual\n');
  fs.writeFileSync(path.join(root, 'ev-r.json'), JSON.stringify({ contentHash: '2'.repeat(64) }));
  fs.writeFileSync(path.join(root, 'ev-a.json'), JSON.stringify({ contentHash: '3'.repeat(64) }));
  fs.writeFileSync(path.join(root, 'reviewer.jsonl'), 'transcript');
  fs.writeFileSync(path.join(root, 'args-r.json'), JSON.stringify({
    reviewerTranscript: path.join(root, 'reviewer.jsonl'), reviewerId: 'agent-r',
    statement: 'r statement', hostSession: 'aaaa1111-1111-4111-8111-111111111111', taskIds: ['1.1'],
  }));
  fs.writeFileSync(path.join(root, 'args-a.json'), JSON.stringify({
    reviewerTranscript: path.join(root, 'reviewer.jsonl'), reviewerId: 'agent-a',
    statement: 'a statement', hostSession: 'aaaa1111-1111-4111-8111-111111111111', taskIds: ['2.1'],
  }));
  const appDir = path.join(root, '.comet/applications/sdd-managed-delivery/versions/1');
  fs.mkdirSync(path.join(appDir, 'skills/grill-me'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'skills/grill-me/SKILL.md'), 'name: grill-me\nversion: 1.0.0\n');
  fs.mkdirSync(path.join(appDir, 'skills/multi-agent-consensus-review'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'skills/multi-agent-consensus-review/SKILL.md'), 'name: multi-agent-consensus-review\nversion: 1.0.0\n');
  fs.writeFileSync(path.join(appDir, 'application.json'), JSON.stringify({ contentHash: '4'.repeat(64), runtimeVersion: '0.5.1' }));
  const identity = { contentHash: '4'.repeat(64), runtimeVersion: '0.5.1' };
  const bare = { now: () => '2026-11-02T00:00:00.000Z', clock: () => 1793577600000 };
  const authorityPath = path.join(root, 'openspec/changes/dual-change/.comet/delivery-authority.json');

  // 两次构造在裸 Run 上都会止于 evaluate 的语义拒绝（预期），但 authority 条目必须已落盘。
  await assert.rejects(() => tool.buildGateBundle({
    gate: 'R', action: 'dual-change:1', claim: path.join(root, 'claim.json'),
    openEvidence: path.join(root, 'ev-r.json'), args: path.join(root, 'args-r.json'),
    project: root, identity,
  }, bare), /GATE BLOCKED/);
  const afterR = JSON.parse(fs.readFileSync(authorityPath, 'utf8'));
  assert.equal(afterR.entries.length, 1);
  assert.equal(afterR.entries[0].gate, 'R');
  const rSecret = afterR.entries[0].secret;

  await assert.rejects(() => tool.buildGateBundle({
    gate: 'A', action: 'dual-change:2', claim: path.join(root, 'claim.json'),
    openEvidence: path.join(root, 'ev-a.json'), args: path.join(root, 'args-a.json'),
    project: root, identity,
  }, bare), /GATE BLOCKED/);
  const afterA = JSON.parse(fs.readFileSync(authorityPath, 'utf8'));
  assert.equal(afterA.entries.length, 2, `A 门条目必须并入而非覆盖（r3 教训）: ${JSON.stringify(afterA.entries.map((e) => e.gate))}`);
  assert.deepEqual(afterA.entries.map((e) => e.gate).sort(), ['A', 'R']);
  const rEntry = afterA.entries.find((e) => e.gate === 'R');
  assert.equal(rEntry.secret, rSecret, '前面门的签发 secret 必须原样保留');
  assert.ok(rEntry.actionDigest && rEntry.actionDigest !== afterA.entries.find((e) => e.gate === 'A').actionDigest, 'per-gate actionDigest 必须可区分');
  assert.ok(afterA.entries.every((e) => typeof e.secret === 'string' && e.secret.length >= 32));

  // 同门同证据重跑 = 同 actionDigest → 替换自身而非无限增长。
  await assert.rejects(() => tool.buildGateBundle({
    gate: 'R', action: 'dual-change:1', claim: path.join(root, 'claim.json'),
    openEvidence: path.join(root, 'ev-r.json'), args: path.join(root, 'args-r.json'),
    project: root, identity,
  }, bare), /GATE BLOCKED/);
  const afterReplay = JSON.parse(fs.readFileSync(authorityPath, 'utf8'));
  assert.equal(afterReplay.entries.length, 2, 'same gate+digest replay must replace its own entry, not append');
  fs.rmSync(root, { recursive: true, force: true });
});

// bug 1：默认 clock 路径——不注入时钟时曾把 Date.now() 立即求值为数字再当函数调用，
// 报 "clock is not a function"。修复后默认路径必须走到语义裁决（GATE BLOCKED），
// 而不是先死在 TypeError 上。
test('default clock path works (no Date.now() eager-call TypeError)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-bundle-clock-'));
  const { envelopeDigest } = await import(pathToFileURL(path.join(repoRoot, 'lib/delivery/evidence.js')).href);
  const actionInput = { gate: 'R', runId: 'clk-change', change: 'clk-change', changeDir: 'openspec/changes/clk-change' };
  const claim = {
    run: { current: { runId: 'clk-change', revision: 1, phase: 'open',
      actions: [{ id: 'clk-change:1', stepId: 'classic.extension.requirements-open', status: 'running',
        input: actionInput, inputHash: envelopeDigest(actionInput),
        claim: { executorId: 'sdd-managed-skill-host', sessionId: '55555555-5555-4555-8555-555555555555', token: 'tok' } }] } },
  };
  fs.writeFileSync(path.join(root, 'claim.json'), JSON.stringify(claim));
  fs.mkdirSync(path.join(root, 'openspec/changes/clk-change'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec/changes/clk-change/proposal.md'), '# bare\n');
  fs.writeFileSync(path.join(root, 'ev.json'), JSON.stringify({ contentHash: 'f'.repeat(64) }));
  fs.writeFileSync(path.join(root, 'reviewer.jsonl'), 'transcript');
  fs.writeFileSync(path.join(root, 'args.json'), JSON.stringify({
    reviewerTranscript: path.join(root, 'reviewer.jsonl'), reviewerId: 'agent-clk',
    statement: 'statement', hostSession: '66666666-6666-4666-8666-666666666666', taskIds: ['1.1'],
  }));
  const appDir = path.join(root, '.comet/applications/sdd-managed-delivery/versions/1');
  fs.mkdirSync(path.join(appDir, 'skills/grill-me'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'skills/grill-me/SKILL.md'), 'name: grill-me\nversion: 1.0.0\n');
  fs.writeFileSync(path.join(appDir, 'application.json'), JSON.stringify({ contentHash: 'd'.repeat(64), runtimeVersion: '0.5.1' }));

  await assert.rejects(() => tool.buildGateBundle({
    gate: 'R', action: 'clk-change:1', claim: path.join(root, 'claim.json'),
    openEvidence: path.join(root, 'ev.json'), args: path.join(root, 'args.json'),
    project: root, identity: { contentHash: 'd'.repeat(64), runtimeVersion: '0.5.1' },
    // 不注入 now/clock——走默认路径
  }), (error) => {
    assert.doesNotMatch(error.message, /clock is not a function/, 'default clock must be a function reference');
    assert.match(error.message, /GATE BLOCKED|找不到已安装 comet/);
    return true;
  });
  fs.rmSync(root, { recursive: true, force: true });
});

// bug 2（协议面）：身份不得从 application.json 静默读取（该文件没有 contentHash 字段，
// undefined 曾使 verifyGateInputs 恒 false）。生产路径必须走官方 loader 且失败即响亮报错；
// 测试注入走 opts.identity。
test('production identity path refuses silent application.json fallback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-bundle-ident-'));
  const claim = { run: { current: { runId: 'idn', revision: 1, actions: [{ id: 'idn:1', status: 'running', stepId: 'classic.extension.requirements-open', input: {}, inputHash: '0'.repeat(64), claim: { executorId: 'x', sessionId: '77777777-7777-4777-8777-777777777777', token: 't' } }] } } };
  fs.writeFileSync(path.join(root, 'claim.json'), JSON.stringify(claim));
  fs.writeFileSync(path.join(root, 'ev.json'), JSON.stringify({ contentHash: '1'.repeat(64) }));
  fs.writeFileSync(path.join(root, 'args.json'), JSON.stringify({
    reviewerTranscript: path.join(root, 'reviewer.jsonl'), reviewerId: 'a', statement: 's',
    hostSession: '88888888-8888-4888-8888-888888888888', taskIds: ['1'],
  }));
  fs.writeFileSync(path.join(root, 'reviewer.jsonl'), 't');
  const appDir = path.join(root, '.comet/applications/sdd-managed-delivery/versions/1');
  fs.mkdirSync(path.join(appDir, 'skills/grill-me'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'skills/grill-me/SKILL.md'), 'name: grill-me\nversion: 1.0.0\n');
  fs.mkdirSync(path.join(root, 'openspec/changes/idn'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec/changes/idn/proposal.md'), '# bare\n');
  // 最小合成包：官方 loader 必然拒绝（缺 module/entrySkill 等）——工具必须响亮报 loader 错误。
  fs.writeFileSync(path.join(appDir, 'application.json'), JSON.stringify({ id: 'sdd-managed-delivery', version: '1', runtimeVersion: '0.5.1' }));
  await assert.rejects(() => tool.buildGateBundle({
    gate: 'R', action: 'idn:1', claim: path.join(root, 'claim.json'),
    openEvidence: path.join(root, 'ev.json'), args: path.join(root, 'args.json'),
    project: root,
  }), (error) => {
    assert.match(error.message, /找不到已安装 comet|loader|application|身份|Skill|模块|INVALID_WORKFLOW/);
    return true;
  });
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
