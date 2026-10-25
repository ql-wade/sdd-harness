# Naming Traceability 规范

当运行时出现意外名称时，按此链路溯源:

```
运行时名称 (如 "general-purpose-subagent")
  |
  v
拆分前缀 + 后缀
  |
  +--------+---------+
  前缀来源    后缀来源
  (LLM 选择)   (硬编码/拼接)
  |            |
  v            v
agent_id      .name() 调用
参数          HarnessAgentBuilderSupport
               SubagentFactory.create()
               或者 SessionsTool.spawn()
               或者 AgentSpawnTool.agentSpawn()
```

## 通用溯源命令

```bash
# 1. 从日志中提取实例名
grep "HarnessAgent.*built" logfile.txt

# 2. 搜索硬编码后缀
grep -rn '"-subagent"\|\.name(".*-subagent")' /path/to/source/

# 3. 追踪 agent_id 来源
grep -rn "agentId.*general-purpose\|createAgent(" /path/to/source/

# 4. 追踪声明文件
find /path/to/workspace/subagents -name "*.md" | xargs grep -l "general-purpose"
```
