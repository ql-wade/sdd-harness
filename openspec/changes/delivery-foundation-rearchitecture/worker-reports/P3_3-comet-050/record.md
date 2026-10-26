# P3_3 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: P3_3 原Run恢复、重复和旧证据（comet-050）。本报告记录真实宿主执行：所有探针与
断言均针对钉版 0.5.0 构建（upstream.lock aeb1a659+0005，build de39629a…，钉版 node
24.15.0），真实 CLI 子进程 + 真实 SIGKILL + 磁盘 checkpoint 字节回读为唯一权威。

## Scope honored（只改 Owns 文件 + 本报告目录）

- `test/delivery-cases/3_3.mjs`（重写 V_RW_REAL_COMET_RECOVERY 切片为 comet-050 组合 Run 面；V_A10/A11/A12/F07/A12b 角色链用例原样保留）
- `openspec/changes/delivery-foundation-rearchitecture/pilot-recovery/real-comet-recovery.case.json`（配方重写为 C050 五语义；不钉任何 contentHash 值）
- `openspec/changes/delivery-foundation-rearchitecture/pilot-recovery/real-comet-recovery.journey.json`（landed 步骤改为 c050-*；profile 改 comet-managed-v2；保留 1/7/8/9 为 VERIFY）
- `openspec/changes/delivery-foundation-rearchitecture/pilot-recovery/comet-050-composition-recovery-probe.json`（新增：pristine 0.5.0 恢复面实证登记）
- 本报告目录。未 commit；一次性世界全部在 /tmp（隔离 HOME/TMPDIR/PATH）。

## 1. Record（0.5.0 恢复语义，实证来源）

- 组合 Run 面：`comet runtime dispatch --application-file <pkg>/application.json --project-root <project> --request <json>`。
  Run 记录持久化于 `<HOME>/.comet/workspaces/<wsid>/runtime/applications/sdd-managed-delivery/.runtime-store-v2/<hash>/checkpoint.json`（ApplicationRunRecord：runId/revision/application 身份含 contentHash/完整 SDK Run）。
- 世界接线复刻安装器的托管 runtime 链接（`node_modules/@rpamis/comet -> 钉版 build work/`，即 ensureApplicationRuntimeDependency 的产物形态）；不声称发生过 install。组合包在测试开始时快照进 /tmp 世界，与 P2_4-R3 的并行包工作完全隔离；断言全部结构性（contentHash 仅断言 64-hex 形态）。
- 关键判定序（pristine 源码 + 探针双重确认）：引擎级 outcome 准入（attempt+inputHash+claimToken 绑定）先于任何业务验证器；`loadWorkflowApplication` 身份核对先于应用模块加载（漂移代码不在恢复请求中执行）；refused 写的 CLI 响应携带 `continuation.request={operation:'inspect',runId}`（classic composition recovery 请求面）；classic `run_checkpoint` 恢复请求面为 `{operation:'next'}`（源码登记，见 probe 记录）。

## 2. RED（真实行为 RED，非缺环境）

钉版跑修订前 3_3.mjs：**5 pass / 3 fail**（`evidence/RED-pre050-face.txt`）。三个失败
都是 0.4.5 classic 面在 0.5.0 供给上真实消亡：`state init <change> full --managed-delivery`
被 0.5.0 usage 拒绝（L11-core-transaction / L11-fencing 随之失败）；recipe-tracking 的
runner 面已变为 comet-managed-v2（旧断言失效）。V_A10/A11/A12/F07/A12b（仓内 recovery-chain
执行器层）5/5 绿、原样保留。

## 3. 五语义实测表（GREEN：`node --test test/delivery-cases/3_3.mjs` 11/11，109s）

| 语义 | 测试点 | 实测结果（真实 CLI） |
| --- | --- | --- |
| a) 中断后恢复 | C050-interrupt-resume | 真实 SIGKILL 落在 Run 记录持久化窗口（本次 landing=killed-before-commit，pid 确认死亡）；恢复入口=新 CLI 进程重发**原请求**（同 runId/同包/同输入）→ Run 恰好存在一次、身份/输入逐字节保持、revision 链一致；随后 run 正常续行（trusted prepare 收据恰 1、审批恰一次、full.open 调度）；拒绝写暴露 inspect 恢复请求面 |
| b) 重复调用幂等 | C050-idempotent-recovery | start 逐字节重放 x4：同一 Run、记录字节不变、无新 action、磁盘仅 1 个 checkpoint；审批同决定重放 x4：revision 不动、决定恰 1；同 runId 换输入 → RUN_CONFLICT；不同决定 → DECISION_CONFLICT |
| c) 内容变化拒绝 | C050-workflow-changed | 包内 1 字节漂移：next 与 inspect 双面 WORKFLOW_CHANGED（'请恢复原应用包和依赖后继续原 Run'），拒绝期间 Run 字节不动、无第二个 Run；还原字节后同 Run 在原包归属（realpath packageRoot）下继续推进 |
| d) 旧证据 | C050-stale-evidence | 错 claimToken → STALE_ACTION；mark-unknown→retry(和解) 后 attempt=2，死亡 attempt-1 回执（含其当年合法 token）重放两次均 STALE_ACTION；磁盘 receipts 恒 0（引擎级拒绝先于业务验证器；保守失效，旧证据不复活） |
| e) 并发写者 | C050-single-writer | 第二写者 claim → ACTION_ALREADY_CLAIMED；引擎自己的 trusted executor 接管 host 已领 action 也被拒；同身份重领幂等（revision 不动）；过期 expectedRevision → REVISION_CONFLICT；磁盘恰一个 claim owner |

逐语义证据 JSON：`evidence/kill-ev/c050-*.json`（含 pid/signal/landing/磁盘摘要）；探针原始
CLI 响应：`evidence/probe/out-*.json`；pristine 面登记：`pilot-recovery/comet-050-composition-recovery-probe.json`。

**配方经真实 runner 端到端复核**：以临时 case-plan 冻结本配方 sha256（模拟 VERIFY 的分母
冻结步骤）后 `tools/verify/delivery-journey.mjs --journey real-comet-recovery --profile
comet-managed-v2` → **verdict PASS**（`evidence/runner-e2e-verdict-frozen-denominator.json`）。
复核中发现并修复两处配方缺陷（runner 不变量所迫，旧配方的同类缺陷曾被未冻结分母掩盖）：
(i) schema 禁止额外顶层字段（revision 键移除）；(ii) runner 要求 scenario token（L11）钉在
requiredAssertions 且必须被 spawn 的 TAP 点满足——recipe-tracking 测试点更名为
`V_RW_REAL_COMET_RECOVERY:L11-recipe-tracking` 承接该锚，裸 "L11" 钉不再悬空。

## 4. 相邻回归（真实命令与结果）

| 命令 | 结果 |
| --- | --- |
| `node --test test/delivery-cases/3_3.mjs` | **11/11 pass, 0 fail** |
| `node --test test/delivery-cases/3_2.mjs` | 13/13 pass |
| `~/.nvm/versions/node/v24.15.0/bin/node --test test/delivery-cases/3_4.mjs` | 9/9 pass（3_4 自带"必须锁版 node"前置；host node 22 下其守卫拒绝为预期行为，原件留档 adjacent-3_4-host-node22-refused.txt） |
| `node --test test/delivery-cases/3_1.mjs` | 25/25 pass |
| `node --test test/delivery-cases/2_4.mjs` | 24/24 pass |

## 5. UNVERIFIED / 边界（如实登记）

- **同 Run 旅程分母未冻结**：`verification-case-plan.json journey_definitions.real-comet-recovery` 无 `case_definition_sha256`，`tools/verify/delivery-journey.mjs --journey real-comet-recovery --profile comet-managed-v2` 如实 NOT-EXERCISED（journey-recipe-freeze-or-safe-path-missing）。该文件不在本任务 Owns；分母注册归 VERIFY 前步骤（与 P3_2 记录一致）。
- **活性 Outline 未知结果窗、外部监控/备份资格**：仍归 VERIFY（same-run journey step 9 / 本 journey 步骤 7-9），本切片只落 bounded 组合 Run 恢复面。
- **kill 窗口是真实竞态**：本次完整运行 landing=killed-before-commit（最强恢复路径：恢复入口原请求重建 Run 恰一次）；killed-after-commit 与 child-completed-first 分支的断言同样固化在测试中，任一落地都被接受且逐尝试分类留痕——不伪造落地，预算耗尽即红。
- **classic `run_checkpoint` 的 `{operation:'next'}` 恢复面**为 pristine 源码登记（classic-sdk-state-store），本切片未在 classic SDK Run 上活体触发（组合 Run 走 application store 面）；probe 记录已区分。
- **组合包被并行修改中**（P2_4-R3 工作区可见）：本套件按测试开始时快照运行并通过；对包内容的任何并行变更不需本套件重跑即兼容（断言结构性、世界一次性）。全量 `npm test` 未跑（时间盒；直接相邻面 1_3 层级的 2_4/3_1/3_2/3_4 全绿）。
- 跨机 fencing 归 I08；单机目录形态为同环境边界。
