# I02 资源与运行资格方案（未执行）

状态：ON_HOLD_FOR_CONTROLLER_VERSION_BINDING。此文给 Root 评审具体资源与准入边界，不请求或批准现在 build/pull/start。Root 正结合 Comet 官方最佳实践选定受支持版本/公开工厂，不能把当前0.4.5/6da或旧证据继承给新版本。这里没有新增0.4内部bootstrap契约。

当前已做9条 Docker 安全元数据读取，daemon29.6.2/linux aarch64；旧4dfd镜像仍在，六旧容器均exited1。只读到 Config.User/mount类型/flags；没有 Env/日志/卷正文。它们不是当前镜像或角色资格。精确来源见 docker-readonly-observation.json。

拟用专用 `sdd-harness-i02-qualification` 前缀：六角色进程、六私有workspace卷和state/receipts/issuance三控制卷。namespace预检有冲突即拒绝，不复用/覆盖旧comet-runner资源。固定user10001、ROroot、dropALL、no-new-privileges、networknone、无端口、1g/1CPU/128PID和两64m私有tmpfs；同UID不是自动失败，也不证明角色隔离。角色映射/卷/镜像/入口来自受保护注册，jobJSON/env不能选择。

三口代码已经实现物理start/observe/stop并回传原execution/container/client-exit/raw；它不签dispatch、不判语义、不存phase/DAG/queue或重试。P1_3固定host提供实际已认证权威/当前工作包/原始结果来源，Comet持有唯一控制与恢复。constructor registration不是资格本身；当前Authority示例各真实ID/主体/镜像/bootstrap字段仍null/UNVERIFIED，四生产refs未provision。

Root正式绑定后先冻结可执行recipe、完整源/公开工具链与白名单context。现旧Dockerfile还有历史源构建/apt/corepack步骤，不能直接当新版本可执行方案；本候选没有构建它。新版若需Python>=3.12，已仅查[Docker官方3.12.15/arm64发布元数据](https://raw.githubusercontent.com/docker-library/repo-info/master/repos/python/remote/3.12.15-slim-bookworm.md)；未选择活动pin、未拉镜像或安装。依赖选择须按实际新版本最少化并冻结，不因为公开metadata就授信。全部拟议命令/摘要/私有卷名与回退边界见 runtime-resource-plan.json。

真实资格顺序：精确image/source/version读回→实际OS/mount/Shell否例→真正Edit/MCP渠道否例→固定host/真实身份的正向同Run链→控制器死亡/复制state/并发writer/晚到结果与原operation恢复。每层独立：本轮externalCLI fixture不是Docker/OS；旧inspect不是当前强制；Shell/fs不是Edit/MCP；版本/label/digest文本不是身份或模型审查。生产身份、模型外发、Secret/grant/ACL/平台/发布都未授权或验收。
