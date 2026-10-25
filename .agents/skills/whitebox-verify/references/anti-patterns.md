## 常见缺陷模式 (Anti-Patterns)

角色边界：下列历史实现/修复代码用于审查作者交付内容，不是 whitebox 编写产品或测试的指令。当前验收只诊断、执行已批准流程并回报缺口；设计/编写/修改测试交 test-authoring，产品/配置修复交实现者。

### 1. 只验证页面加载 / 接受"页面正常"作为通过标准（最常见错误）

**核心问题**: 视觉判断只能发现 Layer 1（结构）问题。Layer 3（数据）的隐性缺陷只有通过数据验证才能发现。

```
WRONG:
  navigate -> take_snapshot -> "页面有内容，验证通过"
  安全策略页面能加载，列表显示正常 → "验证通过"
  (实际 DELETE 发送 undefined ID，功能完全不可用)

RIGHT:
  navigate -> take_snapshot -> click 按钮 -> 检查 API 请求 -> 检查响应 -> 检查状态变化
  页面加载 → 检查 __wbvLog response body keys
  → 对比前端映射代码中的字段名
  → 触发每个 CRUD 操作
  → 用日志数据证明逻辑正确（不是视觉判断）
```

**为什么错**: READ 通过 ≠ 功能正确。必须验证 CRUD 完整闭环。TypeScript 编译通过不代表运行时正确。前端映射层的字段名假设（如 `e.id`）可能不匹配后端实际字段名（如 `rowId`）。

### 2. 不检查 API 响应数据完整性

```
WRONG:
  检查 API 请求发出 -> "请求正确，验证通过"

RIGHT:
  检查 API 请求发出 -> 检查响应 body 字段 -> 对比前端类型定义 -> 确认字段值正确
```

### 3. 在不支持的工具中假定网络注入能力

```
WRONG:
  evaluate_script 安装拦截器 -> navigate -> 拦截器丢失

RIGHT:
  先读工具文档 -> 确认支持导航前注入才用实际 API；否则用原生网络观察并记录缺口
```

### 4. 跳过表单交互验证

```
WRONG:
  看到输入框有默认值 -> "数据已加载"

RIGHT:
  检查输入框的值是否来自 API 响应，还是前端默认值（useState 的初始值）
```

### 5. 不验证 Loading/错误状态转换

```
WRONG:
  点击按钮 -> 等 API 返回 -> 检查最终状态

RIGHT:
  点击按钮 -> 立即确认 UI 进入 loading -> 等 API 返回 -> 确认 UI 离开 loading
```

### 6. 只测 Happy Path

```
WRONG:
  填写合法数据 -> 保存 -> 成功 -> "验证通过"

RIGHT:
  合法数据 -> 成功 -> 清空必填字段 -> 验证报错 -> 输入超长文本 -> 验证截断
```

### 7. 不验证数据回显（Edit 场景）

```
WRONG:
  打开编辑页 -> 看到有数据 -> "数据加载正常"

RIGHT:
  打开编辑页 -> 用 __wbvAudit 检查 GET 响应字段 -> 对比输入框值是否匹配响应（非默认值）
```

### 8. 凭想象写 API 调用（不对比后端代码）

```
WRONG:
  // "后端大概有个 POST /api/foo 吧"
  requestBuilder('/api/foo', { method: 'POST', body: JSON.stringify(req) })

RIGHT:
  // 先读后端 Controller -> @PutMapping("/api/foo/{id}") + @RequestParam("bar")
  requestBuilder(`/api/foo/${encodeURIComponent(id)}?bar=${encodeURIComponent(req.bar)}`, { method: 'PUT' })
```

### 9. 参数位置混淆（body vs query param vs path variable）

```
WRONG:
  // path 放在 body 里，后端从 @RequestParam("path") 读取 -> 400
  requestBuilder('/api/agents/{id}/workspace/file', {
    method: 'PUT',
    body: JSON.stringify({ path: filePath, content }),
  });

RIGHT:
  // path 放在 query param，body 只保留 content
  requestBuilder(`/api/agents/{id}/workspace/file?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
```

### 10. URL 模式不匹配（前端和后端路径结构不同）

```
WRONG:
  // 前端: POST /api/channels/{channelId}/default-agent
  requestBuilder(`/api/channels/${channelId}/default-agent`, { method: 'POST', body: JSON.stringify({ agentId }) })

RIGHT:
  // 后端: POST /api/agents/{agentId}/channels/{channelId}/default
  requestBuilder(`/api/agents/${agentId}/channels/${channelId}/default`, { method: 'POST' })
```

### 11. TypeScript 类型声明与后端响应字段不匹配（运行时崩溃）

```
WRONG:
  // API 函数声明返回 AgentScopeMarketplace { name, url }
  // 但后端实际返回 { id, type, properties }
  // tsc 通过 -> 运行时 mp.name.charAt(0) -> TypeError

RIGHT:
  // 方案 A: 用 zod/io-ts 在 API 层做 runtime schema 校验
  const MarketplaceSchema = z.object({ id: z.string(), type: z.string(), properties: z.record(z.unknown()) });

  // 方案 B: API 函数内做 response->frontend 映射
  .then(list => list.map(mp => ({ name: mp.id, type: mp.type, url: mp.properties?.remoteUrl })))
```

### 12. 修改 API 后不回归验证消费页面（最危险的遗漏）

```
WRONG:
  修复 listAgentScopeMarketplaces 返回类型 -> 运行 tsc -> 运行 vitest -> "全绿，提交"

RIGHT:
  修复 listAgentScopeMarketplaces 返回类型
  -> 运行 tsc -> 运行 vitest
  -> 浏览器打开每个调用该 API 的页面（skills panel + marketplaces page）
  -> 确认页面无 error overlay，数据正确渲染
```

### 13. 日志与截图证据不一致（v1.5 新增）

```
WRONG:
  报告中混用不同时间线的日志和截图
  日志: 01:07:xx (HTTP 案例) + 截图: 01:31:xx (TCP/UDP 案例)
  -> 证据无效，读者无法确认因果关系

RIGHT:
  确保日志和截图来自同一次调用
  校验: 时间戳一致 + Session Key 一致 + 内容匹配
  如不一致 -> 重新触发并同时抓取
```

**为什么错**: 验证报告的核心价值是"客观可复现"。不同时间的证据混合会导致读者无法判断修复是否真正有效。审查者应该能拿着报告复现每一步。

### 14. 不做配置审计就直接改代码（v1.5 新增）

```
WRONG:
  功能不生效 -> 直接读源码找 bug -> 修改 Java/TS 代码
  (尤其违反"参照项目不能改源码"约束时)

RIGHT:
  功能不生效 -> 先审计配置文件 (tools.json / env / flags)
  -> 发现配置缺失或错误 -> 交回实现者修复 -> 独立验证生效
  -> 代码变更建议同样由实现者处理，验收者不修改
```

**为什么错**: Karpathy Guideline #2 Simplicity First。配置变更也有权限与行为风险，必须由实现者按授权处理。代码变更需要编译/部署/重启，且可能违反项目约束。本次实战中 tools.json 加 8 行即可修复，无需碰任何 Java 源码。

### 15. 响应字段映射未验证 — 读通过但写失败（v1.6 新增）

**根因模式**: 前端映射代码假设了后端字段名，TypeScript 编译通过，读操作正常，写操作暴露。

```
WRONG:
  // 前端 security.api.ts:135
  .then(list => list.map(e => ({ id: String(e.id) })))
  // 后端实际返回: { rowId: 1, ruleType: "KEYWORD", ... }
  // e.id → undefined, TypeScript 不报错
  // GET 列表渲染正常（显示 pattern/ruleType/enabled，这些字段名一致）
  // DELETE 时 id=undefined → 400

RIGHT:
  // Phase 0a 契约审计时，检查后端 DTO 字段名
  // SecurityAdminController 返回 rowId 不是 id
  .then(list => list.map(e => ({ id: String(e.rowId) })))

  // 或者用 __wbvLog 检查实际 response body:
  // __wbvLog 中 GET /api/security/blacklist 的 resBody:
  // [{ "rowId": 1, "ruleType": "KEYWORD", ... }]
  // 对比映射代码: e.id → 不存在 → 发现不一致
```

**为什么前面没发现**:
- TypeScript 类型编译通过（类型声明是前端约定，不反映后端真实字段）
- GET 列表渲染正常（表格显示的字段名恰好一致：pattern, ruleType, enabled）
- 只验 R（读取）不验 D（删除），bug 藏在"读操作正常"的假象背后
- 后端返回完整数据，只是 key 名不匹配

**检测方法**:
1. Phase 0a 契约审计：对比后端 DTO 返回字段 vs 前端映射字段名
2. Phase 3 数据验证：用 `__wbvLog` 检查 response body 实际 key，对比前端 `.then()` 映射
3. CRUD 全链路：必须触发 DELETE/UPDATE 操作，不能只验 GET

**影响范围**: 所有有前端映射层（`.then(list => list.map(...))`) 的 API，尤其 ID 字段映射错误会导致级联故障（删除、批量操作、详情跳转全部失败）。

### 16. Mermaid 时序图使用特殊字符导致渲染失败（v1.5 新增）

```
WRONG:
  消息体中使用 {} "" <> \n | ┌─┐ 等特殊字符
  -> GitHub/GitLab Mermaid 渲染空白或报错

RIGHT:
  消息体只用纯 ASCII 字母数字和标点符号
  复杂内容放 Note 注释框中
  用 Note right of 补充细节而非塞进消息箭头
  先在本地 preview 工具验证再提交
```

### 17. 只验管理侧不验运行时（"配置能改 ≠ 功能生效"，v1.7 新增）

**根因模式**: 安全/审核/限流类功能有两层 — 管理侧（配置页 CRUD）和运行侧（实际拦截行为）。只验管理侧会得出"全绿"的假象，运行时可能完全没生效。

```
WRONG:
  验证范围: 安全策略页能配置 + 黑名单 CRUD + 事件仪表盘渲染
  -> "全部 PASS，验证完成"
  -> 实际: 中间件没注册到 Agent，运行时根本不拦截

RIGHT:
  Phase 1-3: 管理侧（CRUD + 配置）
  Phase 4: 仪表盘展示
  Phase 5: 【必须】运行侧 — 真实触发 Agent 调用，验证策略实际生效
    - 发黑名单关键词 → 验证 503 阻断
    - 发正常消息 → 验证 200 放行
    - 改配置后 → 验证热重载对新请求生效
```

**为什么错**: 管理侧的 API 只读写数据库，不经过实际执行链路。中间件注册、Agent 装配、SSE 流处理、错误转换任何一个环节断裂，管理侧都看不出来。这次实战中 InputSecurityMiddleware 用错 API（`msg.toString()` 而非 `msg.getTextContent()`），管理侧完全正常，运行时静默失败。

**检测方法**:
1. 测试计划必须包含"实际触发被测功能"的 E2E 步骤
2. 不能止步于"配置页面能加载 + API 返回 200"
3. 对安全/审核/限流类功能，必须验证**负面案例**（恶意输入被拦截）和**正面案例**（正常输入不受影响）

**自检问题**: "如果管理侧代码完全正常，但运行时代码全删了，我的测试会发现吗？" 如果答案是不会，测试边界不够。

### 18. 上下文状态污染 — 单输入验证陷阱（v1.7 新增）

**根因模式**: 输入相同但上下文不同 = 行为不同。只测一次就下结论，会漏掉上下文相关的 bug。

```
WRONG:
  Step 1: 发 "e2e-block-test" → 503 阻断 ✓
  Step 2: 在【同一会话】发 "hello" → 503 阻断
  -> 结论: "hello 也被拦截了？奇怪，可能是 hello 触发了别的规则"
  -> 实际: 上下文里还有上一条 "e2e-block-test"，中间件扫描全部历史消息

RIGHT:
  Step 1: 在会话 A 发黑名单词 → 503 ✓
  Step 2: 在【新会话 B】发正常词 → 200 ✓
  Step 3: 在会话 A（已被污染）再发正常词 → 503 ✗（P1 缺陷！）
  -> 对比 Step 2 和 Step 3: 输入相同、上下文不同、结果不同 = 发现 bug
```

**为什么错**: 很多中间件/拦截器是无状态的（每次只看当前输入），但也有大量中间件是有状态的（看完整上下文、session、token、历史消息）。前者测一次就够，后者必须用控制变量法对比。

**检测方法**:
1. 每次测试至少跑**两个会话/上下文**: 一个"干净"的，一个"被污染"的
2. 对比同样输入在两种上下文下的行为差异
3. 特别关注: 安全中间件、对话记忆、用户态、缓存类逻辑

**实战案例**: AgentScope 安全中间件 `extractUserText()` 扫描 `input.messages()` 全部消息。一旦用户发过黑名单词，整个会话后续所有消息都被永久拦截。新会话正常。这个 P1 缺陷只有在"污染上下文 vs 干净上下文"对比中才能发现。

### 19. 子系统覆盖断层 — 只验触发面不验观测面（v1.8 新增）

**根因模式**: 一个功能子系统往往有多个 UI 表面（触发面 + 观测面 + 配置面 + 审计面）。只测最显眼的那个，会漏掉下游所有断点。参见 [铁律：功能图谱关联验证](#铁律功能图谱关联验证v18-新增)。

```
WRONG:
  发黑名单词 → Chat 页显示 503 错误卡片 → "PASS，安全拦截验证通过"
  (没打开 /security/events 仪表盘看事件是否记录)

RIGHT:
  测试前画图谱:
    操作: 发黑名单词
    edge 1: Chat UI 显示 503 错误卡片 → ✓
    edge 2: Events 仪表盘新增一行   → ?
    edge 3: Stats 卡片计数 +1       → ?
    edge 4: 容器日志 WARN           → ?
  每条 edge 都要打开对应 UI / 查 DB / 看日志验证
```

**为什么错**: 触发面（错误卡片、Toast、状态切换）是用户肉眼可见的，自然会去验。但观测面（事件流、审计日志、监控指标、统计聚合）是"运营/管理员视角"，往往在另一个路由下，不在测试者的注意力范围内。结果就是"用户能用 = 功能正常"的假象，但运营完全失去了对该功能的可观测性。

**iceberg 缺陷链**: 这种缺陷常以多层叠加形式出现 —— 一个症状背后是 N 层断点。
- 例：仪表盘显示"暂无安全事件记录"
- L1: 中间件拦截后没调事件服务（事件不入库）
- L2: event_type 用了自定义字符串，不在前端枚举里（即使入库 UI 不认）
- L3: `listEvents` 无 filter 时直接返回 emptyList（即使入库 API 不返）
- L4: `getEventStats` 是硬编码桩函数（顶部统计永远 0）

修 L1 才会暴露 L2；修 L2 才会暴露 L3；以此类推。**所以修复后必须重跑完整图谱**，不能假设"改一处就够"。

**检测方法**:
1. 测试前问自己："这个功能在系统里有几个 UI 表面？"（用户面 / 运营面 / 配置面 / 审计面 / 监控面）
2. 列出每个表面，每个都打开看一次
3. 对发布订阅型、审计型、监控型功能尤其警惕 —— 这类功能的"触发"和"记录"是解耦的，最易断链
4. 修复后重跑全图谱，不只验被改的那条边

**实战案例**: AgentScope 安全事件记录 —— 拦截链路完全正常（chat 页正确显示 503），但事件从未写入 DB，仪表盘永远显示 0 条。修复时连续发现 4 层缺陷（如上 L1-L4），每修一层才暴露下一层。

---


## Anti-pattern #20：把 UI 终态当业务完成（v2.2 新增）
症状：所有浏览器断言全绿，但下游（队列/邮件/审计/文件）从未收到效应。UI 是效应的投影，不是效应本身。图谱铁律要求遍历每条 edge，本条再加一道：**凡有浏览器外节点，必须在该节点所在系统内取证一次**。
