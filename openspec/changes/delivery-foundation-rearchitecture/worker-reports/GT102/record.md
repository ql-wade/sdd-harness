# G-T1-02 残留修复 worker record — journey sha 冻结与 3_3.mjs oracle 互锁解锁

- Worker：G-T1-02 修复 worker（控制器派发）；钉版 node v24.15.0（`~/.nvm/versions/node/v24.15.0/bin`，PATH 前置）。
- 基线 HEAD：`a611bd6`（工作树，**未 commit**，按指令禁止）。
- 证据：本目录 `evidence/`（冻结前后 managed 探针 verdict、组件面 verdict、全部钉版 TAP 日志）。

## 目标与完成范围

解开 FINAL-VERIFY 实测后退的互锁：登记 `real-comet-recovery` 的 journey 配方 sha 会让 3_3.mjs 的
L11 owner oracle 红（oracle 钉"冻结前=无 sha"的拒因族），不登记则 journey 验收器 managed 面
NOT-EXERCISED `journey-recipe-freeze-or-safe-path-missing`。本轮按派发方案 A 一次解开：
**冻结登记 + oracle 等强度更新同步落地**（FINAL-VERIFY record 原话："journey sha 冻结随 3_3 oracle 更新"）。

## 互锁机理（诊断结论）

- oracle（旧）断言 managed 面 `--journey real-comet-recovery` 拒因匹配
  `/journey-recipe-freeze|case_definition_sha256|journey-recipe-not-implemented|journey-registration-incomplete/`。
- `tools/verify/delivery-journey.mjs:633-637`：managed 面（不带 `--case-plan/--pilot-contract/--case-definition`）
  要求 `registration.case_definition_sha256` 为 64-hex 且等于配方字节 sha256，否则
  `journey-recipe-freeze-or-safe-path-missing` / `registered-journey-recipe-drift`。
- 冻结后运行穿过 freeze 门与 profile/baseline 门，停在 `!componentOnly` 的 managed 分母门
  （`delivery-journey.mjs:784-787`）：journey 登记（区别于 `plan.cases`）没有
  `required_proof_level/required_assertions/required_readbacks` → 拒因变为
  `proof-registration-missing (UNVERIFIED)`，不在旧 regex 内 → oracle 红。三态均实机复现（见证据）。

## 改动文件（全部在派发边界内）

| 文件 | 改动 |
| --- | --- |
| `verification-case-plan.json` | ① `journey_definitions.real-comet-recovery` 增 `case_definition_sha256`（`1a3cdaa…1527e`，配方字节实测 sha256，与 runner 门同一比较口径）；② `proof_registration.journey_recipe_freeze.real-comet-recovery` 置 `REGISTERED_2026-10-26_GT102_WITH_OWNER_ORACLE_UPDATE`，`journey_freeze_note` 改记新状态与其余两旅程归属 |
| `test/delivery-cases/3_3.mjs` | L11-recipe-tracking oracle 改为冻结后等强度验证（见下）；测试名尾段同步改写，`V_RW_REAL_COMET_RECOVERY:L11-recipe-tracking` 断言前缀保持不变（配方 `tapRequiredAssertions` 钉该 id，词边界匹配不受影响） |
| `pilot-recovery/real-comet-recovery.journey.json` | c050-recipe-registration 步的 `constructionScope/gate/dispatchBinding` 文案随迁冻结后语义（纯登记记录 prose，无代码消费，已核实；**冻结对象 case.json 未动，冻结值仍有效**） |
| `worker-reports/GT102/` | 本 record + evidence |

边界说明：冻结值只能登记在 `verification-case-plan.json`（runner 只从该文件读
`registration.case_definition_sha256`），派发边界的"pilot-recovery/ 配方文件"按此必要路径理解；
配方文件本身零改动（保持"配方内不钉任何 64-hex"既有断言为真）。

## oracle 等强度改写（无断言放宽）

旧强度：unknown journey 结构化拒绝 + 注册旅程 run 拒因落在"缺冻结"族。新强度（同测试点）：

1. **静态冻结一致性**（比旧"跑出拒因"更直接）：`case_definition_sha256` 为 64-hex 且
   `== digestFile(配方字节)`——正是 runner freeze 门自己的比较；漂移即红。
2. unknown journey 拒绝面原样保留（exit 2 / NOT-EXERCISED / `journey-not-registered`）。
3. 注册旅程 managed run：exit 2、`NOT-EXERCISED`、**doesNotMatch 冻结族**
   （`journey-recipe-freeze|registered-journey-recipe-drift`——证明 run 确实穿过 freeze 门，互锁解开）、
   **match `proof-registration-missing`**（下一诚实缺前置，即与其余 109 项 managed 面同构的
   控制器分母缺口）。旧版收 4 选 1 拒因族，新版钉精确拒因 + 负约束，强度不降反升。

## 真实执行的命令与结果（全程钉版 v24.15.0；未 commit）

```
# 冻结前探针（managed 面，oracle 同款调用）
node tools/verify/delivery-journey.mjs --journey real-comet-recovery --profile comet-managed-v2 --evidence-dir <tmp> --json
  → exit 2 / NOT-EXERCISED / journey-recipe-freeze-or-safe-path-missing        （evidence/pre-freeze-managed-verdict.json）
# 登记后同款
  → exit 2 / NOT-EXERCISED / proof-registration-missing (UNVERIFIED)…          （evidence/post-freeze-managed-verdict.json）
# 组件面（FINAL-VERIFY Phase C 同款，--case-plan 指真实 plan）
node tools/verify/delivery-journey.mjs --journey real-comet-recovery … --case-plan <plan> --json
  → exit 0 / PASS / effectiveExecutions 11                                      （evidence/post-freeze-component-face-verdict.json）

node --test --test-reporter=tap --test-name-pattern=L11-recipe-tracking test/delivery-cases/3_3.mjs   → 1/1
node --test --test-reporter=tap test/delivery-cases/3_3.mjs        → 11/11 exit 0（约 119s；两轮：一轮裸二进制、一轮 PATH 前置）
node --test --test-reporter=tap test/delivery-cases/3_2.mjs        → 13/13 exit 0
node --test --test-reporter=tap test/comet-flow-acceptance.test.js → 47/47 exit 0（首轮 46/47 系未前置 PATH 的
                                                                     调用伪影：P31 探针子进程 `node --version` 解析到
                                                                     PATH 上另一 node；PATH 前置后全绿，非本轮改动引入）
node --test --test-reporter=tap test/delivery-cases/4_3.mjs       → 16/16 exit 0
node --test --test-reporter=tap test/delivery-cases/4_8.mjs       → 9/9 exit 0
node --test --test-reporter=tap test/delivery-cases/5_1.mjs       → 16/16 exit 0
python3 -c "json.load(open('…/verification-case-plan.json'))"      → valid
```

plan 消费面核查（改前静态排查）：3_2/4_3/4_8/5_1 对 `journey_definitions` 均为选择性读字段
（owner/path/required_check），不受加字段影响——上列全绿复证。冻结四件
（proposal/design/spec/tasks）未触碰，drift-lock/哈希链不涉及本 plan。

## 未验证项与移交（如实）

- **`bash scripts/check.sh` 全量未跑**（任务验证范围=3_3.mjs+journey 验收器相关测试，已全绿如上）；
  控制器收口前建议整仓跑一次。
- managed 面三旅程中 `same-run-delivery`（P3_2）与 `post-delivery-permissions`（P4_8）**仍未冻结**：
  两家 owner oracle 只做静态配方检查+临时 plan 探针，不钉 managed 面（本轮已核实 3_2/4_8 全绿不受
  real-comet-recovery 冻结影响），故其冻结是无互锁的 owner 直改项（登记同名字段即可），已改写进
  `journey_freeze_note`。
- journey 级 managed 分母（`required_proof_level/required_assertions/required_readbacks`）仍归控制器
  （G-T1-02 主体）；登记后 managed 拒因将前进到 `protected-source-unavailable`，届时本 oracle 第 3 组
  断言需 owner 随状态再更新（与 FINAL-VERIFY→本轮同一"状态前移、oracle 随迁"模式，已写入断言信息串）。
- `verification-report.md` 未改（VERIFY Owns；本轮非终验，互锁已按方案 A 修复而非记为已知限制）。
- 风险注记：未来若控制器把 journey 分母补齐且 managed 面真正执行配方，spawn
  `node --test test/delivery-cases/3_3.mjs` 会与本 oracle 测试形成递归（本测试内再起 runner）——
  该隐患继承自配方设计（caseModule 即承载 oracle 的模块），非本轮引入，提请控制器在分母收口时评估。
