// Whitebox Verify - Chrome MCP 持久化网络拦截器
// 用法: 在 navigate_page 时通过 initScript 参数注入
// 拦截器在页面导航后不会丢失（与 evaluate_script 不同）

window.__wbvLog = [];
const origFetch = window.fetch;

window.fetch = async function (...args) {
  const url =
    typeof args[0] === "string"
      ? args[0]
      : args[0]?.url || "";
  const opts = args[1] || {};
  const method = opts.method || "GET";
  let body = null;
  if (opts.body) {
    try {
      body = JSON.parse(opts.body);
    } catch (e) {
      body = "[non-json]";
    }
  }

  const entry = { method, url, body, ts: Date.now() };
  const result = origFetch.apply(this, args);

  try {
    const resp = await result;
    entry.status = resp.status;
    entry.ok = resp.ok;
    try {
      const clone = resp.clone();
      const data = await clone.json();
      entry.resKeys = Object.keys(data).slice(0, 30);
      entry.response = data;
    } catch (e) {
      entry.resType = "non-json";
    }
  } catch (e) {
    entry.error = e.message;
  }

  window.__wbvLog.push(entry);
  return result;
};

// Helper: 读取特定模式的 API 调用
window.__wbvGet = function (urlPattern, opts = {}) {
  return window.__wbvLog.filter((c) => {
    if (urlPattern && !c.url.includes(urlPattern)) return false;
    if (opts.method && c.method !== opts.method) return false;
    if (opts.ok !== undefined && c.ok !== opts.ok) return false;
    return true;
  });
};

// Helper: 清空日志
window.__wbvClear = function () {
  window.__wbvLog = [];
};

// Helper: 获取响应字段与前端类型的差异
window.__wbvAudit = function (urlPattern, expectedFields) {
  const calls = window.__wbvGet(urlPattern);
  if (!calls.length) return { calls: 0, issue: "NO_API_CALL" };
  const last = calls[calls.length - 1];
  const actualKeys = last.resKeys || [];
  const missing = expectedFields.filter(
    (f) => !actualKeys.includes(f)
  );
  const extra = actualKeys.filter(
    (f) => !expectedFields.includes(f) && !f.startsWith("_")
  );
  return {
    calls: calls.length,
    url: last.url,
    status: last.status,
    ok: last.ok,
    actualKeys,
    missingFields: missing,
    extraFields: extra,
    fieldValues: expectedFields.reduce((acc, f) => {
      acc[f] = last.response?.[f];
      return acc;
    }, {}),
  };
};

// Helper: 检查 error overlay
window.__wbvHasError = function () {
  return (
    !!document.querySelector('[class*="error-overlay"]') ||
    !!document.querySelector('[data-reactroot] [class*="error"]')
  );
};
