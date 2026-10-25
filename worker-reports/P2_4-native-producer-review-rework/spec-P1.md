# P2_4 Native producer ports：独立 Spec 审查

结论：**REQUEST_CHANGES，一项已实证 P1 阻断；不接纳5e198。** 原7项窄回归通过不能抵消同principal自批R Gate反例。候选未修改，未循环重试；整体P2_4、当前发行、真实角色/OS/产品Journey均不签通过。

候选5e19890d1b5a0ff3d332799041afac64229e907c，basea497b7b；tree `/Volumes/mac-extend/codex/worktrees/comet-observer-qualification/sdd-harness` 前后tracked clean。依据Root本次原架构边界“R/A/T/P作者与独立审批/测试设计分离”、不能以换execution或角色字符串冒充独立，以及原Native同Run/事务/证据语义。

## [P1] 新producer结果已记录作者身份，但R Gate仍可由同一已认证principal批准

源码落点：0002中的 `domains/comet-classic/classic-managed-host.ts:149–157`、`:197–217`，以及 `classic-state-command.ts` 的acceptGateReceipt调用。admitManagedPacket/evaluateManagedSource仅展开受保护context.admissionOptions中的authoringExecutions/authoringPrincipals；没有将同Run原producer已认证action_completed历史合入或核对。当前合法结构的context列表可为空。相比之下，本候选code.review接纳路径已经显式从原history推导Builder/author执行与principal，说明原事实确实可用。

独立实际反例（一次执行，非模型/OS证明）：原producer R经过真实Node输出、原collector、recordManagedLaunch及acceptManagedAction，原trajectory记录其principal。随后按原Native派发新的R Gate并运行真实Node观察，来源记录报告相同principal；原sourceVerifier将该事实认证进collection，不改Native、admission、Gate或任何签名。原accept-gate却实际exit0/verdict pass，写入1张receipt。预期拒绝断言失败，子程序exit1。

```text
Run: 4251d3a8-0b28-4eb5-9085-f7c4487b9bec
作者execution: producer-r-3d4f4679e71fdb91aa116f42
审查execution: gate-r-mvodkg2a-68d0cef8
两者实际已认证principal: component-principal:requirements-author
Native Gate: exit0 / pass / receiptCount1
```

principal来自原producer事件的producer.principal及Gate sourcePacket.collection.source.facts.principal，不来自用户result.json或role字段。两execution不同也不满足人员/主体独立性。Fixture principal/qualification只是明确组件材料，不声称已取得生产身份；反例确认的正是原实际接纳函数没有消费它已掌握的作者事实。

`principal-authentication-proof.json`已逐项核：原dispatch-gate输出的protectedDispatch、receipt.intent.protectedDispatch和sourcePacket.dispatch对象完全相同；collection.dispatchDigest绑定同一原dispatch。原命令/trajectory/YAML与完整signed dispatch、accepted receipt、author producer record均保留，未重建key或重签collection。报告内哈希引用不代替实际认证；执行过程实际调用原collector/verifyCollection及Gate且返回pass。

建议原作者沿原Native已认证history/producer结果事实修复R/A/T/P及其他适用独立Gate：按同Run/current输入与workpackage选取真实作者execution/principal并喂给严格admission及读回判定，不能依赖外部context自填完整排除名单，也不能仅在R硬编码角色名、仅比较不同execution或删除当前反例。新增检查应覆盖缺作者来源、同principal换execution、资料/版本变更后的独立性与合法独立主体正例；本轴仅实际确认R一条，共用接纳路径对其他Gate的风险为源码推论，未冒称全部实际复现。

## 独立实测与已核有限范围

先以原测试逐字节副本，仅将其相对repository落在自建tmp镜像，原lib/tools/contracts/foundation/.agents/.sdd通过链接仅作读取（不声称OS只读挂载）；新case-audit只写该tmp。测试源码SHA与候选相同，没有改oracle。显式私有lock02cbcd60…选择实际afa7b8de…构建，Node24.15.0：

- 原7项窄回归：7/7、0fail/0skip、exit0，约23秒；覆盖唯一launch CAS/UNKNOWN、真实SIGKILL journal回滚、长read漂移不复活、独立T拒审返工、真实wrapper exit7不得pass、launchId/终态不可替换、冻结archive目标拒绝。
- 上述新增data-only主体碰撞：exit1，真实安全断言失败；原Native实际上pass，不是SETUP/缺依赖/0匹配。只在独立tmp副本插入该反例，完整派生fixture保留。
- 没有重跑作者617秒74项或全481项。作者74/74、481pass/4Windows未验、generated仍只作作者证据，不能覆盖新P1。

原Engine确实保留resolver.action，producer使用原pending/GateDispatch/短锁与journal before/after；长IO锁外回锁重验、只读同execution调和、generic manual不能清pending，P references-only及Goal工具限制、producer无自签Gate和独立code.review等代码构造可保留供返工。它们未关闭本独立性缺口。

归档代码本地getFullYear/Month/Date与原受保护OpenSpec环境保留TZ一致；bridge先核原Run/MAC/目标，apply前日期变更拒绝，managed不fallback其它archive。冻结目标负例已实际通过，真实跨午夜和Windows未验。Root必须最终串行联编security004及实际消费者后再验当前发行。

## 来源、原始字节与终态

manifest SHA fcd135c23ded1cbf06da1e64b92a0f8f1264e59aa12b09f3996cd11365330a9d：3 owned输入、48报告、119新raw逐项hash核对，结束再核无漂移。当前0002为8fcbeb2d…3112c5，tests2_4为00786c45…4eb77（原5ec），case为d85cf5c2…d304307。私有afa7b8de…distribution manifest SHA0d1c94e2…f27e37；实际构建中9个关键source/aggregate文件对发行清单hash匹配。私有Root0003=861d60b7…94742与原0003的728条增加/删除程序行序列完全相同，仅context不同；中央0003/锁仍旧，未纳security004，不能称当前发行ready。

原7项命令/输入/UTC/退出/raw见 `/private/tmp/P2_4-producer-spec-lkqm88f5/metadata.json`，stdout SHA3cfa84412c8253e4fca09acdb9313ce56ef2f122724f929c0f48812cbab83e92。反例命令/派生源/insertion/UTC/退出/hash见同目录principal-negative.json及mirror/test/delivery-cases/principal-negative.mjs完整派生fixture；stdout SHA1c87479fa8b9681969a7b6babef3ef2fa0b3b5e96cb6cd9d0309dbd37928d680，stderr SHAb4fdb6870f62c3779467acd5aecf426638bc24c2fe372ad95eac858656958f9a。原不可变审计在principal-authentication-proof.json指向的case-audit目录；三个original-*.json是原对象的无损JSON提取，原始命令字节另保留。

15220、6198均明确终态（独立反例子程序exit1；记录器exit0表示取证完成，不是产品通过）；无本审查已知open句柄。外部模型/Docker/platform/distribution guard调用0，无真实模型/OS/资源/API/credential/网络下载/全局设置或候选写，未派agent/Goal。业务通过增量0。

审查 UTC：2026-10-25T22:08:06.178040+00:00
主体认证proof SHA256：`bcb6f7dd1b9beaf0c30ee59f9c356ba989b8398843ee23e92b6fcb9cb420176b`。
