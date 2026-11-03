# 铁律完整展开（Iron Laws — Full Expansion）

> 主文件 `SKILL.md` 只保留总索引表（编号 + 规则句 + 一行事故教训）。每条铁律的**事故背景 / 操作要点 / 正反例**收敛在本文件。每条来自一次真实的 false-green 或误诊，核心教训：**plausibility is not correctness**。持续追加：新铁律先在主文件索引表登记一行，再在本文件补完整展开。

---

<a id="iron-law-1"></a>
## 铁律 1：「日志里没有 X」≠「X 没发生」——追完整执行链

**规则句**：`grep` 零命中时，先确认**上游是否执行到了那一步**（有没有 dispatch / model call / agent build 的日志）。上游阻塞会让下游静默不执行，grep 会给你假阴性。

**事故背景**：报了 "✅ HITL 修复确认"，依据是 `grep permission_ask` 日志零命中。实际是 MCP discovery 阻塞 90s 导致 chat **根本没 dispatch**——permission_ask 没机会执行。

**操作要点**：追执行链时间线——materialize → agent build → chat dispatch → model call → tool call → response。链断了，找断点，别只 grep 末尾。

<a id="iron-law-2"></a>
## 铁律 2：区分「陈旧状态」vs「当前行为」

**规则句**：异常行为出现时，先问"这是当前逻辑产生的，还是持久化的陈旧状态？"检查 AgentStateStore / cache / session 状态有没有旧的残留。**重启清内存，但清不了 PG 持久化**。

**事故背景**：`sessions_spawn` 触发 HITL，以为是权限配置 bug。读日志发现 `Agent is paused... a previous run most likely paused... persisted that state`——是**旧 session 的 ASKING 持久化在 PG**，不是当前权限问题。清掉 `agent_state` + 新 session → 自动放行。

**操作要点**：异常出现 → 先查持久层（PG / Redis / 文件状态存储）有无历史残留 → 再看当前代码路径。

<a id="iron-law-3"></a>
## 铁律 3：查数据再读代码

**规则句**：行为异常时，**先查 DB 实际值**（配置字段、状态、绑定），再读代码路径。代码可能是对的，数据是脏的。`SELECT` 比 `grep` 代码快且直接。

**事故背景**：HITL 异常 → 读了一圈代码路径（前端 `rememberAgentSafeTool` + 后端 `writeList`）全干净 → 困惑。直接 `SELECT safe_tools_json FROM builder_agent` → 发现脏数据 `151338`（历史手动 SQL 残留）。

**操作要点**：配置驱动类异常的第一动作是 `SELECT` 目标表实际值，与期望值对比；脏数据确认后把清理/改代码建议交给实现者，验收者不修改业务数据。

<a id="iron-law-4"></a>
## 铁律 4：`UnresolvedCompilationProblem` → `clean compile`（绕 ECJ）

**规则句**：遇到 `UnresolvedCompilationProblem` / `NoClassDefFoundError`（源码存在的类）→ **先 `clean compile` 再调查**。ECJ（IDE 编译器）会掩盖编译错误，javac（maven）不会。

**事故背景**：启动报 `java.lang.Error: Unresolved compilation problems`。以为是依赖问题。`mvn clean compile`（真 javac）暴露 `WorkspaceMaterializer:285` 一处被截断的 `log.debug`——IDE 的 ECJ 把语法错误编成了"运行时抛异常的桩"，掩盖了真错误。

**操作要点**：增量构建跳过匿名内部类（`$1`）也是同族症状——先 `clean compile`，代码通常没问题，再谈别的归因。

<a id="iron-law-5"></a>
## 铁律 5：日志时间戳间距暴露性能模式

**规则句**：日志**时间戳的间距**直接告诉你串行还是并行、阻塞多久。不需要 profiler——`grep -oE "^timestamp"` 看 delta 就行。

**事故背景**：MCP discovery 假死 90s。读日志时间戳：`19:49:16 / 19:49:46 / 19:50:16`——三个 MCP server 各隔 30s → **串行**。改成 `parallelStream()` + 5s 超时 → 并行。

**操作要点**：任何"卡 N 秒"类问题，先取日志时间戳序列算相邻 delta，再定位慢点。

<a id="iron-law-6"></a>
## 铁律 6：两级动词——「入口在」≠「闭环通」

**规则句**：看到按钮 + grep 到端点 = **入口在**（L1），**不得标 ✅**。闭环通 = 浏览器交互触发 → wire → DB readback → 截图全部到位（L3/L4）。交互没触发 API 调用（无对应 network request）→ 视为未验证，不是通过。报告强制用三态动词：**入口在 / 闭环通 / 未验证**。

**事故背景**：一次全量验证出现 4 个漏判，第一条就是"入口在"当"闭环通"（详见 [`verification-completeness.md`](./verification-completeness.md) §1 与 FS-1：重命名按钮存在 + grep 到 `PATCH /session/rename` 就标 ✅，实际键盘交互没触发该 API）。

**操作要点**：规范正文、L1-L4 证据分级与判定规则 → [`verification-completeness.md`](./verification-completeness.md#1-两级动词规范铁律-6)。

<a id="iron-law-7"></a>
## 铁律 7：旧 verdict 一律重推导

**规则句**：issue body / 历史 checklist 的 verdict 只当线索，不当前提。每次运行重新核对当前代码 + 浏览器 + wire。历史状态是"对比 delta"，不是"直接沿用"。

**事故背景**：issue 07-24 标 #054 重新生成 ❌，直接归类 roadmap 未在浏览器核实 → 实际 UI 已有"重新生成"+"复制"按钮（详见 [`verification-completeness.md`](./verification-completeness.md) §3 与 FS-2）。

**操作要点**：对每条待判用例，先问"当前代码/UI 里它到底在不在、通不通"，再写 verdict。

<a id="iron-law-8"></a>
## 铁律 8：关闭前残留登记（顺序不可逆）

**规则句**：**关闭任何 checklist / 范围类 issue 前，所有未完成/未验证项必须已链接到带 owner 的跟踪 feature issue（先登记后关闭）**。关闭评论必须列残留项 + 跟踪链接 + "完成回写 verdict"闭环声明。

**事故背景**：正例 #349→#171、#407→#158；反例：#158 关闭后才补 #407——残留项在关闭瞬间"丢失"，要靠用户发现（详见 [`verification-completeness.md`](./verification-completeness.md) §4 与 FS-3）。

**操作要点**：关闭前逐项过一遍未完成清单 → 每项建/找跟踪 issue → 关闭评论回链。

<a id="iron-law-9"></a>
## 铁律 9：逐 TC 8 维最低门槛

**规则句**：核心用例至少 A+B+C+E 四维，缺一维标 🟡 并注明缺哪维，不虚标 ✅。收尾跑"完成偏差对抗清单"：什么证据能否定我标的每个 ✅？砍掉的验证是否正好是 E/H？

**事故背景**：8 维只跑 happy path（只验证"发送→收到回复"就声称 chat 领域通过），漏掉 E 越权、C 错误态、F DB readback（详见 [`verification-completeness.md`](./verification-completeness.md) §2 与 FS-4）。

**操作要点**：最小可接受证据组合与 🟡 降级规则 → [`verification-completeness.md`](./verification-completeness.md#2-逐-tc-8-维最低门槛)；收尾对抗清单 → 同文件 §5。

<a id="iron-law-10"></a>
## 铁律 10：确定性证据纪律（反 flake）

**规则句**：条件等待替代固定 sleep；验证数据可重现；证据可复核；重跑不一致两级归因（业务不变量 → 产品 FAIL；工具/环境差异 → `EVIDENCE_UNSTABLE`，不得 GREEN）。

**操作要点**：
- **禁止固定 sleep 等待**：等待 UI/网络必须用条件等待（轮询 DOM 状态、网络 idle 事件、重试至断言成立或超时）；`sleep 5` 类命令只允许出现在"确认无更优信号"并注明理由时。
- **确定性数据**：验证用数据必须可重现——固定种子、幂等键、预置 fixture；禁止依赖"当前时间恰好""列表恰好为空"这类不可控状态。
- **证据必须可复核**：每条证据记录 命令原文 + 时间戳(含时区) + 关键输出摘录。
- **重跑不一致的归因分两级**：相同受控前提（同种子/同 fixture/同幂等键，动态字段已归一化）下**业务不变量**不同 → 产品 FAIL，追因到底；若差异仅来自工具/环境（选择器时序、网络抖动、浏览器渲染差异）→ 记 `EVIDENCE_UNSTABLE`（**不得 GREEN**，单列根因，修复证据采集方式后重测）。两者都不许"重跑到通过为止"。

<a id="iron-law-11"></a>
## 铁律 11：浏览器外证据（UI 状态 ≠ 完成）

**规则句**：UI 到达终态不能证明业务闭环。凡变更产生外部副作用（邮件/webhook/消息队列/文件落盘/第三方回调），必须在**浏览器之外**独立取证（查队列消息、查收件箱 API、查文件 mtime+内容、查回调日志）。

**事故背景（反例）**：页面显示"已发送"但邮件服务从未收到请求。UI 是效应的投影不是效应本身。

**操作要点**：凡有浏览器外节点，必须在该节点所在系统内取证一次——与 [`anti-patterns.md`](./anti-patterns.md) #20（把 UI 终态当业务完成）配对执行。

---

<a id="iron-law-contract"></a>
## 铁律：三维度契约一致性（模式 A）

**规则句**：每个 POST/PUT/DELETE 调用必须通过三个维度的一致性检查，任何一个不一致就是 P0。**不看后端代码，就无法确认前端 API 调用是否正确。**

**事故背景**：凭"感觉"写 URL/method/body 是系统性 bug 的根源——一批 P0 全部源于前端调用与后端映射不一致。

| 维度 | 检查内容 | 常见失败模式 |
|------|---------|-------------|
| **1. HTTP 方法** | 前端 method === 后端 @XxxMapping | POST vs PUT（P0-3 subagent） |
| **2. URL 模式** | 前端 URL template === 后端 @RequestMapping | 路径不同（P0-6 channel default-agent） |
| **3. 参数位置** | 每个参数必须出现在后端期望的位置 | body↔query param 混淆（P0-2/4/5）；字段名不匹配（P0-1 marketplace） |

**操作要点**：Phase 0 静态契约审计先做本表三列比对，产出契约匹配表，再开浏览器。

<a id="iron-law-crud"></a>
## 铁律：CRUD 全链路验证（模式 A）

**规则句**：READ 通过 ≠ 功能正确。必须验证 CRUD 完整闭环。

```
Create → Read → Update → Delete
   ✓       ✓       ?       ✗    → "验证通过" = 谎言
```

**事故背景**：安全策略黑名单——GET /api/security/blacklist → 200，列表正常渲染。点击删除 → DELETE /api/security/blacklist/undefined → 400。原因：前端 `e.id` 取值，后端返回 `rowId`，列表渲染不依赖 id，只有删除按钮用到。

| 操作 | 必须验证 | 只验 R 会遗漏 |
|------|---------|--------------|
| Create | POST → 201 → 列表刷新 | 不会遗漏 |
| Read | GET → 200 → 数据渲染 | — |
| Update | PUT/PATCH → 200 → 数据回显 | **跳过 = 不知道编辑是否生效** |
| Delete | DELETE → 204 → 列表刷新 | **跳过 = 不知道 ID 映射是否正确** |

**操作要点**：前端 API 映射层是高危区。`.then(list => list.map(e => ({ id: e.id })))` 中的 `e.id` 是对后端响应字段名的假设；TypeScript 类型声明是前端自己的约定，不反映后端真实行为。**必须用实际支持的请求/响应观察（仅确认注入能力时可用 `__wbvLog`） 检查实际 response body 的 key 名，对比前端映射代码。**

<a id="iron-law-graph"></a>
## 铁律：功能图谱关联验证

**规则句**：CRUD 是图谱的特例。一般原则：任何功能都形成有向图，必须遍历每条边验证效应传播。测试前先画图谱（至少心里画），列出该操作应触发的**所有下游效应**，每个效应单独验证。

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

**事故背景（反例）**：黑名单拦截只验了 edge 1（Chat 页 503 错误卡片），就宣布 PASS。漏掉 edge 2/3/4 → 事件仪表盘永远显示"暂无安全事件记录"。修复时又发现 4 层串联缺陷（中间件没调事件服务 / event_type 不匹配 / listEvents 返回空 / getEventStats 是桩函数）——iceberg 模式，修一层才暴露下一层。

**图谱形状**：
- 发布订阅类：触发 → 入库 → 推送 → 展示（如安全事件、审计日志）
- 副作用类：操作 → 状态变更 → 关联实体更新 → 缓存失效
- 跨服务类：UI → API → 队列 → Worker → 第三方 → 回调

**验证清单模板**（测试前填空）：

```
本次操作: _____________
预期下游效应:
  [ ] edge 1: ____ → 验证方式: ____
  [ ] edge 2: ____ → 验证方式: ____
  [ ] edge 3: ____ → 验证方式: ____
  [ ] edge N: ____ → 验证方式: ____

修复后回归: 必须重跑全部 edge，不能只验被修的那条
```

**修复后回归铁律**：任何 bug 修复后，必须**重跑完整图谱**，不能只验"被改的那条边现在通了"。回归有效性证明（审查并重放作者交付的隔离 pre-fix/control 与修复版本；不得由验收者修改测试/产品制造 RED）→ 详见 [`debug-workflow.md`](./debug-workflow.md#修复后回归有效性)。

<a id="iron-law-config"></a>
## 铁律：配置优先修复原则（模式 B）

**规则句**：当发现 Agent/后端行为异常时，按 P0→P3 顺序给实现者提出修复建议；验收者不修改配置、业务数据或源码来转绿。**Karpathy Guideline #2 Simplicity First**：能用配置解决就不用改代码。

| 优先级 | 方案 | 描述 | 判定条件 |
|--------|------|------|----------|
| **P0** | 改配置文件 | tools.json / env / feature flag | 最小变更，纯配置 |
| **P1** | 改启动参数 | JVM opts / CLI args / docker-compose.yml | 不改代码，调整运行时 |
| **P2** | 改业务配置 | 数据库记录 / workspace 文件 | 改数据不改逻辑 |
| **P3** | 改源码 | Java/TS/Python 代码 | **仅当参照项目允许时** |

**事故背景（实战）**：tools.json allowlist 6→14（P0 方案），零源码改动解决工具调用被过滤问题。**历史约束**：该次参照项目不能改源码。此事故不授权当前验收角色修改配置。
