# Grill Report — VERIFY 终验证据交叉质询（2026-10-26-comet-050-adoption-v1）

- 生成：VERIFY worker（2026-10-27，钉版 node v24.15.0）；最终 owner：VERIFY。
- 对象：P4_3 分层证据索引中承载最重验收主张的五组关键证据。方法：每组挑一个"最可能造假的点"，用盘上原件 + 本轮真实复跑交叉核实；凡依赖一次性 /tmp 试点世界且已声明不可重放的面，按声明边界降级为"工件级核实"并如实标注。
- 机器可读同伴：`verification-results.json`（schema 4，`grill` 节）；原始探针产物在 `worker-reports/VERIFY-comet-050/evidence/grill/`。

## 结论一览

| # | 质询对象 | 最可能造假点 | 核实方法 | 结论 |
| --- | --- | --- | --- | --- |
| G1 | P3_2 三代理共识（R→V 首切片） | 共识票是宿主自写、无真实独立子进程 | ralph 状态机原件逐字段读；两轮票对照；line-level 交叉验证 | **UPHELD（可信）** |
| G2 | P2_4 官方编译器双构建字节相等 df916df6/ba88b84d | 指纹数字抄写而非真实产物 | 活盘 compile-manifest 直接读数 + 本轮 4 场景复跑交叉钉 | **UPHELD** |
| G3 | P4_4 Kp→归档→Kt 闭环 | "真实归档 exactly-once/束稳定"为静态字符串 | scenario-proof 逐 section 读；x2 独立复跑证据；401 原文 | **UPHELED（Kt 面如实 UNVERIFIED）** |
| G4 | I08 备份恢复演练 | backupId/摘要为编造 | 5 份 drill JSON 结构核对 + 负例真实性 | **UPHELD** |
| G5 | P4_8 撤权活测 | stdio delete 链路为 mock | 逐步 trace 时间戳/服务器原文拒绝串 | **UPHELD** |
| G6 | 全仓绿信号（1159/1159） | 环境污染掩盖真实红 | 本轮三度完整 check.sh + 根因修复 | **首轮证伪→根因修复后 UPHELD**（见 G6 详情） |

---

## G1 — P3_2 共识票是否真实独立

**挑的点**：三张 ballot 是否为单宿主伪造（同一文风、无进程级失败痕迹、修订前后 artifact 不变）。

核实（`pilot-journey/evidence/comet-050-run/consensus-r{1,2}/`）：

1. **进程退出码真实在案**：`consensus-r1/ralph-state.json` 的 `stop_reason` = `"dispatch command failed in round 1: exit 2; see …/logs/ralph-round-01.log"`——round 1 的派发命令以 exit 2 失败被如实记录，`status=BLOCKED`。伪造的共识不会记录一次失败的中间轮。
2. **r1 真分歧 + r2 修订后换绑**：r1 tally 中 codex-agent 带 1 条 blocking（`版本分支晚于完整参数解析…design.md:25 vs design.md:35-36`），裁决 DEBATE_REQUIRED；r2 的 `artifact_sha256` 从 `85e6835f…` **换为** `1eefc22a…`（修订后重打包），codex-agent 8.5 撤回 blocker，三票全 APPROVE。artifact 哈希变更与设计返工（argv 预扫描）一致。
3. **三票文风/视角真实异质**：claude-code 票自称直接读了试点项目副本并引用行号（"short-circuit sits immediately after strict parseArgs and before the mutual-exclusion (line 501)"）——该行号与现行 `tools/verify/delivery-journey.mjs` 的互斥检查（L501-502）吻合；zcode 票明确声明"artifact-only、未打开项目源码"；codex 票以中文引用 design.md 具体行对。三种视角边界互相排斥，不是同一作者的三份抄写。
4. **边界（如实）**：/tmp 试点世界已一次性销毁（P3_2 声明），日志原件（ralph-round-*.log）不可再读；本轮核实为**工件级**（冻结副本 + 结构矛盾检验），非世界重放。

**结论：UPHELD。** 未发现伪造迹象；失败轮留痕 + 哈希换绑 + 异质视角构成强真实性证据。

## G2 — P2_4 编译指纹是否真实

**挑的点**：`rebuild-determinism.txt` 里的 compositionHash/contentHash 可能只是转抄。

核实：

1. 活盘直读：`integrations/comet/application/internal/compile-manifest.json` 当前值为 `compositionHash df916df6784d1ac8…`、`contentHash ba88b84dc5c1bff2…`——与 P2_4-r3 证据及全链多处引用逐字一致。
2. 机制交叉钉：`test/classic-integration.test.js:515` 把 `classic-integration-probes/assembly-probes.json` 的 `environment.package.compositionHash` 与活盘 manifest 强等同；本轮 Phase-B 组件复跑 C01/C02/C03/C05（该套件 152 测）全绿——探针↔manifest↔产物三方绑定在本轮再次活体成立。
3. 边界：本轮未重放 206s 全量双构建（属 P1_1/P1_4 资格面）；指纹的"可重现性"由 P2_4-r3 的 rebuild-A/B 连续双跑记录 + 本轮活盘一致共同背书。

**结论：UPHELD。**

## G3 — P4_4 Kp→归档→Kt 闭环

**挑的点**：`ARCHIVE_OPENSPEC_115_ONCE` 与 `KP_BUNDLE_STABLE_POST_ARCHIVE` 可能是静态常量对常量。

核实（`worker-reports/P4_4-comet-050/evidence/`）：

1. `scenario-proof-knowledge-closeout.json` 的 section 均为 expected/actual 分立结构，且含**活体服务器观测**：MCP handshake 观测文本（"server LLM Wiki 1.27.0; 10 tools; kb - **kp-wiki**"）、SQLite 读回行版本（"documents row version 1; chunks 1"）、归档调用记录 `"observed": "archive demo --yes"`——这些是运行时输出，不是断言回显。
2. `GREEN-knowledge-closeout-stability-x2.txt` 为**两次独立执行**的 TAP 摘要（21/21 ×2）——束稳定性 369a32a8… 在两次运行中分别测得，非单次抄写。
3. Kt 面诚实：`KT_OUTLINE_REFUSED_401` 保留原始 401 body（`authentication_required`）且 `KT_GRANT_STATUS` 停 UNVERIFIED-NEEDS-GRANT——如果造假，最省事的是把 401 写成成功；它没有。

**结论：UPHELD。**（Kt Outline 授权面本身仍 UNVERIFIED，归 G-T2-01/G-T3-01，不影响本质询。）

## G4 — I08 备份恢复演练

**挑的点**：backupId/digestsVerified 可能从未对应真实字节。

核实（`worker-reports/I08-comet-050/host-drill-*.json`）：

1. drill-1 记录 6 文件/35647B、point-in-time 锚定 runtime-store checkpoint hash（db/objects 同 hash、consistent=true）、credentialRefs 只记引用不记值——结构上与"真实拷贝后逐文件摘要校验"一致。
2. 负例独立成档：drill-3（retention R10 DENIED）、drill-4（活写者在場拒恢复，`kill(0)` 真实进程检查）、drill-4b（第二工作区）各自留有拒绝细节——编造的演练通常只留正例。
3. `realRemoteBackup.status=UNVERIFIED` 带明确的 successor 指派——夸大面相反方向，诚实。

**结论：UPHELD**（本地目录形态；远端形态按声明 UNVERIFIED）。

## G5 — P4_8 撤权活测

**挑的点**：`llmwiki-delete-live-revocation.json` 的 create→read→search→delete→not-found 链可能是桩。

核实：

1. 逐步 trace 携带亚毫秒 `atMs` 与 epoch 时间戳（deletedAt 2026-10-27T04:23:49.800Z 与 segments 的 1793075029797 对齐）；delete 后 read="Document … not found"、search="No matches"——两个独立读回通道一致。
2. 保护路径拒绝串为服务器原文（"refusing to delete everything. Use a more specific path" / "Cannot delete /wiki/overview.md — these are structural wiki pages"）×3 变体——与 LLMWiki 1.27.0 真实行为一致，桩不会产出三段不同原文。
3. G15 三段计时逐段 measured（fault_exposure 0ms / alert 1.58ms / isolation 3.15ms），`alertIsNeverIsolation: true` 不变量在案。

**结论：UPHELD。**（Outline 撤权面三次真实 401 保持 UNVERIFIED-NEEDS-GRANT，归 G-T2-01。）

## G6 — 全仓绿信号本身（本轮自证伪→修复）

**挑的点**：P4_3 索引引用的"npm test 1159/1159 + check.sh exit 0"是否仍在当前树上成立。

核实结果（本轮三度完整执行）：

1. **首轮 check.sh exit 1（证伪）**：`test/comet-method-binding.test.js` 红——`.agents/skills/claude-parallel-tdd-planner/scripts/__pycache__/plan_guard.cpython-314.pyc`（Python 3.14 本地产物，gitignore 已覆盖、未跟踪）污染了 vendored 快照与打包副本的字节比对。处置：删除未跟踪字节码目录（恢复受保护源目录纯净），非放宽断言。修复后该套件 9/9。
2. **第二轮 check.sh exit 1（真实缺口，G-T1-01）**：`npm test` 1159 测 1158 绿——但 delivery-cases 面在同一钉版 node 下 3_2.mjs 6 红 / 3_3.mjs 4 红。**根因（本轮查明并修复）**：node≥24 把管道默认 test reporter 从 TAP 改为 spec，`run-role-chain.mjs`/`run-recovery-chain.mjs`/两处 `runFixtureTest` 以裸 `node --test` 派发后，`parseTapSummary` 找不到 `# tests N` 摘要行，`classifyRunOutcome` 全部 fail-closed 为 environment-failure（叶子收据 unverified/0 valid → 门 blocked）。修复=四处 spawn 显式钉 `--test-reporter=tap`（与 delivery-journey.mjs 既有惯例一致；oracle 语义零变更）。修复后 3_2 **13/13**、3_3 **11/11**（钉版 node v24.15.0 复核）。
3. **I06 瞬态**：第二轮全仓跑中 `infra-platform.test.js` 1 红（stub 请求 2120ms 超 2000ms 预算）——该套件本轮**隔离复跑 3 次全绿（49/49×3）**，与 I06 独立复审时登记的"1 次瞬态红不可复现"一致；定性为负载敏感瞬态，非行为红。
4. 末轮完整 check.sh 结果见 verification-report.md §全量检查（exit 0 后才算全绿成立）。

**结论：首轮证伪成立（索引引用的绿信号在当时树上已不成立）→ 两处根因修复 → 终态以本轮末次完整执行为准。**这正是"旧 PASS 不能填分母、每轮同版本真跑"纪律的价值。

---

## 质询边界声明

- 一次性 /tmp 试点世界（P3_2/P3_3/P2_4 派发、P4_4 归档）不可重放，属各 worker 声明的证据边界；本轮以冻结工件的结构矛盾检验 + 活盘交叉钉核实，未做世界重放。
- 二三档缺口（Outline 授权、CI 平台、远端读回等 12 项）不因本质询关闭——它们保持 UNVERIFIED 移交（见 verification-report.md 缺口终态）。
- 本报告不签署任何场景/旅程 PASS：场景级终态以 `verification-results.json` 的机器结果为准。

---

# FINAL-VERIFY 补充质询（2026-10-27 第二轮，G-T1-02 注册 + 双 FAIL 收敛）

- 承接：上一轮五组质询结论 **G1–G5 全部 UPHELD**、G6 首轮证伪→根因修复后 UPHELD（见上文，原始证据 `worker-reports/VERIFY-comet-050/evidence/grill/` 保持有效，本轮未重放其一次性世界）。
- 本轮方法不变：对本次终验中最可能被"抄近路转绿"的六个点，逐一用验收器机制 + 真实复跑核实。补充质询原始产物在 `worker-reports/FINAL-VERIFY/evidence/`。

## F1 — 分层注册（76 component / 27 host）是否在挑软柿子

**挑的点**：把"有测试点的场景"注册为 component、其余推给 host，是否是按结果挑分层（gaming the layer）。

核实：

1. 分层**不是手挑**：`register-denominators.mjs` 以钉版 node 对全部 case 模块的真实 TAP 快照为据，用验收器自己的词边界规则（`assertionIdMatches` 同实现）逐场景判定"注册模块内是否存在同名 ok 测试点"——存在即 component，不存在即 host；脚本与依据快照均在案，可复算。
2. 反证：若分层在挑软柿子，F01/F03（已知红）应被推去 host 藏红——实际它们注册为 **component 且把当前红点（1.15.0 依赖矩阵测试）以精确测试名钉进分母**，组件面如实 FAIL。
3. host 层不是垃圾桶：27 个 host 场景全部带 typed readback 槽，其 managed 拒绝已前进到真阻塞（protected-source-unavailable），组件面拒绝 `component-proof-cannot-satisfy-registered-layer` 是结构性的，不是判定失败。

**结论：UPHELD（分层由证据推导，含红场景在内未回避）。**

## F2 — component 场景不登记 readbacks 是否在削弱分母

**挑的点**：任务要求三字段齐全，76 个 component 场景只落两字段，是否故意少登记以降低门槛。

核实（验收器机制层面）：

1. `delivery-journey.mjs` L859-881：任何已登记 readback 都要绑定 case 定义中 **id-anchored 的 jsonFields/equals 动作**；组件面合成定义（`buildCaseDefinition`）的动作没有 id 且 expect 为 exitCode/nonEmptyFile——对 component 场景登记 readback 的唯一可能输出是全部组件执行被拒（`frozen-typed-readback-missing-or-weakened`），即摧毁 74 项真实 PASS 与 2 项真实红。
2. managed 面对 component 层注册在 L785 短路（`component` 不在 comet-runtime/host/platform/resource 之列）——component 场景的 readback 在任何平面上都不可达，登记是死重而非门槛。
3. host 场景（readback 唯一可求值路径所在）全部登记——真门槛没有少一道。

**结论：UPHELD（不登记是机制事实的诚实表达，登记反而是证据摧毁；readback 层作为 G-T1-02 残留显式移交，未被静默丢弃）。**

## F3 — L05 批内红改记 PASS 是否洗红

**挑的点**：组件面 L05 批内 8/9（J5 真实 SIGKILL 墙钟预算超限），复跑 9/9 后记 PASS——是否把不想看到的红抹掉。

核实：

1. 两次运行**全部留痕**：批内红在 `batch-results.json` 原行 + `load_transient_rerun` 注记（含失败测试全名、8/9 数字）；复跑证据独立成目录 `.whitebox/final-verify/component-rerun/L05/`（验收器自含 command/argv/TAP/verdict）。
2. 三角复核：模块单跑 `node --test test/delivery-cases/4_8.mjs` 9/9 绿（两次独立确认）；批内红的机理（真实 SIGKILL 墙钟窗口）与 r1 已登记的 I06 2120ms>2000ms 负载瞬态同类，且批内该模块其余 8 项全绿。
3. 未做任何断言/预算修改；若复跑仍红将如实保留 FAIL。

**结论：UPHELD（瞬态定性有独立复算依据，红运行未销毁）。**

## F4 — V_RW_COMPLETION_REQUIRED 的"定点 PASS"是否自证

**挑的点**：索引先按预期投影（V_RW 记 PASS），再跑命令取证——数字是否在给自己发证。

核实：

1. 出货判据是**对已出货工件的实跑**：`direct-rerun-vrw-final.log` 为对最终 `acceptance-index.json` 执行完全相同注册命令的原始 TAP（12/12，exit 0）；若命令红则整组 artifacts 退回重建（该分支未触发）。
2. 交叉仪器约束：同一索引同时被 **5_1.a-4（16/16）**与 **5_3 J4（16/16）**复验——summary/blocking/environment_gates 三处同源数字由三个独立 owner 的仪器同时咬合；单改一处即红（本轮开发中实测：层词汇与 env-gates 两度被 5_1/5_3 咬红后修正）。
3. 断言方向核对：4_3 的 12 断言无一是放宽（open_p1 断言从">0"改为"===0"是把世界真值钉死，而非解除）。

**结论：UPHELD（定点自洽以实跑闭环，且被两台外部仪器交叉咬合）。**

## F5 — 9 个绑定调和是否在证据搬运

**挑的点**：把 9 个场景改绑到"恰好有同名测试点"的模块，是否等于把分母搬到绿测试上。

核实：

1. 每条 rebind 都以**新模块内真实执行的 ok 测试点全名**为据（`registration-summary.json` + TAP 快照逐名在案；如 B01→3_2 的 `V_B01: a plan-only request…`、C07→1_5 的 `C07/e: …`）——不是找绿套间，是找"以该场景为名执行过的测试点"。
2. P1-04 纪律不变：调和不产生 PASS，只产生"分母可被真实执行"；终局 verdict 仍由验收器 spawn 真模块 + 类型化 TAP 读回判定。
3. 方向性反例：E06/L11 的调和动机是**计划↔冻结配方的模块冲突**（配方本就绑 3_2/3_3）——调和后三旅程组件面 1/3→3/3，是消除注册矛盾，不是制造绿。

**结论：UPHELD（每条调和可独立复核，未发现无点绑定或绿套间搬运）。**

## F6 — 本轮执行器与终跑事故是否如实处置

**挑的点**：批内 Phase D 20 条全 exit 1（执行器 bug：nodeBin 前缀 argv）与终跑 r1 exit 1（I06 瞬态）是否被掩盖或美化。

核实：

1. Phase D 首跑 20×exit1 **未删除**：在 `batch-results.json` 中移入 `D_direct_voided_executor_bug` 并附机理注记（与 r1 同类 bug 的处置先例一致）；真实结果来自修正执行器后的 `direct-rerun.json`（21/21）。
2. 终跑 r1 exit 1 的红测试全名（I06 producer source correlation refuses missing-run-status，2073ms>2000ms）在 `check-sh-final.log` 原文在案；隔离复跑 2×49/49 绿后 r2 **exit 0（1159/1159）**——两次完整日志都保留，未只留绿的那次。

**结论：UPHELD（事故原文保全、复跑依据独立、结论以末次完整执行为准）。**

---

## FINAL-VERIFY 质询总结

上一轮 5/5 UPHELD（G6 证伪后修复 UPHELD）全部承接；本轮补充质询 F1–F6 全部 **UPHELD**，其中 F4/F6 的价值来自"先假设自己在造假"的复核路径。二三档 12 项缺口不因质询关闭，保持 UNVERIFIED/NOT-EXERCISED 移交。
