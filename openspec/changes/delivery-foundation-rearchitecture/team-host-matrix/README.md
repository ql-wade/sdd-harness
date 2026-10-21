# team-host-matrix — 逐宿主认证能力矩阵（P5_1）

`matrix.json` 是唯一事实源：每个 `host × capability` 格记录 `{status, evidence[], note?, holder?}`，
状态只取固定四枚举，每格证据只绑定该宿主自身的真实工件。本 README 说明读法、证据指针约定与
"不跨平台推断"原则。机械校验在 `test/delivery-cases/5_1.mjs`（5.1.b-1..5 与 3 个矩阵负例）。

## 宿主集（survey 自 lib/adapters/* 与装配面）

| host | 判定依据 |
|---|---|
| claude-code | hook 装配宿主：`hooks.yaml`（唯一策略源）→ `tools/adapters/claude-code.sh` 落地原生配置 |
| comet-classic | `lib/adapters/comet.js`（`RUNNER_ID=comet-classic`，pinned build `cb1151b4…`） |
| llmwiki | `lib/adapters/llmwiki.js`（Knowledge.Closeout.v1 的 Kp 面；MCP-only 写路径） |
| outline | `lib/adapters/outline.js`（Kt 面；Runtime 指令 0003 驱动的团队发布） |
| code-wiki | `lib/adapters/code-wiki.js`（pinned deepwiki profile 只读判定） |

非宿主模块（不入矩阵）：`harness.js`（宿主 adapter 共享分层库）、`spec.js`（唯一归档 writer，
A11 journey 在 3_4.mjs）、`architecture-review.js`、`knowledge-revocation.js`、`legacy-evidence.js`。

能力轴（各对齐验收语义）：`discovery`=F03、`write-protection`=A09、`browser-evidence`=F08、
`recovery`=A11。

## 状态枚举与 acceptance-index 映射

| 本矩阵 | 含义 | 与 acceptance-index.json（B10）的关系 |
|---|---|---|
| VERIFIED | 该宿主自己的真实证据（探针/test journey/真实运行记录，指针可解析），完整验收已复验 | 同 VERIFIED |
| SUPPORTED | 机制在位且绑定该宿主真实接口、有真实观测，但覆盖缺口如实登记或未做完整 journey 复验 | 对应 ENVIRONMENT_GATED 家族（机制证据在位，完整声明被登记缺口/环境阻断；holder 已登记） |
| UNSUPPORTED | 该宿主不存在此能力表面，其自身工件记录缺席 | 无索引对应——A09 缺口语义：**gap is never blocked**，缺席绝不记为已拦截 |
| UNVERIFIED | 无当前真实证据；必有 holder | 同 UNVERIFIED |

一致性约束（5_1.mjs 5.1.b-5 强制）：本矩阵不得与 acceptance-index 矛盾——F08 在索引中
ENVIRONMENT_GATED+holder，故本环境五个 browser-evidence 格一律 UNVERIFIED+同源 holder；
F03 索引 VERIFIED，故 claude-code/discovery 不得低于 SUPPORTED。

## 证据指针约定

- 格式：`仓库相对路径` 或 `仓库相对路径 :: 注释`（与 acceptance-index 风格一致）。
- 解析规则（5_1.mjs 5.1.b-2）：去掉 ` :: ` 注释后必须 `fs.existsSync` 实存；绝对路径与 `..` 一律拒绝。
- 允许两类来源：**宿主专属**（`lib/adapters/<host>.js`、`host-probes/`、对应 delivery-case/worker-report）
  与**共享事实源**（`hooks.yaml`、`mcp-capabilities.yaml`、`acceptance-index.json`、spec、
  execution-ledger、`3_2.mjs` F08 契约）。宿主专属根的归属表硬编码在 5_1.mjs 的
  `HOST_SPECIFIC_EVIDENCE`；同时列于两宿主名下的根视为两宿主共享（如 `4_4.mjs` 同测 llmwiki 与 outline）。

## 不跨平台推断原则（本矩阵的核心纪律）

每格只允许绑定该宿主自身的真实证据（adapter 源码断言 / 测试 / 探针 / 在跑记录）。任何
"宿主 A 支持 → 宿主 B 应该也支持"的推导都被禁止：5_1.mjs 5.1.b-4 机械拒绝任何引用其他宿主
专属证据根的格（负例 N4：comet 格引用 `lib/adapters/llmwiki.js` → 拒绝）。同理，claude-code
宿主的 hook 装配审计不被复用为 llmwiki 写保护的能力证明——llmwiki/write-protection 格只引用
策略目标为其写面的 `hooks.yaml` 条目与 `mcp-capabilities.yaml` 事实源注记。

## 5.1.a（worktree/DAG 有序集成）指针

同一交付 `test/delivery-cases/5_1.mjs` 的 5.1.a-1..3 用真实数据机械验证：并行隔离
（execution-ledger 的 26 次单任务 dispatch → 26 个互不相同 worktree，含 1 次 2 任务 wave dispatch、
85 对重叠在飞区间、live `git worktree list` 35 项对账）、串行集成（24 次 TASK_INTEGRATED 文件序
时间单调，每次集成前置独立评审结论 APPROVED/RESOLVED 或 CHANGES_REQUESTED+REVIEW_FIX_DONE）、
父目标重验（P1_1 真实链条：worker DONE → flip → 集成后 fresh-checkout 缺陷 → amendment——
**子 green 不等于父目标通过**）。3 个负例喂入伪造判定输入（直改主检出 / 子 green 即父过 /
先集成后评审）并断言拒绝。

## 环境注意事项

- live worktree 对账下限（≥25 非 main worktree）绑定本交付机（2026-10-21 实测 34）；如环境清剪
  worktree，请以 ledger 事件与 `worker-reports/P5_1/evidence/` 存证重定基线（与 1_3.mjs 的
  .sdd 装备工作树要求同类的环境绑定，见 acceptance-index known_environment_gates）。
- 证据 .txt 中宿主绝对路径已按 `<repo>`/`<tmp>` 净化；提交内容零宿主绝对路径。
