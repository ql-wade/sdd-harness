# I02 完整 Runner 构建与隔离工具链读回

2026-10-26，Root 在已双审并集成的代码 `1f6ec33` 上执行原冻结计划的 D/E。完整镜像构建 exit 0，随后使用准确本地镜像 ID 运行隔离读回，exit 0。没有启动业务 Run、模型、角色执行或外部发布。

## 原始证据

- 冻结计划 SHA256：`406a7427ada211cb57a591c2e127cdce53760d83e004246a8194e71d2b488649`。原计划的 NOT_EXECUTED 是准备时状态，保留原字节；实际结果分别以 `result.json`、`readback/result.json` 为准。
- 构建开始：2026-10-26 01:28:14 UTC；结束：01:31:39 UTC。使用准确的 582 文件构建上下文，`--pull=false --network=none --platform=linux/arm64`；没有重新下载、宿主目录绑定或凭据注入。
- 本地配置 ID：`sha256:fad4c6a6ee25a0c65a0c665a7599d2b192ebe42e9bb490b2702c0fd1e718736c`，linux/arm64，2,714,839,363 字节。RepoDigests 为空，不能冒称 registry manifest digest。
- 实际标签：SDK `3056292584ad17c49080c7504c1a689f1a382012e708665a8f12069d75a12a69`；bootstrap `55ac772e81495c5575ccae0dacb9ef7ff140383b10d9516b39f3885ab93fb9f3`。
- 隔离读回开始：01:38:15 UTC；结束：01:38:18 UTC。使用原计划的准确 argv，非 root UID 10001、无网络、只读根文件系统、cap-drop ALL、no-new-privileges、1 GiB/1 CPU/128 PID，只给 `/tmp` 与 `/home/comet` 临时文件系统。

原始 argv、退出码、标准输出和错误输出在本目录，完整摘要见 `evidence-index.json`。原 frozen plan 的四个源文件当前字节再次核对一致。

## 实际断言

镜像内真实执行并核对：Node 24.15.0、Python 3.12.15 及 SSL/压缩/SQLite 等运行依赖、PyYAML 6.0.3、Git 2.39.5、pnpm 10.18.3、OpenSpec 1.11.0、Comet 0.4.5。Runner host 与 OpenSpec CLI 链接均解析到冻结路径。

没有受保护 bootstrap 的合法参数请求真实返回 exit 2 / PROTECTED_BOOTSTRAP_REQUIRED；非法参数真实返回 exit 1 / NATIVE_ARGUMENTS_INVALID。两者都明确 `productionQualified: false`，不是业务成功样例。

## 仍未完成

此镜像包含已冻结的旧 SDK 候选，不包含尚未独立审查合入的 Native producer 来源修复及知识 CODE 扩展。它不证明真实角色/模型/宿主执行、权限、平台、Kp/归档/Kt、隔离恢复、备份或同 Run 端到端旅程通过。I02 whole 任务及最终 129 required / 103 场景保持未验收，F10 正向另期处置不变。
