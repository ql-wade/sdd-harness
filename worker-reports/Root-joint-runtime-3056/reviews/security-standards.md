# P1_1 安全返工：独立 Standards 审查

**结论：PASS_FOR_SCOPED_CONSTRUCTION。新增明确 Standards 阻断0；不签整体安全或业务资格。**

候选 `f6789e02c84b4bffa84fd25fdeaedfc8528c06f1`；base `22bec9b1dd3b6944675cb46defb92c5154f14f9c`，前候选 `aa170be` 保留历史。依据仓库 AGENTS.md §3（Hook行为与装配）、§4（明确pin/事实源）、§5（fail closed、CLI退出码、配置隔离）；Fowler基线未发现应阻断的新增设计异味。本审查只读，候选结束仍clean。

- **POSIX失败闭合**：0004:711–719集中区分合法逐工件跳过与后端失败；open/read、lstat、walk共用分类，ENOTSUP/ENOSYS/EINVAL/EIO转WorkspaceArtifactError，collector→judge/save传播不被通用catch降成成功。独立执行的现有矩阵验证judge观察器0次、旧report未覆盖、没有正常保存成功；五种原跳过政策保留。属于临时故障注入证据，不声称宿主文件系统真实失效。
- **Hook**：0004:1058–1075编码完整argv，并以重新编码后的完整命令相等识别归属；尾随用户命令不归属。真实字面/展开路径两个无害程序、项目临时安装/更新/卸载、用户handler/metadata保留均独立通过。原99组仅修改fixture的decode/re-encode污染方式，未削弱旧断言；不替scaffold adapter另项混合group缺口签验。
- **依赖**：Comet保持0.4.5，package/pnpm差异仅Vite8.2.2→8.2.4引用及SRI。独立核已批准tar SHA256 `1d132a84f4980b2cbb15e1c1c78728aed90f5eb81c70791ed0cf133a1211139a`、SRI及36个installed文件逐字节一致；offline/cache日志与setup失败保留，没有本审查下载或安装。
- **CLI**：build.mjs:198–206在保留verification JSON后设置PASS0/FAIL2，输入错误1。独立真实失败assertion、正向及错误参数用例通过，无吞JSON或提前exit丢管道数据。
- **来源**：新29项manifest（SHA `c51cb345379d1e41de2962d37b5e3cf1edd883cbc1bfe63efad4ff5481953e0a`）及24对raw/display全匹配；旧84项按aa提交核对、70对原raw/display仍匹配。共享锁、原六patch、方法manifest八项与base相同。相对aa产品改动仅reader和其测试两文件，已明确披露局部修正不再冒称这两文件精确上游原文。

独立复跑命令：`/opt/homebrew/bin/python3 /private/tmp/P1_1-security-standards-replay-20261026.py`，Node24.15.0/Python3.14.7，**19/19、0外层skip，含Python52pass/16Windows未验**；九个外部拒绝器校准97，测试期间调用0，十项输入前后相同。UTC19:01:44–19:01:59，session63238已exit0，无遗留句柄。

原始证据 `/private/tmp/P1_1-standards-security-ivw_pire/`；metadata SHA `e2b4097a273739912e71538146636f98330472b67988aabb330b0e275fcf75b7`，stdout SHA `f8612bc765a59c5a5d4c748c089c81a4182ad61aa0467e9010a56c121c5f2ae4`。作者99、fresh/reused:false、generated0及native257+2skip只按其已核原始范围保留，本审查未重跑并升格。

当前patch SHA `1cec1ca2cdde459c97f230e0fd5ac2b218b85dd479523307fb713ed4a982359f`；当前构建 `0d908904c0071c5133383a523eb8f22c71fdf95db704d2edef9c686758f7a6d4` 是原六patch+0004，**不是5ec联合**。Root仍须联合重建；Windows/WSL、Linux Runner、实际Host/OS/角色/权限/知识及whole129/103未认证，业务增量0。
