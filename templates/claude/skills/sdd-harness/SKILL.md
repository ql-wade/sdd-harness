---
name: sdd-harness
description: SDD Harness Claude reference adapter —— artifact 生产、CLI control-plane 请求、knowledge-pack 组装与 LLMWiki 操作。
license: MIT
compatibility: 需要 OpenSpec CLI、Trinity skills、planning-with-files、Superpowers
metadata:
  version: "0.1.0"
  generatedBy: "sdd-harness"
---

# sdd-harness（共享 skill）

SDD Harness 的 Claude reference adapter 公共层。`sdd` CLI 是唯一 workflow control plane；本 skill 与 9 个 stage skills 只读取状态、生产 artifacts、调用外部能力，并通过 `sdd run <stage>` 请求 CLI 复核和转换。

---

## 0. Bootstrap Run（委托 CLI）

grill 阶段 Step 1（或其他阶段发现 active-run 缺失时）只能通过 CLI 创建 run：

```bash
sdd run grill --goal "<来自用户输入>" --slug "<slug>"
change_id=$(cat .sdd/active-run)
# CLI 创建 canonical change、governance runtime 与 active-run；
# scaffold 未达指标时保持 grill/pending，属于正常 bootstrap 结果。
```

**幂等**：若 `.sdd/active-run` 已存在且对应 workflow-frame.yaml 的 stage 与当前请求一致，跳过 bootstrap 直接 resume。

---

## 1. 入口：5-Question Reboot Test（借鉴 planning-with-files）

**Before ANY decision** — stage 开始、artifact 写、阶段推进、subagent 交接、context 压缩、完成前，必须能从文件回答这 5 问（非对话记忆）：

```bash
change_id=$(cat .sdd/active-run 2>/dev/null || echo "")
```

| # | 问题 | 答案来源 | 答不出来怎么办 |
|---|------|---------|-------------|
| 1 | **Where am I?**（当前 stage） | `.sdd/runs/$change_id/workflow-frame.yaml` → `stage.current` | 无 active-run → bootstrap（§0） |
| 2 | **Where am I going?**（下一步） | `workflow-frame.yaml` → stage 推进链 + `openspec/changes/$change_id/tasks.md` | 无 tasks → 上一个 stage gate 没过 |
| 3 | **What's the goal?**（变更目标） | `openspec/changes/$change_id/proposal.md` | 无 proposal → product stage 未完成 |
| 4 | **What have I learned?**（已发现） | `openspec/changes/$change_id/findings.md` | 无 findings → grill stage 未完成 |
| 5 | **What have I done?**（已执行） | `openspec/changes/$change_id/progress.md` | 无 progress → 首次进入此 change |

**5 问全答出 → 状态完整，可以工作。** 任何 1 问答不出 → 停，先修复对应文件。

**2-Action Rule**（防 context 丢失）：每 2 次 Read/Search/Grep → 立即写 `findings.md`。多模态信息（截图/搜索结果）在 context 压缩后必丢——先落盘。

---

## 2. Stage 状态转换请求

```bash
# stage skill 完成 artifact 后请求 CLI 复核。
sdd run <stage> --change "$change_id"
# CLI 独占：gate status、stage current/history、run_status 与 active-run。
```

### Stage 顺序

```
grill → product → dev → test → code → review → verify → release → archive
```

release mode=skip 时：verify → archive（跳过 release）。

### 回退

```bash
sdd rollback --change "$change_id" --to "<target_stage>" --reason "<回退原因>"
```

---

## 3. Gate 检查（委托 CLI）

每个 stage 的 gate 规则见各自 stage contract。Adapter 不自行宣布 gate passed，必须调用：

```bash
sdd run <stage> --change "$change_id"
```

CLI 公共检查逻辑：

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

由本 skill 内联组装（不再委托外部 MCP，避免 stub 依赖）：

```
build_knowledge_pack(run_id, phase, change_files)
→ 读 OpenSpec changes/specs + LLMWiki（经 mcp__llmwiki__search）+ git diff + Understand-Anything graph
→ 写 .sdd/runs/<change_id>/knowledge-pack.md
```

**数据源优先级**：OpenSpec > LLMWiki > git diff > Understand-Anything > DeepWiki

---

## 5. LLMWiki 操作

LLMWiki 的知识沉淀分两层，职责分离：

**自动沉淀（CLI 层）**：`sdd run` 在 stage 转换成功后自动触发 `sedimentStage()`，
将阶段产出物写入 `.sdd/staging/<stage>/`。agent 无需直接写共享 wiki；archive
阶段通过 LLMWiki MCP 提交 staging，避免绕过 SQLite、FTS 与引用图索引。

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
# 输入: wiki 路径（如 /wiki/concepts/CON-xxx）、title、content、tags
# 操作: 调 mcp__llmwiki__create（同步 SQLite + FTS + 引用图；tags 必填）
#       已存在则用 mcp__llmwiki__edit / append
# 注意: 不要 fs.writeFile 直接写——绕过索引，search 找不到
```

### 读取

```yaml
# 所有阶段 agent 都可以读 LLMWiki 获取已有知识：
#   glossary 术语、product 需求、engineering 笔记、testing 用例
# 调 mcp__llmwiki__search / read 查询（走 SQLite + FTS 索引）
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

Understand-Anything 属于显式 `graph` capability，不是 Core 隐式依赖。通过 `sdd init --adapter claude --with graph` 安装；各阶段先运行 `sdd doctor --stage <stage>`，只有 contract 要求且 capability available 时才查询图谱。

---

## 阶段到本 skill 的调用映射

| stage skill | 调用 sdd-harness 的操作 |
|-------------|----------------------|
| sdd-grill | 加载 run、knowledge-pack、findings；请求 `sdd run grill` |
| sdd-product | proposal/AC；请求 `sdd run product` |
| sdd-dev | Trinity new/continue；请求 `sdd run dev` |
| sdd-test | LLMWiki testing/cases；请求 `sdd run test` |
| sdd-code | Trinity apply、progress；请求 `sdd run code` |
| sdd-review | review-notes、learnings；请求 `sdd run review` |
| sdd-verify | evidence、coverage；请求 `sdd run verify` |
| sdd-release | release note；请求 `sdd run release` |
| sdd-archive | Trinity archive、writeback；请求 `sdd run archive` |
