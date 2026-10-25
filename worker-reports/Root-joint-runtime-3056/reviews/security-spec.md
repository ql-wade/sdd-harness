# P1_1 f678 POSIX后端返工：独立 Spec 复审

结论：**APPROVE_CONSTRUCTION_REWORK，原ENOTSUP P1已闭合，新增阻断0**。仅接纳本次安全源码/组件返工范围；Root仍须独立合并5ec并重建、重验联合发行。不是实际Host、OS、角色、Windows或whole通过。

候选 `f6789e02c84b4bffa84fd25fdeaedfc8528c06f1`，父候选 `aa170bedf6db4b1bce4dd380b1c3f6e5887f5d2f`。只读树 `/Volumes/mac-extend/codex/worktrees/comet-toolchain/sdd-harness`；未改源码、锁、配置、phase或台账，未运行Docker、模型、API、安装或下载，未创建worker/Goal。

## P1闭合与最小差异

0004仅两个payload段变化：`eval/scaffold/python/workspace_artifacts.py`及其原纯Python回归。新共享`_handle_workspace_os_error`仅让ENOENT/ENOTDIR/ELOOP/EACCES/EPERM保持逐文件跳过，其他能力/I/O失败抛`WorkspaceArtifactError`。同一分类覆盖safe open/read、目录lstat和walk的onerror，原collector/judge/rubric/save继续沿既有异常传播；不再把后端失效解释成空材料评分。

Hook、Vite、CLI退出码修复及其他patch段与aa保持字节相同。原33项没有被替换；新测试保留API能力登记而令实际操作失败，不能用“缺API”准备错误充抵本次RED。

## 独立实际复验

执行 `/private/tmp/P1_1-security-rework-spec-verify-20261026.py`，实际 **exit0**；UTC `2026-10-25T19:03:09.862354+00:00`至`19:03:10.676837+00:00`。

- 现有两个artifact Python套件：**52 passed、16原生Windows skipped**。16项仍为未验，没有计为通过；pytest禁用cache和自动插件，仅用现有Python3.14和自建tmp。
- 另独立复查 **open/ENOTSUP、lstat/ENOSYS、walk/ENOTSUP、read/EIO × collector/judge/report，共12个故障case**。全部实际传播`WorkspaceArtifactError`；judge本地观察stub调用0，未正常返回分数/保存，原report字节保持且没有新增normal artifact。真实模型/Docker/API调用0。
- 原合法逐文件跳过五类错误仍由现有回归证明：跳过该文件后，另一普通nested文件仍可收集，非空/全skip不能冒过。
- 输入前后hash相同；外部拒绝guard在测试期间调用0。独立句柄78823已终态exit0，无本次遗留执行句柄。

作者新RED原始stdout确有`DID NOT RAISE WorkspaceArtifactError`，1failed/44deselected，随后新source下12通过及52/16均保留。其fresh build、19项Node、generated3及native257+2均为各自范围作者证据；本复审没有重复无变化的Hook99、Node全套或全发行。

## 保全和输入绑定

新manifest29项及raw/display24组均按bytes/SHA核对。旧aa manifest84项保留；其中原patch按aa Git/raw原字节核对。`evidence/original-aa-0004.patch`是明确归一化的显示副本，原始raw仍为Git一致的2b2b390…，不能用显示副本充当可应用原patch。

原独立报告 `/private/tmp/P1_1-security-spec-review-20261026.md` SHA `234bae2f0abe3396d70c4a7dc452f294583ec05859be570d0b249f223c5b727a`、原proof `/private/tmp/P1_1-posix-backend-spec-mciyidvy/proof.json` SHA `73864dc4492f75e89ea7469e222d3e109415ff6c45e4a039584fd4a12b61e445` 均逐字节保留，不改写旧失败。

| 当前输入/证据 | SHA256 |
| --- | --- |
| revised0004 | `1cec1ca2cdde459c97f230e0fd5ac2b218b85dd479523307fb713ed4a982359f` |
| rework candidate-inputs.json | `dd82994378de15a00b1fb73030111f3a475bd3aec8e62aec2836276a19e5ff64` |
| rework evidence-manifest.json | `c51cb345379d1e41de2962d37b5e3cf1edd883cbc1bfe63efad4ff5481953e0a` |
| rework private candidate lock | `25e764045b1b1ef40833914fcb44828ec2593f4fcf5e61ad56528063c3d79fe5` |
| current workspace_artifacts.py | `1291e44c711fd5274b6e822055f7ab9de816e3ceb0b24a5d3aa892080a28c0bb` |
| current distribution.json | `775712c6cde26295cbb7c82adf574414b96869e3494bee21a9e9baa79b5be23d` |
| 独立复验metadata | `80536100d357ff9d5ee42d49df8fb9a68c6f9226956748783a24afc3a005846d` |
| 独立pytest stdout | `a78b284f343c6f07133197e346b1f12f39c36fc6004617b823f93d503333ef29` |

独立raw/metadata和12case记录位于 `/private/tmp/P1_1-rework-spec-uapa0gm1/`。所有证据只来自本次限定源或原始文件，没有借新报告把aa旧失败改为通过。

当前private指纹为`0d908904c0071c5133383a523eb8f22c71fdf95db704d2edef9c686758f7a6d4`，仍为原六patch+revised0004，**不是5ec联合构建**。主shared lock、0001–0003/原测试patch、方法与原39/69/130/104、本期129/103/F10义务不因该复审改变。联合源、实际平台/身份/权限、完整旅程仍由Root原计划验收，业务通过增量0。
