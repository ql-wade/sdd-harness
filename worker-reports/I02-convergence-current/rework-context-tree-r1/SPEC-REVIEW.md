# I02 独立 Spec 审查

结论：**REQUEST_CHANGES_FOR_CONSTRUCTION**。一项已在纯 tmp 确认的 construction 阻断；不能接纳整个 I02。修正该项后，通用准入/物理端口等建设范围可重新独立接纳，仍不形成 OS/真实角色资格。

- 候选：`70a2c08763b98cf450380d13d99611f4a8f5042a`；base：`cbde39e6b811b94fec89fd6ae11a31b009704097`。
- 只读审查目录：`<repo>`；开始时 HEAD 匹配且工作区干净。
- 输入：AGENTS、原 tasks I02、task-dag、execution-contract V_INFRA_I02、infrastructure-tasks I02、host-port contract、候选 REPORT/manifest、相关实现与测试。
- `runner.mjs` SHA256：`3ed0dbe7fc7cbcefb138c5c749a612c60a8577e8b688a9a02d3e58c008281153`。
- 反例原始 proof：`<spec-proof-root>/proof.json`；SHA256：`685abe8596734b77ff83bf292bd30adf358226a9edba0ccf567c5aef64d4f800`。同目录保存两次原始 CLI stdout/stderr。

## 唯一已确认阻断

**[P1] 复用 context 未拒绝额外文件，allowlist 不能约束实际传给 Docker 的目录。**

位置：`tools/infra/runner.mjs:1079–1088`，以及 `1113–1123`。

`materialized = contextFiles.every(...)` 只检查预期文件存在、为普通文件且 hash 一致，没有枚举实际 context 的其余路径。已存在全部预期文件时，`--export-context` 直接复用；输出随后把整个 context 目录交给 `docker build`。因此导出后增加 `.env`、`.git` 等未列出的内容不会改变 contextDigest，也不会被拒绝，违反报告“白名单 context 导出／unlisted files exclusions”和 I02 输入不含宿主凭据/无关文件的边界。

纯 tmp 反例实际执行：复制候选相关源码与两个已锁公开 cache（先核 SHA），使用 Node 24.15.0、现有精确 Python/PyYAML 和离线外部命令 guards。第一次真实 `build-plan --export-context --json` 产生合法目录；仅向该目录增加 31 字节无秘密 `.env`（`I02_REVIEW_MARKER=not-a-secret`），再次运行同一 CLI。

实际结果：**两次 exit 0、两次 materialized=true、contextDigest 相同，新增 .env 不在 contextFiles 但仍留在被导出的目录。** 未执行 Docker、网络/模型/服务或读取任何真实秘密；没有改候选或其 manifest。

复跑反例：

```bash
python3 <spec-repro-script>
```

最小修正：对复用目录校验完整实际树，拒绝任何未在白名单内的文件/目录、符号链接及逃逸路径；或每次从固定输入创建新的隔离精确快照。实际构建的消费者还必须核对同一快照的完整内容，不能把一次 manifest 摘要当作之后整个可写目录的证明。补一个“首次成功导出→加入无秘密额外文件→复用明确拒绝”的测试；保留原幂等和文件字节校验，不用静默删除未知文件掩盖漂移。

## 源与证据核对

- 已重算 committed manifest：116 项当前文件全部匹配；candidate-inputs 的 13 文件映射及 inputDigest 也匹配。
- final-owned-v2 的输入前后与当前候选一致；TAP：65 tests、65 pass、0 fail、0 skip。final-related-v2：41/41、0 fail、0 skip。两组 committed stdout/stderr 及私有 raw/display/guard 日志均按 metadata 逐项核 hash 一致。
- owned 外部 guard 调用 0；related 的 9 次 docker、2 次 gh 均是离线拒绝 guard。它们不是本次真实 Docker/API 成功事实。
- 65/41 是作者自检；本审查没有重跑全套，只执行上述纯 tmp context 反例。现有 context 测试（1110–1141）覆盖首次导出及重复不改 mtime，未覆盖导出后追加文件，故其绿色没有排除此反例。

## 可重新接纳的 construction 范围

共同 `loadInputs → inputShapes → validateDomain` 快照覆盖 validate/qualify/up/probe/build-plan，畸形输入关闭式失败；真实 YAML 解析替代行扫描，固定 PyYAML、禁特殊构造和资源边界均有对应源与负例。F10/7300 健康页已退出资格依据。该通用建设方向与新 0.5 public 接入不冲突。

物理 `createCliJobDriver` 的 registration 由固定 P1_3 host 构造并复制；job 仅四字段，job/registration/role-binding 绑定签名 ActionBinding；image/卷/principal/consumer 不由 job 自选，实际观测再核 engine/image/labels/mount/UID-policy。三口输出明确 `component/physical-process`、`managedClosureEligible=false`，没有新增 phase/DAG/队列/重试或签发 dispatch，保留 Comet 唯一推进权。这里只能接纳代码/组件契约；构造器接收到可信数据不证明生产调用方已经受保护。

固定 host 仍须独立核当前资格和原 Action。driver 的 `verifyDispatch` 复用 HMAC 验证，并不自己证明某个 Action 仍为 Comet 当前动作；该责任在 host-port contract 已明确留给 P1_3，不能在未来接线中只回传 worker 的 currentActionBinding 充当当前性证明。此处未发现新增 0.4 私有 Comet consumer/bootstrap：本 diff 未修改 integrations/comet、tools/comet、lib/delivery 或 contracts/delivery；版本相关执行 recipe/宿主接线明确 ON_HOLD。

## 保留的非接纳范围

image digest 未认证、upGate 关闭，bootstrap/recipe 及新官方版本绑定仍 ON_HOLD。实际 Docker image/OS/不同 principal/受控 Edit-Shell-MCP 正负链、复制 state/并发 writer/死亡恢复、方法真实送达、CI/知识/平台仍 UNVERIFIED，不能用这批进程 fixture 或旧 inspect/六容器记录关闭 whole I02 或任何更宽 required 检查。

`stopCliJob` 对 paused/restarting 等非 running 状态的终止语义值得补查；本次未作反例，不作为第二项已确认阻断，避免拖延已确定的 context 修复。

未改源码、锁、DAG/台账/phase，未运行 Docker、模型、秘密或外部 API。当前风险是把仅验证预期文件的 context 摘要误当成实际目录完整白名单；应在 construction 接纳前修正。
