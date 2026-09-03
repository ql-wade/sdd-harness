# .agents/skills/ 局部规则

本目录是 vendored 技能的版本化快照，是项目技能的唯一权威来源：

- 原始技能正文（frontmatter、references、scripts）以原始来源为准，**不修改、不加项目品牌前缀**。
- 项目约束只在 `AGENTS.md`、`docs/agent/` 和 `openspec/` 中表达。
- 升级技能 = 显式替换对应目录 + 跑 `bash scripts/agent-skill-check.sh`。
- 临时执行产物（session、ledger、截图）不要写进本目录。
