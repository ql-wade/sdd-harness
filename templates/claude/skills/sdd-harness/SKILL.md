---
name: sdd-harness
description: SDD Harness 共享 skill —— artifact 读写、stage 推进、gate 检查、knowledge-pack 组装、LLMWiki 操作。9 个 stage skill 的公共底层。
license: MIT
compatibility: 需要 OpenSpec CLI、Trinity skills、planning-with-files、Superpowers
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# sdd-harness（共享 skill）

SDD Harness 的公共逻辑层。9 个 stage skill（sdd-grill … sdd-archive）是薄壳，各自只做阶段特定工作，公共操作全部委托给本 skill。

---

## 0. Bootstrap Run（首次进入一个 change 时调用）

grill 阶段 Step 1（或其他阶段发现 active-run 缺失时）调本节，创建 run 状态：

```bash
# 1. 生成 change-id（slug + 4 位 hash，保证 worktree 并发唯一）
change_id="<slug>-<4位 hash>"

# 2. 创建 canonical change 目录（Trinity 域，进 git）
mkdir -p openspec/changes/$change_id/specs
# trinity-new 脚手架生成 proposal/specs/design/tasks 占位 + tracking 文件

# 3. 创建 governance runtime（SDD 域，gitignore）
mkdir -p .sdd/runs/$change_id
# 从 templates/sdd-harness/workflow-frame.yaml 实例化，填入:
#   run_id: $change_id
#   stage.current: grill
#   goal: <来自用户输入>
#   artifacts.required: [findings.md]  # grill 的必产
#   gates.status: pending

# 4. 写 active-run 指针（hook 和后续 stage 读它定位当前 run）
echo "$change_id" > .sdd/active-run

# 5. 生成首轮 knowledge-pack
# sdd-context-mcp.build_grill_pack(run_id=$change_id, ...) → .sdd/runs/$change_id/knowledge-pack.md
```

**幂等**：若 `.sdd/active-run` 已存在且对应 workflow-frame.yaml 的 stage 与当前请求一致，跳过 bootstrap 直接 resume。

---

## 1. 入口：加载当前 Run 状态

每阶段开始时，先读 governance core：

```bash
# 找到 active change
change_id=$(cat .sdd/active-run 2>/dev/null || echo "")
# 读 workflow frame
cat .sdd/runs/$change_id/workflow-frame.yaml
# 读 steering 持久指导（跨 change，每个 stage 都读）
cat .sdd/steering/project.md 2>/dev/null
```

### workflow-frame 字段说明

| 字段 | 含义 |
|------|------|
| `stage.current` | 当前 stage（grill/product/dev/test/code/review/verify/release/archive） |
| `stage.allowed_actions` | 当前 stage 允许的操作列表 |
| `goal` | 本 change 目标（来自 proposal.md） |
| `artifacts.required` | 当前 stage 必须产出的 artifact |
| `artifacts.produced` | 已产出的 artifact |
| `gates.status` | 当前 gate 状态 |

---

## 2. Stage 推进

```yaml
# 推进到下一 stage
# 前条件: gate 通过
# 操作:
#   1. workflow-frame: stage.current = <next_stage>
#   2. workflow-frame: stage.history.append({from, to, at, reason})
#   3. workflow-frame: artifacts.required = <next_stage 的必产 artifact 列表>
#   4. progress.md: append "stage advance: <from> → <to>"
```

### Stage 顺序

```
grill → product → dev → test → code → review → verify → release → archive
```

release mode=skip 时：verify → archive（跳过 release）。

### 回退

```
stage.current = <target_stage>
stage.history.append({from, to, at, reason: "...回退原因..."})
当前 stage 已产出的 artifact → artifacts.superseded
progress.md: append "reverted: <from> → <to>, reason: ..."
```

---

## 3. Gate 检查（轻量：只查存在 + verdict）

每个 stage 的 gate 规则见各自 stage contract。公共检查逻辑：

```yaml
# 输入: stage name
# 操作:
#   1. 读 workflow-frame.yaml 的 artifacts.required
#   2. 逐一检查文件存在性
#   3. 对 review/verify gate，检查 verdict 字段
#   4. gate 是持续成立的前置条件，不是一次性通行证：
#      verify/release/archive 必须重新检查最新 review verdict；
#      release/archive 必须重新检查当前 probe 与 evidence-audit 报告及其磁盘绑定。
#      release/archive 必须解析活动或归档 change 的 tasks.md，存在任一 `- [ ]` 未完成任务时阻断。
#      release mode=skip 同样执行 archive 级 gate，不得绕过 tasks/review/verify。
#      progress/review/test-output 任一 audit 输入缺失时必须阻断；null SHA 不是有效绑定。
#      任一上游证据在 stage 推进后失效，当前 stage 必须 exit 2，禁止继续推进。
# 输出:
#   gates.status: passed | failed
#   gates.failures: [{gate: "", reason: "", at: ""}]
#   gates.last_check: now
```

**不跑重活**：测试/review 在各自 stage 跑完；gate 验证产出存在、最新 verdict，
并重新计算磁盘哈希以确认 probe/evidence-audit 报告仍绑定当前证据，不重复执行测试本身。

### 已有 Run 状态审计

对恢复、迁移或历史 run，不得信任 `workflow-frame.yaml` 中声明的 `status: passed`。
必须重新执行当前 stage 的前置 gate：

```bash
sdd workflow-audit --project "$PWD" --run "<run-id>" --json
```

exit 0 表示当前 stage 前置条件仍成立；exit 2 表示声明状态与磁盘证据冲突；
exit 1 表示 workflow 输入无效。审计失败时应回退 stage，不得继续 release/archive。

---

## 4. Knowledge-Pack 组装

委托给 `sdd-context-mcp`：

```
sdd-context-mcp.build_<phase>_pack(run_id, phase, change_files)
→ 写入 .sdd/runs/<change_id>/knowledge-pack.md
```

**数据源优先级**：OpenSpec > LLMWiki > git diff > Understand-Anything > DeepWiki

---

## 5. LLMWiki 操作

LLMWiki 的知识沉淀分两层，职责分离：

**自动沉淀（CLI 层）**：`sdd run` 在 stage 推进成功后自动触发 `sedimentStage()`，
将阶段产出物写入 llmwiki/ 对应目录。agent **无需手动写 wiki**——只需把产出物
写到 `openspec/changes/<id>/` 下（findings/proposal/design/tasks/progress 等），
sediment 会自动提取并归档。

| 来源 stage | 自动沉淀到 | 触发时机 |
|-----------|-----------|---------|
| grill | wiki/_shared/glossary/ 术语 | sdd run grill 推进后 |
| product | wiki/product/requirements/ + acceptance-criteria/ | sdd run product 推进后 |
| dev | wiki/engineering/ 设计笔记 | sdd run dev 推进后 |
| code | wiki/engineering/ 实现笔记 | sdd run code 推进后 |
| review | wiki/engineering/ review learnings | sdd run review 推进后 |
| verify | wiki/testing/reports/ 验证报告 | sdd run verify 推进后 |

**主动写入（agent 层，仅 archive 阶段）**：archive 阶段需要做深度知识提取
（concepts、entities、traceability），sediment 只处理简单归档，深度提取由
agent 通过本 skill 的 LLMWiki MCP 接口主动完成。

### 写入（仅 archive 阶段 agent 使用）

```yaml
# 输入: wiki 路径（如 wiki/concepts/CON-xxx.md）、内容、frontmatter
# 操作: 通过 LLMWiki MCP 写 markdown + frontmatter
# 后置: 更新各级 _index.md、追加 log.md
```

### 读取

```yaml
# 所有阶段 agent 都可以读 LLMWiki 获取已有知识：
#   glossary 术语、product 需求、engineering 笔记、testing 用例
# 通过 LLMWiki MCP 查询
```

### archive 阶段写入路由（agent 主动写入）

| 写入目标 | 内容 |
|---------|------|
| wiki/concepts/ | 从整个 change 提取的概念 |
| wiki/entities/ | 识别的实体 |
| wiki/_shared/traceability/ | spec → code → test 追溯 |

---

## 6. Progress 与 Tracking

所有 tracking 文件位于 `openspec/changes/<change-id>/`（sdd-cli 域，进 git）。

### progress.md 追加

```markdown
## [YYYY-MM-DD HH:MM] <stage> - <action>
- <detail>
```

### findings.md 追加

```markdown
## [YYYY-MM-DD] <category>
- <finding>
- source: <source>
```

---

## 7. Subagent handoff

派发 subagent 前，准备 handoff context：

```yaml
# handoff 包:
#   - workflow-frame.yaml（当前 stage + 目标 + 允许操作）
#   - knowledge-pack.md（上下文包）
#   - 当前 stage 的 spec/design/tasks（来自 openspec/changes/<id>/）
#   - findings.md 的最新 learnings
```

---

## 8. LLMWiki Ingest/Query/Lint（Karpathy 三操作）

| 操作 | 触发 | 步骤 |
|------|------|------|
| Ingest | 新 source 放入 raw/ | 读 source → 写 sources/ 摘要 → 更新 index/log/受影响页 |
| Query | 用户/agent 提问 | 读 index 定位 → 合成答案 + citation → 好答案归档 outputs/ |
| Lint | sdd wiki lint | 查矛盾/过时/孤立/缺失/可补 source → 产出 candidate issues |

---

## 8.5. Understand-Anything 集成（code graph 查询）

Knowledge-graph.json 由 Understand-Anything 的 agent pipeline 在 init step 6 生成。后续各阶段 agent 通过本 skill 的统一接口查询，不直接裸读文件，不造额外 MCP。

### 底层能力来源

| 查询类型 | 调用的 Understand-Anything Skill/Agent | 说明 |
|---------|--------------------------------------|------|
| 代码搜索、节点查询 | `understand-chat` skill | 对话式查询 code graph 的 nodes / edges |
| 差异影响分析 | `understand-diff` skill | 分析 git diff 影响哪些模块 |
| 领域理解 | `understand-domain` skill | 将代码映射到业务 domain |
| 架构审查 | `architecture-analyzer` agent | 审查模块结构、层级关系 |
| 领域分析 | `domain-analyzer` agent | 提取业务领域与代码的映射 |

### 封装查询接口（sdd-harness 统一入口）

```yaml
# agent 调 sdd-harness，不直接调 Understand-Anything skill
#
# query_graph(type, params):
#   type: "search"   → 调 understand-chat，搜 nodes
#   type: "impact"   → 调 understand-diff + architecture-analyzer，分析变更影响
#   type: "domain"   → 调 understand-domain + domain-analyzer，映射业务领域
#   type: "boundary" → 调 architecture-analyzer，检查是否跨模块边界
#   type: "layer"    → 读 knowledge-graph.json layers 字段（本地 JSON，简单读取）
#
# 返回：结构化结果（nodes[] / upstream[] / downstream[] / layers[] / violations[]）
```

### 各阶段调用

| 阶段 | 查询 | 目的 |
|------|------|------|
| sdd-dev | `query_graph("impact", changed_module)` + `query_graph("domain")` | spec 编写前了解影响范围和领域归属 |
| sdd-code | `query_graph("boundary", file, domain)` | 实现前确认不跨 boundary |
| sdd-review | `query_graph("boundary", changed_files[], domain)` | 审查阶段检查边界违规 |
| sdd-test | `query_graph("impact", changed_module)` | 定位回归风险、确定测试范围 |
| sdd-verify | `query_graph("layer")` | 验证实现层与设计层一致 |

### 依赖声明

Understand-Anything 已在 core 依赖中（init step 6 生成 knowledge-graph.json）。init 同时安装其 skills（`understand-chat` / `understand-diff` / `understand-domain`）到平台 skills 目录。各阶段 agent 通过 `sdd-harness.query_graph()` 获得 code graph 能力，无需了解底层 Understand-Anything 的具体调用方式。

---

## 阶段到本 skill 的调用映射

| stage skill | 调用 sdd-harness 的操作 |
|-------------|----------------------|
| sdd-grill | 加载 run、knowledge-pack 组装、findings 写、glossary 写 LLMWiki |
| sdd-product | 加载 run、gate 检查、proposal/AC 写、LLMWiki product/ 写 |
| sdd-dev | 加载 run、gate 检查（dev gate）、Trinity new/continue |
| sdd-test | 加载 run、gate 检查（test gate）、LLMWiki testing/cases 写 |
| sdd-code | 加载 run、gate 检查（code gate）、Trinity apply、progress 更新 |
| sdd-review | 加载 run、gate 检查（review gate）、review-notes 写、learnings 传播 |
| sdd-verify | 加载 run、gate 检查（verify gate）、evidence 汇总、LLMWiki coverage 查 |
| sdd-release | 加载 run、gate 检查（release gate）、release note 写 |
| sdd-archive | 加载 run、gate 检查（archive gate）、Trinity archive、LLMWiki writeback |
