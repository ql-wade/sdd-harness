# sdd-managed-delivery 框架结构图

> 这是团队的 AI 交付基建（scaffold）：把任意软件变更沿六道管理门 R→A→T→P→V→Kp
> 驱动到归档，每道门强制独立证据链。自己吃狗粮验证过的两个完整示例在内置 demos/。

## 目录即架构

| 目录 | 是什么 | 给谁用 |
| --- | --- | --- |
| `integrations/comet/` | 六门管理应用（SDK 组合应用 v20：bindings 门禁校验器 + 六技能组合 + 证据端口） | Comet 运行时 |
| `lib/delivery/` | 证据机器：launch authority、收据束、六门 evaluate、字节材料化 | 框架内核 |
| `lib/adapters/` | comet/claude-host/codex-host/outline/llmwiki 适配器（协议+已验证传输） | 集成层 |
| `contracts/delivery/` | 冻结 schema（收据/信封/合同/绑定） | 门禁依据 |
| `tools/` | test-cases 投影器、journey-helpers、foundation-export、bootstrap | 操作者 |
| `.agents/skills/` | 已升级技能（test-authoring v1.1.0 用例库通道、whitebox-verify v2.6、grill-me、planner…） | 工作代理 |
| `test/` | 门禁与证据链测试（66+，全部绿） | 回归 |
| `docs/user/` | RUNBOOK（cookbook）、STATUS（现状评估）、使用指南 | **人类从这里开始** |
| `foundation/` | 封存基线导出（Foundation lock + release，5133 文件） | 审计回读 |
| `openspec/` | 规格与工作流状态（纯净 scaffold：实例验证在新项目按 RUNBOOK 进行） | 参考实现 |

## 上手

```bash
bash tools/bootstrap.sh      # 工具链与 hooks 落地
# 然后 docs/user/RUNBOOK.md 从第 0 步开始
```

## 完整性

- 六门证据：`.sdd/delivery/gates/{r,a,t,p,v,kp}/receipt-bundle.json`（两轮交付）
- 六门收据束：`.sdd/delivery/gates/{r,a,t,p,v,kp}/`（框架自举交付）
- 实例验证（minicraft r34、snake r2：六门+归档+Kt 双通道+截图）在实例验证线，
  不随纯净 scaffold 分发——新项目按 RUNBOOK 产出自己的实例证据
