# VERIFY 终验报告 — delivery-foundation-rearchitecture（2026-10-26-comet-050-adoption-v1）

- 生成：VERIFY worker（2026-10-27）；钉版执行环境 node **v24.15.0**（`~/.nvm/versions/node/v24.15.0/bin`）；候选 git HEAD `29752c0`（工作树；VERIFY 禁止 commit）。
- 机器可读同伴：`verification-results.json`（schema 4，130 检查逐个终态）；`acceptance-index.json`（schema 2 终态投影）；质询见 `grill-report.md`；原始证据 `worker-reports/VERIFY-comet-050/evidence/`。
- 本报告取代 P4_3 的 pre-VERIFY 分层索引（原版在 git 历史 `f43368c` 与 `replans/2026-10-26-command-first/before/` 双份保全）。VERIFY 是本文件的最终 owner；终态由本轮真实同版本执行推导，不以构建级索引替代。

## 1. 总览

| 维度 | 数值 |
| --- | --- |
| 计划节点 | 39（37 已接纳 / P5_2=F10 另期 / VERIFY 本节点） |
| 检查分母 | 130 required（**129 现域 + V_F10 范围外 NOT-EXERCISED**） |
| 场景分母 | 104（**103 现域 required + F10**）；注册旅程 3 |
| 130 检查终态 | **PASS 19 / FAIL 2 / UNVERIFIED 108 / NOT_EXERCISED_SCOPE 1** |
| 场景终态 | **VERIFIED 0 / 103 全部保持 NOT_VERIFIED**（受管同 Run 旅程未跑通，诚实不闭） |
| 全仓终态 | `bash scripts/check.sh` **exit 0**（npm test **1159/1159**，本轮第三次完整执行） |
| 归档建议 | **DO_NOT_ARCHIVE_YET**（见 §6） |

证明范围声明：本轮所有结果来自当前版本真实执行（钉版 node24、当前工作树）；managed 模式的 109 项结构化拒绝（exit 2）是**如实 NOT-EXERCISED**，不是跳过转绿。19 项 direct PASS 属 supporting/gate 层——按 `status_rule.supporting_cli`，支撑命令的 PASS 永不关闭场景。

## 2. 本轮全量检查（四相 + 终跑）

### Phase A — 129 项注册命令中的 109 项 journey/scenario 检查（managed 模式，逐条原样执行）

- 106 项场景检查：全部 `NOT-EXERCISED exit 2`，reason 一致为 `proof-registration-missing (UNVERIFIED): formal scenarios require a frozen assertion denominator, real proof level and typed readbacks`——`verification-case-plan.json` 的 104 个 case 均未登记 `required_proof_level / required_assertions / required_readbacks`（G-T1-02）。
- 3 项旅程检查：全部 `NOT-EXERCISED exit 2`，reason `journey-recipe-freeze-or-safe-path-missing`——`journey_definitions` 未注册 `case_definition_sha256`（G-T1-02）。
- 证据：契约自带 `--evidence-dir`（`.whitebox/comet-managed-v2/<ID>`、`.whitebox/delivery-foundation/<ID>`）下逐场景 verdict.json；汇总 `evidence/batch-results.json`。

### Phase B — 103 项现域场景组件面真实执行（supplementary，`--case-plan` 钉同一注册表）

- **66 PASS**（真实 spawn case 模块 + 类型化 TAP 读回；18 个模块面全绿，含 4_8×11、4_7×8、2_2×7、2_1×6、3_2×4、classic-integration×4 等）。
- **35 NOT-EXERCISED（绑定缺口）**：注册 `case_module` 内无该场景同名测试点（P1-04 纪律拒绝"绿套件无目标"）。场景清单：B01、C04、C06、C07、D01–D08、E01、E02、E06、F06、H01–H05、H07–H09、N01–N03、N05–N12（机器可读清单 `verification-results.json#scenario_binding_gaps`）。
- **2 FAIL（行为红，根因已定位）**：F01、F03（模块 1_1.mjs）——宿主全局 openspec CLI 漂移 1.14.3→1.15.0，`toolchain-baseline` compatibility_matrix 无 1.15.0 观察行 → 依赖矩阵测试 TypeError（新缺口 **G-T1-09**；1.15.0 CLI 真实探针已留存 `evidence/grill/g-t1-09-openspec-1150-drift.txt`，exit 0）。

### Phase C — 3 个注册旅程配方执行（component/observer-qualification 面）

- `post-delivery-permissions`（L05/4_8）：**PASS**（真实执行 4_8.mjs 全绿）。
- `same-run-delivery`（E06/3_2）与 `real-comet-recovery`（L11/3_3）：`NOT-EXERCISED registered-case-module-mismatch`——**注册表与已落地配方互相矛盾**：plan 绑 E06→4_4.mjs（配方用 3_2.mjs）、L11→4_8.mjs（配方用 3_3.mjs）。这是 G-T1-02 的具体化：登记时必须同时调和模块绑定。
- 注：componentOnly 模式下 sha256 冻结门不在该面求值；正式冻结仍待控制器落注册。

### Phase D — 21 项 direct 检查（逐条原样执行，两轮：首轮执行器 bug 全作废重跑）

| 结果 | 明细 |
| --- | --- |
| **19 PASS** | V_FULL_CHECK（check.sh exit 0，1159/1159）、V_NPM_REGRESSION（standalone exit 0，1159/1159；另有一次 1158/1159 的 I06 负载瞬态在案）、V_SCOPED_REGRESSION（1159/1159）、V_INFRA_I01–I08（44/75/44/53/100/49/22/18）、V_P1_6_PONYTAIL_ASSETS（11）、V_P1_2_PLUGIN_REGISTRATION_DIVISION（68）、V_I02_METHOD_STATE_SCOPE（196）、V_RW_TARGET_REQUIRED/OBSERVATION_REQUIRED（5+5）、V_RW_R_ENTRY/TRUSTED_REVIEW/REVISION_NO_REVIVE（1×3） |
| **2 FAIL** | V_OPENSPEC_STRICT：openspec **1.15.0**（隔离钉版与宿主同版）`--strict` 对 spec.md「## ADDED Requirements」前置导语文本判 exit 1；**1.11.0**（变更撰写时钉版）同命令 exit 0 "is valid"——版本严格度差异（新缺口 **G-T1-10**；spec.md 是冻结工件 sha256 8bb67f81…，任何编辑都会触发 A15 保守失效，VERIFY 不动）。V_RW_COMPLETION_REQUIRED：4_3.mjs 陈旧 oracle——硬编码 92 场景/118 检查（convergence 前分母），当前 104/130（12 测中 4 红，含 `104 !== 92` 与旧 overclaim 断言）；4_3.mjs 归 P4_3 Owns，重写归 owner（5_1.mjs 的 5.1.a-4 已是正确形态参照） |

### 终跑与全仓信号

- `bash scripts/check.sh`（evidence/check-sh-final.log）：**exit 0**，npm test **1159/1159**。
- 本轮 check.sh 共三次完整执行：r1 exit 1（`__pycache__` 污染，见 §3）、r2 exit 1（I06 瞬态 1158/1159 + delivery-cases 面同轮暴露 G-T1-01）、r3 **exit 0**。
- I06 瞬态定性：`infra-platform.test.js` 单独 3×49/49 绿；红仅出现在整仓高负载下（stub 请求 2120ms 超 2000ms fixture 预算）——与 I06 独立复审登记的"1 次瞬态红不可复现"一致。

## 3. 本轮根因修复（VERIFY 授权范围内，均非放宽断言）

1. **G-T1-01（已闭）**：node≥24 将管道默认 test reporter 由 TAP 改为 spec → `run-role-chain.mjs`/`run-recovery-chain.mjs`（WORKER_SCRIPT）与 3_2/3_3 的 `runFixtureTest` 以裸 `node --test` 派发后，`parseTapSummary` 拿不到 `# tests N`，`classifyRunOutcome` 全量 fail-closed 为 environment-failure（叶子收据 unverified/0 valid → 门 blocked → 链 DIVERGED）。修复=四处 spawn 显式钉 `--test-reporter=tap`（delivery-journey.mjs 既有惯例）；修复后 3_2 **13/13**、3_3 **11/11**（钉版复跑）。改动文件：`pilot-recovery/run-recovery-chain.mjs`、`pilot-journey/run-role-chain.mjs`、`test/delivery-cases/{3_2,3_3}.mjs`（P3_2/P3_3 Owns 文件的最小根因修复，按控制器 VERIFY 指令"尽力补验 run-recovery-chain 钉版根因"执行并在此如实登记）。
2. **环境污染（已清）**：`.agents/skills/claude-parallel-tdd-planner/scripts/__pycache__/plan_guard.cpython-314.pyc`（未跟踪、gitignore 覆盖）污染 vendored 快照字节比对 → 删除该目录恢复受保护源纯净；comet-method-binding 9/9。
3. **两处新登记缺口**：G-T1-09（openspec CLI 漂移致 1_1.mjs 红）、G-T1-10（1.15.0 strict 严格度）——见 §5。

## 4. 分层证据索引（37 节点，承接 P4_3 的 34 节点索引）

P4_3 的逐节点详版（关键文件/核心 GREEN/独立复审/证据指针）保全于 git `f43368c`；此处为终验视角的压缩索引。分层与节点集经 `worker-reports/P4_3-comet-050/consistency-check.py` 对账（exit 0）。

- **L0 文档门（4）**：P0_1 架构收敛、P0_2 规格/提案/设计、P0_3 用户入口、P0_4 独立评审链 —— 全 ACCEPTED_CARRIED_COMET_050。
- **L1 工具链（2）**：P1_1 0.5.0 供应链重锁（20/20）、P1_4 供给重锁+编译器实探（7/7+43/43+171/171+18/18）。
- **L2 纯组件（4）**：P2_1 契约/基线（61/61）、P2_2 证据准入+纯门（60/60）、P2_3 legacy CLI（31/31×2）、P3_1 journey 验证器资格（47/47）。
- **L3 组合包（3）**：P1_6 方法资产（9/9+11/11）、P1_2 分发+hooks（76/76+13/13）、P2_4 运行时组合 R3（双构建 df916df6/ba88b84d；本轮活盘复核一致）。
- **L4 宿主接线（4）**：P1_3 适配器/MCP（121/121+21/21+10/10）、P1_5 Classic 装配（37/37+152/152；本轮 C01-C03/C05 组件面再绿）、P3_2 首次真实 R→V（13/13；本轮 G-T1-01 修复后复绿）、P3_3 恢复语义活体（11/11；同上）。
- **L5 适配器/装配（3）**：P2_5 架构评审适配器（70/70×2+14/14+74/74）、P3_4 规格收尾（45/45+9/9）、P4_5 Ponytail hook（25/25）。
- **L6 知识/平台/恢复（17）**：知识 6（I04 53/53、I05 100/100、P4_4 Kp 闭环 21/21×2、P4_6 20/20+6/6、P4_7 13/13+15/15+13/13、P4_8 9/9+19/19）；平台 7（I01 44/44、I02 75/75 双节点、I03 44/44、I06 49/49、I07 22/22+61/61+7/7、P4_1 读回门、P4_2 30/30+7/7+97/97）；恢复 1（I08 18/18+13/13+4/4）；**索引 1（P4_3，本轮由控制器接纳）**；**交付尾部 3（P5_1 16/16、P5_3 16/16 计 13→16 增长、P5_2 DEFERRED）**。

本轮对索引的三处增量：P4_3（索引本体）、P5_1（真实宿主能力，zcode-session 宿主入矩阵）、P5_3（运维/交接，J2/J4 漂移面重钉）——接纳证据在 `execution-state.json` node_status（2026-10-27T05:45 批量接纳）。

## 5. 缺口终态（机器可读版 `verification-results.json#gap_registry_final`）

### 第一档：本地可补（原 8 项 + 新 2 项）

| # | 终态 |
| --- | --- |
| G-T1-01 node24 链测试失败 | **CLOSED_BY_VERIFY_ROOT_CAUSE**（§3.1） |
| G-T1-02 分母登记 | **OPEN_CONTROLLER_REGISTRATION**——且本轮量化出 35 个场景绑定缺口 + 2 个配方↔注册表模块冲突（E06、L11）；登记时须一并调和 |
| G-T1-03 delivery-gate 收据链 | **MECHANISM_VERIFIED_PLATFORM_BLOCKED**（workflow+验证器+测试在盘；平台执行归 G-T2-02/G-T3-02） |
| G-T1-04 I02 errata | **OPEN_OWNER_PREREQUISITE_BEFORE_ARCHIVE**（errata 已结构化在 execution-state；重生成归 owner） |
| G-T1-05 pre-tool-gate fallback | **OPEN_HOOKS_OWNER_EDGE_FALLBACK**（canonical 与编译产物正确；仅未编译宿主边缘） |
| G-T1-06 4_6 openspec 版本 | **VERIFIED_WORKING_MIGRATION_DEFERRED**（1.11.0/1.15.0 双 CLI 在盘可用；H 系列本轮组件实跑） |
| G-T1-07 P3_3 证据命令头 | **SUBSTANCE_REVERIFIED_STYLE_OPEN**（本轮全场景复跑产出带命令头新证据；冻结件风格归 owner） |
| G-T1-08 CI-parity | **LOCAL_DONE_PLATFORM_AND_FIXTURES_OPEN**（workflow 自足化完成、clone 全量 1134/1134 复现；遗留 196 个 `*.log` fixture 需 `git add -f` + 平台人工门） |
| **G-T1-09（新）** openspec CLI 漂移 1.14.3→1.15.0 | **OPEN_P1_1_OWNER_BASELINE_ROW**（1_1.mjs 依赖矩阵红=F01/F03；1.15.0 探针已留证） |
| **G-T1-10（新）** 1.15.0 strict 严格度 | **OPEN_P0_2_OWNER_PREAMBLE_MOVE**（spec.md ADDED 前导语；冻结工件不可单改，须随重冻结一并处理；1.11.0 面仍 valid） |

### 第二档：需人工（6 项，全部保持 UNVERIFIED 原样移交）

G-T2-01 Outline 授权（三次真实 401 逐字在案）｜G-T2-02 P4_1 三人工门+push 授权（本地领先）｜G-T2-03 open decisions 裁决（P2_3 退出码钉定值等 6+ 项）｜G-T2-04 远端 URL 差异 + gh TLS 拦截｜G-T2-05 overlay 语料裁决｜G-T2-06 真实团队宿主使用验证。

### 第三档：需外部资源（6 项，全部保持 UNVERIFIED/NOT-EXERCISED 原样移交）

G-T3-01 Outline 凭据｜G-T3-02 远端 CI 平台证据｜G-T3-03 I04 五项宿主面｜G-T3-04 I05 八项（NOT_DEPLOYED 诚实）｜G-T3-05 I06/I07 远端运维 + P4_2 npm/GitHub 发布读回｜G-T3-06 F10 跨机器 Control API（决策 A，另立变更）。

## 6. 归档建议与后审

**建议：DO_NOT_ARCHIVE_YET。**

- 已具备：37/39 节点构建级接纳 + 本轮全量同版本执行记录 + 全仓 check.sh exit 0 + 质询五项 UPHELD + 缺口登记完备（`gap_registry_final`）。
- 阻塞归档：① G-T1-02 正式登记（journey sha256 冻结 + 场景 proof 登记 + 35 绑定调和 + E06/L11 冲突调和）未落——登记后 managed 分母才可真实执行；② 2 项 direct FAIL（G-T1-09/G-T1-10）按 owner 修复；③ 二档 6 项人工门未闭（尤其 G-T2-02 平台门与 G-T2-01 授权）；④ 196 个 fixture 未入 git（fresh clone 恒红，CI-parity 遗留）。
- 归档路径建议（控制器顺序）：落 G-T1-02 登记（含绑定调和）→ 修复 G-T1-09/G-T1-10 → `git add -f` 196 fixtures → 平台人工门 → managed 分母重跑（届时 108 项 UNVERIFIED 才可向 PASS/FAIL 收敛）→ 原生 Comet closeout（唯一归档写者，P3_4 已资格化）→ Kt 后审（P4_4 的 Outline 401 面在授权后补）。
- 本节点产出文件（VERIFY Owns）：本报告、`grill-report.md`、`verification-results.json`、`acceptance-index.json`（终态投影；5_1.mjs 仪器 16/16 复验通过）。`execution-state.json`/`execution-ledger.jsonl` 虽列于 VERIFY Owns，但按本仓共识由唯一控制器管写（防第二写者），本轮未触碰。
