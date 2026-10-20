# Classic 单主控接入设计与原生/扩展边界

> 当前接入优先级（2026-10-20）：先完成官方 overlay 隔离预研，再按 overlay-integration-design.md 的复用/适配/gap 顺序执行。原 canonical plan/任务 revision/handoff 已有可复用实现；本文件早期“建议适配器”描述不代表需要自研相同协议。OVR 评审本修订，OVQ 资格和项目可信 Gate/恢复验收分开；不以旧评审票或原生标记 PASS 关闭新增义务。

日期：2026-10-19。状态：Grill 设计，未实施，未通过运行验收。

## 1. 已确认约束

用户允许最小受控扩展，不再造主控。TeamAI 首期只分发；Comet 是唯一阶段/允许动作/恢复权威。需求澄清、架构、测试设计分别过门禁，不能因 Classic 只有五个 phase 而合并语义。目标后默认自动推进，关键业务/风险决定或无法恢复阻塞才找人。

本文基于实际 npm @rpamis/comet@0.4.5（gitHead c90af44a4474662d7853aae76ce785404974fb0a；完整性已验证），不把旧研究 commit 的原生能力混入当前版本。

## 2. 保留五个 phase，增加同一 Run 内的必需动作与回执

```text
Open
  需求澄清 → 需求门 R
Design
  架构设计 → 架构门 A
  测试设计（design-only）→ 测试设计门 T
Build
  planner → 计划门 P
  test-authoring automate + Builder/TDD
Verify
  独立 Reviewer + Whitebox → 验收门 V
  必需项目知识维护/独立读回 → 项目知识门 Kp
Archive / 完成前
  唯一 OpenSpec 收尾
  必需 Outline 发布与读回 → 团队知识门 Kt
  如交付契约要求：平台 CI/CD、图谱/DeepWiki 回执
  必需义务全部满足，才能最终 completed
```

此图是目标动作与依赖，不是上游现有的可配置 workflow。必要操作的前后还受 in-change/after-merge 策略、源权限及生产授权约束。检查和知识发布失败按原 run 恢复；不能为了 diagram 顺序把尚未集成代码的知识冒充已发布成果。

最小化原则：优先在 Classic 已有 Run/continuation/transition 中表达 sub-action 与回执，沿用 phase 枚举。不存在公开强制接入点时，显式扩展现有 Runtime，而不是创建另一份 current-stage 或让脚本指挥 Comet。若旧 schema 不能表达顺序，所需最小迁移需单独设计，不能假定添加字段就会生效。

## 3. 原生能力与扩展矩阵

| 项目 | 原生静态可见 | 配置/方法适配 | 必须新增或加强的硬约束 |
| --- | --- | --- | --- |
| OpenSpec | Classic adapter、依赖闭包、文档路径解析、archive 与恢复记录 | 固定兼容 CLI/schema，沿用 project/change 绑定 | 需求/设计内容质量和授权回执不能由文件存在替代；当前 CLI 兼容性未过 |
| 需求澄清 | Open 技能探索、目标/范围/AC 摘要、Open Guard | 受控加载 grill-me，复用已确认事实 | R 回执绑定产品基线；关键歧义未解不能 design-complete/进入架构动作 |
| 架构 | Design、正式 design_doc、handoff/hash/来源、OpenSpec canonical 标记 | 对照代码/ADR，调用架构质询方法 | A 语义审查/风险决定绑定需求和设计版本，失效即阻断 T/P/源码写入 |
| 测试设计 | 没有独立测试设计动作/门；Design 阶段默认禁止源码写 | test-authoring design 模式只生成测试意图、case/oracle/覆盖 | T 是源码写入和计划的前置条件；补受保护测试设计工件路径和恢复 continuation |
| planner | Build 原生 plan 指针、任务映射、base-ref、计划暂停/恢复 | 调用 planner 的计划能力，映射输出为 Classic 消费视图 | 单一 tasks 权威；不能启动技能自带执行/监控/归档；计划绑定 R/A/T |
| test-authoring automate | Build 可写源码、TDD 约定与命令证据 | 作者只写授权测试/fixture；产物冻结后交 Builder/Verifier | TestPack 与源码测试集版本绑定，改变 oracle 必须回 T；作者自检不得签 V |
| Whitebox | Verify、实际命令回执、输入/环境/日志校验、verify-fail 返修、独立审查方法约定 | 独立只读执行调用选定 Whitebox 模式并保留原报告 | 独立 execution 与候选绑定；AC/case 分母、真实业务 oracle、能力缺口和失败必须完整计入；不能只检查报告文件存在 |
| LLMWiki/Outline | 原生 comet knowledge remember 是其自身项目记忆，不能等同外部入库 | 知识维护角色按项目/成员身份用 MCP 写；检查器只读核验 | Kp/Kt 必需集合、来源/权限/审批/目标版本与独立读回；不得创建第四知识主库 |
| 完成/归档 | Classic 验收后转 Archive、OpenSpec archive、状态和恢复记录 | 沿用唯一规格收尾路径与已有效授权 | 不能因 archived=true 就提前认为所有交付义务 completed；resolver/continuation/恢复/CI 必须统一核对必需回执 |

## 4. 三个前置门的实际判定

- R：范围/非目标/交付目标清晰，AC 可观察、关键业务未知项已解决，记录用户目标确认与授权边界。探索阶段可以有试验，但不得未过 R 就产出被当成已接受的技术决定。
- A：每项 AC 有设计责任，接口/数据/依赖/风险/迁移/回滚适用性明确，重大取舍已授权。架构发现需求不可行，返回 R 的修订流程，不静默改 AC。
- T：case 与 AC 映射、独立 oracle、身份/数据、层级/环境/清理和证据分母明确；有未决预期不能进入实施。TestPack 的 design_only 结构合法只证明材料结构，不意味着 T 语义充分。

门禁由结构/引用检查和独立语义审查共同组成。正常结果自动推进；只有未授权取舍或真正阻塞才问人。用户已明确测试设计门不可跳过。风险只影响审查深度和适用场景，不取消 T；用户已确认 A/T 均独立只读自动审查，配合结构/引用检查，不能让作者自填 accepted 代替检查。

### 测试设计门 T 的最低标准

1. 每个必验 AC 都有明确 case；覆盖成功、相关失败/边界、高风险义务，未适用项有依据，不靠用例条数或文件存在替代。
2. 每个 case 的预期结果有规范/独立算例等 authority；不能以当前实现输出或调用者自报成功作 oracle。
3. 身份、前置数据、操作与可观察终态明确。持久化/外部副作用场景规定独立读回，截图/HTTP 200 不单独闭合。
4. 执行层级、环境/工具能力、真实依赖与替身、fixture 隔离和清理可行；设计阶段不冒充已有执行结果。
5. case→AC→设计责任映射可审查；未解决业务预期或关键验证缺口保持阻断，不能改为 N/A。
6. TestPack 与需求/设计版本冻结，审查结果绑定内容摘要、所需用例和审查身份；修改 AC/oracle/相关设计使 T 及依赖计划/验收失效。

测试有三道不同义务：T 判断用例设计是否充分；Build 测试质量检查证明测试能发现目标缺陷（有效 RED/负控等）；V 独立执行判断当前产品候选是否满足行为。任一道成功都不代替其他两道。

已有设计可复用，但“引用旧包”不是免门禁；必须复核摘要、需求/设计适用性、覆盖和环境。纯文档等无产品行为变更也应保留有依据的测试义务适用性结论，不能仅用风险等级直接跳过。

## 5. 技能接入的具体 I/O 和冲突处理

### planner

输入冻结 proposal/spec/design、T 的 TestPack 意图、工作区和能力范围。输出 OpenSpec tasks、DAG、drift-lock、执行交接引用。

当前本仓库 planner 以 <changeRoot>/tasks.md 为 canonical plan，不允许 docs/superpowers 再维护另一份计划；Classic 则使用 plan 文件描述实施、tasks 作为唯一 checkbox 权威。不能直接把二者都当作主计划。

建议由适配器从唯一 tasks/DAG 生成只读的 Classic plan 视图，带 base-ref 与原生 task authority/ref 标记，不出现第二套可写 checkbox，再登记到原生 plan 指针。视图生成与映射能否通过 Classic 计划解析/Guard 需实测；不是修改上游/技能的现成配置声明。

当前 planner 的 plan_guard、OpenSpec 预检和其他负例继续保留；不安装或改写全局技能。若版本不兼容，显式升级快照并验证；不通过包装器静默丢弃技能硬约束。

### test-authoring

Design 后半段调用 design-only，仅写测试意图工件，不运行/写测试代码；这些输出位置要纳入 Classic 正式制品与写入保护模型。原生 Design 禁止源码写入，不能靠放宽整个目录允许测试作者提前写产品代码。

Build 中按测试契约调用 automate，限定 tests/fixtures 等授权范围，实际运行自检，保留有效行为 RED；产品修复交 Builder。以该技能现有 TestPack JSON 作为用例机读源，通用 TestContract 为兼容视图，不能分别维护两套 oracle。结构验证通过不等于独立验收通过。

当前 test-authoring 1.0.0 来自共享技能目录，尚未 vendored 到本仓库；发布与 TeamAI 分发必须固定实际内容摘要并按真实目录快照纪律引入，不把“当前会话能读”当团队已可用。

### Whitebox

Comet 只派发一次绑定当前候选的独立验收执行。Driver 显式加载固定 Whitebox，读取冻结 TestPack/规格和真实环境，保留原始 Journey/Debug 命名空间。缺用例退回测试作者，产品缺陷回 Builder，需求矛盾回 R/A；改变源码、测试或 oracle 后不能沿用旧验收。

本仓库 vendored Whitebox 是 2.2.0，不自动等于其他目录后续版本。若需要跨 harness 原生浏览器等新能力，需选定并显式升级验证。Comet Verify 与 Whitebox 不分别跑两套同范围验收；原生集成代码审查义务仍单独保留，不能用浏览器 Journey 代替。

### 知识更新

各阶段输出候选；同一 Comet run 的知识维护动作完成 LLMWiki 修改/Outline 发布。独立只读检查器核对源 revision、目标条目稳定 ID/内容摘要、授权和读回；只把有来源和权限的必要材料交给知识作者。正确的 no-update 可过适用性门，不强制凑文章。

原生 comet knowledge/个人记忆的写入和自动注入必须检查停用/引用/转接能力；若原生不支持所需边界，应显式受控扩展，不能一边按原技能写内置项目记忆一边声称只有 LLMWiki 主库。

## 6. 硬约束必须落在哪些入口

所有必需 Gate 的规范、检查器身份、版本与适用性由可信 policy 冻结。回执存入已有 Comet Run/事件/工件引用；R/A/T/P/V/Kp/Kt 是拟议回执类型，不是当前原生字段。

必须共同核对：正常 guard --apply、直接 state transition、源码写入许可、恢复 next/continuation、结果接纳、archive 和最终 completed。只改技能提示或一个入口会留下旁路。检查器只返回判断，不调用阶段转换或另排任务；只有 Runtime 决定推进。

Open/Design 的直接 transition 在当前源码各自有前提检查，但并非都调用完全相同的 Guard 逻辑；扩展时必须统一公共的推进条件验证，不能只给 guard 命令补检查。skip/repair-only escape 要与正常 Agent 执行权限分离，并由受保护 CI 重验交付。

外部知识回执不能仅以本地 success JSON 获信任。读回需使用实际服务、已授权身份、正确对象/版本；幂等恢复先查原条目，失联/超时保留未知，不重复发布。

## 7. 当前可直接确认的环境缺口

本机 OpenSpec 1.3.1 status 输出没有逐 artifact requires。对发行包中原样抽取的纯函数 requiredArtifactClosure，输入真实 status JSON，得到拒绝：OpenSpec must expose dependency edges for every artifact; upgrade to a supported version。

范围：这是兼容性判定函数的真实输入探针，不是完整 Comet adapter 运行，也不是升级后的成功认证。证据见 classic-openspec-compatibility-probe.json。不能凭本仓库 openspec validate 通过推断当前 Comet 已兼容；必须选固定兼容产物，在隔离环境验证，不自动升级全局 CLI。

## 8. 最小扩展边界与验收

- X1：现有 Run 的 gate 义务/回执绑定、共同推进检查和 continuation；不新增调度状态机。
- X2：需求→架构→测试设计的顺序、受保护产物和源码写入前置条件；复用旧 phase。
- X3：三个方法技能的版本/I/O/角色权限与原生计划/验证适配。
- X4：外部知识作者动作、独立检查、批准与读回；原生知识路径的唯一源处理。
- X5：归档/交付完成条件与恢复统一；所需阶段授权预先保存、只为新决定停下。

X1–X5 是设计范围，不证明可全部通过插件完成。若无支持接口，则评审最小内核/资产扩展并优先上游贡献；不先 fork 全产品，不修改 vendored 正文偷渡规则。

待执行负例至少覆盖：未过 R 就进架构、未过 A/T/P 就写源码、无关成功命令替代必需检查、作者自签验收、旧候选/过期 oracle、缺能力/零测试、知识缺授权或读回失败、断点恢复/重复发布、archive 先完成但交付义务尚缺。每项必须在真实受管入口观察阻断，不能只验证结构函数。

## 9. 下一项 Grill

R08 更新：用户已明确测试设计重要且必须过门，不能因低风险省略或只验材料结构。用户已进一步选择 A：架构门与测试设计门都独立自动审查，允许复用仍有效且经过适用性核对的基线。推进、返工、接纳和失效机制见 classic-gate-runtime-contract.md。

## 源码定位

实际 npm 发行包相对位置：
- dist/domains/comet-classic/classic-guard.js:903–1037（Open/Design/Build/Verify 既有检查）。
- dist/domains/comet-classic/classic-state-command.js:657–690（直接转换路径）；classic-hook-guard.js:442–480（阶段写入范围）。
- dist/domains/comet-classic/classic-artifact-requirements.js:53 起（依赖闭包能力要求）。
- assets/skills-zh/comet-build/SKILL.md:69–104（计划、tasks authority、执行策略）。
- assets/skills-zh/comet-open/SKILL.md:0c（OpenSpec API 兼容要求）。

对照来源：[Classic Guard](https://github.com/rpamis/comet/blob/c90af44a4474662d7853aae76ce785404974fb0a/domains/comet-classic/classic-guard.ts)、[Classic 入口](https://github.com/rpamis/comet/blob/c90af44a4474662d7853aae76ce785404974fb0a/assets/skills-zh/comet-classic/SKILL.md)。当前版本没有被宣布可直接完成本设计；所有新增门禁/接入仍待实现与四层实证。

## 10. 后续确认

R09 已确认首版需求/设计变更全部下游失效；架构 A 强制 grill-me 加全票共识，测试 T 继续独立自动审查。知识/规格/整体关闭的拟议顺序和 Ponytail 只读核对见 classic-closeout-and-hook-contract.md，R06 尚待确认。
