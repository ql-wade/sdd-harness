# P3_2 角色链执行证据（pilot-journey）

Task P3_2（run impl-dfr-20261020-r1，分支 impl/p3-2-role-chain，2026-10-21）。
语义唯一来源：`specs/delivery-foundation/spec.md` 的 B01–B07、F08、A15 场景；
判定机制复用已接纳基建（未修改）：`lib/adapters/comet.js`（P1_3 run 绑定受信
launcher）、`lib/adapters/harness.js`（driver 排他：read-only 无 execute 面 /
managed-write 受角色路径约束 / runner 拒绝 phase 字段）、`lib/delivery/evidence.js`
（dispatch 绑定 + admitEvidence 货币性/身份/重复签发）、`lib/delivery/gate.js`
（纯 evaluate）、`lib/delivery/test-contract.js`（真实 RED 分类）、
`tools/verify/delivery-journey.mjs` + `pilot-contract.md`（P3_1 冻结基线）。

## 执行器

`run-role-chain.mjs` 是角色链的真实执行半部：Comet 单一主控（run 绑定 authority，
HMAC secret 只在控制器进程内）在真实夹具项目（os.tmpdir 下生成，slugify
stub/defective/correct 三变体 + 冻结 weak/strong/dom 测试套件）上安排
test-author → builder → whitebox 角色及其开发任务路径界。角色由 worker 扮演，
但每一判定经独立机制：

- 行为判定：真实 `node --test` 执行 + `classifyRunOutcome`/`requireValidRed`
  （行为 RED 与环境失败分离，零执行从不计数）；
- 证据判定：launcher 签发 dispatch（白盒角色在证据层用 `verifier` 身份，
  作者用 `test-author`——`evidence.js` DISPATCH_ROLES 的两个签名身份）+
  `admitEvidence`（候选/策略/环境货币性、builder 不签验收、一次执行一份签发）；
- 验收判定：`gate.evaluate`（纯函数，receipt 过 schema 校验）；
- 排他判定：`requireWriteDriver` 拒绝只读 planner 写入；managed-write 驱动按
  PlanBundle 派生的角色路径界拒绝越界写（`ROLE_PATH_REFUSED`）；runner 拒绝
  dispatch 绑定中的 phase 字段（无第二 currentPhase）。

控制面唯一写入面是 `control/run-state.json`（单一账本，原子写）；B01 计划只读
请求不落任何控制状态。每角色转换在证据 JSON 的 `transitions` 留记录：谁（角色
+execution）、输入摘要、判定、依据（basis），以及 `dispatchLedger`、`refusals`、
`admitted`、`gate`。

## 记录的执行（evidence/chain-*.json，全部 OBSERVED / exit 0）

| 记录 | 场景语义（spec.md） | 角色链要点与判定依据 |
| --- | --- | --- |
| chain-B01.json | B01 只输出 PlanBundle，不派发/监控/改运行状态 | planner（read-only driver）输出校验过的 PlanBundle；dispatchLedger 空；run-state 字节级不变；`DRIVER_WRITE_REFUSED` + `RUNNER_PHASE_FIELD_REFUSED` 负例留痕 |
| chain-B02.json | B02 测试作者发现行为 RED，保留并交 Builder，不改产品源码 | 作者落测试后真实 node --test → behavior-red（validRed=true）；路由 builder；作者越界写 src/ 被 `ROLE_PATH_REFUSED`，产品字节不变 |
| chain-B03.json | B03 作者自检全绿仅记 authoring 自检 | 作者 receipt class=authoring-self-check；gate blocked，blocked 含 AUTHORING_SELF_CHECK_ONLY，valid=0，不签独立验收 |
| chain-B04.json | B04 Whitebox 发现弱 oracle/缺 case → 返回测试作者，不改冻结测试 | 白盒变异探针（真实 defective 候选）：weak 套件在缺陷候选上 pass → weak-oracle 缺口 → 路由 test-author；strong 套件 red → 无缺口；两套件字节级不变 |
| chain-B05.json | B05 产品缺陷 → Builder 新候选 → 重新独立验收 | v1（defective）白盒真实 RED → 路由 builder → builder 写 correct（候选摘要轮转）；v1 回执在 v2 处 `STALE_CANDIDATE`（admission）+ `STALE_INPUT`（gate）拒绝；白盒以 attempt=2 新 dispatch 绑定新候选重验 → gate pass 绑定新候选摘要 |
| chain-B06.json | B06 服务日志不能冒充 console | service-log 执行冒领 console 检查被 `CHECK_BINDING_MISMATCH` 拒绝（dispatch 绑定是替换边界）；负相 gate：ui/console MISSING_OBSERVATION、ui/dom 关闭；正相：真实捕获程序 stdout 的 console 执行关闭 console，gate pass valid=2 |
| chain-B07.json | B07 旧契约版本明确拒绝，不虚构字段 | schemaVersion=0 的旧 journey 记录被 INVALID_ENVELOPE（older than supported）拒绝，签发集未被污染；v1 记录正常导入（恰 1 条 independent-acceptance） |
| chain-F08.json | F08 关联截图/请求/独立业务读回；缺能力保持未验证 | 同一 sessionId 关联 capture+request+readback（readback 摘要与落盘字节一致）关闭 cli-interaction；部分会话（无业务写）`CORRELATION_INCOMPLETE` 拒绝；native-browser 能力如实登记 absent → browser-console unverified → gate blocked，valid=1，从不判 pass |
| chain-A15-persisted.json | A15 落盘读回成立 | builder 写 state/saved-state.json 后主张成功；白盒独立读回 digest 与真实字节一致 → journey persisted-readback-ok |
| chain-A15-claim-only.json | A15 未落盘则 Journey 失败 | builder 只主张成功未写盘；白盒读回无字节 → journey journey-failed-not-persisted，路由回 builder |

## 与套件/运行器的关系

`test/delivery-cases/3_2.mjs` 用同构夹具（套件内 VARIANTS/FROZEN_TESTS）逐场景
重放本执行器并以独立机制复核：套件自己做真实 node --test 复现（B02/B05）、
自己读回字节级 oracle（产品/冻结测试/run-state/业务状态/控制账本）、断言
持久化证据的结构与判定值。P3_1 交付的 `tools/verify/delivery-journey.mjs`
（profile managed-pilot，冻结基线经 pilot-contract.md 机读块）对 B02/B04/B05/F08
四个本任务绑定场景实际调度本模块，全部 PASS 且目标测试点命中
（verdict 副本见 `worker-reports/P3_2/evidence/journey-runner-*.json`）。

## 边界

- 本目录证据是本仓库受管试点（CLI 面）的角色链执行记录，不是平台验收回执；
  不派发真实 Comet Classic Run、不改运行状态、无生产副作用（pilot-contract
  允许建设边界内）。
- F08 的"原生浏览器"能力在本试点不存在，按 spec 记 unverified 并阻断 gate——
  这是场景的指定落脚点，不是覆盖缺口；真实浏览器验收留待具备该能力的环境。
- 夹具项目全部位于 os.tmpdir，运行后即为临时目录；本目录只保留证据 JSON。

## 返工增量（rework-seven-p1-r1，P3_2，分支 rework/p3-2-same-run-recipe，基 73186e5）

返工边界（tasks.md Step 7/8 + execution-contract `journey_execution.construction_task_scopes.P3_2`）：
slugify 替身编舞只证明角色链判定机制，不再充当 Comet 派发；本任务以真实受管
Comet CLI（仓库锁指纹 d4370930，六补丁链）实跑 R 确认→V 的角色执行切片。

### 新增产物

- `same-run-delivery.journey.json` — V_SAME_RUN_DELIVERY 的完整旅程步骤计划（11 步：
  R 确认→A grill+全票共识→T 独立审查→P→TDD→Whitebox→Kp→真实归档→Outline 未知
  结果/重启恢复→Kt→completed），每步含角色身份、dispatch 绑定（真实 CLI 命令面）、
  gate/前置、epoch/代际语义、记录字段清单；步骤 1–6 归 P3_2 建设切片，步骤 7–11
  execution_owner=VERIFY（不以整条最终旅程 PASS 作为建设前置）。
- `same-run-delivery.case.json` — journey_definitions 注册面绑定的配方
  （scenario E06，caseModule 本套件，requiredAssertions 钉住 E06 及三个 V_E06 复合
  断言；verdictSemantics 明确 PASS 只证建设切片，从不签完整旅程）。
- `test/delivery-cases/3_2.mjs` 三个新测试（`V_E06:*`）：
  - `V_E06:rv-slice-real-cli` — 真实 CLI 上：无 R receipt 时 open-complete 拒绝
    （enter-design 强制，P1-01）、R/A/T/P/V 逐 gate 真实 dispatch→accept、A 消费本
    run r3 真实全票回执（只读正控；2:1 多数与缺票拒绝）、T 弱 oracle 拒绝、
    complete-design→TDD build（注册 check 身份）→V→verify-pass；切片止步归档边界，
    phase=archive、completionBlocked=true（Kt 席位未闭合）、change 未进 archive。
  - `V_E06:p25-consensus-consumption` — P2_5 消费契约：r3 真实回执经真实机械门
    重放（initConsensusRun/admitBallot/tally/finalize），consumeArchitectureGate 只
    经受信 launcher dispatch 消费；伪造来源 FORGED_DISPATCH、跨材料
    ARTIFACT_DIGEST_MISMATCH 拒绝。
  - `V_E06:recipe-tracking` — 注册面绑定（owner/required_check/path）、配方结构、
    旅程步骤计划顺序与所有权边界，以及真实 runner 负例：未注册 journey 名、注册但
    配方未落盘（override plan 指向不存在路径）、注册不完整 —— 全部结构化非零拒绝。

### 验证回执（详见 worker-reports/P3_2-rework/evidence/）

`--journey same-run-delivery --profile managed-pilot` exit 0 PASS（target E06
found+ok，13/13 测试点，四断言全 satisfied）；V_B02/V_B04/V_B05/V_F08 四条合同
场景通道回归全 PASS；全量 `npm test` 442 tests / 439 pass / 2 fail / 1 skip ——
两个失败为基线已知环境项（C08 host-openspec 漂移、B08 preservation），零新增；
三次变异注入（配方 scenario 篡改 / 归档步骤所有权篡改 / 不可执行 required 断言）
均被捕获，实现逐字节还原。

### 边界

- 上表"记录的执行"（chain-*.json）是上一轮的判定机制证据，仍然有效；本轮增量是
  真实 CLI 派发面，两者互补：前者证角色判定独立性，后者证 Comet 受管运行时真实
  绑定。完整旅程（Kp→真实归档→Outline 未知恢复→Kt→completed）仍由 VERIFY 执行。
- Outline 栈在本轮返工时点 loopback 3000/5556 ECONNREFUSED（栈未运行），Kp/归档/
  Outline/Kt 段如实 UNVERIFIED，holder=VERIFY。
- 固定合同命令 `--scenario E06 --journey same-run-delivery` 被当前 runner 判
  INVALID_INPUT（--journey 与 --scenario 互斥，runner 归 P3_1；配方自带 scenario），
  已如实记录；`--journey same-run-delivery`（runner 支持形）为本次验证通道。
