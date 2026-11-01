# Kt 传输通道调研（2026-11-01，GitHub 实证）

## 通道一：Outline 发布（有成熟参考实现，可直接照搬）

参考实现：`raisedadead/outline-wiki-mcp`（TypeScript，2026-11-01 仍在推送；另有 Vortiago/mcp-outline 同日活跃）。

**Outline API 传输契约**（从其 `src/outline-client.ts` 逐字提取）：

- 端点：`POST {OUTLINE_BASE_URL}/api/{endpoint}`（点分方法名直接拼到 /api/ 后）
- 认证：`Authorization: Bearer ${apiKey}`（Outline Settings > API 创建的 `ol_api_xxx` 键）+ `Content-Type: application/json`
- 关键端点：
  - `documents.create`（title、text、collectionId、publish）
  - `documents.update` / `documents.search` / `documents.info` / `documents.export`
  - `collections.list` / `collections.create` / `collections.info`
- 分页：响应 `pagination.nextPath` 续拉，`limit` 默认 25，上限 100 页
- 重试：429/502/503/504 → 最多 3 次，优先 `Retry-After` 头，否则 1s/2s/3s 递增
- 错误：非 OK → `data.error` + `data.message`；`data.ok === false` 同样报错

**落地到本仓库**：`lib/adapters/outline.js`（协议层已有）+ 一个 ~40 行的 fetch 传输包装
（环境变量 `OUTLINE_BASE_URL` / `OUTLINE_API_KEY`）即闭合通道。传输层无协议逻辑，
与库的准入/知识语义完全解耦。

## 通道二：llmwiki tools/call 挂起（MCP stdio 规范对照诊断）

依据：modelcontextprotocol/specification 2026-07-28 stdio 绑定（逐字规则）：

- 消息 = **换行分隔的 JSON-RPC**，单条消息 **MUST NOT 含内嵌换行**（pretty-print 即违规）
- 服务器 **MUST NOT 向 stdout 写任何非 MCP 消息**（日志/横幅只能去 stderr）
- 客户端读到无法解析的行 → 等待合法响应 → **表现即"挂起"**
- 服务器应在 stdin EOF 时退出

**tools/call 挂起的诊断清单**（按概率排序）：
1. 服务器在处理 tools/call 时向 stdout 打了日志/横幅/pretty JSON → 污染协议流
2. 响应 JSON 带 pretty-print 换行 → 客户端无法按行解析
3. tools/call 处理器异常被吞、从未写出响应行
4. 遗留 initialize 握手时代的实现收到现代客户端请求后"不响应"（规范建议客户端先
   `server/discover` 探测，legacy 会以 -32601/-32602 等确定性失败）

**实测方法**（绕过客户端，直接对服务器说话）：
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' \
  | bash tools/mcp/llmwiki.sh 2>/dev/null
# 观察 stdout：每个合法输出必须恰为一行 JSON；出现非 JSON 行 = 污染源
```

## 通道三（备选）：llmwiki 直连不依赖 MCP——若 MCP 层短期难修，
Kt 知识写入库可用 llmwiki 的本地文件/CLI 接口直接写入（知识库本体是本地结构化
文件），MCP 层仅是访问协议——按用户"llmwiki 可承接知识库"的口径，文件通道即为
合法受管旁路。
