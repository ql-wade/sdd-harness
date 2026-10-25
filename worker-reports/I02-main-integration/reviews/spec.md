# I02 context-tree 返工独立 Spec 复审

结论：**APPROVE_CONSTRUCTION_ONLY**。旧 P1 已闭合，本次未发现新的 construction 阻断；仅供 Root 独立复验并串行接纳建设工件，**whole I02、镜像、真实角色与业务接纳仍为 UNVERIFIED**。

候选 `636dfb83acc94e901192875c0feeec8e5f47f128`，原候选 `70a2c08763b98cf450380d13d99611f4a8f5042a`，base `cbde39e6b811b94fec89fd6ae11a31b009704097`。审查树 `/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness` 开始时 HEAD 匹配且 clean；本审查未修改该树。

## 旧 P1 的闭合依据

原 Spec 要求复用 context 校验完整实际树，拒绝额外路径、链接、特殊文件与字节漂移。当前 `tools/infra/runner.mjs:128` 的 `buildContextStatus` 枚举整树，只准 manifest 文件及祖先目录；校验普通文件、打开后的 inode 和 SHA，并复核父目录身份。`:1136` 起的 plan/export 共用该检查，冲突返回 `2 / CONTEXT_CONFLICT / UNVERIFIED`，不再输出 Docker 构建命令。首次导出采用私有目录和排他文件写入，之后再检查完整树；不会静默清理异常内容。

独立操作：`python3 /private/tmp/I02-context-tree-spec-recheck-20261026.py`，exit **0**。UTC `2026-10-25T16:37:14.700927+00:00` 至 `2026-10-25T16:37:25.984810+00:00`；子 CLI 的 cwd 是全新 tmp fixture，Node **24.15.0**，仅复制已核 SHA 的公开固定源和包。

实际 **54 次公开 CLI**：17 类异常各在普通 plan 和 export 下明确拒绝；每次独立读回冲突树未被更改，恢复后 exact reuse 通过。覆盖额外 `.env`、嵌套文件、根/嵌套空目录、字节漂移、匹配字节的文件链接、目录/根/父目录/`.local` 链接、悬空链接、额外/声明路径 FIFO、缺失文件、首次导出父链接、文件变目录、目录变文件。初始导出和两种精确复用正常，复用不改 mtime。候选输入前后相同，外部 Docker/provider guard 调用 **0**。

原始 proof：`/private/tmp/I02-tree-spec-recheck-wwiyhgma/proof.json`，SHA256 `861bd771cbd766b1cd31d6bb0eb1ad63e930af13a83445f9725649e38dc99d2d`。同目录保存每次真实 stdout/stderr；未执行 Docker、模型、服务、凭据或业务 API。

## 原物理三口与证据保全

`createCliJobDriver` 整段与 70a2 **逐字节相同**，段 SHA256 `853c6cadb4c8541ab92322b7fd064a8222e87c1102242172b1b72735cc7310b9`。固定 host 的 registration、原 verifyDispatch、精确 job/role/registration 摘要和句柄归属仍在；image/mount/principal/consumer 不能由 job 自选。start/observe/stop 只给物理观测和原始结果，`managedClosureEligible=false`；未新增 phase、DAG、queue、retry、签发或恢复主控。当前性与实际身份仍须 P1_3 用受保护原 Comet 事实验证，不能把请求中的 currentActionBinding 或函数存在当认证。

已重算新 manifest **52 项文件 + 58 项 raw**，全部匹配；旧 **116 项文件 + 221 项 raw** 保全，其中两份变更源码按冻结 70a2 Git 原字节核验。作者 final-owned **81/81**、I01 **41/41** 的输入前后、raw/display 哈希与当前输入一致；这些是作者自检，本审查没有冒充独立重跑全套。旧失败、原 Spec P1、原 65/41 证据未改写。

## 接纳范围和后续硬边界

通过的是**点时完整 context 检查及通用物理端口建设**。尚无本轮真实构建消费者；Root/I02 后续须在实际构建边界重验同一完整快照，或以已验证机制保护其不再变化。此报告不认证一个可变目录可供任意未来 shell 使用。

保留 0.4.5 是版本方向决定，不自动授权镜像/build/bootstrap。实际 image digest、固定 host/bootstrap、OS/UID/mount、独立 principal、Edit/Shell/MCP 正负链、复制状态/并发写者/死亡恢复、原 Run 与结果接纳仍未验证。tasks I02 Step 1–10、`V_INFRA_I02`、`V_RW_RUNNER_BUILD`、`V_I02_METHOD_STATE_SCOPE` 及所有适用 129/103 义务继续保留；本次不能关闭任何整体验收。

## 确切输入索引

完整逐文件输入、物理端口比较和 UTC 索引：`/private/tmp/I02-rework-spec-inputs-20261026.json`；证据保全核对：`/private/tmp/I02-rework-spec-custody-20261026.json`。

| 输入 | SHA256 |
| --- | --- |
| r1 manifest | `f6f90a5ead89966e3d66494095909e0757b2a71e668b57338276ed8fe887e886` |
| runner.mjs | `528930d243b6e45a1d0d3242cfa6e4691ac97420ff527a04217a3698c9897caf` |
| infra-runner-isolation.test.js | `058b63279df7ce61f73f244d3e33e6d5e0734d12fc16b840a4232f653aaec6b8` |
| execution-contract.json | `680f5be65f90d68516a9b0d2129e04d7617cdfd908356fe5082b71000d7f2326` |
| tasks.md | `2ca7fb9c9fe50f96ebcdc9b159cf907cc0e1f26f45adf05a0e03b9bfa406d6a1` |
| host-port-contract.md | `a07ffef1fec5b93e3f76c0cecc2c7310975f2ef8aa2fc08850402cb053b576af` |
| 原 Spec 报告 | `0e5e8f0dbd97465c151a3f9fadecbe55b66e905d5fa5b0202f7b6255b9032516` |
| 原 P1 proof | `685abe8596734b77ff83bf292bd30adf358226a9edba0ccf567c5aef64d4f800` |

未改源码、配置、锁、权限、phase、DAG 或台账；未创建 worker/Goal。仅生成本报告、tmp 诊断证据与输入索引。临时诊断进程已 exit0，无本次遗留执行句柄。
