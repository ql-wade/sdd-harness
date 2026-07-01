# SDD Harness 服务编排指南

> 本文档供 LLM agent 和人类阅读。读完就知道：什么东西该 docker 起来，什么东西该全局装，什么东西跟着 session 走，按什么顺序。

## 三层架构

```
┌──────────────────────────────────────────────────────────────┐
│  被构建的项目 (e.g. PAV2)                                     │
│  有自己的 docker-compose.yml (postgres, redis, app servers)   │
│  ← harness 不碰这层                                          │
├──────────────────────────────────────────────────────────────┤
│  SDD Harness — 持久服务层 (Docker)                            │
│  docker compose -f ~/.sdd/docker-compose.sdd.yml up -d       │
│  └─ opendeepwiki  :8090  AI 仓库知识库 + MCP endpoint         │
│  └─ opendeepwiki  :3001  Web UI (导入仓库、查看 wiki)         │
├──────────────────────────────────────────────────────────────┤
│  SDD Harness — 会话层 (AI 工具 spawn，不进 docker)            │
│  随 Claude Code / Codex session 启停                         │
│  ├─ llmwiki MCP    : 子进程，由 .mcp.json 注册               │
│  ├─ opendeepwiki MCP : URL 型，指向持久服务                  │
│  └─ Understand-Anything : agent pipeline，会话内触发         │
├──────────────────────────────────────────────────────────────┤
│  系统层 (全局安装，brew/npm)                                  │
│  ├─ Node.js 18+   ├─ OpenSpec CLI  ├─ open-code-review       │
│  └─ git           └─ docker                                   │
└──────────────────────────────────────────────────────────────┘
```

## 首次安装顺序（LLM 执行指南）

```bash
# 1. 全局 CLI（系统层）
brew install node git openspec           # macOS
npm i -g @alibaba-group/open-code-review

# 2. harness 本体
npm link                                 # 从 sdd-harness repo

# 3. 项目初始化（在目标项目根目录）
cd your-project
sdd init                                 # 装 skills + hooks + LLMWiki + knowledge-seed

# 4. 持久服务（可选但推荐）
sdd services up                          # 启动 OpenDeepWiki

# 5. 代码知识图谱（在 Claude Code 会话内）
/understand                              # 生成 Understand-Anything graph

# 6. 开始工作
/sdd:grill "你的需求描述"
```

## 各服务职责与数据源优先级

SDD 阶段 agent 查询知识时，数据源按优先级覆盖：

```
OpenSpec specs (最高)    ← 规格层：这个功能应该怎么行为
    ↓ 覆盖
LLMWiki                  ← 文档层：项目已有文档 + knowledge-seed 提取
    ↓ 覆盖
Understand-Anything      ← 结构层：代码 node/edge/boundary graph
    ↓ 覆盖
OpenDeepWiki (最低)      ← 叙述层：AI 生成的架构叙述（"为什么"）
```

冲突时高优先级覆盖。每个数据源有独立的刷新机制：

| 数据源 | 刷新方式 | 自动？ | 频率 |
|--------|---------|--------|------|
| OpenSpec specs | `openspec` CLI | 手动 | 每次 change |
| LLMWiki | `sdd wiki ingest` + knowledge-seed | 手动 | init 时 + 按需 |
| Understand-Anything | `/understand` (agent pipeline) | 手动 | 代码大改后 |
| OpenDeepWiki | 内置增量 worker | **自动** | 每 60 分钟 |

## 持久服务管理

```bash
sdd services up       # 启动 OpenDeepWiki
sdd services down     # 停止
sdd services status   # 检查健康
sdd doctor            # 全面健康检查（含 OpenDeepWiki）
```

OpenDeepWiki 首次启动后需要导入仓库：
1. 打开 http://localhost:3001 (admin@routin.ai / Admin@123)
2. 导入目标仓库 (Git URL 或本地路径)
3. 等待 AI 生成 wiki（首次约 5-15 分钟）
4. 之后增量更新全自动

## 为什么不全塞进 Docker

LLMWiki MCP 和 Understand-Anything 不能容器化：

- **LLMWiki MCP** 是 AI 工具（Claude Code/Codex）的子进程。AI 工具通过 stdio 与 MCP 通信。容器化会断开 stdio 通道。
- **Understand-Anything** 是 agent pipeline，在 AI 工具会话内运行，直接读写项目文件。容器化需要 volume 挂载 + 权限映射，复杂且脆弱。
- **OpenDeepWiki** 是独立 HTTP 服务，通过 MCP URL 协议通信——天然适合容器化。

## 环境变量

从 shell 环境或 `~/.sdd/mcp-keys.env` 读取。关键变量：

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `OPENAI_API_KEY` | — | OpenDeepWiki 的 LLM 调用（回退源） |
| `OPENDEEPWIKI_API_KEY` | $OPENAI_API_KEY | OpenDeepWiki 的 LLM 调用（优先） |
| `OPENDEEPWIKI_LLM_ENDPOINT` | https://api.openai.com/v1 | LLM endpoint |
| `OPENDEEPWIKI_MODEL` | gpt-4o | wiki 生成模型 |
| `OPENDEEPWIKI_PORT` | 8090 | API + MCP 端口 |
| `OPENDEEPWIKI_WEB_PORT` | 3001 | Web UI 端口 |
| `OPENDEEPWIKI_JWT_SECRET` | (dev default) | JWT 密钥（生产环境必改） |
