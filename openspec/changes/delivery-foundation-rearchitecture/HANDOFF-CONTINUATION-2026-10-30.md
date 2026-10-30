# Comet 0.5.1 收敛：接手说明（2026-10-30）

> 交接时状态：**未完成，禁止把组件测试、规划校验或本交接当成业务验收**。本文件补充既有计划，不创建第二份 DAG，不更改任务状态。

## 用户目标和不变边界

基于官方 Comet 0.5.1 的原 Run、阶段命令和应用扩展完成 AI DevOps；唯一流程主控是 Comet，TeamAI 只分发。需求 R、架构 A、测试设计 T 分开并有硬门；P 计划、测试编写、TDD、独立代码审查、V 独立 Whitebox 按同一 Run 串联。LLMWiki 用于单项目精华知识 Kp，Kp 未完成阻止 OpenSpec 归档；归档后 Outline 团队知识 Kt 完成才可整体交付。DeepWiki-open 承接代码 Wiki，不将全部 Git 代码塞进团队知识库。复用用户批准的源权限、受管文集和预授权边界；不增加常驻角色服务、第二主控或以新密钥／私有宿主平台为默认前置。

领域 Markdown 是用例正文权威，TestPack v1/JSON 是可追溯投影；测试作者自检、独立 T 审查与 V 验收分别取证。保留已批准手工用例路径。按保守策略，需求或设计改变后下游旧证据失效。F10 跨机器 API 正向明确另期，保留 `NOT-EXERCISED`，不能记 PASS；原 39 节点、69 工作包、104 场景、130 检查身份保留，本期 129 required / 103 场景及其余义务不减。

## 接手前核对：禁止双主控和覆盖用户改动

- 主检出 `/Users/mac/Code/sdd-harness`，分支 `master`；此交接工作快照的父提交为 `aafb3d2af1563f3a3847e7adb303ea080f7003b2`，具体快照提交以 `git log` 和本文件所在提交为准。本聊天所在的 `/Volumes/mac-extend/codex/worktrees/comet-observer-qualification/sdd-harness` 是 observer 工作树，不是主集成写点。主检出仍保留未纳入本提交的用户改动、截图、运行时与本地证据；先核对实际状态、所有权和 staged/unstaged，不整体 reset、clean、覆盖或盲目提交。跨 worktree 接手还须取得所需 `.local` 证据及其他未提交文件，不能假定所有运行事实都在提交中。
- 用户原生 Goal “实施完成，并且验证通过。” 交接时为 blocked，等待用户选择接手 Agent。接手者与原聊天不能同时作为控制器：先核实原生 agent、进程、测试 session、worktree、Run 和用户对接管的最新指令，再沿原执行契约登记唯一接管；观察超时不等于任务已终止。历史 `synthetic-host-source-r` revision 9 是已领取的隔离 R 动作，不要重新领取或当作正式交付 Run。
- 唯一事实源：本目录 `tasks.md`、`task-dag.json`、`execution-contract.json`、`execution-state.json`、`execution-ledger.jsonl`、`drift-lock.json` 和原始证据。执行状态顶层 `EXTERNAL_GLOBAL_COMET_PLAN_UPDATE_PENDING`；先解决计划/状态和实际应用版本的差异再按原 DAG 推进。不得批量勾选、另起状态机或将旧 0.5.0 的业务结果升级为当前 PASS。
- 用户曾要求每 30 分钟汇报进度和预计完成时间；此聊天尝试创建 heartbeat 被自动审批拒绝，理由是审查器认为此前移除定时任务的指令在后，缺少新的恢复授权。不存在已确认生效的定时任务；不得绕过拒绝或编造 scheduler。若仍需定时汇报，取得人类新的明确授权，使用宿主支持的线程 heartbeat，读回实际状态；未启用期间标 `SCHEDULE_UNAVAILABLE`，未知 ETA 如实写未知。
- 本次 15 份材料的三方共识、两次特定 Claude 单文件测试、Outline owner key 的三 API 一次只读许可均按各自范围使用完毕；不得复用或扩展。不要读取、复制或输出凭据，也不要将运行的容器、HTTP 健康或已有 owner 权当作来源/披露/发布授权。

## 当前状态与已有证据

- PATH 中 `comet --version` 为 **0.5.1**；Node 22 目录下的旧全局 0.5.0 已移除，Node 24 全局 0.5.1 保留。已安装 Comet 应用 `sdd-managed-delivery` 版本 **9**，包 contentHash `d3ea82317d8494dfa52cc3364b52b87701cc00e19cf6f3df775f8f0bc504dad8`。当前源代码的 `bindings.mjs` / `gate.js` 已在版本 9 编译之后继续修改，**安装包不包含这些新改动**；保留旧 Run 固定包，须新版本重编译、比较和安装，不覆写旧 Run 的应用身份。
- 项目 `/comet`、`/comet-open`、`/comet-design`、`/comet-build`、`/comet-verify`、`/comet-archive` 适配入口源在 `integrations/comet/application/phase-entries/`。本机已将本次生成的六个入口迁移到主项目 `.codex/skills/*-managed`，备份在 `.local/codex-stage-entries-before-migration-20261030/`；上游同名入口保留、仅本项目路径在用户 Codex 配置中禁用。本机 app-server `skills/list` 的原始回执为 `.local/comet-project-reinstall-efgrwupq/codex-live-stage-after-migration.json`。`.codex/skills` 是当前客户端实测路径；当前官方发现文档主要列 `.agents/skills`，须在目标客户端验证兼容。桌面菜单实际点击、模型实际加载及六阶段触发仍未验。
- 独立评审本轮结论 **REVISE**。`lib/adapters/codex-host-source.js` 能从真实宿主事件只读关联测试、同一合成 Run/动作与前后快照，并重算动作输入摘要；`lib/adapters/codex-test-observation.js` 生成未资格化契约／命令关联。结果永远 `sourceQualified:false`、`managedClosureEligible:false`。`.local/comet-project-reinstall-efgrwupq/codex-contract-cross-phase-negative.json` 是真实隔离 Run 的 R 事件拒绝冒充 V，不是 V 正向验收。
- `lib/delivery/domain-cases.js` 能从 Markdown 自动化字段生成**未资格化映射候选**，TestPack v1 仍是 `design_only`，不把候选或计数当已执行。配置、脚本、测试 ID 和逐例执行来源仍需受保护核实。reviewer 实证：`node -p 1 <测试文件>` 即使 argv 包含目标路径也不执行该文件，不能仅凭路径包含、摘要或测试总数证明用例覆盖。
- `lib/delivery/gate.js` 包含仅组件级的自动化晋级候选协议：拒绝过期／错 Run／错合同和多个作者的自审，候选来源摘要进入重算收据。**宿主 `bindings.mjs` 故意不接该晋级回调，真实 Comet 必须继续拒绝**，直至下节 P1 全部修复。原人工路径未取消。
- 最后一次完整 Node 回归针对当时的固定源码快照，`check-node24-full-after-p31-20261030.log`：1424/1425，唯一失败为 `committed foundation artifacts match live sources`，源码前后摘要一致。此后源和测试有变动，不能当作当前快照全量结果。最后定向组合 `check-handoff-final-targeted-20261030.log` 60/60，包含模拟端口测试；不证明真实门禁。默认 Node 25 + PATH Comet 0.5.1 的 Run 归属、并发及恢复隔离测试 `check-path-selected-comet-node25-20261030.log` 为 5/5。详细历史、命令、失败和备份在 `.local/comet-project-reinstall-efgrwupq/HANDOFF-DRAFT.md`；`.local` 是主机本地证据，不会自动随 Git 交付。
- 当前原计划的 `plan_guard.py` 只读检查 `valid:true, handoff_ready:true`，本机 OpenSpec 1.11.0 对此 change 的 `validate --strict` 通过；仅证明计划结构与 OpenSpec 文档校验，不证明已实施／验收。宿主全局 OpenSpec 为 1.14.3；本项目隔离 1.11.0 位于 `.sdd/tools/openspec-1.11.0/node_modules/.bin/openspec`。

## 沿原 DAG 的接手执行顺序

1. **P2_2 / P2_4，P1 首要：建立真实来源，不用 fixture 充当 provider。** 官方生成的 `package/application.mjs` 只调用 `createBindings(context)`；当前 `bindings.mjs` 需要受保护的 Run/输入/策略、原始来源、独立审查回读，却没有实际提供者。复用官方宿主的本机 agent/进程/原 Run 记录及用户已授权的真实资源；核验当前 action、attempt/epoch、冻结输入和策略、原始命令/输出、作者与不同 reviewer 的真实关系。不要从 worker 的 JSON、角色名或回调返回值自报资格，也不要要求六角色常驻、专用镜像、数据库 owner key 或未获授权的外发。
2. **先修验收器和硬门，再接自动晋级。** 在同一 Comet Run 真实读取并确认最新有效 T 审查 action 存在、成功、属于该 Run、绑定当前合同和设计；作者集合中的任何人不能签独立 T/V。重算 GateReceipt 后从实际受管位置读回 receipt-bundle，核对 gate、完整输入、策略、来源、重算收据和文件哈希；官方文件 hash 一致本身不证明内容正确。修 `contentAddressProblem`：受保护晋级依据真实变化须进入证据身份，不能让 worker 自报改变解锁，也不能因旧身份忽略晋级摘要造成合法重审无法恢复。覆盖无 action、跨 Run、旧版本、伪造文件、重复执行、修改需求/设计后旧证据失效、同 Run 中断恢复；先以真实 SDK 行为 RED，修复后保留 GREEN 和原始输出。
3. **P2_2 / T / V：完成 Markdown 自动化正向路径。** 在 `domain-cases.js` 生成的候选映射之上，由真实作者自检来源和独立 T 审查核验原 Markdown、脚本内容摘要、实际执行工具与 cwd、每个 case/check/test ID 的真实非跳过结果和完整 required 分母；候选可能只覆盖部分用例，不能用非空、总测试数或文件名代替逐例事实。将受保护来源、原 T action、当前合同与 V 独立执行证据闭合后，才实现 `verifyDomainAutomation` 并接入宿主；同步修订、审查、重新编译应用。保留 TestPack v1、完全手工且获批准的路径；混合自动／手工不得悄悄放宽。当前 Node TAP 观察器有嵌套结构与统计防护，但仍不是完整来源认证或逐用例报告；真实业务正向必须以原始事件/报告逐 ID 核验。
4. **P2_4 / P3_1 / P1_2：应用包和验证基线。** 以官方全局 Comet 0.5.1 公开编译接口构建新的不可变应用版本，核对源、编译清单、skill/依赖与生成包摘要；先做隔离安装、六入口及恢复，再评估主项目切换。原有 Run 继续绑定原包。核对 Foundation 导出是否包含 `tools/test-cases/compile-domain-cases.mjs`、`lib/delivery/domain-cases.js` 及其所有依赖，保证旧已封存基线可回读。当前锁指向 0.5.0 和旧源码：先逐项审查用户变更并确定最终真实 Git 提交／可复现快照，再重建与回读 Foundation 锁，禁止伪造提交来消掉漂移。修后在同一最终候选重跑完整回归，不继承旧快照的 1424/1425。
5. **I01 / I04 / 知识与平台、P5_1 / P5_3。** 验证实际 LLMWiki Kp 读写与独立读回、唯一 OpenSpec 归档、受管 Outline Kt 发布/读回，以及授权到期、源权限撤销、目标受众变化、事件漏报、周期核验、隔离失败/重试与恢复。权限、发布或隔离无真实合法授权时如实阻塞；不得复用已消耗的 owner-key 授权。DeepWiki-open 是代码 Wiki，真实平台/备份恢复、发布状态和外部副作用分别取证。
6. **VERIFY / 唯一收尾。** 在同一最终候选和实际产品 Run 上真实执行本期 129 required / 103 场景，包含 R→A→T→P→测试／Builder→独立 Review→V→Kp→唯一归档→Kt、失败返工、变更失效与重启恢复。独立 `whitebox-verify` 执行并关联原始数据、日志及适用截图，之后独立 Grill，输出 `verification-results.json`、`verification-report.md`、`grill-report.md`，保留 F10 未验。完成全部权威证据、OpenSpec 一致性、适用归档及归档后读回，才可将 Goal 标 complete；不要把计划守卫、JSON 合法、fixture、镜像健康或局部绿当全旅程通过。

## 接手方法

执行控制器采用原 `claude-parallel-tdd-planner` 的唯一计划/进度来源，目标选项 `native_option=auto`；先发现当前宿主真正支持的 worker、恢复和隔离接口，人工未选定执行者则用可用宿主，不要求特定品牌。并行仅分配互不重叠的隔离工作树；每个工作包先记录意图性 RED、最小 GREEN、定向回归和独立审查，由控制器串行整合。所有活动、未验证项和原始证据落入既有执行状态／ledger，不能由 worker 宣称任务 ACCEPTED。计划/锁或授权有冲突先 `HALT_AND_REPLAN`，不要自动改变范围或扩大授权。

## 本次交接检查

- 2026-10-30 主检出最后已结束的定向组合：`node --test test/domain-cases.test.js test/codex-host-source.test.js test/codex-test-contract-binding.test.js test/comet-managed-protocol.test.js test/comet-managed-source.test.js test/comet-cli-resolution.test.js`，60/60；原日志 `.local/comet-project-reinstall-efgrwupq/check-handoff-final-targeted-20261030.log`。包含 fixture，非生产验收。
- 独立 reviewer 发现的跨作者自审、输入摘要未重算、声明用例误当执行、TAP 明显矛盾均已加固；其最后对转义 `# TODO` 的兼容疑虑随后由真实 Node TAP 复测通过。完整 TAP/逐 ID/真实 provider 仍未资格化。
- 产品实现未完成；真实 V 正向、T 审查动作和收据绑定、LLMWiki→归档→Outline、权限恢复、最终 Whitebox/Grill、正式 Foundation 锁和全量最终候选均未通过。不要在交接时终结 Goal。
