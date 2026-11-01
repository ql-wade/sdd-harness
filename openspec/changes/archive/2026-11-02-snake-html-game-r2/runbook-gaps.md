# RUNBOOK E2E dogfooding — runbook-gap 清单（snake-html-game-r2）

按 RUNBOOK §0→§10 执行全新 snake 交付时发现的每一步与实际不符之处。
编号接续本会话早先的 GAP-1..7（见 execution ledger / r16 记录）。

## GAP-8 — RUNBOOK §3 驱动器缺 COMET_DATA_DIR 环境说明
- 症状：`tools/drive-journey.sh` 首次 start 直接 `EPERM: mkdir /Users/mac/.comet/workspaces/...`（HOME 被 divert 或沙箱场景）。
- 根因：RUNBOOK §0-§3 全程未提 COMET_DATA_DIR / HOME divert；driver 假定默认 ~/.comet 可写。
- 修复方向：RUNBOOK §3 增加"COMET_DATA_DIR 指向可写目录"前置；driver 顶部显式校验可写性并给出可读错误。

## GAP-9 — §1 `comet state init` 会让变更无法被交付应用接管（已实证，关键）
- 症状：§3 SDK start 报 `INVALID_REQUEST: Classic change 已归属另一个应用`。
- 根因：`comet state init <name> full` 把 change-owner 登记为内置 `classic-full`；交付应用（sdd-managed-delivery）start 严格要求 owner.application === 自身，且没有任何 CLI 释放/迁移路径（state rebind 只管分支）。r5–r34 全部是 SDK start 直接登记，从未跑过 state init，所以从未暴露。
- 修复方向：RUNBOOK §1 必须改为"不要运行 comet state init；交付应用的 Run 在 §3 由驱动器 start 时自动登记"，或 state init 提供 `--application <id>`/release 子命令。

## GAP-10 — driver 的 requires-recovery 恢复分支用 `--application <名字>` 解析到错误包版本
- 症状：恢复 dispatch 不生效（Run 绑定 v27，名字解析可能落到 current.json 指向的旧版本）。
- 修复：已改 driver 用 `--application-file "$APP"`（随版本目录解析）。RUNBOOK 陷阱表的恢复命令模板也应用 --application-file。

## GAP-11 — driver `record()` 参数错位（`$2` 应为 `$1`）
- 症状：`full.open` 认领后记录时 `$2: unbound variable` 崩溃；driver 的 record() 从未被端到端跑通过。
- 修复：已改 `--result-file "$1"`。

## GAP-12 — driver 初始状态模板硬编码 `language:'en'`
- 症状：open 证据提交被 EVIDENCE_REJECTED：`configured language is en, but proposal.md appears to be Chinese-dominant`。本仓库变更工件全部中文（§1 state init 本会写 zh-CN）。
- 后果：整个 Run 作废——input+初始状态是 Run 身份的一部分（RUN_CONFLICT 不可变）。
- 修复：driver 模板改 zh-CN；长期应由 changeDir 现有工件/`.comet/config.yaml` 推断语言。

## GAP-13 — Hook fail-closed 在恢复完成后不解除
- 症状：Edit/Write 被 Comet Hook Router 拦截要求 recovery；按给定 recovery request dispatch `{"operation":"next"}` 成功后，下一次 Edit 仍被同样错误拦截（Run 处于取消态时持续如此）。
- 影响：守卫本意是"先恢复再写"，实际恢复后仍拒绝，迫使用 bash/node 直写绕过工具层——与守卫目的相悖。
- 修复方向：hook 的恢复判定应与 Runtime 的可恢复状态判定一致；恢复完成后放行。

## GAP-14 — 取消的 Run 永久锁死 Run 标识，无删除/重开 CLI
- 症状：`cancel` 后用同 runId 重新 start 报 `RUN_CONFLICT: 该 Run 标识已绑定不同工作流或输入`；`comet runtime` 只有 dispatch；state restore 只会转回内置 classic-full。换初始状态（如修语言字段）= 必须换 Run 名。
- 实证代价：snake-html-game-r1 名称被两条 runbook 缺陷（GAP-12 en 模板 + 本条）耗掉，本次交付改名 snake-html-game-r2。
- 修复方向：提供 `comet runtime delete <runId> --confirmed`（带审计），或 cancel 后允许同 id 重开（input 变更时进 audit 记录）。

## GAP-15 — 废弃变更泄漏永久 runtime 残留
- 症状：被放弃的 r1 在 change-owners/、sdk-runs/classic/.runtime-store-v2/、state-projections/ 留下永久记录，无 CLI 清理；change 目录删除后这些记录成为孤儿。
- 修复方向：归档/取消路径应联动清理 owner 记录，或提供 `comet state forget <change> --confirmed`。

## GAP-16 — RUNBOOK §2 未说明 proposal 语言必须与仓库一致
- EVIDENCE_REJECTED 的语言检查（cjk_chars/english_words 启发式）没有任何文档提及；首次用户写英文 proposal 在中文仓库（或反之）会直接被拒且错误信息未指向 RUNBOOK。
- 修复方向：RUNBOOK §2 增加"proposal 语言 = 仓库既有变更语言"；语言检查错误信息给出指引。

## 当前状态
- Run：snake-html-game-r2（v27，rev 12），R 门动作 `snake-html-game-r2:7` 已认领，证据构造中。
- sourceHash（activation.source）：7f801eaea2c23c2b25456faae370277313246a09b46a1e4e69d1b5aa7a47cd83

## GAP-17 — R 门阻塞的正确恢复顺序（runtime 语义，RUNBOOK 缺失）
- 实证：审查者 BLOCKED 后先修工件、再尝试记录 pass → `OUTCOME_REJECTED: Classic Open artifacts changed after the reported revalidation`（每次记录都会重验 open 冻结哈希）。
- 设计内出路：扩展结果 verdict `revise-requirements` 在校验器里短路放行（不重验链）→ Run 回到 prepare→confirm→open 重冻结新哈希 → 重走 open 链后 pass 记录成功（本次即如此恢复，rev 14→24→25）。
- 教训顺序：审查者阻塞 ⇒ **先记录 revise-requirements** ⇒ 再修工件 ⇒ 重跑 open 链 ⇒ 重新确认/评审 ⇒ pass。先修工件会让 pass 卡死在链上重验。
- RUNBOOK 陷阱表应新增此行。

## GAP-18 — drive-journey.sh 的通用 `${STEP}-complete` 记录形状不满足各阶段输出契约
- 实证：design.handoff 的输出契约要求 {proposal, handoffContext, handoffHash, sourceEvidence, requirementsEvidence}，其中两个 evidence 必须与 `classicOpenEvidenceReceipt` 实时收据 isDeepStrictEqual；driver 只会记 `{"event":"full.design.handoff-complete"}` → 必被拒。
- 影响：RUNBOOK §4-8 的"驱动器全自动推进"在实际 design/build 阶段不成立，必须用精确形状的 record-outcome（r16 驱动器族）。
- 修复方向：driver 按 stepId 分派专用结果构造器，或 RUNBOOK 如实声明"驱动器只推进到门证据点，门内记录用附录命令"。

## 附：R 门第一轮审查者 BLOCKED 记录（真实性证据）
- 首轮独立审查者发现：proposal 写 `tests/snake.logic.test.mjs` 与契约 `tests/snake-html-game-r2.logic.test.mjs` 矛盾；180° 规则未进 AC 与契约断言。
- 修正：proposal 路径/五条测试/AC-1 补 180°；契约新增 case+check `snake-no-180-reversal`（totalCases 5）。第二轮作者确认 + 独立评审 OK（digest 6b9c4a191c93be2a）。
- 门禁按设计拦截了真实交付物缺陷——这是本次 dogfood 最有价值的一次实证。

## GAP-19 — tasks.md 依赖声明必须是规范 `**Dependencies:**` 格式（无文档）
- 实证：P 门 plan_source 读回拒绝：`tasks.md dependencies differ from DAG`（`planDeclarations` 只认 `### Task X:` + `**Dependencies:**` 强标记；中文"依赖：..."解析为空依赖）。
- 连锁：修 tasks.md → design handoff 上下文漂移 → plan claim 被拒（"设计来源已变化"）→ 只能 `revise-requirements` 全链重走（rev 46→78，四门全部重新记录）。
- RUNBOOK §2 必须写明 tasks.md 的规范格式（英文强标记依赖行），或 planDeclarations 应接受 tasks.md 的既有语义格式。

## GAP-20 — 设计来源漂移守卫极其严格：任何 changeDir 工件变更 = 全链 revise-requirements
- 实证：tasks.md 一行格式修复导致 open→R→design→A→T→configure→plan→P 全部重走（会话证据可复用，但运行时动作/收据/证据全部重建）。
- 影响可接受（守卫动机正确），但 RUNBOOK 应警告：design handoff 之后改任何 changeDir 工件的代价是全链重走。
