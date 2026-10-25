# Whitebox 自测 caller 隔离：独立 Standards 审查

结论：**APPROVE，阻断 0**。仅审查主树 `scripts/check.sh:17–21` 的调用点修复；未修改或接纳技能正文，也不代表完整仓库检查已经通过。

- `set -euo pipefail` 保留；`mktemp -d` 或 `cp -R` 失败都会终止。原完整 `bash tests/run_all.sh` 调用及失败转 exit1 保留，没有增加过滤、skip、吞错或缩减子检查。
- 临时根来自本次成功的 `mktemp -d`，赋值后才注册 EXIT trap。源、目标及执行路径全引用；`cp -R "$WBV/."` 包含整个快照和隐藏文件。`WBV_TEST_ROOT` 在该脚本中仅赋值一次，子脚本不能修改父 shell 变量。
- EXIT trap 只对 `"$WBV_TEST_ROOT"` 执行带 `--` 的删除，不包含用户路径、源目录、通配符或额外清理目标；拷贝失败、自测失败、后续检查失败及正常结束均走这一退出清理。当前脚本没有另一条 trap 被覆盖。
- 上游 `run_all.sh` 自身仍以所在位置计算 ROOT，完整六组检查和 `WB_NEW_ENTRY` 均指向这次字节副本。`cmp.sh:35–42` 确有对 green 夹具的 `os.utime`，移动调用点至临时副本与实际根因吻合，无需修改受保护源。
- 独立只读 `bash -n scripts/check.sh`：**exit0**。UTC `2026-10-25T17:25:36.792680+00:00` 独立比较 Root 的 before 清单：**139/139 文件 SHA256 与 mtime_ns 完全相同**，当前源文件数139、链接0；没有发现源或用户文件被该修复覆盖。

精确输入：

| 输入 | SHA256 |
| --- | --- |
| scripts/check.sh | `e6c06d8a7359ea5910339748089334675d863d1d5096dcb77fb8576bf444624c` |
| 该文件 git diff | `a91504c9b803942f9f5ae3909d4eda2bfd3590ed5d2c75b6e0f4791deef79b45` |
| 原完整 tests/run_all.sh | `72866237078b4b5a03d4c8890ce01b165c4bb187994b155efb7c465cedd7a210` |
| .local/comet-reset/i02-main-integration/whitebox-source-before.json | `6ecec033cc7fc2a69014a8c6fcfb5f0d8cf6068154db7c27ccb7009effe857fd` |

符合 AGENTS 的不改 vendored 方法正文、不污染活配置和不得削弱验证纪律。没有基于假设提出风格重构。本审查未重跑完整 check，未消费或重启 Root 的 90493 句柄；其完整执行结果与结束后的源保全读回由 Root 收尾。未运行模型、服务或凭据操作，未改主配置、锁、业务状态，未创建 worker/Goal。
