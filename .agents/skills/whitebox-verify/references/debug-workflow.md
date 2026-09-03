## 工作流

### 模式 A 工作流（原有，保持不变）

#### Phase 0: 准备 — 契约审计 + 网络拦截器

**Phase 0a: 静态契约审计（先于浏览器操作）**

在打开浏览器之前，先逐个 mutation 端点做三维度审计：

```
对于每个 POST/PUT/DELETE mutation:
  1. 读前端 API 文件 -> 记录: method, URL template, body 字段列表
  2. 读后端 Controller -> 记录: @XxxMapping, URL pattern, 参数位置, DTO 字段
  3. 逐字段对比:
     a. method 一致?
     b. URL 一致?
     c. 每个参数位置一致?
     d. body 字段名一致?
  4. 记录不一致项 -> 直接产出 P0 缺陷列表

对于每个 GET 端点（v1.6 强化）:
  1. 读后端 Controller 返回类型 -> 记录: DTO 字段名列表
  2. 读前端 .then() 映射代码 -> 记录: 映射中引用的字段名
  3. 特别关注 ID 类字段: 后端返回 rowId/id/uuid?
  4. 逐字段对比: 后端 DTO 字段名 === 前端映射引用名?
  5. 不一致项标记为 P1（读操作可能正常但写操作必失败）
```

**Phase 0b: 注入网络拦截器**

必须使用 `initScript` 注入，普通 `evaluate_script` 在页面导航后会丢失。

完整拦截器代码见 `references/network-interceptor.js`。首次导航时注入：

```
navigate_page({ type: "url", url: firstUrl, initScript: "拦截器完整代码" })
```

### Phase 1: 结构扫描 — 页面加载验证

```
Step 1: navigate_page 到目标路由
Step 2: take_snapshot 确认 DOM 结构
Step 3: 检查 error overlay（evaluate_script 检查 [data-radix-toast] 或 .error-overlay）
Step 4: take_screenshot 存档
通过条件: 无 error overlay，DOM 包含预期组件
```

### Phase 2: 链路验证 — 交互触发 API 调用

```
Step 1: take_snapshot 获取交互元素 uid
Step 2: click/fill 触发用户操作
Step 3: evaluate_script 读取 __wbvLog 确认 API 调用
Step 4: 检查: method, URL, request body 是否正确
通过条件: API 请求发出且参数正确
```

### Phase 3: 数据验证 — 响应字段 + CRUD 闭环（v1.6 强化）

在 Layer 3 数据验证中，对每个 GET 端点额外检查：

```
Step 3a: 响应 key 审计
  1. 从 __wbvLog 提取 response body 的实际 key 列表
  2. 找到前端 .then() 映射代码中的字段引用
  3. 逐字段对比: 后端返回的 key === 前端映射中引用的 key?
  4. 特别关注 ID 类字段: 后端可能叫 rowId/id/uuid，前端假设了哪个?

Step 3b: CRUD 闭环验证
  1. 对有删除/编辑功能的列表页，必须触发一次 DELETE 和一次 PUT
  2. 检查 DELETE URL 中的 ID 是否是有效值（不是 undefined/null）
  3. 检查 PUT 请求 body 中的字段名是否与后端 DTO 一致
```

### 模式 B 工作流：Agent Debug 六阶段法

完整步骤和命令见 `references/agent-debug-workflow.md`。摘要:

| Phase | 名称 | 核心动作 | 产出 |
|-------|------|---------|------|
| 1 | Config Audit | 读配置文件 → 对比期望 vs 实际 | Audit 表 |
| 2 | Startup Evidence | docker logs → 确认注册 | 启动日志证据 |
| 3 | Trigger & Capture | curl/UI 触发 → 收集日志链 | debug_log.txt |
| 4 | Log Chain Trace | 6 Phase grep 关键词链拼接 | 证据链表 |
| 5 | Dual Evidence Closure | 日志+截图时间戳/ID/内容三重校验 | 一致性确认 |
| 6 | Report & Traceability | 生成报告 + Mermaid + 命名溯源 | 完整报告 |

---
