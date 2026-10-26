# P2_2 独立质量复审（independent review）— 2026-10-26

## 结论：APPROVE

复审人角色：delivery-foundation-rearchitecture 任务 P2_2（真实宿主/平台来源与独立证据准入）接纳前的独立质量复审 worker。只读复审，未修改任何产品文件，未 commit。重跑日志：`worker-reports/P2_2-comet-050/rerun-node-v24.15.0-20261026.log`（头部含命令与 exit code）。

## 1. 钉版 Node 重跑（亲自执行）

- 命令：`/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test test/delivery-evidence.test.js test/delivery-gate.test.js test/delivery-cases/2_2.mjs`（cwd: 仓库根）
- Node 版本实测：`v24.15.0`
- **exit code: 0**
- 汇总：`tests 60 / pass 60 / fail 0 / cancelled 0 / skipped 0 / todo 0`，stderr 为空，无 skip/todo 标记（grep 三个测试文件无 `t.skip`/`todo(`）
- 与此前观察到的 60/60 全绿一致。分文件计数：`test/delivery-cases/2_2.mjs` 8 个、`test/delivery-evidence.test.js` 25 个、`test/delivery-gate.test.js` 27 个。

## 2. 关键拒绝 oracle 核对（存在且断言实质，非跳过）

全部为真实断言：断言 `ok === false` 且匹配具体 error code 与 reason 文本（不是仅断言"不抛异常"或空转）。

| 要求的 oracle | 位置 | 核对结果 |
| --- | --- | --- |
| A05 自报 role/来源无效 | `test/delivery-evidence.test.js:85-106`（无 dispatch → `UNREGISTERED_SOURCE`，audit 保留 origin/execution/envelopeDigest；envelope 自报 `origin.kind='independent-verifier'` 与 `check='verifier-approved ...'` 均拒）；`test/delivery-cases/2_2.mjs:204-238`（V_A05 worker 自签 pass JSON → `UNREGISTERED_SOURCE` + audit 断言） | 存在，实质 |
| A06 重复签发拒绝 | `test/delivery-evidence.test.js:167-180`（同一 execution 二次 admit → `DUPLICATE_ISSUANCE`，reason 匹配 `/exec-verifier-1 already issued/`）；gate 层另有 `DUPLICATE_EXECUTION_EVIDENCE`（`test/delivery-gate.test.js:412-426`） | 存在，实质 |
| STALE_POLICY 旧回执拒绝 | `test/delivery-evidence.test.js:182-189`（admission 层，reason 含旧 digest）；`test/delivery-gate.test.js:180-192`（gate 层 `STALE_POLICY`/`STALE_INPUT`） | 存在，实质 |
| STALE_CANDIDATE 旧回执拒绝 | `test/delivery-evidence.test.js:191-200`（envelope 与 dispatch 一致但均落后 current input → `STALE_CANDIDATE`，reason 含旧 digest） | 存在，实质 |
| STALE_ENVIRONMENT 旧回执拒绝 | `test/delivery-evidence.test.js:202-212`（不同 environment → `STALE_ENVIRONMENT`，reason 含环境名） | 存在，实质 |
| A18 无观测数据的 pass 拒绝 | `test/delivery-evidence.test.js:225-243`（`valid=0` 与 `valid>total` 两种 → `NO_OBSERVATION`，reason 分别匹配 `/no real observation data/`、`/valid executions exceed/`）；gate 层 `MISSING_OBSERVATION`/`UNVERIFIED_CAPABILITY`（`test/delivery-gate.test.js:108-135`）；真实崩溃 run 路径（`test/delivery-cases/2_2.mjs:169-202`，unverified 计数来自真实 TAP） | 存在，实质 |
| B03 测试作者自检仅作自检 | `test/delivery-evidence.test.js:258-268`（test-author admit 成功但 class=`authoring-self-check`，非 `independent-acceptance`）；`test/delivery-gate.test.js:159-167`（gate 层 `AUTHORING_SELF_CHECK_ONLY` 阻塞、denominator valid=0、自检仍在 attestation 可见）；`test/delivery-cases/2_2.mjs:256-268`（V_B03，真实 run） | 存在，实质 |
| 同作者 principal 拒绝 | admission 层 `test/delivery-evidence.test.js:473-491`：`builderPrincipal`/`authoringPrincipals` 等于 source principal、`builderExecution`/`authoringExecutions` 等于 source execution、replay、过期 qualification、stale action/environment/method 各自独立断言 `ok === false`；gate 层 `test/delivery-gate.test.js:304-315`（review principal/execution 等于 builder → `INDEPENDENT_REVIEW_REQUIRED`） | 存在，实质 |
| protected source verifier 缺失拒绝 | `test/delivery-evidence.test.js:405-414`（无 `sourceVerifier` → `SOURCE_UNQUALIFIED`；布尔自证 `async () => true` → `SOURCE_UNQUALIFIED`）；`:453-462`（scope 非 `protected-source` → `SOURCE_UNQUALIFIED`）；`:493-500`（echo expected 字段 → `SOURCE_UNQUALIFIED`） | 存在，实质 |

产品侧（`lib/delivery/evidence.js`、`lib/delivery/gate.js`）确实实现了上述全部 error code，测试不是对着不存在的 code 断言（`admitComponentEvidence` 步骤 2/4/6/7/8 与 `admitManagedEvidence` 的 `SOURCE_UNQUALIFIED`/`IDENTITY_CONFLICT`/`REPLAYED_COLLECTION` 等）。

## 3. `lib/delivery/gate.js` 纯函数边界

- 导出仅两项：`EMPTY_EVIDENCE_SET_DIGEST`（常量，`gate.js:28`）与 `evaluate`（`gate.js:30`）。grep `^export` 实测仅此两行。
- 无 `node:fs`/`node:child_process`/`spawnSync`/`writeFile`/`issueDispatch` 引用（grep 实测为空；模块仅 import `node:crypto`、contracts parser、evidence 的 `admitEvidence`/`envelopeDigest`、test-contract 的 `evaluateExecutionDenominator`）。
- managed 模式下的 `admissionOptionsFor`/`verifyReview` 是宿主注入的同步端口，gate 只消费不发起；且 gate.test.js:318-329 明确断言异步 review 端口不会被调用（`invoked === 0`）。
- 套件内有专门的纯度测试（`test/delivery-gate.test.js:221-236`）：确定性输出、临时目录无文件副作用、源码级 import 断言。全部通过。

## 4. 用户对 `2_2.mjs` 的 `--test-reporter=tap` 改动

- git diff 实测仅一行：`test/delivery-cases/2_2.mjs:41` 的 `runNodeTest` spawn 参数由 `['--test', target]` 变为 `['--test', '--test-reporter=tap', target]`。三个受审文件中只有此文件有未提交改动（`test/delivery-evidence.test.js`、`test/delivery-gate.test.js`、`lib/delivery/*` 均干净）。
- **该改动在钉版 Node 24.15.0 下是承重的，不是风格偏好**。实测证据（全部在 /tmp，未触碰仓库）：
  - Node 24.15.0 下 `node --test`（stdout 为管道）默认走 spec 风格输出（`✔ t ...`、`ℹ tests 1`），不含 TAP 的 `# tests N` 行；
  - `lib/delivery/test-contract.js:21-40` 的 `parseTapSummary` 只识别 `^# tests (\d+)`，对默认输出返回 `null`，对 `--test-reporter=tap` 输出返回 `{tests:1,pass:1,...}`；
  - `2_2.mjs` 的 `envelopeFromRun` 与 V_A18 首测（`assert.ok(summary.pass > 0)`、`admitted.ok === true`、`envelope.executions.valid > 0`）直接依赖该解析结果——去掉该 flag 在 Node 24 下必挂。
- 覆盖性：V_A18/V_A06/V_B03/V_B06/V_B07 共 7 个用例都经由 `runNodeTest` 真实起子进程并解析其 TAP，断言读的就是打了 flag 的输出，改动被套件实质覆盖。
- 方向正确性：显式 pin reporter 使观测字节稳定（envelope 的 executions 计数与 evidence digest 都从该输出派生），符合"declared numbers never substitute observed ones"的用例意图。

## 5. 问题列表

阻断项：无。

非阻断观察（仅记录，不影响接纳）：
1. `lib/delivery/evidence.js:238-243` 的 `ROLE_NOT_DISPATCHED`（dispatch role 既非 verifier/test-author/builder 且无 purpose 时拒收）在本次三个测试文件中没有直接用例；与本复审清单无关（清单要求的是 A05 自报 label 无效，已覆盖），仅作覆盖面记录。
2. `test/delivery-gate.test.js` 的 `managedProtocolEntry` 与 `test/delivery-evidence.test.js` 的 `collectedProcessFixture` 是两份相似的"真实子进程 + sourceVerifier"fixture；后续若继续扩 managed 用例可考虑合并，纯可维护性建议。

## 6. 复审方法说明

- 全程只读产品文件；仅新建 `worker-reports/P2_2-comet-050/` 下两件产物（本报告与重跑日志）。
- 未执行 commit；未改动 hooks/settings 等控制平面。
- oracle 判定基于对三个测试文件与两个 lib 文件的逐行阅读 + error code 交叉核对；重跑与 reporter 行为验证均为亲自执行的机械证据。
