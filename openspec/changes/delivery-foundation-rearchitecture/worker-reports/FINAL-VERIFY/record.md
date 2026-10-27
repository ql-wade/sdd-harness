# FINAL-VERIFY worker record — G-T1-02 分母注册 + 103 场景批量验收 + 终报

- Worker：终验 worker（控制器指令三步任务）；钉版 node v24.15.0（`~/.nvm/versions/node/v24.15.0/bin`）；候选 HEAD `58ea78f`（工作树，未 commit）。
- 产出：`verification-report.md`（终版）、`verification-results.json`、`acceptance-index.json`（双仪器投影）、`grill-report.md`（r1 5/5 UPHELD 承接 + F1–F6 补充质询）、本目录 evidence。

## 目标与完成范围

1. **STEP 1a（完成）**：删除 spec.md「## ADDED Requirements」后中文前导语（控制器许可，P0_2 owns）；重封哈希链——spec-baseline sources → execution-contract `baseline_sha256` → pilot-contract `frozenArtifacts.testContract`（同链必要，3_1.a 逐字节校验）→ drift-lock `execution_contract_sha256`（四哈希中其余三个未变，盘上核对全等）。V_OPENSPEC_STRICT 由 exit 1 → **exit 0 "is valid"**（openspec 1.15.0 --strict）。
2. **STEP 1b（完成）**：4_3.mjs 陈旧 oracle 族（不止 92/118）：分母 104/130、`classifyCheck` 层词汇（契约未绑模块的 N 系列 12 条判 gate_support）、blocking 扩为 7 键（与 5_1.a-4 同词汇）、open_p1 世界断言更正为真值 0（七 P1 寄存器已在 comet-050 重规划时移出 execution-state）。V_RW_COMPLETION_REQUIRED 对最终工件 **12/12 PASS**（`evidence/direct-rerun-vrw-final.log`）。
3. **STEP 2（完成，含如实残留）**：103 场景分母注册（76 component + 27 host 带 readback 槽 + F01/F03 精确测试名绑定）；9 绑定调和（B01/C04/C06/C07/D02/E06/H02/N07/L11 → 真实承载测试点的模块）；journey sha 冻结**实测后退**（3_3.mjs owner oracle 与冻结互锁，登记即染红全绿模块——留 G-T1-02 残留归控制器+P3_3）。
4. **批量验收（完成）**：A 109 managed 全 NOT-EXERCISED（host 27 前进到 protected-source-unavailable）；B 103 场景组件面 74 PASS / 2 FAIL（F01/F03=G-T1-09）/ 27 NOT-EXERCISED（host 分层）；C 三旅程 3/3 PASS；D 21 direct 全 PASS（批内首跑执行器 bug 全列作废重跑，作废行保留在 `batch-results.json#D_direct_voided_executor_bug`）。
5. **终报（完成）**：报告/结果/质询/索引四件套 + 本 record。

## 关键改动文件（事实来源）

| 文件 | 改动 |
| --- | --- |
| `specs/delivery-foundation/spec.md` | 删前导语行（控制器许可） |
| `spec-baseline.json` / `execution-contract.json` / `pilot-contract.md` / `drift-lock.json` | 哈希链重封（仅哈希值，各 1-2 行） |
| `verification-case-plan.json` | 103 场景三字段注册 + 9 rebind + `proof_registration` 溯源块（+863/-116 行，纯增量） |
| `test/delivery-cases/4_3.mjs` | oracle 族对齐（分母/层/阻塞/P1 真值；无断言放宽） |
| `acceptance-index.json` / `verification-results.json` / `verification-report.md` / `grill-report.md` | 终版投影与报告（VERIFY Owns） |
| `worker-reports/FINAL-VERIFY/` | 本 record + evidence（脚本、批结果、复跑日志、gap registry） |

## 真实执行的验证命令与结果

- 批量：`node …/run-batch.mjs`（A/B/C 相 + D 相首跑作废）→ `rerun-direct.mjs`（21/21 exit 0）→ `build-final.mjs`（终投影）→ V_RW 定点复跑 12/12。
- 终跑：`bash scripts/check.sh` r1 exit 1（I06 producer-source-correlation 2073ms>2000ms，r1 已登记的负载瞬态类；`test/infra-platform.test.js` 隔离复跑 2×49/49 绿）→ **r2 exit 0，npm test 1159/1159**。
- 仪器交叉：4_3 全模块 16/16、5_1 16/16、5_3 16/16、3_1 25/25、2_1 7/7、3_2 13/13、3_3 11/11（均钉版）。
- 负载瞬态：L05 批内 8/9（J5 真实 SIGKILL 墙钟超限）→ 静默复跑 9/9 PASS + 模块单跑 9/9；两次运行全留痕。

## 未验证项与需人工确认（移交）

- managed 分母关闭需合格 Comet launcher 观察接口（宿主/平台级）——108 UNVERIFIED 的最终收敛条件。
- G-T1-09（P1_1 落 toolchain-baseline 1.15.0 行 → F01/F03 转绿）、G-T1-02 残留（journey sha 冻结随 3_3 oracle 更新；component readback 配方层）、G-T1-12（P5_2 J3 既有红，HEAD worktree 复跑证实非本轮引入）、G-T1-04/05/07/08 owner 项、二档 6 项人工门、196 fixtures 入 git。
- 风险注记：plan 与 contract 的 `case_module` 字段在 9 个调和场景上有计划内差异（contract 字段未被任何机械校验消费；注册事实源=plan，已在 `registration-summary.json` 逐条在案）——控制器如需对齐 contract 字段属登记后续工程。

## 归档建议

**DO_NOT_ARCHIVE_YET**（理由与路径见 `verification-report.md` §6）。
