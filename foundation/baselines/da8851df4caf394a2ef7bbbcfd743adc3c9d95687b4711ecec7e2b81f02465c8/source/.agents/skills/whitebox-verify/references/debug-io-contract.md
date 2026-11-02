## I/O Contract

### 模式 A：前端验证

```
Input:
  - page_list:     [{ url, interactions: [{ action, element_selector?, expect_api?: { method, url_pattern, body_fields? }, expect_ui?: { state_change } }] }]
  - base_url:      string (e.g. "http://localhost:5173")
  - auth?:          { login_url, credentials?, token_key? } (可选，自动登录)

Output:
  - results:       [{ page_url, interaction, status: "PASS"|"FAIL"|"SKIP", findings: [{ severity, type, detail, api_call?, expected?, actual? }] }]
  - summary:       { total, passed, failed, skipped, p0_count, p1_count, p2_count }
  - api_audit:     [{ url, method, status, req_body_keys, res_body_keys, missing_fields?, extra_fields? }]
```

### 模式 B：Agent/后端调试

```
Input:
  - target:         string (问题描述，如 "sessions_spawn 不生效")
  - service:        { container_name?, port?, log_filter? } (目标服务)
  - config_files:   [string] (需要审计的配置文件路径列表)
  - constraint:      { no_source_modify?: bool } (是否禁止改源码)
  - test_case:      { input, expected_output? } (触发用例)

Output:
  - config_audit:   [{ file, finding, severity, fix }]
  - log_evidence:   [{ phase, timestamp, evidence, status }]
  - ui_screenshot:  { path, description } (当前 harness 实际截图/原生附件)
  - trace_diagram:  string (Mermaid 时序图)
  - naming_trace:  { name, components } (运行时命名溯源)
  - verdict:        PASS | FAIL | PARTIAL
```

### 浏览器工具选择与回退

先执行 `browser-execution.md` 的能力发现和当前 harness 原生工具文档。本文不绑定 Chrome；同名操作在不同 SDK 的参数并不通用。

| 需要 | 从实际工具文档确认 |
|---|---|
| 导航 / DOM / 交互 | 当前 tab、真实 snapshot、语义定位器与动作后断言 |
| 截图 | 实际捕获 + 原生图片输出协议 + 用户可访问产物 |
| 请求/响应 / console / trace | 各自能力独立探测；不凭 DOM 能力推断网络能力 |
| 网络拦截器（可选） | 仅当工具明确支持 init script；不能猜测 navigate_page 有 initScript 参数 |

原生浏览器不可用时，先检查已配置的浏览器工具，再用项目现有 Playwright runner。用户指定内置浏览器则保持该要求，其他 runner 只作补充证据。不为验收临时安装依赖或编写脚本；缺失脚本/依赖交回 test-authoring，运行其在项目既有测试路径交付的脚本。

历史作者侧 Playwright 示例（仅供审查交付测试形态，不是 whitebox 编写指令；不可直接粘到 IAB）：

```typescript
import { test, expect } from '@playwright/test';

test('save setting persists after reload', async ({ page }) => {
  // 作者交付内容必须有已观察的项目契约依据；验收者只核对和执行。
  await page.goto(process.env.TEST_BASE_URL!);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByLabel('Display name').fill('verification-value');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('verification-value');
  await page.screenshot({ path: test.info().outputPath('saved.png') });
});
```

该示例只说明 UI/刷新断言，实际验收仍需同一次请求证据、独立终态系统读回及失败/权限用例；未补齐不能声称 Journey 闭合。locator 不存在时先看 DOM，不能照抄示例猜页面。

所有浏览器路径均不可用时，保留 curl/服务日志/DB/静态检查，但浏览器维度保持 UNVERIFIED（Journey 用其原契约状态），整体不记 GREEN。一次超时先保留 tab/session 和报错，按当前文档恢复；自动检查仍在运行时等待原句柄，不反复刷新。

### 后端调试工具速查（模式 B）

| 操作 | 工具 | 用法 |
|------|------|------|
| 容器日志 | `docker logs --tail N <container>` | 运行时证据采集 |
| API 直调 | `curl -X POST ...` | 绕过 UI 触发请求 |
| 配置审计 | `Read` + `grep` | 对比期望 vs 实际配置 |
| 代码溯源 | `grep -rn "keyword" /path` | 追踪命名/行为来源 |
| 当前 harness 浏览器 | 按 browser-execution.md 发现实际工具 | UI 截图与交互证据 |

### 边界处理

| 场景 | 处理策略 |
|------|---------|
| MCP 工具超时 | 保留原始报错和 tab/session，检查实际状态；已确认运行的检查等待原句柄。未解决标未验证，必测项不能因 SKIP 变绿 |
| Auth 失败/重定向 | 检测 302/401 -> 按需重新登录 -> 重试验证 |
| 非 JSON 响应 | 核对端点真实 Content-Type 与契约；只有本应 JSON 的响应偏离契约才记异常 |
| CORS 错误 | 浏览器 console 报 CORS -> 检查 Vite proxy 配置 -> 非 skill 范畴，记录到 findings |
| 页面 SPA 路由不刷新 | 先检查当前 DOM/URL/预期效应；按实际文档决定是否有必要 reload。不得猜 ignoreCache 等参数或为恢复反复导航 |
| Docker 容器日志过多 | `--tail N` 限制行数 + `grep -E` 过滤关键词 | 模式 B 专用 |
| 配置文件在容器内 | `docker exec` 进入容器读取或挂载 volume | 模式 B 专用 |
| 参照项目不能改源码 | Config Audit -> 记录证据 -> 交实现者修复配置/参数/代码 -> 独立重验 | 模式 B 核心约束 |
| Mermaid 渲染失败 | 去掉特殊字符 -> 用 Note 替代消息体 -> 本地预览后再提交 | v1.5 专用 |

### 时效指导

| 步骤 | 建议超时 | 超时处理 |
|------|---------|---------|
| 原生导航 | 依实际文档 | 保留状态，检查后再恢复 |
| DOM/AX 观察 | 依实际文档 | 一次超时不能推断页面卡死 |
| click/fill + waitFor API | 15s | 检查 loading 状态，3-Strike |
| 支持的只读求值 | 依实际文档 | 保留报错，不能把超时直接当产品 JS 错误 |
| 单页面完整验证 (Phase 1+2+3) | 5min | 超时标记 SKIP，记录进度 |
| 全路由扫描 (N 页面) | N×1min | 超时标记剩余页面 SKIP |
| Agent Debug 全流程 (模式 B Phase 1-6) | 15-20min | 含配置审计+日志追踪+截图+报告 |
| 子 agent / 自动检查 | 依任务上界 | 对确认在运行的句柄等待，状态未知不代表已停止 |

Mode B 任务时长参考：Config Audit 3min / Log Chain Trace 5min / Dual Evidence 3min / 完整报告生成 10min / 全流程 20-30min。

### 错误处理：3-Strike 防死循环

验证过程中遇到工具失败或不确定结果时：

| Strike | 动作 | 适用场景 |
|--------|------|---------|
| 1 | 保留原始日志；观察当前状态并重建实际 locator，避免重复提交 | 观察超时、DOM 元素变化 |
| 2 | 按当前工具文档恢复会话；只有明确需要且无在途操作时 reload | HMR 缓存导致旧状态、元素 uid 变化 |
| 3 | 记录当前状态 + 实际截图/报错，标未验证；必测项保留未完成 | 连续失败、页面严重异常 |

**>3 次**: 停止验证，将当前状态 + 截图 + 诊断日志升级给用户决策。

---
