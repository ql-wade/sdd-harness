# I01：统一外部输入准入返工

本候选基于 `0d4615a9a93557af41c99a5243aff1121f3a124c`，等待 Spec、Standards 及原控制器主集成复验。I01/profile 未宣称 ready，建设工件依赖边未应用。09b 的 33 文件和 0d 的 21 文件 manifest 均逐项核对对应 Git 字节，历史报告当前字节未改；见 `history-integrity.json`。

## 诊断与修改范围

先实际运行最小反馈环：roles={} 在四个 CLI 中均抛 roles.includes TypeError、exit 1、stdout 为空。产品修改前保存 `INPUT-INVENTORY.md` 和输入摘要；其后消费点复核补充在 `INVENTORY-ADDENDUM.md`。本轮没有只捕获 TypeError 转为通过。

- `secret-refs.mjs` 增加纯函数 Qualification.v1 校验：对象、必需 schemaVersion/interface、角色数组、完整八类证据、imageReference/upGate、声明字段数组均先验证类型/元素/缺失/重复。digest 格式固定为既有 SHA256 契约，畸形或可放宽格式的表达式不进入 RegExp。
- 共享 catalog options 在解构和 includes 前校验；全部目录条目、角色类型及 allowedPrincipals 先验。直接 resolver 的整个 options 和显式可选 policy 也通过统一边界。保留没有可选 policy 的旧 API；最小 SecretRef.v1 不带 schemaVersion 的既有调用仍受支持，显式未知版本拒绝。显式 null/0/空项目不等同于未提供项目。所有拒绝 message 保持常量，code 保留。
- `registry.mjs` 的四个命令在读取 policy 字段之前走同一准入；未知/不消费的 CLI options、重复或缺失参数也在工具调用前拒绝。registry 的 runtimeRequirement/image/显式 null delegates 和诊断 id 不再提前发生隐式转换。
- optional archive/npm metadata 和已提供 lock 的被消费字段在 runtime observation 前预检；非法形状返回结构化 exit 2，文件/JSON 输入错误保持 exit 1。缺锁、缺 pin 或合法但证据不足仍是 UNVERIFIED。lock/metadata 解析与摘要使用同批读取字节；license 必须实际绑定非空 version/integrity，不能因两端都为 undefined 而验证。
- `registry.schema.json` 同步已实现的非空字段约束。仅以上两个实现文件、schema、原测试文件及本新证据目录有改动；未增加依赖、状态机、主控或新常驻进程。

## 实际 RED 和最终 GREEN

本轮 RED 均通过现有公开 CLI 或公开 validator/resolver API 执行；原始字节、精确 UTC、输入集合和退出码见 `run-results.json`。既有 38 项保留，加三项新公开 seam 控制，共 41 项。

| 反馈环 | 实际结果 |
| --- | --- |
| 最小 roles 对象，validate/status/qualify/up，空 PATH | 四条均 exit 1 / TypeError / stdout 空，已保存 stderr 原始证据 |
| 全 policy CLI 矩阵 | 行为 RED；73 种畸形 policy × 四命令=292，加 bad-ref/空 PATH 组合32，共324种拒绝；修复后全部满足 policy 结构化拒绝且外部 CLI trace 为零 |
| 共享 API policy/options/iterable | 独立行为 RED；覆盖显式 policy、options null/非对象、roles 和主体数组元素/缺失/重复/版本，以及直接 resolver |
| 可选输入和后续消费点补充 | 分别真实 RED：runtimeRequirement、image/CLI/file 输入；lock 类型和 package/source 字段；缺绑定 license；null delegates/id 对象；显式空项目 |
| `node --test test/infra-registry.test.js` | 最终 **41/41**，exit 0，0 skipped；2026-10-25 **03:28:22.611271 → 03:29:10.619264 UTC** |
| 六套原基础设施关联回归 | 最终 **98/98**，exit 0，0 skipped；2026-10-25 **03:28:20.947272 → 03:28:27.504285 UTC** |
| 两个模块 `node --check`、`git diff --check`、受控 JSON parse | 实际通过；未重跑已知受保护 Whitebox 总入口 |

六套关联命令为 `node --test test/infra-platform.test.js test/infra-knowledge-authz.test.js test/infra-runner-isolation.test.js test/infra-monitor.test.js test/infra-backup-restore.test.js test/infra-recovery.test.js`。Node 实际为 v25.2.1；未升降全局版本，不是正式发行构建验收。

最终两组使用完全相同的七文件输入，集合摘要 `6445614a31276dd708a8fafda24fc9a9bd6966a00371dc37ebcc93469d9301ea`。两组在执行前分别校准五个私有离线拦截器：都记录对应命令、只返回固定错误和 exit 127，随后清空校准 trace。最终 registry 回归拦截 gh=2/docker=9/npm=9，关联回归拦截 docker=1；产品 CLI 真实执行，这些真实依赖和服务 API 没有执行。各测试自己的私有假 CLI 和空 PATH 负例保持原断言。

首轮回归虽然 41/98 为绿，但其离线记录器使用 CommonJS require，在 ESM 包内报错而没有记录拦截；该问题已实际确认。首轮 raw 和摘要完整保留并标记为非最终证据，最终只使用完成校准的 r2。未以记录器问题掩盖产品结果，也没有放宽断言。

fixture 全部 finally 清理。raw 在 `.local/I01-convergence/rework-policy-shape-r1/`；display 仅做宿主/fixture 路径和尾部空白规范化，原始/显示 SHA256、字节数及原记录 SHA256 均可核对；空流显式记录零字节而不伪造文件。归档 worktree 前需保全 ignored 原始证据。

## 未完成和边界

- Spec/Standards 双审、原控制器串行主集成与集成后复验尚未完成。本工人不写任务/DAG/台账，不应用 I01 建设工件边。
- platform 自有 refs `.some/.find` 提前访问仍交 P4_1 owner，未越界修改；其它领域的 policy 不是 Qualification.v1，未冒充本轮已验证。
- 没有再次读取 key、执行一次性 Outline 探针或获取新的 API 观察。c5c538… 是原历史元数据，未刷新。24 个运行时 refs、完整受众、动作授权、完整组件资格和恢复条件仍未完成；publisher/isolator/issuer 权限未授予。
- 官方锁、主检出、全局 Node、权限/ACL/grant、原计划及所有旧报告保持原样。局部回归不替代同 Run 完整旅程。
