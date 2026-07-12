# SDD Harness

SDD Harness 是一个打包即用、可执行的 workflow governance toolchain，其核心是一套 framework protocol。它把已有的开源与本地 agent 开发工具绑定进一条受治理的统一路径，不替代任何工具的原生职责。

## Language

**SDD Harness**:
打包即用、可执行的 workflow governance toolchain，面向 AI 辅助的软件交付，背后是一套管 artifact、context、gates、hooks、evidence、adapter 边界的 framework protocol。
_Avoid_: PAV2 wrapper、项目专属 harness

**Framework Protocol**:
一套稳定契约，定义 artifact ownership、context pack、workflow frame、gates、hooks、evidence、writeback 与 adapter 边界。
_Avoid_: 纯文档 spec、松散约定

**Executable Toolchain**:
让 framework protocol 在项目里跑起来的可安装命令、skills、hooks、MCP server、模板与默认 adapter。
_Avoid_: 参考笔记、手工 checklist

**Platform-Neutral Core**:
不依赖特定 agent host 的 `sdd` CLI、workflow state、artifact contract、gate 与 evidence 逻辑。所有正式 adapter 必须通过同一套 core contract 和跨平台 E2E 测试。
_Avoid_: Claude 专属内核、平台分叉状态机

**Reference Adapter**:
最先完整实现并作为 adapter contract 行为基准的平台集成；当前唯一的 reference adapter 是 Claude Code。
_Avoid_: 默认平台、唯一可用平台、平台无关内核

**Preview Adapter**:
已经提供安装资产，但尚未通过完整 adapter contract 与 E2E parity 验证的平台集成；当前 Codex 与 OpenCode 属于 preview。
_Avoid_: 正式支持、功能等价、不可用

**Core E2E**:
在隔离的临时仓库中通过真实 `sdd` CLI 和确定性 fake adapters 走完九阶段 workflow 的测试，是每个 PR 的硬门禁。
_Avoid_: 单元测试、外部集成测试、命令快照测试

**Reference Adapter E2E**:
验证 reference adapter 的 commands、skills、hooks 与 CLI control plane 之间完整契约的测试，是合入主分支的硬门禁。
_Avoid_: 模板存在性测试、core workflow 测试、live provider 测试

**Live Integration E2E**:
在获准的真实项目上调用实际 OpenSpec、agent host、LLMWiki、代码图谱、review、browser 和 deploy adapters 的全链路验证。它按夜执行，并且是正式版本发布前的硬门禁。
_Avoid_: fake adapter 测试、冒烟命令、允许工具缺失仍通过

**Canonical Spec Engine**:
SDD Harness 内部以 OpenSpec 为底的、强制使用的 formal change truth 来源。
_Avoid_: 可选 spec adapter、可替换 spec 后端

**Canonical Change Truth**:
OpenSpec 的 change 目录，在其中为某个 change 开发 active proposal、delta specs、design、tasks 与 Trinity tracking 状态。
_Avoid_: runtime run 状态、accepted domain 仓库

**Canonical Accepted Spec Truth**:
OpenSpec 的 domain spec 树，archive 后在此保存 accepted behavior。
_Avoid_: draft PRD、active change delta、evidence 存储

**Workflow Executor**:
以 Trinity 为底的强制执行层，推进 OpenSpec change 并维护持久的 tracking 状态。
_Avoid_: 可选 task runner、临时执行脚本

**Workflow Control Plane**:
`sdd` CLI 是唯一有权创建或恢复 run、执行最终 gate、以及修改 `workflow-frame` 中 stage、history 和 status 的控制面。平台 command、skill 与 agent adapter 只生产 artifact 并请求状态转换；hook 只阻断或记录。
_Avoid_: skill 直接推进 stage、slash command 自有状态机、hook 修改 workflow 状态

**Trinity Skill Architecture**:
强制使用的、基于 skill 的执行架构，把 OpenSpec lifecycle 操作包装成可重复的 new、continue、apply、verify、archive workflow。
_Avoid_: 独立 workflow 引擎、自研 task runner

**Stage Contract**:
对一个 workflow stage 的显式映射，说明哪个 command 进入它、哪个 wrapper skill 拥有它、可调哪些底层 skill、可用哪些 MCP 能力、读写哪些 artifact、必须通过哪个 gate。
_Avoid_: 隐式 phase 行为、口口相传的 workflow 知识

**Attention Constraint**:
强制的 reboot 契约，让 agent 始终对当前 project、架构入口、domain、与架构的关系、subfeature、stage、目标、已学事实、已完成工作、允许的操作保持定位。
_Avoid_: prompt 提醒、可选 checklist、对话记忆

**Reboot Test**:
agent 在做出重大决策、写 artifact 或声明完成之前，必须能从 SDD Harness 文件回答的那组问题。
_Avoid_: 状态摘要、自由格式 progress 笔记

**Domain Spec Repository**:
OpenSpec 的 `specs/` 树，change archive 后按业务或技术 domain 保存 accepted requirements。
_Avoid_: run artifact 存储、扁平 backlog、临时 change 产出

**Domain**:
用于组织长期 OpenSpec spec 的稳定产品/工程责任区域。
_Avoid_: 文件夹标签、实现 package

**Domain Registry**:
项目强制声明的 domain 列表，控制长期 OpenSpec spec 可以在哪里创建或更新。
_Avoid_: agent 自造的文件夹列表、不受控分类

**Domain Discovery**:
在人工确认前，从结构化代码事实与知识源（Understand Anything、LLMWiki、DeepWiki）辅助提出 domain 的过程。
_Avoid_: 自动创建 domain、纯手工设置
