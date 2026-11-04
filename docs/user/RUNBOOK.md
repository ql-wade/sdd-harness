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
# node 退化陷阱：先锚定 node24（有 nvm 用 nvm，没有就取最新 v2x）
nvm use 24 2>/dev/null || export PATH="$(ls -d "$HOME"/.nvm/versions/node/v2*/bin | sort -V | tail -1):$PATH"
# comet 只装在某个特定 nvm 版本的 global bin——锚定后可能丢 comet（sdd-test 实证）
command -v comet >/dev/null 2>&1 || { echo "comet 丢了：把装了 comet 的那个版本 bin 加回 PATH"; exit 1; }
comet --version
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

## 第 1 步：开一个变更（建目录，不要跑 state init）

```bash
mkdir -p openspec/changes/my-change
```
**人话**：变更 = 一个目录 + 一张 Run 工单。目录现在建；Run 在第 3 步由驱动器启动时
自动登记给 sdd-managed-delivery 应用。
**陷阱**：不要运行 `comet state init`。git 仓库里它默认 `runtime=sdk`，会把变更绑给内建
应用 classic-full，第 3 步的应用 start 会报 `Classic change 已归属另一个应用`；
`--runtime compat` 同样写归属，不是出路；且 init 写的 comet-state.yaml 嵌有不带
application_checkpoint 的 run_checkpoint，任何应用都无法导入（报 `Classic portable
checkpoint requires its original fixed Application package`）。误绑后无 CLI 恢复命令，
只能外科手术（见陷阱表）。

## 第 2 步：写需求（proposal.md）——这是你的菜谱初稿

```bash
$EDITOR openspec/changes/my-change/proposal.md
```
写清：**Why**（为什么做）、**What Changes**（做什么）、**非目标**（明确不做的）、
**验收**（怎么算完成）。写得越具体，后面五道门越顺。
**跳过的后果**：需求确认门（R）会因为你自己的确认与文件不符而拒绝。

> **双轨验收 AC 约定（§7 增补 A）**：每个特性（F-ID）的验收节写**两轨**——
> ≥1 条**机制 AC**（可判定 pass/fail 的条件/度量/可执行 check）+ ≥1 条**体验 QC**
> （GWT 单行为：Given/When/Then，Then 必须是可观察结果）。每条标注 verification route
> （test / inspection）。写不出验证条件的条目显式 `unresolved`——散文混不过门。
> 门只查存在性 + 可验证性，不查措辞完美（防 stage-gate 化）。

## 第 3 步：起 Run（通知质检经理开工）

用驱动脚本（推荐，全自动推进 + 在审批点叫你；审批输入接受 approved / 同意 / y / yes）：
```bash
export SDD_SESSION_ID="$(uuidgen)"   # 本次任务的稳定标识；断点续跑重跑时保持同一个值
bash tools/drive-journey.sh my-change
```
驱动器会自举全部 Run 状态（输入形状、初始状态、owner 登记都由它代写）。手工
`comet runtime dispatch` 需要完整请求形状（`runId` / `workflow{id,version}` / `input` /
可选 `initialState`，缺一即 INVALID_REQUEST）——仅排障时用，日常不提供手工配方。
**你会看到**：`prepare` 动作执行 → 一个**确认等待**弹出 → 这是第一道人工审批。

## 第 4～8 步：六道门（每道门节奏相同）

每道门的循环：**代理认领 → 做该门的技能工作 → 独立代理评审 → 构造证据链 →
提交 → 运行时校验 → 通过 → 下一阶段**。「构造证据链」用框架工具（别手搓）：

```bash
node tools/gate-bundle.mjs --project "$PWD" --gate R --action my-change:19 \
  --claim <claim.json> --open-evidence <open证据事件.json> \
  --args <args.json>          # {reviewerTranscript, reviewerId, statement, hostSession, taskIds}
```
先 `--check-only` 预校验（真实受保护端口本地验证，不过不落盘），通过后落盘束与
record-outcome 载荷再提交。前提：claim 必须来自带 `--session-id`（UUID）的认领；
独立评审者 ≠ 代理作者（签收者≠作者）。`.comet/delivery-authority.json` 是**按门合并的
entries**（每门一条 secret，工具自动保留前面门的条目）——手工覆盖成单条目会让
outcome sweep 重准录先前门时 FORGED_COLLECTION 卡死整个 Run（r3 实证，别手改）。

> **构建计划门（P）配方（r7 实证）**：构造加 `--plan-bundle <planBundle.json>`（SDD.Delivery.PlanBundle，
> schemaVersion 必填）——inputs 自动挂 planSources（tasks/dag 绑定），评审绑定自动携带
> change/planDigest/tasksDigest/dagDigest（planGate 复检项）。canonical 计划契约：plan 单标记
> `comet-task-authority` + 0 复选框 + 每 task `comet-task-ref`；tasks.md 每个 checkbox 须
> `comet-task:<id>` 且 id 不含点（`1.1` 非法 → `1-1`）。
> **evidence submissionId 官方配方**：`${change}:${kind}:epoch-${checkEpoch}:${evidenceId}:${sha256(ref\n+hash).slice(0,16)}`——跨 epoch 复用旧配方触发超级拒绝。
> **评审者转录锚定**：必须在 `~/.claude/projects/` 下且名为 `<id>.jsonl` 或 `agent-<id>.jsonl`
> （其他位置不被佐证）。宿主转录任意大小可佐证（流式扫描，无大小上限）。

> **门内修订的通用机制（每个门内建，需求确认/架构共识实证）**：workflow 契约里每个扩展门的
> verdict 词汇都是 `pass / repair / revise-requirements`。录
> `verdict:'revise-requirements'` → 运行时重置 designDoc/plan/handoffContext +
> phase:open → **同一 Run 从 composition.prepare 全旅程重放**（classic-application.js:386-404），
> 修订后的工件在重放中重新 handoff（`tools/design-handoff.mjs` 双回执）→ 重新
> document/evidence（新哈希）→ 正式 consensus → A 束一次过。修订 outcome 载荷免束：
> `node tools/gate-bundle.mjs --project "$PWD" --gate A --verdict revise-requirements \
>   --action my-change:N --claim <claim.json> --reason "consensus revisions"`。
> **已过扩展门之后需要修订**（如 build 相位 claim 被 sweep 拒，r6 实证）——走 workflow 命令门，
> 无需在手动作（命令与步骤由运行时在应用构造时程序化添加，静态 workflow.json 看不到属正常）：
> `node tools/gate-bundle.mjs --project "$PWD" --gate A --verdict \
>   revise-requirements --claim <claim.json> --reason "consensus-approved design revisions"` 产出请求文件 →
> `comet runtime dispatch --application sdd-managed-delivery --project-root "$PWD" \
>   --request .sdd/delivery/gates/a-revise-command.json --json`。
> **input 必须携带非空 reason**（命令校验器要求，null 直接拒）。
> 单次循环内 evidence 提交后 design.md 仍冻结——要改就走 revise 重放，**不要手工碰哈希**：
> `revise-design`（app-owned 被组合检查拒）、`invalidate-evidence`（已解决等待不可作废）、
> 重交同哈希 outcome（永久拒）三条手工路径确认死路（r4 实证）。
> 你只需要在弹出等待时做决策：

| 门（代号） | 阶段 | 你的决策 | 你批准什么 | 交付物（阶段结束时的文件） |
| --- | --- | --- | --- | --- |
| 需求确认（R） | 需求确认 | **批准需求** | proposal 内容与你的意图一致 | gates/r 收据束；需求冻结 |
| 架构共识（A） | 架构共识 | **批准设计** | 技术方案经多方评审一致 | design.md；gates/a 束 |
| 测试设计（T） | 测试设计 | **批准测试设计** | 先于实现定义"怎么算对" | tests/test-contract.json；gates/t 束 |

> **测试设计门（T）硬规则（升级版 test-authoring v1.1.0）**：用例先经 test-authoring 写入
> **domain-cases 用例库**（稳定 Case ID，跨变更维护）→ 投影 TestPack v1 → 门禁绑定。
> 直接手写契约 = 流程缺口（试点轮次实证未走库，已修正）。
>
> **T 门全链路（v2.5：domain-cases → 投影 → 纳管 → 束）**：
> ① 用例库正本 `tests/domain-cases/`（features.md 特性登记表 + F-ID 注册为
> requirement-kind basis 条目，:160 per-F-ID 覆盖强制）→ ② 变更投影
> `<changeDir>/tests/`（compile-domain-cases：`--bind-specs` 晋升后 spec 键校验、
> `--promote` features.md spec 绑定列晋升、覆盖矩阵自动生成进 testPack）→
> ③ T 门束构造（gate-bundle `--gate T --test-contract <file> [--feature-map features.md]`）：
> 构造期机械复验（盘上 pack digest / 投影重算深比较含矩阵 / 矩阵专属条目 digest），
> **三 ref 快照**（束 + test-pack.snapshot + test-contract.snapshot）写 `.sdd/delivery/gates/t/`
> 并入 outcome artifactHashes。**篡改检测分两段**：构造期拒的是 **② 盘上产物**篡改
> （改 `tests/` 下 pack/config 再 `--check-only` 必拒）；**.sdd 三 ref 快照**的篡改检测
> 在 **record 期 sweep**（逐条哈希比对，需活 Run 提交时触发）。投影约定：② 产物一律由
> compile-domain-cases CLI 产出（CLI 注入 DOMAIN-CONFIG 绑定 ② config 字节，构造期复验
> 与 V 重算同式复刻该装配）——勿用进程内直编译产物混入 ②。
> **`--test-contract` 仅 T 门接受**（其余门传入即拒，拒收落在构造期）。
> **V/Kp 契约来源 = T 快照链同源重构**：V/Kp 构造前必须已有
> `.sdd/delivery/gates/t/test-contract.snapshot.json`（T 构造落盘）——缺席即构造期
> 响亮拒（先完成 T），畸形亦拒；快照自动注入 `inputs.testContract`，无需也不得传旗标。
> KB 纳管：发布 llmwiki 后落
> `.sdd/delivery/gates/t/kb-publish-receipt.json`（非强制；在场则校验 Run 绑定 + 正本
> digest，比对脚本 `tools/test-cases/verify-kb-receipt.mjs`；llmwiki MCP 恢复前页读回
> 用人工导出文件）。
| 构建计划（P） | 构建计划 | **批准计划** | 任务 DAG/顺序合理 | task-dag.json；gates/p 束 |
| 实现阶段 | 实现 | （代理干活） | — | 实现代码 + 测试原始日志 |

> **Build 硬规则**：可执行测试必须晋升到仓库常驻 `tests/` 目录（回归本体留在活套件）；
> 归档的是证据快照——历史轮次曾漏晋升，已修正。
| 白盒验证（V） | 白盒验证 | **确认验证结果** | 真实浏览器/机器证据、NOT-EXERCISED 如实列明 | verification 三件套 + 截图；gates/v 束 |
| 知识收尾（Kp） | 知识收尾 | （代理收尾） | — | closeout；gates/kp 束 |
| 归档 | 收档 | **批准归档** | 全部通过 | archive/<date>-<change>/ |

> **V 门人类验收 charter 约定（§7 增补 B）**：验收不是橡皮图章——一页 charter session：
> `Explore <F-ID> With <入口/工具> To discover <风险>`（30–60 分钟 timebox，验前声明
> 测试数据与环境）；session sheet 实时记 BUG/OBSERVATION/QUESTION 三标签；收尾五问
> （charter 完成度 / 意外发现 / 阻塞 / 后续 charter / 可升级为回归用例的发现——PROOF
> 语义项目裁剪版）。**证据三元组**：check-id + 期望引用（AC/QC）+ 评审决定，缺一不算
> 证据；**known-issues 显式清单**（禁止静默豁免）+ 显式 go/no-go。发现可复现问题 →
> 升级为机制 AC 回 R 门双轨。机械强制随 V/Kp 另案（本变更只落约定）。

**费曼提醒**：为什么每门都要"独立评审"？——写菜谱的人不能自己试菜。门禁强制
"签收者 ≠ 作者"，这是整套系统最值钱的一条规则。

**驱动器崩溃后怎么办**：重新运行同一命令——它按 Run 当前状态自动续跑（已认领
未记录的动作会断点续记录）。

## 第 9 步：Kt（团队知识发布）——归档后

把本次交付的 closeout 经验发布到团队知识库：
- **Outline 通道**：API key（Outline Settings > API 创建）+ `documents.create` 发布到 collection，`published: true`，独立读回验证（`documents.export` 对比哈希）。
- **llmwiki 通道**：走 MCP 正门 `mcp__llmwiki__create/edit/append` 写入 + reindex + 读回哈希对比。
  直接 fs 写 `~/.sdd/wiki/` 会被 hooks 策略 `kb-write-protection` 拦截——这是设计而非障碍（防绕过索引）。

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
| 知识发布（Kt） | — | — | Outline/知识库授权 |

## 出问题怎么办（实证陷阱速查）

| 症状 | 处置 |
| --- | --- |
| `requires recovery` | 按错误给出的 argv 原样跑 `{operation:"next"}` 恢复 |
| Run 绑定旧版本 | 正常：升级应用后新 Run 用新版，旧 Run 绑旧包 |
| `SCOPE_HELD` | 旧 Run 的认领未释放——取消旧 Run（带 reason）或 `acknowledge-stopped`（需 claimToken，在运行时 checkpoint 里） |
| 分支绑定未记录 | 同上恢复命令跑一次即可 |
| 断线重连 | `printf '{"operation":"next"}' > next.json && comet runtime dispatch --application <app> --request next.json --json` |
| 写文件被 hook 拦 | 产品守卫真实生效——按拒绝信息恢复对应流程，不要绕过 |
| 迁移 fence 报无效工作区 | 工作树残留跨 clone 旧布局 `.comet/runtime`——移出后按 recovery argv 重放；若报 RUN_NOT_FOUND 则 selection 已过期，移除 `.comet/current-change.json` 让 Hook 回中立 |
| `Classic change 已归属另一个应用` | 变更被 `state init` 误绑给内建应用。恢复（无 CLI，外科手术）：删变更目录（含 comet-state.yaml）+ 删运行时侧 owner（`<workspace>/change-owners/classic/<change>.json`）、投影（`state-projections/classic/<change>.json`）、Run 记录（`sdk-runs/classic/<change>`，hash 定位可经 checkpoint.json 的 runId 确认）后回第 1 步。`cancel`/`state restore` 均不释放归属 |
| `Classic portable checkpoint requires its original fixed Application package` | comet-state.yaml 带无 application_checkpoint 的 run_checkpoint（state init 产物），任何应用导入必拒。按上行整目录恢复 |
| `changed a Runtime-owned field` | comet-state.yaml 与 Run 状态不一致（手工编辑或 init 遗留）。仅 language/contextCompression/autoTransition/reviewMode 四字段允许用户改；其余一律以 Run 为准——应用在跑时删掉 YAML 会由 store 自愈重建，手工对齐追不平 |
| `command not found: comet` | comet 装在某个特定 nvm 版本的 global bin，锚定「最新 v2x」不保证命中。锚定后先 `command -v comet` 验证；失败则把装了 comet 的那个 bin 加入 PATH |
| 审批点输入了别的词被中止 | 仅驱动器退出，Run 状态与已记录批准不受影响；重跑同一命令续跑（确认词接受 approved / 同意 / y / yes） |
| `RUN_TERMINAL: 已停止的 Run 不能接受命令` | 该 Run 已 failed-terminal（如 sweep 拒绝把 attempt 打入终态）——**无任何复活通道**（retry/invalidate-evidence/revise 命令三门全封，r6 实证）。唯一出路：弃 Run 保留证据链，按 RUNBOOK 重跑。预防：修订做在 evidence 提交之前（evidence-last）；旅程中改动用上面的 revise 命令门（仅对未终态 Run 有效） |
| 换了 `COMET_DATA_DIR` 后 Run「不见了」 | Run 状态按 workspace 哈希存在数据根下——同一旅程从头到尾固定同一个值；换根 = 换了一套 Run 记录。迁回旧根即可找回 |

## 沙箱化 agent（默认沙箱只授权项目目录）

comet 0.5.1 默认把 Run 状态放在全局 `~/.comet/workspaces/<workspace哈希>/`，沙箱化
agent 写不了。**上游支持 `COMET_DATA_DIR` 环境变量**替代整个用户级数据根
（`workspace-runtime.js`：非空绝对路径；缺省 `~/.comet`）：

```bash
export COMET_DATA_DIR="${TMPDIR:-/tmp}/comet-data-$(basename "$PWD")"   # 会被创建
```

三条纪律（源码级实证）：
1. **必须绝对路径，且不能在当前工作区内**——上游显式拒绝「用户级 Runtime 数据根
   不能位于当前工作区内」（`workspace-runtime.js` 守卫）。放在沙箱已授权的
   scratch 区（如 `$TMPDIR`、项目同级工作区目录）即可，无需 HOME 授权。
2. **第 0 步安装之前就设好，全程固定**——Run 状态按 workspace 哈希落在数据根下，
   中途换根 = 换了一套 Run 记录（见陷阱表末行）。
3. 跨天旅程别用易清理的 `$TMPDIR`——改用稳定的 scratch 目录（如会话工作区同级），
   否则系统清 tmp 会把 Run 状态一起清掉。

默认不设 = 维持全局 `~/.comet`（既有行为，跨 clone 隔离由 workspace 哈希保证）。
项目内落点（`<project>/.comet/runtime/`）被上游设计禁止，scaffold 不提供。

## 升级应用（要新功能/修复时）

版本号递增 → 重编译 → `--upgrade` 两步安装。**旧 Run 继续绑旧包**（可恢复），
新变更用新版。禁止同版本号换内容。
