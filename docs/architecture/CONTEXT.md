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
