# P4_3 worker record — 当前证据索引与分层交付

- 修订：`2026-10-26-comet-050-adoption-v1`；工作树：主检出（未 commit，按指令禁止 commit）。
- 生成时间：2026-10-27（P4_8 接纳 34/39 之后、VERIFY 派发前）。

## 目标与范围

把 34 个已接纳计划节点的全部证据按层索引，产出供 VERIFY 系统消费的证据索引。**只索引构建级接纳证据，不翻转任何 required 检查状态**（130 检查/104 场景分母完整移交 VERIFY；`runtime_verified_scenarios=0` 如实）。

## Record 阶段读取的事实源

1. `tasks.md` `### Task P4_3`（Owns：acceptance-index.json / verification.md / test/delivery-cases/4_3.mjs / legacy-entry-inventory.json）。
2. `execution-state.json`：`accepted_plan_nodes=34`，node_status 逐节点证据指针全读；`current_focus`="Dispatching P4_3 (evidence index)"。
3. `execution-ledger.jsonl` 全量 662 事件：34 个接纳事件逐条核对（含 P2_4 重开/重接纳、FOUNDATION_FREEZE_BASELINE_SEALED、GOVERNANCE_MISS、OPENSPEC_PIN_BUMP、DELIVERY_GATE_CI_SEMANTICS 等影响证据状态的治理事件）。
4. worker-reports 目录盘点：仓库根（P1_x/P2_x/I0x/P3_1/P3_4/P4_2/ci-parity 的 `*-comet-050`/`*-command-first`）与 change 目录（I04-I08/P2_4-r3/P3_2/P3_3/P4_1/P4_4-P4_8）两处，逐节点指针落盘核对。

## 产出（改动文件）

| 文件 | 说明 |
| --- | --- |
| `openspec/changes/delivery-foundation-rearchitecture/verification-report.md` | 分层（L0 文档门→L1 工具链→L2 纯组件→L3 组合包→L4 宿主接线→L5 适配器/装配→L6 知识/平台/恢复）逐节点：节点ID/关键文件/核心 GREEN/独立复审/UNVERIFIED/证据路径 + 缺口三档 + VERIFY 就绪度。旧 command-first 版逐字保存于 `replans/2026-10-26-command-first/before/`（覆盖前已核验） |
| `openspec/changes/delivery-foundation-rearchitecture/verification-results.json` | schema 3 机器可读版：34 节点（status/key_files/green/suites/review/unverified/evidence）+ gap_registry 三档 + consistency_check。同上，旧版在 replans/before |
| `worker-reports/P4_3-comet-050/consistency-check.py` | 一致性校验脚本（exit 0/1/2 契约） |
| `worker-reports/P4_3-comet-050/consistency-check-20261027.log` | 校验运行记录 |
| `worker-reports/P4_3-comet-050/record.md` | 本记录 |

边界说明：`verification-report.md`/`verification-results.json` 在 tasks.md 里属 VERIFY 的 Owns——本次按控制器明确指令由 P4_3 生成 pre-VERIFY 索引投影，两文件内均已声明 VERIFY 为最终 owner、须以真实同 Run 旅程重新推导终态。P4_3 Owns 的另外三个文件（acceptance-index.json/verification.md/legacy-entry-inventory.json/test/delivery-cases/4_3.mjs）本轮未改——它们承载 scenario/check 级分母语义，属 VERIFY 消费侧，避免索引任务越权改分母。

## 验证（真实执行的命令与结果）

```
$ python3 worker-reports/P4_3-comet-050/consistency-check.py
state: total=39 accepted=34 pending=5
index: nodes=34 layers=34 gap tiers L/H/E=8/6/6
CONSISTENCY_PASS: accepted set equal, every accepted node has >=1 resolvable evidence pointer and review conclusion, layer partition exact.
exit_code=0
```

校验内容：①接纳集合与 execution-state 完全相等（34，双向零差）；②每个已接纳节点 ≥1 条证据指针且全部在盘可解析（目录/文件/ledger#event/node_status 片段三类指针）；③分层划分与 34 节点精确重合无重叠；④每节点有独立复审结论。首轮运行曾失败（P0_x 的 `execution-state.json#node_status.*` 片段指针不被解析），按根因扩展校验器的片段指针解析后转绿——非放宽断言，是指针语义本就有效。

```
$ python3 -c "import json; json.load(open('.../verification-results.json'))"
JSON OK, nodes: 34 counts.accepted: 34
```

## 索引节点数与缺口结论

- 索引节点数：**34/34**（7 层：L0×4、L1×2、L2×4、L3×3、L4×4、L5×3、L6×14）。
- 缺口三档：可本地补验 8（G-T1-01 旧链 TAP 失败根因、G-T1-02 journey 分母登记、G-T1-03 delivery-gate 真实收据链、G-T1-04 I02 errata、G-T1-05 pre-tool-gate fallback、G-T1-06 4_6.mjs 工具迁移、G-T1-07 P3_3 证据命令头、G-T1-08 CI-parity 整改）；需人工 6（Outline 授权、P4_1 三个人工门、6 项 open decisions 裁决、远端 URL/gh TLS、overlay 裁决、P5_1 真实团队宿主）；需外部资源 6（Outline 凭据、远端 CI 平台、I04 五项、I05 八项、I06/I07/P4_2 远端读回、F10 另期）。
- VERIFY 就绪度：**READY_WITH_GAPS**——索引完备可系统消费；一档可随 VERIFY-prep 补验；二三档保持 UNVERIFIED 原样移交，未闭不得转 PASS。

## 未验证项与风险

- 本任务未运行产品级旅程/场景检查（分母归 VERIFY），未跑全仓 check.sh（最近全仓绿信号取自 P4_8 接纳时点 1159/1159，非本 worker 复跑）。
- `worker-reports/ci-parity-050/` 在途整改的终态未消费（属 G-T1-08，VERIFY 前由控制器收口）。
- node_status 中个别证据引用指向已由附件事件关闭的中间态（如 P1_2 freeze 复跑、P1_3 三项路由关闭），索引按账本终态标注"已由 X 关闭"，避免 VERIFY 误读为仍在缺口。
