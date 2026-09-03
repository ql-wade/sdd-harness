# OpenSpec Workflow（Planner 前置门禁）

这份参考说明把 OpenSpec 接到原版 planner 的入口，不改变 planner 的 TDD、DAG、drift-lock 和 worktree 逻辑。

## 状态流转

```text
DISCOVER → SELECT → READY → PLAN → HANDOFF
              │        │
              └────────┴── HALT：缺 change、范围不匹配或 artifact 无效
```

| 状态 | 含义 | 允许的动作 |
| --- | --- | --- |
| `DISCOVER` | 检查仓库是否使用 OpenSpec | 读取 `.openspec.yaml`、`openspec/config.yaml`、`openspec/` |
| `SELECT` | 找到唯一且范围匹配的 change | 读取 `openspec list --json` 和候选 change |
| `READY` | change 的必需 artifacts 完整有效 | 读取 proposal/specs/design/tasks，运行 strict validate |
| `PLAN` | 生成 TDD 计划和执行交付物 | 写入同一个 `changeRoot` |
| `HANDOFF` | 计划可被另一个 worktree 接手 | 提交 changeRoot，再创建实施 worktree |
| `HALT` | 无法证明上下文或范围 | 停止，不猜测，不生成孤立计划 |

## 1. DISCOVER：确认 OpenSpec 边界

如果仓库存在以下任一项，就进入 OpenSpec 模式：

```text
.openspec.yaml
openspec/config.yaml
openspec/
```

如果不存在，才使用原版 planner 的 legacy 输出约定。不要因为当前目录没有 `.active` 就认为没有 OpenSpec；`.active` 只是快捷指针，不能替代显式 change ID。

## 2. SELECT：解析匹配 change

优先级如下：

1. 用户明确提供的 change ID；
2. 当前规划分支约定中的 change ID；
3. `openspec list --json` 中唯一与请求范围匹配的 change。

匹配必须同时满足：

- change 名称与请求主题一致；
- `proposal.md` 的范围覆盖本次请求；
- `specs/**/*.md` 或 `design.md` 描述了相关边界；
- 不与已有 change 的目标、owner 或工作树冲突。

仅凭模糊名称相似不能自动选择。多个候选必须让用户选择。

## 3. 没有匹配 change：提示、创建、暂停

不得直接写 planner 计划，也不得静默创建。应输出：

```text
未找到与本次请求匹配的 OpenSpec change。
建议名称：<kebab-case-name>
建议执行：openspec new change "<kebab-case-name>"
是否创建并进入 OpenSpec 规划？
```

用户确认后执行：

```bash
openspec new change "<kebab-case-name>"
openspec status --change "<kebab-case-name>" --json
```

创建 scaffold 后结束本次 planner 运行。下一轮先补齐 OpenSpec artifacts，再生成 TDD 计划。这样不会出现“plan 已生成但没有 change 可承载”的孤儿产物。

## 4. READY：检查 artifacts 和验证入口

读取 CLI 返回的 `changeRoot`、`artifactPaths` 和 artifact 状态；不要假设 schema 路径。通常需要：

```text
proposal.md
specs/**/*.md
design.md
tasks.md
```

执行：

```bash
openspec status --change "<change-id>" --json
openspec validate "<change-id>" --strict
```

`tasks.md` 必须包含：

- 修复前 RED / 基线复现步骤；
- 最小 GREEN 实现步骤；
- 回归验证、截图、Network/日志/DB 或其他证据；
- 每个任务的命令、预期结果和 acceptance ID。

如果 bug 需要浏览器或真实服务验证，证据放在：

```text
<changeRoot>/evidence/baseline/
<changeRoot>/evidence/final/
```

并在 `design.md` 或 `tasks.md` 中引用。证据不是 planner 的替代品，而是验收依据。

## 5. PLAN：原版 planner 的输出映射

OpenSpec artifacts 是业务上下文真源；原版 planner 只负责计划和执行准备：

```text
<changeRoot>/tasks.md                 # 唯一 canonical plan
<changeRoot>/task-dag.json
<changeRoot>/drift-lock.json
<changeRoot>/execution-prompt.md
<changeRoot>/validation-report.json
```

不要同时生成另一份 `docs/superpowers/plans/...` 作为第二份 canonical plan。`.superpowers/` 可以放临时缓存，但不能作为跨 worktree handoff。

## 6. HANDOFF：提交后再创建实施 worktree

规划 worktree A 完成后：

```bash
git add openspec/changes/<change-id>
git commit -m "docs: plan <change-id>"
```

实施 worktree B 必须从这个 planning commit 创建：

```bash
git worktree add ../<change-id>-impl \
  -b codex/<change-id>-impl <planning-commit>
```

B 只读取同一个 `changeRoot`，按 `tasks.md` 执行，并在完成后更新任务状态和 final evidence。

## 停止条件

- OpenSpec 已配置，但找不到唯一匹配 change；
- change 的 proposal/spec/design/tasks 缺失或 strict validate 失败；
- 当前请求超出 change 的 scope；
- RED 基线无法复现且没有新的验收定义；
- architecture/spec 与代码事实冲突；
- planning commit 尚未包含 changeRoot，却准备创建实施 worktree。

以上情况统一 `HALT`，提示用户补充或修订 OpenSpec，不生成孤立的 planner handoff。
