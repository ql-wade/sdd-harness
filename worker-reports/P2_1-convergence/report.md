# P2_1 共享契约与输入基线实施报告

状态：组件测试通过，整体回归未绿，独立审查与整节点接纳由root负责。本工人没有修改主检出或canonical任务/状态/DAG。新profile运行场景接受数仍0。

## 已实现的公开接口

- computeFullInputBaseline保留原sources/tests/lockfiles/migrations/deployConfigs/artifacts，增加designs/testIntents/methods/policies/environments；实际读取声明文件字节。未知/空/类型错误清单、绝对/越根及外链输入明确拒绝，不对空范围签摘要。它仍绑定声明清单，不自动证明未声明文件已被完整枚举；调用者必须按受保护policy建立完整范围。
- taskDefinitionDigest只忽略真实Markdown进度标记并统一CRLF；正文、代码围栏里的checkbox字节变化不再被吞掉。requireImplementationBaselines要求非空revision及SHA256，缺身份不放行；verifyReportCurrency缺当前摘要也拒绝。
- TestContract v1增量可选commandBindingsRequired/checkIds/requiredChecks{id,command,caseIds}；开启严格模式即核对AC→case→oracle→required command双向追踪、唯一身份、必需case分母和逐case执行记录。旧调用者仍明确ac-only范围，不默认为严格完成。trace算法留在纯schema层，baseline保留兼容导出。
- evaluateExecution拒绝取消/矛盾TAP摘要；严格模式要求每个必需case/check有唯一passing记录且命令等于冻结命令，总数量不能代替所需case或检查。caseResults属于待认证的观察数据，后续P2_2/P1_3/P2_4必须提供受保护来源；这里不相信role/trusted标签来证明真实执行。
- 新增SDD.Delivery.ActionBinding v1，通过原defineContract/parseContract注册；冻结克隆，绑定profile、runnerId/run/action/gate、workPackage/taskIds、execution/role、revision/attempt/epoch、input/policy/environment摘要、方法ref/固定版本/内容摘要、paths/tools、输入输出。示例使用comet-managed-v2，schema不硬编码全部workflow。拒绝currentPhase/trusted和嵌套未知字段、浮动方法版本、越界路径、通配工具及超出允许写范围的输出。它没有派发、重试、phase、持久状态或来源认证能力。
- 原型成员不再冒充注册合同或closed-schema字段。原八合同仍保留，版本边界不改；ActionBinding是第九个增量合同。

## 实际RED/GREEN

每片先在现有public seam运行失败再最小修复。日志对：01输入组漂移、02空/未知/越界manifest、03任务正文/代码checkbox、04缺基线内容身份、05取消/矛盾执行、06必需case/oracle/command追踪、07ActionBinding注册及不可变、08越权字段/路径（最终绿色见09）、11必需case执行记录、14必需case分母、16必需command覆盖、19原型键、20输出路径范围。全部原始输出和摘要见evidence/及normalization-record.json。输入字面量在授权测试源码中，final code/test SHA256另存input-manifest.json，不把最终摘要伪称为历史RED时冻结快照。

08后首次真实2_1用例遇到当前Node25子进程默认reporter变化，TAP为空；这是测试宿主协议缺口，未记有效行为RED。只在本任务拥有的runNodeTest显式加--test-reporter=tap，原断言未放宽。首次npm回归因新工作树尚无commander等依赖出现42失败，明确为环境未就绪；随后从原package-lock isolated npm ci --ignore-scripts，不改依赖/锁，再用既有Node22.13.1做正式回归。

## 最终执行结果

- node --test test/delivery-baseline.test.js test/delivery-test-contract.test.js test/delivery-cases/2_1.mjs：54/54通过，0跳过；包含真实子进程零测试、全skip、环境故障和断言失败分类。
- Node22.13.1 npm test：509项，501通过、7失败、1跳过。失败逐项列于verification-results.json；保留C08/B08旧宿主断言、multi-agent-consensus-review源与分发manifest漂移相关4项，以及Outline image admission状态oracle。没有通过改其它owner产物来凑绿。
- bash scripts/check.sh：规则层和基础技能检查通过，止于vendored Whitebox green fixture失败，后续总检查未完成；未改.agents快照。
- git diff --check作为提交前格式检查执行；不把它提升为业务验证。

## 下游接线与剩余边界

新profile的P1_3/P2_2/P2_4需调用parseContract(ActionBinding)，重新计算真实输入/方法/环境摘要并核对受保护策略与执行来源，启用commandBindingsRequired并由真实recorder提供caseResults。schema接受reviewer字符串不代表其独立，oracle有文本不代表强度，caseResults声明不是认证。R/A/T/P/V/Kp/Kt与所有失效代际仍归Comet；本组件没有第二阶段/流程引擎。

全量回归失败不关闭，资产manifest、C08/B08及资源准入由原owner后续修复；实际角色、知识/平台和完整Journey不在本切片签验。本工作树保留；root独立审查后串行接纳。日志只做机器路径归一化，原字节保留在ignored local审计目录，不进入公共分发。

## 独立审查后的三项限定返工

1. evaluateExecution的第二参数`{ requireCommands: true }`由调用方受保护policy提供，不能从worker payload/profile/role派生。它要求合同明确commandBindingsRequired=true并通过完整命令图检查；旧合同、缺声明、自填false和profile标签均不能降级该入口。所有返回（包括reject）明确scope：component/ac-only、component/declared-command-links或component/required-command-links，且managedClosureEligible=false。即使严格组件accept也不能直接关闭managed/Journey；来源认证和真实终态仍须后续admission/Comet独立证明。22-*保留真实RED/GREEN。
2. taskDefinitionDigest识别相对于文档或实际父列表内容的四列缩进代码，tab按制表位展开；独立spaces/tabs代码中的checkbox变化必须改变摘要，真正嵌套任务进度仍可切换而不漂移。原围栏/正文测试保留，新增23-*真实RED/GREEN。
3. 一个真实测试子进程产生assert.equal失败TAP，再由真实wrapper进程故意exit0，原helper误收为RED现被拒绝；正常exit1失败仍有效，null退出、取消、零执行、环境故障拒绝。24-*为真实RED/GREEN，临时fixture在finally清理。

本次最终窄seam+真实case为57/57通过、0跳过。Node22回归512项：504通过、7失败、1跳过；失败集合与前轮相同，未修改C08/B08、资产manifest或镜像owner。旧check.sh的Whitebox fixture失败继续保持，未因本次四文件行为改动重复运行。原13条证据未重写，原候选input/result清单保留history/，当前输入和报告摘要已重算。源认证与整体运行验收仍未完成，本工人不更新canonical进度。

## 摘要scanner二次限定复核

闭围栏必须同字符、长度不少于开围栏、尾部只有空白；带正文、较短或不同字符的标记不能结束代码区域。根级新围栏按实际缩进清除已退出的列表容器，防止旧列表上下文把后续四空格/tab代码当成任务；合法嵌套列表内围栏及实际任务progress仍正确归一化。27-*和28-*分别保留真实RED/GREEN，原57项及原始证据保留不改，最终窄seam+真实case59/59、零跳过。

本次只改baseline摘要scanner与授权测试，没有改caller strict/scope或退出码分类。完整npm回归未重复：本次改动集中在纯摘要函数，原512项（504通过/7失败/1跳过）属于36c7b7a候选的历史回归，失败仍开放；不能把它冒称本次新候选全量通过。当前input/report摘要重算，36c7b7a清单留history/。独立复核和整节点接纳继续由root负责。

## 经批准的生产AST替换（scope修订8eb19d5）

先由30-*复现手写scanner对过缩进伪闭围栏/HTML等的真实失败；正式实现删除手写块状态机，使用公开commonmark Parser AST的item首个paragraph及sourcepos定位真实任务标记，再回原source仅替换进度字符。raw normalizeTaskProgress不render、不重排、不改CRLF或正文其它字节；现有taskDefinitionDigest的CRLF→LF约定在明确独立层保留。定位不合法或原文不匹配则不改。

package.json精确registry pin commonmark0.31.2；package-lock保存该包和entities3.0.1/mdurl1.0.1/minimist1.2.8完整resolved/integrity。没有file:本地tar依赖，没有修改旧锁中既有包。公开npm原包SHA512匹配，许可证BSD-2-Clause，见35-*。实际缺依赖隔离项目ERR_MODULE_NOT_FOUND明确失败，不回退旧scanner；这是环境资格负例，不是行为RED。

32/37-*的生产窄seam+真实case61/61通过、零跳过；33/37-*全部27个批准矩阵改为直接调用生产导出并27/27通过，既有strict caller/scope/矛盾RED/ActionBinding回归保留。全新npm ci从完整锁重建通过；最终Node22 npm回归516项，508通过/7失败/1跳过，失败集合未扩大；check.sh仍止于原Whitebox green fixture失败，后续检查不冒称通过。未修改外部C08/B08、资产manifest、镜像或.agents。

之前手写scanner修复及原57/59证据仅作历史保留，当前生产只有一份AST实现，未叠加原型或旧scanner作为fallback。所有原证据未改写，新增raw输出留ignored local审计，报告路径归一化。当前输入摘要含新增root package/lock，旧e35b852清单保留history。只准备root独立接纳组件，不签真实角色/来源/知识平台或整体profile通过。

Root整合时仅规范化分发日志的行尾空白/多余末尾空行，原字节在工人原提交及.local审计副本中不变；root-whitespace-normalization.json记录两份摘要。此后分发副本不冒充原始stdout，产品、测试输入、退出结果与语义未改变，最终manifest以本文件为准。
