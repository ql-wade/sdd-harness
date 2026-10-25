# I04 资源端口与接线边界

这是现有 ProjectWikiInfra.v1 / ProjectRoot.v1 / KnowledgeWrite.v1 的组件交接，不是新的状态信封、调度或授权服务。

## 原公开 CLI

- `node tools/infra/llmwiki.mjs validate --registry infra/delivery/registry.json --json`：共享 I01 registry/identity/reference 准入，再检四个域文件；配置结构/边界有效不等于运行就绪。
- `... qualify ...`：当前固定源码树/requirements、登记 3.11 venv 与 SDK、路径和 launcher 摘要事实；不启动模型或业务知识动作，不信静态 hostDiscovered。实际 sourceRuntimeReady 与整体 ready 分开，缺 live 证据非零。
- `... probe --case escape-denial ...`：同准入后，仅私有 Git/worktree fixture 检路径、root 身份和知识形状拒绝。
- `... probe --case worktree-mcp-readback ...`：同准入后，仅可丢弃 workspace 执行真实 SDK MCP，再读同条目的源文件和原生 SQL/FTS。绝不写真实项目知识。

runtimeExecuted 描述 LLMWiki Python/业务探针运行；I01 纯校验与只读 Git/路径权威子进程可能在此前执行。不能把该标志当作 OS 级“没有任何进程”的证明。

## 固定上游实际接口

075c5b4 的 create 必需 `knowledge_base`, `title`, `content`, `tags`，可选 `path`, `date_str`, `overwrite`。当前 private 精华路径是 `/wiki/curated/`，MD 相对路径实际由返回/存储确定；生产 adapter 不能用旧 kb/name 形状或自行猜 concepts 文件名。

read 使用 `knowledge_base/path`；search 使用 `knowledge_base/mode/query/path`。同一 stdio session 先 initialize/initialized，再发现工具并顺序调用；检查真正 JSON-RPC/MCP 错误与工具 Error 文本。stdin 保持到回执完成；stdout flush 完成后才退出。SDK 会话管理和原生宿主工具调用均已实测，无 provider/model turn。

一个 SQLite MCP server 只有一个 workspace。knowledge_base 字符串不能当项目身份或 ACL；Root/P1_3 必须把实际 workspace、principal、版本和目的绑定到受保护操作，不能靠 Agent 标签或 frontmatter 自批。

## 必须消费的事实

正向要求 `nativeReadback.status == VERIFIED`、`consistency == CONSISTENT`，并且在同一个操作内：

`file.sha256 == index.contentSha256 == createdPayloadSha256 == restoredPayloadSha256`。

同时核对同一 relativePath/document UUID/version/status/sourceKind、chunkCount>0、同文档 FTS 搜索>0，真实 MCP read/search 返回当前标记。查询成功但不一致现在返回 MISMATCH；不能拿 queryExecuted 或文件非空放行。两个负例在 private fixture 中分别证明缺 native 行、陈旧 index 都不会通过。

SDK 和 native-host 实验使用不同的私有条目，其 UUID/hash 不能跨实验拼接。raw stdout 的摘要与便携显示摘要独立；源/输入/时间/环境必须按各 producer 的实际范围关联。当前数据没有真实 Comet Run/action/execution/attempt/epoch/current candidate 绑定，也没有独立审批/角色或 grant，因此不能成为最终 Kp/V 或整个场景通过。

## 路径、角色与恢复归属

I04 只校验登记的主项目 wiki 目标，仍消费现有 getWikiHome 接口。P4_4 修 argv 安全调用和 launcher 复用同一权威；实际主树/linked tree 的参数层同根证据不等于生产 launcher 成功或正式权限。

真实写入前由 Comet/保护 launcher 核验当前批准 payload、来源/版本、principal 和 grant。I04 的 fixtureAdmission 是测试形状检查；上游服务写入本身不认证生产批准。Comet 持原 operation、原 Run 与业务重试/恢复；TeamAI 只分发，基础设施只返回事实。

原生宿主端口按本机 0.163.0 生成 schema 及官方说明核对：initialize/initialized、serverName 限定的 mcpServerStatus/list；必要工具调用使用唯一 ephemeral 协议线程和 mcpServer/tool/call。仅一次正常宿主状态启动，无 model turn。CLI 覆盖仅本进程，21 个其它 MCP禁用，唯一 fixture 启用；全局配置原文/环境未落报告。

sqlite_home 是状态目录配置而不是 backfill 旁路，见[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)；协议顺序见[官方 app-server 文档](https://developers.openai.com/codex/app-server/)。私有新状态目录失败与正常已选宿主成功分开保留，没有用未经证实的 flag 跳过失败。
