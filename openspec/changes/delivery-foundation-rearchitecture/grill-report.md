# Grill 记录 — 2026-10-30 交付候选（独立质询）

> 本记录按 grill 纪律收录本次交付中真实发生过的质疑与裁决。每条：挑战 → 证据 → 裁决。未解决的开放攻击面单列末尾，供下一次独立 Grill 优先攻击。

## 已裁决的挑战

1. **"不能用 hash 方式安装吧？"（用户挑战，成立并采纳）**
   挑战：安装被 `INVALID_WORKFLOW: Skill 内容发生漂移` 拒绝后，最省事的"修复"是把清单哈希改成漂移后的内容。
   证据：diff 证明源目录含 14 个 Git 受管 fixture（`git ls-files` 计数=14），包副本缺它们——是打包被 gitignore 吞掉，不是内容该改。
   裁决：拒绝改 hash；走官方编译器重建（manifest 与包同源产出哈希自洽）+ `.gitignore` 豁免根因修复。提交历史可见 14 个文件首次真正入库（`7d8272d`）。

2. **摘要口径：原始字节 vs checkbox 归一化（自我质疑）**
   挑战：接管核验时 `tasks.md` 原始 sha256 ≠ drift-lock 的 `plan_sha256`，疑似计划漂移。
   证据：`plan_guard.py` 的 `hash_mode: checkbox-normalized-v1`——勾选状态不参与哈希；全包校验 `valid:true, handoff_ready:true`。
   裁决：无内容漂移；首次对比是口径错误，记台账澄清（`PLAN_BUNDLE_GUARD_REVERIFIED`）。教训：对锁校验必须用锁自己的归一化器。

3. **审查者身份可调包（RED 抓出的真漏洞）**
   挑战：`verifyDomainAutomation` 的 RED 测试中，独立审查回合只验证 `turn.ok`，未验证回合线程 === 绑定声明线程——一个被替换的回合可以给冒名的绑定背书。
   证据：selfReview 探针返回 ok:true（应拒绝）。
   裁决：`verifyDomainAutomation` 与 `verifyReview` 两处同修（`turn.childThreadId !== binding.childThreadId → continue/refuse`），并补"绑定本身冒名作者"的第二层探针。

4. **promotion 信任边界（实现前质询）**
   挑战：gate.js 的 `verifyDomainAutomation` 契约若接受外部提交的 promotion 对象，worker 即可自证。
   证据：协议测试第 320 行旧断言"宿主晋级保持关闭"；bindings 从不转发该通道。
   裁决：实现为**全部字段自行推导**（源重算/记录佐证/同 Run T 动作），端口从不接受调用方对象；worker 选项仍到不了门（协议测试 336-338 保持）；显式端口转发语义更新并在测试消息中指明真实闭合位于 provider。

5. **v9 从哪来：git 副本不可用（升级评估 RED）**
   挑战：升级评估需要旧 v9 包，`git archive dfa4a75` 取出的包同样被真实安装器拒绝。
   证据：git 里的 v9 也是 gitignore 受害者；注册表 `versions/d3ea…` 才是旧 Run 的真实固定包。
   裁决：评估改用注册表只读副本（缺席则 skip 保持可移植）；这同时实证了"旧 Run 绑定原包"的现实基础。

6. **导出摘要 vs 提交快照的先后（historical mismatch）**
   挑战：Foundation 重锁后 test 35/55 报 `complete export digest (historical mismatch)`。
   证据：exportDigest 取自工作树，`release.commit` 指向的提交内容与之不同——延续文档"先确定最终真实 Git 提交/可复现快照，再重建锁"正是在说这个顺序。
   裁决：提交源候选 C=`0ad4ff4` → 干净树重导出（commit=C）→ 再提交产物。漂移门 `drifts:0`。

7. **手改 release 副本的方向性（逐项审查义务）**
   挑战：再生成会覆盖 release 里的手改内容——是否丢真修复？
   证据：三方 diff 显示手改副本是陈旧的 2.5.0，唯一源是更完整的 2.6.0（逐 Case 溯源、自检/独立验收区分、主控归属）。
   裁决：按唯一源再生成，无需回迁。

8. **`current_asset_commit 60a75c5 ≠ HEAD` 与顶层 PENDING**
   挑战：接管时状态机资产指针落后于 HEAD，是否应先"修状态"？
   裁决：PENDING 的实体是"已装应用版本落后于源"，状态字段不撒谎也不提前翻——六步④完成 v10 + 锁重建后随交付提交如实更新，全程未伪造提交消漂移。

## 开放攻击面（下次独立 Grill 优先）

- **自检 locator 契约未经真实记录检验**：`evidenceRefs[0].ref` 的 claimedTest locator 形状是本会话定义的契约，组件测试用注入读取器验证逻辑；真实 Codex 会话记录上的首个样本可能迫使契约修订（已在此声明预期）。
- **T 门深层负向不可达**：真实旅程停在 R（无真实合格来源），T/V 的"跨 Run 旧 T 动作"等负向只有组件级覆盖。
- **单机证据**：所有真实 SDK 证据出自本机；跨机器复现（含 node 版本矩阵）未行使。
- **Foundation 封存被沙箱阻塞**：test 55 红是环境限制而非代码缺陷；操作者一条命令后应 72/72——若仍红，则是真问题。
