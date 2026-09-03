---
name: whitebox-verify
description: >-
  统一验证技能（v2.0 合并 Trinity Journey TDD Whitebox）。三种模式按意图路由：
  (1) 调试模式——Chrome MCP 白盒功能验证，从组件交互出发，通过浏览器网络拦截验证
  「用户操作 → Hook 调用 → API 请求参数 → 响应处理 → UI 状态更新」完整链路；扩展支持
  Agent/后端服务调试（日志链路追踪 + 配置审计）；不是视觉验证，是功能逻辑正确性验证。
  (2) Journey 验收模式——实现或验证跨模块/服务/仓库/持久化/异步消息/浏览器 UI/权限边界的
  实质性变更，No GREEN without Journey closure。
  (3) Slice 模式——本地规则或组件级 TDD。触发词：验证功能不工作、白盒验证、Trinity、
  Journey、end-to-end、multi-subagent TDD、Codex browser verification、grill evidence。
version: "2.2.0"
---


# Whitebox Verify: 统一验证技能（v2.2，合并 Trinity Journey TDD Whitebox）

## 模式路由（先选模式，再进流程）

```
你的意图                                    →   模式
──────────────────────────────────────────────────────────────────────
"这个功能为什么不工作" / 调试 / 排查          →   调试模式（往下读本文档，Phase 0-N）
实现或验证跨模块/服务/边界的实质性变更         →   Journey 验收模式（读 references/journey-contract.md）
本地规则/组件级 TDD                          →   Slice 模式（同 Journey 入口，按 Slice 约定裁剪）
需要交付验证报告                              →   调试模式 Phase 0→全量 + 运行时 E2E
```

**按需阅读路径（渐进披露，避免全量载入）**：
- 简单调试（"按钮点了没反应"）→ 主文件：路由/触发场景/八维度矩阵/铁律；参考文件封闭集合恰好两个：`quick-reference.md`、`debug-decision-tree.md`
- 执行调试（进入 Phase 实操）→ 在简单调试集合之上追加封闭集合恰好三个：`references/debug-methodology.md`、`references/debug-workflow.md`、`references/debug-io-contract.md`（工具速查/回退/降级都在此）
- 深度调试（Agent/后端/配置）→ 再加 `references/agent-debug-workflow.md`；命中缺陷模式时读 `references/anti-patterns.md` 对应条目
- Journey/Slice 验收 → 本文路由段即可，全量契约在 `references/journey-contract.md`（authoritative），选维用 `references/test-dimensions.md`

**⚠️ 代号空间声明**：本文档存在两套字母代号，**仅在各自模式内有效，禁止跨模式引用**——
调试模式「八维度矩阵」A-H（A 功能/B 渲染/C UX/D 集成/E 安全/F 数据/G 性能/H 并发）；
Journey 模式「A-J 维度」（A 业务/B 浏览器/C 无障碍/D 持久化/E 权限安全/F 契约/G 并发投递/H 补偿恢复/I 兼容迁移/J CI）。
同一字母在两套体系含义不同（如 D：调试=集成，Journey=持久化）。报告落款必须带模式前缀：`Debug-D` / `Journey-D`。

**Journey 验收模式核心契约（详见 references/journey-contract.md 与 references/test-dimensions.md，以 references 为准）：**
- No GREEN without Journey closure：每个强制业务 Journey 必须经真实第一方路径抵达终局业务判定点。
- 本地绿灯、组件截图、HTTP 验收、队列发布、中间 UI 状态都不能闭合更宽的 Journey。
- 证据三要素：Intent（终局判定点）/ Mechanism（域·权限·契约·状态机）/ Evidence（测试·追踪·日志·持久化回读·浏览器观察）。
- 冻结范围计划先行：plan_digest 嵌入所有后续 typed report。
- 校验器：`python3 ".agents/skills/whitebox-verify/scripts/validate_journey_evidence.py" <ledger.json>`（仓库相对路径），失败即保持 RED。
- 未执行的证据必须标注 planned；禁止编造 run ID/时间戳/trace/子代理活动。

以下为调试模式全文（v1.10 原有内容，未改动）：


基于真实项目踩坑经验的方法论。不是"页面加载不崩溃"的浅层检查，而是验证每个按钮、表单、API 调用、状态转换的功能逻辑正确闭环。

## 触发场景

### 模式 A：前端功能验证（原有）

- 需要验证前端功能模块的端到端逻辑正确性
- 需要确认 hook→API 调用链路无断裂
- 需要发现"页面能渲染但功能不工作"的隐性 bug
- 需要验证 API 请求/响应数据完整性（字段缺失、类型不匹配）
- 需要系统性测试多页面、多交互的完整功能验证

### 模式 B：Agent/后端服务调试（v1.5 新增）

- Agent 工具调用不生效（tool_call 发出但无执行结果）
- 子 agent spawn/delegate 模式验证（sessions_spawn 全链路）
- 配置驱动行为问题（tools.json allowlist、env flags、feature flags）
- LLM 调用链路追踪（多次 LLM 调用的顺序/参数/上下文传递）
- 运行时命名溯源（实例名从哪来、为什么叫这个名字）
- **约束**: 参照项目不能改源码，只能通过配置修复

## OUT OF SCOPE

- UI 视觉对齐（颜色、间距、布局 → 用 `ui-alignment` 技能）
- 性能分析（FPS、内存、加载时间）
- 安全审计（XSS、CSRF）
- 后端 API 实现正确性（假设后端已实现，模式 B 除外）
- 跨浏览器兼容性测试

> 如需视觉验证，配合 `ui-alignment` 技能。如需自动化测试框架，配合 `tdd` 技能。

## Quick-Start 决策树

完整决策树已外置：`references/debug-decision-tree.md`（进入调试执行前必读）。

## I/O Contract 与工具速查

I/O 契约、Chrome MCP 速查、Playwright 回退方案（条件等待版）、双浏览器降级路径、后端调试工具速查：`references/debug-io-contract.md`（执行验证时必读）。

## 核心方法论

三层验证/六阶段详述已外置：`references/debug-methodology.md`（执行时必读）。八维度矩阵与全部铁律保留在主文件（每次必跑纪律）。

## 核心方法论：八维度验证矩阵（每次必跑）

**单维度验证（只 curl 接口）是最大盲区。** 每次验证必须覆盖以下 8 个维度，关键领域至少过 A+B+C+E 四维。

| 代号 | 维度 | 抓什么 | 验证手段 | 典型遗漏 |
|------|------|--------|---------|---------|
| **A** | 功能性 | 状态转换/数据正确/API 契约 | curl + 单测 | 反向 + 边界用例 |
| **B** | UI 渲染 | 页面渲染、组件、无 console error、UI 自查 6 条 | 浏览器 take_snapshot/screenshot + evaluate_script | 长文本溢出、spinner 永转 |
| **C** | UX | 错误态/空态/loading/反馈(toast)/可逆性 | 浏览器触发错误 + 看反馈 | 500 白屏?空列表友好?操作有反馈? |
| **D** | 集成 | 跨服务、cache invalidation、闭环 | 触发 mutation + grill 日志 | configVersion 不刷新→旧缓存 |
| **E** | 安全/权限（越权面） | ACL、RBAC、跨租户隔离、注入 | curl 跨用户/跨 tenant + 错误码 | 越权 404?注入? |
| **F** | 数据完整性 | schema、事务、迁移一致性 | information_schema SQL + DB 查询 | oid 残留?类型不对? |
| **G** | 性能 | N+1、大数据、响应时间 | 日志时间戳 delta + SQL 计数 | N+1 查询?LO I/O? |
| **H** | 并发/一致性 | 乐观锁、TOCTOU、幂等 | 并发 curl + 检查冲突码 | revision 冲突?幂等重放? |

**E 维与 OUT OF SCOPE 的关系**：E 维指功能级越权验证（本功能是否漏拦了不该放行的人），是功能正确性的一部分；系统级安全审计（XSS/CSRF 扫描）是专项审计，仍在 OUT OF SCOPE。两者不冲突。

**验证纪律**：每个维度独立验证，不能跳过。验证完每个维度打 PASS/FAIL/ISSUE + 证据。

**八维度验证模板（每次跑）**：
```
A 功能: curl endpoint → HTTP code + body field check → PASS/FAIL
B UI:   navigate page → take_snapshot → console error count=0 → PASS/FAIL
C UX:   trigger error(断服务/空数据) → DOM 含错误文案(非白屏) → PASS/FAIL
D 集成: mutation → grill 日志 bumpConfigVersion + invalidate → PASS/FAIL
E 安全: curl 越权(非 owner / 无 token) → 404/401 → PASS/FAIL
F 数据: SELECT data_type FROM information_schema → 类型正确 → PASS/FAIL
G 性能: grep SQL count in log → ≤ 预期 batch 数 → PASS/FAIL
H 并发: curl 并发/stale revision → 409/idempotent → PASS/FAIL
```

**报告格式**：每个维度一行 + 证据(curl 输出/screenshot/日志行/SQL 结果)。失败项记 root cause，不只记"失败"。

## 验证纪律：五条踩坑铁律（v1.7 新增，真实事故提炼）

> 以下每条来自一次真实的 false-green 或误诊。核心教训：**plausibility is not correctness**。

### 铁律 1：「日志里没有 X」≠「X 没发生」—— 追完整执行链

**事故**：报了 "✅ HITL 修复确认"，依据是 `grep permission_ask` 日志零命中。实际是 MCP discovery 阻塞 90s 导致 chat **根本没 dispatch**——permission_ask 没机会执行。

**规则**：`grep` 零命中时，先确认**上游是否执行到了那一步**（有没有 dispatch / model call / agent build 的日志）。上游阻塞会让下游静默不执行，grep 会给你假阴性。

**实操**：追执行链时间线——materialize → agent build → chat dispatch → model call → tool call → response。链断了，找断点，别只 grep 末尾。

### 铁律 2：区分「陈旧状态」vs「当前行为」

**事故**：`sessions_spawn` 触发 HITL，以为是权限配置 bug。读日志发现 `Agent is paused... a previous run most likely paused... persisted that state`——是**旧 session 的 ASKING 持久化在 PG**，不是当前权限问题。清掉 `agent_state` + 新 session → 自动放行。

**规则**：异常行为出现时，先问"这是当前逻辑产生的，还是持久化的陈旧状态？"检查 AgentStateStore / cache / session 状态有没有旧的残留。**重启清内存，但清不了 PG 持久化**。

### 铁律 3：查数据再读代码

**事故**：HITL 异常 → 读了一圈代码路径（前端 `rememberAgentSafeTool` + 后端 `writeList`）全干净 → 困惑。直接 `SELECT safe_tools_json FROM builder_agent` → 发现脏数据 `151338`（历史手动 SQL 残留）。

**规则**：行为异常时，**先查 DB 实际值**（配置字段、状态、绑定），再读代码路径。代码可能是对的，数据是脏的。`SELECT` 比 `grep` 代码快且直接。

### 铁律 4：`UnresolvedCompilationProblem` → `clean compile`（绕 ECJ）

**事故**：启动报 `java.lang.Error: Unresolved compilation problems`。以为是依赖问题。`mvn clean compile`（真 javac）暴露 `WorkspaceMaterializer:285` 一处被截断的 `log.debug`——IDE 的 ECJ 把语法错误编成了"运行时抛异常的桩"，掩盖了真错误。

**规则**：遇到 `UnresolvedCompilationProblem` / `NoClassDefFoundError`（源码存在的类）→ **先 `clean compile` 再调查**。ECJ（IDE 编译器）会掩盖编译错误，javac（maven）不会。

### 铁律 5：日志时间戳间距暴露性能模式

**事故**：MCP discovery 假死 90s。读日志时间戳：`19:49:16 / 19:49:46 / 19:50:16`——三个 MCP server 各隔 30s → **串行**。改成 `parallelStream()` + 5s 超时 → 并行。

**规则**：日志**时间戳的间距**直接告诉你串行还是并行、阻塞多久。不需要 profiler——`grep -oE "^timestamp"` 看 delta 就行。

---

## 验证完备性纪律（v2.1 新增 — 防止漏判，2026-08-10 实战教训）

> 完整规范 + 原则 + few-shot 见 [`references/verification-completeness.md`](./references/verification-completeness.md)。核心铁律：

### 铁律 6：两级动词——「入口在」≠「闭环通」
看到按钮 + grep 到端点 = **入口在**（L1），**不得标 ✅**。闭环通 = 浏览器交互触发 → wire → DB readback → 截图全部到位（L3/L4）。交互没触发 API 调用（无对应 network request）→ 视为未验证，不是通过。报告强制用三态动词：**入口在 / 闭环通 / 未验证**。

### 铁律 7：旧 verdict 一律重推导
issue body / 历史 checklist 的 verdict 只当线索，不当前提。每次运行重新核对当前代码 + 浏览器 + wire。历史状态是"对比 delta"，不是"直接沿用"。

### 铁律 8：关闭前残留登记（顺序不可逆）
**关闭任何 checklist / 范围类 issue 前，所有未完成/未验证项必须已链接到带 owner 的跟踪 feature issue（先登记后关闭）**。正例：#349→#171、#407→#158；反例（本次事故）：#158 关闭后才补 #407。关闭评论必须列残留项 + 跟踪链接 + "完成回写 verdict"闭环声明。

### 铁律 9：逐 TC 8 维最低门槛
核心用例至少 A+B+C+E 四维，缺一维标 🟡 并注明缺哪维，不虚标 ✅。收尾跑"完成偏差对抗清单"（§5）：什么证据能否定我标的每个 ✅？砍掉的验证是否正好是 E/H？

---


### 铁律 10：确定性证据纪律（v2.2 新增 — 反 flake）
- **禁止固定 sleep 等待**：等待 UI/网络必须用条件等待（轮询 DOM 状态、网络 idle 事件、重试至断言成立或超时）；`sleep 5` 类命令只允许出现在"确认无更优信号"并注明理由时。
- **确定性数据**：验证用数据必须可重现——固定种子、幂等键、预置 fixture；禁止依赖"当前时间恰好""列表恰好为空"这类不可控状态。
- **证据必须可复核**：每条证据记录 命令原文 + 时间戳(含时区) + 关键输出摘录。
- **重跑不一致的归因分两级**：相同受控前提（同种子/同 fixture/同幂等键，动态字段已归一化）下**业务不变量**不同 → 产品 FAIL，追因到底；若差异仅来自工具/环境（选择器时序、网络抖动、浏览器渲染差异）→ 记 `EVIDENCE_UNSTABLE`（**不得 GREEN**，单列根因，修复证据采集方式后重测）。两者都不许"重跑到通过为止"。

### 铁律 11：浏览器外证据（v2.2 新增 — UI 状态 ≠ 完成）
UI 到达终态不能证明业务闭环。凡变更产生外部副作用（邮件/webhook/消息队列/文件落盘/第三方回调），必须在**浏览器之外**独立取证（查队列消息、查收件箱 API、查文件 mtime+内容、查回调日志）。反例：页面显示"已发送"但邮件服务从未收到请求。

## 铁律：三维度契约一致性（模式 A）

**每个 POST/PUT/DELETE 调用必须通过三个维度的一致性检查，任何一个不一致就是 P0。**

| 维度 | 检查内容 | 常见失败模式 |
|------|---------|-------------|
| **1. HTTP 方法** | 前端 method === 后端 @XxxMapping | POST vs PUT（P0-3 subagent） |
| **2. URL 模式** | 前端 URL template === 后端 @RequestMapping | 路径不同（P0-6 channel default-agent） |
| **3. 参数位置** | 每个参数必须出现在后端期望的位置 | body↔query param 混淆（P0-2/4/5）；字段名不匹配（P0-1 marketplace） |

**原则：不看后端代码，就无法确认前端 API 调用是否正确。** 凭"感觉"写 URL/method/body 是系统性 bug 的根源。

## 铁律：CRUD 全链路验证（模式 A，v1.6 新增）

**READ 通过 ≠ 功能正确。必须验证 CRUD 完整闭环。**

```
Create → Read → Update → Delete
   ✓       ✓       ?       ✗    → "验证通过" = 谎言
```

**实战案例**: 安全策略黑名单 — GET /api/security/blacklist → 200，列表正常渲染。
点击删除 → DELETE /api/security/blacklist/undefined → 400。
原因：前端 `e.id` 取值，后端返回 `rowId`，列表渲染不依赖 id，只有删除按钮用到。

**验证要求**:

| 操作 | 必须验证 | 只验 R 会遗漏 |
|------|---------|--------------|
| Create | POST → 201 → 列表刷新 | 不会遗漏 |
| Read | GET → 200 → 数据渲染 | — |
| Update | PUT/PATCH → 200 → 数据回显 | **跳过 = 不知道编辑是否生效** |
| Delete | DELETE → 204 → 列表刷新 | **跳过 = 不知道 ID 映射是否正确** |

**关键洞察**: 前端 API 映射层是高危区。`.then(list => list.map(e => ({ id: e.id })))` 中的 `e.id` 是对后端响应字段名的假设。TypeScript 类型声明是前端自己的约定，不反映后端真实行为。**必须用 `__wbvLog` 检查实际 response body 的 key 名，对比前端映射代码。**

## Anti-pattern #20：把 UI 终态当业务完成（v2.2 新增，权威文本在 `references/anti-patterns.md` #20）
UI 是效应的投影不是效应本身；凡有浏览器外节点，必须在该节点所在系统内取证一次（与铁律 11 配对执行）。

## 铁律：功能图谱关联验证（v1.8 新增）

**CRUD 是图谱的特例。一般原则：任何功能都形成有向图，必须遍历每条边验证效应传播。**

```
   ┌──────────────────────────────────────────────────────┐
   │  一次操作（如：发送含黑名单词的消息）                  │
   └──────────────────────┬───────────────────────────────┘
                          │
            ┌─────────────┼─────────────┬──────────────┐
            ▼             ▼             ▼              ▼
       [拦截响应]     [事件入库]     [统计+1]      [SLF4J 日志]
            │             │             │              │
            ▼             ▼             ▼              ▼
       Chat UI 错误卡片  Events 表格   Stats 卡片    容器日志 WARN
       (edge 1)         (edge 2)      (edge 3)      (edge 4)

       验证 = 对每条 edge，用同一次触发确认下游有反应
```

**铁律**: 测试前先画图谱（至少心里画），列出该操作应触发的**所有下游效应**，每个效应单独验证。

**反例（本次实战）**: 黑名单拦截只验了 edge 1（Chat 页 503 错误卡片），就宣布 PASS。
漏掉 edge 2/3/4 → 事件仪表盘永远显示"暂无安全事件记录"。
修复时又发现 4 层串联缺陷（中间件没调事件服务 / event_type 不匹配 / listEvents 返回空 / getEventStats 是桩函数）。

**为什么 CRUD 铁律是特例**: Create→Read→Update→Delete 是 CRUD 类功能的图谱形状。图谱铁律覆盖所有功能形状：
- 发布订阅类：触发 → 入库 → 推送 → 展示（如安全事件、审计日志）
- 副作用类：操作 → 状态变更 → 关联实体更新 → 缓存失效
- 跨服务类：UI → API → 队列 → Worker → 第三方 → 回调

**验证清单模板**（测试前填空）:

```
本次操作: _____________
预期下游效应:
  [ ] edge 1: ____ → 验证方式: ____
  [ ] edge 2: ____ → 验证方式: ____
  [ ] edge 3: ____ → 验证方式: ____
  [ ] edge N: ____ → 验证方式: ____

修复后回归: 必须重跑全部 edge，不能只验被修的那条
```

**修复后回归铁律**: 任何 bug 修复后，必须**重跑完整图谱**，不能只验"被改的那条边现在通了"。因为一个症状常由多层缺陷叠加导致（iceberg 模式），修一层才会暴露下一层。

## 铁律：配置优先修复原则（模式 B，v1.5 新增）

当发现 Agent/后端行为异常时，按以下顺序选择修复方案：

| 优先级 | 方案 | 描述 | 判定条件 |
|--------|------|------|----------|
| **P0** | 改配置文件 | tools.json / env / feature flag | 最小变更，纯配置 |
| **P1** | 改启动参数 | JVM opts / CLI args / docker-compose.yml | 不改代码，调整运行时 |
| **P2** | 改业务配置 | 数据库记录 / workspace 文件 | 改数据不改逻辑 |
| **P3** | 改源码 | Java/TS/Python 代码 | **仅当参照项目允许时** |

**Karpathy Guideline #2 Simplicity First**: 能用配置解决就不用改代码。

本次实战: tools.json allowlist 6->14 (P0 方案)，零源码改动。

---

## 前置条件

### 模式 A 前置条件

1. **Chrome DevTools MCP 已配置** — 需要以下工具：`navigate_page`, `take_snapshot`, `take_screenshot`, `click`, `fill`, `evaluate_script`, `type_text`
2. **Dev server 运行中** — `base_url` 可访问
3. **后端服务可用**（可选）— 若后端不可用，可验证 Layer 1+2（请求发出），但无法验证 Layer 3

### 模式 B 前置条件

1. **目标服务可访问** — Docker 容器运行中或进程存活
2. **日志可读取** — `docker logs` 或日志文件路径已知
3. **配置文件位置已知** — tools.json / application.yml 等
4. **约束明确** — 是否允许修改源码（默认不允许）
5. **Preview MCP 可选** — 需要 UI 截图证据时启用

---

## 工作流（Phase 0-N 详表）

调试模式全阶段详表（Phase 0/0a/0b/1-6、UI 自查脚本、报告产出）：`references/debug-workflow.md`（进入执行阶段时必读）。

## Mermaid 时序图绘制规范

完整规范见 `references/mermaid-guide.md`。核心规则：消息体只用纯 ASCII，不使用 `{}` `""` `<>` `|`，复杂内容放 Note 注释框。

---

## Naming Traceability 规范

完整规范和溯源命令见 `references/naming-traceability.md`。

---

## 缺陷分类

| 级别 | 名称 | 描述 | 示例 |
|------|------|------|------|
| **P0** | 阻断 | 功能链路断裂，完全不可用 | hook 调用不存在的 API 函数；tools.json 缺工具导致 ToolFilter 过滤掉；API 响应缺少必填字段导致保存失败 |
| **P1** | 降级 | 功能部分可用，但数据处理有误 | API 响应字段类型不匹配；错误状态未显示；loading 态缺失 |
| **P2** | 体验 | 功能可用，但交互细节不完美 | toast 缺失；确认弹窗措辞不准；placeholder 文案 |

---

## 常见缺陷模式 (Anti-Patterns)

全部 20 条 Anti-Patterns（含正反例）已外置：`references/anti-patterns.md`（按需阅读；触发场景命中时必读对应条目）。

## 边界处理

| 场景 | 处理策略 |
|------|---------|
| MCP 工具超时 | 检查 Chrome DevTools MCP 连接状态；重试一次仍超时则跳过该页面标记 SKIP |
| Auth 失败/重定向 | 检测 302/401 -> 按需重新登录 -> 重试验证 |
| 非 JSON 响应 | `__wbvLog` 中 `resType: 'non-json'` -> 标记为 API 异常，不阻塞其他验证 |
| CORS 错误 | 浏览器 console 报 CORS -> 检查 Vite proxy 配置 -> 非 skill 范畴，记录到 findings |
| 页面 SPA 路由不刷新 | `navigate_page` 在 SPA 中可能不触发完整加载 -> 添加 `ignoreCache: true` 或先 `navigate_page("/")` 再导航到目标路由 |
| Docker 容器日志过多 | `--tail N` 限制行数 + `grep -E` 过滤关键词 | 模式 B 专用 |
| 配置文件在容器内 | `docker exec` 进入容器读取或挂载 volume | 模式 B 专用 |
| 参照项目不能改源码 | 优先走 Config Audit -> P0 配置修复 -> P1 启动参数 -> 最后才考虑 P3 代码 | 模式 B 核心约束 |
| Mermaid 渲染失败 | 去掉特殊字符 -> 用 Note 替代消息体 -> 本地预览后再提交 | v1.5 专用 |

---

## 反馈改进

每次验证结束后，将新发现的缺陷模式补充到 Anti-patterns 列表。

---

## 时效指导

| 步骤 | 建议超时 | 超时处理 |
|------|---------|---------|
| navigate_page | 10s | 检查 MCP 连接，retry |
| take_snapshot | 5s | 通常即时返回，超时说明页面卡死 |
| click/fill + waitFor API | 15s | 检查 loading 状态，3-Strike |
| evaluate_script | 3s | 即时返回，超时说明 JS 错误 |
| 单页面完整验证 (Phase 1+2+3) | 5min | 超时标记 SKIP，记录进度 |
| 全路由扫描 (N 页面) | N×1min | 超时标记剩余页面 SKIP |
| Agent Debug 全流程 (模式 B Phase 1-6) | 15-20min | 含配置审计+日志追踪+截图+报告 |
| LLM 推理等待 (子 agent 执行) | 10-30s | minimax-m2.7 约 3-5s/轮 |

---

## 错误处理：3-Strike 防死循环

验证过程中遇到工具失败或不确定结果时：

| Strike | 动作 | 适用场景 |
|--------|------|---------|
| 1 | 重试相同操作（清除日志后重新执行） | `__wbvGet` 返回空、snapshot 元素缺失 |
| 2 | 换策略（reload 页面后重试、用 `ignoreCache: true`） | HMR 缓存导致旧状态、元素 uid 变化 |
| 3 | 记录当前状态 + 截图，标记 SKIP，继续下一个 | 连续失败、页面严重异常 |

**>3 次**: 停止验证，将当前状态 + 截图 + 诊断日志升级给用户决策。

---

## 验证报告

验证完成后输出结构化报告，格式见 `references/report-template.md`。

报告要点：
- 每个交互记录：步骤表（操作/预期/实际/结果）+ API 审计 + 缺陷清单
- 汇总：总页面数/通过/失败/跳过/P0/P1/P2 计数
- 截图：每个页面的加载后 + 关键操作后截图
- (模式 B) 日志证据链：6 Phase 完整链路 + 时间戳 + 关键 ID
- (模式 B) Mermaid 时序图：E2E 全链路（遵循绘图规范）
- (模式 B) Naming Traceability：运行时命名溯源

---

## References

### 模板文件
- **Mode A 报告模板**: `references/report-template.md`
- **Mode B 报告模板**: `references/agent-debug-template.md`
- **Mode B 工作流详细步骤**: `references/agent-debug-workflow.md`
- **验证完备性纪律（规范 + 原则 + few-shot）**: `references/verification-completeness.md`
- **快速参考卡**: `references/quick-reference.md`
- **网络拦截器**（含 helpers）: `references/network-interceptor.js`
- **Mermaid 绘图规范**: `references/mermaid-guide.md`
- **Naming Traceability**: `references/naming-traceability.md`

### 协作技能
- UI 视觉对齐: `ui-alignment` skill（本技能不覆盖视觉验证）
- 测试驱动开发: `tdd` skill（本技能不覆盖测试编写）
- 全量清单验证（TC 矩阵可执行化）: 配合 `trinity-verify` 的 Completeness 维度，对 checklist issue 用 TC 矩阵 + 残留登记铁律

---

## Changelog

### v2.2.0 (2026-09-02)
- **（评审修订）铁律10 两级归因**：业务不变量差异=产品 FAIL；工具/环境差异=EVIDENCE_UNSTABLE（不得 GREEN，单列根因）——消除"重跑不一致一刀切 FAIL"的错误归因
- **（评审修订）Playwright 模板条件等待化**：waitForTimeout 全部替换为 waitForFunction 条件等待，消除与铁律10的自相矛盾
- **（评审修订）渐进披露实质化**：Anti-Patterns(330行)/I/O契约与工具速查(131行)/调试工作流详表(91行)外置到 references/，主文件 1181→495 行（wc -l 终态口径，含 v2.2 评审修订全部内容）；阅读路径改为逐路径唯一必读文件集合
- **（评审修订）YELLOW 状态对齐**：明确降级封顶仅适用浏览器强制场景；typed artifact 保持 RED/GREEN，YELLOW 为结论层状态，校验器契约不变
- **合并 Trinity Journey TDD Whitebox**（单技能统一验证：调试模式 A/B + Journey 验收 + Slice 模式，模式路由置顶；contract/references/validator 并入；原 trinity-tdd-whitebox 退役）
- **版本谱系修正**：合并版版本号从 2.0.0 跳至 2.2.0，衔接本文档自身的 v2.1.0（验证完备性纪律）——两者编号体系自此统一
- **代号空间声明**：显式声明调试 A-H 与 Journey A-J 两套维度代号互不通用，报告落款带模式前缀（消除合并引入的字母撞车歧义）
- **渐进披露阅读路径**：按场景给出精确的"读哪几节 + 哪个 reference"，简单调试不再需要全量载入（对齐 Anthropic 技能著作规范）
- **铁律 10 确定性证据纪律**：条件等待替代固定 sleep、确定性数据、证据可复核、重跑不一致两级归因（产品 FAIL vs EVIDENCE_UNSTABLE，见评审修订条目）
- **铁律 11 + Anti-pattern #20 浏览器外证据**：UI 终态 ≠ 业务完成，外部副作用必须在效应系统内独立取证（来源："beyond the browser" 实践）
- **工具降级路径**：双浏览器全挂时 curl+日志+静态检查的最低证据模式，B 维不可闭合、结论封顶 YELLOW
- 校验器路径改用 canonical 路径（链接层路径保留兼容）
- **（评审修订）GREEN 回归夹具**：`tests/green-fixture/` 完整 schema 3.0 正路径账本，新旧双入口实跑 STRUCTURE_PASS 输出逐字节一致（exit 0），GREEN 可达性由直接实证支持；`tests/green-fixture/run.py` 自包含准备入口（自动按冻结账本设置运行窗口 mtime），全新检出单命令可复现

### v2.1.0 (2026-08-10)
- **新增「验证完备性纪律」铁律 6-9 + `references/verification-completeness.md`**：两级动词（入口在≠闭环通）、旧 verdict 重推导、关闭前残留登记（顺序不可逆）、逐 TC 8 维最低门槛、完成偏差对抗清单、TC 矩阵可执行化模板 + 5 组 few-shot 正反例。
- **来源**：全量验证实战 4 类漏判——"入口在"当"闭环通"（重命名/工作空间/上传附件）、沿用 07-24 旧 verdict（5 项实际已建）、关闭 #158 后残留项未登记（用户发现后补 #407）、8 维只跑 happy path。

### v1.9.0 (2026-06-14)
- **铁律新增**: UI 视觉自查 6 条 — 文字不溢出 / 动画不裹文字 / 状态必收敛 / 交互必可达 / 复用必适配 / 紧凑度检查
- **自动化脚本新增**: uiChecks JS 对象（textOverflow / animOnText / stuckLoading / inputOutOfView / containerClip / compactness），集成到 Phase 1 结构扫描
- **实战提炼**: AgentRunPanel 复用后发现 spin 旋转文字 badge + 文字溢出 + 状态卡死 + 输入框超出视口 + v1 组件在 v2 容器中留白失调

### v1.8.0 (2026-06-13)
- **铁律新增**: 功能图谱关联验证 — 任何功能都是有向图，必须遍历每条 edge 验证效应传播；CRUD 是其特例
- **Anti-pattern #19 新增**: 子系统覆盖断层 — 只验触发面（用户可见）不验观测面（运营可见），iceberg 缺陷链（一个症状=N 层断点叠加）
- **Quick-Start 强化**: 新增图谱铁律提醒，特别点名发布订阅/审计/监控型功能最易断链
- **回归铁律**: bug 修复后必须重跑完整图谱，不能只验被改的那条边
- **Playwright 回退方案新增**: 当 chrome-devtools MCP 断连时，用 Playwright（项目已装）做完整 UI 验证（脚本必须放项目目录下，不能放 /tmp）
- **Chrome 手动调试**: `open -a "Google Chrome" URL --args --auto-open-devtools-for-tabs` 辅助人眼检查
- 基于 AgentScope 安全事件记录验证实战提炼（拦截链路正常但事件从未入库，修复时连续发现 4 层串联缺陷）

### v1.7.0 (2026-06-13)
- **铁律新增**: 安全/审核/限流类功能必须同时验证管理侧 + 运行侧 + UX 展示 + 上下文对比
- **Quick-Start 强化**: 新增"安全/审核/限流类功能"决策分支
- **Anti-pattern #17 新增**: 只验管理侧不验运行时 — 配置能改 ≠ 功能生效
- **Anti-pattern #18 新增**: 上下文状态污染 — 单输入验证陷阱（必须用控制变量法对比干净 vs 污染上下文）
- 基于 AgentScope 安全策略端到端验证实战提炼（发现 P1: 会话上下文污染导致永久拦截）

### v1.6.1 (2026-06-13)
- **D5 深度优化**: Mode B 工作流外置到 `references/agent-debug-workflow.md`（-116 行）
- **D5 深度优化**: 双重证据 ASCII art 精简为一行规则（-12 行）
- **修复**: Anti-pattern 编号顺序（#15→#16）

### v1.6.0 (2026-06-13)
- **铁律新增**: CRUD 全链路验证 + 前端映射层高危区
- **Phase 0a/3 强化**: GET 端点响应字段映射审计 + CRUD 闭环验证
- **Anti-pattern #1 合并**: 合并原 #17（接受"页面正常"作为通过标准）到 #1
- **Anti-pattern #16 新增**: 响应字段映射未验证 — 读通过但写失败
- **D5 优化**: Mermaid 规范 + Naming Traceability 外置到 references/
- 基于 AgentScope 安全策略 E2E 验证实战提炼（P1 bug: DELETE /undefined）

### v1.5.0 (2026-06-11)
- 新增模式 B — Agent/后端服务调试六阶段法
- Config Audit Phase + Dual Evidence Closure + Naming Traceability + Mermaid 规范
- Anti-patterns #13-15: 证据不一致、跳过配置审计、Mermaid 特殊字符

<details><summary>历史版本 (v1.0–v1.4)</summary>

- v1.4.0: Anti-patterns #11-12 + Phase 3 响应 key 审计
- v1.3.0: 三维度契约一致性铁律 + Phase 0a/0b 拆分 + Anti-patterns #8-10
- v1.2.0: 反馈改进 + 时效指导
- v1.1.0: Quick-Start 决策树 + 3-Strike + Anti-patterns #5-7
- v1.0.0: 三层验证方法论 + 4 个 Anti-Patterns + initScript 拦截器

</details>
