# Comet 用户触发动作与原 AI DevOps 架构对齐

状态：接口提案，依据本次用户对显式环节、协作和门禁的要求及官方精确 0.5.0 核查整理；尚未实现、安装或通过冷会话验收。下列官方阶段入口不代表本项目 Codex 当前已发现或定制应用已经接通。

2026-10-25 官方文档核查后修订：撤回八个独立动作命令优先实施的方向，保留用户需要的环节、角色、产物和门禁粒度。2026-10-26 决定沿本轮已冻结 0.4.5 完成原全链；0.5.0 Classic composition/公开 application 作为资格研究，不是新的交付前置。版本差异和剩余真实缺口见 `official-comet-best-practices-review.md`。

依据：`docs/architecture/delivery-architecture.md` 的六环节契约、`docs/architecture/comet-ai-devops-convergence.md`、ADR-0020、当前 Change 的 Classic 接入设计。保留原任务身份和唯一 DAG；本文件不修改冻结任务、契约或进度，不增加第二个控制器。

## 1. 原生命令和本项目环节的关系

下表是官方 0.5.0 源码中的阶段入口及本项目要求，不是当前 Codex 已安装可运行的菜单。原 `/comet` 只路由 Native/Classic；团队定制 Classic 应用有自己的 application 身份。内置 `comet state` 命令会拒绝非原生 application，不能把下表原阶段 Skill 直接转发当成定制应用已经接通。

| 官方阶段入口 | 原阶段容纳的明确环节 | 本项目协作与正式产物 | 本项目硬门与失败返回 |
| --- | --- | --- | --- |
| `/comet-open` | 需求澄清 R | 需求作者、grill-me、有权确认者；按权限检索知识，形成目标、范围、AC、非目标、环境及需求版本 | 关键问题闭合、当前 R 有效；业务取舍回 owner，需求问题回作者 |
| `/comet-design` | 架构 A → 测试设计 T，两项分别执行和审查 | 架构作者＋grill-me＋独立共识，产出 design/ADR/原票；随后 test-authoring 设计模式＋独立测试设计审查，产出 TestPack、case/oracle/覆盖/环境/清理计划 | A、T 分别绑定当前制品并独立通过；T 不通过不能进入 P，文档结构正确不代表充分。架构问题回 A，需求歧义回 R |
| `/comet-build` | 计划 P → 测试代码 → 有效 RED → 产品实现 → GREEN/回归 → 代码审查 | planner 只生成当前 Change 唯一 tasks/DAG/允许路径/case 引用；独立测试作者、Builder、Reviewer 依次承担各自工作 | P 通过才能实施；环境失败不算 RED，测试与产品缺陷分别返对应作者；planner 不再派发或启 Goal |
| `/comet-verify` | 独立验收 V、适用平台检查、归档前 Kp | Whitebox 执行全分母、真实终态读回；平台执行者绑定 SHA/digest/目标环境；知识作者与独立审查形成 LLMWiki 精华与索引读回 | 缺能力、零执行、弱 oracle 或候选变化不放行；必需 Kp 未完成不能进入真实归档。平台部署必须按实际时点和授权核验，不能以流水线绿替代 |
| `/comet-archive` | 规格归档 → 团队知识 Kt → 整体完成 | 唯一 Spec Adapter 执行真实 OpenSpec 归档；受管 Publisher 发布 Outline 并独立读回版本、受众和原 operation | 原归档成功不等于 completed；Kt 未闭合必须同 Run pending。未知结果先读回，恢复不重复归档或发布 |

这里的测试设计只决定“如何证明行为”，发生在 T；测试代码将已审用例写成可执行检查，发生在 Build。计划消费已审 R/A/T，不能改变 AC/oracle 以迁就实现。

## 2. 单入口接线及唯一状态

目标仍是用户只面对 Comet 流程入口，并明确看到当前环节、允许动作、角色和门。原五 phase 保留；需求、架构、测试设计、计划、测试代码、产品实现、验收及收尾是同一 Run 的实际 step/action/gate，不新建另一份可写业务阶段表。

0.5.0 候选的 Classic 工厂可在固定 evidence checkpoint 追加 A/T/P 等步骤，不能任意替换原机器检查、用户批准和机器归档。该候选没有现成 postarchive public checkpoint。当前 0.4.5 则沿已建设的原领域 `0003-post-archive-closeout.patch` 接 Kt，仍须真实发布和同 Run 故障恢复验收。独立审查不能代填原用户批准；已批准范围内没有待决批准时才可自动推进。

本轮 0.4.5 接线沿原 Classic resolver、阶段入口、原 Run/事务和现有受管补丁完成；显式步骤、角色/方法、产物、允许动作和 gate 必须从原 Runtime 读回。入口文字、方法目录或调用成功都不证明角色执行和门禁已接通。

若以后选择 0.5.0 定制应用，单 `/comet` 绑定必须覆盖原入口、阶段执行、证据提交、Wait 和冷恢复，统一使用同一 application/版本/Run 的公开 dispatch。不能只修改入口提示后继续走拒绝定制 application 的内置 state 命令。这个候选的研究不改变生产锁、旧 Run 或宿主发现配置。

辅助状态与恢复应使用该 application 的实际公开接口，展示原 Run 的 phase/step/gate/阻塞/证据。未验证前不编造 `/comet status` 或 `/comet resume` 语法，更不把本文概念动作当现有 shell 子命令。

## 3. 每次请求的固定回显

实际数据必须由 Runtime 返回，不能由自然语言编造：

```text
Change / Run：实际绑定标识
当前环节：测试设计（Design / T）
本次动作：完善权限撤销与恢复用例
执行角色：测试设计作者
采用方法：test-authoring，固定版本/摘要
当前输入：R/A revision 与摘要
允许范围：已登记测试意图路径
正式产物：TestPack 设计态与 AC→case
放行门：独立 T 审查待完成
下一允许动作：T 通过后实施计划；拒绝则返作者
```

用户请求进入某环节无权绕过前置。例如 R 未通过时请求架构，或 T 未通过时请求实施，必须返回非零/blocked、具体缺口与允许返工动作，不能暗自切阶段或降级成普通开发。

## 4. 内部协作和发现边界

- TeamAI 只分发固定资产；不会决定下一动作。
- MCP 仅提供授权工具访问；不会决定 gate 或推进阶段。
- grill-me、test-authoring、tdd、code-review、Whitebox 和 planner 的计划能力是内部方法，不是并行工作流。
- 同一个方法用于不同动作时，必须绑定不同工作包和权限。例如 test-authoring 的设计态只写测试意图，自动化态只写获准测试/fixture；不能把两者当一次执行。
- 菜单收敛不能简单用 `allow_implicit_invocation=false` 代替隐藏，也不能禁用方法后让 Comet 隐式找不到依赖。公开入口与私有方法源的目录/注册要分离，保留原样内容及单一版本权威；涉及当前 `.agents/skills` 权威路径的调整须先固化 ADR/受控任务归属，再实现，不静默搬目录。
- 本项目 Comet profile 的发现策略不卸载或停用用户全局及其它项目的通用方法。

## 5. 实施与验收归属

沿原 P1_1 维持精确工具链并保全候选研究；沿 P1_6/P1_2/P1_3 完成方法源/发布视图、宿主入口与原 Classic Run 接线；沿 P2_4/P2_5 保留与补齐 Runtime 硬门；原 P3_1/P3_2/VERIFY 验证。版本或接口如确需变化，仍先受控修订冻结，不伪称原生支持，也不增加另一个 DAG。

验收至少包含：全新 Codex 会话可见 Comet 且无重复方法入口；逐动作派发正确角色并形成正确产物；R/A/T/P/V 的绕行请求实际拒绝；新版本使旧证据失效且还原字节不复活；开发按真实 RED/GREEN；CI/CD 实际目标读回；Kp/归档/Kt 分门；中断恢复原 Run；内部方法调用真实可追溯且没有第二 planner/Goal/调度器。目录列表或成功提示不能替代这些行为证据。

当前本提案没有安装任何入口、改变发现配置、重命名原生命令、启用 profile 或修改业务状态；已有整体未验和 F10 另期处置不变。
