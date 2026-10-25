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
8. P4_3/VERIFY：全新会话、新profile、同最终候选的完整Comet产品Run，随后关联权限维护；本期129required/103场景及正式Whitebox/Grill/状态一致性通过，并明确保留F10未验处置后，才由Comet继续本迁移Change的规格归档和后审。

合同列举的具名受限工件交接边仅允许消费准确绑定、已独立审查并集成的实现工件，不能签业务接受；详见contract.dependency_readiness。建设任务不提前要求下游完整旅程通过；反过来局部建设接受也不能关闭完整旅程。

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

当前进度：6/39节点在文档/基础工具/合同范围接纳，业务场景0；当前完成条件129/103、F10正向另期未验。建设代码/资产05e36d0：P1_2经双审和真实跨Git运输缺陷修复后主67/67，准确源码6433重建缓存，新Git归档自校验0，旧816缓存字节/5活配置不变；原暂存缺42fixture已更正且新14fixture明确入提交。I03主43+82、P3_1主72以及其余已双审建设工件仍只按范围消费。总检查801/791/10fail0skip仍FAIL，P2_5/P1_5/I02/P3_4原owner承接。P2_4原worker/树已核18哈希和全部已知终态后续做，不新建控制器；原Native fixture已有有限RATP/控制写/返工证据，完整joint/故障/真实身份仍未验。I04工人实际SDK/原生索引/nativehost fixture已观察成功但候选待双审；P4_4旧publish schema与路径还未接通。I05安全YAML结构建设已双审并主83通过，未部署生成。GitHub当前可读但远端cd64618未保护；完整角色链、平台、知识/权限恢复、129required/Whitebox/Grill/唯一Comet收尾均未完成。具体见三报告和唯一state/ledger，观察先核实际句柄防双启。

最新I05建设证据：91b08be（source4458c17），主83/83，六离线守卫+隔离PyYaml6.0.3校准；最新总检查801/791/10fail0skip，七输入/五配置不变，未新增失败身份。该建设接受不含部署、生成、真实认证/API-MCP或恢复，wholeI05仍未验。I04原703类型缺陷已由独立公开反例退回，原owner最后43项已报通过、候选待交；I06原任务已启动只读接线，不因GitHub可读授予写权。

当前补充：I04 source6633913已双审并在主53/53后集成07bf495，生产注册/角色/grant/Kp/sameRun仍未验。MCP三路径已按metadata双审归原P1_3，commit47528ef，39/69/步骤/deps/验收与权限不变，contract67f06a；pilot PlanBundle仅跟随明确归属修订显式重冻结到618d3431，资格仍NOT_VERIFIED。Root生成的两pyc已逐字节保全迁出，不改原方法源/断言；初次785/773/12fail记录保留，修后全801/791/10fail0skip，6输入/5配置不变。I05安全YAML83边界仍成立，但另有manifest坏JSON任意片段回显P2正由原owner修，不能据旧83宣称完整诊断安全。最终required与真实同Run交付仍未通过。

最新诊断闭合：I05 f985800已独立两轴、主99/99后集成05e36d0，安全YAML原段未变；最新全仓801/791/10fail0skip，二输入/五配置不变，旧失败身份保留。I06 04e5655因run/workflow/artifact关联P2退回原owner，未真实写平台；Core P2_4最新fresh/完整用例仍待限定候选和独立双审。五个登记Outline容器当前running、应用healthy仅是liveness（.local/comet-reset/i03-current-liveness/observation.json），不证明权限或知识交付。最终129检查/103场景和whole角色/平台/Kp/归档/Kt/权限恢复未验收。
