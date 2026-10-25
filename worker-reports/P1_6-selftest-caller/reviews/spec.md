# Spec轴：Whitebox源自测caller临时副本修复

**结论：PASS，限当前 `scripts/check.sh` caller 修复；无必须修正项。** 不评价或豁免其它仓库失败，也不签业务验收。

审查输入为主树该文件当前差异，SHA256 `e6c06d8a7359ea5910339748089334675d863d1d5096dcb77fb8576bf444624c`。已读上游 `tests/run_all.sh` 和 negative-corpus/cmp.sh；上游确实主动修改夹具 mtime，改在副本运行符合保留受保护分发源的要求。

- 调用仍为原完整 `tests/run_all.sh`，没有改技能正文、删检查、加过滤/quick参数或把失败当通过。它从自身路径定位副本 ROOT，仍跑 GREEN、完整负语料、原可选工具自测、三个不变量和 SKILL 预算门；原入口缺失直接 exit1。
- `set -euo pipefail` 保留。`mktemp` 或 `cp -R` 失败不会进入自测；上游非零仍经原失败分支 exit1。之后 npm/其它检查失败仍阻断，没有因清理成功覆盖原退出失败。
- 来源固定为仓库 `.agents/skills/whitebox-verify`，没有新添未知来源、全局回退或动态执行入口。`cp -R "$WBV/."` 包括隐藏文件；当前源实际139文件且没有符号链接。复制成功后运行的是同一套源字节，源码mtime不必为测试放宽写权限。
- EXIT trap 只删除本次 `mktemp -d` 返回、加引号的 `WBV_TEST_ROOT`；不是整个 TMPDIR 或原快照目录。trap 在复制/执行前登记，覆盖正常退出、copy失败及后续检查失败。子 bash 无法改写父 shell 的清理变量。本修复无需新的通用runner或安全框架。

## 源快照独立读回

观察时间：`2026-10-25T17:25:00.616279+00:00`。

- before 文件：`.local/comet-reset/i02-main-integration/whitebox-source-before.json`，SHA256 `6ecec033cc7fc2a69014a8c6fcfb5f0d8cf6068154db7c27ccb7009effe857fd`。
- before/current 均139文件，新增0、移除0、字节变化0、mtime_ns变化0、符号链接0。
- 两边内容集合 SHA256 均为 `957ba71da24634d79bdac8235bf823e4693e92b9ab8d7a408d64bb388e81dbd0`。算法为：相对文件路径→逐文件SHA映射，键排序、紧凑JSON后SHA256。

这是当前时点的只读快照比较，不冒称 Root session90493 已完整结束；最终仍以其真实终态及结束后源读回为准。若随后失败落在原 P1_5 两项或其它必需检查，必须保留失败与归属，不能用本 caller 修复通过豁免。此次没有复跑自测、提权写源、改配置/锁/phase、调用模型服务或读取秘密；仅写此审查报告。
