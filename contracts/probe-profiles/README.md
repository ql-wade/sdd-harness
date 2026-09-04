# probe-profiles

项目/浏览器 probe 契约。`--profile <name>` 由 `sdd probe` 加载同名 YAML。

| profile | 状态 | 说明 |
|---------|------|------|
| minicraft | 活跃（2 个测试断言） | requiredInteractions / transitionContracts / observationAdapter 契约；背景见 [minicraft-harness-probe-summary](../../docs/architecture/minicraft-harness-probe-summary.md)（历史文档） |

新增 profile = 加 YAML + probe-command 测试覆盖。
