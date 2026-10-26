# 调度、状态、恢复与技能接入 Grill

日期：2026-10-19。状态：目标分工草案，REVISE；未接入任何运行时。

> 当前决定：R00 已确认 A，目标后自动推进；TeamAI 首期只分发，原双层调度方案不再采用。Comet 唯一主控的可行性、发行包证据和下一问题统一见 [comet-single-controller-review.md](comet-single-controller-review.md)。下文双层分工保留为历史审视，不是当前实施依据。本文聚焦运行控制，知识域决定继续见 foundation-grill.md。

> 本质复审（2026-10-19 后续）：下文 TeamAI 外层 + Comet 内层是待验证组合候选，不是已经决定的必需拓扑。先确定自动化范围、唯一推进权和交付完成边界，再决定是否需要双层运行时；KG0–KG3 亦为拟议检查义务，非新增阶段或已实现能力。

## 1. 本轮直接核对的来源

- TeamAI 固定源码 docs/guide/workflow.md @ 8dc60b082f60ed19a735fde6839ffddb59ec5b4b：步骤依赖、next/report 的 lease/attempt/revision/driver 检查、scope 数据目录、resume/retry/cancel、只读 local prompt、命令结束无常驻进程。
- Comet README-zh.md @ 575ab0d172e8105257b3c9172b8c8a9b628960ca：Native 方法自主/状态检查/验证/恢复，Supervisor 的子 Change DAG、worktree、有序集成和父验收；Native 工件默认 docs/comet/，与 Classic 分开。
- 本仓库 vendored planner 的 SKILL.md 与 references/parallel-execution.md：当前仍包含 Controller/派发/集成协议。目标中 planner 只输出计划，不能假设原技能天然已收缩；需受控调用、显式升级及反重复控制验证。

这是源码/文档核对，不是完整运行或原生宿主认证。源码 commit 不是实际安装包完整性。

## 2. 三种组件层次

| 层次 | 组件 | 主责 | 不拥有 |
| --- | --- | --- | --- |
| 团队资产 | TeamAI distribution | 分发规则、技能、hooks/MCP 描述、workflow 发布版本 | 业务源资料授权、交付 PASS |
| 外层流程 | TeamAI workflow 候选后端 | 产品/设计/测试契约/计划/开发子任务/CI 的依赖、外层 attempt、等待与恢复 | Comet 叶子任务和开发内部迭代 |
| 开发运行时 | Comet Native 候选后端 | 一个开发子图的执行约束、worktree、候选、验证身份、修复、集成与恢复 | 产品范围拍板、团队规格权威、生产部署 |
| 实际执行 | 受管 Runner + Harness Driver | 启动/观察/取消真实 Agent 进程，加载角色/技能、执行工具、提交回执 | 再建一套当前阶段或擅自判定验收通过 |
| 放行判断 | SDD Gate | 契约/来源/独立性/分母/候选有效性与门禁回执 | 派发任务、生成测试或原始执行事实 |

TeamAI 和 Comet 分别拥有不同粒度的状态。它们都不是仅因安装就能无人值守运行的后台服务；持续驱动由 CI/进程监督/Runner 提供，恢复语义还需适配实测。

## 3. 任务划分：只调度一个开发子图

```text
TeamAI outer run
  产品基线 → 设计基线 → 测试契约 → 计划
      → development（绑定唯一 Comet run）
          Comet：必要的任务 DAG/worktree
             → Builder/TDD → Reviewer + Whitebox Verifier
             → 修复/新候选 → 集成 → 父目标验收
      → Gate 核对开发回执 → CI/CD → 团队规格收尾
```

图为依赖/职责示意，不是强制所有变更走相同线性阶段；规格收尾位置按 in-change/after-merge 策略。上游确认输入可复用，但不省略所需契约。Comet Supervisor 是否启用按开发子图复杂度选择。

- TeamAI 只派发 development 一次，持有 backend_run_ref 和输入摘要，不调度同一子图叶子。
- Comet 负责子图内的依赖与恢复约束；实际派发可能由其宿主协调入口/Agent 完成，必须验证，不能把 Runtime 文档当作现成远程 scheduler API。
- Planner 产生 DAG 建议；Comet 校验/接纳后，只有 Comet 的执行图是开发调度权威。外层保留输入摘要与引用，不维护第二个可写叶子状态副本。
- 开发 Whitebox 只在 Comet 独立验证位置运行一次。TeamAI 后续 Gate 核对其可信回执，不再无条件启动第二套同范围验收。部署后验证属于新环境义务，应按 Release/TestContract 另运行。

## 4. 技能入口的接线

| 角色/技能 | 谁启动 | 输入 | 允许输出 | 结果由谁接收 |
| --- | --- | --- | --- | --- |
| 澄清/架构方法 | TeamAI 步骤的 Runner/Driver | 用户目标、已有 spec/ADR、授权知识 | proposal/design/AC/风险草案 | 制品确认/Gate；外层仅接收可追踪回执 |
| test-authoring（设计） | 外层准备步骤的 Runner/Driver | 冻结 AC/设计、项目测试框架 | TestContract、case/oracle、测试代码/fixture、自检 | 契约 Gate，然后 planner/开发子图 |
| planner | 外层计划步骤的 Runner/Driver | 已确认基线、TestContract、能力与资源范围 | PlanBundle、DAG、文件归属、验收引用 | Comet 接纳；planner 不派发/监督/归档 |
| test-authoring（开发切片补测试） | Comet 子图的受管测试作者执行 | case 意图、当前候选、准入范围 | 测试/fixture、自检，不改产品代码 | Builder 与后续独立验收；改 oracle 需回上游 |
| Builder/TDD 方法 | Comet 子图驱动 | 任务、冻结契约、允许路径 | 产品实现、允许范围内测试、RED/GREEN 证据、候选 | Comet 候选提交位置 |
| whitebox-verify | Comet 独立 Verifier 执行 | 冻结候选、测试契约、环境、所需能力 | 原始证据、逐项结论、结构化 findings | Comet 验证回执适配，再由 SDD Gate 核对 |
| Spec lifecycle 方法/工具 | 单独授权的 Spec Adapter | 当前团队规格基线、有效验收、收尾策略 | archive/sync/读回结果 | 外层记录 closeout 回执，非 planner 执行 |

技能是方法，文件存在不等于执行成功。Runner 必须传入实际 SKILL 路径/版本摘要、角色输入与允许路径，并观察真实产物/执行结果。若技能自带旧 controller，就不能直接全量运行再声称它只是方法；需兼容边界与负例验收，不改 vendored 正文绕过治理。

TeamAI local prompt 被文档限定为只读，适合阅读分析/评审；产品/设计/测试/计划步骤只要要写仓库，也必须通过经验证的受管 command/external 执行路径，或者让只读步骤输出结构化草案、由受控制品写入器校验后落盘。此处两种方式尚未选定/试跑，不编造现成配置键。

## 5. 状态的唯一 owner

| 事实 | 唯一 owner | 其他组件保存什么 |
| --- | --- | --- |
| 外层步骤 lease/attempt/revision/HITL | TeamAI workflow backend | 外层 run/step 引用 |
| 开发子任务、工作区、Builder/Verifier、候选与迭代 | Comet | 外层保存唯一 run/candidate 绑定与回执摘要 |
| Agent OS 进程/作业当前状态 | Runner/Driver | 本次 invocation 的观察结果，关联两层 run/attempt |
| 业务约束与实施清单 | Git/OpenSpec | 冻结输入引用；tasks 勾选须附证据 |
| 验收可否放行 | SDD Gate（开发内同时满足 Comet 原生验证约束） | 输入摘要、依据和结果引用；禁止接受任意 pass 字段 |
| 平台检查/构建/部署 | Git/CI/Registry/目标环境 | 原平台 run、SHA、digest 与读回回执 |

状态投影可以显示“开发中”，但 UI/Gate/LLMWiki 不能再次推进内层阶段。Comet passed 只是其原生验收事实，团队 Gate 仍要检查所需 TestContract、来源和环境义务；二者任一未满足均阻断。

## 6. 恢复与取消的责任

| 故障 | 首要恢复者 | 必须行动 |
| --- | --- | --- |
| 产品/设计/测试/计划 Agent 崩溃 | 外层 Runner/TeamAI | 读外层 attempt 和实际产物，重验后续接/重试，不凭文件存在报成功 |
| Comet 内 Builder/Verifier 崩溃 | Comet 子图驱动 | 保持同一 run/worktree，核对候选/执行引用，再恢复内层，不重开整子图 |
| TeamAI 驱动失联、Comet 已运行 | 外层适配器 | 按关联 ID 读回原 Comet run；保持 pending/blocked，不能再次创建 |
| Comet 验收失败 | Comet 与对应责任角色 | 产品缺陷内层修复；测试意图/需求变更上报外层重新冻结，旧回执失效 |
| 两层输入版本不同 | 适配器/Gate | 阻断；显式重计划/新 revision，不能“同步一下状态”消除差异 |
| CI/CD 结果未知 | CI 适配器 | 查原平台 job/deployment，未知保持未知，不重复发布 |
| 人取消外层 run | 外层 Runner/适配器 | 下传取消到绑定内层与实际进程，并独立确认，未停止不得显示已完全停止 |

取消、超时、失联不是相同事实。租约超时并不证明旧 Agent 已停止；旧结果必须 fencing/attempt 检查，无法阻止旧工作区写入时保留能力边界。

## 7. 两个待验证的承重接口

1. Native Comet 默认使用自己的 brief/spec/docs/comet 工件，不是现成的 OpenSpec 执行 adapter。团队 OpenSpec 输入应冻结成可追踪的派生快照，保留 AC 映射和摘要；Comet 不能反写团队需求或另造无约束测试意图。若无法证明继承前置 Gate 和团队测试义务，停止接入。
2. Comet 内部 Archive 与团队 OpenSpec closeout 必须范围隔离：前者仅收尾开发后端工件，后者由 Spec Adapter 唯一写团队主 specs。若无法配置隔离或出现重复归档，NO-GO；不能未经验证就宣称组合成立。

同样，Whitebox 能否作为 Comet 的独立验证执行接入且保留其来源/身份检查，必须实际验证。缺该接口时停止接入，不能伪造 Comet pass 或绕过独立性。

## 8. 当前要 Grill 的决策

R01 未决：首期驱动运行在哪。建议单个 CI/受管 Runner 做外层 driver，IDE/聊天只提交与查看；无需先建分布式 scheduler。也可选成员本机手工 resume，但必须接受关闭驱动后流程暂停的边界。

R02 未决：冻结 OpenSpec/TestContract 到 Comet 的导入映射和失败重计划协议。
R03 未决：内层 Whitebox 唯一验证位置与外层 Gate 义务的分工。
R04 未决：运行取消/租约超时、重启后作业归属以及最大恢复/重试预算。
R05 未决：现有技能 controller 的兼容/升级方式，单一 closeout owner。

按顺序一次确认一个问题。以上均为目标方案，不是新架构全票通过或上游已集成的声明。

## 来源

- [TeamAI workflow 固定文档](https://github.com/Tencent/teamai-cli/blob/8dc60b082f60ed19a735fde6839ffddb59ec5b4b/docs/guide/workflow.md)
- [Comet 固定 README](https://github.com/rpamis/comet/blob/575ab0d172e8105257b3c9172b8c8a9b628960ca/README-zh.md)

本轮通过只读 HTTP 获取上述固定源码文档，并核对本地技能。仅文档变更，git diff --check 为窄静态验证；未试跑实际安装产物、driver、恢复或进程取消。

## 9. 与知识更新的事件衔接

目标设计 delivery-architecture.md §6.5 定义了产品确认、ADR、实验证据、独立验收、合并/CI、closeout、发布/事故、晋升批准、源版本/权限变化九类触发。Comet 输出开发回执；TeamAI 外层安排知识维护角色处理候选。原始证据不搬进 wiki，Outline 正式条目只在审查授权后发布；Code Graph/DeepWiki 跟随精确已验证 commit 刷新，独立于精华知识晋升。

此处不是声明 TeamAI 已具备所有 webhook/queue 连接器；事件获取、去重、作业恢复和发布后读回仍需实现验证。R01 驱动位置、G04 正式知识准入 owner 均未被替用户决定。

## 10. 知识门禁的补充审视

用户指出只有触发事件不足以保证执行。架构 §6.6 增加 KG0 影响判断、KG1 项目知识闭合、KG2 团队发布闭合、KG3 集成代码 Wiki 新鲜度四个拟议 gate，明确失败阻断的位置和必需性冻结。每次必做适用性判断，不强制每次都制造知识页。

通过只读 HTTP 核对固定 Comet 源码：native-check-executor.ts 的 NativeCheckPlan、executeNativeCheck；native-portable-checks.ts 的执行计划、回执与 retry。可复用命令检查机制，但仍未证明任意阶段可配置扩展、KG 必不可省、实际归档阻断或知识 MCP 接线。不能将这些 KG 当现有 Comet 内置能力。

拟议责任：Comet 承载开发内硬检查，检查器只读核验知识写入与来源，知识维护执行负责写入；外层及合并后 Gate 归 TeamAI/受保护 CI。这样不新建知识调度状态机。R06 待确认：团队知识发布何时为交付硬前提，何时只阻断知识 closeout。

本轮仅设计文档变更，git diff --check 为静态检查。未运行或安装 Comet/知识系统，未修改 vendored/上游源码。

## 11. 从控制权重新 Grill（优先于先前工具组合建议）

### 根问题

用户已经明确需要硬门禁和流程闭环。不能再用“要不要检查”作待决问题。真正待定的是：人确认目标和关键风险后，系统是否应自动推进剩余工作；还是由人逐阶段手动启动。自动化范围决定主控应负责什么。

最小交付闭环由六类对象组成：

1. 目标/义务：稳定的目标、适用场景、必须满足的行为和收尾要求。
2. 执行节点：角色、输入版本、允许动作、产物、超时/预算。
3. 检查：明确检查器、来源、候选/版本与失败结果；语义审查和结构检查分开。
4. 推进规则：唯一状态推进入口，只在前置证据有效且必要授权满足时放行。
5. 恢复：当前执行身份、原始副作用关联、重试/取消规则和返回责任方。
6. 完成边界：代码验收、主规格收尾、必需知识、集成/目标环境等义务分别核对后组合判定。

工具选择应从这些职责反推，不能按每个现有工具各分一个阶段来证明其必需。

### Comet 的本质价值与限制

Comet 候选价值是给长程 Agent 任务提供持久化控制：工作区绑定、当前阶段/允许动作、候选/执行身份、运行检查、独立验证、返修与恢复。Agent/技能生产结果；Runtime 约束结果何时能被接纳与任务何时能推进。

若我们仅需要分发 skills/MCP 或写文档，Comet 不是必需。若我们自己完整实现上述运行控制，再接一个同范围 Comet，必须证明增益，否则属于重复建设。若使用 Comet，就应该复用其真实控制机制，而非只启动 /comet Skill 再由另一个 controller 任意改状态。

Comet 官方 Native 路径覆盖开发任务的需求确认、实现、验证和归档；它是否能承载本团队完整产品/架构/测试契约、知识门禁和 CI/CD，需要实证。不能从“能跑命令检查”推导“是任意阶段通用工作流引擎”。

### 重新排列候选

- 候选 S：单一交付主控。TeamAI 先只分发资产，主控由满足要求的运行时承载（Comet 是优先验证候选，不先断言能覆盖全生命周期）。技能和 Gate 都是其调用对象；CI/CD 保留平台执行权。
- 候选 N：TeamAI 管真正独立的外层交付图，Comet 管开发子图。只有外层确实需要独立生命周期且两者具备稳定、可恢复、可取消的契约时采用。不能仅因两者都有 workflow 就默认嵌套。
- 候选 T：TeamAI 工作流直接协调受管 Agent，不引入 Comet。必须补齐并实证候选绑定、独立验证、worktree/集成和恢复要求；若补齐相当于重做 Comet，则不应只为减少工具数选择它。

三者尚未裁决。优先最小的单主控方案，保留必要的规范/证据/知识适配；适配不应演变为另一套阶段状态机。上游能力不足时记录明确缺口再决定改造或替换，不增加一层主控掩盖。

### 知识流程的本质

知识义务与测试、规格义务同样由主控安排执行，独立检查器判定结果。LLMWiki/Outline/DeepWiki 是产物服务，不掌握本次交付推进权；知识维护 Agent 是执行角色，不是 scheduler。必需知识未闭合时主控阻断对应完成动作；新增经验不是每次必有，适用性与现有知识失效检查仍须执行。

### 第一问

R00（先于 R01 机器部署位置）：目标确认后是否默认自动推进，只有业务/风险决策或不可自动恢复阻塞才找人？建议是；机械阶段检查由 Runtime 执行，正常情况下不逐阶段人工点下一步。该项仍待用户确认，不把建议写为决定。

本次没有修改运行代码或批准任一拓扑；仅记录根本审视与候选，避免把前面的设计推演当成已接受决策。

R00 后续答复：用户已选择 A。旧双层候选 N 不再是本轮实施方向；R07 最小受控扩展范围待答。

## 12. 需求与架构分离的明确约束

用户纠正：需求澄清与架构必须独立，禁止合并到目标确认。分别产出 ProductBaseline 和 DesignBaseline、分别过门禁；技术可行性触发的范围变更必须回需求 owner，不静默改 AC。自动推进原则保留，独立环节不等于人工逐阶段审批或增加主控。已同步主架构 §3 与单主控审视。

## 13. 测试设计门必须保留

用户明确测试用例重要，测试设计需要门禁。T 是独立、不可省略的前置义务；风险裁剪只调深度，不直接取消或降为结构检查。与 Build 测试质量、Verify 独立产品验收分别判断。独立自动审查为建议实现，架构门审查策略仍待收敛。

## 14. A/T 独立自动审查与运行时接纳

R08 用户选择 A 已确认，架构与测试设计都独立自动审查。共用推进规则、身份/版本回执、事务接纳、固定返工和证据失效见 classic-gate-runtime-contract.md；R09 保守失效策略待确认。全部仍属设计，未运行实现验收。

## 15. R09 与架构方法确认

用户确认首版保守失效，需求/设计变更使全部下游证据对新版本失效；架构 A 必须 grill-me 加独立全票共识。关闭顺序 R06 的具体提案与 Ponytail hook 只读核对见 classic-closeout-and-hook-contract.md；没有执行当前外部评审或更改 hook。

## 16. R06 已确认与归档后恢复

用户采用知识/规格/整体关闭边界。归档后同 Run 继续 Outline、复用 pending archived delivery、操作去重和模块修改见 classic-post-archive-recovery.md。R10 是否整体完成前保留工作区待确认；原生实现和远端幂等仍待实证。

## 17. R01 已确认固定受管 Runner

用户选 A：首期固定受管 Runner 驱动 Comet，同一 Run 绑定一份权威状态；成员端只提交、查看和请求恢复，不独立恢复本机副本。Runner 不维护另一套业务阶段，仍只驱动 Comet。G04 的 Outline 正式发布审核责任待收敛。

## 18. G04 预授权内自动发布

用户确认预授权内独立审查后自动发布，超范围/敏感交人。knowledge-preauthorization-contract.md 定义签发身份、源用途与权限、内容版本、有效受众和防自批；检查器消费授权，不新增审批主控。G13 首期受管资料/空间范围待确认，实际权限与撤权尚未实证。
