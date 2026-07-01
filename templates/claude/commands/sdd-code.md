# /sdd:code — 实现

实现阶段。调 sdd-code skill（封装 trinity-apply + Superpowers TDD）。

## 用法

```
/sdd:code [task-id]
```

## 说明

- 底层：trinity-apply + Superpowers TDD（RED→GREEN behind feature flag）
- 可选：提交前自检调用 open-code-review（正式 review 在 `/sdd:review`）
- code graph：query_graph("boundary") 确认不跨 boundary
- 产出：代码 diff + 测试 → `progress.md` 更新
- 之后自动推进到 `/sdd:review`
