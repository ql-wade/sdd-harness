# sdd-managed-delivery 使用指南（Comet 0.5.1 / 应用 v20，已六门实证）

> 本指南以 2026-10-31～11-01 真实交付旅程（minicraft-html-game r34：六门全部真实 PASS 并归档）为实证依据写成。所有命令均来自实际执行的会话历史。

## 0. 这是什么

`sdd-managed-delivery` 是一个 Comet SDK 应用：把一次软件变更（change）沿 **六道管理门** R→A→T→P→V→Kp 驱动到归档，每道门都有 **独立证据链**（launch-authority 签名的收据束），只有证据真实通过才放行。四个角色：

| 角色 | 是谁 | 职责 |
| --- | --- | --- |
| **人类确认者（你）** | 项目负责人 | 在每个审批点做真实决策（批准/退回）；提供外部平台凭据；最终验收 |
| **驱动会话** | Claude Code / Codex 等代理会话 | 驱动 comet CLI/SDK：起 Run、提交动作、读门禁裁决、把审批请求递给你 |
| **工作代理子会话** | 驱动会话孵化的子代理 | 认领动作、执行固定技能（grill-me/test-authoring/whitebox-verify…）、产出工作记录（转录物即证据） |
| **Comet 运行时** | comet CLI（0.5.1） | 唯一流程主控：状态机、门禁校验、证据准入、恢复 |

六门与技能绑定：

| 门 | 阶段 | 绑定技能 | 独立审查 kind |
| --- | --- | --- | --- |
| R | 需求确认（full.open 之后） | grill-me | requirements-scope-confirmation |
| A | 架构共识（full.design） | multi-agent-consensus-review | grill-exact-unanimous-consensus |
| T | 测试设计 | test-authoring | independent-test-design-review |
| P | 构建计划（full.build.plan） | claude-parallel-tdd-planner | plan-unique-review |
| V | 白盒验证（full.verify.check） | whitebox-verify | （V 独立验收） |
| Kp | 知识收尾（归档前） | openspec-lifecycle-guard | — |

## 1. 环境前置

- macOS 或 Linux；git
- Node ≥22.16（实测 24：`~/.nvm/versions/node/v24.15.0/bin`；**注意默认 shell 可能落在 node16，构建/测试前显式 `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"`**）
- `comet` 0.5.1 在 PATH（`comet --version` 验证）
- 应用包：`integrations/comet/application/package/application.json`（manifestVersion 递增的不可变产物）
- 至少一个已登录的代理 CLI（Claude Code 推荐）

## 2. 核心概念（先读，避免踩坑）

1. **变更名 ≡ runId**：`openspec/changes/<kebab-name>/` 的名字就是 Run 的 runId，二者必须一致。
2. **Run 绑定启动时的应用版本**：v20 的 Run 不会用 v21 的包继续。升级应用后需要**新 Run**（旧 Run 永远可用旧包恢复）。
3. **门证据 = 收据束**：每门通过后写 `.sdd/delivery/gates/<gate>/receipt-bundle.json`，由 launch-authority HMAC 签名链背书；`.sdd` 必须是**真实目录**（不能是符号链接）。
4. **证据独立性**：签署验收的执行者/主体不得是作者或构建者（身份集互斥，门禁强制）。
5. **审批即决策**：每个 `resolve-wait --choice approved` 都是一次真实决策，decision-id 会留痕。
6. **JSON 通道字节**：record-outcome 的结果文件经 JSON 传输，`lib/delivery/evidence.js` rawBytes 已兼容已知序列化形状（Buffer.toJSON/键控投影）；若未来形状再变，先做形状探针再扩展。

## 3. 新项目接入（从零）

```bash
# 0) 工具链与 hooks 落地（幂等）
bash tools/bootstrap.sh

# 1) 安装应用到项目（预览 → 确认哈希 → 安装；两步都算一次真实决策）
comet application install integrations/comet/application/package/application.json \
  --project "$PWD" --preview --json          # 记下 confirmationHash
comet application install integrations/comet/application/package/application.json \
  --project "$PWD" --confirmation-hash <上一步哈希> --json

# 2)（Codex 用户）安装六阶段入口
comet application install integrations/comet/application/package/application.json \
  --project "$PWD" --platform codex --preview --json
comet application install ... --platform codex --confirmation-hash <哈希> --json

# 3) 创建变更目录（名字即 runId）
mkdir -p openspec/changes/<my-first-change>
# 写 proposal.md（Why/What Changes/非目标/验收）、design.md、tasks.md
```

然后进入第 5 节的交付旅程。首个变更建议选**小而可白盒验证**的增量（参考已归档的 minicraft r34）。

## 4. 存量项目接入

差异只有三点，其余与新项目相同：

1. **选一个有界的首个变更**：小、可浏览器或命令行独立验证（不要首跑就拿核心模块开刀）。
2. **项目级安装**：应用装在 `<project>/.comet/applications/`，不动全局、不碰你现有 CI；现有测试原样保留，作为 V 门基线。
3. **存量代码零改造**：管道只在变更目录与 `.sdd/delivery/` 写证据，产物代码仍由你自己的仓库结构承载。

## 5. 一次完整交付旅程（九阶段）

> 命令中 `APP` = 已安装应用的 application.json 路径；`BASE=(--project-root "$PWD" --run-id <change>)`；SDK 脚本 = `.comet/applications/sdd-managed-delivery/versions/<hash>/scripts/comet-run.mjs`。权威命令序列的机器可执行样例见 `test/comet-native-r-guard.test.js` 与归档 r34 的 `comet-state.yaml`。

### S0 准备
- **人**：审阅变更三文件（proposal/design/tasks）是否真实反映意图。
- **代理**：`start` → inspect（如遇 `requires recovery` 按提示跑 `{operation:"next"}` 恢复 dispatch）。
- **交付物**：Run 建立，`comet-state.yaml` 出现在变更目录。

### S1 Open + R 门（需求确认）
- **代理**：execute `classic.composition.prepare` → resolve Open 证据等待 → claim `full.open` → record-outcome（open-complete）→ 用 `classicOpenEvidenceReceipt` 生成证据并 record-evidence（submissionId 派生，勿手写）。
- **人**：批准两次——Open 证据等待、`full.open.confirm` **需求确认**（这是你最重要的决策点：确认范围/验收/非目标）。
- **代理**：execute `full.open.revalidate` → claim R 门（`classic.extension.requirements-open`）→ 工作代理执行 grill-me 确认 + **第二代理独立审查** → 驱动证据链（authority→ActionBinding→dispatch→collection→managed admission）→ record-outcome。
- **交付物**：`.sdd/delivery/gates/r/receipt-bundle.json`；R 收据 + 独立确认声明（转录物摘要绑定）。
- **判据**：R 动作 succeeded；`full.design` 动作出现。

### S2 Design + A 门（架构共识）
- **代理**：design 工作（grill-me design document/handoff）→ 多代理共识评审（multi-agent-consensus-review，需真实多参与方一致）→ record-outcome。
- **人**：批准设计 handoff 等待；对设计本身拍板。
- **交付物**：`design.md`（冻结）、设计上下文 handoff（`.comet/handoff/`）、`.sdd/delivery/gates/a/receipt-bundle.json`。

### S3 T 门（测试设计）
- **代理**：test-authoring 产出域用例/TestPack（cases/test contract，含真实所需分母）→ 独立 T 评审（第二代理，绑定当前合同摘要）→ record-outcome。
- **人**：批准测试设计等待；决定哪些检查 automated/manual。
- **交付物**：`tests/test-contract.json`（或 TestPack）、`.sdd/delivery/gates/t/receipt-bundle.json`。

### S4 P 门（构建计划）
- **代理**：claude-parallel-tdd-planner 产出任务 DAG/执行计划 → 独立计划评审 → record-outcome。
- **人**：批准 `full.build.configure`（工作区/模式决策）与计划本身。
- **交付物**：`task-dag.json` + 构建计划文档、`.sdd/delivery/gates/p/receipt-bundle.json`。

### S5 Build（TDD 实现）
- **代理**：tdd 技能按计划 RED→GREEN 实现（如 r34：方块裂纹 + 背包 HUD），每步测试日志留痕 → 独立代码评审（非作者执行）→ record-outcome。
- **人**：（可选）查看中间演示；对范围偏移喊停。
- **交付物**：实现代码（如 `demos/minicraft/index.html` 增量）、测试运行原始日志、评审记录。

### S6 V 门（白盒验证）
- **代理**：whitebox-verify 真实验收（浏览器 journey + 截图 + 终态回读，如 r34 的 `verify-evidence/01-reload-persisted.png`）→ 机器检查（如 4/4）→ **verification 三件套**：`verification-results.json`、`verification-report.md`、`grill-report.md` → 独立 V 评审 → record-outcome。
- **人**：确认验证结果（verify 确认等待）；对 NOT-EXERCISED 项知情认可。
- **交付物**：验证三件套 + 截图/原始日志 + `.sdd/delivery/gates/v/receipt-bundle.json`。

### S7 Kp 门（知识收尾）
- **代理**：openspec-lifecycle-guard 收尾项目知识（closeout），证据准入 → record-outcome。
- **人**：（如涉外部知识平台）提供授权。
- **交付物**：`closeout.md`、`.sdd/delivery/gates/kp/receipt-bundle.json`。

### S8 归档 + Kt
- **代理**：`full.archive` prepare→execute → 变更移入 `openspec/changes/archive/<date>-<change>/`。
- **人**：确认归档（archive_confirmation）；Kt（Outline 团队知识发布）需你的外部平台授权。
- **交付物**：归档目录（proposal/design/tasks/task-dag/comet-state(archived)/closeout/verify-evidence/测试契约 + 交付权威记录）；Kt 发布件（平台侧）。

## 6. 全阶段交付物总表

| 阶段 | 变更目录内 | 门证据（.sdd/delivery/gates/） | 运行时侧 |
| --- | --- | --- | --- |
| S1 Open+R | proposal.md、comet-state.yaml、full.open 证据 | r/receipt-bundle.json | Open 确认记录（wait decision） |
| S2 A | design.md、handoff | a/receipt-bundle.json | 设计等待决策 |
| S3 T | tests/test-contract.json | t/receipt-bundle.json | 测试设计等待决策 |
| S4 P | task-dag.json、计划文档 | p/receipt-bundle.json | configure/plan 决策 |
| S5 Build | 实现代码、测试日志 | （评审记录入 V 前证据） | build 动作历史 |
| S6 V | verification 三件套、verify-evidence/ | v/receipt-bundle.json | verify 确认决策 |
| S7 Kp | closeout.md | kp/receipt-bundle.json | Kp 决策 |
| S8 Archive | archive/<date>-<change>/（整套） | — | archived: true |

## 7. 人类必做审批点清单

1. Open 证据与 `full.open.confirm` 需求确认（S1）
2. 设计 handoff 与 A 共识认可（S2）
3. 测试设计批准（S3）
4. build configure 与计划批准（S4）
5. 验证结果确认 + NOT-EXERCISED 知情认可（S6）
6. 归档确认（S8）
7. 外部平台授权（Outline Kt 等，按需）

## 8. 应用版本升级

```bash
# 版本号在 composition.json manifestVersion 递增后官方编译产出新包
comet application install <新包>/application.json --project "$PWD" --upgrade --preview --json
comet application install <新包>/application.json --project "$PWD" --upgrade --confirmation-hash <哈希> --json
```

- **旧 Run 永远绑定旧包**（可继续用旧包路径恢复/推进）；新 Run 用新版本。
- 同一版本号不同内容会被拒绝——版本必须显式递增。

## 9. 恢复与实证陷阱清单（每条都真实踩过）

| 情形 | 处置 |
| --- | --- |
| `requires recovery` | 按错误信息给出的精确 argv 跑 `{operation:"next"}` 恢复 dispatch |
| Store 分区身份变化 | `{"operation":"audit-storage-index"}` / `rebuild-storage-index`；不可用时清运行时 workspace（确认无在途 Run 后） |
| cancel 一个 Run | 请求必须带非空 `reason` |
| `.sdd` 符号链接拒绝 | `.sdd` 必须真实目录；vendor/tools 可为内部符号链接 |
| runId ≠ change | 拒绝（change 身份绑定）；取消需 reason，身份矛盾的僵尸 Run 需清运行时投影 |
| 危险命令 hook | 团队清单拦截递归强删根路径等模式；合法清理用 node fs.rmSync |
| JSON 通道字节形状 | rawBytes 已兼容 Buffer.toJSON/键控投影/连续键控三形；出现新形状先做形状探针（记录 constructor/keys/length）再扩展 |
| Composed run 跨版本 | 拒绝并提示恢复原包——按提示 argv 原样执行 |
| 默认 shell node 退化 | 显式 `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"`（node16 会令 `--test-reporter` 退出码 9） |

## 10. 诚实边界

- F10 跨机器 API 正向：另期，NOT-EXERCISED。
- Kt（Outline 团队知识）真实发布需外部授权；归档后 `deliver` 簿记存在上游运行时枚举歧义（已诊断记录），待上游波次。
- V 门验证质量取决于 whitebox 证据的真实性——机器检查与浏览器截图/回读为实证基线，业务验收结论仍由人签字。

——本指南对应分支 `verify/r-gate-verdict`（六门 PASS + r34 归档）。
