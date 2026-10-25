# I01：Spec 两项 P2 返工

仅返工原 I01，基于 `09b422b7f0147b601331010249ff4b59870b0766`；等待 Spec/Standards 双审和原控制器主集成，未接纳 I01。旧 09b 提交、报告和 33 文件 manifest 保留；逐一用 Git 09b 字节核对原 manifest，原报告文件也与当前磁盘字节一致。本目录记录新候选，不继承旧运行结果。

## 最小修复

1. `registry.mjs` 在任何资源引用查找前完整运行 `validateRefsCatalog`，只对无违规目录建立引用 Set。整个目录为 null、refs 为 null/对象/字符串、数组首尾含 null，均通过共同准入返回结构化验证拒绝；没有先行 `.some(item.ref)` 或外部工具调用。无法解析的 JSON 仍为输入无效 exit 1；已解析但目录不合法为 exit 2。
2. `secret-refs.mjs` 的全部 `deny` 分支使用常量异常 message，保留原错误 `code`。principal、role、project 或 ref 不再被拼接进拒绝异常，消除直接 API 的宿主路径回显；合法绑定仍只返回 UNRESOLVED。

只改 `tools/infra/registry.mjs`、`tools/infra/secret-refs.mjs`、`test/infra-registry.test.js` 和本新报告目录。未改正式锁、旧报告、registry 数据、24 个 refs、HTTP 历史观察、计划/DAG/台账、grant 或 ACL；未 rebase，也未应用任何建设工件依赖边建议。

## 两个独立 RED 与本轮 GREEN

| 实际 Node 命令 | UTC 开始 → 结束 | 退出/结果 |
| --- | --- | --- |
| `node --test --test-name-pattern 'registry rejects malformed reference catalogs before runtime observation' test/infra-registry.test.js` | 2026-10-25 02:41:44.456335 → 02:41:49.486915 | 1；1 项行为 RED |
| `node --test --test-name-pattern 'secret reference API denials never echo caller-supplied principal role or project paths' test/infra-registry.test.js` | 2026-10-25 02:41:43.672334 → 02:41:43.865496 | 1；1 项行为 RED |
| `node --test test/infra-registry.test.js` | 2026-10-25 02:43:09.091450 → 02:43:30.431125 | 0；38/38，0 skipped |
| `node --test test/infra-platform.test.js test/infra-knowledge-authz.test.js test/infra-runner-isolation.test.js test/infra-monitor.test.js test/infra-backup-restore.test.js test/infra-recovery.test.js` | 2026-10-25 02:43:10.023537 → 02:43:17.250172 | 0；98/98，0 skipped |

两个 RED 都在修改产品代码前完成，失败来自新断言。原 36 项（含原 shape/type/exit 合同）保留，加上两项新控制后为 38。目录控制执行六种目录形状 × 四命令 × 假 CLI/空 PATH，共 48 组合；有效目录先证明假 CLI 记录器可用，再断言无效目录没有任何外部 CLI 调用。另验证四命令解析坏 JSON 仍 exit 1。直接 API 控制覆盖 10 个宿主路径前缀 × principal/role/project，共 30 个拒绝，检查原 `code` 和 message/String(error) 无传入路径。fixture 全部 finally 清理，未读取真实凭据或运行 Outline 探针。

本轮测试 Node 为 `v25.2.1`；不是正式发行构建。两个 GREEN 捕获的七文件输入完全一致，规范输入集合摘要为 `d3173e5268d06e155906fc99594ded4662396e2b51e7358449ffc22341553000`。逐文件输入、命令、精确时间、exit code、raw stdout/stderr SHA256 和 display SHA256 均在四份 `*.run.json`。原始字节留在 `.local/I01-convergence/rework-spec-p2-r1/`；display 只脱敏宿主/fixture 路径和尾部空白。两个模块的 `node --check` 以及 `git diff --check` 实际通过。本轮按原控制器范围没有重跑已知受保护 Whitebox 总入口。

## 调用方检查与未完范围

- 当前源码中生产直接调用方为 `knowledge-authz.mjs` 与 `platform.mjs`。前者捕获并输出 code/脱敏 reason，后者的 resolver 捕获只输出 code；全部 resolver deny 分支现在共用常量 message，适用于两者及直接 API。原六套相关回归没有退化。
- 隔离基线另有范围外风险：`platform.mjs` 的 `checkRefs`（117 行 `.some`）和 credential tiers（561 行 `.find`）在 resolver 之前直接遍历目录，缺少同等目录形状前置。这是独立的 caller-owned 输入路径，静态移交 P4_1 owner；本工人未越界修改或把它当成本轮已验证通过。
- c5c538… 的三 API 元数据仍是上次已授权执行的历史观察，没有再次获取 key、执行 `.once` 或访问新 API。完整受众、24 refs 运行时授权、完整组件资格和恢复条件仍未完成。测试绿不授予 publisher/isolator/issuer 权限，也不关闭 I01 或任何业务旅程。

主控可用新候选和本目录 manifest 重新双审；原控制器决定串行接纳，工人不勾任务、不写控制状态。
