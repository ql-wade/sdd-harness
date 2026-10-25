# P3_1只读宿主接缝（尚未部署或认证）

生产入口是固定`lib/adapters/comet.js`的`observeProtectedSource`导出；本树没有该导出。正式CLI没有替代module/环境/JSON授权配置。`runDeliveryJourney({args,observeProtectedSource})`的代码注入仅供组件接口检查，任何自供case-plan/pilot/definition或自供函数都强制component范围，不能转正。函数存在、文件/摘要相同、role/ready/trusted字段均不是实际资格；I02/P1_3必须先证明真实登记、受保护源代码/策略、实际进程和身份/权限隔离。

## 原Comet入口调用前

同一函数收到`stage:preflight`及profile、definition、candidate、caseId/checkId、evidenceDir、冻结requiredProofLevel/requiredReadbacks。它只能只读核验观察者触发指定原Comet入口的资格；不派发、不创建Run、不签发授权、不决定发布/隔离/阶段动作。业务授权继续由原Comet在实际动作前核验。

返回既有资料的引用：

- `workspace`：原`describeWorkspace`描述，至少真实projectRoot；首次open无需Run存在。
- `authorityRegistration:{ref,digest}`：原Authority.v1登记文件；不得从定义造authority、workspace或Run。
- `policy:{ref,digest}`：当前受保护策略引用。
- `evidenceRefs:[{kind:capability|permission,ref,digest}]`：真实入口能力和权限的原始证据引用，不是新授权信封。

P3再读实际文件核对引用、原Authority.v1唯一登记及原workspace。输出`entry-preflight.json`只是观察记录，明确不是业务授权；这些完整字段本身不证明资格，固定adapter须在返回前完成真实认证/当前性核验。基础设施Qualification.v1八类证据不能替代该入口资格。当前只有组件fixture，正式缺adapter非零UNVERIFIED。

## 原Comet实际动作之后

同一函数收到`stage:readback`、可选期望ActionBinding（已给出就精确核对）、当前candidate、真实actions/argv/时间、当次evidenceFiles、caseId/checkId及冻结证明要求。实际动态绑定只能从Comet输出/受保护启动记录读取，不由definition造placeholder Run。

返回`binding`（SDD.Delivery.ActionBinding v1）、原`workspace`与原`admission`结果。正式路径必须接P2_2严格collect/admit，而非旧dispatch-binding结果；参考候选643325e的`worker-reports/P2_2-convergence/host-port-contract.md`，候选待root独立审查/集成。正式结果至少保留entry.collectionId/sourcePacket.collection及其原protected-source/qualified、当前未过期的qualification；它们来自受保护实际registry，不来自worker payload或unit-only记录。P3不重新签名或另做业务V。

P3独立读原生`.comet/run-state.json`与`gate-dispatches.json`，核run/execution/gate/role/attempt/epoch/input、原authority路径和当前文件稳定性；核原envelope的case/check/执行/候选/过期，以及全部本次原始文件的采集摘要和来源引用。不能换成自有Run形状、另一authority的复制状态或一张generic closeout。

sourceVerifier/collector还必须按真实启动、report/result/methodTrace bytes、当前输入/环境/策略/方法、真实principal、observations和消费账本完成认证。P3读取指针、schema和两份相等JSON不能替代这些保护证明。源工人未安装/验收真实adapter、实际授权或物理隔离。

## 固定case-plan与证据

正式场景须冻结`required_assertions`完整分母、`required_proof_level`、`required_readbacks`。可引用既有schema-valid `case_definition`及`case_definition_sha256`，正式路径必须repo内安全相对文件且无symlink逃逸；正式journey的原recipe也需固定SHA。CLI自供覆盖始终组件范围。只加载一个recipe协议，不新增phase/DAG/retry/lease/恢复引擎。

`required_readbacks`逐项给id/type/expect，jsonFields给必需fields和独立冻结value；equals需冻结字符串值。不得改成nonEmptyFile、遗漏、重复、改版本迎合陈旧数据或降低证明层。104候选映射中的command_or_path/expected_values尚待原owner绑定真实接口，不是可直接签验的recipe。

证据目录必须是本次新建或空目录，不能symlink；所有产物独占创建，原始TAP/inspect/typed读回保留采集摘要。调用者重验时应由原控制器保留上一份后选择新的观察目录；observer不清理旧证据，不自动重试业务。node --test实际argv显式TAP；完整summary与必需目标都须真实执行，TODO/skip/取消/截断/矛盾输出不能通过。

单check CLI0仅证明声明层的实际观察；managedClosureEligible始终false，不能单独关闭整体Journey/交付。当前正式A01为UNVERIFIED/2。F10仍保留原未验语义；本工具没有任意JSON豁免，root的人类范围处置由原聚合入口单条消费，不把禁用负例当正向API通过。
