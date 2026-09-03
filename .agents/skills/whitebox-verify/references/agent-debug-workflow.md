# Agent Debug 六阶段法 — 完整工作流

当使用模式 B（Agent/后端服务调试）时，按以下六阶段执行。本文件包含详细的步骤、命令和校验清单。

## Phase 1: Config Audit (配置审计)

```
Step 1: 列出所有相关配置文件
  - tools.json (allowlist/deny)
  - application.yml / application.properties
  - docker-compose.yml (环境变量/端口映射)
  - workspace/*.md (agent 声明文件)

Step 2: 逐个对比 期望 vs 实际
  - 期望: sessions_spawn 在 allowlist -> 实际: 缺失 -> Finding #1
  - 期望: task_output 在 allowlist -> 实际: 缺失 -> Finding #2

Step 3: 产出 Config Audit 表
  | File | Item | Expected | Actual | Severity |
  |------|------|----------|--------|----------|
  | tools.json | allowlist size | >=14 | 6 | P0 |
```

## Phase 2: Startup Evidence (启动态证据)

```
Step 1: 重启服务 (如果需要)
Step 2: 抓取启动日志
  docker logs <container> --tail 100 2>&1 | grep -E "ToolFilter|Converted tool"
Step 3: 验证工具注册
  期望输出: "ToolFilter: removed X, Y remain"
  检查点: 目标工具是否在 remain 列表中
```

## Phase 3: Trigger & Capture (触发+捕获)

**方式 A: curl 直调（推荐用于首次验证）**

```bash
# 1. 登录拿 token（按实际 auth 方案调整）
TOKEN=$(curl -s -X POST <login-url> \
  -H "Content-Type: application/json" \
  -d '<credentials>' | jq -r '.token')

# 2. 触发目标操作
curl -s -X POST <target-url> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '<request-body>' | jq .

# 3. 立即抓取日志
docker logs <container> --tail 200 > /tmp/debug_log.txt 2>&1
```

**方式 B: UI 操作（用于截图证据）**

```
Step 1: 导航到目标页
Step 2: 填写表单 + 触发操作
Step 3: 等待执行完成 (10-15s for LLM)
Step 4: 截图
```

## Phase 4: Log Chain Trace (日志链路追踪)

从日志中按顺序提取 6 个 Phase 关键词，每步必须有日志支撑:

| Phase | grep 关键词 | 判定 |
|-------|-------------|------|
| 4a Schema 注册 | `Converted tool to OpenAI format.*<tool_name>` | 工具已注册到 OpenAI schema |
| 4b LLM tool_call | `Streaming tool call chunk.*name=<tool_name>` | LLM 发起了 tool_call（记录 call_id） |
| 4c 中间件调度 | `POST_REASONING.*<tool_name>`, `TOOL_CALL.*<tool_name>`, `PRE_ACTING.*<tool_name>` | 中间件完整调度（记录 session key） |
| 4d 子组件实例化 | `HarnessAgent.*built` | 子 agent 实例化成功（记录实例名） |
| 4e 子组件推理 | `[sub-agent-name].*PRE_REASONING`, `[sub-agent-name].*POST_REASONING` | 子 agent 独立推理完成 |
| 4f 结果汇总 | `SSE content`, `final reply`, `status=ok` | 结果返回给主 agent |

**产出**: 6 Phase 日志证据链表，每条含精确时间戳 + 关键字段值。

## Phase 5: Dual Evidence Closure (双重证据闭环)

校验清单:

```
[ ] 日志时间戳 == 截图操作时间 (误差 < 60s)
[ ] 日志 Session Key == 截图中可见的 Session Key
[ ] 日志 call_id / label == 截图右侧事件时间线内容
[ ] 日志输出内容 == 截图渲染内容
[ ] 如果不一致 -> 重新触发一次，同时抓取日志和截图
```

## Phase 6: Report & Traceability (报告+溯源)

生成完整报告，包含以下章节:

1. **验证目标 + 约束条件**
2. **Config Audit** (Phase 1 产出)
3. **Startup Evidence** (Phase 2 产出)
4. **E2E 测试案例** (输入/输出摘要)
5. **Log Evidence Chain** (Phase 4 产出, 6 Phase 完整链路)
6. **Mermaid 时序图** (E2E 全链路, 见 `references/mermaid-guide.md`)
7. **UI 截图证据** (Phase 5 产出, 含关键信息标注表)
8. **Naming Traceability** (运行时命名溯源, 见 `references/naming-traceability.md`)
9. **验证结论** (PASS/FAIL/PARTIAL + 检查表)
10. **原始数据位置** (日志文件/截图路径/配置文件)
