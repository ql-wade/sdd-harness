## Quick-Start 决策树

本表只路由 Debug，Journey/Slice 按 SKILL.md。含 UI 的所有路径先读 `browser-execution.md`，先发现当前 harness 原生工具，不绑定 Chrome 或通用 Playwright API。

```
问题类型                          →   起始 Phase / 模式
───────────────────────────────────────────────────────
页面白屏 / 崩溃 / 报错遮罩        →   Phase 1 (结构扫描) [模式A]
"这个按钮点击后功能不对"           →   Phase 0 → Phase 2 → Phase 3 [模式A]
"API 返回数据前端没用上"          →   Phase 0 → Phase 3 (数据验证) [模式A]
安全/审核/限流类功能              →   【必须】管理侧 Phase 0-3 + 运行侧 Phase 5 E2E [模式A+B 混合]
Agent 工具调用不生效              →   Agent Debug Phase 1 [模式B]
子 agent spawn 不工作             →   Agent Debug Phase 1-6 [模式B]
配置修改后行为不符合预期          →   Config Audit → Agent Debug [模式B]
首次使用 / 不确定从哪开始          →   Phase 0 (准备) → 全量扫描
需要交付验证报告                    →   保持 SKILL.md 的 Debug/Journey/Slice 范围，不因报告扩大任务
验证回归（修复后确认无破坏）        →   Phase 2+3 (仅验证变更模块) + 运行时 E2E
```

**铁律（v1.7 新增）**: 对安全/审核/限流/权限类功能，验证范围必须同时覆盖:
1. **管理侧** — 配置页面 CRUD、API 字段映射
2. **运行侧** — 实际 Agent 调用中策略是否生效（发恶意输入被拦截 + 发正常输入放行）
3. **UX 展示** — 拦截/放行时用户看到什么（错误卡片、状态标签、时间线）
4. **上下文对比** — 干净会话 vs 污染会话，验证状态相关的行为差异

**铁律（v1.8 新增）**: 任何功能都形成**有向图谱**（操作 → 多个下游效应）。验证时必须遍历每条 edge，不能只验最显眼的那个表面。详见 [铁律：功能图谱关联验证](iron-laws.md#iron-law-graph)。

```
画图谱 → 列出全部 edge → 每条单独验证 → 修复后重跑全部 edge
```

特别警惕发布订阅型 / 审计型 / 监控型功能 —— 这类功能的"触发"和"记录"是解耦的，最易断链。

**UI 功能可用性辅助检查**：以下启发式用于定位线索；以实际可见故障和已冻结需求为准。颜色/间距/信息密度偏好不是功能验收的通用失败门槛。

| # | 原则 | 检查方式 | 典型遗漏 |
|---|------|---------|---------|
| UI-1 | **文字不溢出** | 按实际长文本场景检查是否溢出；不强制特定 CSS 实现 | 长文本/URL/中文无空格 → 破版溢出 |
| UI-2 | **动画不裹文字** | `spin`/`rotate` 只用于纯图标；文字用 `pulse`/`opacity` | 整个 badge（图标+文字）一起旋转 |
| UI-3 | **状态必收敛** | 每个 loading/streaming 状态必须有超时兜底 + 完成回调 | SSE 结束但 spinner 永转 |
| UI-4 | **交互必可达** | 目标控件经正常滚动/导航后可见且可操作，不把首屏外控件当故障 | 输入框在视口外够不到 |
| UI-5 | **复用必适配** | 引入外部组件时检查 padding/height/overflow 是否匹配新容器 | v1 组件塞进 v2 tabs 留白失调 |
| UI-6 | **紧凑度检查** | 仅在用户指定视觉规范时评估留白比例 | 页面空旷，信息密度低 |

### UI 自查脚本（集成到 Phase 1 结构扫描）

以下为可选只读 DOM 诊断函数，仅在当前工具文档明确支持页面求值时执行（具体 API 由运行时确定，不存在通用 Playwright evaluate_script）。无该能力时使用 DOM/截图验证真实可用性；脚本匹配结果只是待复核线索：

```javascript
const uiChecks = {
  // UI-1: 文字溢出 — 找 scrollWidth > clientWidth 的文本容器
  textOverflow: () => {
    return Array.from(document.querySelectorAll('div, span, p, td'))
      .filter(el => el.scrollWidth > el.clientWidth + 2 && el.textContent.trim().length > 20)
      .map(el => ({ text: el.textContent.slice(0, 30), scrollW: el.scrollWidth, clientW: el.clientWidth }))
  },
  // UI-2: 动画裹文字 — 有 animation 且含文字（排除纯图标容器）
  animOnText: () => {
    return Array.from(document.querySelectorAll('*'))
      .filter(el => {
        const cs = getComputedStyle(el);
        const anim = cs.animationName;
        const hasSpin = anim.includes('spin') || anim.includes('rotate');
        const hasText = el.textContent.trim().length > 2 && !el.querySelector('svg, img');
        return hasSpin && hasText;
      })
      .map(el => ({ animation: getComputedStyle(el).animationName, text: el.textContent.slice(0, 20) }))
  },
  // UI-3: 状态卡死 — "执行中/streaming" 文字存在但数据已加载
  stuckLoading: () => {
    const body = document.body.innerText;
    const hasLoading = /执行中|streaming|加载中|loading|处理中/i.test(body);
    const hasData = document.querySelectorAll('.ant-table-tbody tr, .ant-card').length > 0;
    return hasLoading && hasData ? 'WARN: loading text + data both present' : 'PASS';
  },
  // UI-4: 交互不可达 — textarea/input 超出视口
  inputOutOfView: () => {
    return Array.from(document.querySelectorAll('textarea, input[type="text"], button[type="submit"]'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.bottom > window.innerHeight + 5 || r.top < 0 || r.width === 0;
      })
      .map(el => ({ tag: el.tagName, bottom: Math.round(el.getBoundingClientRect().bottom), vh: window.innerHeight }))
  },
  // UI-5: 复用适配 — 检查引入组件的容器是否有 overflow: hidden 导致裁切
  containerClip: () => {
    return Array.from(document.querySelectorAll('[style*="overflow: hidden"], [style*="overflow:hidden"]'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return el.scrollHeight > r.height + 5 && el.textContent.trim().length > 50;
      })
      .map(el => ({ scrollH: el.scrollHeight, clientH: el.clientHeight, text: el.textContent.slice(0, 30) }))
  },
  // UI-6: 紧凑度 — 内容区留白比例
  compactness: () => {
    const main = document.querySelector('.ant-tabs-tabpane-active, main, [role="main"]');
    if (!main) return 'N/A';
    const rect = main.getBoundingClientRect();
    const els = main.querySelectorAll('p, span, div, td, button, img, svg');
    let usedArea = 0;
    els.forEach(el => {
      const r = el.getBoundingClientRect();
      usedArea += Math.min(r.width, rect.width) * Math.min(r.height, 30);
    });
    const total = rect.width * rect.height;
    const ratio = total > 0 ? Math.round((1 - Math.min(usedArea / total, 1)) * 100) : -1;
    return ratio > 60 ? `WARN: ${ratio}% whitespace` : `${ratio}% whitespace`;
  },
};
```

**执行时机**：Phase 1 按问题选用；实际不可用、错误态不收敛等已复现缺陷才记 FAIL。脚本 WARN、普通滚动或视觉偏好不能自动判产品失败；工具不支持求值时不虚构执行。
