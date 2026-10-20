# Classic 收尾关闭条件、架构方法与 Hook 协作

日期：2026-10-19。状态：Grill 设计，未实施。

## 0. 本轮确认与未决

- R09 用户确认：首版需求/设计变化后全部下游证据失效；不作跨版本自动语义复用。
- 架构环节必须使用 grill-me 与 multi-agent-consensus-review；架构和测试设计仍分别独立自动审查，不能合并。
- TeamAI 只分发，Comet 是唯一交付主控候选；允许最小受控扩展。
- R06 已确认：必需项目知识先卡规格归档，必需 Outline 发布卡整体完成，归档后同 Run 继续收尾；Ponytail 仅核对能否协作，未获指令安装/修改 Hook 或执行当前外部共识评审。

## 1. 四件事分别形成事实，不共用一个 done

| 事实 | 含义与必须证据 | 不代表 |
| --- | --- | --- |
| 产品候选验收 | 独立 V 对冻结候选完成测试/审查和业务读回 | 知识、规格、目标环境已完成 |
| 规格归档 | OpenSpec archive/sync 事务完成，主 specs 与预期一致并读回 | Outline 发布或整体交付已完成 |
| 团队知识发布 | 正确条目/受众，审核授权绑定当前内容，远端写入后独立读回 | 产品已验收、规格已归档或部署已通过 |
| 整体交付完成 | 当前 Change 的全部事前必需义务均有有效回执，且无阻塞 | 某一个工具返回成功即可完成 |

这些是同一 Comet Run 的回执/派生视图，不是四套可各自推动流程的状态机。主规格归档后，Run 可以仍在 Archive 收尾动作中等待知识/平台义务，不创建另一个主控接管。

## 2. 建议的硬阻断位置

| 失败 | 允许保留的成功事实 | 必须阻断 | 同 Run 下一动作 |
| --- | --- | --- | --- |
| KG0 适用性判定缺失 | 已完成研究/代码 | 源码进入最终验收和后续关闭 | 补影响清单/独立核对，不能自填无更新 |
| 必需 LLMWiki 写入/修订/读回未完成 | 已通过的产品测试回执 | Verify→Archive（聚合退出条件）及规格归档 | 项目知识维护/读回；不重跑仍有效的产品测试 |
| OpenSpec 预演/归档失败或目标主 specs 漂移 | 产品验收、已完成项目知识 | spec-archived 与最终 completed | 恢复原规格事务或重预演，不能重复 archive |
| 必需 Outline 审核/授权/发布/读回失败 | 产品验收、项目知识与成功规格归档 | team-knowledge-published 与整体 completed；建议不撤销已成功规格归档 | 等批准或恢复原发布，先查询对象避免重复创建 |
| 必需 DeepWiki/图谱新鲜度或目标环境验证失败 | 其他有效结果 | 对应义务和整体 completed | 恢复原作业/验证，不重复已成功合并或部署 |
| 某项经前置 policy 确认不适用 | 有依据的适用性回执 | 不强制生成知识文章或无必要发布 | 继续其他必需动作 |

R06 已确认规格归档不依赖 Outline 服务当时是否可用，但整体完成必须等待本次必需知识发布。若需求本来以“团队知识可见”为产品功能本身的前置条件，冻结 policy 应把该发布前移，而不是临时放行。不能失败后把必需项改为可选。

## 3. 两个不同的完成谓词（拟议）

can_spec_archive = 当前 R/A/T/P/V 有效 + 必需项目知识闭合 + archive 预演/目标摘要与所需授权成立。

can_complete_delivery = can_spec_archive 的相关事实仍有效 + spec-closeout 实际读回通过 + 所有适用必需团队知识/代码 Wiki/CI/目标环境回执有效 + 无阻塞。

V 产品检查已经通过但项目知识失败时，保留 V 原始回执，但原生 Verify 聚合退出条件不通过；不能把产品测试失败与知识失败混成一个缺陷。知识作者是另一次受管角色执行，Verifier 不因此获得改源码/测试权限。

OpenSpec tasks 只登记归档前必须完成的实施/验证义务。依赖归档结果的团队晋升属于 Comet 后置收尾义务，不能同时成为“必须先勾完才能 archive”的 task，否则形成归档等待发布、发布等待归档的循环。

现有 Classic 的 archived→completed 路径须改为按此求值；archive 命令、state next、恢复、Guard 结果、continuation 和 dashboard 必须一致。规格已归档时允许执行被明确授权的外部知识/平台收尾动作；原生保护范围与 resolver 对该动作的支持属于扩展，不能假定当前已具备。

## 4. Outline 的授权、来源与恢复

正式条目须绑定知识候选 revision/digest、可引用来源、原受众范围、审核及分享批准、目标空间和实际服务身份。审批不是给一段任意后来改写的内容长期通行。

外部写入先登记 operation/目标意图；超时先查询原目标及 revision/content，再确认成功或续接。部分发布成功时保留实际状态；不能用删原条目或重新建页当无条件回滚。源权限撤销先阻止后续不合法读取/发布，再处理内容。已下载副本无法承诺收回。

需求/设计变更使原 A/T/P/V/K 回执对新版本失效；已存在 Outline 页面是历史内容，不由本轮草稿自动覆盖。需要修订则重新提炼、审核、授权和读回。原有交付如已完成，新需求开新 Change，不改写旧完成记录。

## 5. 架构 A 的方法与硬门禁

目标顺序：

需求 R 已接受 → 架构角色用 grill-me 核对事实/术语/边界/风险 → 形成正式设计/ADR → 冻结完整审查包 → 独立共识评审 → 机械 tally/finalize → Comet 接纳 A 回执 → 测试设计 T。

- grill-me 用于解决承重问题，代码可查的先查，需用户决定的一次一问；“加载过技能”不是问题已闭合的证据。未决范围/不可逆取舍必须记录和解决。
- multi-agent-consensus-review 用于架构 A 的独立冷启动评审。默认 quorum 保持 claude-code/zcode/codex-agent，制品与输入范围冻结，整体 >=8、各项 >=7、全部 APPROVE、无 blocker、同一 digest 才能通过；任何缺席/拒绝/低分/陈旧票均不能多数表决放行。
- 共识参与者只读，不在投票期间改设计；固定范围的必要信息按授权提供，不因为触发 hook 而全量外发私有资料。
- 设计变更导致本轮审查包失效，创建关联的新 revision/manifest 冷启动重审；不把旧票改 digest 或混入新轮。未改变制品的证据讨论可用同一冻结制品做有限轮 re-ballot。
- 共识 Skill 内部的有限轮评审作业只管理票/争议记录；它不持有业务 phase、不发布知识、不做 archive。Comet 只派发/恢复一个 architecture-review 作业并消费可信机械结果。
- A 回执同时绑定 R、设计/ADR、审查包 digest、policy、共识 manifest/tally/最终报告来源。Comet 核对结果，不接受 Agent 自写 consensus=passed。

架构 A 使用共识，不意味着测试 T 被其覆盖。T 仍独立审查测试充分性；当前并未决定 T 也要同样三方 quorum，不额外扩大用户要求。

## 6. Ponytail Hook 的当前能力

本轮只读当前插件缓存 5.3.2：.codex-plugin/plugin.json 指向 hooks/claude-codex-hooks.json。该文件注册 SessionStart（startup/resume/clear/compact）、SubagentStart 和 UserPromptSubmit；激活/子代理脚本注入方法上下文并记录 mode。相关脚本有 silent-fail 与 process.exit(0) 的保会话路径。

这组注册没有提供 Comet phase/Gate 判定、OpenSpec 归档门、Outline 发布回执或独立共识调度。不能据此说 Ponytail 已能硬拦 gate；它的现有功能适合作方法/上下文辅助，不是本团队交付权威。

当前 ponytail-runtime.js 仍注明同 repo 会话共享 mode、最后写者生效。架构/测试/实现并行时不能把该 mode 当角色授权或任务身份；跨宿主事件支持与压缩后恢复需逐 harness 实测。旧测试/作者 benchmark 不用于替代当前原生流程证明。

## 7. 建议的 Hook 协作

- 不改 Ponytail 上游/插件缓存，不让它的 session hook 长时间启动共识、多方投票或执行知识发布；否则重开会话/子会话会重复触发。
- Ponytail 可提供最小方案与复用准则，不能降低 R/A/T/验收/安全义务；架构阶段必须保留完整质询和共识 rubric。
- 若需项目 session/resume hook，策略仍写 hooks.yaml，由 adapter 注册；它仅只读询问 Comet 当前允许动作并提供方法引用/恢复提示，缺 hook 也必须由 Runtime 硬门禁阻断。
- Comet 的 continuation 才负责进入 grill-me、派发共识、调用测试作者/Whitebox、安排知识动作。方法接线、审查包与工具版本显式冻结；不根据 Ponytail 全局 mode 改变工作流。
- PreToolUse 写保护以受管 Comet Router/Gate 为控制入口；现有团队 deny 策略与它按范围组合，不能由 Ponytail 追加一个竞争的阶段裁判。
- 装配验收覆盖三者共存、matcher 正确、用户配置保留、重复启动/恢复/压缩、不重复加载/派发、不共享会话状态串扰和真实绕过尝试；本轮未修改或运行这些 hooks。

## 8. 下一项 Grill

R06 已确认该关闭边界。归档后继续/恢复、去重与模块落点见 classic-post-archive-recovery.md；R10 工作区保留策略待确认。

## 当前证据边界

本轮只读已有 Comet 发行包、当前 Ponytail 5.3.2 hook 注册/源码与仓库方法技能；新增设计/规范，不修改运行实现、全局配置或 hooks，不启动外部共识投票，不发表任何知识条目。所有运行时硬门禁与三方共存仍待实证。

## 9. G04 已确认自动发布边界

用户选择预授权内独立审查后自动发布，超范围/敏感交有权人。签发权、grant 范围、真实源/目标有效权限、内容摘要、防自批与持续撤权见 knowledge-preauthorization-contract.md。当前没有实际签发或部署。
