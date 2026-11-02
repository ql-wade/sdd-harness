# sdd-managed-delivery 框架结构图

> 这是团队的 AI 交付基建（scaffold）：把任意软件变更沿六道管理门 R→A→T→P→V→Kp
> 驱动到归档，每道门强制独立证据链。纯净分发不含实例；框架自身的交付验证在实例/证据线。

## 目录即架构

| 目录 | 是什么 | 给谁用 |
| --- | --- | --- |
| `integrations/comet/` | 六门管理应用（SDK 组合应用 v20：bindings 门禁校验器 + 六技能组合 + 证据端口） | Comet 运行时 |
| `lib/delivery/` | 证据机器：launch authority、收据束、六门 evaluate、字节材料化 | 框架内核 |
| `lib/adapters/` | comet/claude-host/codex-host/outline/llmwiki 适配器（协议+已验证传输） | 集成层 |
| `contracts/delivery/` | 冻结 schema（收据/信封/合同/绑定） | 门禁依据 |
| `tools/` | test-cases 投影器、journey 驱动器（drive-journey.sh + journey-helpers）、foundation-export、bootstrap | 操作者 |
| `.agents/skills/` | 已升级技能（test-authoring v1.1.0 用例库通道、whitebox-verify v2.6、grill-me、planner…） | 工作代理 |
| `test/` | 门禁与证据链回归（`node --test test/`） | 回归 |
| `docs/user/` | RUNBOOK（cookbook）、STATUS（现状评估）、使用指南 | **人类从这里开始** |
| `foundation/` | 封存基线导出（Foundation lock + release，5133 文件） | 审计回读 |
| `openspec/` | 规格（specs/）与 scaffold 自身活跃 change（实例 change 不入库） | 参考实现 |

## 上手

```bash
bash tools/bootstrap.sh      # 工具链与 hooks 落地
# 然后 docs/user/RUNBOOK.md 从第 0 步开始
```

## 证据与纯净线规则

- 门证据（`.sdd/delivery/gates/{r,a,t,p,v,kp}/receipt-bundle.json`）是**项目本地运行时产物**：
  每个项目按 RUNBOOK 自己产出，不入本仓库（`.sdd/` 在 .gitignore）。
- 实例验证（历史 dogfooding：minicraft、snake 等）只在实例/证据线与项目本地存在，
  不随纯净 scaffold 分发；`openspec/changes/` 中的实例 change 一律不入库。
- 本仓库 `test/` 是框架回归；新项目的可执行测试放项目自己的 `tests/`（见 RUNBOOK）。
