# Comet 与交付主控候选初筛

日期：2026-10-19。范围：官方仓库、文档与部分控制代码的只读调研；未安装、未执行上游测试、未验证真实交付或故障恢复。本文是选型讨论材料，不改变 ADR-0019 或现有主控选择。网页默认分支会变化，实施前必须冻结版本重新核验。

## 判断依据

当前 [交付设计](../architecture/delivery-architecture.md) 要求 TeamAI 仅分发；一个运行后端拥有派发、推进和恢复；SDD Gate 仅判定；OpenSpec 与 CI/CD 保留各自权威。最新范围还包含发布后权限事件、周期核验与隔离补偿。

因此比较两个成本：研发方法接入成本，以及长期业务作业的运行成本。单纯有角色、任务清单或 resume 命令，不能证明证据不可绕过、版本失效或远端操作幂等。

## 候选比较

| 仓库 | 官方可核对的能力 | 与本项目的主要缺口 | 初筛判断 |
| --- | --- | --- | --- |
| [rpamis/comet](https://github.com/rpamis/comet) | Classic 的 OpenSpec 阶段治理；Native 独立运行；项目状态、检查、恢复和子 Change/worktree | 我们的 R/A/T/P/V/K 门、统一失效、发布后维护仍须扩展与实证；Classic 仍声明 Superpowers 方法依赖 | 保留研发主控基准，不因已写设计直接认定通过 |
| [dagucloud/dagu](https://github.com/dagucloud/dagu) | YAML DAG、命令/容器、子图、重试、human tasks、文件持久状态、UI/API/MCP；单二进制可不依赖外部数据库 | Agent 会话、候选、角色身份、OpenSpec 归档和证据语义需要适配；不能把命令 exit 0 当验收 | 最值得补做试点的通用流程候选，适合固定受管 Runner |
| [OrchestratorInc/agent-orchestrator](https://github.com/OrchestratorInc/agent-orchestrator) | 原 ComposioHQ 地址重定向至此；worker/worktree、项目协调者、PR/CI/review 观察；代码持久化反馈去重状态 | 产品围绕会话与 PR；反馈投递不等于门禁拒绝；正式文档不支持通过旧 reactions 配置实现自动合并 | 多 Agent 研发工作台候选；非现成完整交付治理后端 |
| [openai/symphony](https://github.com/openai/symphony) | Issue 驱动、单一调度者、隔离工作区、退避重试、reconciliation、仓库 WORKFLOW.md | SPEC 明确按 tracker/filesystem 重建，不恢复精确内存调度状态；不定位通用工作流引擎，业务票据写入通常交 Agent | 适合 Issue→实现的调度参考，不能假定完整恢复交付回执 |
| [bmad-code-org/bmad-loop](https://github.com/bmad-code-org/bmad-loop) | 普通 Python 控制故事选择/重试/完成；落盘恢复、独立上下文 review、verify commands、单 board writer、插件和可选 worktree | 官方明确 early open beta 且面向 BMAD implementation phase；需要 BMAD v6/技能/故事契约；独立上下文不等于只读独立验收 | 与 Comet 接近的研发循环挑战者，但迁入 BMAD 的成本须计入 |
| [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) | 当前 next 分支；与旧 gsd-build/get-shit-done 区分，详细门禁源码初筛见同目录方法对照笔记 | 必须区分已有运行代码、可调用能力和完整受管闭环；尚未证明我们的信任/失效/收尾契约 | 值得比较的编码交付候选，不应仅凭旧版印象称纯提示词 |
| [temporalio/temporal](https://github.com/temporalio/temporal) | Workflow 持久执行；Activity 超时、重试和事件历史；Worker 故障后可继续处理 | 需要服务与 SDK 开发，研发领域动作需自行实现，改变首期零新增业务 Server 的成本边界 | 若长期权限维护和故障补偿成为核心，可作为替换型运行基础评估 |

以上排序是架构适配判断，不是运行评分。没有候选在本次调研中通过本项目验收。

## 关键来源与核对边界

- Comet [README](https://github.com/rpamis/comet#what-is-comet-)：确认 Classic/Native 方法、状态与恢复的公开定位。此前项目的固定版本源码结论仍以现有 Change 文档为准，本次未重做全量审查。
- Dagu [README](https://github.com/dagucloud/dagu#readme) 与 [ARCHITECTURE.md](https://github.com/dagucloud/dagu/blob/main/ARCHITECTURE.md)：规范解析→IR→intake→runtime→executor→文件持久层；运行与判定可分离是适配机会，不代表我们的 Gate 已接入。
- AO [README](https://github.com/OrchestratorInc/agent-orchestrator#readme)、[automation reference](https://github.com/OrchestratorInc/agent-orchestrator/blob/main/frontend/src/docs/content/configuration/lifecycle-automation.mdx)、[reactions.go](https://github.com/OrchestratorInc/agent-orchestrator/blob/main/backend/internal/lifecycle/reactions.go)：反馈签名/次数落盘并在重启后加载；sessionComplete 使用 PR 合并事实与无未关闭 PR，不是本项目全部交付义务。当前文档明确 retired reactions 配置和显式 merge 边界，不能照搬旧博客配置。
- Symphony [SPEC §1–3、§7](https://github.com/openai/symphony/blob/main/SPEC.md) 与 [orchestrator.ex](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir/orchestrator.ex)：规范区分调度状态与 tracker 状态，重启重建不等于持久化原内存队列。
- BMAD Loop [README](https://github.com/bmad-code-org/bmad-loop#readme)：明确 beta、BMAD 前置依赖、review 可修补产物、worktree 是可选项且本地合并不创建 PR。更细源码结果见方法对照笔记。
- Temporal [Workflow Execution](https://docs.temporal.io/workflow-execution) 与 [Activity Definition](https://docs.temporal.io/activity-definition)：Activity 在未报告完成时可能重试，外部副作用幂等仍由应用/远端操作键保证；不承诺自动得到外部 exactly-once。

## 架构建议

1. 保留已确定的 Foundation、OpenSpec、Gate/证据、独立验证、CI/CD 所有权；主控选型可以比较，不自动推翻其余架构。
2. 近期优先对照 Comet 与 Dagu：前者研发治理接近现状，后者通用流程与维护作业更直接，但需要自己接入研发领域适配。
3. BMAD Loop 和 GSD 做研发循环挑战者；AO 用于比较多 Agent 工作台和 PR 闭环。不要因界面更丰富就认定证据门禁更强。
4. “唯一主控”约束应落在同一项业务进度只有一个写者，而不是预先锁死仓库品牌。若决定替换，必须显式修订 ADR，并迁移状态、恢复和完成条件。
5. 若采用 Dagu/Temporal 管完整生命周期，则该引擎拥有跨环节运行与重试，编码工具成为有界动作。保留一个同时自主推进相同交付状态的 Comet 再套外层，不满足本设计。
6. Temporal 是长期替换方向，不是首期无代价插件。LangGraph 的 checkpoint/interrupt 可参考，但它也是需要开发领域逻辑的库，当前没有证据证明引入它更省集成工作。

## 同题试点与淘汰门

候选使用同一业务任务、冻结的 AC/TestContract、相同工具与预算，分别记录适配代码量、上游修改量、真实完成率、人工介入和恢复成本。至少执行：

- 架构或测试门失败，源码实施实际被阻断；直接调用和恢复也不能绕过。
- 需求 revision 改变，全部下游证据失效，旧票/旧报告不能放行。
- Builder 伪装 Verifier、零测试、漏必验项时拒绝。
- 构建后杀进程，恢复绑定原任务与候选，不产生重复部署。
- Outline 写成功但本地未收到响应，先独立读回再决定是否重试。
- OpenSpec 已归档但必需知识发布失败，整体仍保持未完成。
- 发布后撤权、事件漏报、Runner 重启，周期补查与隔离只经同一业务状态所有者补偿。

只有静态接口证据的项目可进入候选，不能标记 ready。真实试点必须另行明确范围与环境；本文不执行部署、发布、权限修改或主控替换。
