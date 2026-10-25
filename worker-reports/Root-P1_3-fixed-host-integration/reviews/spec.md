# P1_3 fixed Gate host checkpoint：独立 Spec 审查

结论：**APPROVE_FIXED_GATE_CONSTRUCTION_CHECKPOINT_ONLY**，本次限定范围阻断项0。不能据此接纳 whole P1_3、正式 bootstrap、非Gate动作、正向冷恢复或生产/角色/OS资格；这些仍是原任务未关闭义务。

固定候选55987b133f71ef9ada8bc5330f6465dfcd492a37；base2d2506fb3b355ebd1ad53cc3aea2a64905df23d9。tree `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness`，审查前后tracked clean。依据原P1_3的同Run/固定Runner/可信来源/唯一Spec owner边界及Root本次明确冻结的Gate-only checkpoint。

## 可消费的建设范围

- createRunner.admit最后绑定自身authority，caller数据不能覆盖；原foreign签名有效但传入foreign authority的反例现被原固定authority拒绝。cometLaunchAuthority复用原P2_2 collector/verifyCollection，并在两入口拒绝foreign Run，不新造签名/来源体系。
- createCometExecutor仅由受保护bootstrap CODE绑定Native/source/authority/registration。普通执行输入精确限execution；role、phase、authority、currentActionBinding、handle、qualified或module字段不能选择消费者。缺登记在物理启动前UNVERIFIED。构造接口本身不认证任意调用方提供的source/登记，这仍是后续受保护部署前置。
- 当前意图实际来自原Native Run及gate_dispatches，复验当前ActionBinding、原签名、run/gate/execution/role/attempt/epoch/input/policy与固定job/role/registration输入。签发仅走原Native调用与短锁上下文；由原Native继续持有门、事务、失效与phase，未增加持久queue/phase/ledger。内存Map只保留当前实例的观察与句柄。
- 原6da实际Runtime原始模块按固定hash读取；固定I02三口代码在本地synthetic physical程序上启动真正Node测试，原严格collector与纯Gate接受同一Run的一项机械R观察。它证明接线和实际进程字节，不证明Docker inspect返回值、真实容器/模型、方法应用或独立语义审查的生产真实性；测试和报告均明确这些未验，sourceEntry有限scope不签整体。
- unknown worker bytes虽client exit0仍不产gate receipt或自动重试；原消耗attempt、crossRun与额外控制字段拒绝。来源撤销事实会到达原Native失效观察，恢复旧资格标签不复活旧intent。冷进程读回同Run但缺原handle/resolve时明确UNVERIFIED且0重启，未冒作正向恢复。

## 实际复核与 custody

独立使用固定Node24.15.0，既有临时fixture、原函数和严格外部拒绝器：

| 命令目标 | 实际结果 |
| --- | --- |
| test/comet-execution-binding.test.js + test/comet-driver.test.js |35/35、0fail/0skip、exit0 |
| test/delivery-evidence.test.js + test/delivery-gate.test.js |52/52、0fail/0skip、exit0 |

两组均显式node --test --test-reporter=tap；argv/cwd/UTC/输入不变与原始输出摘要在 `/private/tmp/P1_3-fixed-host-spec-53slh8k5/metadata.json`。实际外部模型/container/platform/distribution guard调用0。仅临时普通文件与原测试的私有child HOME，没有真实Docker/model/API/secret/下载或主配置写；没有新worker/Goal。工具句柄31139已终态exit0。

manifest SHA `ce44668c966525bfa867e3cdf97a1471479e513ed60bf916afe917cece568f73`：117 content与203 ignored raw逐项hash匹配，独立测试后复核仍一致。candidate-inputs的排序紧凑JSON算法独立重算为 `c3c87e9f96e12f7a117cf7f9177dbdcc5ccb753d120052560d43afe897798f69`。b02884990883916258e19a413aa92fe6dea28a5f仍为祖先；559相对它仅报告/metadata token/manifest差异，四源码及35/52原始结果未被改写。FREEZE-NOTE明确中间提交先于成功冻结的事实，没有抹历史或将其当有效终版。

## 仍须后续完成，不构成豁免

实际薄main/受信bootstrap与secretRef/identity/grant登记；原Native非Gate author/test/Builder端口；原Run执行handle的只读冷resolve和同Run恢复正例；I02 execution slot；生产固定agent程序、方法内容执行、Edit/Shell/MCP逐渠道、真实来源/角色/OS隔离。它们在REPORT/PORTS/ENTRY-DECISION均明确未实现/未资格，不得由Gate-only链补齐。当前使用旧固定6da仅作机制材料，未继承Root新305629联合发行资格。Root下一slice须精确重新绑定并最终真实Journey验收。

本审查仅支持四个owned源码/测试的有限接线建设；实际业务通过增量0，Root保留串行接纳与后续独立验收权。

审查 UTC：2026-10-25T20:11:23.503691+00:00

独立 metadata SHA256：`1c00d0aed99a788b0bf422e83df4a443078b5da49c4f6f7bce80392cdbcc9930`。
