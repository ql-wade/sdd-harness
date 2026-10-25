# P2_2 host接线契约（未部署，不是新Run状态格式）

## 生产信任前置

I02/P1_3必须先证明实际controller/worker权限、私钥隔离、真实进程/会话归属、方法与工具轨迹、artifact持久化及独立读回。`observeProtectedSource`尚未实现/未登记资格时，正式调用只能非零UNVERIFIED；不能把本文件或unit fixture当资格签发。JSON、CLI参数、worker回包的trusted/role/kind/profile不能配置代码端口或提升信任。

### Launcher与collector

`createLaunchAuthority({secret, sourceVerifier})`沿用原HMAC闭包，仅增加`collectResult`/`verifyCollection`。没有公开通用sign/seal入口，没有新证书库、Run、业务状态、队列或重试。`issueDispatch({...Runner.Dispatch.v1, actionBinding})`复用已接纳ActionBinding parser；平面run/gate/input/policy/attempt/epoch/role/execution与完整ActionBinding必须一致，全部方法/权限/输入/输出一起签入。

`await authority.collectResult({dispatch,envelope,launchRecord,reportBytes,resultBytes,methodTraceBytes})`不启动角色。三种bytes必须来自真实source原始读回；launchRecord最少含launchId/execution，并携带实际backend process/session记录。collector对Action、dispatch、envelope、launch、report、result、methodTrace做内容绑定；不同原始报告不能借用旧来源签名。

`sourceVerifier(request)`是受保护宿主只读代码函数，可在collector阶段核验实际source。request含上述原始数据、已校验actionBinding及expected摘要；expected仅供比较，严禁原样echo作为来源证明。它必须独立读取实际登记的启动记录和原始artifact，核对当前资格与身份，再返回：

- `ok:true`
- `qualification:{id,sourceId,revision,scope,status,expiresAt,evidenceRefs:[{ref,digest}]}`。只有真实已登记且实证的source才可投影为scope=protected-source/status=qualified。local-only不能如此签发；current快照也必须来自受保护实际registry。不要传secret/credential值或无关私人数据。
- `facts:{actionDigest,dispatchDigest,envelopeDigest,launchDigest,reportDigest,resultDigest,methodTraceDigest,run,execution,launchId,environmentDigest,principal,observations}`，摘要对应其独立实际读回。observations每个case/check唯一，包含`caseId/check/command/result/executions{total,valid}`，由真实执行或typed ledger测得；不能采用worker自填的计数/身份。

只回true、字段/角色、hash-only acknowledgment或缺原始bytes都不能完成此接纳接口。方法trace读过Skill文件只能说明发生读取；collector不负责也不证明A/T/V业务充分性。异步source读取仅发生在本collector阶段，不能放进Gate。

### Managed admission

`admitEvidence(packet, protectedOptions)`的第二参数来自宿主受保护policy/当前Comet Run，不从worker payload推导。必须有：

- `requireManaged:true`、真实注册的authority、当前`actionBinding`、当前`sourceQualification`；
- 当前environment标识、明确purpose(independent-acceptance或authoring-self-check)、builderExecution/principal、authoringExecutions/principals；
- 同一Comet权威状态导出的consumedCollections/issuedExecutions数组，以及宿主读取一次的明确now。

source资格需当前且未过期；ActionBinding全摘要覆盖当前run/revision/attempt/epoch/策略/环境/方法/输入版本。新发行拒绝重复collection或execution；同Builder/测试作者执行或实际principal不能伪装独立。资格和clock未知默认拒绝。该库不原子消费/保存这些集合，P2_4须沿现有Comet锁/事务一致接纳和派生；不能用空数组代替真实账本。

### Pure Gate与已有review接口

`evaluate(inputs,entries,policy,{requireManaged:true,admissionOptionsFor,verifyReview})`强制已有command-bound TestContract，逐必需case/check核对已认证实际command/计数/结果。两个端口只能是同步纯查询/校验；模块不执行LLM/工具/网络/保存/派发/重试。Async/generator端口在调用前拒绝，这不是对任意JS代码无副作用的证明，宿主仍须审查并注册纯实现。

`admissionOptionsFor(entry)`只查询调用Gate前已读入的实际Comet/source projection，给上节protectedOptions。重验已接纳证据时可额外给`acceptedEntry`，仅当它与输入全内容相等且其collection/execution均在权威消费投影中时排除自身ID的重复发行检查；不一致保持RECOVERY_REQUIRED。worker自填acceptedEntry/accepted标志无效。这个对象只是既有收据的内存读回，不引入新持久Run形状。

`verifyReview({entry,inputs,policy})`仅校验Comet此前已完成、已认证的审查记录。A复用已有consumeArchitectureGate的冻结原manifest/ballot/tally结论；T复用consumeTestDesignReview/TestPack充分性；V复用已独立执行Whitebox typed ledger/validator/终态。旧adapter若需要文件读取或机械命令，应在Gate前的原Comet动作中执行，不能由Gate再调用。

其纯投影返回`{ok,sufficient,evidenceDigest,envelopeDigest,reportDigest,actionDigest,execution,principal}`，全部指向当前原始记录，不是新业务审查工作流。执行/主体须独立于Builder/测试作者，但可以就是已独立Verifier/source本人，无需凭空再做一轮V审查。缺原始记录、弱oracle/未闭合case/仅方法读取或不匹配摘要必须返回拒绝。数据中的oracle:strong/sufficient/pass自身不具认证权。

GateReceipt沿原v1 evidence数组同时记录envelope、已认证collection和完成review的摘要，不改共享schema。合法单门pass可由原Comet接纳；`managedClosureEligible:false`说明本helper不能单独签整体交付/Journey完成，不是永远拒绝合法单门。整体验收仍需原130检查/104场景、真实资源和完整知识/平台/恢复义务。

## 必要兼容与实际缺口

不传严格参数的旧调用保持component/dispatch-binding、component/receipt-coverage有限范围；序列化entry/receipt也带managedClosureEligible:false。旧wrapper/CI/legacy adapter不能凭旧pass关闭comet-managed-v2：P1_3/P2_3/P2_4必须由受保护profile路由选择严格入口。sourceVerifier缺失时collectResult拒绝，实际source资格/密钥隔离/真实角色和方法目前未由本工人安装或验收。
