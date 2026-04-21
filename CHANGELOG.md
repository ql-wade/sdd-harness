# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.2] - 2026-04-21

### Fixed
- **trinity-apply 追踪文件强制更新**：AI Agent 执行任务时不再跳过追踪文件更新
- 通过 Autoresearch 4 轮优化（28→40 分）强化追踪执行机制
- 新增 PRE-TASK GATE：开始新任务前检查上一个 TRACKING RECEIPT
- 新增 POST-TASK GATE：3 步 READ-BACK 验证（写后读回确认）
- 新增 HARD STOP：追踪未完成前禁止编写新代码
- 新增 TRACKING RECEIPT：任务间强制凭证 + 虚假报告警告
- 新增 FINAL VERIFICATION：阶段结束审计协议
- 修复 CLI `VERSION` 常量未与 `package.json` 同步的问题

### Changed
- `trinity-apply` SKILL.md v2.2 → v2.3（autoresearch 优化）
- Claude Code + OpenCode 双模板同步更新

## [2.6.0] - 2026-04-21

### Added
- `sdd init` 自动安装前置依赖（openspec CLI、planning-with-files、superpowers）
- `sdd doctor --fix` 一键修复所有问题
- 前置依赖检测逻辑（`ensureDependencies()`）

### Changed
- README 添加 OpenSpec CLI 到前置依赖表
- `doctor` 命令安装提示修正：`npm install` → `brew install openspec`

## [2.5.0] - 2026-04-20

### Added
- `sdd cleanup` command - 清理项目历史残留命令（hybrid-*, opsx-*）
- `sdd doctor` command - 诊断 SDD 工作流健康度
- `--dry-run` option for init/cleanup - 预览安装/清理结果
- `--platform` validation - 拒绝无效平台名（只接受 claude/opencode/both）
- sdd-init 自动清理旧命令文件（hybrid-*.md, opsx-*.md）

### Changed
- sdd-new.md: schema 名称 `trinity-workflow` → `trinity-workflow-v2`
- 所有 sdd-*.md commands: 重写为 skill 触发器（解决命令面板拦截问题）
- .npmrc: NPM Token 改为环境变量引用

### Fixed
- sdd-new.md 中 `--schema trinity-workflow` 错误（应为 trinity-workflow-v2）
- 移除未使用的 `ora` 依赖
- 修复 CHANGELOG v2.3.1 条目（commands 复制逻辑已恢复）

### Security
- 修复 NPM Token 硬编码泄露问题

## [2.4.0] - 2026-03-27

### Added
- **Critical Rules for Archive**: 强制归档规则，防止 specs 丢失
- **Specs Extraction Verification**: 归档后自动验证 specs 提取
- **Manual Extraction Fallback**: 手动提取 specs 备用方案
- **INDEX.md Generation**: 持久化 specs 目录索引生成

### Changed
- `trinity-archive` skill v2.3 → v2.4
- `schema.yaml` 新增 `postArchive` 和 `criticalRules` 配置

### Fixed
- 修复 AI 直接使用 `mv` 命令导致 specs 未提取的问题
- 归档后 `openspec/specs/` 目录不存在的问题

## [2.3.1] - 2026-03-25

### Fixed
- Fix init command error when commands directory doesn't exist

### Changed
- Simplify commands copying logic

## [2.3.0] - 2026-03-25

### Added
- **contextFiles support**: Trinity Skills now read project context from `contextFiles` config
- Phase 0 in all Trinity Skills: Load project context before any operations
- `openspec/project.md` support for project-level context injection

### Changed
- Only support `trinity-workflow-v2` schema (removed `trinity-workflow` and `hybrid-workflow`)
- `config.yaml` now includes `contextFiles` configuration section

## [2.2.6] - 2026-03-24

### Added
- Worktrunk config (wt.toml) support
- Copy wt.toml to .config/ during init
- Pre-switch: sync OpenSpec specs from origin/main
- Pre-merge: run tests before merging
- Post-switch: hint for start Agent
- Post-merge: notify when merge complete

## [2.2.5] - 2026-03-23

### Fixed
- Correct archive path from `openspec/changes/archive/` to `openspec/archive/`

## [2.2.4] - 2026-03-22

### Fixed
- Add missing artifact templates for trinity-workflow-v2 schema

## [2.2.3] - 2026-03-21

### Added
- Publish to GitHub and npm

## [2.2.2] - 2026-03-20

### Added
- Three Principles for AI-Driven Development
- Update README with core philosophy
- Add English documentation

## [2.2.1] - 2026-03-19

### Fixed
- Fix brainstorming skill reference (superpowers/brainstorming)
- Update README with core philosophy description

## [2.2.0] - 2026-03-18

### Changed
- Clarify tracking file location (openspec/changes/{change-id}/)
- Remove .trinity directory creation logic

## [2.1.0] - 2026-03-17

### Added
- Three-phase architecture: planning-with-files → OpenSpec CLI → planning-with-files
- Each operation updates tracking files via planning-with-files

## [2.0.0] - 2026-03-16

### Added
- Trinity Workflow v2 schema
- Planning-with-Files integration as context anchor
- Delta Specs mechanism
- Profile mode auto-selection
- 3-Strike protocol integration
- Multi-platform support: Claude Code + OpenCode

## [0.4.1] - 2026-03-15

### Added
- Initial version
- Trinity Workflow v1
- Hybrid Workflow support