# /sdd:dev — 工程 spec

工程 spec 阶段。调 sdd-dev skill（封装 trinity-new + trinity-continue）。

## 用法

```
/sdd:dev
```

## 说明

- 底层：trinity-new（首次）/ trinity-continue（后续）+ Understand-Anything（via sdd-harness §8.5）
- 产出：OpenSpec `specs/` + `design.md`（含 File Structure Plan + boundary 注解）+ `tasks.md`
- code graph：query_graph("impact") + query_graph("domain")
- 之后自动推进到 `/sdd:test`
