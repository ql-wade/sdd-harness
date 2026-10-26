# P2_5 — 架构A的grill与独立共识（修订 2026-10-26-comet-050-adoption-v1）

范围：0.5.0 组合包路线下确认 A 门"独立共识"侧与 P2_4 validator 委托链的对接面。
角色不变——适配器仍是证据生产者；判定语义零改动。未 commit、未外发（review_gate.py
仅本地子进程真实运行）、未改判定阈值/quorum/grill 闭合语义。

## 对接面（本次交付的核心）

A 门在 0.5.0 组合包中是 `architecture-consensus` 扩展（afterStep
`full.design.evidence`，P2_4/ADR-0022）：

- 扩展执行写**一个**工程内相对路径工件 `.sdd/delivery/gates/a/receipt-bundle.json`
  （typed 声明：kind `gate-receipt-bundle`、hashBinding `artifactHashes`、
  writtenBy `extension-execution`）；
- 扩展结果形如 `{ verdict, sourceHash, artifactHashes, gateEvidence: { gate, inputs,
  receipts, policy } }`，判定权只在 `sdd.delivery.gate.a` validator
  （`integrations/comet/application/bindings.mjs` → `lib/delivery/gate.js evaluate`）。

新增导出 `buildGateReceiptBundle`（lib/adapters/architecture-review.js，纯格式化层）：

1. 先走既有真实 intake（`consumeArchitectureGate`：真实 review_gate.py 子进程、grill
   闭合、修订冻结）——一切拒绝原样透传，**被拒共识不产生任何 bundle**；
2. bundle 内容：schema `sdd.delivery.gate.receipt-bundle.v1` + 声明的 kind/ref/
   hashBinding/writtenBy + 冻结包身份（reviewId/revision/artifactSha256）+
   `manifestSha256`（真实 manifest 字节）+ **判定回执逐字嵌入**（票/tally/finalize
   摘要、P0 全字段），确定性序列化，`artifactHashes` 把声明 ref 绑到 bundle 字节；
3. 输出扩展协议 payload（`verdict:'pass'` 是已判定共识的映射，不是新判定），
   `gateEvidence.receipts` 为扩展执行自己的接纳条目、原样透传（适配器不接纳、不伪造、
   不放宽条目）；
4. 适配层新增的关闭失败检查只有两类：`PAYLOAD_INPUT_REBOUND`（payload 的
   inputs.inputDigest 必须等于冻结包摘要——这是委托 evaluate 看不到的绑定：evaluate
   只比对 receipts↔inputs）与 `BUNDLE_REF_INVALID`（上游 artifactRef 工程相对路径
   约束）；`BUNDLE_INPUT_INVALID`/`BUNDLE_MANIFEST_UNREADABLE` 为形状/字节关闭失败。

## 负向保持（全部经既有判定透传，无语义改动）

- 作者自审：builder 角色执行签 A → `IDENTITY_CONFLICT`，无 bundle；
- 少票/异票：MISSING_BALLOT / QUORUM_NOT_UNANIMOUS（真实 tally exit 1）→ 无 bundle；
- 旧票：STALE_DIGEST（真实 gate 拒绝旧摘要票）→ 无 bundle；
- 改绑摘要：dispatch 层 `ARTIFACT_DIGEST_MISMATCH`；payload 层
  `PAYLOAD_INPUT_REBOUND`；
- 缺 finalize：`FINAL_REPORT_REQUIRED` 透传；
- 同会话票：managed 路径 `REVIEWER_IDENTITY_CONFLICT`（既有测试保持，2_5.mjs 原样）；
- 跨门重放：真实 `sdd.delivery.gate.r` validator 拒绝 A payload（`bound to gate A`）；
- T 边界保持：`consumeTestDesignReview` 仍是单一独立充分性审查，无 quorum 面；
  2_5.mjs 断言 A 与 T 扩展各自独立 artifactRef（AND 不互替）。

## GREEN（真实命令与数字）

解释器：Node v24.15.0（钉版）与 v22.13.1（默认）双跑；Python 3.14.7（真实
review_gate.py 子进程）。逐条命令/证据见 `run-results.json`。

| 命令 | Node | 结果 |
|---|---|---|
| `node --test test/architecture-review-adapter.test.js test/delivery-cases/2_5.mjs` | 24.15.0 | 70/70，0 fail，0 skip，exit 0 |
| 同上 | 22.13.1 | 70/70，0 fail，0 skip，exit 0 |
| `node --test test/delivery-cases/2_4.mjs`（A 扩展断言无冲突） | 24.15.0 | 14/14，exit 0 |
| `node --test test/delivery-evidence.test.js test/delivery-gate.test.js test/delivery-baseline.test.js` | 22.13.1 | 74/74，exit 0 |

RED（实现前）：adapter 57/59（2 个新对接测试 `buildGateReceiptBundle is not a
function`）；2_5 9/11（同因 +1 个**基线既有失败**：native 链测试钉的 6da90e89 构建
属 0.5.0 前 lock commit c90af44a，当前 lock（aeb1a659）发行版指纹为 29f2332b——
toolchain-baseline.json 已记录）。证据：`evidence/red-1`、`evidence/red-2`。

## 基线修复（自有文件内）

2_5.mjs native 链测试改为**直接钉** 0.4.5 时代已接纳的 managed-host 构建
（c90af44a/6da90e89，与 test/comet-execution-binding.test.js 同模式）：该场景驱动的
`installManagedDeliveryHost/dispatch-gate/accept-gate` 面只存在于该构建；运行时字节仍
钉该构建自己的 distribution manifest（nativeSha）。当前 0.5.0 发行版的对接由新组合包
对接测试证明。未调用 verifyCometDistribution 对照当前 lock（它校验的是新发行版，与本
场景驱动的宿主面无关）。

## UNVERIFIED

- 真实多代理共识运行（真实三方评审、真实身份/OS 隔离）归 P3_2/VERIFY；本任务的
  票/reviewer 均为显式数据 fixture。
- 组合包经官方 compileWorkflowApplication 编译及扩展在真实 Run 内的行为（P2_4
  composition.json `unverified` 声明保持；归 P1_3/P1_5/P3_2 波次）。
- `bash scripts/check.sh` 全仓入口未跑（存在与本任务无关的既有失败，Root/VERIFY
  范围）；本任务验证契约（钉版三套件 + 2_4 交叉）全绿。
- 新 validator 路径下的 managed `verifyReview` 组合（Native 读回）未新增覆盖——沿用
  2_5.mjs 既有 native 场景（legacy 构建面），0.5.0 运行时组合待 P3_2。
