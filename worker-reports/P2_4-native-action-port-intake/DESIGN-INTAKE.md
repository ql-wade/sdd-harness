# P2_4 原生生产动作端口：只读源码 intake 与最小实施方案

结论：**原Run/锁/事务/EngineAction原语足够复用，但6da和私有5ec都没有完成可信的非Gate生产动作接线。需要原P2_4源扩展，P1_3不能靠Gate reviewer或continuation字符串补成author/Builder。**这是原P2_4尚未满足的执行/恢复义务，不是新架构、DAG、控制器或actualRole/OS资格。

只读输入：P1_3提案SHA `65e11205179eab7b7cd4f00bf0b174ee3ddc7d62228ff7700e0705b6f2343cb9`；native-shape-intake SHA `40d56058062fb90a7988adca0cb64d03c7bd7e1f2d5053f936a3f79ea6af898d`，其中6个原始文件hash全部匹配。官方6da与私有40de/5ec源码直接核对；未执行CLI或模型，未写任何Run/源码/配置/注册/锁。

## 源码确认的复用与缺口

| 确切位置（6da work内） | 结论与最小处理 |
| --- | --- |
| `domains/engine/types.ts:5–29` | Run.pending是action ID字符串，pendingRef指向唯一原EngineAction文件；直接复用。不要另建author/job/lease记录。 |
| `domains/engine/loop.ts:57–103,135–180` | 已有decideWithResolver/recordOutcomeWithResolver及原pending、iteration、retries。但decide取resolver返回step.id后又从静态pkg取step.action，**会丢弃resolver生成的窄动作**。需最小支持受信resolver的action，并保留已声明step、原checkAction/guardrails。 |
| `domains/skill/types.ts:1,31` | invoke_skill/call_tool/handoff现有ActionType够用，不增新动作引擎。窄方法仍用StepAction；可信execution/binding只作为Runtime签发的EngineAction可选typed字段，不让skill.yaml/worker JSON自填trusted。 |
| `domains/engine/run-store.ts:142–184` | 原pending-action读/写/清除可复用；自身不提供跨Run+pending的联合事务。 |
| `domains/comet-classic/classic-store.ts:33–49,315–379` | 原短锁及`.comet-state-transaction.json`可复用。当前journal只纳入YAML/Run，不含pendingRef内容；应给**同一个journal**增加pending原文的before/after及恢复校验，避免孤立pending或Run.pending引用缺文件，不新造journal。 |
| `classic-runtime-run.ts:316,387,454,534` | ensure/validate/reconcile/transition是现有原Run入口；新增生产动作通过它们的同锁、epoch及当前性检查。已有reconcile/transition可能改step/iteration，必须先处理未调和pending，不能在启动未知时跳到下一作者。 |
| `classic-state-command.ts:1152,2128+` | next实际是comet-open等方法指引；dispatchGate已有锁内资格/输入/HMAC签发与GateDispatch，不是生产动作派发。保留原用户五phase入口，增加固定CODE入口；新名称只是本方案建议，不冒充现成CLI。 |
| `classic-gate-runtime.ts:500–578` | GateDispatch持久登记已有execution/jobKey/actionBinding；增加同执行的最小transport observation字段即可，不另建执行表。 |
| `classic-managed-host.ts:7–39` | 已有固定context/policy/authority/readResult/admission接口，可承接受保护事实；当前路径以gate intent为主，需明确producer intent分支，不能给作者冒用gate-R/A/T身份。 |
| `domains/engine/manual-run.ts:155–224`、`app/commands/skill.ts:234,256,288` | manual resume会接受调用者outcome、写artifacts、清pending并推进；这是新增managed动作必须封住的入口。managed原Run/typed pending必须交回新受控accept，generic/manual outcome或upgrade不得旁路。 |

6da与40de中engine的types/loop/resolver/manual-run/run-store、skill types、Classic runtime-run/resolver/store/managed-host均逐字节相同；5ec仅已有state-command、gate-runtime、hook-guard窄修不同。因此5ec不补这个端口，旧44绿不能充抵它。

## 可立即编码的窄接口（建议名，待Root冻结）

放在现有Classic Runtime内，由固定P1_3 CODE调用；不接受role/phase/module/consumer自由选择参数。`next`继续展示读回，可附当前受控动作视图；phase级`comet-open/design/build`只留给控制器，绝不作为worker工作包正文。

1. **prepareCurrentManagedAction(changeDir)**：原短锁内重新读Run、原profile、policy、方法源、输入/上游门及资格；由原step和已接纳制品决定唯一生产动作。已有pending则返回同action/execution的observe指引，不重签。新动作经原decide/checkAction，原authority签ActionBinding，原pendingRef保存EngineAction+typed managed binding，Run.pending/status和该文件在原事务提交。
2. **claimManagedLaunch(changeDir, execution)**：同锁重验当前Run/action/epoch/generation/source/role和固定job输入digest，唯一CAS将该原记录的transport从prepared记为starting；只有这次成功claim才返回launch许可。它是原execution的I/O事实，不是业务phase或lease。
3. **recordManagedLaunch(changeDir, execution, observation)**：长I/O后回同锁；只接固定Host从原始launch/engine记录取得的可信观测，记录原handle或UNKNOWN。不能靠worker JSON的started/absent/qualified=true写成功。Gate使用原GateDispatch，生产者使用原pending记录，同一套检查/实现，不复制两种调度。
4. **readManagedExecution(changeDir, execution)**：按原记录读回可供固定host观察的原operation/handle；无side effect，不创建/认领/补造execution。
5. **acceptManagedAction(changeDir, execution)**：锁外固定host.readResult/原collector取得真实结果；回锁重验同pending/action/step/iteration、epoch/generation/版本/来源/role，复用原P2_2 admission。作者输出被接受只表示制品产出，不签R/A/T/P/V通过。经原recordOutcomeWithResolver、artifacts/trajectory/checkpoint及原事务继续；不直接写phase。原确认和Gate流程仍独立执行。

这些端口可先实现拒绝式/组件链，真实来源未登记时返回UNVERIFIED且0启动。不能为得到正例捏造Host资格或把新安全候选标ready。

## 动作、方法与原推进规则

直接消费当前受保护profile已有动作，不新增角色表：

| profile动作 | 原phase与前置 | worker实际内容 |
| --- | --- | --- |
| R | Open，允许先产需求再审R | requirements-author；grill-me窄上下文 |
| A | Design，当前R | architecture-author；grill-me，之后原A.review独立共识 |
| T | Design，当前R/A | test-author的TestPack设计；之后原T.review独立审查 |
| P | Build，当前R/A/T | plan-author；只加载profile列明的plan-contract两节与只读plan_guard，不加载完整planner/Goal/监督/派发 |
| test.automate | Build，当前R/A/T/P | test-author；独立可执行测试/fixture/self-check |
| build | Build，当前R/A/T/P及测试交接 | builder；tdd/diagnosing-bugs；后续独立code.review和V不合并 |

**不能把生产动作成功当成原step静态next成功。**managed resolver接受生产outcome后，仅根据原Classic状态/证据回到当前合法step；跨phase仍经现有Gate、确认和transition。现有`resolveNext`直接用step.next不够。生产是否已完成应从原artifacts引用及trajectory的当前输入/输出读回推导，避免门未审时重复运行作者，不增加author状态表。

输入与输出要分开绑定：固定的需求/设计/任务/方法/policy/源码工具输入发生变化则旧结果拒绝；该动作被授权产出的design/tests/code是outputs，不能把正常产出误当作输入漂移，也不能允许worker事后重签输入。应由可信Host提供原输入快照、允许变更范围与真实输出引用/版本比较，复用ActionBinding.inputs/outputs和原收集事实。最终精确字段与合法输出接纳测试需P1_3/P2_2对齐；缺这项不得用“非空文件”放行。

静态Runtime包的allowedSkills仍需匹配窄方法。当前resolver用comet-*方法，不可伪装该ref却给worker另一份正文；Root须冻结实际loadClassicRuntimePackage/embedded fallback及其guardrails来源，随新源指纹验证窄ref。旧活动Run不自动换skillHash或升级Snapshot。

## 同execution恢复及必须保留的限制

- prepared表示尚未获launch claim；starting/started/unknown一律先观察原execution，不能根据日志缺失、超时或absence重启。启动与结果长I/O全部在原锁外，前后CAS都在原锁内。
- 当前I02 `observeCliJob`需要既有handle；handle丢失时尚无可信的只读按原operation查询端口。**不能调用startCliJob冒充查询**。先保持UNKNOWN/UNVERIFIED。若要自动查回，交原I02给observe增加仅按原注册+Run/execution/job绑定查找的只读变体；零结果仍不授新launch权，不另建数据库或重试账本。
- 需求/设计变更延续原保守全下游失效及monotonic generation；旧epoch/source/role、回退旧字节、迟到结果均拒绝。旧pending变stale后仍保留原execution以观察/停止；未证明旧进程结束不得清记录再派新的。正常失败重试消费原Run.retries/现有rework规则，观察超时不记业务failed。
- Generic手工结果/skill resume、直接transition/next/reconcile、Gate dispatch/accept、Hook写入口都须共享managed pending/currentness前置；worker不能用manual outcome清掉原execution或用Gate reviewer grant写生产制品。权限仍由实际source/工具映射和I02/P1_3证明。

## 最小源码与测试增量

既有0002内：`classic-runtime-run.ts`（原动作协调）、`classic-resolver.ts`（窄生产动作及不越Gate的next）、`classic-managed-host.ts`（受保护producer intent/原始transport观测）、`classic-gate-runtime.ts`（原GateDispatch transport字段与共同当前性）、`classic-store.ts`（原事务包含pending）、`classic-state-command.ts`/原generated Classic入口（公开受控调用及手工旁路拒绝）、必要`classic-hook-guard.ts`（复用5ec写许可与原pending匹配）。原engine `loop.ts/types.ts`及`manual-run.ts`只作上述最小接缝/拒绝；不引入0.5Runtime。原skill StepAction类型不需新增ActionType。

原P2_4测试增加：phase指引不能直接作为worker包；原Run下R/A/T/P/test.automate/build分别正确方法与前置；作者不能签review；完整planner/Goal/派发工具拒绝；pending双派/错Run/旧epoch或source或role拒绝；claim前后和handle回写前后真实中断恢复同execution；unknown/absence不得start；pending与Run事务撕裂恢复或明确拒绝；手工resume/upgrade/transition不能清pending；输出合法写与输入篡改分离；旧字节不复活。缺真实OS/身份的测试只能签组件机制。

## 精确输入保全

| 输入 | SHA256 |
| --- | --- |
| 6da distribution.json | `38448c748cda770fec3e5095db3a01b4317ea770d74e822072d25f6c0d5f4665` |
| 40de distribution.json | `fcf175defb6a307a960cf62f64b3a340c991e06cd4d83daa1972e04a1c7b5900` |
| 两版本engine/loop.ts | `5e3929ca7d64fef62d02675fc84288b54ccf2e398de08a9904bab60ac7010e9f` |
| 两版本engine/types.ts | `92442190104c5b8aed8751c5f812674a324087e51f407bb938b4740a9c564dbd` |
| 两版本Classic runtime-run.ts | `d9cafb0045150146748b25a3402eb102d2e68c0643e29b01c49c9943c38a624b` |
| 两版本Classic store.ts | `8ba323bf97f6f6e9c268b2b75873a29b5ef59e63c8c981f7f4d418f5083d9185` |
| 两版本managed-host.ts | `5fa6779d0bfe1c2422d0db09f06fc3a297fe93c806cb464fc67fe2a666b9ee31` |

5ec提交`5ec97b25db76241658b16f64e2eda1468da07424`及40de保持原字节，未rebase/改manifest/联编。端口名称与字段尚是设计，须Root明确编码授权及冻结精确源输入；P1_1安全回移未资格化，本报告不消费新候选为ready，也不代表本设计已实现或角色/OS已验。
