> **2026-10-26收敛说明：** 本文为旧方案/研究记录；涉及六角色常驻、固定Runner镜像、私有Agent RPC/签发前置的指令已被ADR-0021覆盖。当前执行只读tasks.md、design.md及HANDOFF-EXECUTION-2026-10-26.md；本文仍有用的功能oracle/原始事实按新架构复用，不自动恢复旧部署。

# Comet 唯一主控可行性审视

日期：2026-10-19。结论：REVISE；可以作为唯一主控候选，不能认定原版直接满足全部硬门禁。

## 已确认的目标约束

- 目标确认后默认自动推进；人只处理关键业务/风险决策和无法自动恢复的阻塞。
- TeamAI 首期只分发规则/技能/hooks/MCP/策略，不参与本次任务调度。
- 需求澄清与架构独立：前者产出产品行为/范围/AC 基线，后者消费该基线产出设计/契约/ADR；各自门禁，均归同一主控。
- Comet 是唯一交付主控候选；检查器、技能、知识系统不持有平行阶段状态。
- OpenSpec 保持规范权威；LLMWiki 本地项目知识、Outline 团队精华、self-hosted deepwiki-open 代码 Wiki；Code Graph/docs/ADR 分别保有职责。

## 证据基线

本轮从公共 npm registry 读取 @rpamis/comet@0.4.5 的 metadata 与 tarball，计算 SHA-512 与发布 integrity 一致。version、gitHead、integrity 见 comet-package-baseline.json。未安装依赖、未执行发行包、未改用户配置。

实际发行包 gitHead 为 c90af44a4474662d7853aae76ce785404974fb0a；与前轮阅读的 575ab0d172e8105257b3c9172b8c8a9b628960ca 不同。下述逐文件静态证据来自发行包，不混用旧源码的测试结论。另通过只读 HTTP 读取 c90af44 的 classic-guard.ts 核对跳过分支。

## 模式比较

| 义务 | Classic：发行包静态证据 | Native：发行包/先前源码证据 | 判定 |
| --- | --- | --- | --- |
| OpenSpec 唯一规范 | comet-classic/SKILL.md 明确 OpenSpec 五阶段；classic-archive.js 通过 adapter 调用实际 archive | 正式 brief/完整规格和状态默认 docs/comet，自成体系 | 若 OpenSpec 强约束优先，Classic 的直接复用更值得先验证；不先强选 Native |
| 默认推进和人工决策 | 成功结果 agent.continuation、auto_transition；仍有 Open/Design/Archive 决策点 | continuation 驱动，Shape 与结果/交付确认保存用户选择 | A 不等于删除必要授权；已有效选择可复用，未授权决定必须停 |
| 真命令与旧证据失效 | classic-command-checks.js:480 起检查 runtime provenance、退出码、输入/环境/manifest/日志，拒绝手工 record-check 声明 | Native check 执行和候选/Verifier 身份有绑定 | 可复用基础，但需真实正反向运行认证 |
| 不绕过检查 | build-complete/verify-pass 调用 guard；但存在运维 escape 环境变量 | 有原生候选/检查/Verifier 控制，但尚未证明新政策是必需集合 | 原版不能直接被宣称满足本团队不可省略门禁 |
| 项目知识和团队发布硬门禁 | 技能提示 comet knowledge remember，但 guard 未见对 LLMWiki/Outline 回执的必要检查 | 自带 Project Knowledge/Personal Memory，同样不等于外部知识库闭合 | 需要受控接入、来源/权限/读回检查，不可用技能提示替代 |
| planner/test-authoring/whitebox | Classic 使用其内置技能与可选 Superpowers 策略 | Native 方法自主，原生独立 Verifier | 不存在已认证的三技能组合；需单控调用和实际产物/身份绑定验证 |
| 持续后台驱动 | 技能 continuation 由 Agent 接着执行 | 同样依赖宿主执行与进程生命期 | 有恢复状态不等于存在常驻调度服务；Runner 只驱动 Comet，不另建业务阶段 |

## 承重发现

### SC-01：成功命令不等于所要求的检查已完整执行（P1）

Classic guard 的 build/verify 使用 commandCheckPasses 核对该 scope 的命令回执。check-policy.json 的 argv/cwd/files/outputs/env 等字段主要用于输入/环境和复用绑定；本轮未发现、也未验证本团队必需检查集合强制注册的通用入口。

因此仅把知识检查器“加到建议命令”不够：必须证明正常推进、直接 transition、恢复和 archive 都不能用另一个无关的成功命令代替。需要固定、受保护的必需检查身份和有效性规则，不能让 Builder 自行决定有没有检查完。

定位：发行包 dist/domains/comet-classic/classic-guard.js:484–505、977–1038；classic-command-checks.js:480–590；classic-check-policy.js:5–30。

### SC-02：存在应与普通执行隔离的 escape 路径（P1）

发行包 classic-guard.js 的 commandCheckPasses 在 COMET_SKIP_BUILD=1 分支直接返回 status:0，调用它的不只 build，也包括 verify。classic-state-command.js:384 附近默认拒绝直接设 phase，但允许 COMET_FORCE_PHASE=1 的 repair-only escape。

这不是声明任意无权限攻击都能成功；但说明不能把同账号任意命令执行当作防绕过安全边界。生产使用必须确定受管身份/可信策略、限制普通 Agent 的运维逃生能力，并用受保护 CI 重验。仅写“禁止使用”提示不满足硬门禁目标。

源码复核：[classic-guard.ts @ npm gitHead](https://github.com/rpamis/comet/blob/c90af44a4474662d7853aae76ce785404974fb0a/domains/comet-classic/classic-guard.ts#L587)。本轮只读、未运行跳过演示。

### SC-03：Comet 自带项目记忆不能变成第四知识主库（P1）

发行包 assets/skills-zh/comet-classic/SKILL.md:35–37、comet-native/SKILL.md:24–28 与 reference/scripts.md 提示使用 comet knowledge remember。它不是已经完成的 LLMWiki/Outline 集成，也不证明入库已成为阶段硬前提。

需确定内置知识能力可否停用/只读引用/经受支持适配转接；若无法符合已确认知识栈，需要显式处理后再启用，不静默复制内容。

### SC-04：模式和方法不能叠加成多个 controller（P1）

Classic 内含 Open/Design/Build/Verify/Archive 技能，Native 有自身主入口。项目 planner 当前也带 Controller/集成协议；三者若全部照原样运行，会恢复重复调度/归档风险。必须选一个权威模式，技能适配只输出受控制品，不修改 vendored 正文偷渡约束。

## 单主控的目标接线

```text
TeamAI 分发经过冻结的资产
          ↓
一个 Comet run，唯一阶段/恢复权威
          ├─ 角色执行：产品/架构/test-authoring/planner/Builder
          ├─ 独立验证：Whitebox/Reviewer
          ├─ 知识维护：LLMWiki、经批准的 Outline 发布
          ├─ 代码 Wiki/图谱生成、平台 CI/CD 请求与读回
          └─ Spec 适配收尾
每个动作的结果 → 对应检查器 → Comet 转换条件
```

以上是目标接口，所选 Comet 模式未证明可以直接注册任意动作。检查器无派发权；Runner 不自行计算业务下一阶段；外部平台保有自身 job/部署事实，Comet 关联回执判断交付条件，不复制平台引擎。

## 需求与架构的独立门禁

| 环节 | 产物 | 退出门禁 | 失败返回 |
| --- | --- | --- | --- |
| 需求澄清 | proposal/行为 delta specs、AC、范围/非目标/约束、交付目标 | 业务目标与结果可观察，关键歧义有结论，验收与范围完整；需要的业务决定已确认 | 业务范围/需求 owner |
| 架构 | design、接口/数据契约、风险与迁移回滚、必要 ADR | 设计绑定需求 revision，各 AC 有设计/验证归属，关键风险和技术取舍已处理 | 设计修订；改变目标时回需求变更路径 |

流程应保持“需求澄清→需求门→架构→架构门→测试设计→计划→实现→验证→收尾”。这描述义务依赖，不强制所有任务重新生成已存在基线；有效产物可独立引用复用。两个门禁都由 Comet 承载/调用检查器，所选模式是否能保证不可省略仍待实证。阶段分开不增加第二主控，也不强制机械阶段转人工审批。

Classic 的 Open/Design 只有在分别满足这些产物与门禁语义后才算适配；不能只凭阶段名称相似判定已支持。Native 若使用统一 Shape，则需要证明其中两个独立基线/前置义务不会被合并跳过，不能把原生 Shape 当成已满足本团队需求门＋架构门。

## 必须通过的最小可行性实验（全部待执行）

1. 一个真实 OpenSpec Change，从已确认范围连续走到验收与收尾；不新建另一份产品行为权威。
2. 有效检查后修改 spec、测试 oracle、源码/环境或 policy，原回执失效，不能直接 transition/archive。
3. 漏掉必需检查、运行无关成功命令、手工写 pass、启用普通执行不应拥有的 escape，都不能让受管交付通过。
4. LLMWiki 未更新/读回失败、Outline 缺审批或发布回执时，相应必需完成动作被实际阻断；有依据的 no-update 可通过。
5. 在测试/知识写入/归档之间中断，再恢复同一个 run；知识发布部分成功先读远端，不能重复创建或丢状态。
6. 验证器与 Builder 独立、只读候选、来源可靠；测试弱点回作者，产品缺陷回 Builder，需求变化返回规格审查。
7. 单次授权范围内自动推进；复用有效授权，但范围/风险/交付方式改变时停下。

这些实验要分别报告内核、CLI 装配、真实宿主和真实知识/平台四层。npm 完整性和静态源码检查不关闭其中任何运行义务。

## 下一项 Grill

R07 已确认：允许最小受控扩展，禁止再造主控。具体 Classic 接入、现有门禁和所需增量见 classic-integration-design.md；R08 已确认架构和测试设计均独立自动审查；机制设计见 classic-gate-runtime-contract.md。

R01 已确认固定受管 Runner；R06 已确认项目知识先卡归档、必需 Outline 发布卡整体完成。具体运行环境/入口和发布审批责任仍需收敛，尚未实际部署。

本轮补充：R09 已确认保守失效；架构方法强制 grill-me 与 multi-agent-consensus-review。Ponytail 只作方法/恢复提示协作，其当前 hooks 不提供交付 gate。R06 关闭顺序待确认，详见 classic-closeout-and-hook-contract.md。
