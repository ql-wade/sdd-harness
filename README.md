# SDD Harness

**企业级 AI DevOps workflow wrapper** —— 把 OpenSpec、Trinity、Superpowers、Grill、open-code-review、LLMWiki、Understand-Anything 绑定进一个带治理与知识闭环的 9 阶段统一 workflow。

```text
SDD Harness = sdd-cli 底座 + cc-sdd 工程模式 + 治理层 + knowledge/evidence 闭环
```

## 9 阶段闭环

```
/sdd:grill → /sdd:product → /sdd:dev → /sdd:test → /sdd:code
         → /sdd:review → /sdd:verify → /sdd:release → /sdd:archive
```

| 阶段 | 干什么 | 底层 |
|------|--------|------|
| grill | 业务澄清（discovery 路由 + 术语/边界） | grill-me (mattpocock/skills) + MCP |
| product | PRD / AC / 功能测试草案 | to-prd + prototype |
| dev | OpenSpec proposal/specs/design/tasks | trinity-new/continue |
| test | 测试矩阵 → LLMWiki 用例 | LLMWiki MCP |
| code | 实现（TDD） | trinity-apply + Superpowers |
| review | 架构 + 行级 review | Superpowers + open-code-review |
| verify | 交付验证（功能 + 非功能证据） | trinity-verify + Playwright/chrome-devtools |
| release | 部署（manual/auto/skip） | deploy pipeline |
| archive | 归档 + 知识沉淀 | trinity-archive + LLMWiki writeback |

## 快速开始

```bash
cd your-project
npx sdd-harness init    # 一键全装依赖 + LLMWiki MCP + 9 skills/commands/hooks
# 然后在 Claude Code 里
/sdd:grill "加个用户认证功能"
```

### Codex 本地快速开始

```powershell
cd your-project
sdd init --platform codex --skip-dependencies
sdd run grill --slug user-auth --goal "增加用户认证"
sdd fill grill --runner auto
```

Codex 项目 skills 安装到官方发现目录 `.agents/skills/`（[Build skills](https://learn.chatgpt.com/docs/build-skills)）。初始化会在 `AGENTS.md` 中维护一个带边界标记的简短 SDD Harness 段落（[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)）；不会创建 Claude 项目目录，也不会创建或覆盖 `.codex/config.toml`。

在 Codex 对话中，`--runner auto` 会选择 `session`：CLI 将 handoff 写入 `.sdd/runs/<run-id>/`，打印应调用的 `$sdd-<stage>` skill，并以 exit 3 返回，表示等待当前 agent 执行。它不会把等待状态伪装成成功，也不会隐式调用 Claude。

需要独立 headless 进程时，显式选择 Codex runner：

```powershell
sdd fill grill --runner codex --agent-bin "C:\absolute\path\to\codex.exe"
sdd graph --refresh --runner codex --agent-bin "C:\absolute\path\to\codex.exe"
```

也可设置 `SDD_CODEX_BIN`。实际调用形式为 `codex exec --ephemeral -C <project> -s workspace-write -`。`sdd graph` 不带 `--refresh` 时仅报告健康状态，不启动 agent。

Windows 本地升级前建议备份全局安装目录和 `sdd`, `sdd.cmd`, `sdd.ps1` shim。回滚时先卸载当前包，再恢复备份目录与 shim，最后运行 `sdd --version` 和一个只读 `sdd check` 验证。不要在活跃业务仓库中做写入型 smoke test；使用临时副本或 worktree。

## 差异化（相对 cc-sdd）

- **知识闭环**：LLMWiki MCP（真实可用）—— spec→code→test→archive→knowledge
- **治理**：5 hooks + 9 gates + 12 问 reboot + artifact ownership
- **多角色**：product / dev / test 三角色显式 stage
- **release 阶段**：manual / automated / skip
- **依赖一键装**：init 真实装 openspec CLI + open-code-review + clone LLMWiki + venv + MCP 注册

## 文档

- 架构：`docs/architecture/sdd-harness-workflow-architecture.md`
- LLMWiki 结构：`docs/architecture/llmwiki-structure.md`
- ADR：`docs/architecture/adr/`
- cc-sdd 对比：`docs/architecture/cc-sdd-comparison.md`

## 命令

```bash
sdd init              # 一键初始化（装依赖 + LLMWiki + 落 SDD 层）
sdd init --platform codex --skip-dependencies
                      # 仅安装 Codex 项目资产，不安装外部依赖
sdd init --force      # 覆盖已存在文件
sdd doctor            # 健康检查
sdd graph --install   # 按需装 Understand-Anything + 生成 code graph
sdd graph             # 只读健康报告，不启动 agent
sdd graph --refresh --runner session|claude|codex
sdd fill <stage> --runner auto|session|claude|codex
sdd wiki init         # 重建 LLMWiki 骨架
sdd probe --project . --evidence .sdd/runs/<id>/probe-evidence.json --json
                      # 判定 Browser/Playwright 采集的 runtime evidence
sdd evidence-audit --project . --change <change-id> --run <run-id> \
  --test-output .sdd/runs/<run-id>/npm-test.txt --json
                      # 判定 progress/review evidence 是否与磁盘和命令输出一致
sdd upgrade           # 从原版 sdd-cli 升级
```

License: MIT. Fork 自 [ql-wade/sdd-cli](https://github.com/ql-wade/sdd-cli)。
