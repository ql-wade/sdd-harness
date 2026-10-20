# Implementation Plan — 交付架构端到端实施

**Goal:** 保留原30父任务、69工作包及92场景，完成 Comet 单主控受管交付、知识关闭与恢复的真实端到端实施、独立验证和报告。
**Architecture:** design.md、docs/architecture/delivery-architecture.md 与 ADR-0019 为权威；architecture.md 仅登记接口及证据。
**Tech Stack:** Node ESM、Comet0.4.5 精确提交、OpenSpec隔离兼容工具链、Matt基础方法、test-authoring、Whitebox；详见 execution-contract.json。

## Global Constraints

- Comet Classic is sole target runtime controller; TeamAI distributes only
- Matt reusable methods only; no Superpowers restart or nested planner/implement-spec controller
- Preserve original parent IDs and workpackage IDs; aliases are parser adapter keys only
- One canonical tasks/DAG/progress source; no worker-owned lifecycle writer
- Managed Runner OS/container separation is a required real negative gate, not local signature evidence
- R10 A retains sole workspace until overall completion; G15 A healthy-dependency five-minute containment only
- Batch5 is conditional pre-enable certification; never silently waive F10 or claim untested team API
- No production effects or remote branch protection mutation implied; honor registered grants before live writes
- Parent task completion requires all its required workpackages and current acceptance evidence
- Any scope/interface/input hash drift halts and requires reviewed replan; no silent lock refresh

本计划为用户选择的 planning-only 交接包，由用户另选 Agent 实施；当前聊天不派发实施。迁移实施由接收方选定的唯一 planner 控制，目标系统的业务推进、状态与恢复仅由 Comet 持有。首轮 serial/max_workers=1/isolation=serial，证明宿主能力后才能经显式重规划并行。旧 sdd 实施监督已暂停；接收方按实际宿主能力绑定 Goal/20分钟监督，不复用旧聊天执行身份。结构校验不等于运行验收。原30父任务、69工作包、92场景全部保留，新增8项基础设施任务及最终VERIFY，共39节点。

计划中的2–5分钟指单次检查点/取证时间盒，不是完整功能交付工期；失败仍继续拆片，不能为时间盒降验收范围。实际 ETA 由实测剩余工作推导。每次提交仅包含该任务授权文件，不自动提交既有用户文档。

## 原任务状态与机械别名

共享 guard 不接受点号 task heading；P0_1 等只是原0.1的机械编码。以下原ID、原文和已完成0.1–0.4逐字保留，不因新计划重复执行或改为未完成。69工作包表在末尾保留，同父任务归属，不另有进度。

- [x] 0.1 收敛 v3.1 与 Foundation 后续修订，写唯一目标架构、ADR 提案、现有资产迁移表；证据：docs/architecture/delivery-architecture.md 与 ADR-0019。
- [x] 0.2 写 proposal/design/spec/tasks，并保留 A01–A20、B01–B10、F01–F10 共 40 项 Given/When/Then 场景；证据：specs/delivery-foundation/spec.md。
- [x] 0.3 同步 README、AGENTS、旧架构入口和能力状态，执行 openspec validate delivery-foundation-rearchitecture --strict、bash scripts/check.sh、git diff --check；记录真实结果到 verification.md。
- [x] 0.4 架构评审确认 ADR-0019 和目标所有权，独立共识票绑定同一摘要；未完成不把 proposed 改为 accepted。
- [ ] 1.1 固定 TeamAI、Comet、OpenSpec、共同工具链实际分发产物版本和完整性；读取实际命令版本并运行最小探针（F01/F03）。源码 commit 不代替 npm 产物。
- [ ] 1.2 在临时隔离配置先 RED 复现双写/漂移负例，再实现 exporter 与 FoundationLock；验证正反序 bootstrap/init、重复 pull、升级、卸载、用户条目与 matcher 注册（F02/F04/B09）。不得修改活配置。
- [ ] 1.3 验证 Comet 单主控模式、受管驱动、OpenSpec 接入、不可省略检查集合、独立验证回执和唯一 closeout owner（TeamAI 只验证分发）；真实渠道探针覆盖编辑/Shell/MCP（F05/F07/A09）。失败 NO-GO，不扩建第二调度器。
- [ ] 1.4 基于固定 Comet 发行包比较 Classic/Native；验证无关成功命令、漏必需检查、旧/手工回执、普通执行可达的跳过/运维逃生路径均不能放行受管交付；确认内置项目记忆与 LLMWiki/Outline 唯一知识源不冲突。所需扩展先评审，不以提示词充当不可绕过性。证据范围参见 comet-single-controller-review.md。
- [ ] 1.5 按 classic-integration-design.md 验证 R/A/T 分离、P 计划单一权威、V 独立回执及 Kp/Kt 读回门禁；覆盖 C01–C08 的正常与旁路/恢复负例。先在隔离工具环境解决实际 OpenSpec 兼容失败，固定 test-authoring/Whitebox/planner 分发内容；不得改活配置或直接升全局工具。
- [ ] 1.6 按 matt-method-profile-migration.md 显式解决本仓库旧 planner/Comet Classic 的 Superpowers 硬依赖和初始化安装路径；固定 Matt 基础方法与必要专门技能快照。按 M01/M02 验证全局停用不被重启、没有嵌套 planner/implement-spec controller；不修改上游正文或用本机软链接分发。
- [ ] 2.1 contracts/delivery/ 定义共享 schema；lib/delivery/ 实现全输入基线与 AC→case 追踪。先 RED 验证缺基线、零测试、错误 RED、非 JS 文件漂移，再 GREEN 实现（A01–A04/A07–A08）。node --test 目标测试和 npm test。
- [ ] 2.2 实现 EvidenceEnvelope/来源准入和 GateReceipt；先 RED 拒绝自签 pass、同执行身份、旧 policy/环境/输入摘要、缺观察能力，再 GREEN（A05–A06/A18–A19/B03/B06–B07）。可信来源单独实测，schema 夹具不冒充认证。
- [ ] 2.3 保留旧 CLI 和报告 adapter；验证错误输入退出 1、验收失败退出 2、有效检查退出 0，旧 npm test 及 bash scripts/check.sh 通过（B10/A20）。
- [ ] 2.4 按 classic-gate-runtime-contract.md 评审并最小扩展同一 Classic 的 policy/receipt/evaluate、共同转换条件、受管写入、resolver/continuation、状态事务和 archive/completed；先用 D01–D08 真实入口负例复现，再实现阻断/返工/失效与恢复。A/T 采用独立自动审查；不得新建第二阶段账本，也不得用手改 phase 模拟返工。运行时代码/装配改动需独立评审和完整回归，当前仅计划。
- [ ] 2.5 架构 A 接入 grill-me 加独立全票共识：冻结审查包、保持 exact quorum/阈值/同摘要、绑定真实机械 tally/finalize、拒绝旧票/缺票/多数票和未闭合承重问题；Comet 只持有一个评审作业。按 E03/E04 验证需求/设计改变后保守失效，不扩展测试 T 为未经要求的相同 quorum。
- [ ] 3.1 指定业务试点仓库、owner、目标验证环境、所需身份和 UI/API/持久化/权限负向 AC；冻结 Product/Design/TestContract/PlanBundle（A01/A15）。无生产副作用。
- [ ] 3.2 Comet 单一主控安排角色和开发任务，独立 Whitebox 执行真实业务读回；验证弱测试回作者、产品缺陷回 Builder、环境缺口回适配器、候选改变重验（B01–B07/F08）。不批量改 vendored 技能，必要升级另做显式替换。
- [ ] 3.3 重复/乱序回执、旧 attempt/epoch、并发推进、断点恢复与失联调和；保留真实日志和持久化读回（A10–A12/F07）。只承诺已验证单环境语义。
- [ ] 3.4 Spec Adapter 在临时真实 OpenSpec 项目演练预演、全场景保留、并发漂移阻断、archive 中断恢复和主 specs 读回（A11/B08）。唯一归档写者，不重复 sync。
- [ ] 4.1 受保护 required checks 对精确集成 SHA 重算契约/来源；缺项、skip、超时、旧证据实际阻断平台合并（A13/F06/F09）。检查策略来自受保护基线。
- [ ] 4.2 隔离环境构建并提升同 digest，验证 tag 漂移拒绝、部署超时查询、不重复部署、批准回滚及业务读回（A14–A17/F09）。生产授权不包含在本任务中。
- [ ] 4.3 四层证据分别归档索引，确认目标环境后才声明 delivered，代码验收/规格归档/部署状态分开（B10）。bash scripts/check.sh 与真实平台记录共同验收。
- [ ] 4.4 按已确认 R06 关闭策略验证 E01/E02/E06：必需项目知识、OpenSpec 归档、Outline 发布与整体完成分别核验；已归档而未发布时同一 Run 继续收尾，超时先读回，不能用知识失败重复部署或产生 archive/publish 循环。
- [ ] 4.5 若采用项目生命周期 hook 辅助，按 hooks.yaml 唯一策略源注册并做三者共存/原生装配验证；Ponytail 不改业务 phase、不派发共识、不签验收。覆盖 E05/E06 的 hook 缺失、静默失败、重开/压缩/子会话与 mode 串扰。原生支持和真实运行分别报告，不直接改插件缓存。
- [ ] 4.6 按 classic-post-archive-recovery.md 覆盖 H01–H09：归档后 pending Run 的发现/选择/恢复、同 key 原子领取、固定 Outline UUID、lastRevision 冲突、旧回调/会话重复、原生 clear-current/完成误判与工作区清理；验证实际部署的 API/MCP 参数暴露。复用既有 Comet Run/锁/事务，不向 Ponytail 添加业务派发；R01 固定受管 Runner 与 R10 A 已确认；实际 Runner/恢复能力仍须实证。
- [ ] 4.7 按 knowledge-preauthorization-contract.md，在真实受管源/目标中验证 U01–U08：有效 owner/委托与可信签发、grant 撤销/过期、多源披露交集、完整 principal 映射、目标继承/单页/公开分享、写前版本重验、作者/审查/Publisher/issuer 隔离与正向自动发布。先登记试点源域/目标/真实 owner，不能只用 schema/自签 JSON/管理员可读证明权限继承。
- [ ] 4.8 G14 已选事件＋周期核验；G15 已确认 A（正常依赖下 5 分钟目标，故障允许超时并留痕）；细分预算准入及隔离授权确认后，按 knowledge-revocation-and-restoration.md 验证 L01–L11：来源变化影响闭包、两种期限、资源端真实隔离、完成后维护、重复乱序/失败恢复和新授权恢复。受控 MCP 与 Outline Web/分享/搜索/附件等 required 渠道分别证明；没有覆盖不能标隔离完成，监听器只交事件不成为主控；实测漏报、完整扫描超时、Runner 宕机、隔离失败告警/重试及恢复补偿，告警与资源端隔离时限分别报告。
- [ ] 5.1 并行 worktree/DAG 集成与父目标重验，逐宿主认证能力矩阵；不同平台不得相互推断支持（A09–A12/F03/F08）。
- [ ] 5.2 仅在跨机器需求确认后建设 services/delivery-control/，复用 PostgreSQL/证据存储/身份服务；先 RED 测项目隔离、撤权、备份恢复、API 断联阻断，再 GREEN（F10）。API 不接管步骤调度。
- [ ] 5.3 核实 Comet 受管驱动的租约/fencing/后台运行能力；不满足则记录边界并复审，禁止共享本地目录假装分布式。完成版本回退与运维手册。

## Schema2 执行任务投影

### Task P0_1: 原任务 0.1 — 收敛 v3.1 与 Foundation 后续修订，写唯一目标架构、ADR 提案、现有资产迁移表；证据：docs/architecture/delivery-architecture.md 与 ADR-0019。

**Files:** docs/architecture/delivery-architecture.md, docs/architecture/adr/0019-delivery-foundation.md
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** none
**Owns:** docs/architecture/delivery-architecture.md, docs/architecture/adr/0019-delivery-foundation.md
**Parallel safe:** false
**Acceptance IDs:** A01

- [x] **Step 1 [3 min]: Record** 原任务0.1已有文档/审查证据，原完成状态保留；证据来源 本文件“原任务状态与机械别名”逐项列明的仓库文档与 architecture-review/receipt.json，不声称产品测试通过。

### Task P0_2: 原任务 0.2 — 写 proposal/design/spec/tasks，并保留 A01–A20、B01–B10、F01–F10 共 40 项 Given/When/Then 场景；证据：specs/delivery-foundation/spec.md。

**Files:** openspec/changes/delivery-foundation-rearchitecture/proposal.md, openspec/changes/delivery-foundation-rearchitecture/design.md, openspec/changes/delivery-foundation-rearchitecture/specs/delivery-foundation/spec.md
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_1
**Owns:** openspec/changes/delivery-foundation-rearchitecture/proposal.md, openspec/changes/delivery-foundation-rearchitecture/design.md, openspec/changes/delivery-foundation-rearchitecture/specs/delivery-foundation/spec.md
**Parallel safe:** false
**Acceptance IDs:** A01

- [x] **Step 1 [3 min]: Record** 原任务0.2已有文档/审查证据，原完成状态保留；证据来源 本文件“原任务状态与机械别名”逐项列明的仓库文档与 architecture-review/receipt.json，不声称产品测试通过。

### Task P0_3: 原任务 0.3 — 同步 README、AGENTS、旧架构入口和能力状态，执行 openspec validate delivery-foundation-rearchitecture --strict、bash scripts/check.sh、git diff --check；记录真实结果到 verification.md。

**Files:** README.md, AGENTS.md, docs/architecture/scaffold-architecture.md, docs/agent/skill-architecture.md
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_2
**Owns:** README.md, AGENTS.md, docs/architecture/scaffold-architecture.md, docs/agent/skill-architecture.md
**Parallel safe:** false
**Acceptance IDs:** B10

- [x] **Step 1 [3 min]: Record** 原任务0.3已有文档/审查证据，原完成状态保留；证据来源 本文件“原任务状态与机械别名”逐项列明的仓库文档与 architecture-review/receipt.json，不声称产品测试通过。

### Task P0_4: 原任务 0.4 — 架构评审确认 ADR-0019 和目标所有权，独立共识票绑定同一摘要；未完成不把 proposed 改为 accepted。

**Files:** docs/architecture/adr/0019-delivery-foundation.md, openspec/changes/delivery-foundation-rearchitecture/architecture-review
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_3
**Owns:** docs/architecture/adr/0019-delivery-foundation.md, openspec/changes/delivery-foundation-rearchitecture/architecture-review
**Parallel safe:** false
**Acceptance IDs:** E03, E04

- [x] **Step 1 [3 min]: Record** 原任务0.4已有文档/审查证据，原完成状态保留；证据来源 本文件“原任务状态与机械别名”逐项列明的仓库文档与 architecture-review/receipt.json，不声称产品测试通过。

### Task P1_1: 原任务 1.1 — 固定 TeamAI、Comet、OpenSpec、共同工具链实际分发产物版本和完整性；读取实际命令版本并运行最小探针（F01/F03）。源码 commit 不代替 npm 产物。

**Files:** openspec/changes/delivery-foundation-rearchitecture/toolchain-baseline.json, openspec/changes/delivery-foundation-rearchitecture/package-probes, integrations/comet/upstream.lock.json, test/delivery-cases/1_1.mjs, tools/comet/source.js, tools/comet/prepare-source.mjs, tools/comet/build.mjs, test/comet-source-preparation.test.js, test/comet-build.test.js
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state; Comet.SourcePreparation.v1: prepareCometSource({projectRoot,lock,archivePath}) returns canonical pristine source and verified provenance; Comet.DistributionBuild.v1: buildCometDistribution({projectRoot,lock,archivePath}) returns buildRoot, entrypoint, sourceCommit, fingerprint with exact toolchain precondition
**Dependencies:** P0_4
**Owns:** openspec/changes/delivery-foundation-rearchitecture/toolchain-baseline.json, openspec/changes/delivery-foundation-rearchitecture/package-probes, integrations/comet/upstream.lock.json, test/delivery-cases/1_1.mjs, tools/comet/source.js, tools/comet/prepare-source.mjs, tools/comet/build.mjs, test/comet-source-preparation.test.js, test/comet-build.test.js
**Parallel safe:** false
**Acceptance IDs:** F01, F03

- [x] **Step 1 [5 min]: Test** 1.1.a 固定实际发行产物：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：复核既有 Comet 0.4.5 integrity，补 TeamAI/OpenSpec/Node/宿主/技能摘要；历史下载不等于运行通过。
- [x] **Step 2 [5 min]: Implement** 1.1.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 3 [5 min]: Test** 1.1.b 隔离运行版本与兼容探针：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：真实运行 version/status/最小调用；重放旧 OpenSpec 依赖字段失败并记录兼容矩阵，不全局升级。
- [x] **Step 4 [5 min]: Implement** 1.1.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 5 [5 min]: Test** 1.1.c 明确 Comet 扩展交付位置：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：定位固定产物对应源码/测试目录、补丁构建与分发方式；不在插件缓存或 .agents 技能正文中修 Runtime。
- [x] **Step 6 [5 min]: Implement** 1.1.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [x] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P1_6: 原任务 1.6 — 按 matt-method-profile-migration.md 显式解决本仓库旧 planner/Comet Classic 的 Superpowers 硬依赖和初始化安装路径；固定 Matt 基础方法与必要专门技能快照。按 M01/M02 验证全局停用不被重启、没有嵌套 planner/implement-spec controller；不修改上游正文或用本机软链接分发。

**Files:** .agents/skills, docs/agent/skill-architecture.md, openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json, integrations/comet/patches/0001-matt-method-profile.patch, test/delivery-cases/1_6.mjs, integrations/comet/patches/tests/1_6.patch
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_1
**Owns:** .agents/skills, docs/agent/skill-architecture.md, openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json, integrations/comet/patches/0001-matt-method-profile.patch, test/delivery-cases/1_6.mjs, integrations/comet/patches/tests/1_6.patch
**Parallel safe:** false
**Acceptance IDs:** M01, M02, B01, B09

- [x] **Step 1 [5 min]: Test** 1.6.a 选择兼容的方法导出入口：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：保留旧 plan_guard 负例，固定去 Superpowers 且无第二 controller 的方法/校验协议；若共享新版仍拥有 controller，不能直接全量引入。
- [x] **Step 2 [5 min]: Implement** 1.6.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 3 [5 min]: Test** 1.6.b 显式替换真实目录快照：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：按技能层 AGENTS 和升级纪律引入选定 planner/test-authoring/Whitebox/Matt 内容与摘要，保留来源，不手改上游正文。
- [x] **Step 4 [5 min]: Implement** 1.6.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Test** 1.6.c 修改 Classic 方法及初始化集成：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：在 1.1.c 确定的源码交付处替换硬安装/硬调用；新会话实际证明不重启 Superpowers、无 planner/implement-spec 重复派发。
- [x] **Step 6 [5 min]: Implement** 1.6.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [x] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P1_2: 原任务 1.2 — 在临时隔离配置先 RED 复现双写/漂移负例，再实现 exporter 与 FoundationLock；验证正反序 bootstrap/init、重复 pull、升级、卸载、用户条目与 matcher 注册（F02/F04/B09）。不得修改活配置。

**Files:** foundation, tools/foundation-export.mjs, tools/bootstrap.sh, tools/adapters/claude-code.sh, test/foundation-distribution.test.js, hooks.yaml, test/delivery-cases/1_2.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_6
**Owns:** foundation, tools/foundation-export.mjs, tools/bootstrap.sh, tools/adapters/claude-code.sh, test/foundation-distribution.test.js, hooks.yaml, test/delivery-cases/1_2.mjs
**Parallel safe:** false
**Acceptance IDs:** F02, F04, B09

- [x] **Step 1 [5 min]: Test** 1.2.a 实现资产 exporter 与 FoundationLock：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：RED：缺摘要/机器路径/浮动版本拒绝；GREEN：仅从技能、hooks、MCP 唯一源生成发布视图。
- [x] **Step 2 [5 min]: Implement** 1.2.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 3 [5 min]: Test** 1.2.b 验证组合幂等与受管块移交：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：隔离配置验证正反序初始化、重复 pull、升级/卸载；脚本行为和 settings matcher 同测，用户条目不丢。
- [x] **Step 4 [5 min]: Implement** 1.2.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 5 [5 min]: Test** 1.2.c 验证旧 Run 固定资产及回退：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：升级后旧 Run 保留原方法/策略/工具摘要；不能保持则阻断并显式迁移，不静默换基线。
- [x] **Step 6 [5 min]: Implement** 1.2.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [x] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P1_3: 原任务 1.3 — 验证 Comet 单主控模式、受管驱动、OpenSpec 接入、不可省略检查集合、独立验证回执和唯一 closeout owner（TeamAI 只验证分发）；真实渠道探针覆盖编辑/Shell/MCP（F05/F07/A09）。失败 NO-GO，不扩建第二调度器。

**Files:** lib/adapters/comet.js, lib/adapters/harness.js, test/comet-driver.test.js, openspec/changes/delivery-foundation-rearchitecture/host-probes, test/delivery-cases/1_3.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_2, I02
**Owns:** lib/adapters/comet.js, lib/adapters/harness.js, test/comet-driver.test.js, openspec/changes/delivery-foundation-rearchitecture/host-probes, test/delivery-cases/1_3.mjs
**Parallel safe:** false
**Acceptance IDs:** F05, F07, A09

- [ ] **Step 1 [5 min]: Test** 1.3.a 验证固定 Runner 与 Run 绑定：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：确定 authority/workspace/execution 真实接口，写 driver 能写、只读 driver 不能冒充实现；Runner 不另存 phase。
- [ ] **Step 2 [5 min]: Implement** 1.3.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 1.3.b 逐渠道实证写入约束：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：编辑、Shell、MCP 分别尝试越阶段写入；记录已拒绝或能力缺口，不能仅测一条渠道。
- [ ] **Step 4 [5 min]: Implement** 1.3.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Test** 1.3.c 确认 Spec 与验证的唯一 owner：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：一次验证执行和一次规格收尾；拒绝重复 controller/重复归档，不支持即 NO-GO。
- [ ] **Step 6 [5 min]: Implement** 1.3.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P1_4: 原任务 1.4 — 基于固定 Comet 发行包比较 Classic/Native；验证无关成功命令、漏必需检查、旧/手工回执、普通执行可达的跳过/运维逃生路径均不能放行受管交付；确认内置项目记忆与 LLMWiki/Outline 唯一知识源不冲突。所需扩展先评审，不以提示词充当不可绕过性。证据范围参见 comet-single-controller-review.md。

**Files:** openspec/changes/delivery-foundation-rearchitecture/mode-qualification.json, openspec/changes/delivery-foundation-rearchitecture/mode-probes, test/delivery-cases/1_4.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_3
**Owns:** openspec/changes/delivery-foundation-rearchitecture/mode-qualification.json, openspec/changes/delivery-foundation-rearchitecture/mode-probes, test/delivery-cases/1_4.mjs
**Parallel safe:** false
**Acceptance IDs:** C07, F06, M01

- [ ] **Step 1 [5 min]: Test** 1.4.a 固定两模式能力差异与 Classic 准入：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：保留 Classic 既定接入设计，Native 仅兼容/能力对照，不自动切换路径。
- [ ] **Step 2 [5 min]: Implement** 1.4.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 1.4.b 复现漏检查/伪回执/逃生路径：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：把无关成功命令、旧/手工回执、跳过入口做真实负例；原生缺口写扩展验收，不改判定转绿。
- [ ] **Step 4 [5 min]: Implement** 1.4.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Test** 1.4.c 确认知识主库边界：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：Comet 自有记忆不覆盖 LLMWiki/Outline/DeepWiki；不能禁用或隔离时不启用冲突功能。
- [ ] **Step 6 [5 min]: Implement** 1.4.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P2_1: 原任务 2.1 — contracts/delivery/ 定义共享 schema；lib/delivery/ 实现全输入基线与 AC→case 追踪。先 RED 验证缺基线、零测试、错误 RED、非 JS 文件漂移，再 GREEN 实现（A01–A04/A07–A08）。node --test 目标测试和 npm test。

**Files:** contracts/delivery, lib/delivery/baseline.js, lib/delivery/test-contract.js, test/delivery-baseline.test.js, test/delivery-test-contract.test.js, test/delivery-cases/2_1.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_1
**Owns:** contracts/delivery, lib/delivery/baseline.js, lib/delivery/test-contract.js, test/delivery-baseline.test.js, test/delivery-test-contract.test.js, test/delivery-cases/2_1.mjs
**Parallel safe:** false
**Acceptance IDs:** A01, A02, A03, A04, A07, A08

- [x] **Step 1 [5 min]: Test** 2.1.a 定义共享契约及版本：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：FoundationLock/BaselineRef/TestContract/PlanBundle/CandidateRef/EvidenceEnvelope/GateReceipt/ReleaseReceipt 输入、错误与兼容边界。
- [x] **Step 2 [5 min]: Implement** 2.1.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 3 [5 min]: Test** 2.1.b 实现全输入绑定和追踪：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：先 RED 非 JS/锁文件/迁移漂移与 AC→case 缺项，再 GREEN；tasks 定义摘要与进度勾选分离。
- [x] **Step 4 [5 min]: Implement** 2.1.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 5 [5 min]: Test** 2.1.c 实现有效 RED 与执行分母检查：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：零测试/全 skip/环境失败拒绝；不通过造测试数量闭合行为覆盖。
- [x] **Step 6 [5 min]: Implement** 2.1.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [x] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P1_5: 原任务 1.5 — 按 classic-integration-design.md 验证 R/A/T 分离、P 计划单一权威、V 独立回执及 Kp/Kt 读回门禁；覆盖 C01–C08 的正常与旁路/恢复负例。先在隔离工具环境解决实际 OpenSpec 兼容失败，固定 test-authoring/Whitebox/planner 分发内容；不得改活配置或直接升全局工具。

**Files:** test/classic-integration.test.js, openspec/changes/delivery-foundation-rearchitecture/classic-integration-probes, test/delivery-cases/1_5.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_4, P2_1
**Owns:** test/classic-integration.test.js, openspec/changes/delivery-foundation-rearchitecture/classic-integration-probes, test/delivery-cases/1_5.mjs
**Parallel safe:** false
**Acceptance IDs:** C01, C02, C03, C04, C05, C06, C07, C08

- [ ] **Step 1 [5 min]: Test** 1.5.a 验证 OpenSpec/TestPack/计划引用映射：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：固定兼容环境，tasks 唯一可写；Classic plan 为派生只读视图，不双写 checkbox。
- [ ] **Step 2 [5 min]: Implement** 1.5.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 1.5.b 按真实入口建立扩展 RED 基线：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：C01–C08 覆盖 R/A/T/P/V/K 以及恢复/旁路；保留原生不能阻断的证据，交 2.4 实现。
- [ ] **Step 4 [5 min]: Implement** 1.5.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P2_2: 原任务 2.2 — 实现 EvidenceEnvelope/来源准入和 GateReceipt；先 RED 拒绝自签 pass、同执行身份、旧 policy/环境/输入摘要、缺观察能力，再 GREEN（A05–A06/A18–A19/B03/B06–B07）。可信来源单独实测，schema 夹具不冒充认证。

**Files:** lib/delivery/evidence.js, lib/delivery/gate.js, test/delivery-evidence.test.js, test/delivery-gate.test.js, test/delivery-cases/2_2.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_1
**Owns:** lib/delivery/evidence.js, lib/delivery/gate.js, test/delivery-evidence.test.js, test/delivery-gate.test.js, test/delivery-cases/2_2.mjs
**Parallel safe:** false
**Acceptance IDs:** A05, A06, A18, A19, B03, B06, B07

- [x] **Step 1 [5 min]: Test** 2.2.a 实现证据准入与身份绑定：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：RED 自签、同 execution、旧 policy/候选/环境；GREEN 固定派发来源，不信角色标签。
- [x] **Step 2 [5 min]: Implement** 2.2.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 3 [5 min]: Test** 2.2.b 实现纯 Gate 求值与拒绝原因：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：缺能力/未验证/观察项不完整保持阻断；只返回判定与回执，不派发、不保存 current-stage。
- [x] **Step 4 [5 min]: Implement** 2.2.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 5 [5 min]: Test** 2.2.c 验证受保护来源边界：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：夹具只证结构；可信 Runner 登记/发布密钥隔离由真实权限负例另证，不夸大本机文件锁。
- [x] **Step 6 [5 min]: Implement** 2.2.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [x] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P2_3: 原任务 2.3 — 保留旧 CLI 和报告 adapter；验证错误输入退出 1、验收失败退出 2、有效检查退出 0，旧 npm test 及 bash scripts/check.sh 通过（B10/A20）。

**Files:** bin/cli.js, lib/adapters/legacy-evidence.js, test/delivery-cli.test.js, test/delivery-cases/2_3.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_2
**Owns:** bin/cli.js, lib/adapters/legacy-evidence.js, test/delivery-cli.test.js, test/delivery-cases/2_3.mjs
**Parallel safe:** false
**Acceptance IDs:** A20, B10

- [x] **Step 1 [5 min]: Test** 2.3.a 增量暴露检查 CLI 与旧报告适配：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：保持既有命令；测试 0/1/2 和 JSON 结果；字段缺失或版本不兼容明确拒绝。
- [x] **Step 2 [5 min]: Implement** 2.3.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 3 [5 min]: Test** 2.3.b 运行兼容回归：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：node --test test/*.test.js、npm test、bash scripts/check.sh；关闭 CodeGraph/RTK 后正确性仍成立。
- [x] **Step 4 [5 min]: Implement** 2.3.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [x] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P2_4: 原任务 2.4 — 按 classic-gate-runtime-contract.md 评审并最小扩展同一 Classic 的 policy/receipt/evaluate、共同转换条件、受管写入、resolver/continuation、状态事务和 archive/completed；先用 D01–D08 真实入口负例复现，再实现阻断/返工/失效与恢复。A/T 采用独立自动审查；不得新建第二阶段账本，也不得用手改 phase 模拟返工。运行时代码/装配改动需独立评审和完整回归，当前仅计划。

**Files:** integrations/comet/patches/0002-managed-delivery-runtime.patch, test/delivery-cases/2_4.mjs, integrations/comet/patches/tests/2_4.patch
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_5, P2_3
**Owns:** integrations/comet/patches/0002-managed-delivery-runtime.patch, test/delivery-cases/2_4.mjs, integrations/comet/patches/tests/2_4.patch
**Parallel safe:** false
**Acceptance IDs:** D01, D02, D03, D04, D05, D06, D07, D08, C07

- [ ] **Step 1 [5 min]: Test** 2.4.a 接入共同 policy/receipt/evaluate：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：只在 1.1.c 确定的同一 Runtime 扩展；Guard、直接转换、受管写入共用谓词。
- [ ] **Step 2 [5 min]: Implement** 2.4.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 2.4.b 扩展同 Run 的 R/A/T/P/V 接纳与返工：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：来源/attempt/摘要接纳、固定修复路由、短锁登记→长执行→短锁接纳，不持锁等网络。
- [ ] **Step 4 [5 min]: Implement** 2.4.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Test** 2.4.c 实现保守失效：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：需求/设计改动全部下游失效；正常代码写入只失效候选相关证据；进度勾选不循环失效 P。
- [ ] **Step 6 [5 min]: Implement** 2.4.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 7 [5 min]: Test** 2.4.d 接入 resolver/恢复/完成事务：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：中断、并发接纳、archived 但缺必需义务不能 completed；复用原 Run/锁/事务，不造第二账本。
- [ ] **Step 8 [5 min]: Implement** 2.4.d 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 9 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 10 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P2_5: 原任务 2.5 — 架构 A 接入 grill-me 加独立全票共识：冻结审查包、保持 exact quorum/阈值/同摘要、绑定真实机械 tally/finalize、拒绝旧票/缺票/多数票和未闭合承重问题；Comet 只持有一个评审作业。按 E03/E04 验证需求/设计改变后保守失效，不扩展测试 T 为未经要求的相同 quorum。

**Files:** lib/adapters/architecture-review.js, test/architecture-review-adapter.test.js, test/delivery-cases/2_5.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_4
**Owns:** lib/adapters/architecture-review.js, test/architecture-review-adapter.test.js, test/delivery-cases/2_5.mjs
**Parallel safe:** false
**Acceptance IDs:** E03, E04, H06

- [ ] **Step 1 [5 min]: Test** 2.5.a 接入架构质询和冻结审查包：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：grill-me 承重问题闭合后才提交；真实 quorum/阈值/policy 绑定审查包 digest。
- [ ] **Step 2 [5 min]: Implement** 2.5.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 2.5.b 消费机械共识结果与恢复原作业：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：缺票/拒绝/旧摘要不放行；同 job_key 不重复评审，T 保持单独自动审查。
- [ ] **Step 4 [5 min]: Implement** 2.5.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P3_1: 原任务 3.1 — 指定业务试点仓库、owner、目标验证环境、所需身份和 UI/API/持久化/权限负向 AC；冻结 Product/Design/TestContract/PlanBundle（A01/A15）。无生产副作用。

**Files:** openspec/changes/delivery-foundation-rearchitecture/pilot-contract.md, tools/verify/delivery-journey.mjs, tools/verify/delivery-case-schema.json, test/delivery-cases/3_1.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_4, I04
**Owns:** openspec/changes/delivery-foundation-rearchitecture/pilot-contract.md, tools/verify/delivery-journey.mjs, tools/verify/delivery-case-schema.json, test/delivery-cases/3_1.mjs
**Parallel safe:** false
**Acceptance IDs:** A01, A15

前置：PILOT_SCOPE_OWNER_ENVIRONMENT_REQUIRED。登记/权限缺失只阻断相关动作；不得把计划字段当已满足。

- [x] **Step 1 [5 min]: Test** 3.1.a 登记试点与身份：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：业务仓库、owner、固定 Runner、隔离环境、UI/API/持久化和权限负向 AC；未登记不派发真实副作用。
- [x] **Step 2 [5 min]: Implement** 3.1.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 3 [5 min]: Test** 3.1.b 冻结产品/设计/测试/计划输入：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：复用已有确认，给每个 case 独立 oracle/数据/环境/清理；原生浏览器能力先发现。
- [x] **Step 4 [5 min]: Implement** 3.1.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [x] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P3_4: 原任务 3.4 — Spec Adapter 在临时真实 OpenSpec 项目演练预演、全场景保留、并发漂移阻断、archive 中断恢复和主 specs 读回（A11/B08）。唯一归档写者，不重复 sync。

**Files:** lib/adapters/spec.js, test/spec-closeout.test.js, test/delivery-cases/3_4.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_4
**Owns:** lib/adapters/spec.js, test/spec-closeout.test.js, test/delivery-cases/3_4.mjs
**Parallel safe:** false
**Acceptance IDs:** A11, B08

- [x] **Step 1 [5 min]: Test** 3.4.a 实现唯一 Spec Adapter：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：真实临时 OpenSpec 工程预演、目标摘要、MODIFIED 全场景保留；明确 archive 已含 sync 时不再重复 sync。
- [x] **Step 2 [5 min]: Implement** 3.4.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 3 [5 min]: Test** 3.4.b 验证冲突与中断读回：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：主 specs 并发改动阻断；移动前后故障恢复原事务；归档后重新读回场景与稳定 Run 引用。
- [x] **Step 4 [5 min]: Implement** 3.4.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [x] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [x] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P3_2: 原任务 3.2 — Comet 单一主控安排角色和开发任务，独立 Whitebox 执行真实业务读回；验证弱测试回作者、产品缺陷回 Builder、环境缺口回适配器、候选改变重验（B01–B07/F08）。不批量改 vendored 技能，必要升级另做显式替换。

**Files:** openspec/changes/delivery-foundation-rearchitecture/pilot-journey, test/delivery-cases/3_2.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_5, P3_1, P3_4
**Owns:** openspec/changes/delivery-foundation-rearchitecture/pilot-journey, test/delivery-cases/3_2.mjs
**Parallel safe:** false
**Acceptance IDs:** B01, B02, B03, B04, B05, B06, B07, F08, A15

- [ ] **Step 1 [5 min]: Test** 3.2.a 跑一次同 Run 的真实角色链：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：测试作者只改授权测试；Builder 实现；Reviewer/Whitebox 独立，关联动作/请求/持久读回。
- [ ] **Step 2 [5 min]: Implement** 3.2.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 3.2.b 验证实际返工：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：弱 oracle 回作者、产品缺陷回 Builder、环境缺口回适配；新候选重验，不修改冻结候选后自评。
- [ ] **Step 4 [5 min]: Implement** 3.2.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P3_3: 原任务 3.3 — 重复/乱序回执、旧 attempt/epoch、并发推进、断点恢复与失联调和；保留真实日志和持久化读回（A10–A12/F07）。只承诺已验证单环境语义。

**Files:** openspec/changes/delivery-foundation-rearchitecture/pilot-recovery, test/delivery-cases/3_3.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P3_2
**Owns:** openspec/changes/delivery-foundation-rearchitecture/pilot-recovery, test/delivery-cases/3_3.mjs
**Parallel safe:** false
**Acceptance IDs:** A10, A11, A12, F07

- [ ] **Step 1 [5 min]: Test** 3.3.a 运行并发/重复/乱序/旧 epoch 负例：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：同 key 只派发一次，旧回调拒绝，父 Journey 失败不因子任务通过而放行。
- [ ] **Step 2 [5 min]: Implement** 3.3.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 3.3.b 杀进程后恢复并读回：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：保存真实进程、Run/候选身份与持久状态；恢复原 operation，不重开叶子任务。
- [ ] **Step 4 [5 min]: Implement** 3.3.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P4_1: 原任务 4.1 — 受保护 required checks 对精确集成 SHA 重算契约/来源；缺项、skip、超时、旧证据实际阻断平台合并（A13/F06/F09）。检查策略来自受保护基线。

**Files:** .github/workflows/delivery-gate.yml, tools/ci/verify-delivery.mjs, test/ci-delivery-gate.test.js, test/delivery-cases/4_1.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P3_3, I06
**Owns:** .github/workflows/delivery-gate.yml, tools/ci/verify-delivery.mjs, test/ci-delivery-gate.test.js, test/delivery-cases/4_1.mjs
**Parallel safe:** false
**Acceptance IDs:** A13, F06, F09

前置：PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED。登记/权限缺失只阻断相关动作；不得把计划字段当已满足。

- [ ] **Step 1 [5 min]: Test** 4.1.a 实现受保护集成检查入口：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：精确 head/merge SHA 重算、受保护策略/来源；本地 passed 不代替平台 required check。
- [ ] **Step 2 [5 min]: Implement** 4.1.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 4.1.b 实证平台阻断：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：新 SHA、漏项、skip、超时、旧证据真实阻断合并；需平台管理员配置/授权，不只检查 YAML。
- [ ] **Step 4 [5 min]: Implement** 4.1.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P4_2: 原任务 4.2 — 隔离环境构建并提升同 digest，验证 tag 漂移拒绝、部署超时查询、不重复部署、批准回滚及业务读回（A14–A17/F09）。生产授权不包含在本任务中。

**Files:** tools/ci/release.mjs, test/release-protocol.test.js, openspec/changes/delivery-foundation-rearchitecture/release-journey, test/delivery-cases/4_2.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_1
**Owns:** tools/ci/release.mjs, test/release-protocol.test.js, openspec/changes/delivery-foundation-rearchitecture/release-journey, test/delivery-cases/4_2.mjs
**Parallel safe:** false
**Acceptance IDs:** A14, A16, A17, F09

前置：ISOLATED_RELEASE_ENVIRONMENT_REQUIRED。登记/权限缺失只阻断相关动作；不得把计划字段当已满足。

- [ ] **Step 1 [5 min]: Test** 4.2.a 构建并提升同 digest：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：隔离 Registry/环境，拒绝 tag 漂移；保存 integration SHA、实际构建与部署身份。
- [ ] **Step 2 [5 min]: Implement** 4.2.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 4.2.b 超时调和与已批准回滚：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：请求成功但回执丢失先查原对象；独立业务读回与回滚读回，禁止无授权生产发布。
- [ ] **Step 4 [5 min]: Implement** 4.2.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P4_6: 原任务 4.6 — 按 classic-post-archive-recovery.md 覆盖 H01–H09：归档后 pending Run 的发现/选择/恢复、同 key 原子领取、固定 Outline UUID、lastRevision 冲突、旧回调/会话重复、原生 clear-current/完成误判与工作区清理；验证实际部署的 API/MCP 参数暴露。复用既有 Comet Run/锁/事务，不向 Ponytail 添加业务派发；R01 固定受管 Runner 与 R10 A 已确认；实际 Runner/恢复能力仍须实证。

**Files:** integrations/comet/patches/0003-post-archive-closeout.patch, test/delivery-cases/4_6.mjs, integrations/comet/patches/tests/4_6.patch
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P3_3
**Owns:** integrations/comet/patches/0003-post-archive-closeout.patch, test/delivery-cases/4_6.mjs, integrations/comet/patches/tests/4_6.patch
**Parallel safe:** false
**Acceptance IDs:** H01, H02, H03, H04, H05, H06, H07, H08, H09

- [ ] **Step 1 [5 min]: Test** 4.6.a 扩展 pending archived 的发现/选择/输出：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：Git complete 但知识 pending 仍找到原 Run；resolver/status/clear-current 同一完成条件。
- [ ] **Step 2 [5 min]: Implement** 4.6.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 4.6.b 实现原子操作登记和稳定文档身份：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：同 key 领取、owner/attempt、UUID 与 lastRevision 协议；403/超时不当不存在，409 不盲覆盖。
- [ ] **Step 4 [5 min]: Implement** 4.6.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Test** 4.6.c 验证权威环境和安全清理：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：复制状态不能第二写者；按已确认 R10 A，整体 completed 前保留唯一工作区；提前清理或迁移只在另行确认并证明恢复后启用。
- [ ] **Step 6 [5 min]: Implement** 4.6.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P4_7: 原任务 4.7 — 按 knowledge-preauthorization-contract.md，在真实受管源/目标中验证 U01–U08：有效 owner/委托与可信签发、grant 撤销/过期、多源披露交集、完整 principal 映射、目标继承/单页/公开分享、写前版本重验、作者/审查/Publisher/issuer 隔离与正向自动发布。先登记试点源域/目标/真实 owner，不能只用 schema/自签 JSON/管理员可读证明权限继承。

**Files:** lib/adapters/knowledge-authorization.js, test/knowledge-authorization.test.js, openspec/changes/delivery-foundation-rearchitecture/authorization-journey, test/delivery-cases/4_7.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_6, I03
**Owns:** lib/adapters/knowledge-authorization.js, test/knowledge-authorization.test.js, openspec/changes/delivery-foundation-rearchitecture/authorization-journey, test/delivery-cases/4_7.mjs
**Parallel safe:** false
**Acceptance IDs:** U01, U02, U03, U04, U05, U06, U07, U08

前置：SOURCE_TARGET_OWNER_GRANT_REQUIRED。登记/权限缺失只阻断相关动作；不得把计划字段当已满足。

- [ ] **Step 1 [5 min]: Test** 4.7.a 登记源域/目标/owner 与 grant：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：逐主体权力、用途、披露范围、内容/动作、两种期限、撤销；资料外发和目标写入权限分开。
- [ ] **Step 2 [5 min]: Implement** 4.7.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 4.7.b 实现写前真实授权核验：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：多来源交集、完整分页/principal 映射、目标继承/单页/公开受众，未知 fail closed。
- [ ] **Step 4 [5 min]: Implement** 4.7.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Test** 4.7.c 验证身份隔离和预授权内自动发布：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：作者/审查/签发/Publisher 分离，真实正负路径；同一已授权 payload 审查通过自动推进。
- [ ] **Step 6 [5 min]: Implement** 4.7.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 7 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 8 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P4_4: 原任务 4.4 — 按已确认 R06 关闭策略验证 E01/E02/E06：必需项目知识、OpenSpec 归档、Outline 发布与整体完成分别核验；已归档而未发布时同一 Run 继续收尾，超时先读回，不能用知识失败重复部署或产生 archive/publish 循环。

**Files:** lib/adapters/llmwiki.js, lib/adapters/outline.js, lib/adapters/code-wiki.js, lib/sdd-paths.js, tools/mcp/llmwiki.sh, test/knowledge-closeout.test.js, lib/knowledge-seed.js, bin/cli.js, test/delivery-cases/4_4.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_2, P4_7, I04, I05
**Owns:** lib/adapters/llmwiki.js, lib/adapters/outline.js, lib/adapters/code-wiki.js, lib/sdd-paths.js, tools/mcp/llmwiki.sh, test/knowledge-closeout.test.js, lib/knowledge-seed.js, bin/cli.js, test/delivery-cases/4_4.mjs
**Parallel safe:** false
**Acceptance IDs:** C06, D06, D07, E01, E02, E06

前置：CODE_KNOWLEDGE_PROFILE_REQUIRED_IF_MANDATORY。登记/权限缺失只阻断相关动作；不得把计划字段当已满足。

- [ ] **Step 1 [5 min]: Test** 4.4.a 接通 KG0/Kp 与项目知识唯一位置：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：修复 CLI/MCP/worktree 路径分叉；MCP 写入和独立读回、no-update 依据均可核验。
- [ ] **Step 2 [5 min]: Implement** 4.4.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 4.4.b 接通 Kt 与同 Run 发布收尾：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：必需项目知识卡归档，Outline 可归档后继续但卡 completed；未知结果先查远端，不重复部署。
- [ ] **Step 4 [5 min]: Implement** 4.4.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Test** 4.4.c 接通被选为必需的代码知识新鲜度：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：固定 deepwiki-open/Code Graph 产物与精确 commit，按事前 policy 验回执；语言/规模/部署未定的分支保持待准入。
- [ ] **Step 6 [5 min]: Implement** 4.4.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 7 [5 min]: Test** 4.4.d 运行完整关闭矩阵：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：产品接受/项目知识/规格归档/团队发布/目标环境分别读回；不得将测试这个机制的任务循环依赖本 Change 已归档。
- [ ] **Step 8 [5 min]: Implement** 4.4.d 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 9 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 10 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P4_5: 原任务 4.5 — 若采用项目生命周期 hook 辅助，按 hooks.yaml 唯一策略源注册并做三者共存/原生装配验证；Ponytail 不改业务 phase、不派发共识、不签验收。覆盖 E05/E06 的 hook 缺失、静默失败、重开/压缩/子会话与 mode 串扰。原生支持和真实运行分别报告，不直接改插件缓存。

**Files:** hooks.yaml, hooks, tools/adapters/claude-code.sh, test/delivery-hook-assembly.test.js, test/delivery-cases/4_5.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_4
**Owns:** hooks.yaml, hooks, tools/adapters/claude-code.sh, test/delivery-hook-assembly.test.js, test/delivery-cases/4_5.mjs
**Parallel safe:** false
**Acceptance IDs:** E05, E06, H02

- [ ] **Step 1 [5 min]: Test** 4.5.a 按需生成只读恢复 hook：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：Ponytail 仅方法提示；项目策略只来自 hooks.yaml，不改插件缓存或借 mode 授权。
- [ ] **Step 2 [5 min]: Implement** 4.5.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 4.5.b 验证脚本与 matcher 装配：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：共存、重复启动/压缩/子会话、hook 静默失败；门禁仍阻断且不重复共识/发布。
- [ ] **Step 4 [5 min]: Implement** 4.5.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P4_8: 原任务 4.8 — G14 已选事件＋周期核验；G15 已确认 A（正常依赖下 5 分钟目标，故障允许超时并留痕）；细分预算准入及隔离授权确认后，按 knowledge-revocation-and-restoration.md 验证 L01–L11：来源变化影响闭包、两种期限、资源端真实隔离、完成后维护、重复乱序/失败恢复和新授权恢复。受控 MCP 与 Outline Web/分享/搜索/附件等 required 渠道分别证明；没有覆盖不能标隔离完成，监听器只交事件不成为主控；实测漏报、完整扫描超时、Runner 宕机、隔离失败告警/重试及恢复补偿，告警与资源端隔离时限分别报告。

**Files:** lib/adapters/knowledge-revocation.js, test/knowledge-revocation.test.js, openspec/changes/delivery-foundation-rearchitecture/revocation-journey, test/delivery-cases/4_8.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_4, I07, I08
**Owns:** lib/adapters/knowledge-revocation.js, test/knowledge-revocation.test.js, openspec/changes/delivery-foundation-rearchitecture/revocation-journey, test/delivery-cases/4_8.mjs
**Parallel safe:** false
**Acceptance IDs:** L01, L02, L03, L04, L05, L06, L07, L08, L09, L10, L11

前置：ISOLATION_GRANT_REQUIRED。登记/权限缺失只阻断相关动作；不得把计划字段当已满足。

- [ ] **Step 1 [5 min]: Test** 4.8.a 落实 G15 A 与隔离预授权：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：按已确认 G15 A 冻结正常依赖下 5 分钟隔离目标及故障允许超时/留痕边界，实证细分检测/隔离/告警预算，登记真实 owner 与隔离专用授权；设计确认不代表运行达标。
- [ ] **Step 2 [5 min]: Implement** 4.8.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 4.8.b 实现事件与周期核验入口：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：采集器只交事实，Comet 同一引擎持有维护 operation/重试/影响闭包，不另建 watcher 主控。
- [ ] **Step 4 [5 min]: Implement** 4.8.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Test** 4.8.c 实现资源端隔离和新授权恢复：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：实际 Web/搜索/分享/附件与 MCP 逐渠道读回；不以 stale/unpublish 标签充当不可读。
- [ ] **Step 6 [5 min]: Implement** 4.8.c 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 7 [5 min]: Test** 4.8.d 故障注入并计时：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：漏报/分页超时/Runner 宕机/隔离失败：独立监控告警、监督器重启原实例、Comet 补偿；记录暴露窗口，不暂停计时抹违约。
- [ ] **Step 8 [5 min]: Implement** 4.8.d 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 9 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 10 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P4_3: 原任务 4.3 — 四层证据分别归档索引，确认目标环境后才声明 delivered，代码验收/规格归档/部署状态分开（B10）。bash scripts/check.sh 与真实平台记录共同验收。

**Files:** openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json, openspec/changes/delivery-foundation-rearchitecture/verification.md, test/delivery-cases/4_3.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_5, P4_8
**Owns:** openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json, openspec/changes/delivery-foundation-rearchitecture/verification.md, test/delivery-cases/4_3.mjs
**Parallel safe:** false
**Acceptance IDs:** B10

- [ ] **Step 1 [5 min]: Test** 4.3.a 汇总四层证据和逐场景结论：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：内核、CLI/装配、宿主、业务/CI 分开；每个必验场景有当前版本证据或明确阻塞。
- [ ] **Step 2 [5 min]: Implement** 4.3.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 4.3.b 回归、独立验收与交接：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：全仓检查和平台读回；目标环境确认前不得 delivered，条件性 Batch 5 未做不得声称团队认证。
- [ ] **Step 4 [5 min]: Implement** 4.3.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P5_1: 原任务 5.1 — 并行 worktree/DAG 集成与父目标重验，逐宿主认证能力矩阵；不同平台不得相互推断支持（A09–A12/F03/F08）。

**Files:** openspec/changes/delivery-foundation-rearchitecture/team-host-matrix, test/delivery-cases/5_1.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_3
**Owns:** openspec/changes/delivery-foundation-rearchitecture/team-host-matrix, test/delivery-cases/5_1.mjs
**Parallel safe:** false
**Acceptance IDs:** A09, A10, A11, A12, F03, F08

条件性启用门：只有逐宿主/跨机器范围被明确启用后才实施对应团队能力；启用前真实验证拒绝启动/拒绝发布。未执行的正向隔离恢复认证保留 UNVERIFIED，不能以“未启用”判F10通过。

- [ ] **Step 1 [5 min]: Test** 5.1.a 多 worktree/DAG 有序集成：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：隔离任务并行、串行集成、父目标真实重验；子 green 不等于父目标通过。
- [ ] **Step 2 [5 min]: Implement** 5.1.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 5.1.b 逐宿主认证：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：每个宿主的发现、写保护、浏览器证据与恢复分别证明，不跨平台推断支持。
- [ ] **Step 4 [5 min]: Implement** 5.1.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P5_2: 原任务 5.2 — 仅在跨机器需求确认后建设 services/delivery-control/，复用 PostgreSQL/证据存储/身份服务；先 RED 测项目隔离、撤权、备份恢复、API 断联阻断，再 GREEN（F10）。API 不接管步骤调度。

**Files:** services/delivery-control, test/delivery-control.test.js, test/delivery-cases/5_2.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P5_1
**Owns:** services/delivery-control, test/delivery-control.test.js, test/delivery-cases/5_2.mjs
**Parallel safe:** false
**Acceptance IDs:** F10

前置：CROSS_MACHINE_SCOPE_NOT_ENABLED。登记/权限缺失只阻断相关动作；不得把计划字段当已满足。

条件性启用门：只有逐宿主/跨机器范围被明确启用后才实施对应团队能力；启用前真实验证拒绝启动/拒绝发布。未执行的正向隔离恢复认证保留 UNVERIFIED，不能以“未启用”判F10通过。

- [ ] **Step 1 [5 min]: Test** 5.2.a 跨机器需求确认后才启用 API：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：复用既有 PostgreSQL/身份/存储；API 只管证据、审批、回执，不接管执行步骤。
- [ ] **Step 2 [5 min]: Implement** 5.2.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 5.2.b 权限/断联/备份恢复实证：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：项目隔离、撤权、恢复后权限及 API 断联拒绝缓存绿灯，真实负例与恢复读回。
- [ ] **Step 4 [5 min]: Implement** 5.2.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task P5_3: 原任务 5.3 — 核实 Comet 受管驱动的租约/fencing/后台运行能力；不满足则记录边界并复审，禁止共享本地目录假装分布式。完成版本回退与运维手册。

**Files:** openspec/changes/delivery-foundation-rearchitecture/operations-runbook.md, openspec/changes/delivery-foundation-rearchitecture/team-recovery, test/delivery-cases/5_3.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P5_2, I08
**Owns:** openspec/changes/delivery-foundation-rearchitecture/operations-runbook.md, openspec/changes/delivery-foundation-rearchitecture/team-recovery, test/delivery-cases/5_3.mjs
**Parallel safe:** false
**Acceptance IDs:** A10, A11, H09

条件性启用门：只有逐宿主/跨机器范围被明确启用后才实施对应团队能力；启用前真实验证拒绝启动/拒绝发布。未执行的正向隔离恢复认证保留 UNVERIFIED，不能以“未启用”判F10通过。

- [ ] **Step 1 [5 min]: Test** 5.3.a 逐项核实租约/fencing/后台驱动：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：不共享挂载本地状态冒充分布式；缺能力写限制并复审。
- [ ] **Step 2 [5 min]: Implement** 5.3.a 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 3 [5 min]: Test** 5.3.b 演练版本回退与权威环境迁移：先实际复现失败并保存 oracle/命令/输入/日志；验收边界：停旧写者、调和 pending、迁移完整状态、验证新归属；保留旧产物和历史证据。
- [ ] **Step 4 [5 min]: Implement** 5.3.b 在该包归属内作最小GREEN实现，运行对应真实检查和回归；不接受环境失败、零执行、mock或旧候选代替目标行为。
- [ ] **Step 5 [5 min]: Review** 按当前候选独立审查本任务全部工作包，核对AC、来源/角色与跨边界故障，更新同一父任务证据；未通过保持未勾选。
- [ ] **Step 6 [3 min]: Commit** 审查通过后串行接纳仅本任务授权文件与RED/GREEN/回归证据；工作区已有无关改动不加入提交。

### Task VERIFY: 原任务 VERIFY — 独立 Whitebox Journey、证据 Grill 与逐场景验证报告

**Files:** openspec/changes/delivery-foundation-rearchitecture/verification-report.md, openspec/changes/delivery-foundation-rearchitecture/grill-report.md, openspec/changes/delivery-foundation-rearchitecture/verification-results.json, openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json, openspec/changes/delivery-foundation-rearchitecture/execution-state.json, openspec/changes/delivery-foundation-rearchitecture/execution-ledger.jsonl
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_1, P0_2, P0_3, P0_4, P1_1, P1_6, P1_2, P1_3, P1_4, P2_1, P1_5, P2_2, P2_3, P2_4, P2_5, P3_1, P3_4, P3_2, P3_3, P4_1, P4_2, P4_6, P4_7, P4_4, P4_5, P4_8, P4_3, P5_1, P5_2, P5_3, I01, I02, I03, I04, I05, I06, I07, I08
**Owns:** openspec/changes/delivery-foundation-rearchitecture/verification-report.md, openspec/changes/delivery-foundation-rearchitecture/grill-report.md, openspec/changes/delivery-foundation-rearchitecture/verification-results.json, openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json, openspec/changes/delivery-foundation-rearchitecture/execution-state.json, openspec/changes/delivery-foundation-rearchitecture/execution-ledger.jsonl
**Parallel safe:** false
**Acceptance IDs:** A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, A15, A16, A17, A18, A19, A20, B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, C01, C02, C03, C04, C05, C06, C07, C08, D01, D02, D03, D04, D05, D06, D07, D08, E01, E02, E03, E04, E05, E06, F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, H01, H02, H03, H04, H05, H06, H07, H08, H09, L01, L02, L03, L04, L05, L06, L07, L08, L09, L10, L11, M01, M02, U01, U02, U03, U04, U05, U06, U07, U08

- [ ] **Step 1 [5 min]: Test** 在精确集成版本执行 execution-contract.json 每项 required check，保留真实日志、数据及适用截图，缺授权/环境/行为证据保持 UNVERIFIED。
- [ ] **Step 2 [5 min]: Review** 独立 Whitebox Journey 后逐项 Grill92场景及全部69工作包；平台/知识/宿主能力分层报告，关闭全部阻断发现并以新候选复验。
- [ ] **Step 3 [3 min]: Commit** 仅接纳当前版本验证报告、原始证据索引和任务证据更新，不执行本 Change 归档；归档由唯一 Comet closeout owner 在验收后处理。


## 工作包拆解与依赖（本轮新增）

下列路径均为预期改动归属，不表示文件或接口已实现。上游扩展逻辑归属已解析为 integrations/comet 的版本锁与源补丁；这里只记录同一 Comet 源码构建，不创建第二 Runtime。

行为实现每包必须保存失败先行、最小实现、通过回归和独立审查证据；下面的 RED/验收意图不能代替实际执行日志。每个工作包提交只包含其授权范围；不自动提交当前工作区的既有文档改动。任务量与时间估算待探针返回后逐包确定，不把复杂 Runtime 改造承诺为几分钟。

本仓库预期新增 `test/*.test.js` 使用 `node --test <所列测试文件>`；集成检查为 `npm test` 和 `bash scripts/check.sh`。Comet 上游测试命令必须由 1.1.c 查明，不能虚构本仓库 npm test 已覆盖上游。真实环境包另保存执行身份、候选、原始报告和独立读回。

### 0.4 工作包

依赖：已完成的 Batch 0 文档。验收 ID：E03, E04。

预期文件/归属：`docs/architecture/adr/0019-delivery-foundation.md`、`openspec/changes/delivery-foundation-rearchitecture/architecture-review`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 0.4.a | 冻结本轮架构、决策与未决项 | 同一审查包引用确定的 R01/R06/R08/R09/G13/G14；G15 A 与 R10 A 已确认。 |
| 0.4.b | 完成独立架构共识 | 按原 quorum/阈值收票并机械 finalize；缺席、旧 digest、拒绝均保持 proposed，本次执行授权后可派发只读独立评审。 |

### 1.1 工作包

依赖：0.4。验收 ID：F01, F03。

预期文件/归属：`openspec/changes/delivery-foundation-rearchitecture/toolchain-baseline.json`、`openspec/changes/delivery-foundation-rearchitecture/package-probes`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 1.1.a | 固定实际发行产物 | 复核既有 Comet 0.4.5 integrity，补 TeamAI/OpenSpec/Node/宿主/技能摘要；历史下载不等于运行通过。 |
| 1.1.b | 隔离运行版本与兼容探针 | 真实运行 version/status/最小调用；重放旧 OpenSpec 依赖字段失败并记录兼容矩阵，不全局升级。 |
| 1.1.c | 明确 Comet 扩展交付位置 | 定位固定产物对应源码/测试目录、补丁构建与分发方式；不在插件缓存或 .agents 技能正文中修 Runtime。 |

### 1.6 工作包

依赖：1.1。验收 ID：M01, M02, B01, B09。

预期文件/归属：`.agents/skills`、`docs/agent/skill-architecture.md`、`openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json`、`integrations/comet/patches/0001-matt-method-profile.patch`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 1.6.a | 选择兼容的方法导出入口 | 保留旧 plan_guard 负例，固定去 Superpowers 且无第二 controller 的方法/校验协议；若共享新版仍拥有 controller，不能直接全量引入。 |
| 1.6.b | 显式替换真实目录快照 | 按技能层 AGENTS 和升级纪律引入选定 planner/test-authoring/Whitebox/Matt 内容与摘要，保留来源，不手改上游正文。 |
| 1.6.c | 修改 Classic 方法及初始化集成 | 在 1.1.c 确定的源码交付处替换硬安装/硬调用；新会话实际证明不重启 Superpowers、无 planner/implement-spec 重复派发。 |

### 1.2 工作包

依赖：1.6。验收 ID：F02, F04, B09。

预期文件/归属：`foundation`、`tools/foundation-export.mjs`、`tools/bootstrap.sh`、`tools/adapters/claude-code.sh`、`test/foundation-distribution.test.js`、`hooks.yaml`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 1.2.a | 实现资产 exporter 与 FoundationLock | RED：缺摘要/机器路径/浮动版本拒绝；GREEN：仅从技能、hooks、MCP 唯一源生成发布视图。 |
| 1.2.b | 验证组合幂等与受管块移交 | 隔离配置验证正反序初始化、重复 pull、升级/卸载；脚本行为和 settings matcher 同测，用户条目不丢。 |
| 1.2.c | 验证旧 Run 固定资产及回退 | 升级后旧 Run 保留原方法/策略/工具摘要；不能保持则阻断并显式迁移，不静默换基线。 |

### 1.3 工作包

依赖：1.2。验收 ID：F05, F07, A09。

预期文件/归属：`lib/adapters/comet.js`、`lib/adapters/harness.js`、`test/comet-driver.test.js`、`openspec/changes/delivery-foundation-rearchitecture/host-probes`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 1.3.a | 验证固定 Runner 与 Run 绑定 | 确定 authority/workspace/execution 真实接口，写 driver 能写、只读 driver 不能冒充实现；Runner 不另存 phase。 |
| 1.3.b | 逐渠道实证写入约束 | 编辑、Shell、MCP 分别尝试越阶段写入；记录已拒绝或能力缺口，不能仅测一条渠道。 |
| 1.3.c | 确认 Spec 与验证的唯一 owner | 一次验证执行和一次规格收尾；拒绝重复 controller/重复归档，不支持即 NO-GO。 |

### 1.4 工作包

依赖：1.3。验收 ID：C07, F06, M01。

预期文件/归属：`openspec/changes/delivery-foundation-rearchitecture/mode-qualification.json`、`openspec/changes/delivery-foundation-rearchitecture/mode-probes`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 1.4.a | 固定两模式能力差异与 Classic 准入 | 保留 Classic 既定接入设计，Native 仅兼容/能力对照，不自动切换路径。 |
| 1.4.b | 复现漏检查/伪回执/逃生路径 | 把无关成功命令、旧/手工回执、跳过入口做真实负例；原生缺口写扩展验收，不改判定转绿。 |
| 1.4.c | 确认知识主库边界 | Comet 自有记忆不覆盖 LLMWiki/Outline/DeepWiki；不能禁用或隔离时不启用冲突功能。 |

### 1.5 工作包

依赖：1.4, 2.1。验收 ID：C01, C02, C03, C04, C05, C06, C07, C08。

预期文件/归属：`test/classic-integration.test.js`、`openspec/changes/delivery-foundation-rearchitecture/classic-integration-probes`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 1.5.a | 验证 OpenSpec/TestPack/计划引用映射 | 固定兼容环境，tasks 唯一可写；Classic plan 为派生只读视图，不双写 checkbox。 |
| 1.5.b | 按真实入口建立扩展 RED 基线 | C01–C08 覆盖 R/A/T/P/V/K 以及恢复/旁路；保留原生不能阻断的证据，交 2.4 实现。 |

### 2.1 工作包

依赖：1.1。验收 ID：A01, A02, A03, A04, A07, A08。

预期文件/归属：`contracts/delivery`、`lib/delivery/baseline.js`、`lib/delivery/test-contract.js`、`test/delivery-baseline.test.js`、`test/delivery-test-contract.test.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 2.1.a | 定义共享契约及版本 | FoundationLock/BaselineRef/TestContract/PlanBundle/CandidateRef/EvidenceEnvelope/GateReceipt/ReleaseReceipt 输入、错误与兼容边界。 |
| 2.1.b | 实现全输入绑定和追踪 | 先 RED 非 JS/锁文件/迁移漂移与 AC→case 缺项，再 GREEN；tasks 定义摘要与进度勾选分离。 |
| 2.1.c | 实现有效 RED 与执行分母检查 | 零测试/全 skip/环境失败拒绝；不通过造测试数量闭合行为覆盖。 |

### 2.2 工作包

依赖：2.1。验收 ID：A05, A06, A18, A19, B03, B06, B07。

预期文件/归属：`lib/delivery/evidence.js`、`lib/delivery/gate.js`、`test/delivery-evidence.test.js`、`test/delivery-gate.test.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 2.2.a | 实现证据准入与身份绑定 | RED 自签、同 execution、旧 policy/候选/环境；GREEN 固定派发来源，不信角色标签。 |
| 2.2.b | 实现纯 Gate 求值与拒绝原因 | 缺能力/未验证/观察项不完整保持阻断；只返回判定与回执，不派发、不保存 current-stage。 |
| 2.2.c | 验证受保护来源边界 | 夹具只证结构；可信 Runner 登记/发布密钥隔离由真实权限负例另证，不夸大本机文件锁。 |

### 2.3 工作包

依赖：2.2。验收 ID：A20, B10。

预期文件/归属：`bin/cli.js`、`lib/adapters/legacy-evidence.js`、`test/delivery-cli.test.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 2.3.a | 增量暴露检查 CLI 与旧报告适配 | 保持既有命令；测试 0/1/2 和 JSON 结果；字段缺失或版本不兼容明确拒绝。 |
| 2.3.b | 运行兼容回归 | node --test test/*.test.js、npm test、bash scripts/check.sh；关闭 CodeGraph/RTK 后正确性仍成立。 |

### 2.4 工作包

依赖：1.5, 2.3。验收 ID：D01, D02, D03, D04, D05, D06, D07, D08, C07。

预期文件/归属：`integrations/comet/patches/0002-managed-delivery-runtime.patch`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 2.4.a | 接入共同 policy/receipt/evaluate | 只在 1.1.c 确定的同一 Runtime 扩展；Guard、直接转换、受管写入共用谓词。 |
| 2.4.b | 扩展同 Run 的 R/A/T/P/V 接纳与返工 | 来源/attempt/摘要接纳、固定修复路由、短锁登记→长执行→短锁接纳，不持锁等网络。 |
| 2.4.c | 实现保守失效 | 需求/设计改动全部下游失效；正常代码写入只失效候选相关证据；进度勾选不循环失效 P。 |
| 2.4.d | 接入 resolver/恢复/完成事务 | 中断、并发接纳、archived 但缺必需义务不能 completed；复用原 Run/锁/事务，不造第二账本。 |

### 2.5 工作包

依赖：2.4。验收 ID：E03, E04, H06。

预期文件/归属：`lib/adapters/architecture-review.js`、`test/architecture-review-adapter.test.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 2.5.a | 接入架构质询和冻结审查包 | grill-me 承重问题闭合后才提交；真实 quorum/阈值/policy 绑定审查包 digest。 |
| 2.5.b | 消费机械共识结果与恢复原作业 | 缺票/拒绝/旧摘要不放行；同 job_key 不重复评审，T 保持单独自动审查。 |

### 3.1 工作包

依赖：0.4。验收 ID：A01, A15。

预期文件/归属：`openspec/changes/delivery-foundation-rearchitecture/pilot-contract.md`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 3.1.a | 登记试点与身份 | 业务仓库、owner、固定 Runner、隔离环境、UI/API/持久化和权限负向 AC；未登记不派发真实副作用。 |
| 3.1.b | 冻结产品/设计/测试/计划输入 | 复用已有确认，给每个 case 独立 oracle/数据/环境/清理；原生浏览器能力先发现。 |

### 3.2 工作包

依赖：2.5, 3.1, 3.4。验收 ID：B01, B02, B03, B04, B05, B06, B07, F08, A15。

预期文件/归属：`openspec/changes/delivery-foundation-rearchitecture/pilot-journey`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 3.2.a | 跑一次同 Run 的真实角色链 | 测试作者只改授权测试；Builder 实现；Reviewer/Whitebox 独立，关联动作/请求/持久读回。 |
| 3.2.b | 验证实际返工 | 弱 oracle 回作者、产品缺陷回 Builder、环境缺口回适配；新候选重验，不修改冻结候选后自评。 |

### 3.3 工作包

依赖：3.2。验收 ID：A10, A11, A12, F07。

预期文件/归属：`openspec/changes/delivery-foundation-rearchitecture/pilot-recovery`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 3.3.a | 运行并发/重复/乱序/旧 epoch 负例 | 同 key 只派发一次，旧回调拒绝，父 Journey 失败不因子任务通过而放行。 |
| 3.3.b | 杀进程后恢复并读回 | 保存真实进程、Run/候选身份与持久状态；恢复原 operation，不重开叶子任务。 |

### 3.4 工作包

依赖：2.4。验收 ID：A11, B08。

预期文件/归属：`lib/adapters/spec.js`、`test/spec-closeout.test.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 3.4.a | 实现唯一 Spec Adapter | 真实临时 OpenSpec 工程预演、目标摘要、MODIFIED 全场景保留；明确 archive 已含 sync 时不再重复 sync。 |
| 3.4.b | 验证冲突与中断读回 | 主 specs 并发改动阻断；移动前后故障恢复原事务；归档后重新读回场景与稳定 Run 引用。 |

### 4.1 工作包

依赖：3.3。验收 ID：A13, F06, F09。

预期文件/归属：`.github/workflows/delivery-gate.yml`、`tools/ci/verify-delivery.mjs`、`test/ci-delivery-gate.test.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 4.1.a | 实现受保护集成检查入口 | 精确 head/merge SHA 重算、受保护策略/来源；本地 passed 不代替平台 required check。 |
| 4.1.b | 实证平台阻断 | 新 SHA、漏项、skip、超时、旧证据真实阻断合并；需平台管理员配置/授权，不只检查 YAML。 |

### 4.2 工作包

依赖：4.1。验收 ID：A14, A16, A17, F09。

预期文件/归属：`tools/ci/release.mjs`、`test/release-protocol.test.js`、`openspec/changes/delivery-foundation-rearchitecture/release-journey`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 4.2.a | 构建并提升同 digest | 隔离 Registry/环境，拒绝 tag 漂移；保存 integration SHA、实际构建与部署身份。 |
| 4.2.b | 超时调和与已批准回滚 | 请求成功但回执丢失先查原对象；独立业务读回与回滚读回，禁止无授权生产发布。 |

### 4.6 工作包

依赖：3.3。验收 ID：H01, H02, H03, H04, H05, H06, H07, H08, H09。

预期文件/归属：`integrations/comet/patches/0003-post-archive-closeout.patch`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 4.6.a | 扩展 pending archived 的发现/选择/输出 | Git complete 但知识 pending 仍找到原 Run；resolver/status/clear-current 同一完成条件。 |
| 4.6.b | 实现原子操作登记和稳定文档身份 | 同 key 领取、owner/attempt、UUID 与 lastRevision 协议；403/超时不当不存在，409 不盲覆盖。 |
| 4.6.c | 验证权威环境和安全清理 | 复制状态不能第二写者；按已确认 R10 A，整体 completed 前保留唯一工作区；提前清理或迁移只在另行确认并证明恢复后启用。 |

### 4.7 工作包

依赖：4.6。验收 ID：U01, U02, U03, U04, U05, U06, U07, U08。

预期文件/归属：`lib/adapters/knowledge-authorization.js`、`test/knowledge-authorization.test.js`、`openspec/changes/delivery-foundation-rearchitecture/authorization-journey`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 4.7.a | 登记源域/目标/owner 与 grant | 逐主体权力、用途、披露范围、内容/动作、两种期限、撤销；资料外发和目标写入权限分开。 |
| 4.7.b | 实现写前真实授权核验 | 多来源交集、完整分页/principal 映射、目标继承/单页/公开受众，未知 fail closed。 |
| 4.7.c | 验证身份隔离和预授权内自动发布 | 作者/审查/签发/Publisher 分离，真实正负路径；同一已授权 payload 审查通过自动推进。 |

### 4.4 工作包

依赖：4.2, 4.7。验收 ID：C06, D06, D07, E01, E02, E06。

预期文件/归属：`lib/adapters/llmwiki.js`、`lib/adapters/outline.js`、`lib/adapters/code-wiki.js`、`lib/sdd-paths.js`、`tools/mcp/llmwiki.sh`、`test/knowledge-closeout.test.js`、`lib/knowledge-seed.js`、`bin/cli.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 4.4.a | 接通 KG0/Kp 与项目知识唯一位置 | 修复 CLI/MCP/worktree 路径分叉；MCP 写入和独立读回、no-update 依据均可核验。 |
| 4.4.b | 接通 Kt 与同 Run 发布收尾 | 必需项目知识卡归档，Outline 可归档后继续但卡 completed；未知结果先查远端，不重复部署。 |
| 4.4.c | 接通被选为必需的代码知识新鲜度 | 固定 deepwiki-open/Code Graph 产物与精确 commit，按事前 policy 验回执；语言/规模/部署未定的分支保持待准入。 |
| 4.4.d | 运行完整关闭矩阵 | 产品接受/项目知识/规格归档/团队发布/目标环境分别读回；不得将测试这个机制的任务循环依赖本 Change 已归档。 |

### 4.5 工作包

依赖：4.4。验收 ID：E05, E06, H02。

预期文件/归属：`hooks.yaml`、`hooks`、`tools/adapters/claude-code.sh`、`test/delivery-hook-assembly.test.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 4.5.a | 按需生成只读恢复 hook | Ponytail 仅方法提示；项目策略只来自 hooks.yaml，不改插件缓存或借 mode 授权。 |
| 4.5.b | 验证脚本与 matcher 装配 | 共存、重复启动/压缩/子会话、hook 静默失败；门禁仍阻断且不重复共识/发布。 |

### 4.8 工作包

依赖：4.4。验收 ID：L01, L02, L03, L04, L05, L06, L07, L08, L09, L10, L11。

预期文件/归属：`lib/adapters/knowledge-revocation.js`、`test/knowledge-revocation.test.js`、`openspec/changes/delivery-foundation-rearchitecture/revocation-journey`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 4.8.a | 落实 G15 A 与隔离预授权 | 按已确认 G15 A 冻结正常依赖下 5 分钟隔离目标及故障允许超时/留痕边界，实证细分检测/隔离/告警预算，登记真实 owner 与隔离专用授权；设计确认不代表运行达标。 |
| 4.8.b | 实现事件与周期核验入口 | 采集器只交事实，Comet 同一引擎持有维护 operation/重试/影响闭包，不另建 watcher 主控。 |
| 4.8.c | 实现资源端隔离和新授权恢复 | 实际 Web/搜索/分享/附件与 MCP 逐渠道读回；不以 stale/unpublish 标签充当不可读。 |
| 4.8.d | 故障注入并计时 | 漏报/分页超时/Runner 宕机/隔离失败：独立监控告警、监督器重启原实例、Comet 补偿；记录暴露窗口，不暂停计时抹违约。 |

### 4.3 工作包

依赖：4.5, 4.8。验收 ID：B10。

预期文件/归属：`openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json`、`openspec/changes/delivery-foundation-rearchitecture/verification.md`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 4.3.a | 汇总四层证据和逐场景结论 | 内核、CLI/装配、宿主、业务/CI 分开；每个必验场景有当前版本证据或明确阻塞。 |
| 4.3.b | 回归、独立验收与交接 | 全仓检查和平台读回；目标环境确认前不得 delivered，条件性 Batch 5 未做不得声称团队认证。 |

### 5.1 工作包

依赖：4.3。验收 ID：A09, A10, A11, A12, F03, F08。

预期文件/归属：`openspec/changes/delivery-foundation-rearchitecture/team-host-matrix`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 5.1.a | 多 worktree/DAG 有序集成 | 隔离任务并行、串行集成、父目标真实重验；子 green 不等于父目标通过。 |
| 5.1.b | 逐宿主认证 | 每个宿主的发现、写保护、浏览器证据与恢复分别证明，不跨平台推断支持。 |

### 5.2 工作包

依赖：5.1。验收 ID：F10。

预期文件/归属：`services/delivery-control`、`test/delivery-control.test.js`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 5.2.a | 跨机器需求确认后才启用 API | 复用既有 PostgreSQL/身份/存储；API 只管证据、审批、回执，不接管执行步骤。 |
| 5.2.b | 权限/断联/备份恢复实证 | 项目隔离、撤权、恢复后权限及 API 断联拒绝缓存绿灯，真实负例与恢复读回。 |

### 5.3 工作包

依赖：5.2。验收 ID：A10, A11, H09。

预期文件/归属：`openspec/changes/delivery-foundation-rearchitecture/operations-runbook.md`、`openspec/changes/delivery-foundation-rearchitecture/team-recovery`。

| 子 ID | 交付单元 | 验证/停止条件 |
| --- | --- | --- |
| 5.3.a | 逐项核实租约/fencing/后台驱动 | 不共享挂载本地状态冒充分布式；缺能力写限制并复审。 |
| 5.3.b | 演练版本回退与权威环境迁移 | 停旧写者、调和 pending、迁移完整状态、验证新归属；保留旧产物和历史证据。 |

### Task I01: 独立资源登记、版本准入与秘密引用

**Files:** infra/delivery/registry.json, infra/delivery/registry.schema.json, infra/delivery/secrets.refs.example.json, infra/delivery/qualification-policy.json, tools/infra/registry.mjs, tools/infra/secret-refs.mjs, test/infra-registry.test.js
**Interfaces:** Registry.v1 -> project/resource/owner/credentialRef/lockRef/authority/domain/retention, no secret values; SecretRef.v1 -> purpose-bound opaque reference resolved only by allowed service principal; Qualification.v1 -> exact source commit, image digest/platform/size, license, health API and backup compatibility evidence before up
**Dependencies:** P0_4
**Owns:** infra/delivery/registry.json, infra/delivery/registry.schema.json, infra/delivery/secrets.refs.example.json, infra/delivery/qualification-policy.json, tools/infra/registry.mjs, tools/infra/secret-refs.mjs, test/infra-registry.test.js
**Parallel safe:** false
**Acceptance IDs:** F01, A19, U01, U07

- [x] **Step 1 [5 min]: Test** RED：未知owner/用途或凭据引用跨项目解析失败；将普通Agent身份访问签发/发布材料实际拒绝；未固定镜像digest、缺许可证/平台/备份兼容证据时up入口拒绝；浮动tag或假digest不通过；引用包含秘密明文、宿主绝对路径或同一个凭据被不同高权角色复用时校验拒绝。
- [x] **Step 2 [5 min]: Implement** GREEN：仅实现注册表schema、只读解析与逐资源qualification gate；秘密只通过运行时授权挂载/secret store，不写入Git/报告；生成各组件配置所需引用，但不写mcp-capabilities/hooks等其它owner的唯一源；由对应P任务串行接纳；所有启动工具先解析相同registry与组件lock，状态ready前仅可validate/qualify。
- [ ] **Step 3 [5 min]: Review** 独立读回：原始owner/权限读回与拒绝日志匹配project1285806550和真实principal；无秘密值输出；资格回执绑定实际image digest/commit、平台和输入摘要；配置有效与运行ready分开。命令、输入、备份与资格前置详见 infrastructure-tasks.json。
- [x] **Step 4 [3 min]: Commit** 串行接纳仅归属路径，记录原始证据；基础设施未真实安装/验证保持未完成。

### Task I02: 固定Comet Runner及真实OS/container角色隔离

**Files:** infra/delivery/runner/compose.yaml, infra/delivery/runner/Dockerfile, infra/delivery/runner/image.lock.json, infra/delivery/runner/role-policy.json, infra/delivery/runner/workspace-mounts.json, infra/delivery/runner/authority-registration.example.json, tools/infra/runner.mjs, test/infra-runner-isolation.test.js
**Interfaces:** RunnerInfra.v1 validate|qualify|up|probe|stop -> process/mount/principal observations only; RoleBoundary.v1 -> immutable tool image, distinct principal/mount/credential scopes for controller/author/test-author/reviewer/publisher/isolator; Authority.v1 -> one fixed Comet authority and workspace; startup refuses copied state or concurrent writer
**Dependencies:** I01, P1_1
**Owns:** infra/delivery/runner/compose.yaml, infra/delivery/runner/Dockerfile, infra/delivery/runner/image.lock.json, infra/delivery/runner/role-policy.json, infra/delivery/runner/workspace-mounts.json, infra/delivery/runner/authority-registration.example.json, tools/infra/runner.mjs, test/infra-runner-isolation.test.js
**Parallel safe:** false
**Acceptance IDs:** A09, A10, A11, A19, C07, D01, D08, H03, H09, U07, F05, F07, M02

- [x] **Step 1 [5 min]: Test** RED：以实际worker身份经Edit/Shell/MCP分别写.comet/run-state.json、策略、回执与签发目录；实际拒绝并保留errno/请求；挂载宿主凭据/访问Docker socket、使用只读driver写产品文件、复制state后第二实例启动分别拒绝；杀掉controller后不能由worker自行领取phase/重试；旧owner/attempt结果由Comet拒绝，基础设施不伪造新operation。
- [x] **Step 2 [5 min]: Implement** GREEN：镜像由精确已锁Comet源及项目补丁构建，启动前固定image digest；只读根文件系统、最小capabilities/权限和独立角色挂载；唯一Comet状态/锁/事务仍在其受管持久卷；infra仅启动/停止进程，不维护DAG/phase/job queue；工件/角色结果通过受控入口交原Comet；普通Agent不可构造可信dispatch身份，不能只靠env角色字符串或同主体签名。
- [ ] **Step 3 [5 min]: Review** 独立读回：真实container inspect/UID/mount/权限和负向写结果，分别对应Edit/Shell/MCP，不以容器配置文本代替实测；原RunID和operation恢复读回；两个启动请求只有一个有效Comet写者，控制目录不存在worker可写路径。命令、输入、备份与资格前置详见 infrastructure-tasks.json。
- [x] **Step 4 [3 min]: Commit** 串行接纳仅归属路径，记录原始证据；基础设施未真实安装/验证保持未完成。

### Task I03: Outline独立资料域、Postgres/Redis、OIDC与对象存储

**Files:** infra/delivery/outline/compose.yaml, infra/delivery/outline/images.lock.json, infra/delivery/outline/outline.env.example, infra/delivery/outline/oidc-registration.example.json, infra/delivery/outline/storage-policy.json, infra/delivery/outline/collection-registration.example.json, tools/infra/outline.mjs, test/infra-outline.test.js
**Interfaces:** OutlineInfra.v1 validate|qualify|up|probe|stop -> actual API/UI/storage/principal evidence; OutlineDomain.v1 -> instance/collection immutable IDs, actual effective reader set and registered owner; OutlineState.v1 -> durable database+attachment storage; cache is not rights authority; API contracts include fixed create UUID and lastRevision only if verified
**Dependencies:** I01
**Owns:** infra/delivery/outline/compose.yaml, infra/delivery/outline/images.lock.json, infra/delivery/outline/outline.env.example, infra/delivery/outline/oidc-registration.example.json, infra/delivery/outline/storage-policy.json, infra/delivery/outline/collection-registration.example.json, tools/infra/outline.mjs, test/infra-outline.test.js
**Parallel safe:** false
**Acceptance IDs:** U01, U02, U03, U04, U05, U06, U07, U08, H04, H05, L02, L04

- [x] **Step 1 [5 min]: Test** RED：未登录/普通读者/离组用户对集合、页面、子树、公开分享、搜索和附件逐通道访问负例；实际拒绝/残留路径分别报告；来源交集不包含目标读者、分页失败、无法映射principal、过期grant时受管发布阻断；不能以admin读得到替代；重启应用/数据库后测试页和附件可读回；更新冲突409不盲覆盖；超时/403不能解释为目标不存在。
- [x] **Step 2 [5 min]: Implement** GREEN：锁定镜像后搭建独立Postgres/Redis/应用/存储和最小网络权限；loopback暴露不得自动开公网；接OIDC及专用受管文集，保存真实ID和有效受众查询能力；一般用户不能改issuer/secret/isolator角色；分别验证健康、登录、CRUD/readback/附件持久化、权限负例和受管发布/隔离API的真实参数；缺MCP参数时对应P任务建设薄adapter。
- [ ] **Step 3 [5 min]: Review** 独立读回：原生浏览器登录/页面/分享行为截图+关联请求，独立用户权限/API/数据库与对象存储读回；不共享其它应用会话；effective audience闭包含collection/parents/page/groups/shares/public入口，未覆盖访问路径不能宣称隔离；记录附件URL缓存残留风险。命令、输入、备份与资格前置详见 infrastructure-tasks.json。
- [x] **Step 4 [3 min]: Commit** 串行接纳仅归属路径，记录原始证据；基础设施未真实安装/验证保持未完成。

### Task I04: 项目LLMWiki MCP、索引与worktree安全路径

**Files:** infra/delivery/llmwiki/package.lock.json, infra/delivery/llmwiki/project-root-policy.json, infra/delivery/llmwiki/index-policy.json, infra/delivery/llmwiki/mcp-profile.json, tools/infra/llmwiki.mjs, test/infra-llmwiki-paths.test.js
**Interfaces:** ProjectWikiInfra.v1 validate|qualify|probe -> canonical project/wiki/index identity and MCP read/write observations; ProjectRoot.v1 -> projectID/repoID/wikiRoot/worktree mapping, contained paths only; KnowledgeWrite.v1 -> approved curated entry plus source/revision and independent readback; no task/phase/spec authority
**Dependencies:** I01, P1_1
**Owns:** infra/delivery/llmwiki/package.lock.json, infra/delivery/llmwiki/project-root-policy.json, infra/delivery/llmwiki/index-policy.json, infra/delivery/llmwiki/mcp-profile.json, tools/infra/llmwiki.mjs, test/infra-llmwiki-paths.test.js
**Parallel safe:** false
**Acceptance IDs:** C04, C06, E01, E06, H08, F01, B09

- [x] **Step 1 [5 min]: Test** RED：不同worktree/CLI/MCP指向另一wiki、目录穿越/符号链接越域、错误project ID分别拒绝；源码/正式spec或任务勾选被当wiki事实权威时拒绝；未经批准全Git代码摄入不允许；MCP写成功但独立索引/存储读回不一致时Kp失败，不因本地文件存在放行归档。
- [x] **Step 2 [5 min]: Implement** GREEN：固定真实目录与项目标识、可重建索引和最小MCP能力；保持项目知识与OpenSpec specs/tasks及Comet状态分离；用隔离配置验证CLI/MCP/worktree同一规范路径；新宿主真实发现工具后完成知识写入及独立查询；清楚区分raw/staging/curated及index缓存，索引不能覆盖源记录或改知识授权。
- [ ] **Step 3 [5 min]: Review** 独立读回：同一批准条目通过真实MCP写入、独立CLI/文件/索引查询同一项目读回；两工作树canonical root一致；未通过门禁时同一Comet Run的归档保持阻断；基础设施只返回事实，不签Kp回执。命令、输入、备份与资格前置详见 infrastructure-tasks.json。
- [x] **Step 4 [3 min]: Commit** 串行接纳仅归属路径，记录原始证据；基础设施未真实安装/验证保持未完成。

### Task I05: 自托管deepwiki-open及独立CodeGraph

**Files:** infra/delivery/code-knowledge/compose.yaml, infra/delivery/code-knowledge/images.lock.json, infra/delivery/code-knowledge/deepwiki-profile.json, infra/delivery/code-knowledge/graph-profile.json, infra/delivery/code-knowledge/repository-scope.json, tools/infra/code-knowledge.mjs, test/infra-code-knowledge.test.js
**Interfaces:** CodeKnowledgeInfra.v1 validate|qualify|probe -> selfhost code-wiki and separate graph provenance/freshness evidence; CodeWiki.v1 -> repository immutableID/commit and wiki generation manifest, approved code access scope; CodeGraph.v1 -> structure-only index with exact input commit/coverage; removable optimization, no gate or knowledge authority
**Dependencies:** I01, P1_1
**Owns:** infra/delivery/code-knowledge/compose.yaml, infra/delivery/code-knowledge/images.lock.json, infra/delivery/code-knowledge/deepwiki-profile.json, infra/delivery/code-knowledge/graph-profile.json, infra/delivery/code-knowledge/repository-scope.json, tools/infra/code-knowledge.mjs, test/infra-code-knowledge.test.js
**Parallel safe:** false
**Acceptance IDs:** F01, F03, A20, C06

- [x] **Step 1 [5 min]: Test** RED：未固定commit/镜像、未授权源码或错误项目源时拒绝启动/摄入；敏感代码不得用public服务作为替代；wiki生成失败/commit陈旧/语言覆盖不足不得提供新鲜度通过；graph缺失不能阻断正确性协议；删除/停用graph后正确性协议保持可执行，错误服务实例或其它PAV索引不可被当项目结果。
- [x] **Step 2 [5 min]: Implement** GREEN：固定自托管版本和专用存储/网络，生成精确commit的code wiki；graph部署成可选独立结构查询组件；分别输出wiki生成manifest与graph coverage，外层纯gate按事前policy判断，不建立自己的调度/阶段；optional关闭时报告未启用且不称已验证；若policy要求code wiki则必须真实API/MCP独立读回。
- [ ] **Step 3 [5 min]: Review** 独立读回：实际容器/进程、认证API/MCP响应、repoID/commit与生成manifest一致；抽查wiki引用准确性，结构查询有独立coverage；错误commit/私有源越权/语言缺口真实负例；停graph后相同候选正确性测试真实重跑，不靠配置开关文本。命令、输入、备份与资格前置详见 infrastructure-tasks.json。
- [x] **Step 4 [3 min]: Commit** 串行接纳仅归属路径，记录原始证据；基础设施未真实安装/验证保持未完成。

### Task I06: Git/CI、Registry、制品与隔离目标环境连通

**Files:** infra/delivery/platform/repository-registration.json, infra/delivery/platform/ci-policy.json, infra/delivery/platform/registry-registration.example.json, infra/delivery/platform/environment-registration.example.json, infra/delivery/platform/artifact-retention.json, tools/infra/platform.mjs, test/infra-platform.test.js
**Interfaces:** PlatformInfra.v1 validate|probe -> repository identity/permissions/check policy/registry/environment evidence, no implicit remote policy writes; IntegrationIdentity.v1 -> PR head/mergeSHA -> build artifact digest -> target deployment identity; Environment.v1 -> isolated endpoint/owner/rollback authorization and readback oracle
**Dependencies:** I01
**Owns:** infra/delivery/platform/repository-registration.json, infra/delivery/platform/ci-policy.json, infra/delivery/platform/registry-registration.example.json, infra/delivery/platform/environment-registration.example.json, infra/delivery/platform/artifact-retention.json, tools/infra/platform.mjs, test/infra-platform.test.js
**Parallel safe:** false
**Acceptance IDs:** A13, A14, A16, A17, A19, F06, F09, B08

- [ ] **Step 1 [5 min]: Test** RED：无远端修改授权时申请配置required checks拒绝；开发身份不能读取release/rollback secret；新head/mergeSHA复用旧check、缺项/skip/超时、tag改指不同digest实际阻断候选提升；部署成功但响应丢失先按原关联ID查询；未批准回滚请求被拒绝，已批准回滚要独立业务终态。
- [ ] **Step 2 [5 min]: Implement** GREEN：只登记读回Git/CI/Registry/隔离环境身份和权限；提供最小scope专用credential引用；将精确integration SHA、build digest、部署receipt与目标readback贯通；平台writer归既有P任务和Comet closeout授权；无真实平台写授权则本地试点保持LOCAL_ONLY，不伪报required checks已配置或生产交付。
- [ ] **Step 3 [5 min]: Review** 独立读回：实际Git/平台只读回执、精确SHA/digest与隔离部署身份；后续P4_1真实缺check阻断合并记录另验；禁止只以workflow YAML、管理员可读、模拟Status green或本地push成功宣称平台已保护。命令、输入、备份与资格前置详见 infrastructure-tasks.json。
- [ ] **Step 4 [3 min]: Commit** 串行接纳仅归属路径，记录原始证据；基础设施未真实安装/验证保持未完成。

### Task I07: 独立监控、告警与原Runner进程监督

**Files:** infra/delivery/monitor/monitor-registration.example.json, infra/delivery/monitor/health-contract.json, infra/delivery/monitor/alert-policy.json, infra/delivery/monitor/supervisor-policy.json, infra/delivery/monitor/fault-domain-policy.json, tools/infra/monitor.mjs, test/infra-monitor.test.js
**Interfaces:** Health.v1 -> heartbeat_age, complete_scan_watermark, unresolved_isolation/deadlines and authority identity; read-only; Monitor.v1 -> external fault-domain registration and alert delivery/ack/escalation only, never business phase/retry/ACL; Supervisor.v1 -> restart same fixed Comet authority only after old writer gone; bounded attempts and escalation
**Dependencies:** I02, P2_4
**Owns:** infra/delivery/monitor/monitor-registration.example.json, infra/delivery/monitor/health-contract.json, infra/delivery/monitor/alert-policy.json, infra/delivery/monitor/supervisor-policy.json, infra/delivery/monitor/fault-domain-policy.json, tools/infra/monitor.mjs, test/infra-monitor.test.js
**Parallel safe:** false
**Acceptance IDs:** L08, L09, L10, L11, A11, H09

- [ ] **Step 1 [5 min]: Test** RED：Comet进程宕机、主机不可达、心跳正常扫描卡死分别注入；同机监控随主机停止时必须标故障域未满足，不能PASS；首次隔离失败即时事件未投递/主渠道失败转备用/值班未确认升级真实计时；未经授权仅prepare不发送；监督器不得改phase、创建Comet维护operation或直接写Outline ACL；重启原实例与停止旧写者分别审计。
- [ ] **Step 2 [5 min]: Implement** GREEN：外部监控读既有Comet事实，分开心跳/接收游标/完整扫描水位/隔离结果；告警投递重投与业务重试分离；监督器仅进程级restart，Comet自己恢复事务、补偿、重试；未知旧写者存活或存储归属不明时停止双启；未登记外部监控和投递渠道则无人值守发布pre-enable阻断，允许标本地进程探针完成但不偷换主机故障能力。
- [ ] **Step 3 [5 min]: Review** 独立读回：外部时间戳+失联起点+监控判定+已授权渠道送达/升级回执，分别计算检测与投递，不把告警当已隔离；原authority/RunID恢复后仍只有一个业务owner；遗漏权限由Comet全量对账接纳，不让monitor维护第二重试循环。命令、输入、备份与资格前置详见 infrastructure-tasks.json。
- [ ] **Step 4 [3 min]: Commit** 串行接纳仅归属路径，记录原始证据；基础设施未真实安装/验证保持未完成。

### Task I08: 备份恢复、单权威迁移与R10未完成保留

**Files:** infra/delivery/recovery/backup-policy.json, infra/delivery/recovery/restore-policy.json, infra/delivery/recovery/retention-policy.json, infra/delivery/recovery/authority-transfer.schema.json, infra/delivery/recovery/operations-runbook.md, tools/infra/recovery.mjs, test/infra-recovery.test.js
**Interfaces:** Backup.v1 -> consistent manifest of Comet state/transaction/receipts/approved payload plus knowledge/database/objects/config refs; Restore.v1 -> restore into quarantine, authenticate current permissions, fence old writer, verify same operation and readback before release; Retention.v1 -> R10 A: unresolved Run/knowledge obligation retains sole workspace; cleanup requires verified completed or separately approved migration+restore proof
**Dependencies:** I02, I03, I04, P4_4, P4_6
**Owns:** infra/delivery/recovery/backup-policy.json, infra/delivery/recovery/restore-policy.json, infra/delivery/recovery/retention-policy.json, infra/delivery/recovery/authority-transfer.schema.json, infra/delivery/recovery/operations-runbook.md, tools/infra/recovery.mjs, test/infra-recovery.test.js
**Parallel safe:** false
**Acceptance IDs:** A10, A11, H08, H09, L06, L11, B08, U07

- [ ] **Step 1 [5 min]: Test** RED：pending Outline发布/未知远端结果/唯一payload在工作区时cleanup实际拒绝；磁盘压力只告警不静默清理；不完整备份、校验不符、缺密钥、DB/附件时间点不一致、旧writer未隔离时恢复不启用；恢复旧ACL或重加离组成员、恢复旧grant/旧attempt结果、复制状态另开writer实际拒绝。
- [ ] **Step 2 [5 min]: Implement** GREEN：备份包含原Run权威文件/事务/操作/回执/批准payload与版本；数据库和附件可一致恢复，索引可重建且校验；隔离恢复后先冻结新发布、调和未知写、完整权限对账和优先隔离，独立验证后由同Comet继续；原已完成产品历史保留；权限维护仍由同引擎关联作业处理；cleanup门禁使用Comet真实义务不只archived/git complete。
- [ ] **Step 3 [5 min]: Review** 独立读回：真实备份manifest摘要、恢复资源ID/版本、同Run/operation与权限独立读回；记录停机起点/恢复/补偿结束和暴露违约；容量告警证据和cleanup失败状态可重现；恢复前后唯一owner证明，已下载数据不能声称可追回。命令、输入、备份与资格前置详见 infrastructure-tasks.json。
- [ ] **Step 4 [3 min]: Commit** 串行接纳仅归属路径，记录原始证据；基础设施未真实安装/验证保持未完成。
