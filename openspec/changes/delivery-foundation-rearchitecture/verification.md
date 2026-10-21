# 四层验证与验收索引（B10）

任务：P4_3 — 四层证据分别归档索引，确认目标环境后才声明 delivered；代码验收、规格归档、部署状态分开。
时间：2026-10-21。工作树：`impl/p4-3-acceptance-index`（基 `master@a834f93`）。
本文取代 Batch 0 时期的同名文件（其内容为实施前的规范迁移记录，原样保存于提交 `6510e3a`）。

语义唯一来源：`specs/delivery-foundation/spec.md`（92 个场景）。机械索引：`acceptance-index.json`（本目录，由 `test/delivery-cases/4_3.mjs` 强制对账：场景零缺漏、证据指针可解析、门控项必有承接者、枚举自洽）。

## delivered 判定与目标环境确认分离

本文件与索引**只登记证据状态**（VERIFIED / ENVIRONMENT_GATED / UNVERIFIED），不据此单独声明"已在目标环境交付"。三项分开：

1. **代码验收**：机制在本仓库的真实 RED→GREEN 证据与回归（下述四层）。
2. **规格归档**：OpenSpec closeout 由规格链自行判定（B08 漂移防护在位）。
3. **部署状态**：真实平台注册、生产提升、第二物理宿主等目标环境事实，由各 ENVIRONMENT_GATED 项登记的 holder 在对应门解除后回填；在此之前这些项**不是 PASS**。

汇总：92 场景 = 76 VERIFIED + 15 ENVIRONMENT_GATED + 1 UNVERIFIED（F10，跨机器 Control API 未启用、`5_2.mjs` 未建设）。

## 内核层（单测/契约，node --test 各套件）

**结论**：44 项（37 VERIFIED / 7 ENVIRONMENT_GATED）。contracts/delivery、lib/delivery、EvidenceEnvelope/GateReceipt、runtime 状态恢复、共识机械 tally、Knowledge.Closeout.v1 / KnowledgeAuthz.v1 / KnowledgeRevocation.v1 引擎的拒绝与恢复语义均有真实 RED/GREEN 与当前回归。

**证据**：
- `npm test`（本 worktree，Node v22.13.1）：412 pass / 2 fail / 1 skip；2 个失败均为已知环境项（C08、B08，见下），零新增。
- 各任务 RED/GREEN 与覆盖矩阵：`worker-reports/P2_1|P2_2|P2_3|P2_5|P3_3|P4_4|P4_6|P4_7|P4_8.json` 及其 `evidence/` 目录；逐场景指针见 `acceptance-index.json`。
- 覆盖旅程当前复跑：`2_1/2_2/2_3/2_4/2_5/3_3/4_4/4_6/4_7/4_8/i08` 全绿。

**已知缺口与承接者**：
- H04/H05（真实 Outline API 实测）→ I03 Outline 独立资料域部署。
- H09（第二物理宿主 + authority 对抗性防伪造）→ P5_1/跨机范围裁决。
- L02/L04（资源端真实渠道隔离）→ I03 部署后实测。
- L09（90s/120s/5min 真实墙钟）→ I07 监控真实部署。
- U08（真实 Outline 写入 + 独立读回 + 同 Run 接纳）→ 真实试点登记 + 受保护签发工作流。
- E01/E02/E06 的真实 LLMWiki MCP 写入与 Outline API 写回为已登记残留（机制已验证）→ I04/I03。
- A10/A11/A12 只承诺已验证单环境语义；跨机分布式互斥 → 未来分布式 runner 契约任务。

## CLI/装配层（tools/ 各 CLI validate/probe 入口 + 装配产物）

**结论**：5 项（3 VERIFIED / 2 ENVIRONMENT_GATED）。固定产物完整性（F01）、Spec Adapter 归档恢复（A11）、adapter 退出码契约与 CodeGraph 停用正确性（A20）已验证；B08/C08 机制证据在位但被宿主 openspec 漂移阻断钉定复跑。

**证据**：
- `worker-reports/P1_1|P1_5|P2_3|P3_4.json` + `evidence/`（green/RED 日志、隔离工具环境记录）。
- 旅程复跑：`1_1`（8/8，V_COMET_NATIVE prepared-build skip 为已登记既有项）、`3_4` 的 A11 两例绿。
- B08 负例在 P3_4 提交（`d7438e4`）验证；C08 机制在 P1_5 隔离工具环境验证且 `1_5` 旅程 6/6 绿。

**已知缺口与承接者**：
- B08、C08 复跑被宿主全局 openspec 1.3.1→1.14.3 漂移阻断（open decision `HOST_OPENSPEC_DRIFT`，owner: user）→ 重钉 toolchain-baseline 或显式重冻结后复跑 `test/spec-closeout.test.js`、`test/classic-integration.test.js` 与 `3_4.mjs`。

## 宿主层（hook/adapter 装配：hook-doctor、settings 生成、宿主渠道探针）

**结论**：12 项全部 VERIFIED。真实编辑/Shell/MCP 渠道探针（A09/F05/F07）、exporter/FoundationLock 正反序装配与回退（F02/F04）、第二写者拒绝（B09）、Matt 方法快照无嵌套 controller（B01/M01/M02）、hook 不越权（E05/H02）。

**证据**：
- `worker-reports/P1_2|P1_3|P1_6|P4_5|P4_6.json` + `evidence/`（渠道探针、comet init 无 Superpowers、lifecycle-hook GREEN）。
- 旅程复跑：`1_2`（7/7）、`1_6`（6/6）、`4_5`（5/5）。

**已知缺口与承接者**：
- `1_3`/`1_4` 旅程须在 `.sdd` 装备工作树复跑（`impl-p1-3` 在位）；本全新 worktree 缺 prepared comet build 为已知环境条件，非机制缺口。
- E05/E06 活体宿主运行（真实 Claude Code 会话 hook 触发）→ 宿主验证 wave；工具侧已以 `liveRun=UNVERIFIED` 字段分离。
- 主检出 adapter-quoting 2 例沙箱 EPERM（denyWithinAllow）→ 集成回归在 worktree 运行（65/65 已验证于 `64841ef`）。
- 宿主插件缓存 superpowers 残留 → 宿主 owner 清理决定（未触碰）。

## 业务/CI 层（delivery-cases 回归 + scripts/check.sh + 真实平台记录）

**结论**：31 项（24 VERIFIED / 6 ENVIRONMENT_GATED / 1 UNVERIFIED）。R/A/T 分离返工回路（B02–B07）、七受管入口同规则（C07）、D 族回执失效重算、试点冻结与读回（A15）、精确 SHA 重算契约（A13）已验证；A14/A16/A17/F06/F09 的生产/平台侧与 F08 正相浏览器验收为环境门；F10 未建设。

**证据**：
- 旅程复跑（本 worktree）：`1_5`（6/6）、`2_4`（10/10）、`3_1`（13/13）、`3_2`（10/10）、`4_1`（6/6）、`4_2`（6/6）。全矩阵：23 个 delivery-case 模块中 19 个全绿，`1_3`/`1_4` 需 `.sdd` 装备、`3_4` 仅 B08 两例被 openspec 漂移阻断（明细 `worker-reports/P4_3/evidence/journey-rerun.txt`）。
- `worker-reports/P1_5|P2_4|P3_1|P3_2|P4_1|P4_2.json`：A14/A16/A17 同 digest 锁定/漂移拒绝/关联查询/批准回滚在隔离 Registry/环境全验证，回执 `mode=LOCAL_ONLY` 如实分离。
- `bash scripts/check.sh` 本 worktree 实跑记录：`worker-reports/P4_3/evidence/check-sh-run.txt`（whitebox 夹具缺口为 base 起 pre-existing，如实记录）。

**已知缺口与承接者**：
- A14/A16/A17 → 环境 owner + 运行时准入（真实 Registry endpoint/隔离环境登记）。
- F06/F09 → 平台准入 owner（真实注册 delivery-gate required check + secrets + GitHub runner 端到端；含 delivery-gate.yml node24/22 对齐移交项）。
- F08 → 具备原生浏览器能力的试点环境（UI 试点任务）。
- F10 → P5_2 owner + 用户跨机器范围裁决（`CROSS_MACHINE_SCOPE_NOT_ENABLED`；不能以未启用判通过）。
- 2 个既有 skip（`1_1` V_COMET_NATIVE prepared-build、C08 isolated openspec 1.11.0）→ P1 系列/接收控制器（重钉或显式重冻结）。

## 已知环境性失败集合（与索引一致，UNVERIFIED 不转 PASS）

| 项 | 现象 | 承接者 |
| --- | --- | --- |
| C08 / B08 | 宿主全局 openspec 1.3.1→1.14.3 漂移，fail-closed 阻断钉定复跑 | user（HOST_OPENSPEC_DRIFT 重钉/重冻结） |
| adapter×2 | 主检出沙箱 denyWithinAllow 阻写 settings；worktree 内通过 | 集成回归固定在 worktree 运行 |
| llmwiki venv ENOENT | 会话 worktree `.mcp.json` 指向缺失副本（会话工件，非宿主缺陷；lock 完整性已更正确认） | 会话环境修复；活体 venv MCP 通道归 P4_8 残留 |
| comet 装备 | `1_3`/`1_4`（及 1_5/1_6 setup 变体）需 `.sdd` prepared build | `.sdd` 装备工作树（impl-p1-3 在位） |
| check.sh whitebox 夹具 | 全新 worktree 夹具缺口，base 起 pre-existing | 在主检出运行或修复夹具 |
| I01/I02/I03/I05 Step 3、P1_6 Step 5 | 真实资源登记/准入环境门 | 见 execution-state.json 登记 |
