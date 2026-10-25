# P1_6：在私有副本运行上游完整自测

只修改仓库 caller `scripts/check.sh`，没有修改方法快照、用例或通过条件。上游 Whitebox green fixture 会更新工件 mtime；当前受保护 `.agents` 源目录对此实际返回 PermissionError，原 check 和直接 fixture 的失败均保留。

caller 使用 mktemp 创建自己的目录，复制原完整快照后运行原 `tests/run_all.sh`，EXIT trap 仅清理该目录。缺入口、复制失败、自测或后续命令失败继续阻断。两份独立审查无阻断，原139文件在运行前后SHA256和mtime_ns完全一致。

Root会话90493实际运行完整 `bash scripts/check.sh`：Whitebox六组自测RUN_ALL_PASS，共识机械gate自测通过；随后npm941项939通过/2失败/0skip，仍因原P1_5两项失败返回1。YAML/JSON尾阶段未执行，没有将它们报告通过。此前I02源、用户文件及活配置摘要保持不变。

独立报告见reviews，命令/UTC/guard/日志及范围见integration.json和主.local/comet-reset/i02-main-integration。此修复只闭合检查入口对只读技能源的适配，不代表真实角色、完整P1_6、Whitebox业务旅程或129/103通过。
