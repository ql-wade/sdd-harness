# Build on sdd-cli, not fork cc-sdd

cc-sdd（gotalab/cc-sdd，约 3.5k stars）是一个成熟的 SDD harness，覆盖 spec→code 循环，含 per-task independent review、auto-debug 与 boundary discipline。我们刻意不 fork 它作为底座，原因有二。其一，spec system 冲突：cc-sdd 是 Kiro 方法论的复刻（`.kiro/`、EARS `requirements.md`），而 SDD Harness 是 OpenSpec 原生 —— fork 要么放弃 ADR-0001 确立的 OpenSpec 根基，要么得重写 cc-sdd 的核心。其二，SDD Harness 的差异化恰恰是 cc-sdd 没有的：LLMWiki knowledge closed-loop、MCP integration layer、hooks/gates/evidence governance、product/dev/test 多角色、release stage。我们借鉴 cc-sdd 验证过的 workflow 模式；底座守 OpenSpec，并以 sdd-cli 为基础 fork 演进（具体方式见 ADR-0009）。

## Considered Options

- Fork cc-sdd —— 拒绝：Kiro spec system 与 OpenSpec 根基冲突；重写 spec 层会抵消 fork 的好处。
- 从零造 —— 拒绝：重复 cc-sdd 与 sdd-cli 已解决的问题。
- sdd-cli 底座 + 移植 cc-sdd 模式 —— 采纳：spec 对齐、借鉴成熟模式、在其上叠加差异化。
