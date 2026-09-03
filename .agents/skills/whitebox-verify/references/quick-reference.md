# Whitebox Verify Quick Reference

> 调试时快速查阅，减少翻阅完整 SKILL.md 的时间

---

## Mode Selection (5s 决策)

```
前端功能问题?     → Mode A (Phase 0→1→2→3)
Agent/后端问题?   → Mode B (Phase 1→6)
不确定?           → 看下方症状对照表
```

### 症状 → 模式映射

| 症状 | 模式 | 起始 Phase |
|------|------|-----------|
| 页面白屏/崩溃 | A | Phase 1 |
| 按钮点了没反应 | A | Phase 2 |
| API 数据不显示 | A | Phase 3 |
| 工具调用不生效 | B | Phase 1 |
| 子 agent 不工作 | B | Phase 1 |
| 配置改了没效果 | B | Phase 1 |
| 日志有报错但不知根因 | B | Phase 1 |

---

## Mode A: 前端验证 (核心 3 步)

```
Phase 0: 静态契约审计 (读代码，不开浏览器)
  → 前端 API vs 后端 Controller: method / URL / 参数位置 / 字段名
  → 产出: 契约匹配表

Phase 1: 结构验证 (浏览器)
  → navigate → snapshot → hasError() → screenshot
  → 通过: 无 error overlay + DOM 完整

Phase 2: 链路验证 (交互)
  → clear → click → wbvGet(url) → 对比 expect_api
  → 通过: API method/url/body 正确

Phase 3: 数据验证 (响应)
  → wbvAudit(fields) → missingFields=[] → 追踪到 DOM
  → 通过: 响应字段 ⊇ 前端 interface 字段
```

**铁律**: 三维度不一致 = P0 (method / URL / 参数位置)

---

## Mode B: Agent Debug (6 阶段)

```
Phase 1: Config Audit (配置审计)
  → 读 tools.json / application.yml / docker-compose.yml
  → 对比期望 vs 实际
  → P0 优先修配置，不动源码

Phase 2: Startup Evidence (启动态)
  → docker logs --tail 100 | grep ToolFilter
  → 确认工具注册列表

Phase 3: Trigger & Capture (触发+抓取)
  方式A: curl 直调 (推荐首次验证)
  方式B: Preview MCP UI 操作 (需要截图时)
  → 抓日志: docker logs --tail 200 > /tmp/debug.log

Phase 4: Log Chain Trace (6 Phase 日志链)
  4a: Converted tool to OpenAI format    → 工具可见性
  4b: Streaming tool call chunk         → LLM 发起调用
  4c: POST_REASONING→TOOL_CALL→PRE_ACTING → 中间件调度
  4d: HarnessAgent 'xxx' built          → 实例化成功
  4e: [name] PRE→POST_REASONING        → 子组件推理
  4f: final reply / SSE done            → 结果返回

Phase 5: Dual Evidence Closure (双重证据)
  ✅ 时间戳一致 (误差 <60s)
  ✅ Session Key 一致
  ✅ Call ID 一致
  ✅ 内容匹配
  ❌ 不一致 → 重新触发，同时抓取

Phase 6: Report (报告)
  → 用 agent-debug-template.md 填写
  → 含 Mermaid 时序图 + Naming Traceability
```

---

## 常用命令速查

### Mode B Debug Commands

```bash
# 登录拿 token
TOKEN=$(curl -s -X POST http://localhost:8082/agentscope/admin/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123456"}' | jq -r '.token')

# 触发 chat/send
curl -s -X POST http://localhost:8082/agentscope/admin/api/agents/default/chat/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"你的测试消息"}' | jq .

# 抓取日志 (立即执行!)
docker logs <container> --tail 300 > /tmp/debug_$(date +%H%M).log 2>&1

# 过滤关键阶段
grep -E "Converted tool|tool_call chunk|POST_REASONING|Tool_CALL|PRE_ACTING|HarnessAgent.*built|PRE_REASONING|POST_REASONING|SSE content|final reply" /tmp/debug_*.log

# 配置审计: 检查 tools.json allowlist 数量
cat tools.json | jq '.allow | length'

# 命名溯源: 搜索硬编码后缀
grep -rn '"-subagent"\|\.name(".*-subagent")' /path/to/source/

# 命名溯源: 追踪 agent_id 来源
grep -rn "createAgent\|agentId" /path/to/source/
```

### Mode A Chrome MCP Commands

```javascript
// 清空日志
__wbvClear()

// 获取匹配的 API 调用
__wbvGet('/api/agents')

// 审计响应字段
__wbvAudit('/api/agents', ['id','name','type','description'])

// 检查错误
__wbvHasError()
```

---

## Mermaid 安全子集

### ✅ 可以用
- `participant X as Name` 或 `participant X as Name<br/>Sub`
- `->>`, `-->>`, `->` 箭头
- `Note over/of/right/left X: text`
- `loop/alt/opt/par` 块
- `rect rgb(r,g,b)` (谨慎使用)

### ❌ 不能用 (解析失败)
- `{}` `""` `<>` 在消息体中
- `\n` `|` `┌─┐` `└─┘` 在消息体中
- 多层嵌套 `<br/>` (>1层)

### 最佳实践
```
消息体: 只用纯 ASCII 文本
复杂内容: 放 Note 注释框
细节补充: 用 Note right of X:
渲染前: 先本地预览验证
```

---

## Anti-Pattern Top 5 (最高频)

| # | 反模式 | 后果 | 正确做法 |
|---|--------|------|---------|
| 1 | 只看页面加载就声称 PASS | 功能链路断裂不可发现 | 必须点击→检查API→检查响应 |
| 2 | 凭想象写 API 调用 | 6个P0 bug的根源 | 先读后端Controller再写前端 |
| 3 | 日志截图时间线不一致 | 证据无效 | 同一次触发同时抓取 |
| 4 | 不做配置审计直接改代码 | 违反约束/过度修复 | Config Audit first (P0>P1>P2>P3) |
| 5 | Mermaid用特殊字符 | 渲染空白 | 纯ASCII消息体+Note替代 |

---

## 修复优先级 (Mode B)

```
P0: 改配置文件 (tools.json / env / flags)     ← 最小变更, 零风险
P1: 改启动参数 (JVM opts / docker-compose)    ← 不改代码
P2: 改业务数据 (DB记录 / workspace文件)       ← 改数据不改逻辑
P3: 改源码 (Java/TS/Python)                   ← 仅当允许时
```

**Karpathy #2**: 能用配置解决就不用改代码。

---

## 时限参考

| 任务 | Mode A | Mode B |
|------|--------|--------|
| 单页面验证 | 5min | — |
| 全路由扫描 | N×1min | — |
| Config Audit | — | 3min |
| Log Chain Trace | — | 5min |
| Dual Evidence | — | 3min |
| 完整报告生成 | — | 10min |
| **全流程** | **15-30min** | **20-30min** |
| LLM 推理等待 | — | 10-30s/轮 |

---

## 输出物清单

### Mode A 必交
- [ ] 契约匹配表 (Phase 0)
- [ ] 每页截图 (Phase 1)
- [ ] API 审计表 (Phase 2+3)
- [ ] 缺陷清单 (P0/P1/P2)

### Mode B 必交
- [ ] Config Audit 表 (Phase 1)
- [ ] Startup Evidence (Phase 2)
- [ ] 6 Phase 日志链 (Phase 4)
- [ ] UI 截图 + 一致性校验 (Phase 5)
- [ ] Mermaid 时序图 (Phase 6)
- [ ] Verification Conclusion 表
- [ ] Raw Data 路径索引
