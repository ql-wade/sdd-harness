# /sdd:verify — 交付验证

交付验证阶段。调 sdd-verify skill（封装 trinity-verify）。

## 用法

```
/sdd:verify
```

## 说明

- 底层：trinity-verify + CI test runner + Playwright MCP（功能）+ chrome-devtools MCP（非功能：Lighthouse perf/a11y）
- 产出：证据摘要（CI 链接 + pass/fail + Lighthouse 分数 + perf insights）→ `progress.md`
- failure 分类：new / known / flaky
- code graph：query_graph("layer") 验证实现层与设计层一致
- 之后自动推进到 `/sdd:release`
