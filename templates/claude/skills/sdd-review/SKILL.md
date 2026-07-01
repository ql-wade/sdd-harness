---
name: sdd-review
description: SDD Harness Review 阶段（独立）—— 先 Superpowers code-reviewer（架构 + spec/design 对照），后 open-code-review（行级），2 次拒绝触发 auto-debug
license: MIT
compatibility: 需要 Superpowers code-reviewer、open-code-review CLI
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:review — Review

> **SDD Harness Stage 6/9**（独立 stage，ADR-0010）。Review 审代码质量，verify 验交付完整性，二者正交。
> 顺序：先 Superpowers code-reviewer（架构），后 open-code-review（行级）。

---

## 触发

```
/sdd:review
```

---

## 执行流程

### Step 1: 加载 Run（sdd-harness）

```yaml
读 workflow-frame.yaml
确认 stage.current = "review"
读 spec/design、代码 diff、progress
```

### Step 2: 架构 Review（Superpowers code-reviewer）

```yaml
# 派发 Superpowers code-reviewer subagent（fresh context）
#   对照 OpenSpec spec/design 审:
#     - 架构符合度
#     - spec 覆盖（实现是否覆盖全部 scenarios）
#     - boundary 违规（对照 File Structure Plan）
#     - SOLID / 关注点分离
#   返回 verdict: ready | needs-fix | rejected
#   必须在 review-notes.md 写独立权威行：
#   Superpowers verdict: ready|needs-fix|rejected
#   历史记录或叙述中的 verdict 文本不构成 gate 结论。
#   若 re-review 追加多条权威 verdict，gate 只采用最后一条。
#
# 调 sdd-harness.query_graph("boundary", changed_files, domain) 辅助检查
```

### Step 3: 行级 Review（open-code-review CLI）

```yaml
# 若 Superpowers verdict = ready，跑行级:
#   ocr review --from <base> --to <head> --format json
#   行级评论落到 review-notes.md
#   每条评论 triage: fixed | risk-accepted | deferred
```

### Step 4: Auto-Debug（若触发）

```yaml
# 若 Superpowers code-reviewer 连续拒绝 2 次:
#   新起一个干净 subagent 调查根因（auto-debug，移植自 cc-sdd）
#   写入 review-notes.md 的 Auto-Debug 段
```

### Step 5: 产出（sdd-harness 写盘）

```yaml
# 写入 .sdd/runs/<change_id>/review-notes.md:
#   - Superpowers verdict + 架构/spec/boundary 发现
#   - OCR 行级评论 + triage 状态
#   - auto-debug 结果（若触发）
#
# learnings 经 findings.md 向前传播（cc-sdd 模式）
```

### Step 6: Gate 检查（sdd-harness）

```yaml
# Review Gate:
#   ✅ Superpowers verdict = ready
#   ✅ OCR 行级评论已 triage（fixed 或 risk-accepted 或 deferred）
#   ✅ 若触发，2 次拒绝的 auto-debug 已完成
```

### Step 7: Stage 推进（sdd-harness）

gate passed → workflow-frame stage.current = "verify" → progress.md 追加。

---

## 读取

- `openspec/changes/<id>/specs/`、`design.md`
- 代码 diff、`progress.md`
- code graph（query_graph("boundary")）

## 写入

- `.sdd/runs/<id>/review-notes.md`
- `openspec/changes/<id>/findings.md`（learnings 传播）
- `.sdd/runs/<id>/workflow-frame.yaml`（stage 推进）
