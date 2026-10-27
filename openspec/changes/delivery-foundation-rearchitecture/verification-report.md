# VERIFY 终验报告 — delivery-foundation-rearchitecture（FINAL-VERIFY：G-T1-02 分母注册 + 双 FAIL 根因收敛）

- 生成：FINAL-VERIFY worker（2026-10-27 第二轮，控制器授权任务 G-T1-02）；钉版执行环境 node **v24.15.0**（`~/.nvm/versions/node/v24.15.0/bin`）；候选 git HEAD `58ea78f`（工作树；VERIFY 禁止 commit）。
- 机器可读同伴：`verification-results.json`（schema 4，130 检查逐个终态 + 103 场景组件面 verdict + 分档 gap registry）；`acceptance-index.json`（schema 2 双仪器投影）；质询见 `grill-report.md`；原始证据 `worker-reports/FINAL-VERIFY/evidence/`。
- 本报告取代 2026-10-27 r1 版终验报告（r1 全文保全于 git `58ea78f` 与 `replans/2026-10-26-command-first/before/` 体系）；r1 的分层证据索引（§4）在本版压缩承接。

## 1. 总览

| 维度 | 数值 |
| --- | --- |
| 计划节点 | 39（37 已接纳 / P5_2=F10 另期 / VERIFY 本节点） |
| 检查分母 | 130 required（**129 现域 + V_F10 范围外 NOT-EXERCISED**） |
| 场景分母 | 104（**103 现域 required + F10**）；注册旅程 3 |
| **130 检查终态** | **PASS 21 / FAIL 0 / UNVERIFIED 108 / NOT_EXERCISED_SCOPE 1**（r1 为 19/2/108/1） |
| **103 场景组件面终态（注册分母下真实执行）** | **74 PASS / 2 FAIL（F01、F03=G-T1-09）/ 27 NOT-EXERCISED（host 分层如实拒绝）** |
| 3 旅程（组件/观察资格面） | **3/3 PASS**（E06/L11 计划↔配方冲突已调和；r1 为 1/3） |
| 全仓终态 | `bash scripts/check.sh` **exit 0**（npm test **1159/1159**，r2；r1 撞上已登记的 I06 负载瞬态 1158/1159，单测复跑 2×49/49 绿） |
| 归档建议 | **DO_NOT_ARCHIVE_YET**（见 §6） |

证明范围声明：21 项 direct PASS 与 108 项 UNVERIFIED 全部来自当前版本真实执行（钉版 node24、当前工作树）；managed 面的结构化拒绝（exit 2）是**如实 NOT-EXERCISED**，不是跳过转绿。**分母已注册**（本报告 §3）——managed 面的 27 个 host 场景拒绝理由已从 `proof-registration-missing` 前进到 `protected-source-unavailable`（真阻塞：宿主未安装合格的 Comet launcher 观察接口）；76 个 component 场景在 managed 面仍拒绝 `proof-registration-missing`，这是验收器语义的正确表达：**component 层注册永远不能关闭 managed 分母**。

## 2. 本轮根因修复（控制器授权 STEP 1）

### 2.1 G-T1-10 关闭：spec.md 前导语删除 + 哈希链重封

- 控制器许可（P0_2 owns）删除 `## ADDED Requirements` 后的中文导语行；`openspec validate --strict`（1.15.0）现 **exit 0 "is valid"**（1.11.0 面此前亦 valid，版本严格度差异消除）。
- **完整哈希链重封**（控制器箭头链 + 同链必要环节）：`spec.md`(sha256 `47396b7b…`) → `spec-baseline.json` sources → `execution-contract.json` `openspec.baseline_sha256`(`27dfa1f4…`) → **`pilot-contract.md` frozenArtifacts.testContract**（同链必要：3_1.a 冻结基线门逐字节校验 spec.md，漏封即把 A15 染红）→ `drift-lock.json` `execution_contract_sha256`(`a66bfbda…`)。drift-lock 四哈希中 plan/dag/identity_map 未动（对应文件未变）。
- 回归：3_1（25/25）、2_1（7/7）复跑绿；V_OPENSPEC_STRICT **PASS**。

### 2.2 G-T1-11 关闭：4_3.mjs 陈旧 oracle 族对齐当前修订形态

r1 定位 V_RW_COMPLETION_REQUIRED 4/12 红"归 P4_3 owner 重写"；控制器本轮将 4_3 oracle 修复授权给本 worker。根因不止 92/118 两个数字，而是一族陈旧断言，全部按当前来源真值修复（无断言放宽）：

1. 分母数字 92→104 场景、118→130 检查（注释/元数据/断言共 10 处）。
2. 层词汇：`classifyCheck` 增加"契约未绑 case_module 的场景型检查（N 系列 12 条，case_module=null）不判 component_pass 而判 gate_support"——无模块即无组件证据通道，判 component_pass 是过度声明；层计数现为 component_pass 92 / env 11 / same_run 3 / gate_support 24。
3. blocking 面板扩展为 7 键（原 5 键 + `checks_failed`/`checks_not_executed`），与 5_1.a-4 复验仪器同一读回词汇——一个 judge、两套仪器、同源数字。
4. open_p1 世界断言更正：七 P1 寄存器在 comet-050 重规划时已移出 `execution-state.json`（后继台账=分档 gap registry），陈旧的 `openP1 > 0` 断言替换为精确真值 `openP1 === 0`（状态与索引一致）。
5. `acceptance-index.json` 以**双仪器投影**重建（本 worker VERIFY Owns）：同时满足 4_3 全部 12 断言与 5_1.a-4 复验（`summary` 两族键共存、`environment_gates` 恢复 comet-050 观察面——5_3 J4 逐字镜像 runbook 的前提）。
- 终态：V_RW_COMPLETION_REQUIRED 对**已交付工件**复跑 **12/12 PASS**（`evidence/direct-rerun-vrw-final.log`）；全模块 16/16；5_1 16/16；5_3 16/16。
- 诚实注记：V_RW 的 PASS 是"对最终工件的定点确认"——索引先投影（V_RW 记 PASS + 证据指针），再用完全相同的注册命令对已出货索引实跑取证（定点的自洽性由此闭环，过程在 `direct-rerun-final.json` 逐字在案）。

### 2.3 既有红确认（非本轮引入，新登记 G-T1-12）

5_2.mjs J3 在 HEAD 即红（git worktree 复跑证实 1/4）：其 oracle 钉在 command-first 重规划前的 `P5_2=ACCEPTED` 接受态，而现 state 为 `DEFERRED_NOT_EXERCISED`。F10 场景与 5_2 模块均不在 103 现域分母与 21 条 direct 内，不影响本轮 tally；归 P5_2 owner。

## 3. STEP 2：103 场景分母注册（G-T1-02 部分关闭）

注册落入 `verification-case-plan.json`（脚本 `evidence/register-denominators.mjs`，依据=钉版 node 对全部 case 模块的真实 TAP 快照）：

| 注册项 | 内容 |
| --- | --- |
| `required_proof_level` | **76 component**（注册模块内有同名 ok 测试点；含 F01/F03——1_1.mjs 以**精确测试名**绑定，把当前红点纳入分母保持诚实红）+ **27 host**（模块内无同名点，如实声明宿主及以上层） |
| `required_assertions` | 103 个非空冻结断言分母（裸场景 id 或精确测试名） |
| `required_readbacks` | 仅 27 个 host 场景登记 typed readback 槽（`<SID>:managed-run-state`，jsonFields 读回 runId/currentPhase）。**component 场景不登记**：验收器 L859 要求 readback 绑定冻结配方的 id-anchored jsonFields/equals 动作，组件面合成定义没有该类动作——登记即拒绝全部组件执行、摧毁真实证据；且 managed 面对 component 层注册在 L785 短路，readback 永不可达。host 场景登记后 managed 拒绝前进到 `protected-source-unavailable`（真阻塞暴露） |
| 绑定调和（9） | B01→3_2、C04/C06→classic-integration、C07→1_5、D02→2_5、E06→3_2、H02→4_5、N07→3_4、L11→3_3（每条以新模块内**真实执行的 ok 测试点**为据，`registration-summary.json` 在案；E06/L11 同时消解计划↔配方模块冲突，三旅程组件面 1/3→3/3 PASS） |
| journey `case_definition_sha256` | **未登记**（实测决策）：3_3.mjs（P3_3 Owns）把 managed 旅程拒绝 oracle 钉在未冻结状态；不修 owner oracle 直接登记 sha 会把全绿的 3_3（11/11）染红（`component-proof…` 链上实测复现后退回）。冻结与 oracle 更新须由控制器随 P3_3 一并落——G-T1-02 残留 |

### 批量执行（四相 + 终跑，全部钉版真实执行）

| 相 | 内容 | 结果 |
| --- | --- | --- |
| A managed 注册命令 109 条 | 逐条原样执行 | **109 NOT-EXERCISED exit 2**（27 host→`protected-source-unavailable`；76 component+F01/F03→`proof-registration-missing`（component 层不可关闭 managed 分母，如实）；3 旅程→`journey-recipe-freeze-or-safe-path-missing`（sha 未冻结，见 §3 残留）；V_F10 另计 scope） |
| B 组件面注册分母 103 场景 | `--case-plan` 钉注册表逐场景真实 spawn | **74 PASS / 2 FAIL / 27 NOT-EXERCISED**；FAIL=F01、F03（1_1.mjs 依赖矩阵红=G-T1-09，分母含红点故如实红）；L05 在批内 8/9（J5 真实 SIGKILL 墙钟预算超限，负载瞬态）——静默系统复跑 9/9 PASS + 模块单跑 9/9，两次运行均在案（同类瞬态已在 r1 I06 在案） |
| C 旅程 3 条 | 组件/观察资格面 | **3/3 PASS**（E06 调和后 same-run-delivery 由 NOT-EXERCISED(mismatch)→PASS；L11 调和后 real-comet-recovery→PASS） |
| D direct 21 条 | 逐条原样执行 | **21 PASS / 0 FAIL**（含 V_OPENSPEC_STRICT、V_RW_COMPLETION_REQUIRED 两项本轮修复转绿）。执行注记：批内首跑撞上与 r1 同类的执行器 bug（nodeBin 前缀 argv），全列作废，以正确可执行文件重跑（`rerun-direct.mjs` + `direct-rerun.json`） |
| 终跑 | `bash scripts/check.sh` | r1 exit 1（I06 producer-source-correlation 2073ms>2000ms fixture 预算，**已在 r1 登记的负载瞬态**；单测 2×49/49 绿）；**r2 exit 0，npm test 1159/1159** |

## 4. 分层证据索引（37 节点，压缩承接 r1 §4）

P4_3 逐节点详版保全于 git `f43368c`；r1 版索引保全于 git `58ea78f`。分层与节点集经 `worker-reports/P4_3-comet-050/consistency-check.py` 对账（r1，exit 0）。

- **L0 文档门（4）**：P0_1 架构收敛、P0_2 规格/提案/设计（本轮前导语删除经其许可）、P0_3 用户入口、P0_4 独立评审链。
- **L1 工具链（2）**：P1_1 0.5.0 供应链重锁（20/20；**遗留 G-T1-09**：1_1.mjs 红=F01/F03，baseline 1.15.0 行归 owner）、P1_4 供给重锁+编译器实探。
- **L2 纯组件（4）**：P2_1 契约/基线（61/61）、P2_2 证据准入+纯门（60/60）、P2_3 legacy CLI、P3_1 journey 验证器资格（47/47；本轮冻结基线门复跑 25/25 绿）。
- **L3 组合包（3）**：P1_6 方法资产、P1_2 分发+hooks、P2_4 运行时组合 R3（活盘复核 ba88b84d 一致）。
- **L4 宿主接线（4）**：P1_3 适配器/MCP、P1_5 Classic 装配、P3_2 首次真实 R→V（13/13）、P3_3 恢复语义活体（11/11；**本轮发现其 L11-recipe-tracking oracle 与 sha 冻结互锁**——见 §3 残留）。
- **L5 适配器/装配（3）**：P2_5 架构评审适配器、P3_4 规格收尾、P4_5 Ponytail hook。
- **L6 知识/平台/恢复（17）**：知识 6、平台 7（I06 负载瞬态同类在案，本轮 2×49/49 复核绿）、恢复 1、索引 1（P4_3——**本轮 G-T1-11 收敛**）、交付尾部 3（P5_1 16/16、P5_3 16/16、P5_2 DEFERRED——**G-T1-12 既有红在案**）。

## 5. 缺口终态（机器可读版 `verification-results.json#gap_registry_final`）

### 第一档：本地（12 项；本轮关 3 开 1）

| # | 终态 |
| --- | --- |
| G-T1-01 node24 链测试失败 | CLOSED（r1；本轮 3_2/3_3/三旅程复核保持绿） |
| G-T1-02 分母登记 | **PARTIALLY_CLOSED_BY_FINAL_VERIFY**：场景分母全注册 + 9 绑定调和 + E06/L11 冲突消解；残留＝journey sha 冻结（与 3_3 owner oracle 互锁）、component 场景 readback 层（待逐场景冻结配方）、27 host 场景组件点缺口（已如实分层） |
| G-T1-03 delivery-gate 收据链 | MECHANISM_VERIFIED_PLATFORM_BLOCKED（不变） |
| G-T1-04 I02 errata | OPEN_OWNER_PREREQUISITE_BEFORE_ARCHIVE（不变） |
| G-T1-05 pre-tool-gate fallback | OPEN_HOOKS_OWNER_EDGE_FALLBACK（不变） |
| G-T1-06 4_6 openspec 版本 | VERIFIED_WORKING_MIGRATION_DEFERRED（不变） |
| G-T1-07 P3_3 证据命令头 | SUBSTANCE_REVERIFIED_STYLE_OPEN（不变） |
| G-T1-08 CI-parity | LOCAL_DONE_PLATFORM_AND_FIXTURES_OPEN（196 fixtures 未入 git，不变） |
| G-T1-09 openspec CLI 漂移 | **OPEN_P1_1_OWNER_BASELINE_ROW**——F01/F03 分母已注册且含红点，组件面如实红；baseline 行补录归 P1_1 |
| G-T1-10 1.15.0 strict 严格度 | **CLOSED_BY_FINAL_VERIFY_PREAMBLE_REMOVAL**（前导语删除 + 四环节哈希链重封；§2.1） |
| G-T1-11 4_3 陈旧 oracle 族 | **CLOSED_BY_FINAL_VERIFY_ROOT_CAUSE**（§2.2） |
| G-T1-12（新） 5_2 J3 既有红 | OPEN_P5_2_OWNER_ORACLE（HEAD 复跑证实非本轮引入；§2.3） |

### 第二档：需人工（6 项，全部保持 UNVERIFIED 原样移交）

G-T2-01 Outline 授权｜G-T2-02 P4_1 三人工门+push 授权｜G-T2-03 open decisions 裁决｜G-T2-04 远端 URL 差异 + gh TLS 拦截｜G-T2-05 overlay 语料裁决｜G-T2-06 真实团队宿主使用验证。

### 第三档：需外部资源（6 项，全部保持 UNVERIFIED/NOT-EXERCISED 原样移交）

G-T3-01 Outline 凭据｜G-T3-02 远端 CI 平台证据｜G-T3-03 I04 五项宿主面｜G-T3-04 I05 八项｜G-T3-05 I06/I07 远端运维 + P4_2 发布读回｜G-T3-06 F10 跨机器 Control API（另立变更）。

## 6. 归档建议与后审

**建议：DO_NOT_ARCHIVE_YET。**

- 已具备（较 r1 净进）：分母注册落地（103 场景 + 9 绑定调和）；两项 direct FAIL 根因修复转绿（130 检查 **FAIL 0**）；组件面注册分母真实执行 **74 PASS**；三旅程组件面 **3/3 PASS**；check.sh exit 0（1159/1159）；质询 5/5 UPHELD 承接 + 本轮 6 问（`grill-report.md`）。
- 阻塞归档：① managed 面关闭需合格 Comet launcher 观察接口（protected-source）——宿主/平台级；② G-T1-09（F01/F03 组件红，1_1 baseline 行）owner 修复；③ G-T1-02 残留（journey sha 冻结 + 3_3 oracle 互锁、component readback 冻结配方层）；④ 二档 6 项人工门；⑤ 196 个 fixture 未入 git；⑥ G-T1-12（P5_2 owner oracle）。
- 归档路径建议（控制器顺序）：P1_1 落 1.15.0 baseline 行（F01/F03 转绿）→ 随 P3_3 更新 3_3 oracle 并落 journey sha 冻结 → （可选）逐 component 场景冻结配方以登记 readback → `git add -f` 196 fixtures → 平台人工门 → 装合格 Comet launcher 后 managed 分母重跑 → 原生 Comet closeout（唯一归档写者）→ Kt 后审。
- 本节点产出文件（FINAL-VERIFY Owns）：本报告、`grill-report.md`、`verification-results.json`、`acceptance-index.json`、`worker-reports/FINAL-VERIFY/`（record + evidence）。`execution-state.json`/`execution-ledger.jsonl` 按本仓共识由唯一控制器管写，本轮未触碰。
