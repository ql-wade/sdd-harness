# .agents/skills/

团队 AI coding scaffold 的技能层：方法论技能的版本化快照，随仓库分发，对所有 Coding Agent 生效。

| 目录 | 来源 | 职责 |
|------|------|------|
| `tdd/` + `diagnosing-bugs/` + `code-review/` | Matt Pocock (mattpocock/skills) | 基础实现方法：TDD、排障、双轴审查（P1_6 方法档案默认实现方法） |
| `grill-me/` + `grilling/` | mattpocock/skills | 前置事实质询（架构共识入口保留） |
| `test-authoring/` | 内部演化 | 测试设计与可执行测试编写（独立于实现与验收） |
| `whitebox-verify/` | 内部 | 三模式验证（调试 / Journey / Slice）：独立验收权威 |
| `openspec-lifecycle-guard/` | 内部演化 | OpenSpec 变更生命周期守护（证据化完成、归档就绪） |
| `claude-parallel-tdd-planner/` | 内部（共享源快照升级，P1_6） | 并行计划协议与数据契约/校验工具（plan_guard、DAG、RED/GREEN ledger）；已去 Superpowers 硬依赖。交付主控是 Comet Classic，本技能不作为第二 controller 激活 |
| `multi-agent-consensus-review/` | 内部 | 三方全票共识评审（unanimous gate + evidence-based debate） |

快照内容与摘要（source_path + sha256）由 `openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json` 固定；升级 = 显式替换对应目录并更新该清单，再跑 `bash scripts/agent-skill-check.sh`。

触发矩阵见 [docs/agent/skill-architecture.md](../../docs/agent/skill-architecture.md)。
