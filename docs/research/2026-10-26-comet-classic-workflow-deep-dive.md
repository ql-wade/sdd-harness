# Comet Classic 工作流深挖：openspec + superpowers 集成模式（四路调研汇总）

日期：2026-10-26。性质：只读调研报告，不改变已批准 ADR/计划，不构成运行验收。
调研分工与原始产出：①官方概念站（docs.comet.rpamis.com，含 changelog/llms.txt 索引）②GitHub master docs 树（对比 0.4.5 tag 与 compare/0.4.5...master）③本地 vendored 0.4.5 pristine 源码级核对（版本精确）④既有调研整合（docs/research/2026-10-19/20 五份 + change 目录 classic-* 契约）。
基线：本仓库锁定上游 `@rpamis/comet 0.4.5`（c90af44）+ 补丁链 0001–0004；OpenSpec 隔离钉版 1.11.0；文档站/master 已到 0.5.0（2026-10-22）。

## 1. 一句话定位（用户判断被证实并精确化）

**Classic = OpenSpec 管 WHAT × Superpowers 管 HOW × Comet 管阶段状态与门禁的"双星"集成模式。**
官方原文（README/design 文档）："OpenSpec 负责 WHAT（需求、提案、spec 生命周期、归档），Superpowers 负责 HOW（brainstorming、技术设计、计划、执行、验证），Comet 负责记录阶段和交接状态。"

## 2. 五阶段模型（0.4.5 版本精确）

| 阶段 | 负责方 | 关键产物 | guard 出口检查（classic-guard.ts 行号） |
| --- | --- | --- | --- |
| open | OpenSpec | proposal/design/tasks/delta-spec 四产物 + `.comet.yaml` | 三文件存在非空+语言匹配+≥1任务（L1063） |
| design | Superpowers | Design Doc（frontmatter 三键硬校验）+ handoff 包（必须脚本生成） | handoff_hash 重算一致否则 FATAL；frontmatter `comet_change/role: technical-design/canonical_spec: openspec`（L1107） |
| build | Superpowers | 实施计划（base-ref=HEAD）+ tasks 勾选 + 代码 | 三 mode 已选+tasks 全勾+plan 任务映射+Runtime 构建证据（L1196） |
| verify | 双方共同 | 验证报告（light 6 项/full 7 项） | verification_report + Runtime verify 证据（L1243） |
| archive | OpenSpec | 无新文件；`openspec archive --yes` 合并主 spec | archived+branch_status=handled+主 specs 无残留 delta（L1270） |

- 推进两层：`guard --apply` 恒推进 phase；`auto_transition`（默认 true）只控制是否自动调起下一技能。
- **10 个决策点无论配置必须人工**：路由/PRD 拆分/工作区/open 审视/设计确认/build 三 mode 联合决策/任务膨胀>50%/验证例外/归档五选项/预设升级。
- preset：hotfix（跳 design，先复现后修复）/tweak（跳 brainstorm+完整计划）；`preset-escalate` 是升 full 的唯一合法通道。

## 3. OpenSpec 集成（硬依赖）

- **外部 CLI**：`executeClassicOpenSpec` spawn `openspec`（`COMET_OPENSPEC` 可覆盖），最低版本闸 1.5.0；安装走 `npm install -g @fission-ai/openspec@latest` **无 pin**（B6 供应链面，我们的隔离钉版 1.11.0 是必要对策）。
- open 生成循环强依赖 `openspec status/instructions`，失败即停**不回退硬编码结构**；用技能 `openspec-explore`+`openspec-new-change`（不可跳过），默认不加载 `openspec-propose`。
- 布局二选一：`legacy`（根 `openspec/`）或 `docs`（`docs/openspec/`），不支持自定义路径。**本仓库根 `openspec/` 即 legacy，零迁移兼容。**
- 归档：Comet 前置确认→`openspec archive --yes`→指针重写→主 specs 清洁校验（残留 delta 标题即 FATAL）。Change 必须 `/comet-open` 出生；旁路创建（如 `/opsx:new`）缺 `.comet.yaml` 会被 status 静默跳过，且只有 open 阶段可幂等接管。

## 4. Superpowers 集成（方法层约定，非硬依赖——源码证实）

- **CLI/guard 从不校验 superpowers 存在**；init 为可选 checkbox，doctor 未检出仅 warn。绑定全部在 phase 技能正文（如 `comet-design/SKILL.md` "brainstorming 立即执行、不可跳过"）+ 引擎编排 yaml（只白名单 7 个 Comet 自有技能）。
- 绑定技能清单（full 路径）：brainstorming（design+中档漂移）、writing-plans、executing-plans（≤2 任务）、subagent-driven-development（≥3 任务）、test-driven-development、requesting-code-review、systematic-debugging（异常强制）、dispatching-parallel-agents（≥3 域失败才并行）、verification-before-completion。
- 技能解析：explicit → project（`.comet/skills/`，按名覆盖 builtin）→ 平台 skills 目录 → builtin；fail closed 不静默回退。
- 产物路径是**约定**（`docs/superpowers/specs|plans|reports/`），但 state 字段（design_doc/plan/verification_report）接受任意仓库相对路径。
- **替换面（→ Matt 方法）**：①改 phase SKILL.md 正文的方法调用指令（0001 补丁已做 init 选项切片）②`.comet/skills/` 放同名/兼容技能。状态机/guard/handoff/check/archive **零改动**。唯一硬机械约束：Design Doc frontmatter 三键；review-mode 分级（off/standard/thorough）与 TDD RED/GREEN 证据要求是 guard 硬门（review_mode 是 full 离开 build 的硬门禁）。

## 5. 状态与命令面（0.4.5 版本精确，纠正两个误解）

- 状态三件：`.comet.yaml`（Classic 域）+ `.comet/run-state.json`（Engine Run）+ `.comet/state-events.jsonl`（审计）。**gate-dispatches/receipts 是 Native 概念**；Classic 检查证据 = trajectory `command_check_*` 事件 + `.comet/checks/<uuid>.log|.manifest`。（我们 0002 补丁的 GateReceipt 是自建扩展，写哪些文件要在 P2_4 明确，不要与上游命名混淆。）
- 锁/事务：change 内 `.comet-state.lock` 文件锁 + 两阶段事务（transaction journal 重放）+ `check_epoch` 乐观并发；guard `--apply` 前再验证据防 TOCTOU。
- `check run` 证据绑定 argv/cwd/环境/输入指纹；`state record-check` 人工记录**永不满足 guard**（provenance≠runtime）。
- 逃生门（受管必须中和）：`COMET_SKIP_BUILD=1` 使证据链失效仍全绿；`COMET_FORCE_PHASE=1` 直写 phase（下游入口检查对伪造状态仍拒绝）。无 Runner 后由宿主 env 卫生 + 受保护 CI 承接（ADR-0021 决定 3 的落点）。
- 恢复：每次 `/comet` 重读配置+OpenSpec+状态文件路由，不依赖对话历史；`resume-probe` 判定序（多 change 未点名/脏工作区/决策点 → ask_user）。0.5.0 状态文件改名 `comet-state.yaml`（旧名兼容）。

## 6. 版本分叉：0.4.5 → 0.5.0（2026-10-22，master 更前）

- 0.5.0 = Comet SDK（14 项能力）+ Comet Any/Workflow Creator（"0.4.5 不含 Creator Run"）+ 工作流应用编译器（同方案同依赖=同字节摘要）+ **Classic 重构为组合应用**：`createClassicApplication`，`replacements`（替换执行 Skill）/`extensions`（在领域检查点追加工作），检查点 `open.evidence/build.check.evidence/verify.check.evidence`（full 另有 `design.evidence/build.plan.evidence/open.revalidate`），结果协议 `verdict(pass|repair|revise-requirements)+sourceHash+artifactHashes`。
- 双星定位、五阶段用户模型、四 operations 机制（auto-transition 默认开/knowledge/memory/context-compression beta）0.4.5→master 未变。
- 含义：**0.5.0 官方化了我们要用 0002 补丁+overlay 手工做的事**（自定义检查点、技能替换）。官方建议升级前用 0.4.5 归档活跃 change。本轮维持 0.4.5 决定不变；"补丁链 vs 0.5.0 原生能力逐项对照"列为升级决策前的必做证据（既有整合报告问题 7）。

## 7. 与 command-first 架构的对齐结论

### 完全一致（无需改）
1. 五 phase 为容器、R/A/T/P/V/Kp/Kt 为同 Run 内 step/门——官方五阶段语义保留，不重建。
2. OpenSpec 唯一规格归档（legacy 布局零迁移；归档清洁校验与"唯一归档"同向）。
3. 单主控 + fail closed + 恢复不依赖对话历史 + auto-with-gates（continuation automatic + 决策点人工）。
4. Kp/Kt 无原生位置（B5：零知识回执 archive 照样 5/5 过）→ Kp 阻归档/Kt 阻完成由我们 0002/0003 补丁承担，职责边界正确。

### 需要精确落地的适配点（按优先级）
1. **T 门位置**：官方无独立测试设计动作。0.4.5 落地 = 0002 补丁在 design→build 之间加独立 T 检查（绑定 TestPack 摘要+独立充分性审查回执）；0.5.0 升级后可迁到官方 `design.evidence` checkpoint。P2_4/P1_5 的实施基线。
2. **Matt 方法合规接入**：利用 `.comet/skills/` 项目层技能池按名满足解析（brainstorming/writing-plans/test-driven-development/systematic-debugging/verification-before-completion/requesting-code-review…），配 0001 补丁的 init 选项；产物契约对齐（Design Doc 三键、verify 报告 6/7 项、plan 的 base-ref/task 映射）。**必须在受管 init 中保持 Superpowers 复选关闭且不被 `comet update` 复装**（P1_6 防再生项）。
3. **review-mode 协调职责承接表**：Superpowers 侧五职责（连续任务协调/plan review/handoff 消费/reviewer 中立输入/progress reconciliation）替换后由哪个宿主动作承接——P1_6/P1_3 交接矩阵要逐项写明（Matt 的 tdd/code-review 覆盖前两项，后三项落在驱动器+独立子代理）。
4. **决策点↔授权点映射**：官方 10 决策点必须人工；我们"已授权范围内自动推进"= continuation automatic:true + 把授权点精确映射到决策点（设计确认/build 三 mode/归档五选项/验证例外）。P2_4 的 policy 输入。
5. **逃生门中和**：受管启动剥离 `COMET_SKIP_BUILD/COMET_FORCE_PHASE`、隔离 OpenSpec 供应（已钉 1.11.0）、`comet update` 不动受管安装——落 P1_4 mode 资格与 hooks 控制平面。
6. **命名卫生**：我们代码/fixture 里的 GateReceipt/gate-dispatches 语义是自建扩展，文档与 0002 补丁注释需与上游 Classic 真实机制（state-events/trajectory/checks）明确区分，防止后续维护者误当上游能力。

## 8. 未读取/未证明（诚实边界）

- master architecture/ 20 文件（plugin-sdk/runtime-sdk/编译器细节等）与 operations/ 4 新文件仅枚举未读正文；releases 页抓取失败（以 tags+compare 替代）。
- 正式安装链 overlay 不可绕过性、Matt 接入后协调职责真实遵守、授权点自动推进实测——仍是资格实验（整合报告问题 1/2/3），归后续任务验证，本文不宣称。
- 本文本轮未运行任何 comet init/状态写命令；调研全程只读。
