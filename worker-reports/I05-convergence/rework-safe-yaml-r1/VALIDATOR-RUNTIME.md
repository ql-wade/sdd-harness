# Compose 解析器运行边界

原 I05 此轮复用已存在的 `python3 -I` 与 PyYAML6.0.3。没有新增 Node 包、安装/升级 Python、修改全局环境或 package/lock。I05 自身 deepwiki-profile.validationRuntime 声明这个依赖；实际缺席、版本不符、异常、超时或协议未知均非零UNVERIFIED，不回退行扫描。

捕获与实际验证使用相同PATH：`<repo>/.local/I05-convergence/rework-safe-yaml-r1/offline-bin:<node24.15-bin>:<trusted-python-bin>:/usr/bin:/bin:/usr/sbin:/sbin`。守卫优先，Node精确24.15.0，可信Pythonbin为本轮已实际校准现有python3所在bin的便携占位。六guard阳性校准及真实隔离PyYAML版本见runtime-calibration；私有fake python只验证失败路径，不作实际解析或服务资格证据。

产品子进程只有固定命令python3、固定-I/-c及仓库内固定程序，配置仅经stdin。程序使用SafeLoader子类，拒重复key、非字符串key、tag、anchor/alias/merge、多文档/不可解析输入；不会执行任意tag、include或读取被配置字符串指向的文件。解析后只准当前模板根、唯一codewiki-app、两固定具名源/目标、两个空卷、单internal网络、loopback ports和固定env/资源/权限字段。未知额外字段非零拒绝。

输入/输出各64KiB，深度24、事件4096、进程5秒上界。初始2秒上界触发了提前超时，失败证据保留；采用5秒后仍以私有15秒挂起例真实证明强制终止和非零结果。没有放宽安全断言或把超时判通过。

Python stdout只含固定错误类别、固定位置与解析器元数据；不输出原配置/环境值/异常原文/traceback。Node对返回schema、code、位置、available/version/exit/ok一致性再次校验，stderr/未知输出/矛盾可用性不算解析执行。父进程状态只表示组件解析器，不证明Runner身份、业务动作、镜像/服务或真实知识旅程通过。

Foundation冷宿主/Runner发行后仍须由其owner按实际环境资格化此既有依赖与受信执行上下文。本轮不开放任何真实运行、源码摄入、provider、MCP、grant、ACL或发布资格。
