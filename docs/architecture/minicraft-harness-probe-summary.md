# MiniCraft 故障探针与 SDD Harness 架构优化总结

> 状态日期：2026-06-30  
> 探针项目：`/Users/mac/Code/minicraft`  
> Harness 项目：`/Users/mac/Code/sdd-harness`  
> 当前迭代：35/8（8 为软上限）  
> 结论：Harness 已能识别并阻止主要交付假阳性；MiniCraft 本身尚未通过交付验证。

## 1. 目的与边界

MiniCraft 不是本轮要手工美化或直接修好的产品，而是用于暴露 SDD Harness 缺陷的故障探针。

本轮遵循以下边界：

- 不直接为 MiniCraft 修页面、canvas 或交互效果。
- 将 MiniCraft 暴露的问题转化为通用生成契约、gate 或自动化验证。
- 不以“能 build”“测试通过”代替浏览器行为、交互和交付证据验证。
- 不允许 review、verify 未通过时继续进入 release/archive。
- MiniCraft 专属规则只能存在于 probe profile，不能污染核心 metrics。

## 2. 当前结论

MiniCraft 不是“正常生成并完成交付”的状态。

它目前同时存在两类事实：

- 工程命令正常：typecheck、159 个单元测试、production build 均通过。
- 产品与交付验证失败：调试 DOM 泄漏、canvas runaway、缺少 observation adapter、关键交互无状态跃迁证据、review 非 ready、evidence 漂移。

因此，准确表述应是：

> MiniCraft 能编译、能测试、能构建，但没有通过 SDD Harness 的运行态和交付链验证。

## 3. 九阶段交付物审计

“文件存在”不等于“交付有效”。下表分别标记形态完整度和 gate 状态。

| 阶段 | 当前交付物 | 形态 | 有效性 |
|---|---|---:|---:|
| Grill | `brief.md`、`findings.md` | ✅ | ✅ |
| Product | `proposal.md`、`acceptance-criteria.md` | ✅ | ✅ |
| Dev | `design.md`、4 份 domain specs | ✅ | ✅ |
| Test | `functional-test-draft.yaml` | ✅ | ⚠️ 未形成可信的最终 E2E 证明 |
| Code | `tasks.md`、`progress.md`、源码与单元测试 | ✅ | ❌ 52 项任务均未勾选，progress 存在陈旧事实 |
| Review | `.sdd/runs/minicraft-e7ad/review-notes.md` | ✅ | ❌ 最新 verdict 为 `needs-fix` |
| Verify | probe/evidence audit 报告 | ⚠️ 分散在 Harness run | ❌ probe 与 evidence audit 均失败 |
| Release | release note / 部署证据 | ❌ | ❌ |
| Archive | OpenSpec archive 目录 | ✅ | ❌ 在 review/verify 未通过时被提前归档 |

MiniCraft 已归档 change：

```text
/Users/mac/Code/minicraft/openspec/changes/archive/2026-06-27-minicraft-e7ad/
├── brief.md
├── findings.md
├── proposal.md
├── acceptance-criteria.md
├── design.md
├── functional-test-draft.yaml
├── tasks.md
├── progress.md
└── specs/{input,player,render,world}/spec.md
```

实际 run 目录仅有：

```text
/Users/mac/Code/minicraft/.sdd/runs/minicraft-e7ad/
├── review-notes.md
└── workflow-frame.yaml
```

缺少有效的 release 交付物、knowledge pack，以及与该 run 完整绑定的 passing verify 证据。

## 4. MiniCraft 当前故障证据

### 4.1 浏览器运行态

当前页面：`http://127.0.0.1:5173/`

| 检查项 | 实际值 | 结论 |
|---|---:|---:|
| viewport | 487 × 993 | — |
| DPR | 2 | — |
| document | 16777216 × 16777216 | ❌ runaway |
| canvas CSS | 16777216 × 16777216 | ❌ 超出 viewport |
| canvas buffer | 33554432 × 33554432 | ❌ 超出 viewport × DPR |
| 调试 DOM | `__pyramid_result`、`__voxel_scan` | ❌ 泄漏 |
| observation adapter | `__sddProbe.snapshot` 不可用 | ❌ |
| console error | 0 | ✅ |

### 4.2 关键交互

| 交互 | 要求 | 当前证据 | 结论 |
|---|---|---|---:|
| 移动 | 玩家位置发生可测变化 | 距离增量 0 | ❌ |
| 放置 | 方块计数 +1 | 实际增量 0 | ❌ |
| 破坏 | 方块计数 -1 | interaction/transition 均缺失 | ❌ |

### 4.3 工程命令

| 命令 | 结果 |
|---|---:|
| `npm run typecheck` | ✅ exit 0 |
| `npm test -- --run` | ✅ 13 files / 159 tests |
| `npm run build` | ✅ exit 0 |
| `sdd probe ... --profile minicraft --json` | ❌ exit 2 / 13 issues |

### 4.4 Workflow 与 evidence

`workflow-frame.yaml` 声明：

```yaml
stage:
  current: archive
gate:
  status: passed
```

但 `review-notes.md` 的最新权威结论为：

```text
Superpowers verdict: needs-fix
禁止进入 release / archive
```

`workflow-audit` 因此返回 exit 2，并报告：

```json
{
  "stage": "archive",
  "declaredGateStatus": "passed",
  "pass": false,
  "issues": [
    {
      "gate": "review",
      "reason": "Superpowers verdict is not ready"
    }
  ]
}
```

`evidence-audit` 已能自动从裸 change ID 找到归档 progress，但仍检测出四项真实漂移：

- 文档声称源码文件为 2，磁盘实际为 21。
- 文档包含 47、12、9、10、4 等历史测试数量，命令输出实际为 159。
- 文档声称没有 tests，但磁盘实际有 13 个测试文件。
- 文档声称没有 Vitest，但 `package.json` 已声明 Vitest。

## 5. Harness 架构优化成果

本轮没有把故障写死成 MiniCraft 特例，而是形成以下通用能力。

### 5.1 生成契约

- 新增通用 browser probeability contract。
- code 阶段必须生成可观察接口和对应回归测试。
- 生成过程未产生新测试、测试清单未变化、生成命令失败或超时，均不得推进。

### 5.2 统一探针入口

统一命令：

```bash
sdd probe \
  --project <project-dir> \
  --evidence <probe-evidence.json> \
  --profile <profile> \
  --json
```

约定：

- pass：exit 0。
- 验证失败：exit 2。
- 输入无效：exit 1。
- 输出为机器可读 JSON，并绑定 project、evidence SHA256 与 profile。

### 5.3 浏览器与交互验证

通用 validator 现在能够阻止：

- 调试 DOM 和源码级调试标记污染。
- canvas client-size → `setSize` resize 正反馈。
- document/canvas 超出 viewport 容差。
- canvas buffer 超出 viewport × DPR。
- 缺少 profile 声明的 observation adapter。
- 只有“交互通过”自述、没有 before/after 状态证据。
- profile 要求的关键 interaction 或 transition 缺失。
- move/place/break 等 profile 级语义不满足。

### 5.4 Stage gates

新增或强化：

- review gate 读取最后一个权威 verdict，忽略历史 `ready` 文本。
- verify gate 同时检查 probe 与 evidence audit。
- verify 报告必须绑定当前 project、run、profile、输入哈希和源码树。
- release/archive 重新验证最新 review 与 verify，不能复用旧 pass。
- release、archive 与 release skip 都解析活动或归档 change 的 `tasks.md`；任一 `- [ ]` 未完成任务都会阻断。
- 禁止从 verify 直接跳到 archive。
- release skip 不能绕过失败的 verify。
- `workflow-audit` 可审计历史 run，发现声明状态与真实 gate 冲突。

### 5.5 Evidence audit

Evidence audit 现在校验：

- progress、review、原始 test output 是否存在。
- Markdown 声明与实际文件数、测试数、依赖和 script 是否一致。
- package.json、源码树和全部 evidence 输入 SHA256。
- project/run 绑定是否正确。
- audit 后输入或源码改变时，旧报告自动失效。
- 活动 change 不存在时，裸 change ID 自动解析同名 archive。

### 5.6 核心与 profile 分离

- 核心 stage metrics 不包含 MiniCraft 或 Three.js 假设。
- MiniCraft 的 observation adapter、关键交互和状态断言位于：

```text
templates/sdd-harness/probe-profiles/minicraft.yaml
```

这保证同一套 Harness 可以复用于其他探针项目。

## 6. Harness 当前交付物

### 6.1 核心实现

```text
lib/
├── evidence-audit.js
├── generation-gate.js
├── probe-validator.js
├── project-test-gate.js
├── stage-gates.js
└── workflow-audit.js
```

### 6.2 契约与模板

```text
templates/sdd-harness/
├── generation-contracts/browser-probe.md
├── probe-evidence.json
├── probe-profiles/minicraft.yaml
├── stage-metrics.yaml
├── workflow-frame.yaml
├── review-notes.md
└── knowledge-pack.md
```

### 6.3 自动化测试

```text
test/
├── evidence-audit-command.test.js
├── generation-contract.test.js
├── generation-gate.test.js
├── metrics-profile-contract.test.js
├── package-contract.test.js
├── probe-command.test.js
├── project-test-gate.test.js
├── stage-gate-command.test.js
└── workflow-audit-command.test.js
```

最新全量结果：59/59 通过。

## 7. Acceptance 最终状态

| # | Acceptance | 状态 | 当前证据 |
|---:|---|---:|---|
| 1 | 自动阻止调试污染、canvas 正反馈、越 gate、证据漂移 | ✅ | Harness 59/59 |
| 2 | 统一探针入口、机器报告、正确退出码 | ✅ | JSON；pass=0、fail=2、invalid=1 |
| 3 | 无调试 DOM、canvas 受 viewport/DPR 约束、console error=0 | ❌ | console=0；其余两项失败 |
| 4 | E2E 证明移动、放置 +1、破坏 -1 | ❌ | move=0、place=0、break 缺失 |
| 5 | review/verify 或 tasks 未完成时不得进入 release/archive | ✅ | manual/skip/archive gate 测试通过；workflow-audit 捕获历史违规 |
| 6 | evidence 与磁盘和命令输出一致 | ❌ | evidence-audit 仍有 4 项真实漂移 |
| 7 | 核心 metrics 无 MiniCraft 假设 | ✅ | 专属规则位于 probe profile |
| 8 | MiniCraft build/typecheck/test/probe 全通过 | ❌ | 前三项通过，probe exit 2 |

通过 4/8，未通过 4/8。

## 8. 对旧报告的解释

仓库根目录下部分历史报告曾声明 “A1–A8 全部通过”或“最终完成”。这些文件记录的是较早阶段的判断，不能作为 2026-06-30 当前状态的 acceptance 证据。

当前结论以本文件、最新命令输出、浏览器事实和机器可读 gate 报告为准。

## 9. 建议

建议停止当前 10 分钟自动循环，原因不是 Harness 无法继续修改，而是：

- 已连续多轮没有新增顶层 acceptance 通过。
- 剩余失败集中在 MiniCraft 生成结果和历史证据本身。
- 继续为相同失败增加相邻 validator，边际收益已经很低。
- 当前 Harness 已能够稳定识别这些失败，不再把坏结果误判为完成。

如果继续推进，应开启一轮新的、受 Harness 约束的 MiniCraft 重新生成，而不是修补当前产物：

1. 从未归档状态创建新 run。
2. 使用最新 browser probeability 生成契约重新执行 code。
3. 自动生成并执行 observation adapter 与交互状态测试。
4. probe、evidence audit、review 全部通过后才允许 release/archive。
5. 保留当前 `minicraft-e7ad` 作为失败基线和回归样本。

## 10. 可复现命令

```bash
# Harness 回归
cd /Users/mac/Code/sdd-harness
npm test

# MiniCraft 工程验证
cd /Users/mac/Code/minicraft
npm run typecheck
npm test -- --run
npm run build

# 统一探针
cd /Users/mac/Code/sdd-harness
node bin/cli.js probe \
  --project /Users/mac/Code/minicraft \
  --evidence .sdd/runs/minicraft-current/probe-evidence.json \
  --profile minicraft \
  --json

# 历史 workflow 审计
node bin/cli.js workflow-audit \
  --project /Users/mac/Code/minicraft \
  --run minicraft-e7ad \
  --json

# Evidence 审计；裸归档 id 会自动解析 archive
node bin/cli.js evidence-audit \
  --project /Users/mac/Code/minicraft \
  --change 2026-06-27-minicraft-e7ad \
  --run minicraft-e7ad \
  --test-output /Users/mac/Code/sdd-harness/.sdd/runs/minicraft-current/npm-test.txt \
  --json
```
