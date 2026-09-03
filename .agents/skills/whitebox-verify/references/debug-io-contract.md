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
  - ui_screenshot:  { path, description } (Preview MCP 截图)
  - trace_diagram:  string (Mermaid 时序图)
  - naming_trace:  { name, components } (运行时命名溯源)
  - verdict:        PASS | FAIL | PARTIAL
```

### Chrome MCP 工具速查

| 操作 | 工具 | 用法 |
|------|------|------|
| 导航（带拦截器） | `navigate_page` | `initScript: 拦截器代码`, `type: "url"`, `url: "..."` |
| 快照 | `take_snapshot` | 确认 DOM 结构，获取元素 uid |
| 截图 | `take_screenshot` | 视觉存档 |
| 点击 | `click` | `uid: "element_uid"` |
| 填写 | `fill` | `uid: "input_uid", value: "text"` |
| 输入 | `type_text` | `text: "text", submitKey: "Enter"` |
| JS 执行 | `evaluate_script` | 读取 `__wbvLog` / 检查 error overlay / 导航到 URL |
| 等待 | `wait_for` | 等待异步操作完成 |

### Playwright 回退方案（当 chrome-devtools MCP 断连时）

当 chrome-devtools MCP 不可用（MCP server disconnected），使用 **Playwright**（项目已装 `playwright`）做完整 UI 验证。

**关键**：脚本必须放在项目目录下（不能放 /tmp），否则找不到 `playwright` 模块。

### 双浏览器全挂时的降级路径（v2.2 新增）
Chrome MCP 与 Playwright 均不可用时，允许的最低证据模式 = curl（请求/响应断言）+ 服务端日志/DB 读数 + 前端构建产物静态检查。**限制**：此模式不得闭合 Journey 的 B 维（浏览器观察），B 维保持 `blocked-无浏览器证据`，整体结论最多记 `YELLOW（功能逻辑通过，UX 链路未证）`，禁止记 GREEN。

#### 使用模板

```javascript
// 放在 <project-root>/whitebox-ui.mjs（不是 /tmp/）
import { chromium } from 'playwright';

const BASE = 'http://localhost:<PORT>';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Console error 采集
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(`PAGE: ${err.message}`));

// 逐路由验证
for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10_000 }); // 条件等待（铁律10）：React settle，禁止固定 sleep

  // 提取渲染数据
  const data = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent,
    buttons: Array.from(document.querySelectorAll('button')).length,
    font: getComputedStyle(document.body).fontFamily,
    // ... 更多检查
  }));

  // 交互测试（点击 tab、filter 等）
  await page.click('[role="tab"]:has-text("技能")');
  await page.waitForLoadState('networkidle', { timeout: 10_000 }); // 条件等待（铁律10）

  // 截图
  await page.screenshot({ path: `screenshot-${route}.png`, fullPage: true });
}

await browser.close();
```

#### 运行方式

```bash
# 必须从项目根目录运行（node_modules 解析）
cd /path/to/project
node whitebox-ui.mjs

# 运行后清理
rm whitebox-ui.mjs
```

#### Chrome 手动调试（辅助）

当需要人眼检查时，用 macOS `open` 命令启动 Chrome + DevTools：

```bash
# 启动 dev server
npx vite --port 5180 &

# 打开 Chrome + DevTools auto-open + 直达目标页面
open -a "Google Chrome" "http://localhost:5180/agentscope-v2/monitoring" --args --auto-open-devtools-for-tabs
```

### 后端调试工具速查（模式 B）

| 操作 | 工具 | 用法 |
|------|------|------|
| 容器日志 | `docker logs --tail N <container>` | 运行时证据采集 |
| API 直调 | `curl -X POST ...` | 绕过 UI 触发请求 |
| 配置审计 | `Read` + `grep` | 对比期望 vs 实际配置 |
| 代码溯源 | `grep -rn "keyword" /path` | 追踪命名/行为来源 |
| Preview MCP | `preview_eval` + `preview_screenshot` | UI 截图证据 |

---
