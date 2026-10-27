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
