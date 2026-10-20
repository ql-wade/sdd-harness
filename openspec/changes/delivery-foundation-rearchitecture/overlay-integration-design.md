# 官方 overlay 优先接入：预研、合理性与剩余缺口

日期：2026-10-20。状态：用户授权的架构/计划修订候选；旧评审对应旧制品，本修订独立共识待 OVR。未安装 overlay、未派发业务角色或改变当前执行状态。

## 1. 先预研，再判断

官方资料与固定源码初审见 [官方复审报告](../../../docs/research/2026-10-20-comet-official-architecture-review.md)。随后实际调用固定 0.4.5 构建中的 package generator，并运行其生成的 state/guard 脚本；自检程序和结果为 [probe.mjs](overlay-prestudy/probe.mjs)、[results.json](overlay-prestudy/results.json)。工作区全部隔离，无真实模型、发布、账号权限或生产操作。

| 预研观察 | 结果 | 证明范围 |
| --- | --- | --- |
| overlay init | 拒绝；next 读取原 Classic phase | 与单一 phase 权威相容 |
| 缺 Required Skill 标记 | 生成 Guard 拒绝 | 标记完整性检查存在 |
| 没有实际调用 Skill，手工 record 标记且 summary=null | 生成 Guard 通过 | 原生标记/字段存在性不是可信调用/语义审查证据；项目 Gate 必须拒绝此类自报 |
| overlay guard --apply | 原状态摘要不变，无独立 Run 状态；写附加证据 | 可作方法/证据层，不能自行承担阶段推进 |
| control override 与 producer override | control 拒绝；plan 满足原 schema 后可规范化 | 不能把 verify/execute 等控制节点替换为项目 controller |
| 原生 canonical plan | 单一 authority/引用通过；第二 checkbox 被拒；勾选不改变任务定义 revision | 应复用原生计划协议，不另造任务映射或摘要规则 |

生成物 classification 为 scaffold-blocked；本实验只验证上游生成器/脚本，不是已编写完成、评估、发布、安装的业务方法包。直接 Classic 推进是否绕过 overlay、跨 Change/旧文件绑定、可信身份与恢复，仍需正式资格验证，不因预研观察闭合业务场景。

合理性裁决：**保留 Classic 单主控，overlay 用于方法绑定/产物合同/附加证据，可信 Gate 与原 Run 完成条件仍需受控扩展。** 预研支持这一分层；不能批准原版 overlay 直接接管可信验收，也没有必要为方法组合另建 workflow-kernel。

## 2. 最小目标结构与所有权

```text
Foundation / TeamAI 分发批准资产（版本、来源、schema、包摘要）
  → 原生 Comet Classic（唯一 phase/Run/允许动作/恢复）
    → 官方 five-phase overlay（方法绑定、只读路由、附加 evidence）
      → 宿主/受管 Runner 执行具体角色
      → 可信检查器核验来源、版本、分母、权限与业务结果
    ← 同一 Runtime 接纳回执、共同判定、返工/失效/恢复
  → 平台 CI/CD 与知识服务执行已授权动作并独立读回
```

overlay sidecar 不成为任务进度/批准/身份账本；阶段、job、attempt 与受控结果接纳仍归原 Run。通用 Engine 的独立 Run、workflow-kernel、planner 完整 controller 不套在 Classic 外层。Ponytail 是 advisory 方法/Hook，不通过伪造 required-skill 标记证明服从性。

## 3. 方法绑定和兼容策略

| 活动 | 官方机制优先项 | 项目保持的边界 |
| --- | --- | --- |
| 需求 R | open require/augment 澄清方法 | open control 原实现不 override；R 接纳/授权仍由 Runtime 核验 |
| 架构 A | design producer override 或 require/augment | grill-me 与独立全票共识保留；替换 producer 满足 comet.design.v1，不能自评 A |
| 测试设计 T | Design 内的 test-authoring design-only，项目命名空间的测试意图 schema | 原 R/A/T 顺序由共同谓词强制；不能只凭一个 design 节点名声称已分离 |
| 计划 P | plan producer override 与原生 canonical plan | 方法入口只生成计划/校验；不能实际加载完整 planner 再口头忽略其 controller 合同 |
| 实现 | execute/subagent-execute require/augment Matt tdd/diagnosing-bugs | control 不 override；承接原有任务协调、plan review、review-fix 和 progress reconciliation，不启动第二 controller |
| 代码审查 | 复用 review_mode 与最终 Verify 审查合同 | 不用 overlay disable 绕过项目必需审查；不叠加同范围重复 reviewer |
| 独立 V | verify require/augment Whitebox | verify control 不 override；原始报告与候选/独立 execution/必验项由可信 Gate 接纳 |
| 各方法 | Ponytail advisory augmentation、原生生命周期 Hook | 轻量复用，不降低需求/安全/测试/知识义务，不写 phase |
| 规格/知识 | archive 保留原控制路径，适配已授权动作 | Skill publish 是方法包发布，不等同 Outline 发布授权；Kp/Kt/平台义务仍决定整体完成 |

### 原生 schema 与计划权威

固定版本 design/plan schema 要求位于 Classic 配置产物根中的设计与计划 `.md`；plan 的 tasks.md 存在性在原 schema 中是 optional，项目必须额外坚持其唯一权威。使用原 `validateClassicTaskPlan`：一个 comet-task-authority 指向当前 Change/tasks.md、稳定 task ID 全覆盖、只读计划不含 checkbox。原 task revision 已排除勾选状态，不新造同义算法。历史 superpowers 目录名只是兼容产物路径，不授权安装/调用旧方法。

generated plan 只由唯一 tasks/DAG 派生；映射显式到当前 Change 和输入摘要。overlay 的通配路径存在性不能代替 state.plan/state.designDoc 的精确身份。原始 schema 和最终规范化 schema 都纳入摘要；禁止同 ID 覆盖弱化 comet.* schema 来伪造兼容，项目补充使用 sdd.* 命名空间。

### 分发与宿主接线

复用官方解析/生成/发布/平台编译能力；项目只维护批准的 overlay 定义、真实方法来源、最终 schema 和生成包摘要。生成/发布需原始内容、独立评估与批准，prestudy scaffold 不能直接分发。TeamAI、Comet init/update/distribute、项目 adapter、Ponytail 插件每个受管块一个写者，先隔离组合实证再移交。官方支持 symlink 不改变本仓库 .agents/skills 必须真实目录的约束。

计划新增的项目维护源位于 integrations/comet/overlay/；生成工作区留在忽略的 .sdd 下，不提交运行侧 sidecar、会话、凭据或调试输出。原有 0001 init 修复切片继续保留其证据；其存在不表示完整方法迁移完成。补丁必要性以资格实验实际 gap 决定，不为凑预设补丁清单修改上游。

## 4. 剩余缺口与责任

| 缺口 | 已有基础 | 必须扩展/实证 | 原任务 |
| --- | --- | --- | --- |
| 调用来源可信 | required method 标记/来源解析 | 绑定真实 dispatch/execution/候选，拒绝手工标记、空证据和作者自签 | OVQ、2.2、2.4、I02 |
| 所有推进统一约束 | 原 Classic Guard/transition/continuation | 缺方法/回执时直接转换、写入、恢复和 archive 均拒绝；sidecar 不能自行授予 pass | 1.5、2.4 |
| 产物正确归属/语义 | Output Schema 与 canonical plan | 其他 Change/旧文件/空字段/错误 oracle 拒绝，DAG 与写域保持原校验 | OVQ、1.5、2.1 |
| 版本与策略不可弱化 | 来源/hash、原生检查复用 | overlay/最终 schema/方法/包/policy 改变使相关结果失效；旧 Run 不静默换组合 | 1.2、2.2、2.4 |
| 回执持久化与事务 | 原 Run 锁/序列化/恢复 | 新记录进入原事务，sidecar 丢失/旧 attempt/并发修订不得保留无依据通过 | 2.4、3.3、4.6 |
| 上下文可用性 | 原生 handoff、hash、原文指针 | 第81行后/辅助文件的关键语义实际读取；缺内容退回正确 owner | 1.5、3.2 |
| 控制与角色隔离 | 平台 Hook 与执行引用 | OS/控制卷/发布凭据隔离，逐编辑/Shell/MCP 渠道及实际启动读回 | 1.3、I02、4.5 |
| 归档与整体完成 | OpenSpec 归档/原生恢复 | archived 不提前 completed，Kp/Kt/平台回执与原 operation 持续恢复 | 3.4、4.4、4.6 |
| 生产与知识运维 | doctor/status、平台入口、知识工具 | 精确SHA/digest、真实发布权限、未知结果调和、持续撤权、外部故障域告警 | 4.1/4.2/4.7/4.8、I06–I08 |

Native 的候选/Verifier/Supervisor/并行上限为能力对照，不记作 Classic 已实现；本修订不切换模式、不混用状态。Eval 用于方法组合可靠性和成本诊断，不能用 rubric 高分代替项目验收/团队净收益。

## 5. 任务增量与资格顺序

保留原30父任务、69工作包与92场景。新增 OVR（当前修订的独立架构评审）和 OVQ（官方 overlay 的组合/兼容资格），新增 OV01–OV08；同一 tasks/DAG 共41节点、100场景、114项 required 检查。旧完成勾选仅支持旧范围，不扩大为 overlay 已完成。

OVR 在受影响新实施前；OVQ 在剩余 P1_6 方法接入前，识别“可复用的方法合同”和“仍需修复的安全/Runtime gap”。OVQ 允许将原生 gap 作为调查结果交给 2.4，不要求先修复 2.4 才能完成调查，避免依赖循环。所有100场景最终通过仍是 VERIFY 的义务，预研结果不计为业务场景验收。

原任务调整：1.6 方法导出/初始化之后优先 overlay；1.2 锁定组合与唯一注册者；1.5 复用 canonical plan/handoff；2.4 只实现已证缺口；4.5 验原生编译与三者 Hook 共存；I02 保持可信角色与方法状态隔离。

上一执行包和摘要见 [previous-bundle.json](overlay-prestudy/previous-bundle.json)。本次显式重规划生成的是候选锁，原共识票不覆盖新制品；OVR 未完成不得把结构 guard PASS 当新架构批准。本轮不修改现有 execution-state/ledger，不新建业务控制器、Goal 或监控。
