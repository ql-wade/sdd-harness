# 0.5 三项 Security 修复对当前 0.4.5 的适用性

结论：**保留 0.4.5 与原单 Comet 架构，不把 0.5 升级变成 129/103 的新前置；也不能宣布旧版安全或三项全部不适用。**实际六补丁构建仍含旧 Hook 字符串拼接与 Eval 越界读取实现。它们需要最小安全回移，或由原任务以真实机制证明相关入口不可达。Vite devserver 风险不能直接套到普通 Classic CLI，但开发入口仍存在。

范围：限定静态诊断；未启动 devserver/Eval/网络/服务，未运行攻击载荷，未读凭据或改源码、锁、配置、台账。只写此报告。未把 observer 树的私有 5ec 候选当主发行。

## 固定输入

- 主 `integrations/comet/upstream.lock.json` SHA256：`a893be958b3efe8625f8be34a3f7959d4a1ce603ae960dd5604e60f45c68679c`。
- 原 source：`c90af44a4474662d7853aae76ce785404974fb0a`；完整六补丁实际指纹：`6da90e893105b4b00fc756260076b49e12bdbe40bc4426e4908a75e1d5732a9a`，以下旧代码均核对该 build/work，不能仅看 pristine。
- 0.5 对照：`/private/tmp/comet-source-qualification-20261026/.sdd/vendor/comet/aeb1a6598034e28ce46b8422d4dbd8785e607bd7/pristine`。
- 提供的 `pinned-changelog.txt` SHA256：`d616c1accaec7c6cd7e5ab0a701050296ca9f0d910c70532b81c9a601f2a5f29`。仅按该固定源码与声明判断，不扩展到其它未核实 CVE。

## 1. Vite 8.2.4 / Windows、WSL devserver

**已确认代码事实：**当前 `package.json:140` 与实际 `node_modules/vite/package.json` 均为 **8.2.2**；0.5 package 为 **8.2.4**。六补丁未覆盖它。`scripts/dev-dashboard.mjs:38–77` 会启动 backend 后另启 Vite；`domains/dashboard/web/vite.config.mjs` 定义 dev server/proxy。

**可达性分开看：**普通 Classic state/guard/check/archive 调用链不启动此开发脚本。`comet dashboard` 的 `app/commands/dashboard.ts` 调用 `domains/dashboard/server.ts:122` 的 Node HTTP server/static 页面，不是 Vite devserver；不能把生产 Dashboard 与开发服务器混为一谈。限定这些调用，所述 devserver endpoint 不在执行路径内。

但完整构建仍保留开发脚本、Vite 包与公开开发命令；当前 Runner Dockerfile 保留完整构建树，也没有在读到的入口中证明所有额外进程/开发命令已被不可绕过地禁止。故不能从“计划只用 CLI”、`read_only:true`、内网，或单一 `linux` 标签推导整个环境不可达；WSL 本身也属于 Linux 环境。未证明有当前 Windows/WSL devserver 正在运行，也未证明这项已被利用。

**最小处置：**若原任务需要开发服务器或分发 Windows/WSL 开发能力，在 **0.4.5** 上单独 pin Vite **8.2.4** 并更新对应 pnpm lock，限定兼容性/构建验证；不引入 0.5 Runtime。若本轮明确不提供此能力，先由 I02/P1_3 对真实执行入口/可执行文件与宿主调用做拒绝证据，不能用文档声明代替。需验证普通 CLI/生产 Dashboard 不意外启动 Vite；Windows/WSL devserver 修复效果须在对应真实平台另验，不能以 Linux skip 算通过。

## 2. Hook 路径参数与用户 Hook 保留

**已确认适用的实现风险：**实际旧 `domains/skill/platform-install.ts:1577–1619`（并核到实际执行的 `dist/domains/skill/platform-install.js:1189–1211` 同样实现）的 `quoteCommandArg` 仅归一斜杠、转义双引号，再放进 shell 双引号命令。它不能保留 shell 展开字符的字面含义。`buildHookCommand` 仍被多个字符串 Hook 格式调用；`platform/install/platforms.ts:135–151` 登记 Codex Hook，安装器 `:1930–1936` 对非 Claude 分支使用该 shell-form。风险不只限 Windows，在采用 shell 执行字符串的 Mac/Linux 宿主也适用，发生于进入 Comet guard 之前，不能靠事后的 Run/Gate 签名补救。

当前已知主检出路径本身没有这类特殊字符，未观察到当前路径触发命令执行；这不等于任意后续项目路径安全。Claude 的 command+args 分支及 ZCode process/argv 分支与字符串路径不同，应分别核验宿主真实采用 argv，不能一概说所有宿主都易受影响或都安全。

**最小回移：**0.5 `platform/process/hook-command.ts` 的编码 argv 构建/完整命令识别，加旧 installer 的 `buildHookCommand` 和 `isManagedHookCommand` 接线；不复制 0.5 application loader/Runtime。保留旧版本迁移识别，但不能按含某个脚本名的模糊前缀清掉用户命令。

旧 `mergeHookGroups:1740+` 已按 handler 过滤并保留其它 handler/metadata，不能夸称它原本总会删除全部用户 Hook。回移必须保留这项行为，并验证编码命令附加用户命令、混合 group、matcher/metadata、其它事件及 legacy cleanup/update/uninstall 均不丢失。验证必须包含**脚本 argv 的字面 roundtrip 与实际安装配置装配两层**，并在临时目录执行；不能只测编码函数或触碰活配置。参考 0.5 `test/platform/hook-command.test.ts`、`test/domains/skill/project-hook-projection.test.ts`、`platform-inspect.test.ts:675–715`。

## 3. Eval 工件 regular-file / symlink / reparse

**已确认适用的实现风险：**实际旧 `eval/scaffold/python/generic_llm_judge.py:57–90` 使用 `rglob → is_file/stat → read_text`，没有 project/workspace 内句柄约束；普通文件链接会被当目标文件读取。该内容随后进入 judge 输入。`eval/local/tests/conftest.py:2281–2343` 的 `_save_artifacts` 同样会保存被跟随的内容。捕获读取异常或截断长度不能使已读的外部内容重新合法。POSIX 文件链接问题在 Linux 也成立；Windows reparse/junction 需要额外平台处理。

**可达性：**原受管 Classic/固定方法的正常调用没有发现自动调用该 Eval collector；这只证明该具体调用链不经过它。实际完整 CLI `app/cli/index.ts:537–563` 仍暴露 `comet eval`，完整构建携带这些 Python 文件。未找到已生效、不可绕过的 Eval 禁用证据。只读文件系统、Linux Runner、普通阶段 Gate 都不等于禁止外部内容读取。不能以无 API key/某个依赖暂缺作为安全边界。

**最小回移：**仅回移 0.5 的 `workspace_artifacts.py`、`workspace_artifacts_windows.py` 及 generic judge、`validation/generic_rubric.py`、本地 conftest 的读取/保存与 preflight 接线。POSIX 使用目录 fd 逐级 no-follow、nonblocking 普通文件检查和同 fd 大小/读取；Windows 使用句柄及 reparse 校验。平台能力缺失应报环境错误并停止相关评估，不生成基于空/不完整材料的成功分数，不覆盖旧报告。不能只加 `is_symlink()` 的一次检查或只修 judge 而漏保存路径。

后续用临时普通文本、文件/目录链接、越界和受控不可读场景验证“不读取/不保存/不送 judge”；另核非普通文件不会阻塞、缺安全后端不评分。Windows reparse 与能力错误需真实平台测试。可按 0.5 `test_workspace_artifacts.py` / `test_workspace_artifacts_windows.py` 和 conftest 的错误传播用例限定回移。此次没有执行这些测试或任何安全载荷。

## 原任务承接与冻结纪律

P1_4 记录三项适用性与 mode/host 拒绝证据，不能从旧 mode-qualification 的历史 repin/smoke 自动继承安全结论。Hook 的现有 0001 安装器改动由 **P1_6** 及 **P1_3/P1_2** 装配归属串行处理；依赖/补丁 SHA、重建指纹与发行完整性由 **P1_1**；真实 Runner/宿主可达边界由 **I02/P1_3**。Eval/Vite 回移若超现有 patch 文件范围，由 Root 对这些**原任务**作具名最小所有权修订，不新建 DAG/controller。

任何回移都保留 Comet **0.4.5/c90**、原五 phase/Run/锁/事务及原 129/103 目标；不能暗中升级成 0.5、覆盖旧 Run 的原锁，或把私有候选当主已合入。须在当前限定补丁版本下重做完整链应用/构建/生成一致性与相关正常/拒绝回归，并由 Root 接纳新的精确发行指纹；测试原始失败与未验平台继续保留。

## 当前构建的复核摘要

以下实际 build 文件逐字节等于 c90 pristine，证明六补丁未包含这些修复：

| 文件 | SHA256 |
| --- | --- |
| package.json | `34885620dcf7ff0536638f8fa80dcfa07b1603183d5b303d1bcdaf1a093ce7f0` |
| domains/skill/platform-install.ts | `439e3dc4367f31f91c16beb3ff21185ad53058bb3fd48572cbc9ae92ef92e1b1` |
| eval/scaffold/python/generic_llm_judge.py | `d23756b21118ca0c8e855e6c086367440d086acde540aeba9dbf60c830dc9842` |
| eval/scaffold/python/validation/generic_rubric.py | `b9983a71f2c28edde57a7b907ce577ccb60b87c05dde76a2d00a344a9b0d5529` |
| scripts/dev-dashboard.mjs | `0969145904873b09e2acbdaaf864fdbf63250905ed8562ad846ceafe54c99c33` |

这是源码级适用性结论，不是利用测试、当前监听端口检查、实际宿主/容器隔离验收或完整安全审计；没有声明已发生泄漏/利用。
