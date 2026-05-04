# Progress - 会话进度日志

> **作用**: Agent 上下文锚点 - 记录操作历史、会话进度

---

## 会话信息

| 字段 | 值 |
|------|-----|
| **Change ID** | `{change-id}` |
| **开始时间** | `{timestamp}` |
| **当前会话** | `#1` |

---

## 操作日志

### 会话 #1 - {日期}

#### 初始化
```
[{timestamp}] ▶ /trinity:new "{变更描述}"
[{timestamp}] ✓ 变更目录创建: openspec/changes/{change-id}/
[{timestamp}] ✓ 追踪文件初始化
[{timestamp}] ✓ Profile 模式选择: [Quick/Core/Expanded]
```

#### proposal 阶段
```
[{timestamp}] ▶ 创建 proposal.md
[{timestamp}] ✓ 问题陈述定义
[{timestamp}] ✓ 方案选项分析 (A/B/C)
[{timestamp}] ✓ 成功指标定义
[{timestamp}] ✓ Non-goals 确认
[{timestamp}] ✓ proposal.md 创建完成
[{timestamp}] ✓ task_plan.md 更新: 阶段=proposal, 进度=20%
```

#### 文件变更
| 操作 | 文件 | 说明 |
|------|------|------|
| CREATE | proposal.md | 需求提案 |
| CREATE | task_plan.md | 任务计划 |
| CREATE | findings.md | 技术发现 |
| CREATE | progress.md | 进度日志 |

---

## 会话摘要

### 按阶段统计

| 阶段 | 开始时间 | 完成时间 | 持续时间 | 状态 |
|------|----------|----------|----------|------|
| proposal | - | - | - | [ ] |
| specs | - | - | - | [ ] |
| design | - | - | - | [ ] |
| tasks | - | - | - | [ ] |
| apply | - | - | - | [ ] |
| verify | - | - | - | [ ] |
| archive | - | - | - | [ ] |

### 关键里程碑

| 里程碑 | 时间 | 说明 |
|--------|------|------|
| 变更创建 | `{timestamp}` | 初始化 |
| - | - | - |

---

## 错误追踪

### 错误 #1
- **时间**: `{timestamp}`
- **阶段**: `[阶段名]`
- **错误类型**: `[编译/运行时/逻辑/其他]`
- **错误信息**: `错误详情`
- **尝试次数**: `1/2/3`
- **解决方案**: `如何解决`
- **状态**: `[已解决/待解决/已升级]`

---

## 下次继续

### 待完成任务
1. 任务 1
2. 任务 2

### 上下文提示
> 为下次会话提供的上下文提示

```
当前状态: [阶段名]
下一步: [具体操作]
注意事项: [任何需要注意的事项]
```

