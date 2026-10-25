# 给 Claude 的七P1返工交接

本次请求是**计划修订和交接**，没有启动实施、Goal、定时任务、部署或发布。用户把本包交给Claude并要求执行后，由Claude按下述流程自动推进；技术修复不反复询问，只有真实授权/业务范围/不可恢复阻塞交人。

## 先读与唯一权威

1. 仓库AGENTS、README、主架构、ADR-0015/0019及技能分工。
2. `docs/research/2026-10-22-delivery-implementation-grill.md`：7项P1与真实反例。
3. 本Change的proposal/design/spec、tasks.md、task-dag.json、execution-contract.json、drift-lock.json、replan-record.json。
4. 运行plan guard，核对冻结输入及身份；然后读execution-prompt.md的**项目优先覆盖**。guard通过只证明计划有效。

唯一任务/进度源仍为本Change的tasks.md；唯一依赖图仍为task-dag.json。**39节点、原30父任务、69工作包、92场景，原108检查全部保留，新增10项返工检查，共118项required。** 历史总结的“40节点”不作为增删节点依据。P1-01等只是审查finding，不是新任务或第二套DAG。

Claude是迁移实施的唯一planner控制器；目标产品的业务派发、phase/currentStep、重试、恢复与关闭仅由Comet持有。TeamAI只分发；Ponytail只提供方法上下文。不得嵌套implement-spec或另造主控。

## 版本与移交前置

本次源代码HEAD是`f4afe05`，原VERIFY测试基线`68f7963`；旧计划/状态/报告的完整字节及摘要见`replan-history/2026-10-22-seven-p1/previous/`与`replan-record.json`。原报告与测试日志作为历史保留，不继承为返工候选PASS。

本轮继续已冻结的Classic同Runtime受控补丁方案。未接纳的官方overlay候选、主工作区现有架构/config改动不得混入实现；它们的观察摘要与字节保存在同一history的observed-inputs。当前`openspec/config.yaml`字节是本次校验的观察输入，不表示批准覆盖原项目规则或采纳overlay方案。

**本包未创建计划提交。** 在新worktree实施前，由唯一控制器把本包和全部冻结输入做可回滚的独立计划提交或受控快照，并记录准确基线；不能只从`f4afe05`创建工作树却漏掉本次返工计划。不得整体提交主工作区的无关改动。移交时核对spec-baseline.sources，尤其现有未提交config：在隔离快照中保留其冻结字节，不恢复/覆盖用户主工作区。缺冻结输入即HALT_AND_REPLAN，不静默重锁。

当前可用工具与构建必须重验。完整保留构建缓存曾报manifest漂移，不能以目录存在或fingerprint文本正确当发行资格。OpenSpec优先用隔离、实测兼容的工具链；禁止为了过旧测试降全局版本。每次补丁集成由P1_1归属的唯一集成人更新有序锁、重新构建及回读，worker不能随意改共享锁。

## 固定返工顺序

| 顺序 | 沿用任务 | 交付与放行条件 |
| --- | --- | --- |
| 资格前置 | P1_1、P2_1 | 当前源码/补丁/工具链与测试边界可复验；不沿用漂移缓存或旧报告。 |
| 第一修复 | **P3_1** | 修验收器的目标分母/断言映射/typed终态读回；无关全绿、零目标、skip、必需观察失败都非零；独立反例通过后才信后续绿色。 |
| 第二修复 | **P2_4、P2_5** | R在正式架构前硬阻断；A/T消费真实独立结果；A真正消费grill闭合与精确全票共识；单调revision使旧字节还原也不复活批准。 |
| 真实运行资格 | **I02，继而P1_3/P1_4/P1_5** | 修Dockerfile完整补丁/项目根/入口与image lock，真实镜像启动及角色隔离，重新走生成脚本与全部正常/旁路/恢复入口。 |
| 跨边界接线 | P3_2/P3_3/P3_4、P4_4/P4_6/P4_7/P4_8、I01–I08 | 建设观察配方并在声明范围验证真实机制；完整三旅程统一留到VERIFY，等全部知识/监控/备份机制齐备后执行。组件任务不提前签完整旅程，缺资源保持未验。 |
| 终局验收 | **P4_3、VERIFY** | 重建按层索引；同一最终候选重跑118检查、92场景及三条真实旅程，独立Whitebox与Grill，逐一关闭7P1。 |

原DAG已重排，依赖改动与原因逐条见replan-record.json。为解决“Runtime修复需要Runner验真、Runner又要打包修复后Runtime”的集成依赖，**仅三条边**允许消费已独立审查、准确绑定并串行集成的实现工件：P2_5←P2_4、I02←P2_4/P2_5。不是验收豁免：上游未验证的任务仍不勾选，状态为INTEGRATED_AWAITING_REAL_QUALIFICATION；I02/P1_5实际资格验证后才能关闭对应义务。若P2_5接线要求补Runtime，恢复原P2_4 worker/任务版本，不新建替代节点。VERIFY对所有任务和required结果保持严格通过条件。

## 七项P1怎么修、怎么验

| Finding | 原任务 | 必须观察到的RED→GREEN |
| --- | --- | --- |
| P1-01 | P2_4、P1_5 | 无R仍进入Design的反例先真实失败；修复后正式架构/转换/Guard/next/resume/恢复统一拒绝，可信R后正向推进。 |
| P1-02 | P2_4、P2_5、I02 | 同调用者dispatch+空报告pass不得获准；缺票/旧摘要/假身份及弱oracle的T审查必须拒绝；实际独立角色产出的正确结果能自动放行。 |
| P1-03 | P2_4、P3_3 | 修改→阻断→恢复原字节仍阻断；新revision独立重审后放行。旧回调、旧attempt不得复活；历史事务恢复不授权新动作。 |
| P1-04 | P3_1、VERIFY | A01登记执行无关算术套件必须非零；复合场景缺子断言、required inspect失败、伪/旧读回同样拒绝。按schema绑定具体case/check/assertion和非零分母。 |
| P1-05 | P1_1、I02 | 缺补丁/错入口/缺目录先复现；真实镜像消费当前完整锁，启动命令、工具链、fingerprint/digest与实际进程一致，并通过真实角色拒绝与正向链。 |
| P1-06 | P3_2/P3_3、P4_6/P4_8、I07/I08 | 对实际Comet进程与真实资源注入故障，原authority/同Run/operation恢复；临时计数worker、假MCP、假archive不作为此层证据。 |
| P1-07 | P4_3、VERIFY | 任一required未通过或P1未关闭，整体必须未完成；holder、显式处置、组件PASS或报告计数一致均不能解除。 |

每项先由test-authoring设计正反例、独立oracle、数据/环境与清理，再由Builder按Matt TDD做行为RED→最小GREEN→回归。测试必须已经存在并真实执行；MODULE_NOT_FOUND、没有匹配测试、缺服务、缺依赖不是行为RED。`node --test`采集显式使用`--test-reporter=tap`。独立审查者重现负例，Whitebox不替作者修测试。

新10检查的命令/归属/oracle在execution-contract；`--journey`与`current-build-role-isolation`是**待实现接口**，必须先由P3_1/I02实现并验证，不能照抄运行失败后当作完成。现有108检查也要复核实际命令与执行环境；I08按原canonical命名迁移，覆盖旧调用和合同，不再用另一文件的绿色代替合同命令。

## 最终必须跑的三条真实旅程

**1. 产品同Run交付（V_SAME_RUN_DELIVERY）。** 首先在批准的本仓库试点冻结一个实际受管Change及其可观察交付目标、环境、来源和专用Outline文集。由真实Comet执行：

`R确认 → A grill与独立全票共识 → T独立测试设计审查 → P → 实际TDD → 独立Whitebox → Kp项目知识读回 → 真实OpenSpec归档 → Outline发布未知结果/重启恢复 → Kt真实读回 → completed`。

每个角色使用实际登记的独立执行身份；记录Comet authority_id、同一product run_id、revision/candidate、gate/execution/attempt/epoch、报告摘要、knowledge/operation/document UUID、原始请求、响应及持久化读回。拒绝作者自填pass/伪造共识票、手改phase、手写completed、测试直接复制正确产物充当Builder或自建状态机绕过Comet。

在本产品Run内，Kp缺失必须拦archive，Kt缺失必须拦整体completed；归档后仍恢复同一Run、同operation、稳定UUID，未知结果先独立读回，不能重复归档/部署/建页。产品试点归档不是本迁移Change的归档，避免用自身VERIFY作为已归档前提的循环。

**2. 真实Comet故障恢复（V_RW_REAL_COMET_RECOVERY）。** 在原Run实际事务提交前/后、远端写已成功但本地结果未知等窗口，杀实际Comet进程；独立监控留下故障证据，监督器仅恢复原实例。Comet恢复原Run/operation，旧writer/attempt拒绝，无重复发布；同时回读Run、journal、批准依据、资源版本和continuation。不能通过测试手构成功journal或杀计数脚本签通过。

**3. 发布后的权限维护（V_POST_DELIVERY_PERMISSIONS）。** 消费第一条旅程实际发布的知识对象；真实源撤权、受众变化、两种期限、漏事件/周期对账、隔离失败和恢复都要测试。已完成产品历史保留，维护由同一Comet引擎关联maintenance Run承接，记录origin_run、knowledge/operation关联，禁止另起业务主控。Outline Web/分享/搜索/附件及受控MCP等required渠道需真实不可访问读回；恢复必须新授权。正常3分钟发现+2分钟隔离目标与故障暴露/检测/投递分别计时。无外部监控故障域或缺真实权限，不签通过。

**防验收循环：**P3_2只交付配方及实际R至V角色切片，P3_3交付配方与有限核心事务恢复，P4_8交付维护配方与已具备的权限机制；它们不以整条最终旅程PASS作为建设前置。三条完整旅程的execution_owner都是VERIFY，后者已依赖I03/I04/I07/I08及全部P4机制。V_RW_REAL_COMET_RECOVERY是V_SAME_RUN_DELIVERY启动的同产品Run内故障窗口，不是另开Run拼接日志；第三条消费其准确发布对象。任何局部任务接纳不关闭完整旅程。

完整同Run与撤权旅程所需Outline UI截图、网络、日志及独立资源读回不能互相替代；缺浏览器/服务属于未满足前置，不是not-applicable。

## 权限、资源与技术裁决

沿用本仓库专用试点，禁止复用其它项目凭据/卷/网络。现有Docker和gh只读可达只是观察，不代表Runner/Outline/平台写权限已准入。各动作先核验owner、当前源权限、目标受众、grant及秘密引用，值不进Git。对外发布、真实告警消息、远端保护修改和生产部署须有明确动作授权；缺授权先完成配置与待审内容，不绕路外发。

新架构审查若涉及外发材料，不能复用此前已使用的一次性冻结包授权。先准备精确审查包，按当前授权边界执行；缺独立审查能力保持门未通过。

文件命名、TAP、构建路径、悬空证据指针和可诊断网络故障属于原owner修复，不一律转成用户裁决。跨机器F10仍按原范围处理：未授权不扩建API，也不得将其正向UNVERIFIED写PASS；原required仍在，整体目标不完成，除非用户另行明确批准范围重规划。

## Goal、监督与完成

接收实际实施请求后，Claude发现宿主真实dispatch/resume/wait/隔离及Goal/调度能力，绑定唯一控制器。当前合同保守serial/max_workers=1；若要并行，先验证独立worktree和写入归属，经显式重规划再改锁，不能直接改max_workers。独立评审必须另有真实身份；缺失则报告阻塞，不能自评冒充。

目标使用contract.goal.objective，native_option=auto；宿主没有原生Goal就明确UNAVAILABLE，保留显式验收目标，不编造flags。20分钟监督收到实施请求再启用：

> 只读取本Change tasks、唯一DAG、execution-state及ledger和实际worker/进程句柄。核对修订/基线、7P1修复与复验、未完成波次、资源资格和证据时间；报告有依据的进展、阻塞、下一步及上海时区ETA，未知就说未知。每次检查落回执，无实质变化不通知。不得签业务Gate、改phase、发布知识、另派worker或接管重试；仅原唯一控制器推进已授权工作。VERIFY期间继续监督，所有required和Whitebox/Grill/适用closeout闭合后才停止并读回。无调度能力标manual，不安装新daemon。

只认当前候选、实际来源和相应证明层级。组件通过、环境已准备、产品旅程通过、知识关闭、规格归档分别记录。118项required全部PASS、92场景适用性/终态齐备、7P1及新P0/P1均有修复和独立复验、完整Whitebox Journey与Grill通过后，才接受VERIFY。FAIL/GATED/UNVERIFIED/不稳定证据一律保持整体未完成。

VERIFY之后，本迁移Change的规格一致性、真实归档和后审由唯一Comet Spec Adapter继续，不调用planner helper finalize，不重复sync。只读freeze/check/prepare不等于实际归档。交付verification-results、verification-report、grill-report、原始Whitebox ledger/报告/validator输出、P1逐项closure与最终候选证据；未完成则报告具体阻塞并保留Run/恢复状态，不写“所有硬门满足”。

## 本次计划检查及既有总检查缺口

plan guard、OpenSpec strict、身份/分母/依赖与未提交输入保留检查是本轮规划验证。`bash scripts/check.sh`已真实执行，但本宿主在Whitebox green fixture的os.utime触发只读保护，未跑到完整回归；详见本地rework-plan-check-sh.log及handoff-validation.json。此限制不能签总检查通过。若新检出还缺原fixture工件，归原P1_6按显式完整快照升级纪律处理；不修改上游正文或放宽断言，不以pre-existing/零新增失败豁免V_FULL_CHECK。
