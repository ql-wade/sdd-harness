---
name: sdd-product
description: SDD Harness 产品草案阶段 —— 封装 to-prd + prototype，产出 PRD / AC / 功能测试草案
license: MIT
compatibility: 需要 to-prd skill、prototype skill、LLMWiki MCP
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:product — 产品草案

> **SDD Harness Stage 2/9**。封装 to-prd + prototype，产出 PRD / AC / 功能测试草案。
> 底层：to-prd、prototype。公共逻辑委托给 sdd-harness。

---

## 触发

```
/sdd:product
```

---

## 执行流程

### Step 1: 加载 Run（sdd-harness）

```yaml
# 调 sdd-harness 加载
读 .sdd/runs/<change-id>/workflow-frame.yaml
确认 stage.current = "product"
读 goal（来自 grill 阶段产出）
```

### Step 2: 加载上下文（sdd-harness）

```yaml
# 读 knowledge-pack.md
# 读 openspec/changes/<id>/findings.md（grill 产出）
# 读 LLMWiki product/ 知识
```

### Step 3: 产品草案合成（to-prd + prototype）

```yaml
# 调 to-prd：基于 findings 合成 PRD
#   - user / problem / scope / non-goals / success metrics
# 调 prototype：产出原型描述（如适用）
# 讨论：
#   - 用户与问题定义
#   - 成功指标可测性
#   - 功能边界（scope vs non-goals）
```

### Step 4: 产出（sdd-harness 写盘）

```yaml
# 写入 openspec/changes/<change_id>/:
#   proposal.md          # PRD: user/problem/scope/non-goals/metrics
#   acceptance-criteria.md   # 可测的验收标准
#   functional-test-draft.yaml  # 功能测试草案（YAML: feature / scenarios[] / happy-path / edge-cases / error-cases, 每条 given/when/then）

# LLMWiki 沉淀（sdd run product 推进后自动触发，agent 无需手动写）:
#   wiki/product/requirements/REQ-*.md
#   wiki/product/acceptance-criteria/AC-*.md
```

### Step 5: Gate 检查（sdd-harness）

```yaml
# Product Gate:
#   ✅ proposal.md 存在
#   ✅ AC 可测（每条有可验证的预期）
#   ✅ functional-test-draft.yaml 齐（含 happy/edge/error cases）
#   ✅ progress 有记录
```

### Step 6: Stage 推进（sdd-harness）

gate passed → workflow-frame stage.current = "dev" → progress.md 追加推进日志。

---

## 读取

- `openspec/changes/<id>/findings.md`（grill 产出）
- LLMWiki `product/` 已有知识
- knowledge-pack.md

## 写入

- `openspec/changes/<id>/proposal.md`
- `openspec/changes/<id>/acceptance-criteria.md`
- `openspec/changes/<id>/functional-test-draft.yaml`
- LLMWiki `wiki/product/requirements/REQ-*.md`、`wiki/product/acceptance-criteria/AC-*.md`
- `.sdd/runs/<id>/workflow-frame.yaml`（stage 推进）
