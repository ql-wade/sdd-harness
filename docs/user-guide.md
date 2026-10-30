# Comet 交付指南（当前状态）

> 2026-10-29：目标是 Comet 0.5.1。受管入口、共同门禁和完整用户旅程尚未验收。本文说明目前的使用边界；原 2026-10-28 操作说明已保存在本次返工快照中，不能作为当前部署或执行指南。

## 现在可以确认什么

Comet 使用外部安装的 `@rpamis/comet@0.5.1`，不要求把上游源码或构建复制到本仓库。`./bin/comet` 是临时诊断入口：从 PATH 选择第一个外部 `comet` 并检查其版本，只允许单独使用 `--version`、`--help`、`-h` 或 `help`。`doctor`、`state` 等工作流命令目前仍被该入口拒绝；`bash scripts/init-comet.sh` 也尚未开放。

使用前先确保 PATH 选中 0.5.1 和兼容的 Node（22.16 及以上的 22.x，或 24 及以上）。例如使用 nvm 时：

```bash
nvm use 24
./bin/comet --version  # 预期 0.5.1；以实际输出为准
```

命令可输出版本或帮助，只能证明有限诊断可执行，不能证明受管流程、技能调用或交付门禁通过。直接调用上游 CLI/SDK 等可能绕过该入口，**所有路径的防绕行尚未闭合**；不要将诊断包装器当作完整安全边界。

## 目标流程（待实际验证）

受管流程以 Comet 原 Run 为唯一主控；用户可从 `/comet` 路由或恢复，也可使用分阶段入口。以下是目标映射，不表示当前宿主菜单已安装或门禁已接通。

| 阶段入口 | 工作 | 退出条件 |
| --- | --- | --- |
| `/comet-open` | 需求澄清 | R：确认目标、范围和验收标准 |
| `/comet-design` | 架构与测试设计 | A：架构独立审查；T：测试设计独立审查 |
| `/comet-build` | 计划、测试自动化、TDD 实现与代码审查 | P：唯一计划；测试和审查分别留证 |
| `/comet-verify` | 独立验收 | V：当前候选和真实旅程通过 |
| `/comet-archive` | 项目知识、规格归档、团队知识 | Kp 阻归档；Kt 未完成阻整体完成 |

阶段命令须经过共同守卫，不是跳门授权；自动推进也不替代关键决定和阻塞处理。验证完成之前，不要将 `/comet-open` 描述为能够自动完成五阶段。技能可由宿主按实际安装和权限使用；文件存在不证明真实调用或独立验收。

## 事实来源

- 当前实施和状态：[HANDOFF](../openspec/changes/delivery-foundation-rearchitecture/HANDOFF.md)、[唯一任务清单](../openspec/changes/delivery-foundation-rearchitecture/tasks.md)及其执行状态和原始证据。
- 目标架构：[Comet 流程与知识收敛](architecture/comet-ai-devops-convergence.md)、[0.5.1 决策](architecture/adr/0023-comet-051-adoption.md)。
- 旧版组件或试点记录只在原范围内有效，不能作为 0.5.1 的完整业务验收。F10 跨机器 API 正向另期，保持未验证。
