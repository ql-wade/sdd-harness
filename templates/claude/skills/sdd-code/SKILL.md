---
name: sdd-code
description: SDD Harness 实现阶段 —— 封装 trinity-apply + Superpowers TDD，在 feature flag 后跑 RED→GREEN
license: MIT
compatibility: 需要 trinity-apply skill、Superpowers TDD、Understand-Anything skills（boundary 检查）
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# /sdd:code — 实现

> **SDD Harness Stage 5/9**。封装 trinity-apply + Superpowers TDD。
> 底层：Superpowers TDD + subagent-driven development。公共逻辑委托给 sdd-harness。

---

## 触发

```
/sdd:code [task-id]
```

---

## 执行流程

### Step 1: 加载 Run（sdd-harness）

```yaml
读 workflow-frame.yaml
确认 stage.current = "code"
读 tasks.md（选定要实现的 task）
读 design.md 的 boundary plan
读 findings.md learnings
```

### Step 2: 加载上下文（sdd-harness）

```yaml
# 读 knowledge-pack.md（code pack）
# 调 sdd-harness.query_graph("boundary", file, domain) → 确认实现不跨 boundary
#   若有 boundary violation → 警告并暂停，要求 design.md 调整
# 若当前 run 存在 probe-profile：
#   读 templates/sdd-harness/generation-contracts/browser-probe.md
#   读对应 probe profile 的 requiredInteractions / transitionContracts
#   把可观测状态适配器作为实现契约，不得注入 debug DOM
```

### Step 3: 实现（trinity-apply + Superpowers TDD）

```yaml
# 调 trinity-apply 执行选定的 task
# Superpowers TDD（在 feature flag 后）:
#   RED:  写失败测试
#   GREEN: 写最小实现让测试通过
#   REFACTOR: 重构
# browser 项目同时满足 browser-probe.md：
#   - canvas 尺寸来自 viewport 或稳定外部容器，禁止 canvas client size → setSize 自反馈
#   - 调用真实 resize controller 的 resize feedback 负向 regression test 必须先红后绿
#   - 暴露只读 globalThis.__sddProbe.snapshot()，覆盖 profile 所需状态
#
# 可选：提交前自检调用 open-code-review（ocr review）
#   注意：这是自检，正式行级 review 由 /sdd:review 阶段执行
```

### Step 4: 产出（sdd-harness 写盘）

```yaml
# 代码 diff
# unit/integration 测试
# openspec/changes/<id>/progress.md 追加执行日志
# Trinity tracking receipt（task_plan.md 更新）
```

### Step 5: Gate 检查（sdd-harness）

```yaml
# Code Gate:
#   ✅ 选定的 OpenSpec task 已完成
#   ✅ test generation agent 未超时且 exit 0
#   ✅ 生成前后测试清单 SHA-256 对比显示至少一个测试文件新增或修改；
#      仅存在未变化的历史测试不得通过，不得声称“测试已生成”
#   ✅ 根据项目 manifest 运行真实测试命令（npm/pytest/cargo/go/maven）且 exit 0
#   ✅ 原始测试输出写入 .sdd/runs/<id>/code-test-output.txt，
#      code-test-report.json 以 SHA-256 绑定该输出
#   ✅ Trinity tracking receipt 存在
#   ✅ progress.md 已更新
```

### Step 6: Stage 推进（sdd-harness）

gate passed → workflow-frame stage.current = "review" → progress.md 追加。

---

## 读取

- `openspec/changes/<id>/tasks.md`、`design.md`、`findings.md`
- knowledge-pack.md
- code graph（query_graph("boundary")）

## 写入

- 代码 diff、unit/integration 测试
- `openspec/changes/<id>/progress.md`
- `.sdd/runs/<id>/code-test-output.txt`
- `.sdd/runs/<id>/code-test-report.json`
- `.sdd/runs/<id>/workflow-frame.yaml`（stage 推进）
