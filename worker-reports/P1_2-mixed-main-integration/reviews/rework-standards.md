# P1_2 noncommand 修订：独立 Standards 复审

**结论：原 P2 已闭合；0项新增阻断，可接纳此限定 source/assembly 维修。** 不认证实际Host、角色/OS或whole P1_2，Foundation两项未闭合义务保持。

候选 `a666a99c2969f3abca7d2b9073db966708fed0a1`，parent `d0b7c0f171dca7c5afb7f57a4db98e2397733745`；worktree HEAD匹配、开始时clean。

## 源码判断

adapter唯一逻辑变化是在event+command重复扫描内，遇到 `type != command` 立即continue。它直接消除了两个不同prompt被错误归一成同一个空command的根因。非command不参与命令冲突检查，但仍经原handler保全流程保留；原真正command的来源识别、plugin优先、重复判定、matcher、权限/引用规则及ManagedOutputs写入边界均未改。没有新框架、权限或调度状态。

新增真实临时TARGET_ROOT用例以legacy owned command和两个不同prompt同组，逐项检查prompt文本/timeout/metadata、组matcher/metadata完整保留，当前owned command恰好一条；再次安装字节相同；卸载只余原prompt组。prompt只作JSON数据，adapter没有执行prompt、模型或Hook主体。

## 独立实际复验

本轴只选新用例与原两项真正command冲突测试，**3/3、0fail、0skip、exit0**：

1. 两个非command handler的真实安装/重复/卸载通过。
2. plugin wrapper注册同event/command仍明确拒绝，settings不变。
3. 重复user command仍明确拒绝，不重复组合。

原P2针对的场景已由这组独立装配实测闭合；未重跑无变化运输或整套Foundation。Node24.15.0、现有Python、最小PATH，所有写入均私有tmp fixture；未执行Docker/model/API/secret、下载或真实全局配置。

原始argv/UTC/env/退出/输入前后SHA：`/private/tmp/P1_2-mixed-hook-rework-standards-20261026/receipt.json`，SHA256 `01b0853fc07a7f99167c3f28fce0de4758e5a03ddc9ff9e37aa5744607029cc8`。
原stdout：`/private/tmp/P1_2-mixed-hook-rework-standards-20261026/stdout.txt`，SHA256 `0f384964da1cfdbffbb43df55cc34bdbdd420f67aeef7b44cc8906a8882b4fa5`。
本轴输入前后逐字节不变：`True`。`bash -n`及本次 `git diff --check d0b7c0f1..a666a99c`均通过。

## 证据与保全

- 新manifest SHA精确匹配 `e270de3e5105a5616845134faea207deb81520f6e50901228a871b7d56204676`：16项bytes/hash全部匹配；13组raw/display逐项匹配。
- 作者19/19与原command冲突2/2保持作者回归等级，不与本轴3项叠加成新业务分母。
- 旧d0b7报告/证据文件未改，只新增rework-noncommand目录。原Standards报告SHA仍 `f42bfbe9f11b32b33c64ba648268243a7b799e525fd2d80378ed379d2b692a36`；原反例proof SHA仍 `db5d87861f317896ea729eeaf20872124f48148546f02ca8f0640bc0706d344c`。旧输入/失败原件继续保留，不改写为通过。
- 当前adapter SHA `3a3c23f09a0f7952554540abd817aae650a2e6bf04c519a53f4250682fe9d98c`；当前测试SHA `158d3a890ffed8ea9f375111daa48c153d7c3cf6d15ac931eaba39220ae1117c`。

原74total/72pass/2fail继续有效：完整Foundation closure和oldRun语义未在本轮修复或重判，F04/B09不放宽。Root须合最终源与adapter统一发行后按原断言复验；不能因本次类型区分通过就宣布其oracle过时或关闭whole。

未修改候选、锁、台账、主计划或真实settings；没有新增worker/Goal。仅该源码/装配构造修复可消费，实际宿主、身份/OS及业务资格仍未验。
