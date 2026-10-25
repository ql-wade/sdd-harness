# I05 P2 返工：真实安全YAML解析与结构门

沿原I05，基点6a82aa0c5c2f5eb0ce165f80de088957f66b0a85，候选待独立双审。只改owned code-knowledge.mjs、原测试、own profile依赖声明与本轮报告/CURRENT；whole I05仍UNVERIFIED，原运行/生成/知识/恢复范围未缩减。

Spec反例把服务mount改为quoted-key/flow YAML后原行扫描放行。现在共同入口固定调用现成python3 -I/PyYAML6.0.3 SafeLoader子类，解析后校验当前根/唯一服务/环境/端口/具名卷/顶层空定义/internal网络/资源与最小权限字段。quoted/flow/转义键成为实际结构，不再用行扫描作安全事实。所有原安全oracle保留：HOST_MOUNT_FORBIDDEN、loopback、固定image placeholder、no privileged/host namespace/env-file等；未知额外权限字段拒绝，无新选项或通用Compose框架。

解析前拒custom tag、anchor/alias；构造时拒重复key、merge、非字符串key；格式/多文档错误非零。输入/输出64KiB、深度24、事件4096、进程5秒上界，依赖缺席/版本漂移/异常/未知或矛盾返回均UNVERIFIED且非零，不回退regex。子进程只输出固定code/位置/解析器元数据，错误原文、配置值和stderr不对外回显。私有fake进程只验证拒绝，不被当成真实解析；真实版本与安全等价YAML正例另证。

Node24.15、同一PATH含offline-bin与既有受信Pythonbin。六guard阳性校准及实际隔离PyYAML6.0.3通过。初始quoted/flow与等价安全结构RED17fail，随后17/17；依赖/异常/语法边界以精确6a82公开CLI和未改断言副本回放RED19fail，另当前矛盾协议RED后收敛。首个嵌入程序SyntaxError和初始2秒上界提前timeout失败保留，均未计为通过；非最终run的profile元数据变动也显式标记。5秒上界仍由15秒挂起fault例证明强制拒绝，未放宽安全断言。

最终固定输入全组：27顶层+56子项，TAP83/83，0fail/skip、0外部调用；输入摘要6fa84431b70b2946dacc3addcb0854c0d022fc0525a468324275fdda068a7f0f。包含全部旧46及新真实结构/隔离/依赖/进程/协议/资源边界。共享I01源未变，不机械重跑41或无关全仓。每组UTC、argv/cwd/PATH归一化、实体输入、exit、raw/display/metadata SHA见run-results；baseline replay输入另绑Git6a82原件及测试副本SHA。

没有Docker、服务/API/model调用、secret或所示host内容读取、部署、ACL/grant/canonical/锁写。依赖只在I05 profile声明，没有包安装或全局改动。93c8与6a82旧报告/manifest逐字保留（仅获准CURRENT更新），17公共源body摘要不变；所有新raw在ignored.local/I05-convergence/rework-safe-yaml-r1，旧I01/I03/raw/once未碰。原RESUME和运行资格计划继续沿同I05承接，本轮解析器可用不授予任何真实运行资格。
