---
name: sdd-test
description: SDD Harness 测试阶段 —— 产出 test matrix + 归一化测试用例（TC-*.md 写入 llmwiki/wiki/testing/cases/，由 sdd fill test 或 sediment 处理）
license: MIT
compatibility: 需要 LLMWiki MCP
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:test — 测试矩阵与用例

> **SDD Harness Stage 4/9**。产出 test matrix，归一化测试用例（TC-*.md 写入 llmwiki/wiki/testing/cases/，由 sdd fill test 或 sediment 处理）。
> 底层：LLMWiki MCP（via sdd-harness §5）。公共逻辑委托给 sdd-harness。

---

## 触发

```
/sdd:test
```

---

## 执行流程

### Step 1: 加载 Run（sdd-harness）

```yaml
读 workflow-frame.yaml
确认 stage.current = "test"
读 specs/scenarios、AC
```

### Step 2: 加载上下文（sdd-harness）

```yaml
# 读 knowledge-pack.md（test pack）
# 调 sdd-harness.query_graph("impact", changed_module) → 定位回归风险、确定测试范围
# 读 LLMWiki testing/cases/ 已有用例
```

### Step 3: 测试矩阵 + 用例设计

```yaml
# 产出 test matrix：
#   - feature × test type（unit/integration/e2e/non-functional）
#   - 标 coverage gaps
#
# 设计归一化测试用例（每条对应一个 LLMWiki concept）
```

### Step 4: 产出（sdd-harness → LLMWiki MCP）

```yaml
# 写入 LLMWiki wiki/testing/cases/TC-*.md，frontmatter:
#   type: test-case
#   id: TC-<slug>
#   spec: SPEC-<slug>          # backlink → OpenSpec spec
#   requirement: REQ-<slug>    # backlink → 需求
#   ac: AC-<slug>              # backlink → 验收标准
#   code: <code path>
#   suite: TS-<slug>
#   status: active
#   priority: P0|P1|P2
#   last_result: pending
#   last_run: ""
#   tags: []
#
# 用例经 backlink 关联到需求（traceability）
# 记录 automation 候选（哪些用例可自动化）
```

### Step 5: Gate 检查（sdd-harness）

```yaml
# Test Gate:
#   ✅ test matrix 已产出
#   ✅ 用例在 LLMWiki 并经 backlink 关联到需求（traceability）
#   ✅ coverage gaps 已记录
```

### Step 6: Stage 推进（sdd-harness）

gate passed → workflow-frame stage.current = "code" → progress.md 追加。

---

## 读取

- OpenSpec `specs/` scenarios、`acceptance-criteria.md`
- knowledge-pack.md
- code graph（query_graph("impact") 定位回归风险）

## 写入

- LLMWiki `wiki/testing/cases/TC-*.md`（带 frontmatter）
- LLMWiki `wiki/testing/matrices/`（test matrix）
- `.sdd/runs/<id>/workflow-frame.yaml`（stage 推进）
