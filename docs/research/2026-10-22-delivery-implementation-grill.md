# 交付基础重构实施核查与 Grill

日期：2026-10-22。结论：**BLOCK 受管团队启用及整体端到端验收；已有组件实施可保留，按原任务返工并重新验收。**

本次是独立核查，不修产品、不改原任务勾选、不归档、不部署、不对外发送。目标是核对“需求确认后自动推进；Comet 唯一主控；R/A/T 独立门禁；测试与独立验收；知识入库及撤权恢复”的实际实现。没有重开已确认的架构决定。

## 基线与证据范围

- 当前 master 为 `f4afe05d2cb93f5866be0b42c540e0141169f4a6`；原 VERIFY 声明的运行基线为 `68f79635d1fd5f6c0cddd40321692ee0b91ed4a9`。两者之间 lib/integrations/tools/test/contracts/infra/services 的已提交内容没有差异，后续提交主要接纳报告与任务状态。
- 工作区另有 ADR-0019、主架构、OpenSpec配置及一个测试的未提交变更。本报告不覆盖它们，也不把候选官方 overlay 当成冻结六补丁实现的一部分。引用聊天已实际读取，最近讨论同时明确正式 overlay/宿主装配仍未完成。
- 当前项目锁固定 Comet 0.4.5、源码 `c90af44a4474662d7853aae76ce785404974fb0a`；六补丁 fingerprint 为 `beab355def4fc2b4873889b7c0fb8702b9d093f241f442515f82cd08d639e966`。
- 主检出只有旧构建；实际门禁探针读取保留的 impl-verify 工作树中六补丁构建，以固定 Node24.15.0 执行。入口、门禁源代码与已编译 state-command 的内容摘要与该构建 manifest 相符。
- 完整缓存校验目前返回 `BUILD_BASELINE_DRIFT`；独立逐项比较发现161个差异全部位于 dashboard/web 构建资产，门禁入口/源代码/编译模块匹配。未查明漂移发生时点或来源，不能倒推原 VERIFY 当时造假，也不能给当前完整发行产物签通过。
- 原报告108项检查的分类是87 pass、18 environment_gated、1 unverified、2 failed；这只是原记录。审查发现语义与执行对象不匹配，不能独立背书“76个完整交付场景已通过”，也不在未逐项重验时另造通过数。

原始探针、命令结果及 JSON 位于 `.local/audits/architecture-grill-20261022/`，只用于本次审查；不要求接收者信任文件名或状态标签。

## 现实矩阵

| 架构声明 | 源码/测试事实 | 当前证据状态 | 结论 |
| --- | --- | --- | --- |
| 无R批准不得开始正式架构 | managed open-complete 无R仍进入design | 当前补丁CLI真实复现 | 不满足C01 |
| A/T必须独立自动审查，A需grill及全票共识 | accept-gate只要求dispatch关联、attempt和pass/reject；report及reportDigest可空 | R/A/T/P全部空报告获接纳，并进入build | 审查真实性未由接纳入口证明 |
| 需求/设计变化保守失效 | 当前内容digest变化会阻断，恢复原字节后旧批准自动有效 | allowed true→false→true，无新评审 | 缺少持久化revision/失效语义 |
| 单场景检查必须实际覆盖该场景 | runner在目标test point不存在时仍可PASS | A01运行无关算术测试仍exit0/PASS | 验收器有误判 |
| 固定Runner可构建并运行受控发行 | Dockerfile缺补丁、项目路径及入口路径不一致 | 静态输入核对+真实公共构建函数ENOENT | 不只是缺Docker环境 |
| 同Comet Run宕机恢复、隔离补偿 | L10/L11的SIGKILL对象是测试生成的计数worker | 源码可证明替身范围；未跑真实Comet故障链 | 不能升级为产品恢复闭环 |
| Outline发布和撤权真实闭合 | adapter明确只验判断层，真实写入/读回未验证；授权用LOCAL_FIXTURE | 配置/局部机制证据 | 保留未验收，不以表格记录替代资源读回 |
| 所有required通过后完成 | 合同仍要求92项；报告允许PARTIAL+holder满足四硬门 | 合同与报告谓词不一致 | 只能阶段交接，不能整体验收 |

## P1-01：需求门没有拦住正式架构推进

证据：`integrations/comet/patches/0002-managed-delivery-runtime.patch:200` 的动作集合只有 enter-build/enter-verify/enter-archive/product-write，没有 enter-design；spec C01明确要求无当前R回执不能推进需求阶段/开始正式架构。

实际执行：新建隔离 managed Change、写入最小产物，未提供任何R回执，`state transition <change> open-complete` 成功，`state get ... phase` 返回 `design`。这是六补丁构建的结果，不是早期无补丁Comet的历史缺口。

影响：R与A的独立门禁只在进入Build前被一起检查，未落实需求先确认再正式设计的边界。

最小修复：把进入正式架构的动作加入同一个权威前提判断，覆盖正常转换及恢复/next/写入路径；按C01补真实负例与可信R批准正例。归原P2_4，不增加主控。阻断受管启用。

## P1-02：Runtime dispatch登记不等于发生了独立审查

证据：补丁 `0002:1489` dispatchGate只产生登记记录和随机execution；`0002:1563` acceptGate校验execution/attempt/verdict，`0002:1614`附近report和reportDigest仍可null。它不在该入口核对独立审查者来源、grill闭合或精确全票共识结果。

实际执行：同一隔离调用者依次取得R/A/T/P dispatch，写入仅包含 `{execution, attempt, verdict:"pass"}` 的文件，四项均获接纳，回执report/reportDigest均为null；随后 complete-design 成功，phase=build。未启动独立Reviewer、test-authoring或架构共识。

边界：这证明当前协作模式的接纳入口不要求审查证据；不是对尚未部署的受保护Runner作越权攻击证明。OS隔离可以保护控制文件，但仍须证明可信结果渠道与接纳验证真正接通，不能把role字符串当作已执行独立审查。

最小修复：让Comet接纳实际受管执行结果，绑定受信执行身份、输入revision、原始报告摘要和独立审查证据；A消费真实共识tally/finalize，T消费测试设计审查结论。已有 `lib/adapters/architecture-review.js` 或纯Gate单测通过不能替代这段Runtime调用链。归P2_4/P2_5及I02接线。阻断受管启用。

## P1-03：设计改回原字节会复活旧批准

证据：`0002:565`附近computeGateInputs按内容digest派生依赖；`0002:636` evaluateGatePremises比较最新receipt与当前digest，没有将已经观测到的失效持久化为新revision。

实际执行：已接受R/A/T/P并进入Build后，gates allowed=true；修改design，gates allowed=false，A/T/P stale；把design恢复原字节，未重新派发审查，gates allowed=true。

影响：这是内容相同就复用的语义，不满足已确认的保守失效要求。与失效后恢复或返工重审不能混为一谈。

最小修复：在同一Comet状态/事务内记录单调revision或失效代际，并将所有下游回执绑定；一旦失效，恢复旧字节不自动复活。历史事务恢复与批准新的动作应分开判定。归P2_4，补修改→阻断→还原→仍阻断→新审查后放行的真实测试。

## P1-04：验收runner能把不存在的目标场景判PASS

证据：`tools/verify/delivery-journey.mjs:628`只拒绝找到且skip的目标；目标不存在不拒绝；`:631`只要求套件pass>0。`:590`与`:598`的inspect失败也只是观察，不影响判定；readState只验存在且非空。

实际执行：使用CLI公开支持的隔离case/pilot覆盖输入，明确登记A01，却执行一个只有 `assert.equal(1+1,2)` 的无关测试；固定TAP输出后得到 `exitCode=0, verdict=PASS, tests=1, target.found=false`。该实验没有执行A01的业务WHEN/THEN。

边界：这是对runner漏验的反例，不证明原92条每一条都是错误，更不证明所有日志伪造。原报告有时把同文件其它测试成功当作场景成功；例如M02无字面测试点需额外人工证据。此类追踪必须显式验证。

最小修复：验收器必须要求场景与具体执行case/断言的可验证映射；缺目标、零目标执行、目标全部skip或缺必需读回都非零。复合场景需显式映射，不能简单以字符串搜索代替完整语义。修好后重算92场景及108合同检查。归P3_1/VERIFY，先补无关全绿套件的负例。阻断以当前PASS汇总签整体验收。

## P1-05：Runner构建路径本身不闭合

证据：`infra/delivery/runner/Dockerfile`复制0001及1_6测试补丁两项，当前upstream.lock要求六项，缺0002、0003和对应两项测试补丁；image.lock仍固定两补丁的旧fingerprint `cb1151b4…`，实际锁为 `beab355d…`。

另外，Dockerfile调用build.mjs时 `--project /build/work` 未先创建；公共buildCometDistribution一开始fs.realpath(projectRoot)，在隔离临时目录复现ENOENT。其末尾find `/build/work/builds` 也与实际 `<projectRoot>/.sdd/vendor/comet/<commit>/builds` 不符。

影响：当前声明不能直接构建出包含门禁与归档后恢复的Runner；补Docker权限/daemon不能修复这些路径和内容错误。

最小修复：统一当前锁驱动的构建上下文、项目根、全补丁集和输出入口，真实镜像构建后回读工具链、fingerprint、角色mount/UID与实际进程。不得虚构镜像digest；归I02/P1_1。阻断Runner准入。

## P1-06：部分“旅程”证据跨越了测试替身边界

证据：`test/delivery-cases/4_8.mjs:81`生成journey-worker.mjs，仅对本地JSON中的progress递增，到5写completed；`:390`杀进程，`:408`由测试显式启动replacement。这是真实SIGKILL和计时，但对象不是Comet、没有其原生事务/Run恢复、没有真实Outline隔离操作。

`pilot-journey/run-role-chain.mjs`同样是带自有fixture状态的测试编舞；其存在不等于生产新增第二主控，也不能证明真实Comet已经调用全部角色/技能。需要沿实际入口核查，不能仅因函数名或注释写Comet便提升范围。

影响：L10/L11在acceptance-index被标VERIFIED，证据至多证明局部失败计时和编舞；不能推出真实Comet宕机后原authority/同operation补偿、旧写者fencing和真实知识资源不可访问。

最小修复：保留组件测试，补对实际Comet原实例的受控故障注入，在同Run中恢复并核对事务、operation、未知远端写、资源访问与暴露时限。由外部监控观察，进程监督器只恢复原实例，Comet独占业务补偿。归P3_3/P4_8/I07/I08。

## P1-07：整体完成条件被阶段处置条件替代

证据：execution-contract.json:22仍要求“未满足required场景不关闭整体目标”；每个未通过检查仍required=true。verification-report.md:172却将PARTIAL+holder视为“零剩余required波次满足”，:173将裁决类缺口视为无未解决P0/P1。

可以明确声明“当前实施阶段已交接、缺资源项目待续”；不能据此判“架构目标已完成验收”。记录holder能说明谁接着做，不能使未执行的必需项变成通过。本次新发现还说明未决项不止原报告的环境/命名问题。

最小修复：保留原证据，分开记录组件完成、环境资格、真实旅程验收和交付状态；重新打开受影响门禁及VERIFY，修复后重验。F10若未启用继续明确未验，不要求为了凑完成而强建跨机器API；若希望从整体目标排除，须显式调整范围，不能静默豁免。

## 当前环境复验与必要裁决

本次只读实际返回：Docker Server29.6.2可访问；gh api成功读回ql-wade/sdd-harness、repo ID1285806550；openspec为1.14.3。历史沙箱拒绝可以真实存在，但已不是本次同等环境的现状。仓库读取成功不代表获准改分支保护、部署或发布。

- I08文件名、缺失命令、构建路径与测试TAP入口属于可审查的工程修复，原则上不应仅挂“等用户裁决”而停止。
- OpenSpec应优先用隔离、资格验证过的工具链重跑，避免为验收随意改全局。是否正式迁移版本属于有兼容影响的决定。
- 源/目标owner的真实披露授权、专用身份/文集，以及是否启用跨机器范围，仍是需要有权主体提供的边界。
- 官方overlay候选与六补丁冻结实现是不同基线。先固定一条被批准的接入路线；本报告不把未接纳候选混入当前通过数，也不据此要求再造主控。

## 返工顺序与终局验收

1. 修P3_1验收器并冻结case→断言映射；否则后续绿色不可信。
2. 在P2_4/P2_5修R入口、可信A/T接纳和不可自动复活的失效，补实际旁路负例。
3. 修I02的构建/启动链，用真实角色隔离证明worker不能写控制状态、不能自己领取审查并批准。
4. 完成一个同Comet Run纵向切片：需求→架构grill/独立共识→测试设计审查→计划→TDD→独立Whitebox→项目知识Kp→OpenSpec归档→Outline超时/重启后同operation发布与读回→整体完成；之后撤源权限，执行关联维护并实际证明不可访问。
5. 在同一最终候选重跑必需检查，按真实环境分别报告PASS/BLOCKED/UNVERIFIED；Required有缺口时不给整体完成。

不需要先扩建新的主控。应首先把已有组件接到实际Comet入口和真实证据来源，再验证架构要求的终态。

## 本次实际执行及未检查范围

实际执行：git基线/差异核对、引用聊天读取、锁与Dockerfile输入核对、补丁CLI隔离门禁/回滚内容探针、无关测试的验收器反例、公共构建函数缺项目目录反例、完整缓存manifest比较、Docker/GitHub/OpenSpec只读探针、文档diff检查。脚本和结果保存在本地审查目录。

没有重跑全部425回归或108合同检查；没有执行容器构建、真实角色/模型审查、Outline发布撤权、跨故障域计时、平台合并阻断或生产操作。未修改实现、任务勾选与原报告；本报告不能替代修复后的完整Whitebox验收。
