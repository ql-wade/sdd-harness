## 核心方法论

### 模式 A：三层验证（原有）

```
Layer 1: Structure   -> 页面加载不崩溃？DOM 结构正确？无 error overlay？
Layer 2: Pipeline     -> 按钮点击 -> API 调用？请求 URL/method/body 正确？
Layer 3: Data        -> API 响应包含前端需要的字段？类型匹配？状态更新正确？
```

**验证顺序必须是 Layer 1 -> 2 -> 3**。只看页面渲染就声称"验证通过"是不够的。

### 模式 B：Agent Debug 六阶段法（v1.5 新增）

基于 subagent 调试验证实战提炼的可复用模板：

```
Phase 1: Config Audit (配置审计)
  读配置文件 -> 对比期望 vs 实际 -> 定位缺失/多余项
  例: tools.json allowlist 只有 6 个工具，缺 sessions/task

Phase 2: Startup Evidence (启动态证据)
  docker logs 看 ToolFilter 输出 -> 确认注册了什么
  例: "ToolFilter: removed 6, 14 remain" -> sessions_spawn 在列

Phase 3: Trigger & Capture (触发+捕获)
  curl 或 UI 触发真实请求 -> 收集完整日志链
  例: POST /chat/send -> grep 关键词链

Phase 4: Log Chain Trace (日志链路追踪)
  按 Phase 拼接完整调用链，每步必须有日志支撑:
    Phase 4a: OpenAI Schema 注册 (Converted tool to OpenAI format)
    Phase 4b: LLM tool_call 发起 (Streaming tool call chunk)
    Phase 4c: 中间件调度 (POST_REASONING -> TOOL_CALL -> PRE_ACTING)
    Phase 4d: 子组件实例化 (HarnessAgent 'xxx' built)
    Phase 4e: 子组件推理执行 (PRE_REASONING -> POST_REASONING)
    Phase 4f: 结果汇总返回 (final reply / SSE done)

Phase 5: Dual Evidence Closure (双重证据闭环)
  日志证据 + UI 截图 必须来自同一次调用:
    - 时间戳一致 (如 01:31:xx 非 01:07:xx)
    - Session Key / Call ID 一致
    - 日志内容与截图内容对应

Phase 6: Report & Traceability (报告+溯源)
  生成包含: 日志链 + 截图 + Mermaid 时序图 + 命名溯源
```

**铁律: 双重证据一致性** — 日志（白盒）和截图（黑盒）必须来自同一次调用。时间戳一致 + Session Key 一致 + 内容匹配。混用不同调用的证据 = 报告无效。

---
