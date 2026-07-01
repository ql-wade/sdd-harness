---
name: sdd-dev
description: SDD Harness 工程 spec 阶段 —— 封装 trinity-new + trinity-continue，产出 OpenSpec specs/design/tasks（含 File Structure Plan + boundary 注解）
license: MIT
compatibility: 需要 Trinity skills、OpenSpec CLI、Understand-Anything skills
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:dev — 工程 spec

> **SDD Harness Stage 3/9**。封装 trinity-new（首次）+ trinity-continue（后续）。
> 底层：OpenSpec CLI、Understand-Anything skills（via sdd-harness §8.5）。公共逻辑委托给 sdd-harness。

---

## 触发

```
/sdd:dev
```

---

## 执行流程

### Step 1: 加载 Run（sdd-harness）

```yaml
读 workflow-frame.yaml
确认 stage.current = "dev"
读 proposal.md（product 阶段产出）
```

### Step 2: 加载上下文（sdd-harness）

```yaml
# 读 knowledge-pack.md（dev pack）
# 调 sdd-harness.query_graph("impact", changed_module) → 了解变更影响范围
# 调 sdd-harness.query_graph("domain") → 代码与业务 domain 的映射
# 读 AC（acceptance-criteria.md）
```

### Step 3: 工程 spec 编写（Trinity）

```yaml
# 首次进入 dev：
#   调 trinity-new → 创建 openspec/changes/<id>/specs/ 骨架
# 后续：
#   调 trinity-continue → 推进 specs/design/tasks 产出
#
# spec 内容：
#   - 使用 Given/When/Then Gherkin 格式
#   - 覆盖 Happy Path、Edge Cases、Error Cases
#
# design.md 必须包含 File Structure Plan：
#   - 模块布局、文件归属
#   - boundary 注解：每个 task 标 _Boundary:_ 和 _Depends:_
#
# tasks.md：
#   - 每个任务 2-5 分钟可完成
#   - 每个任务有明确验证步骤
```

### Step 4: 产出（sdd-harness 写盘）

```yaml
# 写入 openspec/changes/<change_id>/:
#   specs/<capability>/spec.md
#   design.md（含 File Structure Plan + boundary 注解）
#   tasks.md
```

### Step 5: Gate 检查（sdd-harness）

```yaml
# Dev Gate:
#   ✅ proposal/specs/design/tasks 齐全
#   ✅ code-graph 引用（impact/domain 查询结果）或显式说明不可用原因
#   ✅ test obligations 已声明（每个 task 标注验证方式）
```

### Step 6: Stage 推进（sdd-harness）

gate passed → workflow-frame stage.current = "test" → progress.md 追加。

---

## 读取

- `openspec/changes/<id>/proposal.md`、`acceptance-criteria.md`
- knowledge-pack.md
- code graph（via sdd-harness.query_graph）

## 写入

- `openspec/changes/<id>/specs/`、`design.md`、`tasks.md`
- `.sdd/runs/<id>/workflow-frame.yaml`（stage 推进）
