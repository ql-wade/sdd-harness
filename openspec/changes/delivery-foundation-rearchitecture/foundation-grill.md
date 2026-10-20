# 原架构基础设施与知识层 Grill

日期：2026-10-19。状态：REVISE，访谈进行中；不批准迁移、不修改实现。
基线：master / c42d3ce，叠加本变更的架构文档草案。旧文档中历史用户裁决保留，但不能替代当前需求与运行验证。

## 已确认与待决

- G01 已确认：首期服务团队研发知识，跨项目共享，按项目/成员控制访问。
- G02 已确认：项目资料继承 Git/飞书源权限；跨项目共享内容单独审核发布。派生页、引用、向量和缓存须携带来源/授权边界；摘要不自动扩大受众。
- G03 已确认边界：Code Graph、架构文档、代码 Wiki、精华知识库分别管理。禁止将 Git 代码全量灌入知识库；DeepWiki 可承接代码 Wiki。首期其他资料来源清单尚未全部确认。
- G13 已确认 A：首期自动发布只覆盖登记、权限可核验的资料域和专用受管 Outline 文集；源/目标实际 ID 尚待试点登记。
- G04 已确认 A：预授权内独立审查通过后自动发布，超范围/敏感交有权人；具体签发主体、源实例与目标 ID 尚待登记。
- G11 已确认首期组合：LLMWiki 承担 Agent 本地单项目知识，Outline 承担团队精华 Wiki，DeepWiki 承担代码 Wiki；GBrain 不进入首期。Code Graph 与架构文档保持独立。选择不等于安装/权限/运行已验证。
- R01 已确认 A：首期固定受管 Runner 驱动同一 Comet Run，成员端不独立另起或恢复该 Run。
- R00 已确认 A：目标确认后自动推进，TeamAI 首期只分发，Comet 作为唯一交付主控候选；其能力尚未通过本团队实证。详见 comet-single-controller-review.md。
- G12 已确认：代码 Wiki 采用自托管 deepwiki-open，选型确定，发行版本/接入/权限仍未验证。
- 旧“零服务端”不是本轮已确认约束；不以该假设排除共享后端。
- 自建必须分开表达：自托管开源系统、定制团队适配、从零开发底层内核，三者成本和责任不同。

## 0. 四类对象的明确边界（G03）

| 对象 | 回答的问题 | 事实源与写入者 | 定位与准入 |
| --- | --- | --- | --- |
| Code Graph | 定义在哪、谁调用、依赖与影响面是什么 | 指定 revision/worktree 源码；解析器生成 | 工程索引，不是知识库内容；保留版本/覆盖与新鲜度 |
| 架构文档 | 预期边界是什么、为何选择此设计 | 经审查的项目 docs/ADR/契约；架构 owner | 项目设计权威，不因入知识库再维护一份副本；与代码一致性另验 |
| 代码 Wiki | 当前代码如何运作，如何阅读模块 | 指定源码版本的派生解释；DeepWiki 可承接 | 可再生代码说明，与规范性架构文档区分；不自动视为已审查架构 |
| 精华知识库 | 什么经验值得复用，适用条件与证据是什么 | 独立知识条目及来源引用；准入 owner 待定 | 只收提炼的知识财富，不全量入库代码、代码 Wiki 或原文档 |

允许的联系是带版本和权限的引用。源码→Code Graph/代码 Wiki 是工程派生；架构文档、复盘、代码 Wiki 等→候选知识→审核晋升是知识加工，两条链不得等同。准入机制和审批者尚待 G04 决策。

知识条目的建议字段（待确认）：具体问题、适用条件、结论/方法、失败边界、来源与验证、owner/状态、复查条件。跨项目条目要区分可复用方法与受限的项目实例；不能仅删除项目名就扩大授权。

## 1. 从问题划分能力，不从产品名叠系统

| 能力 | 目的/要回答的问题 | 主要数据 | 推荐事实源 | 自建边界（建议，未裁决） |
| --- | --- | --- | --- | --- |
| 项目约定与规格 | 这次要做什么、哪些约束有效 | AGENTS、ADR、OpenSpec、接口定义 | Git 审查版本 | 自建格式约束/一致性检查，不另造文档数据库 |
| 团队资产分发 | 每人是否拿到同一套规则、技能、工具版本 | skills/hooks/MCP/workflow 清单 | Foundation Git release | 复用 TeamAI，定制 exporter、版本锁和兼容探针 |
| 代码结构检索 | 定义在哪里、谁调用、改动可能影响谁 | 符号/调用/导入/继承边 | 对应 commit/worktree 的源码 | 复用解析索引引擎，自建项目/版本/权限适配和质量评测 |
| 团队策展知识 | 为什么这样设计、过去踩过什么坑 | 解释、决策、故障复盘、FAQ | 经确认的知识条目及来源版本 | 选一种主策展后端；自建准入/审核/来源契约 |
| 原始资料接入 | 哪些资料值得提炼、如何保留证据 | 经选择的文档/纪要/复盘引用、源 ACL；镜像需求另定 | 原平台/受控原件，必要快照有来源 | 自建候选选取/权限/来源适配；不默认全量归档原文 |
| 知识生成和维护 | 哪些总结过时、矛盾或无引用 | 派生页、引用、有效期、冲突 | 条目生命周期和原文引用 | 复用编译/lint 工具，自建质量 oracle/审核策略 |
| 知识问答与浏览 | 人和 Agent 如何找到可信解释 | 授权范围内检索与引文 | 共享知识服务，展示是派生结果 | 自托管 UI/MCP；不同时维护多份真身 |
| 长期/会话记忆 | 哪些经验应沉淀，哪些仅属个人或本次任务 | 偏好、会话摘要、团队经验 | 个人/项目/团队命名空间分别定义 | 首期不能默认全量会话入团队库 |
| 交付证据与审批 | 某候选是否真的通过、谁授权发布 | 原始执行记录、Gate/ReleaseReceipt | 可信 Runner/平台/审批账本 | 自建团队契约与判定，不能让 wiki 替代可信证据 |
| 权限与审计 | 谁能检索、总结、导出及撤销 | 身份、资源、ACL、访问和变更记录 | 源身份/权限系统及明确的派生授权 | 复用 IAM，定制资源映射与贯通验证，不自研密码学/SSO |

代码图谱的“事实”也有语言覆盖、动态调用、解析失败、新鲜度边界；不能单凭图谱决定完整回归分母。知识总结回答“为什么”，不能取代源码结构。wiki 页面与证据回执不能因为都能存 Markdown 就合为一个可信对象。

## 2. 旧组件逐项部署与复用判断

| 旧组件 | 当前仓库证据 | 本机/CI 职责 | 服务端职责 | 结论 |
| --- | --- | --- | --- | --- |
| LLMWiki | tools/mcp/llmwiki.sh、bootstrap pin、lib/knowledge-seed.js、wiki CLI；有接线代码，未在本轮运行 | 单 workspace 资料/策展工具、可选缓存 | 如选择 hosted 形态，需认证、持久化、备份及项目隔离实证 | 候选后端，不能用注册 ready 推断团队服务完成 |
| obsidian-wiki | 仅旧计划引用；未见本仓库安装/适配实现 | Markdown vault 编译/lint 方法 | 上游另提供可选 HTTP/MCP 服务；token 认证不等于成员/项目 ACL | 与 LLMWiki 的策展重叠，先选唯一 owner 再决定是否保留为工具 |
| GBrain | 旧计划 planned，无接入实现 | 上游文档提供 PGLite 本地形态 | PostgreSQL 共享形态与 MCP 是团队候选，ACL/撤权须实测 | 解除旧排除理由，不直接选定 |
| TeamAI teamwiki/recall | ADR-0018 提议；teamai.yaml/teamwiki 未落地 | 资产分发、自动知识/索引的候选 | 不能从“能分发”推导中央检索/权限/持续调度 | 与 CodeGraph 需同题比较，不默认双图谱 |
| CodeGraph | 新迁移参考；本仓库无落地 | 本地 SQLite 图谱，适合未提交改动 | 如做团队索引，CI 建各 commit 索引、服务统一鉴权路由是需另验的适配设计 | 不自研 AST/调用解析；本地与中央索引分版本，不共写一个库 |
| DeepWiki | 用户明确可承接代码 Wiki；本轮未验证运行 | 按源码 revision 生成解释作业 | 代码 Wiki 浏览/问答，必须受源码授权控制 | 代码 Wiki 后端候选；与精华知识库分开，不替代已审查架构 |
| 飞书桥 | 旧计划具名 jobs/scripts，实际 tools/bridge 不存在 | 本机仅开发与 fixture | 受管凭据的抽取/加工/发布任务，可由 CI 执行，不必单独常驻服务 | 关键集成需自建，平台客户端复用；优先只读接入评估 |
| Gate/证据 | lib gate/audit 已存在；团队来源准入仍为目标 | 生产与上传原始材料、自检 | 团队共享可信准入/审批/审计、受保护 CI 重验 | 与知识服务分逻辑所有权，即使首期同部署也不混权限 |

自托管不等于重新实现。SQLite/PGLite 是存储形态，不决定进程是否常驻；MCP 是协议，不决定远程/本地或权限模型；CI job 是服务端任务，不必等于一个新 Server。

## 3. 原架构现实核验与问题

| ID/等级 | 事实与定位 | 影响 | 最小处理方向 |
| --- | --- | --- | --- |
| K01/P1 | knowledge-architecture.md:14–23 用零服务端排除 GBrain，却纳入 DeepWiki 和服务层桥 | 选型标准互相冲突，且不满足 G01 的共享/权限目标 | 明确允许哪些共享设施，以实际需求做准入 |
| K02/P1 | knowledge-architecture.md:26 声称知识全在 Git；.gitignore:42–43 忽略 llmwiki；lib/sdd-paths.js:28–33 默认库在 repo 外 | Git 不能证明已备份项目知识/审计状态 | 每类数据分别指定事实源、备份与恢复 oracle |
| K03/P1 | tools/mcp/llmwiki.sh:18–20 指向 project/llmwiki；lib/sdd-paths.js:28–33 的 init/ingest 使用另一共享路径 | CLI 与 MCP 可能看两份库，worktree 还会分叉 | 只认一个 workspace identity/path resolver；后续真实写/查读回验证 |
| K04/P1 | lib/knowledge-seed.js:7–10 声明仅 MCP 写索引；bin/cli.js:383–393、405–414 要求直接 Write；ptyClaude 使用 skip-permissions | 写入政策与执行链不一致，索引/保护及输入安全不能靠文档保证 | 后续确定写入 API 和可信边界；不在本轮修改实现 |
| K05/P1 | 旧知识计划 §4 具名 bridge/publish/deepwiki gates 与 fixture，文件树中未找到实现 | “定稿”和逐项文档闭合不代表门禁能执行 | 逐项标为文档声明、代码未证明，不继承 ready |
| K06/P1 | T1 LLMWiki、T3 vault 都做 sources→概念/实体/解释；DeepWiki 另生成解释页 | 相同结论多处写、重复检索和纠错，缺更新/撤回传播 owner | 一条事实一个权威对象；产品可以多接口但不多真身 |
| K07/P1 | 旧计划认为源 ACL 缩小后可通过清 Git 历史/缩小 repo 权限处置 | 已 clone 的副本无法靠服务端改 Git 完全回收；派生摘要/向量/缓存也需撤权 | 明确未来读取禁入与已下载内容限制，验证全检索链权限 |
| K09/P1 | pinned LLMWiki mcp/local_server.py:1–3、21、102–112 是单 workspace stdio，调用者身份由本地环境 user ID 提供 | 现有接入不是按成员认证的团队服务；不能直接共享该进程就满足 G01/G02 | 团队后端须独立验证用户认证、项目授权、来源 ACL 与负向检索 |
| K08/P2 | 旧计划以 15 人、stars、自报质量和固定月成本做升级依据 | 与资料敏感性、并发、维护和质量需求不直接对应 | 用项目数/权限差异/真实题库/时效/运营预算决定形态 |

以上 K03/K04 为静态代码冲突，不宣称本轮已复现运行故障。P1 未解决前 verdict 为 REVISE，不批准原知识拓扑直接迁移。

## 4. 当前建议的部署逻辑（待其余 Grill）

- 本机：宿主、项目工作区、CLI、已授权代码索引、临时观察和测试；缓存带身份/权限版本/代码 revision。
- CI/后台任务：受管凭据获取原资料、转换/索引/重建、知识草稿、验证和发布；任务可合并运行，不按组件拆 Server。
- 共享知识边界：统一身份、项目空间/跨项目公共区、权限过滤、检索/引用、草稿审核、撤回、审计和备份。
- 共享交付边界：Gate/审批与证据；知识问答不能直接签发交付通过。
- 公共基础设施：复用 Git、IAM、PostgreSQL/对象存储、CI/Registry；具体已有资源尚未盘点。

这只是逻辑边界，不等于已经决定两个自研服务。可以先复用一个知识后端及现有 CI，团队适配保持薄层；部署单元数量需结合 G02 后的需求。

## 5. Grill 决策树与闭合条件

| 顺序 | 问题 | 当前状态 | 影响的设计 |
| --- | --- | --- | --- |
| G01 | 首期单项目/团队研发/全公司 | 已确认团队研发，跨项目，项目/成员权限 | 需要共享鉴权入口 |
| G02 | 权限继承源系统或独立维护 | 已确认继承源权限，共享内容单独审核 | 身份映射、接入器、隔离策略 |
| G03 | 代码结构、架构、代码 Wiki 与精华知识的边界 | 已确认四类分离；不全量代码入知识库；其他来源待细化 | 拆开工程索引/代码解释与精华入库 |
| G04 | 精华知识正式发布审核 | 已确认预授权内独立审查后自动发布，超范围/敏感交有权人 | 签发和核验细化见 knowledge-preauthorization-contract.md |
| G05 | 精华库需要人类 UI、Agent 检索还是两者；常见问题 | 未问；DeepWiki 已定位代码 Wiki | 查询接口和质量评价 |
| G06 | CodeGraph 语言/仓库/规模、未提交代码、跨仓调用需求 | 未问 | 本机与 CI 版本索引，是否中央服务 |
| G07 | 自动记忆的允许范围、个人与团队分离 | 未问 | 会话捕获和公共晋升边界 |
| G08 | 新鲜度、撤权/删除时限、离线缓存容忍 | 未问 | 增量同步、失效传播、在线校验 |
| G09 | 已有服务、部署资源、人数/并发、维护 owner 与预算 | 未问 | 自托管/复用、部署单元与运维 |
| G10 | 同题验收、恢复、上线与替换条件 | 未问 | 选型短名单、试点 NO-GO 与最终 ADR |

不把十题一次抛给用户。代码能回答的先查；每次只追问会改变方案的一个节点。收敛后更新目标架构/ADR/spec；在此之前原迁移方案不得视为已获最终批准。

## 6. 上游来源与证明范围

本轮另通过只读 HTTP 获取了仓库 pin 的 local_server.py，确认 stdio/单 workspace 和本地身份回调；没有启动它。其余以下为官方文档声明，均未在本环境安装实测，浮动上游不等于本仓库 pinned 版本：

- [GBrain](https://github.com/garrytan/gbrain#architecture)：本地 PGLite 与共享 PostgreSQL；关键词检索可无模型 key，语义/综合能力另有配置。
- [GBrain 数据权威](https://github.com/garrytan/gbrain/blob/master/docs/architecture/system-of-record.md)：文件可重建部分索引，但数据库专属记录、撤回和操作状态需要另行备份。
- [LLMWiki](https://github.com/lucasastorian/llmwiki#architecture)：当前文档区分本地文件/SQLite 与 hosted PostgreSQL/S3；本仓库 pin 仍为 075c5b4996ff4e07f9d3c57c1f14fd2b54a955db，不能套用新版本行为。
- [obsidian-wiki 部署](https://github.com/Ar9av/obsidian-wiki/blob/main/docs/deployment.md)：有可选服务；必须另验项目/成员授权。
- [CodeGraph](https://github.com/colbymchenry/codegraph#architecture)：本地源码解析和 SQLite 图谱；中央索引是适配设想，非已有服务证明。
- [DeepWiki](https://github.com/AsyncFuncAI/deepwiki-open)：代码解释与浏览消费面，未证明本团队权限与当前实例运行。

本轮验证：源文件/目录存在性、路径和写入链静态核对、官方文档读取。没有运行服务、没有新实现或生产配置修改；因此不运行实现测试，也不把历史测试状态作为本轮服务可用证据。

- [LLMWiki pinned local server](https://github.com/lucasastorian/llmwiki/blob/075c5b4996ff4e07f9d3c57c1f14fd2b54a955db/mcp/local_server.py)：本轮实际读取。

## 7. 候选比较记录（已由 G11 的首期组合收敛）

现有 LLMWiki 接入定位：本地单 workspace 工具，可独立保留或停用，不能自动升级为团队共享主库。上游 README 确实有 remote/self-hosted 和组织愿景；这不足以证明源 ACL 继承、成员协作、审核晋升、审计和撤回满足当前要求。因此不能断言该项目绝不支持团队，但当前接入不应承担团队主库。

短名单按主责分两类，不默认同时引入：

- [GBrain](https://github.com/garrytan/gbrain)：Agent 优先的记忆/知识引擎候选；共享授权有 source/operation/visibility 边界，上游明确本地文件和共享 DB 凭据不是同一隔离边界。尚未证明 Git/飞书 ACL 自动继承与人审发布体验，需固定版本实测。
- [Outline](https://github.com/outline/outline)：人和 Agent 共用的团队知识管理候选；官方内置 Streamable HTTP MCP（/mcp），支持搜索、读取、创建、编辑，OAuth 或 API key 接入；也有 Collections、成员/组权限和 API。无需因 Agent 接入而另建第三方 MCP。原系统 ACL 映射和精华知识审核流程仍需适配，不能把自有权限机制等同源权限继承。社区/商业版能力与许可证需按需求核对。

选型不能以“GBrain 给 Agent、Outline 给人”二分；Outline 官方已支持两类入口。后续比较以知识治理、自动维护/综合、源权限继承、审阅晋升和撤回闭环为准。优先验证单一主库能否覆盖需求，只有证据证明存在独立缺口才考虑第二引擎。

本轮仅读取官方项目/API/权限文档并更新本工作稿，没有安装或运行候选项目。

补充来源：[LLMWiki README](https://github.com/lucasastorian/llmwiki)、[GBrain sharing boundaries](https://github.com/garrytan/gbrain#choose-your-setup)、[Outline Collections](https://docs.getoutline.com/s/guide/doc/collections-l9o3LD22sV)、[Outline API](https://docs.getoutline.com/s/guide/doc/api-1rEIXDfLF6)。

Outline MCP 核对来源：[官方 MCP 文档](https://docs.getoutline.com/s/guide/doc/mcp-6j9jtENNKL)。本轮仅文档核对，尚未实测 MCP 身份/权限、读写和撤权。

## 8. 首期知识栈与 MCP 关联（G11）

用户确定的职责组合：本地 LLMWiki / 团队 Outline / 代码 DeepWiki；不再引入 GBrain。其记忆、检索与综合功能在本轮没有独立的必需需求，不为未来可能性增加第二个团队知识主库。

| 组件 | 部署与权威范围 | Agent 接入 | 不承担的职责 |
| --- | --- | --- | --- |
| LLMWiki | 本机单项目，Agent 提炼的项目知识；临时经验可先草稿 | 现有 stdio MCP 接线，统一路径问题仍待修复实证 | 不成为团队主库，不镜像 Outline 全库，不替代 docs/ADR |
| Outline | 团队共享服务；项目空间与审核后公共知识 | 官方 /mcp，逐成员 OAuth 或经约束服务身份 | 不收全量代码，不自动信任本地笔记/代码 Wiki |
| DeepWiki | 代码版本绑定的派生说明；用户已确认选择 self-hosted deepwiki-open | 需核对该自托管发行版本 API/MCP；缺原生 MCP 时仅考虑薄适配 | 不写项目架构权威、不做精华知识主库 |
| Code Graph | 每 revision/worktree 的源码结构索引 | 选定实现的 CLI/MCP，待认证 | 不与代码 Wiki/知识页混为同一数据 |
| 项目 docs/ADR | Git 审查后的设计/决策权威 | 原生文件/Git 读取及带版本引用 | 不全量复制到各知识主库 |

MCP 是 Agent 的统一工具协议，不是三系统的自动同步/权限继承/关系数据库。先在宿主直接注册各入口，无证据不新增统一网关、知识总线或 MCP-to-MCP 服务互调。TeamAI 可分发配置描述，成员凭据仍由各宿主和授权系统管理，不进团队 Git。

关联使用 project_id、稳定资源 ID/URL、源 revision/digest、owner、来源权限与生命周期；Agent 从多个入口检索后按来源引用组合回答。源码引用和派生页只作带版本关联，不把全部内容再灌入知识库。

流转建议（准入审批人尚待 G04）：项目实践→LLMWiki 候选；经提炼、审核与授权才进入 Outline 正式条目。晋升后团队条目由 Outline 唯一维护，本地只保留链接/来源和晋升状态。无需双向全文同步；项目仍需保留有价值的上下文与限定条件。代码实现解释进入 DeepWiki；从中发现的可复用方法也必须单独提炼审核再晋升。

源 ACL 变化必须影响派生内容的后续读取。Agent 身份不能统一借用管理员 token，缓存和跨库回答也不能扩大可见范围。跨项目分享的授权按 G02 另行记录；MCP 连接成功不算该义务通过。

产品边界：Devin 官方 public DeepWiki MCP 是公开仓库入口；不能把它当作 self-hosted deepwiki-open 的接口，也不能推断它能访问本团队私有仓库。后者所用发行版本的真实接口和权限需单独确认。

依据：[Outline MCP](https://docs.getoutline.com/s/guide/doc/mcp-6j9jtENNKL)、[Devin DeepWiki MCP](https://docs.devin.ai/work-with-devin/deepwiki-mcp)、[deepwiki-open](https://github.com/AsyncFuncAI/deepwiki-open)。本次只更新设计，未注册新 MCP、安装服务或删除旧接线。

## 9. 规范、经验与许可核对

- OpenSpec 规范/变更权威与 LLMWiki 项目经验层的边界已写入 delivery-architecture.md §6.2。已接受 specs 长期保留；不将 OpenSpec 简化为临时任务，也不将 wiki 生成等同验收。
- 用户明确选择自托管 deepwiki-open，后续只验证该产品的固定版本与接口，不再把 Devin 公共 DeepWiki 作为同名默认替代。
- Outline 当前 main LICENSE 标注 Business Source License 1.1 / Outline 1.11.0，并明确该许可不是 Open Source license；本轮应以“源码可用、允许范围内自托管”表述，不能与 MIT/Apache 当下授权混同。许可文本对第三方商业 Document Service 的限制和所选版本的转换日期须分别核对。内部使用与对外托管服务不能合为一类授权。

核对来源：[Outline LICENSE](https://github.com/outline/outline/blob/main/LICENSE)、[OpenSpec](https://github.com/Fission-AI/OpenSpec)、本仓库 ADR-0007 与现有规范目录。仅文档更新与静态检查，没有新的实现测试或服务部署。

## 10. Agent 协作协议的边界细化

目标架构 §6.3 已新增：按角色的必读输入、OpenSpec/Git 主产物、LLMWiki 经验产物、交接条件；明确设计发现/证据/规范的路由与失败返回。它是待接线设计，不是已实现控制平面。

关键区别：规格义务与本次决策进入 Change；项目理解和经验进入 LLMWiki；源码/测试在工作区；原始证据在可信证据存储；执行状态归运行后端。交接使用冻结输入和当前候选，不能依赖知识页或聊天中的自报完成。

本轮仅增加文档协议；git diff --check 为窄静态检查，没有更改运行时代码，也没有新增运行验证结论。

## 11. 运行控制 Grill

TeamAI/Comet/Runner/技能的调度、状态、恢复、取消与交接边界单列在 [runtime-grill.md](runtime-grill.md)。R01 驱动位置尚待确认；本轮未将任一运行后端标记 ready。

## 12. 知识更新触发边界

已提出事件触发矩阵和去重/发布读回协议，见 delivery-architecture.md §6.5。当前属于建议，尚未接线。已有 G02 的跨项目审核授权继续有效；项目知识草稿/验证/正式发布的准入职责与维护 owner 仍待 G04 决策，不把建议标记为用户已确认。

本轮仅文档变更；git diff --check 为静态检查，未运行事件源、知识后台作业或 MCP 写入。
