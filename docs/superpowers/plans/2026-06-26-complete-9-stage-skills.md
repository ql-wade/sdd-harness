# SDD Harness Phase 1 — Complete 9 Stage Skills + Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补完 8 个 stage skill + 8 个 command，形成完整 9-stage workflow 定义（已有 sdd-grill 样板 + sdd-harness 共享层）。

**Architecture:** 每个 stage skill 遵循 sdd-grill 样板模式：读 workflow-frame → 阶段特定工作（调底层工具） → gate 检查 → 写 artifact → stage 推进。公共逻辑全部委托给 sdd-harness 共享 skill。

**Tech Stack:** Claude Code Skills (Markdown + YAML frontmatter)、reuses Trinity skills (trinity-new/continue/apply/verify/archive)、reuses Superpowers (TDD/code-reviewer)、reuses open-code-review CLI、LLMWiki MCP、Playwright/chrome-devtools MCP

**Base repo:** `/Users/mac/Code/sdd-harness` (fork 自 ql-wade/sdd-cli)

**Scope:** 本 plan 仅覆盖 8 个 stage skill + 8 个 command。以下 Phase 1 交付物**已完成**，不在本 plan 范围内：sdd-harness 共享 skill、sdd-grill 样板、6 个 template（workflow-frame/knowledge-pack/review-notes/config/dependencies/mcp-keys）、5 个 MVP hook、MCP 骨架。**CLI init 扩展**属于独立 plan。

**Arch doc:** `/Users/mac/Code/claude_tmp/sdd-harness-workflow-architecture.md`

---

## File Structure Map

```
templates/claude/skills/
├── sdd-harness/SKILL.md          ← ✅ 共享 skill（已完成）
├── sdd-grill/SKILL.md            ← ✅ Stage 1 样板（已完成）
├── sdd-product/SKILL.md           ← 🔲 Stage 2: 产品草案
├── sdd-dev/SKILL.md              ← 🔲 Stage 3: 工程 spec（封装 trinity-new + trinity-continue）
├── sdd-test/SKILL.md             ← 🔲 Stage 4: 测试矩阵
├── sdd-code/SKILL.md             ← 🔲 Stage 5: 实现（封装 trinity-apply）
├── sdd-review/SKILL.md           ← 🔲 Stage 6: Review
├── sdd-verify/SKILL.md           ← 🔲 Stage 7: 验证（封装 trinity-verify）
├── sdd-release/SKILL.md          ← 🔲 Stage 8: 部署
└── sdd-archive/SKILL.md          ← 🔲 Stage 9: 归档（封装 trinity-archive）

templates/claude/commands/
├── sdd-grill.md                  ← ✅ Stage 1 command（已完成）
├── sdd-product.md                ← 🔲
├── sdd-dev.md                   ← 🔲
├── sdd-test.md                  ← 🔲
├── sdd-code.md                  ← 🔲
├── sdd-review.md                ← 🔲
├── sdd-verify.md                ← 🔲
├── sdd-release.md               ← 🔲
└── sdd-archive.md               ← 🔲
```

---

### Task 1: sdd-product — 产品草案

**Files:**
- Create: `templates/claude/skills/sdd-product/SKILL.md`
- Create: `templates/claude/commands/sdd-product.md`
- Reference: `templates/claude/skills/sdd-harness/SKILL.md`（§1 加载 run、§3 gate 检查）
- Reference: `../../../../claude_tmp/sdd-harness-workflow-architecture.md`（§5.2 product stage contract）

- [ ] **Step 1: 创建 sdd-product SKILL.md**

对照架构文档 §5.2 的 stage contract，写 skill 文件。关键差异于 sdd-grill：
- **底层**：to-prd、prototype（非 grill-me）
- **读取**：grill findings（`openspec/changes/<id>/findings.md`）、LLMWiki product 知识
- **写入**：`openspec/changes/<id>/proposal.md`、`acceptance-criteria.md`、`functional-test-draft.yaml`
- **Gate**：proposal.md 存在、AC 可测、功能测试草案齐、progress 有记录
- **LLMWiki 写入**：`wiki/product/requirements/`、`wiki/product/acceptance-criteria/`

- [ ] **Step 2: 创建 /sdd:product command**

薄壳 command 文件，指向 sdd-product skill。

- [ ] **Step 3: 验证**

```bash
# 确认文件结构
ls -la templates/claude/skills/sdd-product/SKILL.md
ls -la templates/claude/commands/sdd-product.md
# 确认 frontmatter 完整
head -15 templates/claude/skills/sdd-product/SKILL.md
```

- [ ] **Step 4: Commit**

```bash
git add templates/claude/skills/sdd-product/ templates/claude/commands/sdd-product.md
git commit -m "feat: add sdd-product stage skill (Stage 2/9)"
```

---

### Task 2: sdd-dev — 工程 spec

**Files:**
- Create: `templates/claude/skills/sdd-dev/SKILL.md`
- Create: `templates/claude/commands/sdd-dev.md`
- Reference: arch doc §5.3 dev stage contract

- [ ] **Step 1: 创建 sdd-dev SKILL.md**

这个 skill 封装 trinity-new + trinity-continue（已有 Trinity skill）。关键：
- **底层**：trinity-new（首次）、trinity-continue（后续）、Understand-Anything skills（via sdd-harness §8.5）
- **读取**：proposal、AC、knowledge-pack、code graph（query_graph("impact") + query_graph("domain")）
- **写入**：`openspec/changes/<id>/specs/`、`design.md`（含 File Structure Plan + boundary 注解）、`tasks.md`
- **Gate**：proposal/specs/design/tasks 齐全、code-graph 引用或显式 unavailable reason、test obligations 已声明

- [ ] **Step 2: 创建 /sdd:dev command**

- [ ] **Step 3: 验证**

```bash
ls -la templates/claude/skills/sdd-dev/SKILL.md
ls -la templates/claude/commands/sdd-dev.md
head -15 templates/claude/skills/sdd-dev/SKILL.md
```

- [ ] **Step 4: Commit**

```bash
git add templates/claude/skills/sdd-dev/ templates/claude/commands/sdd-dev.md
git commit -m "feat: add sdd-dev stage skill (Stage 3/9, wraps trinity-new+continue)"
```

---

### Task 3: sdd-test — 测试矩阵

**Files:**
- Create: `templates/claude/skills/sdd-test/SKILL.md`
- Create: `templates/claude/commands/sdd-test.md`
- Reference: arch doc §5.4 test stage contract

- [ ] **Step 1: 创建 sdd-test SKILL.md**

关键：
- **底层**：LLMWiki MCP、query_graph("impact")
- **读取**：OpenSpec scenarios、AC
- **写入**：test matrix、LLMWiki `wiki/testing/cases/TC-*.md`（带 frontmatter）
- **Gate**：test matrix 产出、cases 在 LLMWiki 并 backlink 到 requirement、coverage gap 已记录

- [ ] **Step 2: 创建 /sdd:test command**

- [ ] **Step 3: 验证 + Commit**

```bash
ls -la templates/claude/skills/sdd-test/SKILL.md templates/claude/commands/sdd-test.md
git add templates/claude/skills/sdd-test/ templates/claude/commands/sdd-test.md
git commit -m "feat: add sdd-test stage skill (Stage 4/9)"
```

---

### Task 4: sdd-code — 实现

**Files:**
- Create: `templates/claude/skills/sdd-code/SKILL.md`
- Create: `templates/claude/commands/sdd-code.md`
- Reference: arch doc §5.5 code stage contract

- [ ] **Step 1: 创建 sdd-code SKILL.md**

这个 skill 封装 trinity-apply。关键：
- **底层**：trinity-apply、Superpowers TDD、query_graph("boundary")（自检）、可选 open-code-review（提交前自检）
- **读取**：OpenSpec tasks、design.md boundary plan、findings.md learnings
- **写入**：代码 diff、unit/integration 测试、`openspec/changes/<id>/progress.md`
- **Gate**：选定 task 完成、测试已跑或 waiver、Trinity tracking receipt、progress 已更新

- [ ] **Step 2: 创建 /sdd:code command**

- [ ] **Step 3: 验证 + Commit**

```bash
git add templates/claude/skills/sdd-code/ templates/claude/commands/sdd-code.md
git commit -m "feat: add sdd-code stage skill (Stage 5/9, wraps trinity-apply)"
```

---

### Task 5: sdd-review — 独立 review 阶段

**Files:**
- Create: `templates/claude/skills/sdd-review/SKILL.md`
- Create: `templates/claude/commands/sdd-review.md`
- Reference: arch doc §5.6 review stage contract

- [ ] **Step 1: 创建 sdd-review SKILL.md**

关键——先 Superpowers code-reviewer（架构 + spec/design 对照），再 open-code-review CLI（行级）：
- **底层**：Superpowers code-reviewer agent → open-code-review CLI（`ocr review`）
- **读取**：spec/design、代码 diff、progress
- **写入**：`.sdd/runs/<id>/review-notes.md`（Superpowers verdict + OCR 评论 + auto-debug 结果）
- **Gate**：Superpowers verdict=ready、OCR 评论已 triage（fixed/risk/deferred）、2 次拒后 auto-debug 已完成
- **auto-debug**（移植自 cc-sdd）：reviewer 拒 2 次 → 新起干净 subagent 查根因 → 写入 review-notes.md

- [ ] **Step 2: 创建 /sdd:review command**

- [ ] **Step 3: 验证 + Commit**

```bash
git add templates/claude/skills/sdd-review/ templates/claude/commands/sdd-review.md
git commit -m "feat: add sdd-review stage skill (Stage 6/9, Supowers+OCR)"
```

---

### Task 6: sdd-verify — 交付验证

**Files:**
- Create: `templates/claude/skills/sdd-verify/SKILL.md`
- Create: `templates/claude/commands/sdd-verify.md`
- Reference: arch doc §5.7 verify stage contract

- [ ] **Step 1: 创建 sdd-verify SKILL.md**

封装 trinity-verify。关键：
- **底层**：trinity-verify、CI test runner 产出、Playwright MCP（功能证据）、chrome-devtools MCP（非功能：Lighthouse perf/a11y）、LLMWiki coverage 查询、query_graph("layer")（验证实现层与设计层一致）
- **读取**：review-notes.md、测试结果、OpenSpec tasks
- **写入**：证据摘要（CI 链接 + pass/fail + Lighthouse 分数 + perf insights）→ `progress.md`、failure 分类
- **Gate**：tasks 完成、specs 覆盖、功能/非功能证据已收集、failure 已分类、LLMWiki coverage 已查、risk 已记录

- [ ] **Step 2: 创建 /sdd:verify command**

- [ ] **Step 3: 验证 + Commit**

```bash
git add templates/claude/skills/sdd-verify/ templates/claude/commands/sdd-verify.md
git commit -m "feat: add sdd-verify stage skill (Stage 7/9, wraps trinity-verify)"
```

---

### Task 7: sdd-release — 部署

**Files:**
- Create: `templates/claude/skills/sdd-release/SKILL.md`
- Create: `templates/claude/commands/sdd-release.md`
- Reference: arch doc §5.8 release stage contract

- [ ] **Step 1: 创建 sdd-release SKILL.md**

支持 3 种 mode：manual / automated / skip。关键：
- **Mode**：manual（产出 deploy checklist）、automated（触发 deploy pipeline + 记录结果）、skip（no-deploy 理由）
- **读取**：verify gate 通过、review-notes
- **写入**：release note/changelog、deploy 结果、回滚路径或 no-op（skip 模式下记录理由）
- **Gate**：verify gate 已过（硬前置）、deploy mode 已声明、manual 有 checklist / automated 有结果 / skip 有理由、非 skip 模式下 smoke 通过或记风险、回滚路径已记录
- **skip 模式**：workflow-frame stage 指针从 verify 直接跳 archive

- [ ] **Step 2: 创建 /sdd:release command**

- [ ] **Step 3: 验证 + Commit**

```bash
git add templates/claude/skills/sdd-release/ templates/claude/commands/sdd-release.md
git commit -m "feat: add sdd-release stage skill (Stage 8/9, manual|auto|skip)"
```

---

### Task 8: sdd-archive — 归档 + 知识沉淀

**Files:**
- Create: `templates/claude/skills/sdd-archive/SKILL.md`
- Create: `templates/claude/commands/sdd-archive.md`
- Reference: arch doc §5.9 archive stage contract

- [ ] **Step 1: 创建 sdd-archive SKILL.md**

封装 trinity-archive。关键：
- **底层**：trinity-archive、LLMWiki MCP writeback（sdd-harness §5 路由）
- **读取**：全部 artifact、verify + release gate 通过
- **写入**：accepted specs 提升到 `openspec/specs/<slug>/`（registry 关）或 `openspec/specs/<domain>/`（registry 开）或附理由延后、LLMWiki writeback（product/ + engineering/<domain>/ + testing/ + _shared/ 补 backlink）
- **Gate**：verify + release gate 已过、OpenSpec archive 完成、specs 已提升或延后有理由、LLMWiki writeback 完成或延后有理由

- [ ] **Step 2: 创建 /sdd:archive command**

- [ ] **Step 3: 验证 + Commit**

```bash
git add templates/claude/skills/sdd-archive/ templates/claude/commands/sdd-archive.md
git commit -m "feat: add sdd-archive stage skill (Stage 9/9, wraps trinity-archive)"
```

---

### Task 9: 验证——全量结构检查

- [ ] **Step 1: 确认 9 个 stage skill 全部存在**

```bash
for s in grill product dev test code review verify release archive; do
  file="templates/claude/skills/sdd-${s}/SKILL.md"
  [ -f "$file" ] && echo "✅ sdd-${s}" || echo "❌ sdd-${s} MISSING"
done
```

- [ ] **Step 2: 确认 9 个 command 全部存在**

```bash
for s in grill product dev test code review verify release archive; do
  file="templates/claude/commands/sdd-${s}.md"
  [ -f "$file" ] && echo "✅ /sdd:${s}" || echo "❌ /sdd:${s} MISSING"
done
```

- [ ] **Step 3: 确认每个 SKILL.md frontmatter 完整**

```bash
for s in grill product dev test code review verify release archive; do
  file="templates/claude/skills/sdd-${s}/SKILL.md"
  echo "--- sdd-${s} ---"
  head -12 "$file"
done
```

- [ ] **Step 4: 确认 sdd-harness 共享 skill 存在 + 调用映射表覆盖全部 9 stage**

```bash
grep "sdd-" templates/claude/skills/sdd-harness/SKILL.md | grep -v "^#"
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete 9-stage SDD Harness skills + commands (Phase 1 done)"
```
