# Comet 官方实践与本项目命令方案核查

日期：2026-10-25。依据用户更新目标“按照我们架构，结合 Comet 官方最佳实践，端到端完成实施，并且验证，出具验证报告”。本文件是官方资料核查，不代表版本迁移、应用安装、现有 Run 迁移或运行资格通过；原任务身份、唯一 DAG、129 当前检查/103 场景及 F10 另期处置不因本文件改变。

## 1. 一手来源与版本边界

- 官网：https://docs.comet.rpamis.com/zh/home
- 官方 Classic 工作流：https://docs.comet.rpamis.com/zh/concepts/workflow
- Native/Classic 选择：https://docs.comet.rpamis.com/zh/native/native-vs-classic
- Classic 定制教程：https://docs.comet.rpamis.com/zh/skill-creator/classic-customization
- Any 的职责与应用：https://docs.comet.rpamis.com/zh/skill-creator/overview
- SDK 公开入口：https://docs.comet.rpamis.com/zh/sdk/overview
- SDK 接入示例：https://github.com/rpamis/comet/blob/master/docs/architecture/sdk-getting-started.md
- 新旧 Run/原状态投影边界：https://github.com/rpamis/comet/blob/master/docs/architecture/runtime-sdk-native-classic-integration.zh.md
- 官方变更记录：https://github.com/rpamis/comet/blob/master/CHANGELOG.md

官方变更记录列出 0.5.0 于 2026-10-23 发布；当前官网展示该版的 Any 与公开 SDK 能力。项目实际锁定的是 npm identity 0.4.5、源码 c90af44a4474662d7853aae76ce785404974fb0a 的本地补丁链。只读检查当前 package.json 没有 exports，存在较早版 comet-any Classic overlay 入口。因此不得把官网 0.5.0 的公开模块、应用工厂或迁移行为当作当前锁已经具备的能力，也不直接执行全局升级。

独立精确包核查已确认：0.5.0 的 gitHead 为 aeb1a6598034e28ce46b8422d4dbd8785e607bd7，公开 tarball SHA256 为 a36d88cd065e92266d483a6bf4946f9d61149a12f3075df107bfde3f4ad9c47f，registry SHA512 完整性匹配，具名 JS/types exports 目标实际存在。0.4.5 npm tarball SHA256 为 d1713b5d80c1fffdb04586f53dfe227a418dd1b44a0c87b4f8c3b09ef06b84bb；此 hash 与 GitHub 源码归档不是同一工件。研究代码和 package-evidence.json 位于控制器私有研究目录 `/private/tmp/comet-official-fit-20261025`；尚无发布包运行资格继承。

## 2. 对命令关系的修正

官方推荐以 `/comet` 进入项目配置选定的流程；Classic 保留 Open/Design/Build/Verify/Archive 及对应阶段 Skill。状态与恢复依赖原 Runtime 和当前 Change，不能从文件或自然语言猜阶段，更不能通过编辑状态文件跳转。

本项目不必为了显示八个业务动作就先写八个新 CLI 命令。优先保留原入口，在阶段内部显示并执行可追溯的业务 step/gate：

| 本项目职责 | 优先复用原生位置 | 必须补齐或核验 |
| --- | --- | --- |
| 需求 R | Open / comet-open | 有权确认、可观察 AC、需求门、检索边界 |
| 架构 A | Design / comet-design | grill-me、独立全票共识、材料和来源绑定 |
| 测试设计 T | Design 内独立步骤/检查 | test-authoring design-only、独立充分性审查、单独产物/权限；不能与 A 合成一次通过 |
| 计划 P | Build 的计划执行与检查 | planner 仅产计划，不启动其控制器 |
| 测试代码、产品实现 | Build 的实现步骤 | 独立测试作者/Builder、有效 RED/GREEN、代码审查及允许路径 |
| 验收 V | Verify / comet-verify | 原机器检查保留，Whitebox 实际业务读回及来源独立 |
| CI/CD | 原交付动作与平台执行器 | 授权、精确 SHA/digest、真实目标和回滚读回 |
| Kp/规格归档/Kt | 原 Verify→Archive/完成边界 | 分别验证三个义务；特别要证明 Kt 缺失时原 Run 不 completed、未知结果不重放 |

用户可见的“架构”“测试设计”“计划”“测试编写”“实现”仍必须明确区分。它们来自原 Run 的实际 step/action/gate，而不是一份另行可写的用户阶段表。原生五 phase 是容器，不是合并业务责任的理由。

精确 0.5.0 的原 `/comet` Skill 仅接受 Native/Classic 两类解析结果；官方 Any 定制应用安装后使用独立入口。因而“仅原生 `/comet` 且自动选择定制 Classic 应用”仍有真实入口绑定缺口，不能假称零配置已满足。

进一步核对发布包 `classic-sdk-status.js`：当 Run 的 owner.application 不是 `classic-full`、`classic-hotfix` 或 `classic-tweak` 时，内置 `comet state` 路径会明确拒绝，并要求使用该 application 的 `comet runtime dispatch`，防止绕过组合检查。因此接线涉及入口、阶段执行、证据、Wait 和恢复，不能只改一个菜单路由；也不能把原 `/comet-design` 等 Skill 原文转发后宣称定制步骤会执行。最小方案必须统一绑定同一已锁 application/版本/Run，并保留原五 phase 的业务含义。是否复用原阶段 Skill，需要按其真实命令调用逐项确认。

原生 full 的用户批准仍是受保护步骤；独立架构或测试审查通过不替代用户批准。隔离测试中的 synthetic 决定仅用于机械测试，不能推广成真实用户同意。自动推进只能发生在已授权且没有待决批准的动作之间。

## 3. 官方组合机制能复用什么

官方 Classic full/hotfix/tweak 应用工厂允许替换指定阶段的执行 Skill，并在声明允许的位置追加检查；一个 phase 的多个执行步骤必须分别列清。领域机器检查、当前用户批准和机器归档不是可任意替换的 producer。新增检查需要真实产物、业务判定和失败恢复，格式正确或 Skill 自报成功不能替代原检查。

因此优先调查 Classic full composition：在已有阶段表达团队方法及独立 A/T/P 检查；不选“独立 SDK 应用”重建另一套研发流程。现有项目明确要求固定工程过程，不能只因使用强模型就擅自切换到 Native。

但官方教程不证明本项目全部安全和知识要求已经满足。真实 Agent/工具调用、秘密与身份边界、源 ACL/目标受众、独立语义审查、CI/CD、项目 Wiki/Outline 原生 API，以及归档后 Kt 继续/权限维护，仍需实际 host、工具适配与跨服务验证。SDK 接入示例的简化本地成功函数不算实际模型或服务执行证据。

精确 0.5.0 工厂允许的追加点不含 `archive.execute`/`archive.deliver` 之后。因此不能把 Kt 放进交付 Skill 的一段说明就宣称形成归档后独立持久硬门；该义务仍要最小领域扩展或上游接缝。官方迁移兼容承诺也不覆盖本项目自增 Gate、签名和 operation 字段。旧 Run 不自动迁移；旧源码/定义和未明操作必须保留。

## 4. 工作量判断

| 工作 | 相对工作量 | 原因 |
| --- | --- | --- |
| 菜单去重、阶段/门禁状态展示 | 小到中 | 主要是宿主发现与显示；必须证明内部依赖仍实际可用 |
| 原生入口与定制 Classic 应用的统一绑定 | 中，必须验证 | 原入口只选 Native/Classic；内置 state 命令拒绝定制应用。阶段执行、Wait、证据和恢复均需接同一 application 的公开 dispatch，不能只改菜单 |
| 用官方组合位置绑定 Matt、测试作者、独立审查与 Whitebox | 中 | 需要逐 producer 的输入输出、必需文件和验证器，不是名称替换 |
| 从现 0.4.5 补丁内部接入迁到 0.5.0 公开 SDK | 中到大，尚不能报工期 | 运行格式、公开导出、状态权威、补丁适用性和恢复协议需逐项核验 |
| 实际角色隔离、知识 ACL/发布恢复、CI/CD 与最终同 Run 旅程 | 大且资源相关 | 官方编排不能替代实际身份、授权、外部效果、独立读回和故障证明 |

结论：不应重写 Comet，但也不能承诺只整理菜单就完成。先用官方扩展位置减少方法编排和状态重复实现，再把真正不能复用的门禁、权限和资源执行缺口单独列出。上述量级是结构性判断，尚非人天估算。

## 5. 0.5.0 研究候选的受控资格顺序

以下描述候选的资格与迁移条件，不构成本轮必须升级的决定。当前交付版本选择见第 7 节。

1. 固定官网对应的精确发布版本与 public exports，在独立临时目录核实际能力，不能只看 master 或教程。
2. 对照原 R/A/T/P/V/Kp/Kt 义务，验证 Classic 工厂支持的位置；不能插入的义务给出实际端口缺口，禁止靠入口提示冒充强制。
3. 做最小端到端兼容切片：原生入口、独立 A/T/P、实际测试/Builder、V、原 Run 恢复。真实模型/平台调用仍按其具体授权。
4. 将本地 0001/0002/0003 按“官方已覆盖、仅方法配置、必须保留的业务/安全约束、版本不兼容”分类，再形成同一计划的受控修订。没有证据前不丢掉已有安全负例或默默刷新锁。
5. 仅在明确新版本与旧 Run 的归属、保留和失败恢复后迁移。官方文档对旧 change 不自动迁移；每个 Change 只能有一个可推进的权威运行格式，状态文件只能按相应协议投影。
6. 完成入口/方法发现、平台 Hook、发布包消费者、真实执行和业务/故障验收后，再更新 ready/accepted；旧 44 或局部通过数不继承为新 SDK 的通过。

## 6. 已执行的隔离机械验证

2026-10-26 上海时间，精确 0.5.0 public Classic full 已由作者自检，再由 Root 独立复跑。作者冻结 manifest 为 `5d4979ea48ee3e4b2d13445b36ca2659e82dfe231d2da6f270947bdd8324eaf5`，82 份文件已逐项核验并保全；官方包与 13 个固定依赖共 4,462 个解压文件和对应 tarball 逐字节一致，无额外文件，无生命周期安装。

Root 的四个独立进程 prepare/resume/finish/deliver 均 exit 0，样例 Run `mechanical-classic-full` 在新目录 `qualification-WOp14F` 达到 revision 51/completed。A→T→P 按既定 checkpoint 执行；缺工件、错误语义和合法内容变更后的旧摘要被拒绝；冷恢复保留同一 Run 和已有 Action，不重复执行已完成动作。原生 Build/Verify 运行真实本地 Node 测试，原不可替换 Archive 调用实际 OpenSpec 1.14.3 归档，并由实际本地 Git 提交完成原 delivery validator。两个不支持的 postarchive 扩展位置都被工厂拒绝。

这仅验证机械接缝。角色结果和用户决定均明确为 synthetic fixture；没有通过真实独立模型/人类授权、OS/ACL、CI/CD、LLMWiki/Outline、旧 Run 迁移或还原字节后不可复活旧证据的验证。样例使用原文件契约，没有认证 OpenSpec schema 依赖图；本机 1.14.3 也不替代冻结生产工具链 1.11.0 的资格。package loader、CLI public dispatch 和宿主接线尚未验证。

原始证据及 Root 读回见主检出 `.local/comet-reset/official-public-qualification/`。结构 plan_guard 返回 valid/exit 0，仅表示原冻结计划未漂移。上述结果不计入 129 项业务检查或 103 场景的通过数，也不允许生产锁切换。最终实施与完整验证仍未完成。

## 7. 本轮执行版本：继续冻结的 0.4.5

用户要求结合官方最佳实践完成原架构，没有要求升级到 0.5.0。原计划与生产锁已经选择 0.4.5；现有方法、门禁、失效及归档后恢复补丁已有独立建设资格。独立 Spec 决策复核未发现只有 0.5.0 才能完成本轮必需功能的证据。因此沿原 0.4.5、原任务与唯一 DAG 完成全部 129 检查/103 场景；不把版本升级新增为交付前置，也不把旧组件绿色算成业务通过。

官方五 phase、清晰角色和产物、不可绕过的检查、实际证据、同 Run 恢复是本轮要落实的实践。0.5.0 的 factory/loader/CLI 研究保留为候选，不能推动旧 Run 换绑或新建第二主控。后续只有明确选择公开 SDK，或证明当前版本存在无法安全补齐的必需能力/安全缺陷，才重新审查升级条件。这个技术选择没有删除任一知识、角色、权限、平台、恢复或最终验收义务。

保留版本不豁免安全维护。原 P1_4 正逐项核对官方 0.5.0 Security 中的 Vite 开发服务器、Hook 路径参数/用户 Hook 保留、Eval 工件链接防护：按实际暴露面记录证据，必要修复由原所属任务完成，不能仅凭计划说“未使用”而豁免。
