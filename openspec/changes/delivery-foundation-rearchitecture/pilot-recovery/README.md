# P3_3 恢复与调和执行证据（pilot-recovery）

Task P3_3（run impl-dfr-20261020-r1，分支 impl/p3-3-recovery-reconciliation，
base 5eb855c，2026-10-21）。语义唯一来源：`specs/delivery-foundation/spec.md`
的 A10/A11/A12/F07 场景。恢复/调和语义建立在 P3_2 同一条角色链上；已接纳基建
全部 import 复用、零修改：`lib/adapters/comet.js`（P1_3 run 绑定受信
launcher）、`lib/adapters/harness.js`（driver 排他 + runner 拒绝 phase 字段）、
`lib/delivery/evidence.js`（P2_2 dispatch 绑定含 attempt/epoch + admitEvidence
货币性/身份/重复签发）、`lib/delivery/gate.js`（纯 evaluate）、
`lib/delivery/test-contract.js`（真实 TAP 分类）、`pilot-journey/`（P3_2 角色
链——本目录与其同构，控制面同样只有 `control/run-state.json` 单一账本）。

注：`run-role-chain.mjs` 以 `process.exit(main())` 结尾，作为模块 import 会
终止宿主进程，故"同链复用"的落点是 import 同一批已接纳 lib 原语并沿用同一
链结构（同 authority/driver/admission/gate/单一账本），而非字面 import 该脚本。

## 执行器

`run-recovery-chain.mjs` 是恢复/调和的真实执行半部。在 P3_2 链上新增（单环境
语义，不承诺跨机器）：

- **单一控制账本**：`control/run-state.json` 是唯一控制面工件；每次变更都是
  磁盘读-改-写（原子 tmp+rename），每次判定都从磁盘字节读回，不信任内存镜像。
- **epoch 门**（P2_4 runtime D08 语义的 gate 层断言）：控制器接管使 epoch+1
  并留痕于 `history`；携带被取代 epoch 的回执被拒（`STALE_EPOCH`），绑定已被
  取代 attempt 的回执被拒（`STALE_ATTEMPT`）。断言经 import 的 gate 层
  （admitEvidence 前置包装），拒绝留痕且不改动账本字节（digest before==after）。
- **重复纪律**：派发 key =（叶子 operation，候选代）。同 key 二次派发拒绝
  （`DUPLICATE_DISPATCH`）；重放回执经 import 的 admitEvidence 拒绝
  （`DUPLICATE_ISSUANCE`，P2_2 语义）。真实候选轮换后同一 operation 以新 key
  重派（全量重验，绝不携带旧回执过代）。
- **并发推进**：真实 runner 子进程经原子 `O_EXCL` claim 文件（Comet
  `.comet-state.lock` 的试点镜像）竞争推进——恰一个成功；败者读到胜者 claim
  并被拒（`CONCURRENT_ADVANCE_REFUSED`）；旧 epoch 领取者被拒并释放其 claim
  （`CLAIM_EPOCH_STALE`）。账本单一写者：控制器读回 claim/result 字节后代记。
- **断点恢复**：真实叶子 worker 子进程在"已写观察、未交接回执"窗口被真实
  SIGKILL（tools/infra/monitor.mjs 注入手法：kill → 确认旧写者终止）。接管
  从权威磁盘状态恢复原 operation：已完成叶子逐字节保持（dispatch execution +
  receipt digest 不变），不重开任何叶子任务，死亡 attempt 的迟到回执被拒，
  推进在恢复绑定（attempt+1、新 epoch）下完成。
- **失联调和**：叶子子任务各自真实通过，集成后父 Journey 真实失败——父任务
  阻断（blocked-phase gate：`UNVERIFIED_CAPABILITY: leaf:L-INT`）、放行被拒
  （`RELEASE_REFUSED`）；仅当 Builder 产出真正新候选且全部叶子在新候选
  digest 上重验后，gate 才以新候选绑定通过。

叶子工作真实：每个叶子 worker 是真实子进程，真实运行 `node --test` 于夹具
套件并写出观察（TAP 全文内嵌证据 JSON）。真实日志（worker TAP、refusals、
注入记录、账本快照）全部持久化于证据 JSON。

## 记录的执行（evidence/recovery-*.json，全部 OBSERVED / exit 0）

| 记录 | 场景语义（spec.md） | 要点与判定依据 |
| --- | --- | --- |
| recovery-duplicate.json | A10 重复派发/重复回执 → 幂等拒绝 | 同 key 二次派发 `DUPLICATE_DISPATCH`；L2 回执重放 `DUPLICATE_ISSUANCE`（import 层）；每次拒绝账本字节不变；gate 以两份非重复回执 pass（valid=2） |
| recovery-stale.json | A10/A11 旧 epoch 回执、乱序旧 attempt 回执 → 拒绝并留痕 | 接管 epoch 1→2 后迟到 epoch-1 回执 `STALE_EPOCH`；L2 交接超时轮转 attempt 2 接纳后，迟到 attempt-1 回执 `STALE_ATTEMPT`（seq 证明乱序：attempt-2 先接纳）；迟到观察文件在盘且被回执字节钉住；完成只经 epoch-2 绑定 |
| recovery-concurrent.json | A10 有效推进唯一 + F07 并发写者约束 | 旧 epoch 领取者 `CLAIM_EPOCH_STALE` 且释放 claim；两真实 runner 进程 `O_EXCL` 竞争恰一胜者；败者读到胜者 claim；推进后二次领取被拒；账本 advanceSeq=1 单写者代记；advance 绑定带 phase 字段被 `RUNNER_PHASE_FIELD_REFUSED`（无第二 currentPhase） |
| recovery-kill-recovery.json | A11 中断恢复 + F07 不重复叶子派发 | L1 完成（epoch 1）；L2 worker 在交接前窗口被真实 SIGKILL（旧写者确认终止）；接管快照→epoch 2→死亡 attempt 迟到回执 `STALE_EPOCH` 拒绝；原 operation 以 attempt 2 恢复；L1 的 execution+receipt 跨恢复逐字节相等；叶子集合不变 |
| recovery-parent-block.json | A12 父任务阻断并对新候选重验 + F07 失联 | L1/L2 各自 pass；错误关联回执 `CORRELATION_MISMATCH`；L-INT 真实集成 RED 接纳为 red 回执；blocked-phase gate `UNVERIFIED_CAPABILITY: leaf:L-INT`；放行 `RELEASE_REFUSED`；Builder 经受管写驱动轮换候选；v1 回执 `STALE_CANDIDATE` 拒绝；三叶子全部在新候选上重验（attempt 2）后 gate pass 绑定新候选 digest（valid=3） |

## 边界（如实）

- 单环境语义：并发推进以同机双进程 + 文件 `O_EXCL` 序列化证明机制；跨机器
  分布式互斥不在本任务承诺内。
- 同 OS 账户限制下，dispatch HMAC 为协作级防伪（lib/delivery/evidence.js 已
  登记的边界），非抗篡改；本任务未改动该边界。
- 夹具为 $TMPDIR 下生成的 slugify/pipeline 试点项目，状态无关；测试套件
  （test/delivery-cases/3_3.mjs）是夹具作者，执行器只消费。

## 本轮返工增量（rework-seven-p1-r1，P3_3，分支 rework/p3-3-recovery，基 master@a1a7b31）

在上述 gate 层恢复/调和套件之外，本轮按 V_RW_REAL_COMET_RECOVERY 的 construction
scope（execution-contract `journey_execution.construction_task_scopes.P3_3`）补齐
**真实受管 Comet CLI 上的有限核心事务恢复切片**。恢复引擎就是 CLI 自己的
classic-state 面（journal `.comet-state-transaction.json` + 锁
`.comet-state.lock`，`.comet.yaml` rename 为提交点，下一个真实 CLI 操作执行
roll-back/roll-forward 恢复）——本目录不新增任何业务主控，配方只触发/观察。

- **配方（journey recipe）**：`real-comet-recovery.case.json`（注册面
  `verification-case-plan.json journey_definitions.real-comet-recovery`，owner
  P3_3，required_check V_RW_REAL_COMET_RECOVERY，scenario L11，
  caseModule test/delivery-cases/3_3.mjs）+ `real-comet-recovery.journey.json`
  九步旅程步骤计划。与 P3_2 的 `pilot-journey/same-run-delivery.journey.json`
  步骤 9（同产品 Run 内故障窗口）协调：该窗口在 host journey 中保持
  executionOwner=VERIFY，本配方只承接其"run-level recovery（bounded actual
  Comet transaction recovery, P3_3 recipe）"门所指示的有限切片；步骤 1/7-9
  （同 Run 前提、live Outline 未知结果调和、独立监控/备份资格、续跑至
  completed）全部留在 VERIFY。
- **真实故障注入（test/delivery-cases/3_3.mjs
  V_RW_REAL_COMET_RECOVERY:L11-core-transaction）**：真实 SIGKILL（node spawn
  + `process.kill('SIGKILL')`，monitor.mjs/I07 手法；fs.watch 在本沙箱被拒，
  改用毫秒级 stat 轮询触发，逐尝试按磁盘字节分类、预算内未命中即失败，绝不
  伪造落点）打在真实 CLI 核心事务的三个窗口：
  1. **dispatch 窗口**：杀 dispatch-gate → 同 job key 再派发返回 `recovered:
     true` 且 execution 不变（H03/H06 唯一 open owner，无双派发）；
  2. **提交前窗口**：journal 在、`.comet.yaml` 仍为事务前字节 → 恢复回滚：
     journal 被消费、零回执、phase 不变、被杀 attempt 重放被拒
     （already consumed）、新派发干净重试且恰一次发布；
  3. **提交后窗口**：journal 在、`.comet.yaml` 已含提交字节 → 恢复前滚：
     journal 被消费、提交回执对被杀 execution 恰一次、重放被拒、恢复不重写
     已提交字节。
  每次 kill 后旧写者先经 pid liveness 确认死亡再读回；每窗口落盘证据（pid/
  绑定/事务 digest/恢复读回）在 fixture `kill-evidence/` 并可经
  `P33_KILL_EVIDENCE_DIR` 镜像。
- **锁层旧写者栅栏（V_RW_REAL_COMET_RECOVERY:L11-fencing）**：真实存活 pid
  持 `.comet-state.lock`（i08 fence-evidence 同形：真实 pid，绝不伪造）时，
  真实 CLI 写操作被栅栏至超时拒绝且状态字节不动；真实 SIGKILL + 死亡确认后，
  死写者锁被下一个真实操作自动回收、原操作继续、无残留锁文件（I08 fencing
  语义在 CLI 锁层的同机半边；跨机仍归 I08/VERIFY）。
- **配方/注册面绑定（V_RW_REAL_COMET_RECOVERY:recipe-tracking）**：注册面
  字段逐项断言；与 host journey 步骤 9 的协调与所有权边界逐项断言；未知
  journey 经真实 runner 拒绝（journey-not-registered exit 2）。
- **边界（如实）**：本切片不签 V_RW_REAL_COMET_RECOVERY 完整旅程 PASS——
  live Outline 未知结果、独立外部监控与备份资格依赖 I07/I08/P4 机制与同产品
  Run，holder=VERIFY（`real-comet-recovery.journey.json` 步骤 1/7-9）；会话
  沙箱 docker 不可用（EPERM），docker 类操作清单见
  `worker-reports/P3_3-rework/terminal-channel-commands.sh`。本轮变异注入
  ×3（配方 scenario、旅程步骤所有权、required 断言钉）全部被套件/runner
  捕获并逐字节还原。
