# SDD Harness

**企业级 AI DevOps workflow wrapper** —— 用平台无关 Core 管理九阶段状态机、gate 与 evidence，再按 Adapter 和 Stage 按需接入 OpenSpec、LLMWiki、代码图谱、review、browser 与 deploy 能力。

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
npx sdd-harness init                         # 轻量 Core
npx sdd-harness init --adapter claude        # Claude reference adapter
npx sdd-harness init --adapter codex         # Codex preview adapter
npx sdd-harness init --adapter opencode      # OpenCode preview adapter
npx sdd-harness init --adapter claude --with wiki,graph,review
                                             # 显式安装重能力
# 然后在 Claude Code 里
/sdd:grill "加个用户认证功能"
```

`sdd` CLI 是唯一的 workflow control plane。Adapter 只生产 artifacts，并通过 `sdd run <stage>` 请求转换；hooks 只阻断或记录。

| 层 | 状态 | 说明 |
|---|---|---|
| Core | stable | CLI、workflow state、artifact/gate/evidence；只依赖 Node.js 与 Git |
| Claude Code adapter | reference | commands、skills、hooks 的正式行为基准 |
| Codex adapter | preview | 安装 stage skills；升级为 stable 前需完整 parity E2E |
| OpenCode adapter | preview | 安装 stage skills；升级为 stable 前需完整 parity E2E |

## 差异化（相对 cc-sdd）

- **知识闭环**：LLMWiki MCP（真实可用）—— spec→code→test→archive→knowledge
- **治理**：5 hooks + 9 gates + 12 问 reboot + artifact ownership
- **多角色**：product / dev / test 三角色显式 stage
- **release 阶段**：manual / automated / skip
- **按需依赖**：Core 默认不安装重工具；`--adapter` 与 `--with wiki,graph,review` 显式启用
- **三级门禁**：Core E2E、Claude Adapter E2E、Live Integration E2E 分层验证

## 文档

- 架构：`docs/architecture/sdd-harness-workflow-architecture.md`
- E2E 发布门禁：`docs/architecture/e2e-release-gates.md`
- LLMWiki 结构：`docs/architecture/llmwiki-structure.md`
- ADR：`docs/architecture/adr/`
- cc-sdd 对比：`docs/architecture/cc-sdd-comparison.md`

## 命令

```bash
sdd init              # 初始化轻量 Core
sdd init --adapter claude
                      # 安装 Claude reference adapter
sdd init --adapter codex|opencode
                      # 安装 preview adapter
sdd init --adapter claude --with wiki,graph,review
                      # 显式安装阶段能力
sdd init --adapter claude --skip-dependencies
                      # 只落项目文件，不修改全局依赖
sdd init --force      # 覆盖已存在文件
sdd doctor --stage verify --json
                      # 按 stage 检查能力；missing 不会被伪装成通过
sdd graph --install   # 按需装 Understand-Anything + 生成 code graph
sdd wiki init         # 重建 LLMWiki 骨架
sdd probe --project . --evidence .sdd/runs/<id>/probe-evidence.json --json
                      # 判定 Browser/Playwright 采集的 runtime evidence
sdd evidence-audit --project . --change <change-id> --run <run-id> \
  --test-output .sdd/runs/<run-id>/npm-test.txt --json
                      # 判定 progress/review evidence 是否与磁盘和命令输出一致
sdd upgrade           # 从原版 sdd-cli 升级
npm run test:e2e:core
npm run test:e2e:claude
npm run test:adapter:preview
```

License: MIT. Fork 自 [ql-wade/sdd-cli](https://github.com/ql-wade/sdd-cli)。
