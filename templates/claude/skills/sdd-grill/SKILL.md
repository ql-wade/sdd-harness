---
name: sdd-grill
description: SDD Harness 澄清阶段 —— 封装 grill-with-docs + MCP context pack，进行 evidence-driven 业务澄清
license: MIT
compatibility: 需要 grill-with-docs skill、sdd-context-mcp、LLMWiki MCP
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:grill — 澄清

> **SDD Harness Stage 1/9**。Evidence-driven 业务澄清，产出术语、边界、冲突日志、ADR 候选。
> 底层：grill-with-docs + sdd-context-mcp。公共逻辑委托给 sdd-harness。

---

## 触发

```
/sdd:grill "变更描述"
```

---

## 执行流程

### Step 0: Discovery 路由（借鉴 cc-sdd `/kiro-discovery`）

**不默认创建新 change**。先分析用户意图，路由到最合适的路径：

```yaml
# 分析用户输入 + 现有 openspec/specs/ + openspec/changes/ + .sdd/steering/
# 路由决策:
route:
  extend:        # 已有相关 spec/design，本次是增量改动
    action: 找到既有 change 或 spec，在其基础上扩展
    skip_create: true
  direct_impl:   # 小改动（typo/单文件/配置），无需 spec
    action: 跳过 grill→dev，直接进 code（标 waiver）
    skip_create: true
  new:           # 全新功能/需求（默认）
    action: 创建新 change，走完整 9 阶段
    skip_create: false
  decompose:     # 大型 initiative，需拆成多个 change
    action: 写 roadmap.md（多 change 列表），逐个走流程
    skip_create: false
    roadmap: true

# 路由结果写入 brief.md（借鉴 cc-sdd）——支持 workstream 恢复，不用重复解释 scope
```

若 route ≠ new，grill 在 brief.md 记录路由决策后，直接推进到对应阶段（extend→dev，direct_impl→code），不走完整澄清。

### Step 1: 初始化 Run（sdd-harness）

```yaml
# 调 sdd-harness 初始化
change_id = "<slug>-<4位 hash>"
创建 openspec/changes/<change_id>/  (Trinity new)
创建 .sdd/runs/<change_id>/workflow-frame.yaml (stage=grill)
生成 .sdd/runs/<change_id>/knowledge-pack.md (sdd-context-mcp.build_grill_pack)
```

### Step 2: 加载上下文（sdd-harness）

读 workflow-frame.yaml → 确认 stage=grill、goal、allowed_actions。
读 knowledge-pack.md → 获取 LLMWiki glossary、Understand-Anything graph、DeepWiki pages、OpenSpec 已有 specs。

### Step 3: 业务澄清（grill-with-docs）

```yaml
# 调 grill-with-docs，以 knowledge-pack 为上下文
# 讨论:
#   - 术语定义与冲突（terms / glossary）
#   - 业务边界（scope / non-goals）
#   - 异常场景（edge cases / error cases）
#   - 矛盾点（contradictions in existing knowledge）
#   - ADR 候选（需要架构决策的点）
```

### Step 4: 产出（sdd-harness 写盘）

```yaml
# 写入 openspec/changes/<change_id>/findings.md:
#   - 术语定义 + 冲突解决
#   - 边界决定
#   - ADR 候选列表
#   - 未解决问题

# 写入 LLMWiki (sdd-harness → LLMWiki MCP):
#   - wiki/_shared/glossary/ 写术语页（term-*.md）
#   - 有冲突的术语标注 contradiction flag
```

### Step 5: Gate 检查（sdd-harness）

```yaml
# Grill Gate:
#   ✅ terminology conflicts resolved or explicitly deferred
#   ✅ glossary terms written to LLMWiki
#   ✅ ADR candidates listed
#   ✅ findings.md 存在
#   ✅ progress entry recorded
```

### Step 6: Stage 推进（sdd-harness）

gate passed → workflow-frame stage.current = "product" → progress.md 追加推进日志。

---

## 读取

- LLMWiki glossary（_shared/glossary/）
- Understand-Anything graph（nodes / layers）
- DeepWiki pages
- OpenSpec 已有 specs（openspec/specs/）

## 写入

- `openspec/changes/<id>/findings.md`
- LLMWiki `_shared/glossary/term-*.md`
- `.sdd/runs/<id>/knowledge-pack.md`（首次生成）
- `.sdd/runs/<id>/workflow-frame.yaml`（初始化 + stage 推进）
