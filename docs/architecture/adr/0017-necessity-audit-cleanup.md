# ADR-0017: 必要性审计清理（consensus 授权）

- 状态：已接受
- 日期：2026-09-04
- 决策人：三方共识评审（claude-code / zcode / codex-agent，run necessity-audit-20260904-r3，全票 8.8/8.8/8.6）
- 证据：[consensus-necessity-audit-2026-09-04.md](../consensus-necessity-audit-2026-09-04.md)

## 背景

对全部 git 追踪文件做逐文件必要性审计（引用图 grep + 三方抽样核验 + 两轮执行完整性辩论）。定位基准：ADR-0015（无工作流引擎）、ADR-0016（superpowers 已移除）。

## 决策

**删除（0 引用证据，9-stage 机器遗留）**：

| 类 | 文件 |
|---|------|
| lib 孤儿（6） | llmwiki-sediment.js（唯一调用方 `sdd run` 已删，两方独立复核确认）、capabilities.js、daily-scheduler.js、deliverable-fixer.js、project-context.js、workflow-state.js |
| 9-stage 文档（10） | TUTORIAL.md、CONTEXT.md、sdd-workflow-flowchart.md、architecture/openspec-vs-speckit.md、superpowers/plans/2026-06-26-complete-9-stage-skills.md、architecture/{sdd-harness-workflow-architecture, best-practice-audit, cc-sdd-comparison, e2e-release-gates, stitch-upgrade}.md |

**Untrack**：hooks/.compiled.env（adapter 生成物，误入索引；ignore 规则已有）。
**同批出清**：vendoring 时误提交的 `.agents/skills/**/*.pyc` 字节码缓存（`__pycache__/` 已入 ignore）。

**终局裁定（原 QUESTIONABLE）**：openspec-vs-speckit.md → DELETE（决策已折叠进 ADR）；minicraft-harness-probe-summary.md → KEEP + 历史标注（其对应的 probe-profiles/minicraft.yaml 是测试依赖）。

**保留确认**：16 个 ADR 历史、llmwiki-structure / llmwiki-mcp-fix-plan（标注 retired 章节）、openspec-best-practices、全部 test/ 与 fixtures、contracts/、根层配置。

## 后果

- lib/ 从 15 收缩到 9（全部有活动引用链）；仓库 ~232 文件。
- ADR-0015 不改写（不可变历史）；本 ADR 为追加记录。
- 后续新增文件的必要性以本 ADR 的标准衡量：有引用链（cli/bootstrap/hooks/check/docs）或明确决策记录，否则不进仓库。
