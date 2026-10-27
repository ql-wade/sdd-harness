# Comet 官方文档调研与 SDD Harness 架构复审

日期：2026-10-20。结论：**REVISE 接入方案；保留 Foundation + Comet 单主控方向，优先复用官方能力，再缩小 Runtime 扩展。** 本文是只读调研报告，不替代已批准 ADR、不改执行计划或生产配置，不构成新的全票评审回执。

## 1. 基线与证明范围

- 用户提供入口：[官方概览](https://docs.comet.rpamis.com/zh/overview)。从 [llms.txt](https://docs.comet.rpamis.com/llms.txt) 发现页面，索引明确标识 0.4.5；同时阅读 Classic、Native、Supervisor、Skill Creator、Engine、评估、平台和 CI/CD 文档。
- 官方站点是可变来源；索引版本标签不是每个示例与固定发行包逐字一致的证明。部分页面仍使用内部脚本式示例，实施使用固定发行包的公开 CLI 协议与源码复核，不复制浮动安装命令。
- 本仓库阅读基线 HEAD：85560dfaf1dc3ffc4ff7b86c29fbb1820195166b。开始时主架构与执行 ledger 已有未提交改动；本报告不修改它们。
- Comet 来源：[upstream.lock.json](../../integrations/comet/upstream.lock.json)，原生 0.4.5 / c90af44a4474662d7853aae76ce785404974fb0a；源码核对使用 pristine，不把现有项目补丁当作上游能力。
- [当前验证报告](../../openspec/changes/delivery-foundation-rearchitecture/verification-report.md)仍登记受管运行验收 0/92。本轮未重跑业务、安装工具、执行模型评测、修改权限或派发实施；官方宣称、源码可见与真实资格验收分别陈述。
- 专项 Native/组合能力核对见 [配套笔记](2026-10-20-comet-official-native-capabilities.md)。

## 2. 官方定位与模式选择

官方区分两种不同的控制目标：Native 固定目标、验收和完成，允许实现方法自主选择；Classic 进一步规定设计、计划、TDD 与审查过程。新项目默认 Native，不意味着所有团队必须选择 Native。[模式选择](https://docs.comet.rpamis.com/zh/native/native-vs-classic)

本项目明确要求需求/架构/测试设计分别审查、方法固定、OpenSpec 保持权威，因此保留 Classic 有需求依据。代价是更多过程产物与上下文，以及从 Superpowers 迁往 Matt 时需要承接的方法协调职责。不能仅以“原来已选”为充分理由，也不能仅因 Native 默认或作者 benchmark 较好自动迁移。

Native 的候选验证/Supervisor 能力只能按其自身代码和协议评价；不能算作 Classic 已原生具备。若以后复审模式，保持同一验收契约做对照，不并行推进同一个 Change 的两套状态。

## 3. 需要修正的既有判断

| 议题 | 官方能力与固定源码 | 对我们架构的修正 | 尚未证明 |
| --- | --- | --- | --- |
| 上下文交接 | Classic handoff 有文件引用、per-file hash、总摘要、结构化内容及过期检测 | 复用其索引/引用和任务 hash 策略；补消费者语义充分性，不再另造等价 handoff | 必需信息实际被读取并正确理解 |
| 上下文压缩 | off 默认可能截断每文件 80 行，标 TRUNCATED；--full 可取全文；beta 完整保留 delta spec、辅助文件用 hash | 不能把 off 理解为全部原文总在上下文；测试必需内容位于第 81 行以后与辅助文件的情况 | beta 适合本项目的正确性/成本收益 |
| Classic 审查 | standard 按风险触发，thorough 按执行方式增加审查；最终综合审查集中 Verify | 映射并保留原有审查策略/预算，避免 Build 后再重复一次整体验收 | Matt 接入后仍真实遵守这些职责 |
| Native 多任务 | Supervisor 有子 Change DAG、AC 映射、worktree、并行上限、集成及父验收 | 不能笼统说 Comet 没有并发控制；若用 Native，应复用其现有机制 | Classic 同等能力、跨角色 WIP、公平性与团队资源治理 |
| 同 Run 方法扩展 | comet-five-phase-overlay 从原 Classic 状态计算节点，禁止独立 init，其 guard 不推进原 phase | 先评估官方 overlay 绑定方法的能力，避免把所有方法迁移都做成 Runtime fork | 原始 Guard/直接 transition/恢复是否强制消费 overlay 检查 |
| 方法真实来源 | Skill Creator 有 prefer/require、strict 策略、真实来源解析和摘要 | 复用方法发现与来源清单，Ponytail/Matt/专门技能职责仍明确 | required Skill 确实被宿主调用，以及来源身份不可伪造 |
| 平台适配 | 官方按平台列 Skill/规则/Hook 支持及安装位置，已有受管配置合并 | 按块明确 Comet/TeamAI/本仓库 adapter 的唯一写者，不重写所有宿主支持 | 内部定制/受限宿主的实际兼容与旁路阻断 |
| 评估度量 | comet eval 有真实任务、事件流、token/cost、契约检查和校验器；skill check 是另一层 | 可复用来评估方法组合稳定性和开销，避免自造同类评测框架 | 真实团队交付周期、人工成本和逃逸缺陷收益 |
| CI/CD | 官方指南主要展示 doctor/status 的健康及阶段检查 | 把它们当 CI preflight/观测，额外接受保护的候选与发布 Gate | 精确 SHA 合并阻断、制品 digest、部署及回滚终态 |
| 记忆/知识 | 原生 Personal Memory/Project Knowledge 有各自生命周期 | 显式选择停用/只读引用/受控桥接，保持既定知识权威 | LLMWiki/Outline 的真实发布授权、持续撤权与所有渠道隔离 |

主要来源：[handoff](https://docs.comet.rpamis.com/zh/scripts/comet-handoff)、[上下文压缩](https://docs.comet.rpamis.com/zh/concepts/context-compression)、[审查模式](https://docs.comet.rpamis.com/zh/concepts/review-mode)、[Supervisor](https://docs.comet.rpamis.com/zh/native/supervisor-change)、[Skill 偏好](https://docs.comet.rpamis.com/zh/skill-creator/preferences)、[平台矩阵](https://docs.comet.rpamis.com/zh/platforms)、[评估](https://docs.comet.rpamis.com/zh/eval/overview)、[CI/CD](https://docs.comet.rpamis.com/zh/guides/cicd-integration)。

## 4. 承重源码发现

### P1-01：官方 overlay 值得先用，但不是已接通的不可绕过 Gate

官方组合功能提供 Workflow Contract、Required Skill Call、Output Schema 和方法来源；不是只有提示词。固定源码 `domains/factory/package.ts` 中，overlay 的 init 拒绝创建独立流程，节点从 Classic 状态计算，证据保存在 `.comet/workflow-evidence/<change>/<protocol.name>.json`。其 guard --apply 明确不改变 Comet phase，保留原 Runtime 推进权。

这与单主控目标相容。先前把组合生成包笼统视为第二阶段引擎不准确；需区分 `comet-five-phase-overlay` 与可拥有自身状态的 `workflow-kernel`。

但同文件约 1242–1244 行接受 record 输入写 evidence；1405–1409 行仅检查 completedChecks 中相应 required-skill 标记。它不足以证明真实 Skill 调用和可信执行身份。对固定 `domains/comet-classic/*.ts` 搜索 workflow-evidence/workflow-protocol/five-phase-overlay 未发现直接引用；这是未找到强制接入证据，不是已运行证明任意调用可绕过。

**处置：**方法绑定优先验证 overlay；缺必需调用、伪造 completedChecks、直接原生 transition、next/resume/archive 五类负例必须实测。只有共同入口与来源仍有缺口时才补 Runtime，不把 overlay PASS 直接转为团队 GateReceipt。

源码：[overlay 状态分支](https://github.com/rpamis/comet/blob/c90af44a4474662d7853aae76ce785404974fb0a/domains/factory/package.ts#L1193)、[Required Skill 检查](https://github.com/rpamis/comet/blob/c90af44a4474662d7853aae76ce785404974fb0a/domains/factory/package.ts#L1405)。

### P1-02：Matt 迁移需要承接 Classic 的公开方法协调合同

官方 review-mode 说明：Superpowers 的任务执行方法仍提供连续任务协调、plan review、文件 handoff、reviewer 中立输入和 progress reconciliation；Comet 接管审查触发与修复预算。[职责边界](https://docs.comet.rpamis.com/zh/concepts/review-mode)

因此原生 Classic 不是所有叶子调度都由独立后台 Runtime 完成，也不是方法技能完全不承担协调。我们“planner 只产出计划”的目标，需要由宿主/Driver 在 Comet 权威状态下承接所需公开执行合同，而不是取消执行协调。Ponytail 提供最小完整实现准则，不接管这些协调职责。

本轮读取项目当前 `0001-matt-method-profile.patch`，内容只修改 init 安装选项；它可能是一个正确切片，但不能据此认定方法、review、恢复和单 controller 迁移已完成。本报告不修改该补丁或给在途任务勾选。

**处置：**保持 P1_6 父任务的完整验收；先做 producer override/Required Skill 绑定 PoC，验证执行协调和任务权威不丢失，再确定必要补丁。官方默认偏好仍含旧方法，不能直接照抄。

### P1-03：固定上下文可追溯，不代表消费者获得了完整语义

`classic-handoff.ts` 约 279–286 行证明，普通模式每文件超过 80 行会截断；beta 则通过完整 delta 与 supporting hash 减少重复传输。官方 handoff 简介中的“完整产物内容”应结合详细压缩页和固定源码理解。

**处置：**保留现有 handoff，补接收角色的必需内容清单、缺项退回和按 hash 读取原文行为。将关键 AC 放到长文件尾部、将关键异常语义放在 supporting 文档，验证接收者是否发现并正确读取；文件存在和 hash 一致只证明绑定。

源码：[截断与全文分支](https://github.com/rpamis/comet/blob/c90af44a4474662d7853aae76ce785404974fb0a/domains/comet-classic/classic-handoff.ts#L279)。

### P1-04：官方状态健康检查没有替代发布资格

CI/CD 指南明确把流水线使用范围集中于安装完整性和状态报告，依赖 Agent/人工决定的动作不直接放入普通 CI。doctor 的 warn/fail 与 status 的阶段信息不是 TestContract、独立验收和 ReleaseReceipt 的同义物。

**处置：**复用 doctor/status 作为 preflight 与观测；受保护 CI 另核对精确候选/集成 SHA、来源、必验集合、制品 digest、环境和授权。已有原生检查结果仅按其原证明范围导入，不自建替代 Git/CI 平台。

### P1-05：Hook 配置保护措辞不能代替实际控制文件隔离

配置页说明 `hook.allow_paths` 不能放行 `.comet` 等受保护区域；这不等于所有 `.comet` 写入永远被禁止。固定 `classic-hook-guard.ts` 约 996 行另有 Comet config 的常规白名单，之前先做 Change ownership/archive 检查。不能从配置页的一句“受保护”推导普通 worker 无法写权威账本。

**处置：**保留 I02 OS/container 角色与控制卷隔离、受保护 policy/发布凭据；逐编辑/Shell/MCP 渠道实测，不把 Hook 当作沙箱。原生 escape/修复路径仍需与普通 worker 隔离。

源码：[白名单与先置归属判断](https://github.com/rpamis/comet/blob/c90af44a4474662d7853aae76ce785404974fb0a/domains/comet-classic/classic-hook-guard.ts#L983)、[配置说明](https://docs.comet.rpamis.com/zh/classic/configuration)。

### P1-06：既有完成谓词和外部副作用恢复缺口仍成立

原生 Classic resolver 的 archived→completed、额外 Run 字段被序列化丢弃，以及原生缺团队 R 回执仍可推进的既有探针，不因官方有恢复/组合/Eval 就自动消失。原生恢复支持有效，但必须扩展到新增义务的所有写入、事务与发现路径。

**处置：**继续复用同一 Run/锁/事务；Kp 卡归档、Kt 卡整体 completed；Outline 超时先独立读回原目标，发布后权限维护尚无已认证原生入口。这里仍是适配/最小 Runtime 扩展范围，不能交给另一个后台主控。

证据：[原生 resolver](https://github.com/rpamis/comet/blob/c90af44a4474662d7853aae76ce785404974fb0a/domains/comet-classic/classic-resolver.ts#L79)、[本项目验证报告](../../openspec/changes/delivery-foundation-rearchitecture/verification-report.md)。

## 5. 建议架构：保留分层，调整复用顺序

| 层 | 优先复用 | 我们仍需负责 |
| --- | --- | --- |
| 设计 | Classic 原生五阶段、OpenSpec、handoff 与状态恢复 | 分离 R/A/T、消费者语义充分性、独立业务 oracle |
| 流程 | 原生 transition/guard/continuation、review 策略与预算 | 新义务共同谓词、可信结果接纳、同 Run 收尾；团队 WIP/等待/成本策略 |
| 工具 | 官方 CLI、宿主适配、overlay、doctor/status、Eval | Matt/test-authoring/Whitebox/Ponytail 的明确绑定与实际调用证明 |
| 规范 | Workflow Contract、来源摘要、输出 schema 与固定配置 | 权限/授权、冻结 TestContract、变更失效、平台与团队价值验收 |
| 基础设施 | 现有平台 Hook 生成器、worktree、检查执行与本机恢复 | 固定 Runner、OS/凭据隔离、目标知识服务、平台 Gate、独立监控和备份恢复 |

配置与分发每个受管块仅一个 reconciler：TeamAI 继续分发批准资产，但不能与 Comet init/update 和本仓库 adapter 同时覆盖相同块。官方安装支持符号链接并不改变本仓库 `.agents/skills` 必须为真实目录的约束；受管执行不得静默采用与当前快照政策冲突的安装方式。

对方案的直接影响：先试官方方法绑定/来源/输出合同，再写缺口补丁；不预先假定所有接入都需要 fork。也不能把生成包的 Required Skill 标记当作身份认证。Native 保留为能力对照，当前不改默认、不迁移现有 Change、不混用运行状态。

## 6. 应先做的五个小型资格实验（本轮未执行）

1. **方法绑定：**固定一个 Classic Change，用 overlay 绑定一个设计/计划 producer 和必要方法；验证真实来源/输出 schema，原 phase 与 tasks 仍只有一个写者。
2. **不可绕过性：**漏 Required Skill、手工填 completedChecks、直接调用原 Guard/transition、恢复和归档；检查这些入口能否共同阻断。只在证实缺口后确定 Runtime 改动。
3. **上下文可用性：**AC 位于第 81 行以后、supporting 文档含承重边界、源文件被修订；检查原文回读、陈旧拒绝及角色正确退回。
4. **可信执行与恢复：**普通 worker 不能改控制卷/策略/发布身份；检查中断后仍绑定原候选/执行。扩展回执经过实际序列化、事务恢复和归档后发现测试。
5. **真实交付：**doctor/status 健康但旧 SHA、漏必验项或错误 digest 的候选仍被平台拒绝；Outline 写成功但响应丢失先查询，未完成 Kt 时整体保持 pending。

Ponytail 的应用是优先复用、缩小补丁与重复验证，同时保持原92场景和所有必需义务；不是把未通过项目改成可选。Eval 可用于方法组合 A/B、重复运行和成本诊断，业务项目及团队价值需另外的真实基线。

## 7. 本轮交付边界

仅新增本报告及配套调研笔记，不修改主架构、ADR、tasks/DAG、执行合同、冻结锁、运行状态或插件缓存。没有启动 comet-any、发布 Skill、运行真实模型评测、部署或发起新的多方共识。文档/代码存在不等于 qualification PASS；后续架构修改需在原变更中接纳并重新冻结。
