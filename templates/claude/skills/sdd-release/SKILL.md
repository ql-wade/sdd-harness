---
name: sdd-release
description: SDD Harness 部署阶段 —— manual / automated / skip 三模式，产出 release note、deploy result、rollback path
license: MIT
compatibility: 需要 sdd-harness、CI/CD pipeline（automated 模式）
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:release — 部署

> **SDD Harness Stage 8/9**。Manual / Automated / Skip 三模式部署，产出 release note、deploy result、rollback path。
> 底层：CI/CD pipeline + 手动 checklist。公共逻辑委托给 sdd-harness。

---

## 触发

```
/sdd:release [mode]
# mode: manual | automated | skip（省略则交互确认）
```

---

## 执行流程

### Step 1: 加载 Run（sdd-harness）

```yaml
读 workflow-frame.yaml
确认 stage.current = "release"
重新执行 verify gate（硬前置，不接受 workflow-frame 中历史 passed 状态）
重新检查 review-notes 的最后一条权威 verdict = ready
读 review-notes（review 阶段产出）
```

### Step 2: Mode 选择（sdd-harness）

```yaml
# 若命令行未指定 mode → 交互确认:
#   - manual:    部署 checklist（人工执行 + 逐项勾选）
#   - automated: 触发 pipeline + 记录 result
#   - skip:      无需部署（纯 spec/docs/refactor，或由外部 CI 部署）→ 记录 no-deploy reason
#
# 选定后写 workflow-frame.yaml: deploy_mode = <manual|automated|skip>
```

### Step 3: 执行（按 mode 分支）

#### manual

```yaml
# 输出部署 checklist（按 review-notes + design.md 的 deploy plan 生成）
# 逐项执行 + 勾选确认
# 记录: deploy result、smoke test 结果、rollback path
```

#### automated

```yaml
# 触发 CI/CD pipeline
# 捕获 pipeline result（success / failure / partial）
# 记录: deploy result、smoke test 结果、rollback path
```

#### skip

```yaml
# 不执行部署
# 记录 no-deploy reason（纯 spec/docs/refactor / 外部 CI 接管 / 其他）
# 跳过 smoke / rollback 步骤
```

### Step 4: 产出（sdd-harness 写盘）

```yaml
# 写入 openspec/changes/<id>/release-note.md:
#   - release note / changelog
#   - manual: checklist 完成状态
#   - automated: pipeline result + 链接
#   - skip: no-deploy reason
#
# openspec/changes/<id>/progress.md 追加执行日志
```

### Step 5: Gate 检查（sdd-harness）

```yaml
# Release Gate:
#   ✅ 最新 review verdict 仍为 ready
#   ✅ verify gate 针对当前磁盘证据重新执行并通过（硬前置）
#   ✅ tasks.md 不存在任何未完成 `- [ ]` 项；skip 模式同样不得绕过
#   ✅ deploy mode 已声明
#   ✅ manual 有 checklist / automated 有 result / skip 有 reason
#   ✅ 非 skip: smoke passed 或 risk 已记录
#   ✅ 非 skip: rollback path 已记录
```

### Step 6: Stage 推进（sdd-harness）

```yaml
# 非 skip: gate passed → workflow-frame stage.current = "archive"
# skip:    gate passed → workflow-frame stage 指针直接跳 verify → archive
# progress.md 追加推进日志
```

---

## 读取

- `openspec/changes/<id>/review-notes`（verify gate pass 状态、review 产出）
- `design.md` 的 deploy plan

## 写入

- `openspec/changes/<id>/release-note.md`（release note / changelog）
- deploy result（manual checklist 状态 / automated pipeline result）
- rollback path 或 no-op（skip）
- skip mode: no-deploy reason
- `openspec/changes/<id>/progress.md`
- `.sdd/runs/<id>/workflow-frame.yaml`（stage 推进）
