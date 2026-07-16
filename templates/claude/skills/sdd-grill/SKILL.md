---
name: sdd-grill
description: SDD Harness 澄清阶段 —— 封装 grill-me (mattpocock/skills) 做 relentless interview，产出 findings.md
license: MIT
compatibility: 需要 grill-me skill（mattpocock/skills，含 grilling）
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:grill — 澄清

> **SDD Harness Stage 1/9**。委托给 grill-me (mattpocock/skills) 做 evidence-driven 业务澄清。

---

## 触发

```
/sdd:grill "变更描述"
```

---

## 执行（委托模式）

### 1. Bootstrap（委托 sdd-harness）
读 `.sdd/active-run` → 无则调 sdd-harness Bootstrap Run 创建 change + workflow-frame。
读 `.sdd/runs/<id>/workflow-frame.yaml` → 确认 stage=grill、goal。

### 2. 澄清（委托 grill-me）
调用已安装的 `grill-me` skill，进入逐问逐答的 grilling session。
以 sdd-harness 加载的上下文（steering + 已有 specs + LLMWiki glossary）为背景，对 goal 做 relentless interview。

### 3. 沉淀（委托 sdd-harness）
- 写 `openspec/changes/<id>/findings.md`（术语/边界/ADR候选/未解决问题）
- 写 `openspec/changes/<id>/brief.md`（discovery 路由决策：new|extend|direct_impl|decompose）
- 调 sdd-harness Gate Check → passed 后推进 stage→product

---

## 读取

- sdd-harness → workflow-frame.yaml（stage / goal / artifacts）
- sdd-harness → knowledge-pack（LLMWiki + 已有 specs + Understand-Anything graph）
- grill-me → `/grilling` session 产出

## 写入（委托 sdd-harness）

- `openspec/changes/<id>/findings.md`
- `openspec/changes/<id>/brief.md`
- LLMWiki `_shared/glossary/term-*.md`（sediment 自动提取）
