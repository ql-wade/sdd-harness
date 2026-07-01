---
name: sdd-verify
description: SDD Harness 交付验证阶段 —— 封装 trinity-verify，收集 CI + Playwright + chrome-devtools 证据，分类失败，证据汇总写入 progress.md
license: MIT
compatibility: 需要 trinity-verify skill、CI test runner、Playwright MCP、chrome-devtools MCP、LLMWiki MCP
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:verify — 交付验证

> **SDD Harness Stage 7/9**。验证交付完整性：功能性证据 + 非功能性审计。
> 底层：trinity-verify（completeness/correctness/coherence 三维度）+ Playwright MCP（functional evidence）+ chrome-devtools MCP（non-functional: perf trace、Lighthouse a11y/perf）+ LLMWiki coverage query。公共逻辑委托给 sdd-harness。

---

## 触发

```
/sdd:verify
```

---

## 执行流程

### Step 1: 加载 Run（sdd-harness）

```yaml
读 workflow-frame.yaml
确认 stage.current = "verify"
读 review-notes.md（review 阶段产出）
读 OpenSpec tasks.md（确认任务完成状态）
读 CI test results
```

### Step 2: 加载上下文（sdd-harness）

```yaml
# 读 knowledge-pack.md（verify pack）
# 调 sdd-harness.query_graph("layer") → 确认实现层匹配设计层
#   implementation layer 与 design layer 不一致 → 标记为 coherence 风险
# 读 LLMWiki testing/cases/（TC-* 用例 + backlink）→ coverage 基线
```

### Step 3: 验证交付（trinity-verify + evidence 采集）

```yaml
# 调 trinity-verify 跑三维度（completeness / correctness / coherence），
# 同时采集功能性 + 非功能性证据:
#
# 功能性 evidence（functional）:
#   - CI test runner 输出（pass/fail + 链接）
#   - Playwright MCP → 关键 user flow 的 functional evidence
#
# 非功能性 audit（non-functional）:
#   - chrome-devtools MCP → performance trace
#   - Lighthouse → a11y + perf scores
#   - 若无法运行（环境/资源限制）→ 记录 explicit waiver，注明原因 + 风险
#
# LLMWiki coverage query → 确认 spec/requirement 经 backlink 覆盖
```

### Step 4: 生成并判定 Probe Evidence

Browser/Playwright MCP 只负责采集事实，CLI 负责确定性判定。不得把临时
probe script、ASCII dump、结果 JSON 注入正式 `index.html` 或应用 DOM。
同样禁止在 `src/`、`app/`、`pages/` 运行时动态创建这些 debug DOM 标记。
Canvas/WebGL 项目还必须避免 resize 正反馈：不要用 canvas 自身
`clientWidth/clientHeight` 计算后再 `renderer.setSize(...)` 写回同一个 canvas；
应使用 viewport、稳定父容器或 `ResizeObserver` 观测的外部容器尺寸。

```yaml
# 1. 按 templates/sdd-harness/probe-evidence.json 采集:
#    - viewport / document / canvas CSS 与 pixel-buffer 尺寸
#    - debug DOM ids
#    - console errors
#    - observationAdapter：name / available / snapshot；必须真实调用 adapter 后采集
#    - 当前项目关键交互（名称由项目 spec 决定）
#    - stateTransitions[]：每个关键交互的 before/after 事实，不接受只写 "pass"
#      每条 passing interaction 必须有同名 stateTransitions[].name
#      若使用 probe profile，profile requiredInteractions 中每一项都必须有同名 stateTransitions[].name
#      profile transitionContracts 还会约束 assertion、delta expected 或最小 threshold；
#      项目语义必须声明在 profile，禁止写死进通用 validator。
#      * movement 类：assertion="vector-distance>="，before/after 为坐标数组，threshold > 0
#      * 增减计数类：assertion="delta"，after - before 必须等于 expected
#    - build/typecheck/test 等命令退出码；commands 必须是 { 命令名: 整数退出码 }，
#      例如 { "typecheck": 0, "test": 0, "build": 0 }，不得写成对象或摘要文本。
#
# 2. 写入:
#    .sdd/runs/<id>/probe-evidence.json
#    若项目有 probe profile，同时写入:
#    .sdd/runs/<id>/probe-profile   # 内容为 profile 名称，例如 minicraft
#
# 3. 运行确定性 gate:
#    sdd probe \
#      --project "$PWD" \
#      --evidence ".sdd/runs/<id>/probe-evidence.json" \
#      --profile "<probe-profile-name-if-any>" \
#      --json > ".sdd/runs/<id>/probe-report.json"
#
# 4. probe exit 0 且 report.pass=true 才允许 Verify Gate 通过。
#    exit 1 = evidence 无效/缺失；exit 2 = evidence 完整但发现质量失败。
#    report.projectDir 必须解析到当前 run 所属项目根目录；
#    report.evidencePath 必须解析到当前 run 的 .sdd/runs/<id>/probe-evidence.json；
#    report.evidenceSha256 必须等于当前 probe-evidence.json 的 SHA-256；
#    报告生成后证据内容发生任何变化都必须重新运行 probe，不得继续推进。
#    不得复用旧 run、临时路径或手工拼接的 passing report。
#    MISSING_STATE_TRANSITIONS / STATE_TRANSITION_FAILED 表示 E2E 没有证明真实状态变化。
#    REQUIRED_INTERACTION_TRANSITION_MISSING 表示 profile 必需交互缺少同名状态转移证据。
#    STATE_TRANSITION_CONTRACT_MISMATCH 表示状态变化方向/阈值不符合 profile 语义。
#    MISSING_PROBE_OBSERVATION_ADAPTER 表示源码未实现 profile 声明的只读状态适配器。
#    PROBE_OBSERVATION_ADAPTER_UNAVAILABLE 表示 Browser 未证明 adapter 可调用并返回 snapshot。
#    CANVAS_RESIZE_FEEDBACK_LOOP 表示源码中存在 canvas client-size → renderer.setSize 的正反馈。
```

### Step 5: Evidence Audit（磁盘/命令输出一致性）

所有写进 `progress.md` / `review-notes.md` 的事实声明都必须和磁盘、捕获的命令输出一致。
这一步禁止凭记忆改摘要；必须用 CLI 重新审计。

```yaml
# 1. 保存命令原始输出，例如:
#    npm test 2>&1 | tee ".sdd/runs/<id>/npm-test.txt"
#
# 2. 运行确定性 audit:
#    sdd evidence-audit \
#      --project "$PWD" \
#      --change "<openspec-change-id>" \
#      --run "<id>" \
#      --test-output ".sdd/runs/<id>/npm-test.txt" \
#      --json > ".sdd/runs/<id>/evidence-audit-report.json"
#
# 3. evidence audit exit 0 且 report.pass=true 才允许 Verify Gate 通过。
#    exit 1 = audit 输入无效/缺失；exit 2 = markdown evidence 与磁盘或命令输出漂移。
#    --change 可传活动 change id 或归档目录的裸 id；活动目录不存在时，
#    CLI 自动解析 openspec/changes/archive/<id>，无需手工拼接 archive/。
#    progress.md、review-notes.md、捕获的 test output 都是必需输入；
#    任一文件缺失必须产生 EVIDENCE_INPUT_MISSING，null SHA 不得视为有效绑定。
#    report.projectDir 必须绑定当前项目，report.run 必须等于当前 run id；
#    report.evidenceSha256 必须逐项绑定 progress/review/test-output、
#    package.json 与 src/ 源树当前内容；
#    audit 后任一输入发生变化都必须重新运行 evidence-audit。
#    不得复用其他项目或历史 run 的 passing audit。
```

### Step 6: 失败分类 + 写盘（sdd-harness）

```yaml
# 失败分类（每条失败归类）:
#   - functional regression    （功能性回归）
#   - non-functional regression（perf/a11y 退化）
#   - coverage gap             （spec 未被用例覆盖）
#   - environment/blocker      （CI 环境问题，非代码问题）
#
# 所有证据汇总写入 openspec/changes/<id>/progress.md（不单独建文件）:
#   - CI 链接 + pass/fail
#   - Playwright functional evidence
#   - Lighthouse scores（a11y / perf）+ perf insights
#   - 非功能性 audit 结果或 explicit waiver
#   - 失败分类列表
#   - risks 记录
```

### Step 7: Gate 检查（sdd-harness）

```yaml
# Verify Gate:
#   ✅ tasks.md 所有 task 已完成
#   ✅ specs 已覆盖（LLMWiki coverage checked）
#   ✅ 功能性 tests/evidence 已采集（CI + Playwright）
#   ✅ probe-report.json 的 pass = true
#   ✅ probe-report.json.projectDir 绑定当前 run 所属项目
#   ✅ probe-report.json.evidencePath 绑定当前 run 的 probe-evidence.json
#   ✅ probe-report.json.evidenceSha256 等于当前 probe-evidence.json 的 SHA-256
#   ✅ 若 .sdd/runs/<id>/probe-profile 存在，probe-report.json.profile 必须完全一致
#   ✅ evidence-audit-report.json 的 pass = true
#   ✅ progress/review/test-output 三项 audit 输入均存在且 SHA-256 非 null
#   ✅ evidence-audit-report.json 的 projectDir/run 绑定当前项目与当前 run
#   ✅ evidence-audit-report.json.evidenceSha256 绑定当前 audit 输入内容
#   ✅ 非功能性 audit 已运行（Lighthouse/perf）或记录 explicit waiver
#   ✅ 失败已分类
#   ✅ query_graph("layer") 一致或风险已记录
#   ✅ risks 已记录
```

### Step 8: Stage 推进（sdd-harness）

gate passed → workflow-frame stage.current = "release" → progress.md 追加。

---

## 读取

- `openspec/changes/<id>/review-notes.md`、`tasks.md`、`specs/`
- CI test results
- knowledge-pack.md
- code graph（query_graph("layer")）

## 写入

- `openspec/changes/<id>/progress.md`（evidence summary + 失败分类 + risks，不单独建文件）
- `.sdd/runs/<id>/probe-evidence.json`（Browser/MCP 原始观测）
- `.sdd/runs/<id>/probe-profile`（可选；声明本 run 必须使用的 probe profile）
- `.sdd/runs/<id>/probe-report.json`（确定性 gate 报告）
- `.sdd/runs/<id>/evidence-audit-report.json`（磁盘/命令输出一致性 gate 报告）
- `.sdd/runs/<id>/workflow-frame.yaml`（stage 推进）
