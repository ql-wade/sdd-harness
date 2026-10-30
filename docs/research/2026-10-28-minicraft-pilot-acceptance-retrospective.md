# Minicraft 试点验收复盘（2026-10-28）

> 性质：sdd-managed-delivery 六门受管闭环的首次真实业务交付试点之验收总结。
> 试点 Run：`minicraft-html-game-r3`（前身为 r1/r2，见"五次重启"）；交付提交 `aafb3d2a`（master，local）。
> 结论一句话：**交付物按"冻结记录基线"达标（14/14 实测通过），但流程与架构承诺显著未达预期 —— 闭环只在人工修补下勉强走通，暴露 6 条 scaffold/组合层缺陷。**

---

## 0. 事实底座（可复核证据链）

| 工件 | 位置 |
| --- | --- |
| 交付物 | `demos/minicraft/index.html`（8.7KB 单文件，零外链） |
| 归档 change | `openspec/changes/archive/2026-10-28-minicraft-html-game-r3/` |
| 六门 receipt-bundle | `.sdd/delivery/gates/{r,a,t,p,v,kp}/receipt-bundle.json`（本地，gitignore） |
| 三方评审原始记录 | `.sdd/delivery/gates/a/review-runs/gate-a-{r3,r4,r5}/`（r1/r2 为机械中断审计痕迹） |
| TestPack 与视图 | `.sdd/delivery/gates/t/test-pack.json`（PACK_STRUCTURE_VALID）+ `test-pack.view.md` |
| 浏览器验收证据 | `.sdd/delivery/gates/v/acceptance/results.json`（14/14 PASS）+ 3 张哈希截图 |
| 检查执行记录 | `~/.comet/workspaces/<hash>/runtime/classic-sdk-checks/ff0b99da…/`（exit 0，快照前后一致） |
| 验证报告 | `docs/superpowers/reports/minicraft-html-game-r3-verification.md`（目录被 gitignore，已 `add -f` 入提交） |
| 项目知识 | 2 条入库（`managed-start-minicraft`、`memo-95752ff8`） |

---

## 1. 交付物层面：未达预期

1. **需求收敛被双轨覆盖（最重要）**。本窗口 grill 采访逐题获得用户批准的 D1–D7（天空层+草皮地表+双木柱地形、DPR 感知、`window.__minicraft` 白盒口、mouse 事件、键名 `minicraft.grid.v1`）**未成为交付设计**；落地的是并行窗口自答版本（400 格全满无空气、放置前必须先挖、pointer 事件、无白盒口、键名 `minicraft-grid-v1`）。门 V 的 14/14 是**对记录基线**的通过；用户"继续往下"的拍板实际上静默合并了两套口径。
2. **语言策略违背**。用户已将仓库语言切 zh-CN 并明令"所有产物一律使用中文"；实际 design.md、验证报告、TestPack、门证据全为英文，执行侧以 run 状态语言=en 自行豁免。
3. **单浏览器**。仅 Chromium（Playwright，file://）验收；Firefox 对 file:// 禁用 localStorage → 游戏将**静默不持久化**，未验证也未在交付物内向用户告知。
4. **无常驻回归资产**。TestPack 停留在 design_only；14 用例由验证者一次性执行，没有任何自动化测试随提交入库。
5. **白盒口缺席**。验收实际依赖像素采样 + localStorage 直读（可行但成本高、脆弱于视觉变更）。

## 2. 流程层面：未达预期

| 指标 | 实测 | 架构预期 |
| --- | --- | --- |
| Run 数 / change 身份 | 3 个 run（r1 取消、r2 作废、r3 完成）、5 次重启 | 一次 start 全程闭环 |
| 全回环次数 | 3 次 revise（handoff 时序 / repair 死路 / plan 目录） | 0 |
| 三方评审轮次 | 3 轮（r3/r4/r5），实质差异仅 frontmatter 一行 | 评审成本与变更内容相称 |
| 墙钟成本 | ~5 小时 / 需求（含两次并发事故恢复） | 命令优先收敛后的低成本 |
| 用户确认 | 后半程多次以"既定授权"代答（decision-id 有记录） | ask_user 逐次实时把关 |

过程事件：双会话并发驱动同一 Run（靠 REVISION_CONFLICT 碰撞暴露，Runtime 无多宿主防护）；大量手工通道（dist 内部函数直写 handoff 包、脚本通道写门证据、claim/record 全链手工驱动）；`__pycache__` 两次污染技能哈希中断推进。

## 3. 架构/scaffold 层：6 条实测缺陷（已登记待修）

1. **managed start 五要素契约缺口**：初始 state 须预绑定 `isolation`；run input 须带 `checkCommands.build/verify` 字面 argv；计划文件必须位于 `docs/superpowers/plans/` 顶层；design.md frontmatter `comet_change` 必须等于 change 名且在 handoff 包生成前定稿；handoff 包必须在设计终稿后生成。init-comet.sh 未对齐上游 `comet state init`/`propose-*`/`complete-*` 命令族的副作用 —— ADR-0022 只替换了技能层，未复刻命令族语义。
2. **repair-composition 死路**：从 build 相位回 `full.build.plan` 丢失 composition.confirm 授权上下文（STALE_PROPOSAL）；唯一恢复是 revise 全回环。组合的 repair 路由从未被端到端验证。
3. **handoff 包刷新缺口**：设计证据校验允许 design.md 变化（allowDesignDocumentChanges），构建入口守卫不允许 —— 两段守卫语义不接续，受管流程缺少"设计定稿后刷新包"的落点。
4. **编译包 `__pycache__` 污染**：包内 python 技能执行即改变内容哈希 → "Skill 内容发生漂移"拒绝。需 PYTHONDONTWRITEBYTECODE + 脚本目录只读化，应由编译器保证而非留给宿主。
5. **交付输入校验 × 仓库现实冲突（本试点最终卡点）**：check-policy 作用域 = 交付提交范围（清单 ∩ 脏文件，实时求值且要求"当前内容==验证内容==已提交内容"三元一致）。CLAUDE.md 软链迫使显式 policy；policy 宽绑则并行会话全部脏文件进入"已验证实现"，交付锁死且 stash 不可解。需要：policy 默认收敛到 change 范围 + 交付校验对"验证后合理收尾"的路径定义。
6. **评审副作用泄漏**：zcode 只读评审在 change 目录残留 `.v2c/`、`.video_agent/`（不影响工件哈希，但污染归档）。

## 4. 对照架构承诺的结论（ADR-0019/0020/0021/0022）

**得到验证**：
- SDK Run 作为进度/批准/恢复的唯一事实源 —— 内容寻址检查点、防篡改哈希链、证据可复核性全部成立；
- 门 A 具备真实捕获力（第一轮即抓出 D5 加载校验与回退承诺的矛盾，经辩论定级后落地为 TC-09 并被浏览器实测证实）；
- 门 V 具备真实验收力（14/14 独立 oracle 实测，含 5 种篡改存储全量回退）；
- 上游 fail-closed 姿态一致（所有拒绝均可定位到明确契约条款，无静默放行）。

**未达到**：
- **低成本可复走的闭环**：实测 ~5 小时/需求、5 run、3 评审轮、3 全回环 —— ADR-0021"命令优先收敛"要解决的执行成本问题实测确认尚未发生；
- **并行安全**：多宿主并发无防护；
- **确认门完整性**：重放压力下 ask_user 语义被稀释；
- **持续回归价值**：六门只产生一次性验收证据，未沉淀 CI 资产。

## 5. 遗留悬挂事项（截至本文档撰写）

1. **deliver 正式回报未落账**：交付提交 `aafb3d2a` 已在 master（游戏+归档+计划+报告），但 Run 停在 `full.archive.deliver` 重试态 —— 待 A'（并行 WIP 独立提交后 re-record）或 C（停车，随缺陷修复后收口）二选一。
2. **stash 未恢复**：并行窗口 9 个文件（AGENTS.md、bin/comet、scripts/init-comet.sh、3 份研究文档、2 个测试文件）在 stash（`parallel-session WIP parked during minicraft r3 delivery`），结束前必须 pop 或明确处置。
3. 僵尸目录清理：`openspec/changes/minicraft-html-game{,-r2}/`（取消/作废 run 的本体）待归档或删除决策。
4. 缺陷 1–6 的修复应进入 `delivery-foundation-rearchitecture` 任务清单（本文档为验收输入）。

---

*复盘人：验收会话（Claude Code，2026-10-28）；执行与证据全程记录于上述位置，可独立复核。*
