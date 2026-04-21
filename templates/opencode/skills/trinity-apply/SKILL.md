---
name: trinity-apply
description: 执行任务（带追踪）- 三段式调用 planning-with-files + OpenSpec CLI。使用场景：用户想要开始实现任务或继续执行任务。
license: MIT
compatibility: 需要 openspec CLI 和 planning-with-files skill
metadata:
  author: trinity
  version: "2.3"
  generatedBy: "trinity-workflow-v2"
---

# trinity:apply - 执行任务

> **Trinity Workflow v2** - 三段式调用：planning-with-files → OpenSpec CLI → planning-with-files

---

## ⚠️ 重要：追踪文件位置

```
追踪文件必须放在变更目录内，而非项目根目录：

正确位置: openspec/changes/{change-id}/
  ├── task_plan.md      # 阶段进度
  ├── findings.md       # 技术发现
  ├── progress.md       # 操作日志
  └── delta-log.md      # 规格变更记录

错误位置: {project-root}/
  ├── task_plan.md      # ❌ 不要放这里
  ├── findings.md       # ❌ 不要放这里
  └── progress.md       # ❌ 不要放这里
```

---

## 触发

用户调用: `/trinity:apply`
或指定任务: `/trinity:apply 1.1`（执行特定任务）

---

## 执行流程

### Phase 0: 加载项目上下文

```
[MUST] 在执行任何操作前，读取项目上下文作为架构约束
```

#### 0.1 读取 config.yaml

```yaml
# 解析 config.yaml
contextFiles:  # Trinity 扩展配置
  - path: openspec/project.md
    description: 项目架构、子项目、设计文档引用
    required: false
```

#### 0.2 读取 contextFiles 中的文件

```
遍历 contextFiles 数组:
  for each file in contextFiles:
    if file.required and not exists(file.path):
      ERROR: "缺少必需的上下文文件: {file.path}"
    else if exists(file.path):
      content = read(file.path)
      context_sections.append(file.description, content)
```

#### 0.3 用于任务执行

- 理解代码应该放在哪个子项目
- 遵循技术栈规范（NestJS/React/Fastify）
- 参考设计文档路径

---

### Phase 1: 调用 planning-with-files（前置）

```
[MUST] 首先调用 planning-with-files skill 进行上下文加载
```

Use the Skill tool with skill: "planning-with-files"

**目的**:
1. 读取 `openspec/.active` 获取当前 change-id
2. 读取追踪文件:
   - `task_plan.md` - 了解当前阶段和进度
   - `tasks.md` - 获取任务列表
   - `findings.md` - 了解设计决策
   - `progress.md` - 了解历史操作
3. 传递 Phase 0 组装的完整项目上下文作为架构约束

---

### Phase 2: 执行 OpenSpec CLI

#### 2.1 获取 apply 指令

```bash
openspec instructions apply --change "<change-id>" --json
```

**解析 JSON 获取**:
- `contextFiles`: 需要读取的上下文文件列表
- `tasks`: 任务列表和状态
- `instruction`: 动态指导
- `state`: "ready" | "blocked" | "all_done"

#### 2.2 处理不同状态

| 状态 | 处理 |
|------|------|
| `blocked` | 提示用户缺少 artifacts，建议运行 `/trinity:continue` |
| `all_done` | 提示用户所有任务已完成，建议运行 `/trinity:verify` |
| `ready` | 继续执行任务 |

#### 2.3 读取上下文文件

根据 `contextFiles` 读取:
- `proposal.md` - 需求背景
- `specs/**/*.md` - 功能规格
- `design.md` - 技术设计
- `tasks.md` - 任务清单

#### 2.4 执行任务

```
1. 确定要执行的任务（用户指定或第一个未完成）
2. 分析任务需求，确定要修改的文件
3. 实施变更
4. 运行验证步骤（类型检查、单元测试等）
```

#### 2.5 PRE-TASK GATE（开始新任务前执行）

⛔ MANDATORY ENFORCEMENT. 跳过任何步骤 = 严重缺陷（等同发布损坏代码）。

```
在编写任何新代码之前，自检：
"上一个任务是否输出了 TRACKING RECEIPT？"
  → 没有：立即停止，回去完成上一个任务的追踪更新
  → 有：可以继续新任务
```

#### 2.6 POST-TASK GATE（每个任务完成后执行）

```
每个任务完成后——无论成功、部分成功还是失败——必须按以下精确顺序执行：

⛔ POST-TASK GATE: 3 步验证，缺一不可。每步都必须 READ-BACK 验证。

GATE-1: 更新 tasks.md
  1. 打开 tasks.md
  2. 找到当前任务行，将 `- [ ]` 改为 `- [x]`
  3. READ-BACK: 重新读取该行，确认 `[x]` 存在
  4. 如果 `[x]` 不存在 → 保存失败，重新编辑

GATE-2: 更新 progress.md
  1. 打开 progress.md，追加以下内容:
     [{timestamp}] ✅ 任务 {id}: {描述}
     [{timestamp}]   文件: {修改的文件列表}
     [{timestamp}]   验证: {结果}
  2. READ-BACK: 读取最后 5 行，确认新条目可见
  3. 如果条目不存在 → 保存失败，重新追加

GATE-3: 更新 task_plan.md
  1. 打开 task_plan.md
  2. 更新 apply 阶段进度计数器 (例如 "3/5 完成, 60%")
  3. 更新成功指标 checkbox（如有对应实现）
  4. READ-BACK: 读取进度行，确认数字与实际一致
  5. 数字不一致 → 修复编辑
```

#### 2.7 HARD STOP（禁止继续）

```
⛔ 以下行为被禁止，直到所有追踪更新完成并验证：
  - 编写任何新的源代码
  - 编辑任何非追踪文件
  - 开始任何新任务
  - 告诉用户任务"已完成"

只有当以下条件全部满足时才可继续：
  1. tasks.md checkbox 已更新 (通过 READ-BACK 验证)
  2. progress.md 已追加日志 (通过 READ-BACK 验证)
  3. task_plan.md 进度已更新 (通过 READ-BACK 验证)
  4. 已输出 TRACKING RECEIPT（见下方）
```

#### 2.8 TRACKING RECEIPT（必须输出）

```
所有验证通过后，输出以下精确行：
📋 TRACKING RECEIPT: Task {id} | tasks.md ✅ | progress.md ✅ | task_plan.md ✅

⚠️ 警告：在未实际执行 3 步更新的情况下输出此 receipt 是虚假报告。
如果任何步骤失败，不要输出 receipt——先修复步骤。
```

---

### Phase 3: 调用 planning-with-files（任务完成后）

```
[MUST] 每个任务完成后调用 planning-with-files 更新追踪
```

Use the Skill tool with skill: "planning-with-files"

**传递以下信息**:
- 完成的任务 ID
- 修改的文件列表
- 验证结果
- 下一个任务信息

**追踪文件更新内容**:

```markdown
# task_plan.md 更新

## 当前进度
阶段进度: [██████████████░░░░░░░░] 60%
- [✓] 初始化 - 创建变更目录
- [✓] proposal - 需求探索
- [✓] specs - 功能规格
- [✓] design - 技术设计
- [✓] tasks - 任务分解
- [→] apply - 执行任务 (3/5 完成)
...

# progress.md 更新

### 任务执行
[{timestamp}] ▶ 任务 1.1: {任务描述}
[{timestamp}] ✓ 完成
[{timestamp}]   修改文件: {文件列表}
[{timestamp}]   验证: {验证结果}
```

---

### 错误处理（3-Strike 协议）

如果任务失败:

| 尝试 | 动作 | 调用 planning-with-files 记录到 |
|------|------|-------------------------------|
| Attempt 1 | 诊断并修复 | progress.md |
| Attempt 2 | 尝试替代方案 | findings.md |
| Attempt 3 | 重新思考问题 | findings.md |
| 3次失败 | 升级给用户 | task_plan.md [BLOCKED] |

**每次尝试后调用 planning-with-files skill 记录**:

Use the Skill tool with skill: "planning-with-files"

传递:
- 失败的任务 ID
- 错误信息
- 尝试次数
- 当前尝试的解决方案

---

## 输出格式

### 任务完成
```
✅ 任务 {任务号} 完成
📝 修改的文件: ...
🔍 验证结果: ...
📊 进度更新: 任务进度 X/Y (Z%)
```

### 所有任务完成
```
🎉 所有任务执行完成!

📊 总计: X/Y 任务完成
📝 追踪文件已更新

🚀 下一步: 运行 /trinity:verify 验证实现
```

---

## 使用示例

```bash
/trinity:apply          # 执行下一个任务
/trinity:apply 1.1      # 执行特定任务
/trinity:apply --batch 1 # 执行整个 Batch
/trinity:apply --all    # 执行所有未完成任务
```

---

## 架构说明

```
┌─────────────────────────────────────────────────────────────────┐
│  trinity:apply 三段式架构                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 1: planning-with-files (前置)                            │
│  → 读取活跃变更、任务列表、设计决策                               │
│                                                                  │
│  Phase 2: OpenSpec CLI                                          │
│  → openspec instructions apply --json                           │
│  → 读取 contextFiles, 执行任务                                   │
│  → 每个任务完成后触发 Phase 3                                     │
│                                                                  │
│  Phase 3: planning-with-files (每个任务完成后)                   │
│  → 更新 task_plan.md, progress.md                               │
│  → 记录修改文件、验证结果                                        │
│                                                                  │
│  错误时: 调用 planning-with-files 记录到对应文件                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**关键原则**:
- 不侵入修改 planning-with-files skill
- 不侵入修改 OpenSpec 官方 skills
- 通过调用实现集成，而非内联逻辑
- 每个任务完成都更新追踪文件（PRE-TASK GATE + POST-TASK GATE + HARD STOP）
- READ-BACK 验证：每次文件更新后必须读取确认
- TRACKING RECEIPT：任务间传递的强制凭证
- FINAL CHECK：阶段结束前的审计协议

---

## 自检协议（所有任务完成后 — 最终验证）

⛔ 在告诉用户"所有任务完成"之前，必须执行以下协议。

```
FINAL VERIFICATION — 如果任何一项失败，修复后再继续：

1. tasks.md 审计:
   未完成数 = grep -c '\- \[ \]' tasks.md
   IF 未完成数 > 0:
     → 逐个检查未勾选的任务，确认是真的未做还是忘记勾选
     → 忘记勾选的立即修复
     → 确实未做的要完成或记录原因

2. progress.md 审计:
   读取最后一条日志
   确认该条目引用的是你最后完成的任务
   如果不是 → 你遗漏了日志记录，修复

3. task_plan.md 审计:
   读取 apply 进度行
   确认完成计数等于你实际完成的任务数
   数字不匹配 → 修复进度行

4. 输出（必须）:
   📋 FINAL CHECK: tasks.md {X} unchecked | progress.md last={task_id} | task_plan.md progress={N/M}

⛔ 未输出 FINAL CHECK 行，禁止报告"所有任务完成"。
```
