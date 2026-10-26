## 前置条件

### 模式 A 前置条件

1. **当前 harness 浏览器可用** — 先读 `browser-execution.md`，确认导航/DOM/交互/截图及网络等独立能力；Chrome MCP 不是前提
2. **Dev server 运行中** — `base_url` 可访问
3. **后端服务可用**（可选）— 若后端不可用，可验证 Layer 1+2（请求发出），但无法验证 Layer 3

### 模式 B 前置条件

1. **目标服务可访问** — Docker 容器运行中或进程存活
2. **日志可读取** — `docker logs` 或日志文件路径已知
3. **配置文件位置已知** — tools.json / application.yml 等
4. **约束明确** — 独立验收不修改源码、测试或配置；诊断与缺口交回作者
5. **原生浏览器按需** — 有 UI/截图任务时按 `browser-execution.md` 执行

## 工作流

### 模式 A 工作流（独立验收）

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

**Phase 0b: 选择请求证据来源**

先读当前浏览器工具文档，优先其真实请求/响应观察。只有明确支持导航前脚本注入时才可采用 `network-interceptor.js`；不得假设 `navigate_page` 接受 `initScript`。若只有 DOM/截图，用同一次操作的服务接收日志补充链路证据并如实标来源；缺必需浏览器网络/console 证据时保留未验证，不绕过 Journey 契约。

### Phase 1: 结构扫描 — 页面加载验证

```
Step 1: 用当前 harness 导航到已确认目标路由
Step 2: 用实际 DOM/AX 快照确认结构
Step 3: 从 DOM/截图确认错误态；仅在实际支持时读取 console/evaluate
Step 4: 按原生截图协议捕获、展示并归档
通过条件: 无 error overlay，DOM 包含预期组件
```

### Phase 2: 链路验证 — 交互触发 API 调用

```
Step 1: 读当前 DOM/AX，以真实可见语义选择元素
Step 2: 用实际交互 API 触发用户操作
Step 3: 从支持的网络观察或关联服务日志确认实际请求；不可虚构 __wbvLog
Step 4: 检查: method, URL, request body 是否正确
通过条件: API 请求发出且参数正确
```

### Phase 3: 数据验证 — 响应字段 + CRUD 闭环（v1.6 强化）

在 Layer 3 数据验证中，对每个 GET 端点额外检查：

```
Step 3a: 响应 key 审计
  1. 从真实响应证据提取 body 的实际 key 列表
  2. 找到前端 .then() 映射代码中的字段引用
  3. 逐字段对比: 后端返回的 key === 前端映射中引用的 key?
  4. 特别关注 ID 类字段: 后端可能叫 rowId/id/uuid，前端假设了哪个?

Step 3b: CRUD 闭环验证
  1. 对有删除/编辑功能的列表页，必须触发一次 DELETE 和一次 PUT
  2. 检查 DELETE URL 中的 ID 是否是有效值（不是 undefined/null）
  3. 检查 PUT 请求 body 中的字段名是否与后端 DTO 一致
```

### 模式 B 工作流：Agent Debug 六阶段法

摘要:

| Phase | 名称 | 核心动作 | 产出 |
|-------|------|---------|------|
| 1 | Config Audit | 读配置文件 → 对比期望 vs 实际 | Audit 表 |
| 2 | Startup Evidence | docker logs → 确认注册 | 启动日志证据 |
| 3 | Trigger & Capture | curl/UI 触发 → 收集日志链 | debug_log.txt |
| 4 | Log Chain Trace | 6 Phase grep 关键词链拼接 | 证据链表 |
| 5 | Dual Evidence Closure | 日志+截图时间戳/ID/内容三重校验 | 一致性确认 |
| 6 | Report & Traceability | 生成报告 + Mermaid + 命名溯源 | 完整报告 |

## 修复后回归有效性（证明验证手段能捕获该 bug）

重跑完整图谱（功能图谱铁律，见 `iron-laws.md#iron-law-graph`）之外，修复后还须证明**验证手段本身能捕获该 bug**——否则"回归通过"可能是验证手段失明，不是修复有效。

**审查作者交付的敏感性证明**：

1. 从可信需求与 TestPack 或已有批准测试/手工用例核对已有关键断言、相同测试身份和完整命令。
2. 在作者交付的已修复版本独立运行，要求干净 PASS。
3. 在作者已准备且授权的隔离 pre-fix revision 或 mutation/fault-injection 控制环境运行同一测试，确认预期 FAIL，并检查 control evidence。
4. 独立重跑修复版本与受影响回归，保留全部版本、指纹、原始输出及顺序。

不在验收过程中 revert/修改产品、配置、断言、期望或测试文件来造失败。缺少可重放 RED、控制环境或敏感性证明时登记缺口，交给 test-authoring/实现者准备后重新验收；不能静默补测试或将缺口算通过。Journey/Slice 仍保留原有 RED 方法、时序、不同摘要与 control evidence 全部门槛。

## 验证报告要点

- 每个交互记录：步骤表（操作/预期/实际/结果）+ API 审计 + 缺陷清单
- 汇总：总页面数/通过/失败/跳过/P0/P1/P2 计数
- 截图：每个页面的加载后 + 关键操作/失败现场截图；按 browser-execution.md 展示图像并关联 run/case/step 与产物
- (模式 B) 日志证据链：6 Phase 完整链路 + 时间戳 + 关键 ID
- (模式 B) Mermaid 时序图：E2E 全链路（遵循 mermaid-guide.md 绘图规范）
- (模式 B) Naming Traceability：运行时命名溯源（见 naming-traceability.md）
- 报告格式模板：`report-template.md`（模式 A）/ `agent-debug-template.md`（模式 B）

---
