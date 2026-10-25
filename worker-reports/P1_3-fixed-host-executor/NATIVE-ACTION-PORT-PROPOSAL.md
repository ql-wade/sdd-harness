# 原 P1_3 -> P2_4：原生非 Gate 动作端口缺口提案

这是原DAG源级协作提案，不是新控制器/计划或已实现接口。P1_3继续Gate/物理三口/结果机械链；whole仍阻断。目标0.4.5、官方6da aggregate047950…，不改0.5、不碰0002/锁。

## 已实际读回的形状

私有项目真实执行 `runClassicCli(['--json','state','init','demo','full','--managed-delivery'],undefined,{projectRoot,invocationCwd})`、`ensureClassicRuntimeRun(changeDir)`、`state next demo`、`state gates demo`。同Run为 full.open/iteration0，pending=null，pendingRef=.comet/pending-action.json，但该文件不存在。state next外层是 `{exitCode,stdout,envelope}`；stdout是另一个JSON文档，其中data有nextAction、continuation、taskState、configuration、artifactRefs，agent.continuation也重复同一视图。

实际continuation为 `{kind:'continue-phase',reason,skill:'comet-open',automatic:true,cwd}`，实际next命令是 `/comet-open`，evidence.status=not-revalidated。它是下一方法/任务指引，不是带Execution/主体/路径/HMAC的受管进程工作包。`state dispatch-gate demo R`无Host实际exit2；未知`gate`/`gates`顶层命令的早轮exit64仅是调用准备错误，不当授权拒绝证据。全部原始/摘要在native-shape-intake.json索引；临时项目已finally清理，原HOME恢复，无主Run写。

## 原源码已经具备，必须复用

| 位置（官方6da work内） | 现状 |
|---|---|
| domains/comet-classic/classic-state-command.ts:1152/1248 | next读取原phase/recovery/continuation并输出门；不签发作者或BuilderAction |
| domains/comet-classic/classic-recovery.ts:27/248 | nextTask/taskState与continuation来自原tasks和原状态，不是执行记录 |
| domains/comet-classic/classic-migrate.ts:30、classic-runtime-run.ts:316 | ClassicRunContext已给classic/run/evidence/migrated/snapshotDir；ensure使用原Run及authority |
| domains/engine/types.ts:5 | RunState已有runId/currentStep/iteration/pending/pendingRef/trajectoryRef/checkpointRef/status/retries，无需另存phase或Action账本 |
| domains/engine/loop.ts:44/98/135 | decideWithResolver生成原EngineAction并置pending；recordOutcomeWithResolver只接受原pending.actionId并推进原step |
| domains/engine/run-store.ts:142/159/175 | 已有受保护pending-action读写/清除；仍是Run.pendingRef指向的唯一原记录 |
| domains/skill/types.ts:31 | StepAction只有invoke_skill/call_tool/handoff/ask_user/checkpoint与ref/prompt等；现有字段没有受保护ActionBinding/方法输入摘要/进程来源 |
| domains/comet-classic/classic-state-command.ts:2128/2200 | Gate路径在原短锁内派原execution、调host.context、原HMAC签发、写gate_dispatches；不能冒用此Gate reviewer身份签作者/Builder |
| domains/comet-classic/classic-gate-runtime.ts:500 | GateDispatch已有execution/actionBinding/protectedDispatch/sourceQualification/jobKey，但无可信launch-start/handle读回端口 |
| domains/comet-classic/classic-store.ts:33 | 复用withClassicStateLock/现有原事务；长执行和readResult继续锁外 |

以上不是从aggregate导出名猜缺功能：已核实际next/recovery、原EngineAction及现有持久化/推进源码。aggregate六导出仅说明当前受保护外部可达面；本提案补的是原Classic连接这些现成原语的受控入口。

## 最小受控扩展建议（交原P2_4设计，不由P1_3越界实施）

1. 增加固定CODE可达的“读当前原WorkPackage/Action”“派发当前原Action”“登记/读回原execution”“接纳原ActionOutcome”窄端口；最终名称由P2_4定。不要新增用户自由选role/phase/loader/文件来选consumer的flag。原/comet五phase命令保留。
2. 派发在原短锁内，从现有Run.currentStep/iteration与受保护当前profile/任务产物推导EngineAction；校验当前Gate/输入/方法/policy/身份后，原P2_2authority签ActionBinding。只更新原Run.pending和pendingRef指向的pending-action记录，给该现有记录增加最小typed managed绑定字段；不新建actions/lease/queue数据库或副本台账。身份和允许路径绝不来自模型提案。
3. 作者动作须区分需求/架构/测试设计/测试代码/Builder。Design作者受当前R约束；Build测试代码/Builder须当前R/A/T/P；T独立审查仍原Gate T，作者自检不能签其通过。P方法仅计划产物，禁Goal/dispatch/监督。具体映射来自已保护profile，不在P1_3复制新阶段引擎。
4. 外部长I/O前，把原execution的starting/unknown及固定I02 operation输入digest记入同一原pending记录或原GateDispatch；启动后由受保护端口校验并记录原handle/实际返回字段。I02三口仅物理start/observe/stop；HMAC和当前性只能回原Run重验。该字段不是新lease、重试队列或完成状态。
5. 恢复重读原pending/原execution并先observe；缺回执/超时不能当不存在再launch。记录started而handle未知时保持UNKNOWN/UNVERIFIED，由原Comet调和。controller死亡不能使worker认领phase。需要停止时只停止原execution；不让worker传新container/当前ActionBinding/角色来自批。
6. 接纳在长IO后回原短锁，重新查Run/pending.actionId/step/iteration/execution/attempt/epoch/generation/版本/源资格和真实collection；仍用原recordOutcomeWithResolver、原trajectory/checkpoint/事务推进，不直接写phase或让host判断独立语义。所有原生managed completion/手工结果入口须共用拒绝条件，不能另留manual outcome旁路。

## P1_3本轮边界

可继续固定Gate意图与I02三口/实际fixture结果/原strict collector-Gate机械链；测试自有注册与进程明确component，生产缺注册必须UNVERIFIED/0启动。未有上述非Gate端口，不会自签author/Builder grant或把gate-only当whole完成。跨进程launch恢复同样需要原record受控保存操作/handle，不在P1_3建第二持久记录来掩盖接口缺口。

最低后续实测：原Next指引→原pending签发→真实受控方法/进程→原collection/独立判断→原step继续；跨进程恢复同action/execution、旧版本/错误主体/越路径/复制Run/未知launch不得再启。所有真实模型/OS/渠道与项目资格继续未验。
