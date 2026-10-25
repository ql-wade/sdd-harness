# 深度结合Comet：架构对齐与未完成缺口

日期：2026-10-24。审查基线：主检出 master `dcb9efa`。结论：**REVISE系统交付结论；BLOCK无人值守受管团队启用。** 上一轮引擎修复和真实资源探针应保留，但尚未交付完整的自动研发与知识管理流程。

本次只核查，不改实现、原DAG/勾选或台账，不启动/停止服务，不归档或清理工作树。

## 1. 权威与已确认进展

- 主检出：`/Users/mac/Code/sdd-harness`，实际HEAD为`dcb9efa`。用户给出的festive-cohen会话壳路径下没有所指交接文件；实际读取主检出的`openspec/changes/delivery-foundation-rearchitecture/HANDOFF-DEEP-INTEGRATION-2026-10-24.md`。
- 主架构和ADR仍有未提交overlay候选修改；本次以已批准的单主控、CLI+固定Runner、R/A/T独立门、Kp先归档/Kt后整体完成、来源权限与持续维护要求为依据，不采纳新候选。
- 当前六补丁fingerprint为`d437093083ad4500253795fe231484c606e925b2404f958e5a7dd4fd4c11cba6`。项目补丁SHA均与锁一致，本次调用的编译gate模块与发行manifest一致；这不是完整构建资格重验。
- 源码和既有日志支持真实进展：R入口检查、持久化失效generation、更多pass-evidence形状检查、验收器目标匹配、实际Comet事务恢复探针、容器负向边界、真实Outline API发布/访问拒绝/恢复。不能再把本项目概括为完全没有运行实现。
- 当前结果文件也明确`goal_complete=false`。因此“本轮run完成”和“架构交付目标完成”必须分开。

## 2. 实际核查结果

- Docker只读实测成功，Server `29.6.2`。Comet Runner六容器当前全部`Exited (1)`，不是六个正在执行角色工作的服务；没有启动或重启它们。
- 当前机械pass-evidence检查器接受调用者自行编写的两个虚构A评审身份/批准票及自写T strong结论，返回`A_problems=[]/T_problems=[]`，实际评审执行数为0。范围仅为机械校验器，不冒充已部署Runner越权攻击；它恰好说明可信来源边界仍需接通。
- 定向重跑当前`test/delivery-cases/4_4.mjs`中的`E01/E02/E06: archived is not completed`：**1/1通过、0 skip**。此测试先归档，再断言Kp缺失，暴露的是测试oracle与既定关闭边界冲突，不是Kp门已满足。
- plan guard实际返回`valid=true, handoff_ready=true`。与此同时台账仍有`IMPLEMENTATION_ACTIVE`、4 accepted/35 pending、35 remaining，与另一字段的`run_status=COMPLETE, 39/39`并存。结构校验不能证明控制器状态一致。
- quickstart的`COMET=.sdd/vendor/comet/*/builds/*/work/bin/comet.js`赋值实测仍为含`*`的字面字符串，`-f "$COMET"`为false；随后切目录又使其相对路径失效。没有执行该文档的服务启动步骤。

原始新探针在`.local/audits/deep-integration-20261024/`。未重跑118检查或475回归，也未对真实Outline做新的写入/撤权。

## 3. 主要gap（G编号为审查标签，不是新增DAG）

### G1 / P1：真实工作包派发与运行驱动未形成闭环

**证据：**I02终端清单的S7仅有步骤/判据注释，没有可执行controller→worker工作包调用；S8更多是在执行控制状态不可写和启动拒绝探针。当前六个容器均Exited(1)。quickstart仍要求宿主Agent手工串`next → dispatch → 干活 → accept`。

**缺少：**确认目标后，由受管驱动消费Comet的next/dispatch，启动实际角色/技能，限定输入/写路径/凭据，接收实际结果并自动返工/推进；controller退出后原Run可恢复。四个secretRef有值仅是前置，不会自动产生这条程序调用链。

**原归属：**I02、P1_3、P3_2/P3_3、P2_4；对应W1及W2的一部分。

**关闭证据：**真实工作包经过实际worker容器或合格执行器，准确绑定Run/execution/attempt/generation/role/input，产物独立读回；作者不能领取并批准自己的评审；进程退出后同authority/Run/operation恢复且无双写。

### G2 / P1：实际A/T审查、TDD及Whitebox仍被试验数据替代

**证据：**`worker-reports/VERIFY-rework/full-journey.mjs:157`自行生成“independent review”报告；`:174-182`从旧七P1**计划审查包**读取真票，却把`artifactDigest`改写成当前试点dispatch摘要。旧manifest实际审查的是七P1计划束，并没有审查新试点的一行design。`:185`直接制造`oracle:"strong"`和reviewer字符串；`:257-277`的Build/Verify命令仅输出build-ok/verify-ok，V报告亦由脚本生成。

**影响：**它验证了Comet接受/拒绝协议和状态转换，不能证明真正的架构审查、测试设计、Builder开发、独立Whitebox发生过。真实旧票重写摘要后不成为新制品评审证据。

**可信来源边界：**补丁0002的检查器明确只验机械形状，来源独立性托付Runner。当前Runner正向链缺席，就不能把机械合格升级为可信审查。A的参与者集合也由提交者传入且仅要求至少2个身份；本轮终审的授权降级不能自动变成未来所有架构门的默认quorum。

**原归属：**P2_4/P2_5、P3_2、I02及VERIFY。

**关闭证据：**实际调用grill-me及对**当前冻结制品**的独立评审，消费原票/原manifest/tally，拒绝重绑定；T基于实际TestContract出具充分性结论；真实Builder形成可观察行为RED/GREEN；Whitebox独立读回业务终态。最后再跑完整同Run链。

### G3 / P1：Kp与Kt没有落实为独立且不可绕过的关闭边界

**证据：**既定E01要求LLMWiki必要写入/读回失败时不能归档，E02允许归档后等待Outline。当前`test/delivery-cases/4_4.mjs:204-235`在没有Kp时先`archive-confirm`及`archive`，`:354-370`再断言已归档、Kp缺失。该定向用例实际通过。补丁0002的`knowledgeCloseoutBlocked`只核对单个generic closeout seat存在性。

完整旅程脚本又把一次真实Outline发布当作“Kp”，其Kt阶段仅检查该closeout已记录且completed；没有证明“项目知识在LLMWiki已闭合，团队Outline仍pending时可归档但不可整体完成”这一分离路径。

**原归属：**P3_4、P4_4/P4_6、P1_3和VERIFY；W1–W4未充分列出。

**关闭证据：**在同一Run分别登记项目与团队义务/版本：缺Kp所有归档入口都拒绝；Kp通过而Kt失败时归档一次、Run仍pending；重启仅恢复原Outline operation；Kt独立读回后才能completed。直接转换、archive包装、next/resume/clear-current均覆盖。

### G4 / P1：知识授权与权限维护仍缺真实自动触发/接纳路径

**证据：**`lib/adapters/knowledge-revocation.js:500-535`返回一个带engine/originRunId/operationKey的描述对象；在所查生产入口、工具与Comet补丁中，没有找到它及`acceptRevocationEvent/reconcileFullScan`的实际运行接线。报告中的撤权路径是直接调用Outline增删成员、archive/restore，再做API读回。

**已证明：**API主体确实曾获得/失去访问，部分资源读回是真实的。**未证明：**源权限事件/漏报周期扫描经Comet创建并持久化维护Run、调度isolator、重试、告警、恢复和新授权复核。返回字符串`engine:"Comet..."`不是启动了那个引擎。

**原归属：**P4_7/P4_8、P2_4/P4_6、I01/I03；W1的凭据provisioning不能代替接线。

**关闭证据：**真实Git/资料源权限、目标受众和期限变化触发维护；发布前多源披露交集、完整受众/分页、版本与grant被独立核验。维护通过同Comet引擎承接，关联原Run/知识及操作；原交付历史不回写，旧批准不自动恢复。

### G5 / P1：5分钟隔离、外部监控与全渠道访问证明未完成

**证据：**monitor-registration中externalMonitor和告警渠道仍UNREGISTERED。报告明确ALERT_UNDELIVERED、ESCALATION_MISSING；24秒是一次人工变更到人工读回的时间差，不等于事件+周期核验服务的检测隔离SLO。HTML UI、未认证读者、附件/导出等required渠道仍有缺口。

**原归属：**I07、P4_7/P4_8，实际平台/知识owner。

**关闭证据：**故障域外监控持续读取真实Comet心跳/完整扫描水位；漏事件能被全量扫描捕获；实际隔离失败首次告警/升级有授权送达回执；健康依赖3分钟发现+2分钟隔离及故障暴露分别计时。逐身份验证Web/分享/搜索/附件和受控MCP，不能用API key一条渠道替代其它required渠道。可以申请专用测试身份，不必把披露现有明文口令当唯一解法。

### G6 / P1：备份、恢复、保留策略尚未消费原生Comet状态形状

**证据：**`tools/infra/recovery.mjs:178-198`读取workspace根的run-state.json并要求authorityId/epoch/runId；实际Comet控制面位于Change的`.comet/run-state.json`和`.comet.yaml`，已有BACKUP_V1_SHAPE_MAPPING/RETENTION_LIVE_SHAPE_INTAKE未决项。retention扫描针对I08自有operations/knowledge布局，不能从其局部探针推断已覆盖原生closeout义务。

**影响：**目前fail-closed较安全，但备份/恢复能力不可据此签通过；把状态转换成I08 fixture再测不证明原生对接。知识DB与附件一致备份也明确未验。

**原归属：**I08、P5_3，必要的Comet状态适配仍归原Runtime任务。

**关闭证据：**直接摄入真实Run/journal/发布台账/权限和唯一payload，一致备份数据库及附件；隔离恢复后先fence旧writer、认证当前权限、调和未知写、完整对账；原Run/operation继续。清理门真实读取Kp/Kt等未完成义务，不能只看archived。

### G7 / P1或按启用范围P2：代码知识与团队能力分发未完成

**证据：**`infra/delivery/code-knowledge/images.lock.json`仍UNSELECTED/null；deepwiki-open上游repository/release尚未固定，CodeGraph disabled。MCP能力清单目前仅列既有四项，没有以同一事实源登记本方案的Outline/DeepWiki/Graph访问能力。

**缺少：**自托管deepwiki-open真实代码Wiki生成/查询和commit引用；项目、权限、版本适用性；与Agent的实际调用/分发。CodeGraph在当前profile是可选优化，不能强行要求为其启动新常驻服务；未启用就如实登记。

**原归属：**I05、P1_2/P1_3及相应MCP能力owner。

**关闭证据：**固定选定发行物并真实生成/查询；Wiki与Graph分开，业务/架构精华按审核进入项目/团队知识，不把全部Git代码摄入知识库；source版本/权限及禁用Graph后的正确性分别验证。

### G8 / P1：最终验收、状态同步和证据保存尚未关闭

**证据：**118项中104 PASS、9 KNOWN_ENVIRONMENT_DRIFT、3 UNVERIFIED、2 FAILED；合同仍要求全部required通过。结果文件诚实标goal_complete=false，不能把39节点接纳或一次终审共识替换成整体目标通过。

台账主字段仍IMPLEMENTATION_ACTIVE、4 accepted/35 pending/35 remaining，另有run_status COMPLETE/39节点；open_p1还保留7个OPEN。必须从实际证据统一派生，而不是再加一个终态字段。主入口/README仍有“新增能力尚未实现”等旧描述，另有未提交候选，接手者无法只靠标题判断实际启用profile。

**证据保留风险：**主检出的`.whitebox/rework/full-journey/`不存在，原始stage文件实际在rw-p4-4的忽略目录；相关worker树不是可直接丢弃的残留。`stage-archive.json`当前只记录killWindowB的resumed状态，需要保留原击杀原始记录/Run身份后才能审计该窗口。raw结果不能因归档worktree丢失。

在本次查验的主检出与所指rw-p4-4证据路径，未找到完整业务Whitebox的原始typed ledger、validator输出及最终receipt；这不是断言全机不存在，交付方需给出可解析的路径/摘要和实际校验结果。结构guard PASS不是这些证据。

**原归属：**P4_3、VERIFY及唯一Comet closeout owner。

**关闭证据：**修F01/F03映射、退役probe名、A15陈旧前提与总检查缺口；资格验证隔离OpenSpec版本，重跑已知漂移而非无限保留。最终候选全required真实通过；原始Whitebox/Grill与7P1闭合证据齐备；唯一状态/计数/剩余波次一致。迁移Change的OpenSpec一致性、归档与后审仍须独占执行，不能仅用disposition让业务未验项通过。

## 4. W1–W4需要如何解释

- **W1应扩充为实际执行链建设与资格验证。**不仅是为四个ref选密钥来源；S7当前是注释级步骤，必须落成真实调用、受保护结果渠道与正负验证。
- **W2不是先验必做HTTP服务。**ADR-0019第5项首期CLI+固定Runner、零新增常驻业务Server。缺的是受管运行驱动与恢复，不是7300端口本身。CLI受管驱动若可满足，就不必为“六服务running/GET 7300”造新服务；若确需Comet内服务模式，要说明认证/暴露面/唯一状态与不引入第二调度器的证据并经原流程审查。启动一个HTTP健康页不关闭G1–G6。
- **W3是显式范围决定。**F10未启用的拒绝门可有正向机制测试，但跨机器能力仍未验。不能为了宣布深度集成而扩建API；关闭跨机器范围也需显式批准并同步合同/goal，不能直接改成PASS。
- **W4不是都能降为小项。**验收目标映射、required命令失配和归档前置直接影响放行。命名/TAP/工具链隔离/证据链接是工程修复，不应全部等待用户裁决。quickstart的glob变量与换目录问题也需修复并在全新检出真实照文执行。

本报告不新建DAG。若继续同一Change，以上缺口回到表列原任务；若划分下一阶段Change，必须保留与原义务的映射和验收分母，不能通过换任务名卸掉未完成义务。

## 5. 建议顺序

1. **先保存原始证据并纠正当前状态视图。**rw-p4-4暂不清理；把ignored证据迁入已批准的持久证据位置，核对摘要、基线、Run和操作关联。
2. **完成一个真实角色纵向切片。**目标→Comet决定下一步→真实架构/测试/Builder/Whitebox执行→可信回执→阶段自动推进；旧票改绑/脚本自写审查/print-ok必须被独立验收识别并拒绝。
3. **修复Kp/Kt关闭边界。**真实LLMWiki项目知识→允许归档；Outline团队知识未完成时同Run仍pending；远端未知/重启恢复后准确读回才completed。
4. **接通权限持续维护及运维。**事件+周期全量核验→同Comet维护→真实多渠道隔离→告警/恢复/备份；不另起watcher主控。
5. **补代码知识、全required验收及迁移closeout。**跨机器保持独立范围决定，不抢占首期单机团队闭环的关键路径。

## 6. 实证边界

本次实际执行：主检出/git状态核对；交接/架构/合同/源码及旧日志阅读；Docker只读版本和六容器状态查询；当前发行机械A/T检查器反例；当前Kp-before-archive相关用例定向重跑（1/1）；plan guard；quickstart变量反例；证据位置/元数据/来源摘要核对。未运行新的产品模型评审、容器启动、Outline写入/撤权、告警投递、全量回归、118项重验或实际迁移归档。

现有真实进展可以保留；整体受管能力仍需上述实际调用链和终态证据，不能继续把局部协议通过包装成整条业务旅程通过。
