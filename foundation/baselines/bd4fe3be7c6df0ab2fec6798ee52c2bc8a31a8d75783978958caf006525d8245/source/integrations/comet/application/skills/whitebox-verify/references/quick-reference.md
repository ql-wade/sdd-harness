# Whitebox Verify Quick Reference

> 调试时快速查阅，减少翻阅完整 SKILL.md 的时间

---

## Mode Selection

含 UI 先读 `browser-execution.md`：发现当前 harness 原生浏览器并读其文档，再决定实际 API；截图需真实捕获并展示，不能用 DOM 快照替代。Journey/Slice 路由以 SKILL.md 为准，下面仅是 Debug 速查。

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

## Mode A: 前端验证 (Phase 0-3)

```
Phase 0: 静态契约审计 (读代码，不开浏览器)
  → 前端 API vs 后端 Controller: method / URL / 参数位置 / 字段名 → 产出: 契约匹配表
Phase 1: 结构验证 (浏览器) → 原生导航 → DOM/AX → 实际错误态观察 → 原生截图与展示
Phase 2: 链路验证 (交互) → 保留日志 → 原生交互 → 实际请求观察/关联服务日志 → 对比 expect_api
Phase 3: 数据验证 (响应) → 实际响应字段断言 → DOM 终态 → 独立效应系统回读
```

**铁律**: 三维度不一致 = P0 (method / URL / 参数位置)；READ 通过 ≠ 功能正确，CRUD 全链路必须闭环 → 详情 `iron-laws.md`（C1/C2）。各 Phase 通过条件详见 `debug-workflow.md`（同目录）。

---

## Mode B: Agent Debug (6 阶段)

```
Phase 1: Config Audit        — 读 tools.json / application.yml / docker-compose.yml，对比期望 vs 实际，优先核对配置并向实现者报告缺口
Phase 2: Startup Evidence    — docker logs | grep ToolFilter，确认工具注册列表
Phase 3: Trigger & Capture   — 方式A curl 直调(推荐首次) / 方式B 当前 harness UI(需实际截图与展示)；触发后立即抓日志
Phase 4: Log Chain Trace     — 4a Schema 注册 → 4b LLM tool_call → 4c 中间件调度 → 4d 实例化 → 4e 子组件推理 → 4f 结果汇总
Phase 5: Dual Evidence       — 日志+截图同一次调用：时间戳(<60s) / Session Key / Call ID / 内容一致
Phase 6: Report              — agent-debug-template.md + Mermaid 时序图 + Naming Traceability
```

> Phase 4 关键词链与 Phase 5 校验清单的完整版见 debug-methodology.md 与 agent-debug-workflow.md（同目录）。

---

## 常用命令速查

### Mode B Debug Commands

> `<占位符>` 从项目实际环境/配置取值（env、本地 config、密管）。**真实口令与端点不得写入本文件或任何报告**——journey-contract.md §7：Never place secrets in correlations, logs, traces, screenshots, or ledgers。

```bash
# 登录拿 token（<base_url>/<login_path>/<username>/<password> 按项目实际替换）
TOKEN=$(curl -s -X POST <base_url>/<login_path> -H "Content-Type: application/json" \
  -d '{"username":"<username>","password":"<password>"}' | jq -r '.token')

# 触发目标操作（示例：chat/send）
curl -s -X POST <base_url>/<target_path> -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"message":"<message>"}' | jq .

# 抓取日志 (触发后立即执行!); Phase 4 关键词链 grep 表见 agent-debug-workflow.md Phase 4
docker logs <container> --tail 300 > /tmp/debug_$(date +%H%M).log 2>&1

# 配置审计: 检查 tools.json allowlist 数量
cat tools.json | jq '.allow | length'

# 命名溯源: 搜索硬编码后缀 / 追踪 agent_id 来源
grep -rn '"-subagent"\|\.name(".*-subagent")' /path/to/source/
grep -rn "createAgent\|agentId" /path/to/source/
```

### Mode A 可选注入 helper（仅运行时支持注入时）

`__wbv*` helper 完整 API 定义见 `network-interceptor.js`（同目录，含 helpers）。

```javascript
__wbvClear()                              // 清空日志
__wbvGet('/api/agents')                   // 获取匹配的 API 调用
__wbvAudit('/api/agents', ['id','name'])  // 审计响应字段
__wbvHasError()                           // 检查错误
```

---

## Mermaid 安全子集

→ 完整可用/禁用清单、最佳实践与推荐模板见同目录 mermaid-guide.md。核心：消息体只用纯 ASCII，复杂内容放 Note 注释框。

---

## Anti-Pattern Top 5 (最高频)

| # | 反模式 | 后果 | 正确做法 |
|---|--------|------|---------|
| 1 | 只看页面加载就声称 PASS | 功能链路断裂不可发现 | 必须点击→检查API→检查响应 |
| 2 | 凭想象写 API 调用 | 6个P0 bug的根源 | 读后端 Controller 对比前端并报告差异 |
| 3 | 日志截图时间线不一致 | 证据无效 | 同一次触发同时抓取 |
| 4 | 不做配置审计直接改代码 | 违反约束/过度修复 | Config Audit first (P0>P1>P2>P3) |
| 5 | Mermaid用特殊字符 | 渲染空白 | 纯ASCII消息体+Note替代 |

---

## 修复优先级 / 时限参考

→ 向实现者提出的修复建议优先级（验收者不实施）(Mode B)：P0 配置文件 > P1 启动参数 > P2 业务数据 > P3 源码，完整判定条件见 `iron-laws.md#iron-law-config`。
→ 时限：工具级与全流程超时表见同目录 debug-io-contract.md#时效指导（含 Mode B 任务时长参考）。

## 输出物清单

→ **Mode A**：契约匹配表（Phase 0）/ 每页截图 / API 审计表 / 缺陷清单（P0/P1/P2）——逐项要求见 `report-template.md`。
→ **Mode B**：Config Audit 表、Startup Evidence、6 Phase 日志链、UI 截图 + 一致性校验、Mermaid 时序图、Verification Conclusion 表、Raw Data 路径索引——逐项要求见 `agent-debug-workflow.md` Phase 6。
