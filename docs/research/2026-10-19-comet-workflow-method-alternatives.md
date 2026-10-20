# Comet 的流程与方法类替代候选

日期：2026-10-19。范围：官方 README、文档与源码静态核查；没有安装候选、运行其测试或执行真实交付。本文不改变 ADR-0019、现有主控选择或运行配置。默认分支链接会变化，试点前须固定版本。

比较基准是 [delivery-architecture.md](../architecture/delivery-architecture.md)：单一主控拥有执行状态和恢复，Gate 只判定；需求、架构、测试设计、Coding、独立验收、发布分别成立。这里的“有代码”只表示找到实现，不等于本机通过验证。

## 判断

**在本组项目里，bmad-loop 最值得与 Comet 做主控对照；GSD Core 最值得借鉴门禁与恢复协议。** CCPM 和 Ralph 分别适合 GitHub 项目管理、简单自动迭代，但没有足够证据证明可直接承接本架构的可信交付义务。

| 项目 | 实际管什么 | 状态/恢复的已读证据 | 与本架构的主要差距 |
| --- | --- | --- | --- |
| [bmad-loop](https://github.com/bmad-code-org/bmad-loop) | 确定性 Python implementation loop | state.json、journal、run lock、恢复路径；独立执行 verify commands | 强绑 BMAD 制品；默认独立 review 有条件；不是六环节与可信发布全链路 |
| [GSD Core](https://github.com/open-gsd/gsd-core) | 多阶段流程、波次执行、上下文与门禁工具 | .planning 状态/交接；类型化 gate verdict 与 evidence；CLI 配合 workflow | 部分执行语义仍由 Agent 阅读流程落实；不能把 fresh verifier 当可信身份隔离 |
| [CCPM](https://github.com/automazeio/ccpm) | PRD→Epic→GitHub Issues→并行 agents | GitHub Issue 与本地 Markdown 的持久工作记录 | Skill 中编排；validate 是结构检查且退出 0，不能直接作为 fail-closed 交付 Gate |
| [Ralph](https://github.com/snarktank/ralph) | 小故事的重复 Agent 调用 | prd.json、progress.txt、Git；每轮新上下文 | shell 根据 COMPLETE 文本终止，builder 自改 passes；缺独立验收与完整状态协议 |

## 1. bmad-loop：本组最接近执行主控

官方把范围明确限定在 BMAD implementation phase，状态仍为 early open beta；基础前提含 BMAD 项目与 bmad-build-auto，而非仅安装一个通用任务引擎。[README](https://github.com/bmad-code-org/bmad-loop/blob/main/README.md)

静态代码证据：

- [engine.py](https://github.com/bmad-code-org/bmad-loop/blob/main/src/bmad_loop/engine.py) 实现 dev、验证、review、commit 的控制循环、有限重试与暂停；[run state](https://github.com/bmad-code-org/bmad-loop/blob/main/docs/reference/run-state.md) 描述持久 state.json、append-only journal.jsonl、engine 进程身份和 per-run 锁。恢复还绑定配置摘要；这比“重读进度继续聊”更接近运行恢复。
- [verify.py](https://github.com/bmad-code-org/bmad-loop/blob/main/src/bmad_loop/verify.py) 的 verify_dev 检查实际 spec、基线、diff 和 board；run_verify_commands 经子进程逐个执行策略命令，区分超时、未启动、中断与真实退出。这是执行器持有的检查，不只是接收 Agent 自报。
- 独立 review 确实有独立会话，但 engine.py 当前默认 review.trigger 为 recommended：由开发会话的 followup_review_recommended 决定是否启动。设置 always 才接近本架构“必有独立审查”的义务。review 还可能改产品，应视为产生新候选，而非冻结候选上的只读 Whitebox。
- run_verify_commands 只遍历配置命令；该函数本身没有“必须非空”的断言。是否必验、零测试如何阻断仍需审查 policy/preflight 和测试报告 oracle，不能因为命令退出 0 就认定满足 TestContract。

适配点不是加外层 scheduler，而是替换其制品/门禁接口：把 BMAD spec/board 与 OpenSpec/PlanBundle 的所有权讲清；利用 [plugin hooks](https://github.com/bmad-code-org/bmad-loop/blob/main/docs/plugin-authoring-guide.md) 调用无调度权 Gate。README 明确 project plugin 要显式启用；不能据此假定任意六环节都已有原生支持。

仍未证明：独立 Verifier 的可信注册身份、输入完整摘要与回执失效、远程 fencing、精确集成 SHA 的构建与部署后读回。状态文件和本机锁不能自动提供这些保证。是否能完整替换 Comet，而不把需求/架构阶段留给第二主控，需专门试点。

## 2. GSD Core：必须跟随新源，门禁细节有参考价值

[原 gsd-build/get-shit-done README](https://github.com/gsd-build/get-shit-done) 当前声明开发迁往 [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core)。本次读的是新源 next 分支；不可将旧版本经验直接投射为当前能力。

- [resume-project.md](https://github.com/open-gsd/gsd-core/blob/next/gsd-core/workflows/resume-project.md) 读取 STATE、HANDOFF.json、未完成 PLAN/SUMMARY、interrupted agent；也区分 async-job manifest 与真正未执行任务，避免把已派发外部工作重新提交。它明确要求核对 Git 状态和交接差异。不过不少恢复动作仍写成 workflow 指令，由宿主 Agent 落实。
- [gate-exit.cts](https://github.com/open-gsd/gsd-core/blob/next/src/gate-exit.cts) 已有 verdict→exit outcome 的单一映射，unreadable 不是空数据。[设计说明](https://github.com/open-gsd/gsd-core/blob/next/docs/features/gate-evidence-and-exit-status.md) 明确区分 status 与 payload 模式：payload 模式下 block 可退出 0，由调用者读取 JSON 的 block；不能直接把 shell success 当放行。
- [verify-phase-goal.md](https://github.com/open-gsd/gsd-core/blob/next/gsd-core/workflows/execute-phase/steps/verify-phase-goal.md) 聚合 security、review、regression、verifier 与输入 fingerprint；证明当前 GSD 不只是散落 prompts。
- [honest-verifier.md](https://github.com/open-gsd/gsd-core/blob/next/gsd-core/references/honest-verifier.md) 把不足以判定的项标为 unverified/human_needed，但其 AFK 策略允许带未验证项完成。SDD Harness 的必验分母不能直接继承这个完成语义；文档中的作者实验数也不是本次复现实证。

建议借鉴 unreadable/none/found 区分、回执输入 fingerprint、已提交外部作业 reconcile。若把它选为主控，应整体替代现有候选；不宜把完整 GSD 再装到 Comet 内并同时维护 .planning 和 OpenSpec 两套权威阶段。

## 3. CCPM：GitHub 可见性优于执行保证

[当前 SKILL](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/SKILL.md) 声明 PRD、Epic、Issue、并行执行与 tracking；[execute.md](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/execute.md) 让主 Agent 分析依赖、启动 agents、写 stream/execution Markdown，再根据完成情况启动队列。它会实际调用宿主任务工具，但调度规则本身是 Skill 文本。

源码中的 [validate.sh](https://github.com/automazeio/ccpm/blob/main/skill/ccpm/references/scripts/validate.sh) 检查目录、frontmatter 和引用；即使累计 errors/warnings/invalid，末尾仍 exit 0。它可作状态诊断，不能直接挂成“命令通过即验收通过”。所读执行协议还允许同一 epic worktree 的 agents 并行工作；文件范围约定不是强隔离。

可借鉴 Issue traceability/standup，不建议作为本架构恢复、门禁与发布事实的唯一后端。

## 4. Ralph：适合受控小循环

[ralph.sh](https://github.com/snarktank/ralph/blob/main/ralph.sh) 每轮启动工具、保留 prd/progress 与分支档案，但工具失败被容忍，停止条件是 stdout 包含 COMPLETE 标记。[CLAUDE.md](https://github.com/snarktank/ralph/blob/main/CLAUDE.md) 要求 Agent 自行执行检查、修改 passes；浏览器不可用时只要求记录需要人工验证。

这是清楚且小的自主迭代原语，可用于理解“新上下文+小任务+文件记忆”；它没有证明六环节基线冻结、独立 GateReceipt 或部署恢复。不能从“循环会跑完”推出“交付已验收”。

## 方法与规范层的位置

[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) 提供产品/架构/开发/评审技能，当前 README 把无人值守 implementation loop 指向独立 bmad-loop；应分别评价方法与运行引擎。

[OpenSpec](https://github.com/Fission-AI/OpenSpec) 提供 proposal/spec/design/tasks 和 archive/sync，适合继续作为规范权威；其 README 的 apply/archive 示例不构成部署、独立验收或耐久调度证明。[Superpowers](https://github.com/obra/superpowers) 适合作方法对照；本仓库 ADR-0016 仍排除其作为全局强制依赖，本次没有启用它。

## 试点需要比较的真实结果

用同一个小 Change、同一冻结测试契约、同一目标环境比较候选：中途杀进程再恢复；verifier 无证据/零测试/旧候选时拒绝；外部动作成功但回执未写时不重复执行；独立验收失败返工后旧回执失效；精确 digest 发布并独立读回。先证实这些，再比较 UI、命令数或流程阶段数。

本文仅新增研究笔记，无运行/配置变更；以上场景均尚未执行。
