# SDD Harness 全流程图

> 9 阶段 × 角色 × 命令 × 工具/技能 × 产出物 × Hook × Gate

```mermaid
flowchart TB
    %% ===== 样式定义 =====
    classDef stageBox fill:#a5d8ff,stroke:#1971c2,stroke-width:2px,color:#1e1e1e
    classDef hookBox fill:#ffd8a8,stroke:#e8590c,stroke-width:2px,color:#1e1e1e
    classDef gateBox fill:#ffc9c9,stroke:#e03131,stroke-width:2px,color:#1e1e1e
    classDef artifactBox fill:#b2f2bb,stroke:#2f9e44,stroke-width:1px,color:#1e1e1e
    classDef startEnd fill:#e9ecef,stroke:#868e96,stroke-width:2px,color:#1e1e1e

    %% ===== 全局 Hook 层 =====
    subgraph GLOBAL_HOOKS ["🟠 全局 Hook（贯穿所有阶段）"]
        H1["**PreToolUse Hook**\npre-tool-gate.sh\n━\n拦截: 非 code/review 阶段\n写入 src/\n━\n目的: 防越界写源码"]
        H2["**Stop Hook**\nstop-gate.sh\n━\n拦截: gate failed 时\n阻止 session 结束\n━\n目的: 防跳阶段收尾"]
        H3["**SessionStart Hook**\nsession-start.sh\n━\n注入: active-run + stage\n+ goal 到 context\n━\n目的: 阶段感知"]
        H4["**PreCompact Hook**\npre-compact-save.sh\n━\n提醒: flush progress/\nfindings 到磁盘\n━\n目的: 防上下文丢失"]
        H5["**SubagentStop Hook**\nsubagent-stop-contract.sh\n━\n检测: subagent 输出\n是否含 domain/\nartifact 字段\n━\n目的: 契约一致性"]
    end

    START(["🚀 /sdd:init"] ):::startEnd

    %% ===== Stage 1: Grill =====
    subgraph S1 ["① Grill — 澄清阶段"]
        S1R["**角色**: Architect (主) + Stakeholder"]
        S1C["**命令**: `/sdd:grill`"]
        S1T["**工具/技能**:\n• grill-me (mattpocock/skills)\n• sdd-context-mcp\n• LLMWiki MCP"]
        S1A["**产出** → findings.md\n(术语/边界/冲突/ADR候选)"]:::artifactBox
    end

    %% ===== Stage 2: Product =====
    subgraph S2 ["② Product — 产品草案"]
        S2R["**角色**: PM"]
        S2C["**命令**: `/sdd:product`"]
        S2T["**工具/技能**:\n• to-prd\n• prototype\n• LLMWiki MCP"]
        S2A["**产出** → proposal.md\n+ acceptance-criteria.md\n+ functional-test-draft.yaml\n+ wiki/product/*"]:::artifactBox
    end

    %% ===== Stage 3: Dev =====
    subgraph S3 ["③ Dev — 工程 Spec"]
        S3R["**角色**: Tech Lead"]
        S3C["**命令**: `/sdd:dev`"]
        S3T["**工具/技能**:\n• trinity-new / trinity-continue\n• Understand-Anything\n• query_graph(impact/domain)"]
        S3A["**产出** → specs/ + design.md\n+ tasks.md\n(含 File Structure Plan)"]:::artifactBox
    end

    %% ===== Stage 4: Test =====
    subgraph S4 ["④ Test — 测试矩阵"]
        S4R["**角色**: QA"]
        S4C["**命令**: `/sdd:test`"]
        S4T["**工具/技能**:\n• LLMWiki MCP\n• query_graph(impact)"]
        S4A["**产出** → wiki/testing/cases/\nTC-*.md (带 frontmatter)\n+ test matrix"]:::artifactBox
    end

    %% ===== Stage 5: Code =====
    subgraph S5 ["⑤ Code — 实现"]
        S5R["**角色**: Developer"]
        S5C["**命令**: `/sdd:code [task-id]`"]
        S5T["**工具/技能**:\n• trinity-apply\n• Superpowers TDD\n  (RED→GREEN)\n• query_graph(boundary)\n• open-code-review (可选)"]
        S5A["**产出** → 代码 diff + 测试\n+ progress.md 更新"]:::artifactBox
    end

    %% ===== Stage 6: Review =====
    subgraph S6 ["⑥ Review — 独立审查"]
        S6R["**角色**: Reviewer (独立)"]
        S6C["**命令**: `/sdd:review`"]
        S6T["**工具/技能**:\n• Superpowers code-reviewer\n  (架构 + spec 对照)\n• open-code-review CLI (行级)\n• auto-debug (拒2次→根因)\n• query_graph(boundary)"]
        S6A["**产出** → review-notes.md\n(verdict: ready/needs-fix)\n+ learnings → findings.md"]:::artifactBox
    end

    %% ===== Stage 7: Verify =====
    subgraph S7 ["⑦ Verify — 交付验证"]
        S7R["**角色**: Verify Agent"]
        S7C["**命令**: `/sdd:verify`"]
        S7T["**工具/技能**:\n• trinity-verify\n• CI test runner\n• Playwright MCP (功能 e2e)\n• chrome-devtools MCP\n  (Lighthouse perf/a11y)\n• probe-validator\n• evidence-audit\n• query_graph(layer)"]
        S7A["**产出** → probe-evidence.json\n+ probe-report.json\n+ evidence-audit-report.json\n+ Lighthouse 分数 → progress.md"]:::artifactBox
    end

    %% ===== Stage 8: Release =====
    subgraph S8 ["⑧ Release — 部署"]
        S8R["**角色**: Release Manager"]
        S8C["**命令**: `/sdd:release`"]
        S8T["**工具/技能**:\n• sdd-release skill\n• release-skills"]
        S8A["**产出** → release note\n/ changelog / deploy 结果\n/ 回滚路径"]:::artifactBox
    end

    %% ===== Stage 9: Archive =====
    subgraph S9 ["⑨ Archive — 归档"]
        S9R["**角色**: Knowledge Curator"]
        S9C["**命令**: `/sdd:archive`"]
        S9T["**工具/技能**:\n• trinity-archive\n• LLMWiki MCP writeback"]
        S9A["**产出** → openspec/specs/ 提升\n+ wiki/product/\n+ wiki/engineering/\n+ wiki/testing/\n+ change 归档"]:::artifactBox
    end

    %% ===== Gate 检查点 =====
    G_REVIEW["**🔒 Gate: Review Check**\nstage-gates.js\n━\n检查: review-notes.md 存在\n+ 最新 verdict = ready\n━\n作用: 审查未过不能推进"]:::gateBox

    G_TASKS["**🔒 Gate: Tasks Check**\nstage-gates.js\n━\n检查: tasks.md 所有项已勾选\n━\n作用: 任务未完不能部署"]:::gateBox

    G_VERIFY["**🔒 Gate: Verify Check**\nstage-gates.js\n━\n检查: probe-report pass=true\n+ evidence-audit pass=true\n+ SHA-256 链完整性\n+ projectDir 绑定\n━\n作用: 证据不足不能发布"]:::gateBox

    %% ===== 流程连线 =====
    START --> S1
    S1 --> S2
    S2 --> S3
    S3 --> S4
    S4 --> S5
    S5 --> S6
    S6 --> G_REVIEW
    G_REVIEW --> S7
    S7 --> G_VERIFY
    G_VERIFY --> S8
    S8 --> G_TASKS
    G_TASKS --> S9
    S9 --> DONE(["✅ Workflow 完成"]):::startEnd

    %% Gate 失败回路
    G_REVIEW -.->|needs-fix/rejected| S5
    G_VERIFY -.->|evidence fail| S7

    %% 全局 Hook 影响范围
    GLOBAL_HOOKS -.-> S5
    GLOBAL_HOOKS -.-> S6

    %% 样式应用
    class S1R,S1C,S1T,S2R,S2C,S2T,S3R,S3C,S3T,S4R,S4C,S4T,S5R,S5C,S5T,S6R,S6C,S6T,S7R,S7C,S7T,S8R,S8C,S8T,S9R,S9C,S9T stageBox
    class S1A,S2A,S3A,S4A,S5A,S6A,S7A,S8A,S9A artifactBox
    class H1,H2,H3,H4,H5 hookBox
```

---

## 产出核定能力（deliverable-audit）

基于 goal-loop-wizard"每一步产出都要核定"理念，新增 `deliverable-audit` 命令：

```
node bin/cli.js deliverable-audit --project <dir> --run <id> [--stage <name>] [--json]
```

### 检查规则（19 条，覆盖 8 个阶段）

| 阶段 | 规则 ID | 级别 | 检查内容 |
|---|---|---|---|
| grill | FINDINGS_EXISTS | required | findings.md 存在且 >50B |
| grill | ADR_ARCHIVED | expected | ADR 候选已归档到 wiki/product/decisions/ |
| product | PROPOSAL_EXISTS | required | proposal.md (PRD) 存在且 >50B |
| product | AC_EXISTS | required | acceptance-criteria.md 存在且 >50B |
| product | AC_SPLIT | expected | AC 已拆分到 wiki/product/acceptance-criteria/AC-*.md |
| dev | DESIGN_EXISTS | required | design.md 存在且含 boundary 注解 |
| dev | TASKS_EXISTS | required | tasks.md 存在 |
| dev | SPECS_EXIST | required | specs/ 下至少 1 个 spec delta |
| test | TEST_CASES_WRITTEN | required | wiki/testing/cases/ 下至少 1 个 TC-*.md |
| test | TEST_MATRIX_EXISTS | expected | test-matrix.md 存在 |
| review | REVIEW_NOTES_EXISTS | required | review-notes.md 存在且含 verdict |
| review | LEARNINGS_PROPAGATED | expected | learnings 已传播回 findings.md |
| verify | PROBE_REPORT_EXISTS | required | probe-report.json pass=true |
| verify | EVIDENCE_AUDIT_EXISTS | required | evidence-audit-report.json pass=true |
| release | RELEASE_NOTE_EXISTS | expected | release note / changelog 已产出或有 skip 标记 |
| archive | SPEC_PROMOTED | required | spec 已提升到 openspec/specs/ |
| archive | CONCEPTS_EXTRACTED | expected | wiki/concepts/ 有文件 |
| archive | ENTITIES_EXTRACTED | expected | wiki/entities/ 有文件 |
| archive | TRACEABILITY_MATRIX | expected | wiki/_shared/traceability/ 有文件 |

### 级别语义

- **required** — 缺失即 fail（exit 2），硬性产出必须存在
- **expected** — 缺失仅 warn，不阻断流程但报告 gap

### MiniCraft 实证结果

```
19 rules: 12 pass, 0 required fail, 7 expected fail
✅ All required deliverables present
```

7 个 expected gap 自动发现：ADR 未归档、AC 未拆分、learnings 未传播、release note 缺失、concepts/entities/traceability 空。
