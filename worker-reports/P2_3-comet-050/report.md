# P2_3 — 薄CLI与历史报告边界（修订 2026-10-26-comet-050-adoption-v1）

- 日期：2026-10-26
- Worker 范围：tasks.md "### Task P2_3" Owns 文件（bin/cli.js、lib/adapters/legacy-evidence.js、test/delivery-cli.test.js、test/delivery-cases/2_3.mjs）
- Node 钉版：/Users/mac/.nvm/versions/node/v24.15.0/bin/node（v24.15.0）
- Acceptance IDs：A20, B10（含 B07 显式拒绝）
- 结论：GREEN，无代码改动（现状即满足），证据见本目录三个日志

## 1. 现状观察（Record + Observe）

四个 Owns 文件在工作区无未提交改动（git status 中不出现）。钉版首跑：

```
node --test test/delivery-cli.test.js test/delivery-cases/2_3.mjs
# exit 0 — tests 31 / pass 31 / fail 0 / cancelled 0 / skipped 0
```

日志：`rerun-node-v24.15.0-20261026.log`（带命令头 + exit code: 0）。

已绿 ⇒ 按任务约定，RED 证据以"负向 oracle 存在性核对"替代（见 §3）。

## 2. GREEN 数字

| 套件 | tests | pass | fail | exit |
| --- | --- | --- | --- | --- |
| test/delivery-cli.test.js + test/delivery-cases/2_3.mjs（合并） | 31 | 31 | 0 | 0 |

未放宽任何断言、未修改任何文件（本任务产出仅为 worker-reports/ 证据）。

## 3. 负向 oracle 存在性核对（逐条，替代 RED）

契约：0 = 有效检查执行且通过；1 = 输入无效/前置缺失；2 = 检查执行但验收失败。

### 3.1 退出码 0 断言存在且执行

- test/delivery-cli.test.js:152（evidence-audit 声明与磁盘一致 → 0）
- test/delivery-cli.test.js:224（delivery-gate report 层检查满足 → 0）
- test/delivery-cli.test.js:402（delivery-gate 自称 pass 只算 component → 0 且 managedClosureEligible=false）
- test/delivery-cases/2_3.mjs:137（真实旧通道报告进新门 → 0，receipt 过 frozen schema）
- test/delivery-cases/2_3.mjs:150（旧 CLI 行为不回归 → 0）
- test/delivery-cases/2_3.mjs:222 / :245（净化环境、禁用可选工具下正确性链仍成立 → 0）

### 3.2 输入无效 exit 1 断言存在且执行

- test/delivery-cli.test.js:173 / :199 / :205（evidence-audit / deliverable-audit / test-gate 的 --project 不存在 → 1；注释保留 measured RED: exited 2 的历史）
- test/delivery-cli.test.js:266-271（delivery-gate 五类坏输入：不可读文件、schema 不符契约、receipts 非数组、policy 缺 digest、非 sha256 digest → 1）
- test/delivery-cli.test.js:416（退役命令 run/stage/source-command-sdd-code 与自我授权参数 --authority/--secret/--qualification/--profile 一律 JSON exit 1，且工作目录零副作用）
- test/delivery-cli.test.js:512（无效 JSON → 1，且不回显输入内容与宿主路径）
- test/delivery-cases/2_3.mjs:185 / :189 / :193（任务级 0/1/2 三元组补全）

### 3.3 验证失败 exit 2 断言存在且执行

- test/delivery-cli.test.js:163（声明与磁盘矛盾 → 2，且非 EVIDENCE_INPUT_MISSING）
- test/delivery-cli.test.js:190（既有 oracle：真实项目缺输入 → 2，与 test/evidence-audit-command.test.js 钉死口径一致，注释说明分类依据）
- test/delivery-cli.test.js:246 与 test/delivery-cases/2_3.mjs:165（legacy report 层闭不了产品能力 → blocked → 2，MISSING_OBSERVATION: unit/unit:node:test）
- test/delivery-cases/2_3.mjs:249（禁用可选工具不能替代缺失证据 → 2）

### 3.4 历史报告只读、不签新流程（B10/B07）断言存在且执行

- 边界标注真实存在且在每个返回上：lib/adapters/legacy-evidence.js:33 `HISTORICAL_BOUNDARY = { scope: 'component/legacy-report', managedClosureEligible: false }`（frozen），test/delivery-cli.test.js:375-386 断言 adapted/admitted/entry 三处都带该标注。
- 不自造信任：test/delivery-cli.test.js:332-360（无 dispatch → UNREGISTERED_SOURCE；重放 → DUPLICATE_ISSUANCE；无 authority → 拒绝）。
- 不降级保护调用方：test/delivery-cli.test.js:362-373（requireManaged → LEGACY_REPORT_NOT_MANAGED）；:427-441 用 dispatch 计数器断言受保护拒绝路径**从不签发 dispatch**（dispatches === 0）。
- 层诚实：check 固定 `report:evidence-audit:v1`、origin.kind `legacy-report`（2_3.mjs:127-128 实断言），capability 精确匹配使旧报告永不能替代产品能力检查（3.3 的 exit 2 断言）。
- B07 显式拒绝：MISSING_FIELD 逐字段点名、INCOMPATIBLE_VERSION 新旧两向（test/delivery-cli.test.js:306-330；2_3.mjs:196-206 用**真实** auditEvidence 报告复核）。
- 原始 JSON 不做字符串胁迫的全矩阵（test/delivery-cli.test.js:443-499）。

### 3.5 机械佐证（coverage）

`coverage-oracle-check-20261026.log`：

- lib/adapters/legacy-evidence.js：line 96.70% / branch 96.52% / funcs 100%。未覆盖仅 88-89、98-99（不可表示 expiry 的双重防御）、121-122（adapter 自身 bug 的内部不变式护栏）——全部拒绝分支（MISSING_FIELD / INCOMPATIBLE_VERSION / INVALID_LEGACY_REPORT / INVALID_LEGACY_IDENTITY / INVALID_PROTECTED_POLICY / LEGACY_REPORT_NOT_MANAGED / UNREGISTERED_SOURCE / INVALID_CURRENT_BINDING / INVALID_DISPATCH_BINDING / INVALID_ISSUED_EXECUTIONS）均实际执行。
- bin/cli.js：未覆盖行不含 delivery-gate 命令体（371-411；仅 401-404/408 的非 JSON 展示分支未走，所有 --json 路径含 catch → exit 1 均覆盖）。未覆盖块 434-531/540-619 属 knowledge-closeout 与 wiki，非 P2_3 范围。

## 4. 退出码实证（live probes）

`exit-code-probes-20261026.log`：

| 命令 | exit | 说明 |
| --- | --- | --- |
| `node bin/cli.js --help` | 0 | 原生 help |
| `node bin/cli.js definitely-not-a-command --json` | 1 | 未知命令 = 无效输入，JSON 拒绝（managedClosureEligible=false） |
| `node bin/cli.js evidence-audit --project /definitely/not/a/real/path --change demo --json` | 1 | 不存在路径 = 前置缺失，INVALID_EVIDENCE_AUDIT |
| `node bin/cli.js evidence-audit --project <矛盾声明项目> ... --json` | 2 | 检查执行、验收失败（progress 声称 99 源文件，磁盘 1） |

## 5. 未验证项 / 缺口

- 无代码缺口：31/31 全绿，退出码契约四态（0/1/2 + help 0）全部有断言 + 实证双份证据。
- 覆盖率注记：bin/cli.js 整体行覆盖 45.96% 是因为 doctor/init/wiki/knowledge-closeout 等命令不在本任务套件内（归其他任务/既有套件），与 P2_3 边界无关。
- 未执行 `bash scripts/check.sh` 全量：本 worker 边界限定只跑本任务套件 + CLI 探针；全量归 VERIFY 阶段。
- 未 commit（按边界禁止）；git 工作区中其他任务的未提交改动未触碰。
