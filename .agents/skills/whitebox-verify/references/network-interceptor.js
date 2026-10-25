// Whitebox Verify - Chrome MCP 持久化网络拦截器
// 用法: 仅在浏览器文档明确支持导航前脚本注入时使用其实际 API；不假设 navigate_page 有 initScript 参数
// 拦截器在页面导航后不会丢失（与 evaluate_script 不同）
// IIFE 包裹 + 幂等护栏：initScript 重复注入时直接返回，
// 避免 fetch/XHR 双重包裹与 __wbvLog 条目翻倍

(() => {
  if (window.__wbvLog && window.__wbvLog.__wbvGuard) return;
  window.__wbvLog = [];
  window.__wbvLog.__wbvGuard = true;

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

  // XMLHttpRequest 拦截：条目汇入同一个 __wbvLog，字段结构与 fetch 条目对齐
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR && OrigXHR.prototype) {
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function (method, url, ...rest) {
      this.__wbvReq = {
        method: String(method || "GET"),
        url: String(url || ""),
      };
      return origOpen.apply(this, [method, url, ...rest]);
    };

    OrigXHR.prototype.send = function (body) {
      const meta = this.__wbvReq || { method: "GET", url: "" };
      const entry = {
        method: meta.method,
        url: meta.url,
        body: null,
        ts: Date.now(),
      };
      if (body) {
        if (typeof body === "string") {
          try {
            entry.body = JSON.parse(body);
          } catch (e) {
            entry.body = "[non-json]";
          }
        } else {
          entry.body = "[non-json]";
        }
      }

      this.addEventListener("error", () => {
        entry.error = "network error";
      });
      this.addEventListener("loadend", () => {
        entry.status = this.status;
        entry.ok = this.status >= 200 && this.status < 300;
        try {
          const data = JSON.parse(this.responseText);
          entry.resKeys = Object.keys(data).slice(0, 30);
          entry.response = data;
        } catch (e) {
          entry.resType = "non-json";
        }
        window.__wbvLog.push(entry);
      });
      return origSend.apply(this, [body]);
    };
  }

  // Helper: 读取特定模式的 API 调用（fetch/XHR 条目字段同构，过滤逻辑通用）
  window.__wbvGet = function (urlPattern, opts = {}) {
    return window.__wbvLog.filter((c) => {
      if (urlPattern && !c.url.includes(urlPattern)) return false;
      if (opts.method && c.method !== opts.method) return false;
      if (opts.ok !== undefined && c.ok !== opts.ok) return false;
      return true;
    });
  };

  // Helper: 清空日志（重建数组后补回护栏标记，防止清空后 initScript 重跑造成二次包裹）
  window.__wbvClear = function () {
    window.__wbvLog = [];
    window.__wbvLog.__wbvGuard = true;
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
})();
