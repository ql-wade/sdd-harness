---
name: sdd-archive
description: SDD Harness 归档阶段 —— 封装 trinity-archive + LLMWiki writeback，将 accepted specs 提升到持久目录并完成知识沉淀
license: MIT
compatibility: 需要 trinity-archive skill、OpenSpec CLI、LLMWiki MCP
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:archive — 归档与知识沉淀

> **SDD Harness Stage 9/9**。归档变更并完成知识沉淀：accepted specs 提升到持久目录、knowledge writeback 到 LLMWiki、test assets 收口。
> 底层：trinity-archive（OpenSpec archive）+ LLMWiki MCP（via sdd-harness §5 routing）。公共逻辑委托给 sdd-harness。

---

## 触发

```
/sdd:archive [change-id]
# 省略 change-id 则归档当前 active 变更
```

---

## 执行流程

### Step 1: 加载 Run（sdd-harness）

```yaml
读 workflow-frame.yaml
确认 stage.current = "archive"
重新执行 verify gate（硬前置，不接受 workflow-frame 中历史 passed 状态）
重新检查 review-notes 的最后一条权威 verdict = ready
确认 tasks.md 不存在任何未完成 `- [ ]` 项
确认 release gate 已 passed（硬前置）
读 findings.md、design.md、tasks.md、review-notes、release-note（全量 artifacts）
```

### Step 2: 加载上下文（sdd-harness）

```yaml
# 读 knowledge-pack.md（archive pack）
# 检查 domain registry 状态（on / off），决定 spec 提升路径:
#   registry off → flat namespace: openspec/specs/<slug>/
#   registry on  → 分域:           openspec/specs/<domain>/
```

### Step 3: OpenSpec 归档（trinity-archive）

```yaml
# 调 trinity-archive 执行 OpenSpec CLI 归档:
#   openspec archive [change-id] --yes
# CLI 自动: 验证 specs/proposal、检查任务、合并 Delta Specs、移动到
#   openspec/changes/archive/{YYYY-MM-DD}-<change-id>/、清理 .active
# 禁止直接 mv / 手动改 .active（trinity-archive 强制规则）
```

### Step 4: Spec 提升与验证（sdd-harness）

```yaml
# 验证 accepted specs 已提升到持久目录:
#   registry off → openspec/specs/<slug>/
#   registry on  → openspec/specs/<domain>/
# 若 openspec archive 未自动合并 → 按 trinity-archive 手动提取流程补齐
# 被拒绝 / 未达标的 specs 不提升 → 记录 deferred 状态 + reason
```

### Step 5: LLMWiki 知识沉淀（sdd-harness → LLMWiki MCP）

```yaml
# 按 sdd-harness §5 routing 写回 knowledge（中心新能力）:
#   product     → wiki/product/
#   engineering → wiki/engineering/<domain>/
#   testing     → wiki/testing/
# 补全 backlinks:
#   specs ↔ concepts / entities
#   test cases ↔ specs / requirements / AC
# test assets 在 LLMWiki 收口（last_result / status 更新）
#
# 整段 writeback 可显式 deferred（需记 reason），不阻塞归档
```

### Step 6: 产出（sdd-harness 写盘）

```yaml
# 变更移入 openspec/changes/archive/{YYYY-MM-DD}-<change-id>/
# accepted specs 提升至 openspec/specs/（按 registry 状态分路径）
# LLMWiki knowledge 已 writeback（或 deferred + reason）
# progress.md 追加归档日志 + 变更总结
```

### Step 7: Gate 检查（sdd-harness）

```yaml
# Archive Gate:
#   ✅ 最新 review verdict 仍为 ready
#   ✅ verify gate 针对当前磁盘证据重新执行并通过
#   ✅ release gate 已 passed
#   ✅ OpenSpec archive 完成（变更已移入 archive/，.active 已清理）
#   ✅ accepted specs 已提升或 deferred + reason
#   ✅ LLMWiki writeback 完成 或 deferred + reason
#   ✅ backlinks 已补全
```

### Step 8: Run 收口（sdd-harness）

```yaml
# 终态阶段 —— 无后续 stage 推进
# workflow-frame.yaml 标 run 状态 = completed
# progress.md 记录最终收口
```

---

## 读取

- 全量变更 artifacts（findings / design / tasks / review-notes / release-note）
- knowledge-pack.md
- domain registry 状态（决定 spec 提升路径）
- OpenSpec 已有 specs（`openspec/specs/`）

## 写入

- `openspec/changes/archive/{YYYY-MM-DD}-<id>/`（trinity-archive 移入）
- `openspec/specs/<slug>/`（registry off）或 `openspec/specs/<domain>/`（registry on）
- LLMWiki `wiki/product/`、`wiki/engineering/<domain>/`、`wiki/testing/`（knowledge writeback）
- backlinks（specs ↔ concepts/entities、test cases ↔ specs/requirements/AC）
- deferred 记录（spec 提升 deferred、LLMWiki writeback deferred，各附 reason）
- `openspec/changes/<id>/progress.md`
- `.sdd/runs/<id>/workflow-frame.yaml`（run 状态 = completed）
