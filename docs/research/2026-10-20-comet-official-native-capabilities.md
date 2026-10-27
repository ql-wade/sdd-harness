# Comet 官方 Native、Supervisor 与 Skill 扩展复核

日期：2026-10-20。范围：官方文档只读调研与本仓库固定上游源码核对；未运行模型、服务、Hook 或故障恢复。没有修改已选 Classic 架构、任务、执行状态与冻结锁。

## 1. 基线与证据界限

从 [官方 llms.txt](https://docs.comet.rpamis.com/llms.txt) 发现页面；索引自标 0.4.5。本地核对目录为 `.sdd/vendor/comet/c90af44a4474662d7853aae76ce785404974fb0a/pristine/`，其 package.json 为 0.4.5。站点内容不是由本地 commit hash 认证的冻结快照；索引版本相同不能证明逐页与该提交完全一致。下文区分文档描述、固定源码可见和未验证行为。

当前设计事实源：[交付架构](../architecture/delivery-architecture.md) §2、§6.3、§6.7；本次保留 Classic 单一主控决定，只提出复用与验收问题。

## 2. Native 原生能力此前被低估的部分

| 能力 | 官方说明 | 固定源码可见 | 未证明部分 |
| --- | --- | --- | --- |
| 状态版本与 continuation | Agent 执行返回动作；过期版本／动作拒绝 | `native-portable-verification.ts:74` 按当前 attempt、stage、actor、executionId 校验；`:101` 再绑定候选和 identity provider | 非受管客户端不能伪造、恶意同 OS 用户不可篡改 |
| 独立验收协议 | 每个新候选由新只读 Verifier 对完整范围验收；漏项重复项拒绝 | `native-verifier-protocol.ts:238` 检查 ID 集合，`:282` 检查 pass 时全部通过；`native-portable-verification.ts:203` 预留验收任务 | 角色在 OS／凭据层真正只读与隔离 |
| 实际启动确认 | dispatch 与实际开始分开 | `native-portable-verification.ts:271` 的 confirmNativePortableVerifierStart 验证执行引用并写 verifierStartedAt；Skill reference/commands.md:116 明言 dispatch 不启动进程，`:122` 要求 worker 回报 verifier-started | 内部 zcode/qoder 等宿主的可信身份适配 |
| 检查复用与补查 | 输入／命令／环境／日志有效才复用，补查由 Runtime 执行 | `native-portable-verification.ts:203` 要求 checking/completed 后才能派发；`:323` 接纳当前候选与 iteration/attempt 的结果或补查请求 | 我们全部 AC、平台部署与知识义务已纳入必需集合 |
| 返修预算 | 未解决项严格缩小才算进展；失败、执行错误、补查独立预算 | `native-loop-runtime.ts:267` 用 strictSubset 计无进展；portable types 保存三类计数 | 审查队列、跨角色 WIP、公平性和团队成本管理 |

官方依据：[Runtime 组成](https://docs.comet.rpamis.com/zh/native/runtime)、[Native Loop](https://docs.comet.rpamis.com/zh/native/native-loop)、[验证与修复](https://docs.comet.rpamis.com/zh/native/verification-and-repair)。这些是可复用源码基础，不能投影为 Classic 现成能力。

## 3. Supervisor 不只是“有多 Agent”

[官方 Supervisor](https://docs.comet.rpamis.com/zh/native/supervisor-change) 描述完整的子任务协议：AC 映射、依赖、独立 worktree、任务包／基线／runId、子项验证后集成、父目标最终验证。多会话方式由宿主运行独立 Codex 会话、Claude Agent Teams 或 subagent；Runtime 给出 readyChildren、管理状态和集成，二者不可混称。

固定源码定位：

- `native-supervisor-model.ts:174`：依赖必须 integrated，`:205` 拓扑顺序与环检测，`:225` 创建子任务状态，`:279` 生成 acceptanceScope。
- `native-supervisor-coordinator.ts:86`：默认 maxParallel=2，减去在途任务得可用容量，只派 ready／needs-reverify，创建 worktree 与随机 runId。已有容量限制，不能泛称“原生没有并发控制”。
- `native-supervisor-model.ts:377`：验证子项与 AC 结果，`:554` reconnect 必须匹配当前 runId，`:582` cancel 失效旧任务。
- `native-supervisor-coordinator.ts:167`：父最终验证必须绑定当前集成 head，所有子项 integrated 后才能 pass；`:222` 校验父工作区向前提交后的最终验收 head。
- `native-supervisor-coordinator.ts:40`：从 Git 恢复不得凭分支存在就捏造 verified／integrated。
- `assets/skills-zh/comet-native/reference/commands.md:158-173`：主会话只执行 readyChildren，不运行父 Builder；原会话丢失先取消旧 runId，再派新任务；不静默退化为单会话。

边界：这些证明本地任务协议与实现存在，不证明任意宿主真实派发、旧 worker 被撤权、跨机器 fencing、生产部署恰好一次。maxParallel 是子任务数量上限，不等于面向团队各工序的 WIP 管理。

## 4. comet-any 的五阶段 overlay 确实存在，应先检查能否复用

[Skill Creator 概览](https://docs.comet.rpamis.com/zh/skill-creator/overview) 定义两种工作流：

- `comet-five-phase-overlay`：保留 Classic 原阶段语义，8 个节点；可为节点 require／augment 方法，design／plan 可 override producer，但必须满足 Output Schema。
- `workflow-kernel`：声明新节点、state、Schema 和 Guardrail；若用于交付，将涉及另一个控制模型，不可偷偷嵌套进我们的 Classic。

**control 不能 override 的准确含义**：普通 overlay 不准替换 open／execute／verify／archive 的实现；允许 require 或 augment。它不表示原控制节点天然执行了我们定义的业务门禁。固定校验在 `domains/workflow-contract/validation.ts:124-150`，分别拒绝 control override 和缺 producer satisfies。

### overlay 与 Classic 状态关系：源码有明确委托

`domains/factory/package.ts` 生成的脚本有 overlay 专门分支：

1. `:663` 从原 `.comet.yaml` phase、计划与 overlay 证据推导当前节点。
2. `:680` 额外证据路径为 `.comet/workflow-evidence/<change>/<protocol.name>.json`。
3. `:1193` 拒绝 overlay 的 init，要求永久 `/comet-classic`／`comet-open` 创建原状态。
4. `:1200-1250` status／next 读原状态，record 只记节点 evidence。
5. `:1570` guard --apply 明确保持原 Comet state 不变，阶段推进归原 Runtime。

因此不能把 overlay 概括为“必然第二套 phase 状态机”。它可以是方法和额外证据层；kernel 分支才初始化 completedNodes/currentNode/history 等独立 workflow-run 状态。

生成包包括 `skills/<name>/reference/workflow-protocol.json`，以及 `scripts/workflow-state.mjs`、`workflow-guard.mjs`、`workflow-handoff.mjs`、`comet-plan.mjs`、`comet-check.mjs`、`comet-hook-guard.mjs`。`domains/bundle/factory.ts:134-169` 可见产物路径；portable hooks 要经 publish distribute 编译到目标平台才生效，不能复制 YAML 就宣布接线成功。[发布说明](https://docs.comet.rpamis.com/zh/skill-creator/publishing)

### 仍不能据此宣布硬门禁解决

- `factory/package.ts:1405` 的 Required Skill Call 检查，是在 `evidence.completedChecks` 中查找 `required-skill:<node>.<skill>`；`:1242` 的 record 接受输入写 evidence。它本身不能证明宿主真实调用了 Skill，或执行者身份可信。
- 对 `domains/comet-classic/` 搜索 workflow-evidence／workflow-protocol／overlay 没有命中。本次没有找到原 Classic 直接 transition／guard／archive 必须消费 overlay 证据的共同入口。此为静态调查范围内的缺证，尚非运行绕过复现。
- Output Schema 检查存在／字段与已声明检查，不自动证明业务 oracle、独立验收身份、生产读回或知识撤权合格。

对我们最有价值的候选是：用 overlay 原生 require／producer override 表达 Matt、test-authoring、Whitebox、Ponytail 的方法绑定；然后先证明直接推进不可绕过、调用来源可信、回执与原 Run 事务同生共死。若做不到，仍须当前最小受控扩展；不能新增第二调度器补洞。

## 5. 通用 Skill Engine 的边界

[Skill 与 Engine](https://docs.comet.rpamis.com/zh/skill-creator/engine) 明说 Engine 提议、约束、记录并暂停 pending；副作用由宿主／平台／人执行。deterministic 静态图可通过公开 CLI 运行；adaptive loop 可用但 CLI 未公开支持。固定代码 `domains/engine/manual-run.ts:137` 拒绝 adaptive，`:144` 冻结 Skill 快照；`domains/engine/evals.ts:4-32` 的内建 runtime check 只有 artifact_exists 与字段值比较。

可复用快照、pending 对应与 guardrails；不能把这些内建检查当作任意 AC 判定或远端发布防重复。若通过通用 Engine 再包 Classic，各自拥有 Run／pending 时必须先回答谁是业务状态权威，禁止两层自主推进。

## 6. 恢复与安全：官方边界比宣传用语更具体

[运行时保护与恢复](https://docs.comet.rpamis.com/zh/native/safety-and-recovery) 明确 Hook 只处理宿主可观察目标；IDE、后台进程、未暴露的 Shell 写入可能绕过前置守卫。Runtime 通过候选、版本和证据的后验检查补偿，**不提供 OS 沙箱**。

[Native Loop](https://docs.comet.rpamis.com/zh/native/native-loop) 还要求跨设备恢复重验，不能直接复用原设备已经可归档的结论；独立身份不足时需要揭示限制与用户决定。对我们的团队受管模式，应保持更严格的“可信身份未证明就不接受独立 V”要求，不能将上游降级确认自动视为本项目放行。

## 7. 架构复审结论

保留 Foundation 分发、Comet Classic 单主控、检查器无调度权、平台硬阻断与身份隔离。应修正的是对 Comet 能力的描述与实施前复用顺序：

1. Native 已有成熟得多的候选验证、Supervisor、并行上限与失效协议；用作对照与复用参考，不混入 Classic 宣称现成。
2. 先评估官方 overlay 的方法绑定与 producer override，避免为方法替换另造配置／生成器。
3. 在可信来源、共同推进判定、收尾义务和原事务持久化上维持现有缺口判断，除非完成静态追踪和运行负例。
4. 评审重点从“有没有这些机制”收敛到“已选 Classic 路径怎样真实接纳并强制这些机制”。

本次仅新增研究笔记，未生成／安装 overlay，未启动模型、服务或运行验收；全部能力仍需按实际宿主和固定发布产物取证。
