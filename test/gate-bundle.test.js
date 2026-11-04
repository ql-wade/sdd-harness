import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { envelopeDigest } from '../lib/delivery/evidence.js';

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
  }, { now: () => '2026-11-03T00:00:00.000Z', clock: () => 1793664000000 }), (error) => {
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
  const bare = { now: () => '2026-11-03T00:00:00.000Z', clock: () => 1793664000000 };
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

// ---- v2.5 AC-4：旗标-门矩阵（工具级拒收）+ AC-2：T 构造期机械复验 ----

import { compileDomainCases, mergeDomainCaseConfigs } from '../lib/delivery/domain-cases.js';

test('flag-gate matrix (tool level): --test-contract refused for all five non-T gates; T without it refuses', async () => {
  const dummy = path.join(repoRoot, 'package.json');
  for (const gate of ['R', 'A', 'P', 'V', 'Kp']) {
    await assert.rejects(() => tool.buildGateBundle({ gate, testContract: dummy }),
      /--test-contract 仅 T 门接受/, `${gate} 必须在构造期拒收 --test-contract`);
  }
  await assert.rejects(() => tool.buildGateBundle({ gate: 'T' }),
    /T 门构造必须带 --test-contract/, 'T 必填缺件拒');
  await assert.rejects(() => tool.buildGateBundle({ gate: 'T', testContract: path.join(repoRoot, 'test', 'no-such-contract.json') }),
    /--test-contract 文件不存在/, 'T 契约文件缺席硬拒');
});

function tFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-bundle-t-')));
  fs.writeFileSync(path.join(root, 'features.md'), '# Features\nF-REQ-1: read item\n');
  fs.writeFileSync(path.join(root, 'design.md'), '# Design\nRead via public API.\n');
  fs.mkdirSync(path.join(root, 'openspec/changes/t-change/tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec/changes/t-change/tests/domain-cases.md'),
    `<!-- domain-cases/v1 -->\n# Domain cases\n\n### TC-READ-1 — Read item\n\n- **Requirement IDs**: F-REQ-1\n- **Acceptance**: AC-1\n- **Dimensions**: Journey-A\n- **Level**: api\n- **Priority**: P1\n- **Precondition**: User is permitted\n- **Input**: Item exists\n- **Step**: Request the item\n- **Expected**: The item is returned\n- **Oracle basis**: F-REQ-1\n- **Oracle authority**: Public API response\n- **Cleanup**: Remove fixture data\n- **Evidence**: Request and response\n- **Check ID**: read-item\n`);
  const library = { basis: [{ id: 'F-REQ-1', kind: 'requirement', path: 'features.md' }],
    dimensions: Object.fromEntries('ABCDEFGHIJ'.split('').map(c => [`Journey-${c}`, {
      required: c === 'A', reason: c === 'A' ? 'Required by F-REQ-1' : 'Not applicable', basis_ids: ['F-REQ-1'],
    }])) };
  const change = { project: 't-fixture', change: 't-change', mode: 'design', design_basis_id: 'DESIGN-1',
    basis: [{ id: 'DESIGN-1', kind: 'source', path: 'design.md' }],
    checks: [{ id: 'read-item', level: 'api', capability: 'api:read', command: 'node --test read.test.js' }],
    cleanup: { environment: 'Dispose', data: 'Remove' } };
  fs.mkdirSync(path.join(root, 'tests/domain-cases'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests/domain-cases/domain-cases.config.json'), JSON.stringify(library));
  fs.writeFileSync(path.join(root, 'openspec/changes/t-change/tests/domain-cases.config.json'), JSON.stringify(change));
  const mergedConfig = mergeDomainCaseConfigs(library, change);
  // 规范投影约定：CLI 注入 DOMAIN-CONFIG 绑定 ② config 字节——进程内夹具复刻同一装配
  mergedConfig.basis.push({ id: 'DOMAIN-CONFIG', kind: 'source', path: 'openspec/changes/t-change/tests/domain-cases.config.json' });
  const result = compileDomainCases({ projectRoot: root, caseFile: 'openspec/changes/t-change/tests/domain-cases.md',
    config: mergedConfig });
  fs.writeFileSync(path.join(root, 'openspec/changes/t-change/tests/test-pack.json'), JSON.stringify(result.testPack));
  const contractPath = path.join(root, 'openspec/changes/t-change/tests/test-contract.json');
  fs.writeFileSync(contractPath, JSON.stringify(result.testContract));
  return { root, contractPath, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('T construction re-verification: happy path binds contractDigest and snapshot bytes', async () => {
  const f = tFixture();
  try {
    const evidence = await tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath });
    assert.match(evidence.contractDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(evidence.snapshotFiles.map(s => s.ref),
      ['.sdd/delivery/gates/t/test-pack.snapshot.json', '.sdd/delivery/gates/t/test-contract.snapshot.json']);
    const packSnap = JSON.parse(evidence.snapshotFiles[0].bytes.toString('utf8'));
    assert.equal(packSnap.cases[0].id, 'TC-READ-1', '快照 = ② 盘上产物拷贝');
  } finally { f.dispose(); }
});

test('T construction re-verification refusal paths: pack drift, missing anchors, source drift, matrix drift, feature-map unregistered', async () => {
  const f = tFixture();
  try {
    // (a) 盘上 pack 篡改
    const packPath = path.join(f.root, 'openspec/changes/t-change/tests/test-pack.json');
    const packRaw = fs.readFileSync(packPath, 'utf8');
    fs.writeFileSync(packPath, packRaw.replace('TC-READ-1', 'TC-HACK-1'));
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath }),
      /盘上 pack 漂移/, '(a) 篡改必须拒');
    fs.writeFileSync(packPath, packRaw);
    // (a) pack 缺席
    fs.rmSync(packPath);
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath }),
      /投影产物缺席/);
    fs.writeFileSync(packPath, packRaw);
    // ② config 缺席
    const config2Path = path.join(f.root, 'openspec/changes/t-change/tests/domain-cases.config.json');
    const config2Raw = fs.readFileSync(config2Path, 'utf8');
    fs.rmSync(config2Path);
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath }),
      /变更级投影配置缺席/);
    fs.writeFileSync(config2Path, config2Raw);
    // (b) 源漂移（features.md 变字节 → 重算失配）
    fs.appendFileSync(path.join(f.root, 'features.md'), 'drift\n');
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath }),
      /投影重算漂移/, '(b) 源漂移必须拒');
    fs.writeFileSync(path.join(f.root, 'features.md'), '# Features\nF-REQ-1: read item\n');
    // (d) 矩阵 digest 篡改
    const contractRaw = fs.readFileSync(f.contractPath, 'utf8');
    const tampered = JSON.parse(contractRaw);
    const matrixEntry = tampered.dependencyBaselines.find(b => b.kind === 'domain-cases/v1:feature-coverage-matrix');
    matrixEntry.digest = '0'.repeat(64);
    fs.writeFileSync(f.contractPath, JSON.stringify(tampered));
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath }),
      /覆盖矩阵 digest 漂移/, '(d) 矩阵篡改必须拒');
    // (d) 矩阵条目缺席
    delete tampered.dependencyBaselines.splice(tampered.dependencyBaselines.findIndex(b => b.kind === 'domain-cases/v1:feature-coverage-matrix'), 1);
    fs.writeFileSync(f.contractPath, JSON.stringify(tampered));
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath }),
      /缺 feature-coverage-matrix 专属条目/);
    fs.writeFileSync(f.contractPath, contractRaw);
    // (c) --feature-map 未注册
    fs.writeFileSync(path.join(f.root, 'other-features.md'), '# Other\n');
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath, featureMapPath: path.join(f.root, 'other-features.md') }),
      /--feature-map 文件未注册/, '(c) 未注册 feature map 必须拒');
    // (c) 已注册 features.md → 通过
    const ok = await tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath, featureMapPath: path.join(f.root, 'features.md') });
    assert.match(ok.contractDigest, /^[a-f0-9]{64}$/);
  } finally { f.dispose(); }
});

// ---- v2.5 AC-5：KB 发布回执（present-but-wrong 必拒；缺席不强制） ----

import crypto from 'node:crypto';
const kbHash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('KB publish receipt: valid receipt recorded in gateEvidence, wrong-run receipt refused, absent receipt fine', async () => {
  const f = tFixture();
  try {
    const evidence = await tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath });
    assert.equal(evidence.kbReceipt, undefined, '无回执 = 不强制、无 gateEvidence 字段');
    const sourceRel = 'tests/domain-cases/domain-cases.config.json';
    const receipt = {
      schema: 'sdd.delivery.kb-publish-receipt.v1', runId: 't-change', change: 't-change',
      page: { path: 'wiki/testing/t-change-domain-cases', sha256: kbHash('page-bytes') },
      source: { path: sourceRel, sha256: kbHash(fs.readFileSync(path.join(f.root, sourceRel))) },
      publishedAt: '2026-11-04T00:00:00.000Z',
    };
    const receiptPath = path.join(f.root, '.sdd/delivery/gates/t/kb-publish-receipt.json');
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    const withReceipt = await tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath });
    assert.deepEqual(withReceipt.kbReceipt, { ref: '.sdd/delivery/gates/t/kb-publish-receipt.json', runId: 't-change', change: 't-change', sourceDigest: receipt.source.sha256 });
    // 跨 Run 复制（runId 不符）→ 拒
    fs.writeFileSync(receiptPath, JSON.stringify({ ...receipt, runId: 'other-run' }));
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath }),
      /与当前 Run 绑定失配/, '回执 runId 失配必须拒（堵跨 Run 复制）');
    // 正本 digest 失配 → 拒
    fs.writeFileSync(receiptPath, JSON.stringify({ ...receipt, source: { path: sourceRel, sha256: 'f'.repeat(64) } }));
    await assert.rejects(() => tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: f.contractPath }),
      /正本 digest 失配/, '回执正本 digest 失配必须拒');
  } finally { f.dispose(); }
});

test('kb-receipt compare script: valid receipt + page read-back pass, tampered page digest refuses', async () => {
  const { spawnSync } = await import('node:child_process');
  const f = tFixture();
  try {
    const sourceRel = 'tests/domain-cases/domain-cases.config.json';
    const sourceDigest = kbHash(fs.readFileSync(path.join(f.root, sourceRel)));
    const receiptPath = path.join(f.root, '.sdd/delivery/gates/t/kb-publish-receipt.json');
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify({
      schema: 'sdd.delivery.kb-publish-receipt.v1', runId: 't-change', change: 't-change',
      page: { path: 'wiki/testing/t-change', sha256: kbHash('page') },
      source: { path: sourceRel, sha256: sourceDigest }, publishedAt: '2026-11-04T00:00:00.000Z',
    }));
    const pagePath = path.join(f.root, 'kb-page.md');
    fs.writeFileSync(pagePath, `---\ndigest: ${sourceDigest}\n---\n# t-change domain cases\n`);
    const cli = path.join(repoRoot, 'tools', 'test-cases', 'verify-kb-receipt.mjs');
    const ok = spawnSync('node', [cli, '--project', f.root, '--run-id', 't-change', '--page', pagePath], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    fs.writeFileSync(pagePath, `---\ndigest: ${'0'.repeat(64)}\n---\n# tampered\n`);
    const bad = spawnSync('node', [cli, '--project', f.root, '--run-id', 't-change', '--page', pagePath], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /页面记录 digest.*≠ 回执正本 digest/, '页读回比对必须拒绝失配');
    const wrongRun = spawnSync('node', [cli, '--project', f.root, '--run-id', 'other-run'], { encoding: 'utf8' });
    assert.equal(wrongRun.status, 1);
    assert.match(wrongRun.stderr, /绑定失配/);
  } finally { f.dispose(); }
});

// ---- 四轮验证 finding 1/4/5：V/Kp 契约注入（T 快照链 → inputs.testContract）----

function vkFixture(gate) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `sdd-gate-bundle-${gate.toLowerCase()}-`)));
  fs.mkdirSync(path.join(root, 'openspec/changes/vk-change'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec/changes/vk-change/proposal.md'), '# vk\n');
  const stepId = gate === 'V' ? 'classic.extension.verify-whitebox' : 'classic.extension.knowledge-project-closeout';
  const actionInput = { gate, runId: 'vk-change', change: 'vk-change', changeDir: 'openspec/changes/vk-change' };
  const claim = { run: { current: { runId: 'vk-change', revision: 1, phase: 'verify',
    actions: [{ id: 'vk-change:1', stepId, status: 'running', input: actionInput, inputHash: envelopeDigest(actionInput),
      claim: { executorId: 'sdd-managed-skill-host', sessionId: '55555555-5555-4555-8555-555555555555', token: 'tok' } }] } } };
  fs.writeFileSync(path.join(root, 'claim.json'), JSON.stringify(claim));
  fs.writeFileSync(path.join(root, 'ev.json'), JSON.stringify({ contentHash: '9'.repeat(64) }));
  fs.writeFileSync(path.join(root, 'reviewer.jsonl'), 'transcript');
  fs.writeFileSync(path.join(root, 'args.json'), JSON.stringify({
    reviewerTranscript: path.join(root, 'reviewer.jsonl'), reviewerId: 'agent-vk',
    statement: 'statement', hostSession: '66666666-6666-4666-8666-666666666666', taskIds: ['1.1'],
  }));
  const appDir = path.join(root, '.comet/applications/sdd-managed-delivery/versions/1');
  const skill = gate === 'V' ? 'whitebox-verify' : 'openspec-lifecycle-guard';
  fs.mkdirSync(path.join(appDir, 'skills', skill), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'skills', skill, 'SKILL.md'), `name: ${skill}\nversion: 1.0.0\n`);
  fs.writeFileSync(path.join(appDir, 'application.json'), JSON.stringify({ contentHash: 'd'.repeat(64), runtimeVersion: '0.5.1' }));
  return { root, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('V/Kp construction sources inputs.testContract from the T snapshot chain (matrix: flag refused, snapshot mandatory)', async () => {
  for (const gate of ['V', 'Kp']) {
    const f = vkFixture(gate);
    try {
      // 快照缺席 → 构造期响亮拒，且 authority 不得先落盘
      await assert.rejects(() => tool.buildGateBundle({
        gate, action: 'vk-change:1', claim: path.join(f.root, 'claim.json'),
        openEvidence: path.join(f.root, 'ev.json'), args: path.join(f.root, 'args.json'),
        project: f.root, identity: { contentHash: 'd'.repeat(64), runtimeVersion: '0.5.1' },
      }, { now: () => '2026-11-03T00:00:00.000Z', clock: () => 1793664000000 }),
        /先完成 T 门构造/, `${gate} 缺 T 快照必须构造期响亮拒（不许静默跳过）`);
      assert.equal(fs.existsSync(path.join(f.root, 'openspec/changes/vk-change/.comet/delivery-authority.json')), false,
        '拒绝路径不得先落盘 authority entry');
      // 快照在场 → gate.js:72 parse 通过，止于语义裁决（GATE BLOCKED），不再是 INVALID_TEST_CONTRACT
      const tf = tFixture();
      const contractSource = compileDomainCases({ projectRoot: tf.root,
        caseFile: 'openspec/changes/t-change/tests/domain-cases.md',
        config: mergeDomainCaseConfigs(
          JSON.parse(fs.readFileSync(path.join(tf.root, 'tests/domain-cases/domain-cases.config.json'), 'utf8')),
          JSON.parse(fs.readFileSync(path.join(tf.root, 'openspec/changes/t-change/tests/domain-cases.config.json'), 'utf8'))) });
      fs.mkdirSync(path.join(f.root, '.sdd/delivery/gates/t'), { recursive: true });
      fs.writeFileSync(path.join(f.root, '.sdd/delivery/gates/t/test-contract.snapshot.json'),
        JSON.stringify(contractSource.testContract));
      tf.dispose();
      await assert.rejects(() => tool.buildGateBundle({
        gate, action: 'vk-change:1', claim: path.join(f.root, 'claim.json'),
        openEvidence: path.join(f.root, 'ev.json'), args: path.join(f.root, 'args.json'),
        project: f.root, identity: { contentHash: 'd'.repeat(64), runtimeVersion: '0.5.1' },
      }, { now: () => '2026-11-03T00:00:00.000Z', clock: () => 1793664000000 }), (error) => {
        assert.match(error.message, /GATE BLOCKED/, `${gate} 快照在场必须过 parse、止于语义裁决`);
        assert.doesNotMatch(error.message, /INVALID_TEST_CONTRACT/, `${gate} 不得再死锁在契约缺席`);
        return true;
      });
      // 快照畸形 → 构造期响亮拒
      fs.writeFileSync(path.join(f.root, '.sdd/delivery/gates/t/test-contract.snapshot.json'), '{ broken');
      await assert.rejects(() => tool.buildGateBundle({
        gate, action: 'vk-change:1', claim: path.join(f.root, 'claim.json'),
        openEvidence: path.join(f.root, 'ev.json'), args: path.join(f.root, 'args.json'),
        project: f.root, identity: { contentHash: 'd'.repeat(64), runtimeVersion: '0.5.1' },
      }, { now: () => '2026-11-03T00:00:00.000Z', clock: () => 1793664000000 }), /不可解析/);
    } finally { f.dispose(); }
  }
});

// ---- 四轮验证 finding 2：CLI 投影 → 构造复验 seam（RUNBOOK ②→③ 文档链）----
// CLI 会向 config.basis 注入 DOMAIN-CONFIG（绑定 ② config 字节）；构造期重算必须复刻
// 同一装配，否则盘上 pack 永远多一条 DOMAIN-CONFIG，(b) 深比较永拒——文档链断裂。

test('CLI-projected ② artifacts pass T construction re-verification (RUNBOOK chain end-to-end)', async () => {
  const { spawnSync } = await import('node:child_process');
  const f = tFixture();
  try {
    // RUNBOOK 流：①+② 合并写入 ② 锚点 → CLI --config ② → --view testpack/contract 落盘
    const library = JSON.parse(fs.readFileSync(path.join(f.root, 'tests/domain-cases/domain-cases.config.json'), 'utf8'));
    const config2Path = path.join(f.root, 'openspec/changes/t-change/tests/domain-cases.config.json');
    const merged = mergeDomainCaseConfigs(library, JSON.parse(fs.readFileSync(config2Path, 'utf8')));
    fs.writeFileSync(config2Path, JSON.stringify(merged));
    const cli = path.join(repoRoot, 'tools', 'test-cases', 'compile-domain-cases.mjs');
    const common = ['--project', f.root, '--cases', 'openspec/changes/t-change/tests/domain-cases.md', '--config', 'openspec/changes/t-change/tests/domain-cases.config.json'];
    const packRun = spawnSync('node', [cli, ...common, '--view', 'testpack'], { encoding: 'utf8', cwd: f.root });
    assert.equal(packRun.status, 0, packRun.stderr);
    fs.writeFileSync(path.join(f.root, 'openspec/changes/t-change/tests/test-pack.json'), packRun.stdout);
    const contractRun = spawnSync('node', [cli, ...common, '--view', 'contract'], { encoding: 'utf8', cwd: f.root });
    assert.equal(contractRun.status, 0, contractRun.stderr);
    const contractPath = path.join(f.root, 'openspec/changes/t-change/tests/test-contract.json');
    fs.writeFileSync(contractPath, contractRun.stdout);
    const evidence = await tool.buildTConstructionEvidence({ project: f.root, runId: 't-change', testContractPath: contractPath });
    assert.match(evidence.contractDigest, /^[a-f0-9]{64}$/, 'CLI 投影产物必须通过构造期四件复验');
    assert.equal(JSON.parse(evidence.snapshotFiles[0].bytes.toString('utf8')).cases[0].id, 'TC-READ-1');
  } finally { f.dispose(); }
});
