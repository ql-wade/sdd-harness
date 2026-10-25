# Root 0003 上下文 rebase 独立审查

结论：**PASS，无 P 级阻断。** 派生0003仅替换一处旧日期hunk的匹配上下文/定位并按八目标重算index；全部程序增删行、目标路径和顺序不变。此结论只支持后续Root受控重绑定/重建，不接纳全部新0002语义、Core74、production或whole交付。

## 精确输入

主证据目录：`/Users/mac/Code/sdd-harness/worker-reports/Root-post-archive-context-rebase/`。已读REPORT、原/派生patch、rebase-proof、direct-input-manifest及全部八份before/after；源码和锁均只读。

- 原0003 SHA256：`b266706c207ae09db17e4a2e005dd42e785d99d84800af244da020a835c0bd2e`
- 派生0003 SHA256：`861d60b7bb26bc29db0fe708bacee5c962338b92fd1b8c37943890cf76594742`
- P2_4 direct-local0002 SHA256：`8fcbeb2d11c11e5b1f34eb04ac21bdb5bb265685e564046fc2d785b0393112c5`，274950字节
- archive pre0003 SHA256：`b4e9b1ce05371e2ae3469f168bb59ceefe7517f253c004c14dbec7d0c6d21d58`，31046字节

独立读取原P2_4树 `.local/P2_4-native-producer-ports/context-rebase-direct/` 的0002、原0003、archive快照，与direct-input-manifest的size/SHA均匹配；archive快照与Root before文件逐字节相同。没有消费被弃用bba999候选、编译新0002或运行业务。

## 差异与八目标验证

将补丁按文件拆开，对每条带`+`/`-`的程序行（排除文件头）连同所属文件、原顺序和换行字节比较：**718条新增与10条删除完全相同**。

独立重构派生patch：从原patch仅执行以下操作，结果与给定派生patch完整字节相同：

1. 将archive hunk `@@ -342,6 +344,9 @@` 下旧UTC日期两条context，换为 `@@ -350,5 +352,8 @@` 与已有 `let archiveName = currentArchiveName();` 一条context。其余hunk及正文不变。before已由新0002定义local-date helper；本rebase没有新增日期补偿或改其行为。
2. 用八个before/after的实际Git blob SHA1更新各index对，模式均保持100644。八对均核验，**实际四对变化、另外四对重算值与旧值相同**；“八个index重算”不等于“八行index文本变化”。

八个before/after各16份SHA256与rebase-proof逐项一致，分别为archive、current-change、gate-runtime、migrate、resume-probe、runtime-run、state-command、workspace。完整摘要与Git blob/index对在独立receipt，不以旧metadata代替内容检查。

Kp/Kt、authority相关程序增删行没有任何额外删改；所有程序行及文件/hunk顺序的精确等价重构，加上下述目标字节重放，排除了这次rebase隐性移除守卫或改接其它位置的情况。这不等于重新认证原0003或新0002的所有安全语义。

## 独立 tmp 实际重放

仅复制八份before到 `/private/tmp/Root-postarchive-std-4weg4emp/replay`，执行原Git文件补丁操作，无源码运行、依赖、网络、Docker、模型、认证或真实Run。

共同cwd为上述replay目录；实际argv如下（补丁绝对路径均在主证据目录）：

```text
/usr/bin/git apply --check /Users/mac/Code/sdd-harness/worker-reports/Root-post-archive-context-rebase/0003-original.patch
/usr/bin/git apply --check /Users/mac/Code/sdd-harness/worker-reports/Root-post-archive-context-rebase/0003-context-rebased.patch
/usr/bin/git apply /Users/mac/Code/sdd-harness/worker-reports/Root-post-archive-context-rebase/0003-context-rebased.patch
/usr/bin/git apply --reverse --check /Users/mac/Code/sdd-harness/worker-reports/Root-post-archive-context-rebase/0003-context-rebased.patch
/usr/bin/git apply --reverse /Users/mac/Code/sdd-harness/worker-reports/Root-post-archive-context-rebase/0003-context-rebased.patch
```

原check **exit1**，stderr明确 `classic-archive.ts:342 patch does not apply`；派生check/apply及reverse-check/reverse-apply均 **exit0**。应用后实际八文件与after逐字节相同，目录中无额外文件；反向应用后八文件与before逐字节恢复。未用fuzz/reject/手工改目标或忽略失败。

UTC `2026-10-25T21:51:42.638147+00:00` 至 `2026-10-25T21:51:42.721871+00:00`。五个实际子进程PID **47957、47958、47959、47960、47961**，全部communicate终态。环境仅PATH/语言/TZ/tmp与Git禁系统/global配置，不读取用户Git配置，也不改HOME。

独立可复跑入口：`/usr/bin/python3 /private/tmp/Root-postarchive-context-review-20261026.py`（每次新建独立tmp，不覆盖本次证据）。

原始独立证据：`/private/tmp/Root-postarchive-std-4weg4emp/` 的五组stdout/stderr与 `receipt.json`。receipt SHA256：`0b3ea9578bb3aa48f2d09660fa8dfe7248889e7bd46aa8c89634db517096fe55`，含每步argv/UTC/pid/exit/输出SHA、八目标内容/index、输入绑定及共享文件前后SHA。

## 共享生产输入仍未变化

审查前后主树：

- `integrations/comet/patches/0003-post-archive-closeout.patch` 仍为原SHA `b266706c207ae09db17e4a2e005dd42e785d99d84800af244da020a835c0bd2e`。
- `integrations/comet/upstream.lock.json` SHA256 `7d958d16aaac944017eb3db68aa18dd0d63d446fb811cb5f57608f9f86e56633`；其0003条目仍指向原SHA。
- 两文件均与当前HEAD字节一致，git status/diff无这两文件改动。独立重放只写新tmp；没有修改派生输入、共享patch、锁、台账、phase或任何生产绑定。

原P2_4私有Core消费派生所做机械检查归原owner，未在此复跑或提升。后续仍需Root串行纳入当前完整patch集合（含安全回补）、重绑锁、重建并完成独立资格；本PASS不能代替这些步骤。
