# services/delivery-control — F10 条件启用门（未启用形态）

本目录只承载**条件启用门**：跨机器（CROSS_MACHINE）范围未获用户裁决前，
delivery-control 的团队服务本体**不建设**。F10 被机械钉定为
`UNVERIFIED_NOT_ENABLED`——"未启用"永远不算 F10 通过，未执行的正向隔离恢复
认证保留 UNVERIFIED（holder 见 enablement.json `positive_auth_holder`）。

对应任务：openspec/changes/delivery-foundation-rearchitecture/tasks.md
Task P5_2（F10），前置 `CROSS_MACHINE_SCOPE_NOT_ENABLED`。

## 现状（本 run 事实）

- `enabled=false`，`decision_record=null`：execution-state.json
  `open_decisions` 中不存在任何跨机器启用裁决。
- 语义同源：team-host-matrix/matrix.json `machine_dimension.enablement_gate`
  （P5_1）——`enabled=true 当且仅当存在可解析的明确启用裁决`；通配符宿主
  `*` default-deny，`refuse_start`/`refuse_release`=NOT_ENABLED，与本门的
  start/release 同源，本门按 P5_2 任务书另含 implement。本 README 只引用
  matrix，不修改它（P5_1 归属）。

## 门语义（gate.mjs v2，exit 0=合法读回 / 1=输入无效 / 2=拒绝）

| 输入 | 结果 |
| --- | --- |
| enabled=false，任何 start/release/implement 请求 | 拒绝 `CROSS_MACHINE_SCOPE_NOT_ENABLED`，回执（stdout JSON，含请求字节摘要）即留痕 |
| enabled 被手改 true、decision_record 仍为 null | 拒绝 `ENABLEMENT_DECISION_RECORD_REQUIRED`（防手改绕过） |
| decision_record 指不到真实裁决（id 不存在 / 条目仍 OPEN / 非 ENABLE_CROSS_MACHINE_SCOPE / 非 user 决定 / source 越出仓库） | 拒绝 `ENABLEMENT_DECISION_RECORD_UNRESOLVED` |
| 门文件损坏、refuse 语义被删空、或把 F10 标成 PASS/SUPPORTED | 全命令拒绝 `GATE_FILE_FAIL_CLOSED`（连 status 读回也拒绝——突变自证会咬） |
| 裁决完整可解析但服务本体未建设 | 拒绝 `ENABLED_CONSTRUCTION_PENDING`（先按 5.2.a 重建本体） |
| 环境变量 / 运行时 enable 记录 | 永不生效：env 不参与裁决；记录只做摘要留痕（`ENABLEMENT_REQUIRES_REGISTERED_DECISION`，recordTrusted=false） |

防篡改负向突变（test/delivery-control.test.js M1–M4 + test/delivery-cases/
5_2.mjs J1/J3）：enabled 无裁决翻 true、NOT_ENABLED 标 PASS、删 refuse 语义、
伪造 decision_record——每一项都被机械拒绝且回执留痕。

## 真正启用路径（未来，需用户裁决；本 run 未发生）

1. **用户裁决**跨机器范围；控制平面把裁决登记进
   `openspec/changes/delivery-foundation-rearchitecture/execution-state.json`
   的 `open_decisions`：条目含
   `id`（如 CROSS_MACHINE_SCOPE_ENABLED）、
   `decision: "ENABLE_CROSS_MACHINE_SCOPE"`、`decided_by: "user"`、
   `status` 非 OPEN。
2. **成对提交**更新 `enablement.json`：`enabled=true` +
   `decision_record={source, decision_id}` 指向该条目 +
   `f10_state=UNVERIFIED_ENABLED_CONSTRUCTION_PENDING`（三者同一提交，
   不做布尔标志、不留 TOCTOU）。
3. **重建服务本体**（届时才实施 5.2.a/5.2.b 的 API 能力）：复用既有
   PostgreSQL / 证据存储 / 身份服务；API 只管证据、审批、回执，
   **不接管执行步骤调度**；先 RED 测项目隔离、撤权、备份恢复、API 断联
   阻断，再 GREEN。四项正向认证在真实执行前保持 UNVERIFIED。
4. 验收件更新：test/delivery-cases/5_2.mjs 的 J1–J4 与
   test/delivery-control.test.js 届时按启用形态重写；F10 的验收状态由
  VERIFY 按真实执行记录，不由本门自证。

## 明确未建设（holder，启用前不得主张）

- API 本体（无服务器、无路由、无身份服务接线）
- 数据库 / 证据存储 / 身份服务的任何接入
- 执行步骤调度的任何接管
- 四项正向认证（隔离/撤权/恢复重认证/API 断联拒绝缓存绿）——UNVERIFIED

## 与 legacy 的关系

旧跑的 `ScopeGate.v1`（scope-gate.json + 代码内摘要锚点，commit bcc1afa）
被本 v2 取代：摘要锚点模型允许任何能改代码的提交者开闸而不需要用户裁决
记录；v2 把开闸绑定到控制平面的裁决登记（与 P5_1 矩阵规则同源）。
旧跑 test/delivery-cases/5_3.mjs 仍引用 legacy 路径，由 P5_3 rework 工人
按本门形态更新（非本任务归属）。operations-runbook 的"成对提交"措辞
由 P5_3/I08 归属同步。
