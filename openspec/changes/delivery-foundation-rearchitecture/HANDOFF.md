# 当前执行入口：Comet流程与知识基础设施收敛

日期：2026-10-25。用户已经明确要求清理旧流程、按最新架构实际落地并端到端完成；不是只交计划。当前root聊天是唯一迁移planner/台账写者，当前原生实施工人使用隔离工作树。产品业务的状态、派发、返工、恢复和完成权只属于Comet。TeamAI只分发，方法技能不成为第二主控。

## 目标与证据边界

原目标是Foundation、两类知识库和Command门禁驱动的AI DevOps全链路。读`docs/architecture/comet-ai-devops-convergence.md`、ADR-0020及本Change的proposal/design/spec，再读tasks/DAG/contract。

- 保留原39节点、30父任务、69工作包、92场景和118检查。
- 新增N01–N12命令/知识贯通场景与检查：现104场景、130required检查，全部在新profile重新验证。
- 旧报告、原票、原始日志、Run及知识记录保留历史；新profile0验收，不继承原39/39或104 PASS。
- 九个旧业务命令及九个source-command迁移副本已移到可恢复备份。还要证明安装/更新/分发/冷会话不再生，不能仅凭文件移走勾选完成。
- raw旅程证据保留于主检出`.local/comet-reset/preserved-full-journey/`并有摘要清单；原rw-p4-4工作树不清理。

所有当前任务步骤只在tasks.md维护。旧30行别名勾选已转为只读身份映射，避免第二进度和归档时的重复未勾项。任何状态汇总从该唯一源和实际证据派生；不能再并存COMPLETE与remaining35等矛盾字段。

## 术语与清理范围

- 统一业务入口是原生`/comet`，机器驱动/诊断沿用固定版本的实际Comet CLI。
- R/A/T/P/V/Kp/Kt是既有Run内的逻辑门/义务，不创建新阶段引擎。
- 删除发现链里的旧sdd阶段命令、Trinity/Superpowers运行依赖及stage薄壳，不暗中重定向旧入口。
- 合法Matt方法、test-authoring、Whitebox、consensus、lifecycle-guard、Ponytail原样快照保留。历史引用和许可证不因字符串命中被篡改。
- LLMWiki=单项目Agent精华，Outline=团队精华/跨项目知识，deepwiki-open=代码Wiki，CodeGraph=可选结构索引。OpenSpec仍持有需求/设计/测试意图/任务的正式权威；源码不全量入知识库。
- 不清空真实知识/数据库，不卸载全局/其它项目技能，不销毁旧Run或唯一工作区，不为健康端口新增一台主控服务。

## 当前安全子步

P1_2安装防再生子步已独立审查并合入`e0fde44`，主检出行为测试7/7通过；I01项目/调用者身份回读子步已独立审查并合入`6bb1b4c`，测试26/26通过且真实GitHub只读身份匹配。两者均不代表完整任务或新profile验收。当前两个安全子步工人均已结束；后续实际句柄和进展见execution-state。

历史前置候选36fcf5c进一步合入`291ccc8`装配测试隔离和`36fcf5c`三个身份调用点/平台完整校验修复：独立复验后主检出8/8与77/77通过。全量回归最终496项489通过、7失败、0跳过，源活配置摘要不变；总检查失败，隔离OpenSpec1.11.0 strict通过。该候选的支持检查1通过/2失败/127未验只保留历史，不能充抵当前130required。详情见verification-report；工人已结束。

15份冻结材料已获人明确授权，实际用两轮完成三方共识并经机械finalize；Claude Code8.8、ZCode9.2、Codex8.6，全部APPROVE且无阻断。回执在architecture-review/comet-convergence-r1/receipt.json；只批准实施，不授权profile启用、平台写或发布。两项MINOR在原P3_1/P3_2等任务闭合：统一profile token，清除三条旅程的旧IMPLEMENTED/PASS当前标签。原包/原票保留；本次一次性资料外发许可已用于完成该评审，不能借余下轮次复用于新材料。

根控制器只串行接纳已独立审查的diff。工人不改tasks/DAG/contracts/锁/台账，不碰主检出活配置，不复用带原始证据的旧工作树。

## 分阶段执行（全部仍在原DAG）

1. P0_1–P0_4：对齐原目标、收敛架构/术语/动作I/O及独立架构审查，冻结当前制品。旧架构票不是新制品通过证明。当前授权允许旧入口安全退休/防再生修复先做；新业务profile的启用仍须实际Gate。
2. P1_6/P1_2：方法/profile唯一源与安装/分发/卸载，退役源/生成副本/受管链接同时处理，防恢复和自动迁移重新暴露。不要改上游技能正文或增加阶段技能壳。
3. P1_1/I01–I06：精确工具链/Comet构建、身份与动作授权、固定Runner、LLMWiki、Outline、deepwiki及平台逐项资格化。环境缺失就UNVERIFIED；CodeGraph是可选件，不把所有MCP变服务。
4. P1_3–P2_5：真正接通Comet工作包→实际角色/工具→正式产物→可信结果接纳。R/A/T独立，A真实grill/原摘要共识、T实际测试设计审查，P只生成计划。受信身份不能是调用者填role；hash不能证明来源。
5. P3_1–P3_3：先资格化验收器，再跑实际角色R→V切片与核心事务恢复；真实行为RED/GREEN和独立Whitebox。完整旅程配方交VERIFY，在所有下游机制齐备后才执行，避免验收循环。
6. P3_4/P4_1–P4_7：真实平台SHA/checks/制品digest/目标环境、LLMWiki Kp、唯一OpenSpec归档、Outline Kt及同Run未知结果/重启恢复。Kp缺失所有归档入口都拒绝；Kt缺失同Run仍pending。
7. P4_8/I07/I08/P5_1/P5_3：权限事件+周期全量核验接同Comet维护，真实多渠道隔离、告警送达、新授权恢复；原生状态/知识DB/附件备份及R10保留。F10保持独立启用范围，不为凑完成扩建或伪报未启用为通过。
8. P4_3/VERIFY：全新会话、新profile、同最终候选的完整Comet产品Run，随后关联权限维护；130required/104场景及正式Whitebox/Grill/状态一致性通过后，才由Comet继续本迁移Change的规格归档和后审。

三条受限工件交接边仍仅允许验证准确绑定、已独立审查并集成的实现工件，不能签业务接受；详见contract.dependency_readiness。建设任务不提前要求下游完整旅程通过；反过来局部建设接受也不能关闭完整旅程。

## 新流程验证必须观察什么

完整链是：

`目标→知识检索→R→A→T→P→实际测试作者/Builder RED-GREEN→Reviewer/Whitebox V→真实CI/CD→LLMWiki Kp→真实OpenSpec归档→Outline Kt→completed→关联权限维护`。

- 实际工具/方法快照、角色、允许路径与真实execution必须能关联到当前Run/action/输入/策略/attempt/epoch/revision。
- A使用当前制品的原票/manifest/tally，禁止从旧计划票复制APPROVE再改artifactDigest；T不能由脚本写strong标签替代；Build/Verify不能用print-ok替代真实测试与业务读回。
- 产品Run中真实故障窗口必须继续同Run/authority/operation。远端未知结果先读回，不能另建页/重复部署/假装completed。
- Kp是项目精华并有LLMWiki索引/引用独立读回；Kt是受管团队精华的Outline发布/版本/受众读回。不能一张generic closeout同时冒充两类独立义务。
- 完成后维护由同Comet引擎关联maintenance Run承接，保留origin_run/knowledge/operation，原交付历史不改；事件/漏报全量扫描/隔离失败和授权恢复均真实执行。
- 所需Web/分享/搜索/附件/MCP、截图/网络/console/服务日志不能互相替代。缺能力/资源不是not-applicable，局部/mock/protocol结果不能关闭跨边界要求。
- 备份/保留必须直接消费原生Comet目录和状态形状，不用自有fixture信封替代；旧writer未围栏不启用恢复。

## 原任务、检查与外部边界

每个check的命令、owner、expected和证据要求在execution-contract，N01–N12已进入正式spec。新profile/新目标尚未实现时必须返回非零UNVERIFIED，不能把空匹配/缺模块当行为RED。先写有效负例，实际RED→最小GREEN→回归→独立审查后再接纳。

旧118检查ID全部保留，但违反原spec的旧oracle应按正确语义重新RED/GREEN；不能为了保持旧绿继续允许缺Kp归档。known-env/pre-existing/holder不能豁免required。OpenSpec使用资格验证的隔离工具链，不随意降全局。

先完成可审查的实际配置/变更，再处理确需授权的外部写：源/目标owner、发布/隔离grant、告警发送、平台保护/部署/回滚。密钥不进代码/报告；不复用其它项目凭据。旧一次性资料外发授权不能覆盖新审查材料。敏感/越授权回owner；常规命名/路径/发现/工具版本问题由原owner修复。

## 目标与监督

当前原生Goal已由人恢复并读回active，目标仍为完整架构端到端验证和报告。20分钟监督复用现有sdd任务，读取唯一DAG/台账、实际worker句柄和证据，只报告有依据的进展/阻塞/终态及上海时区ETA；未知ETA明说。监督不成为第二派发者，不因静态锁/超时重新启动工人，无变化不重复报告。

只有所有required当前通过、原始Whitebox ledger/validator/证据审阅及Grill完成、已知阻断/P1有独立复验、平台/知识/恢复终态和唯一状态一致，才能关闭总体目标。产品试点Run中的archive与本迁移Change的VERIFY后closeout分开，后者也只由Comet Spec Adapter写；禁止调用planner helper finalize代替实际运行责任。

当前进度：文档/设计P0_1–P0_4、工具链P1_1和共享合同P2_1在声明范围接纳（6/39）。P1_6供应建设工件已集成3f69f9c并主复验8/8和fresh b11发行，整个任务仍待实际冷Agent/角色应用，不勾未完义务；P1_2仅可按双审建设工件入口继续。P2_2/I01建设工件已分别集成327302b/ce98a2c并主121/121及41/41；其wholeTask未验，P2_3与I02–I06只按双审精确建设边消费。P1_2/I03实施中；P2_3薄CLI建设工件已集成ea2e07d并主31+60通过，whole全兼容仍未通过；P3_1正修独立复现的relativepath/cwd错目标P2，旧typedinspect两项已关闭，两工件边待最终双审/main复验。当前全仓560/546/14fail0skip，5活配置摘要一致，104业务场景0接纳，129项本轮required最终重跑，F10保留未验。F10人已明确首版不含正向API，保留未验并排除本轮完成条件；129/103当前口径已按scope技术合同双审落地，130/104总记录不删。主检出唯一写点，实际worker和证据见execution-state/ledger，旧会话壳不作为工作点。
