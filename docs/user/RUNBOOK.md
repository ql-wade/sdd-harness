# sdd-managed-delivery 交付 Runbook（Cookbook 版）

> 面向第一次使用的人。费曼原则：每一步先说**人话**（这一步在干什么、为什么存在），
> 再给**你敲的命令**，再给**你会看到什么**。所有命令都来自真实跑通的旅程，不是设计稿。

## 它是什么（30 秒版）

想象一个只有"质检经理"的餐厅：你（点菜的人）说要做什么菜（变更），一组厨师（AI 代理）
负责做菜，质检经理（Comet 运行时）在五道关口逐一检查——菜谱你确认过吗（R）？做法经过
评审吗（A）？试菜标准定了吗（T）？备菜计划评审了吗（P）？出餐前实际尝过吗（V）？
打烊后经验记进菜谱本了吗（Kp）？——每道关都要**真实的检查记录**（收据），少一份都不放行。
全部通过，菜谱存档（归档），餐厅经验写进团队菜谱库（Kt）。

你要做的只有两件事：**在关口做决策（批准/退回）**，和**审阅最终交付物**。其余都是
厨师和管理员的事。

## 开始前（一次性，10 分钟）

| 需要 | 检查命令 | 看到 |
| --- | --- | --- |
| comet 0.5.1 | `comet --version` | `0.5.1` |
| Node ≥22.16 | `node --version` | `v2x.x`（16 不行，24 最佳） |
| 应用包 | `ls integrations/comet/application/package/application.json` | 文件存在 |
| 代理 CLI 已登录 | 打开 Claude Code 能对话 | — |

```bash
# node 退化陷阱：先锚定 node24
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
```

## 第 0 步：把"餐厅"开进你的项目（装应用）

```bash
cd /path/to/你的项目
comet application install <sdd-harness>/integrations/comet/application/package/application.json \
  --project "$PWD" --preview --json      # 预览 → 记下 confirmationHash
comet application install <sdd-harness>/integrations/comet/application/package/application.json \
  --project "$PWD" --confirmation-hash <哈希> --json   # 正式安装
```
**你会看到**：JSON 输出带 version 与 contentHash。`.comet/applications/` 出现版本目录。
**装的是什么**：一个"流程应用"——它定义了六道门的顺序和每门的验收规则。

## 第 1 步：开一个变更（一行命令）

```bash
comet state init my-change full
```
**人话**：在质检经理那里开一张新工单，选择"完整流程"。hotfix/tweak 是精简流程。
**你会看到**：`openspec/changes/my-change/` 出现，`comet status` 显示它。

## 第 2 步：写需求（proposal.md）——这是你的菜谱初稿

```bash
$EDITOR openspec/changes/my-change/proposal.md
```
写清：**Why**（为什么做）、**What Changes**（做什么）、**非目标**（明确不做什么）、
**验收**（怎么算完成）。写得越具体，后面五道门越顺。
**跳过的后果**：R 门（需求确认）会因为你自己的确认与文件不符而拒绝。

## 第 3 步：起 Run（通知质检经理开工）

用驱动脚本（推荐，全自动推进 + 在审批点叫你）：
```bash
bash tools/drive-journey.sh my-change
```
或手工逐步（命令逐条透明）：
```bash
# 写启动请求（change/changeDir 换成你的）
# 然后：
comet runtime dispatch --application sdd-managed-delivery \
  --project-root "$PWD" --request input.json --json
comet state next my-change     # 随时查看下一步
```
**你会看到**：`prepare` 动作执行 → 一个**确认等待**弹出 → 这是第一道人工审批。

## 第 4～8 步：六道门（每道门节奏相同）

每道门的循环：**代理认领 → 做该门的技能工作 → 独立代理评审 → 构造证据链 →
提交 → 运行时校验 → 通过 → 下一阶段**。你只需要在弹出等待时做决策：

| 门 | 阶段 | 你的决策 | 你批准什么 | 交付物（阶段结束时的文件） |
| --- | --- | --- | --- | --- |
| R | 需求确认 | **批准需求** | proposal 内容与你的意图一致 | gates/r 收据束；需求冻结 |
| A | 架构共识 | **批准设计** | 技术方案经多方评审一致 | design.md；gates/a 束 |
| T | 测试设计 | **批准测试设计** | 先于实现定义"怎么算对" | tests/test-contract.json；gates/t 束 |

> **T 门硬规则（升级版 test-authoring v1.1.0）**：用例先经 test-authoring 写入
> **domain-cases 用例库**（稳定 Case ID，跨变更维护）→ 投影 TestPack v1 → 门禁绑定。
> 直接手写契约 = 流程缺口（r34/snake 两轮实证未走库，已修正）。
| P | 构建计划 | **批准计划** | 任务 DAG/顺序合理 | task-dag.json；gates/p 束 |
| Build | 实现 | （代理干活） | — | 实现代码 + 测试原始日志 |

> **Build 硬规则**：可执行测试必须晋升到仓库常驻 `tests/` 目录（回归本体留在活套件）；
> 归档的是证据快照——r34 曾漏晋升，已修正。
| V | 白盒验证 | **确认验证结果** | 真实浏览器/机器证据、NOT-EXERCISED 如实列明 | verification 三件套 + 截图；gates/v 束 |
| Kp | 知识收尾 | （代理收尾） | — | closeout；gates/kp 束 |
| 归档 | 收档 | **批准归档** | 全部通过 | archive/<date>-<change>/ |

**费曼提醒**：为什么每门都要"独立评审"？——写菜谱的人不能自己试菜。门禁强制
"签收者 ≠ 作者"，这是整套系统最值钱的一条规则。

**驱动器崩溃后怎么办**：重新运行同一命令——它按 Run 当前状态自动续跑（已认领
未记录的动作会断点续记录）。

## 第 9 步：Kt（团队知识发布）——归档后

把本次交付的 closeout 经验发布到团队知识库：
- **Outline 通道**：API key（Outline Settings > API 创建）+ `documents.create` 发布到 collection，`published: true`，独立读回验证（`documents.export` 对比哈希）。
- **llmwiki 通道**：写入 `~/.sdd/wiki/<项目>/wiki/concepts/<change>.md` + reindex + 读回哈希对比。

## 第 10 步：验收（人的最终签字）

- 读 `verification-report.md` 与 `verification-results.json`
- 确认 NOT-EXERCISED 清单你知情认可
- 打开归档目录确认九件套齐全（见下表）
- **至此一次交付闭环**

## 全阶段交付物总表

| 阶段 | 变更目录内 | 门证据 | 人决策 |
| --- | --- | --- | --- |
| Open+R | proposal、状态文件 | gates/r | 需求确认 |
| A | design.md、handoff | gates/a | 设计批准 |
| T | tests/test-contract | gates/t | 测试设计批准 |
| P | task-dag.json | gates/p | 计划批准 |
| Build | 实现代码、日志 | — | — |
| V | verification 三件套、截图 | gates/v | 验证确认 |
| Kp | closeout | gates/kp | — |
| Archive | archive/<date>-<change>/ | — | 归档确认 |
| Kt | — | — | Outline/知识库授权 |

## 出问题怎么办（实证陷阱速查）

| 症状 | 处置 |
| --- | --- |
| `requires recovery` | 按错误给出的 argv 原样跑 `{operation:"next"}` 恢复 |
| Run 绑定旧版本 | 正常：升级应用后新 Run 用新版，旧 Run 绑旧包 |
| `SCOPE_HELD` | 旧 Run 的认领未释放——取消旧 Run（带 reason）或 `acknowledge-stopped`（需 claimToken，在运行时 checkpoint 里） |
| 分支绑定未记录 | 同上恢复命令跑一次即可 |
| 断线重连 | `comet runtime dispatch --application <app> --request next` |
| 写文件被 hook 拦 | 产品守卫真实生效——按拒绝信息恢复对应流程，不要绕过 |

## 升级应用（要新功能/修复时）

版本号递增 → 重编译 → `--upgrade` 两步安装。**旧 Run 继续绑旧包**（可恢复），
新变更用新版。禁止同版本号换内容。
