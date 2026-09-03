# Whitebox Verify 验证报告模板

## 基本信息

| 字段 | 值 |
|------|-----|
| **项目** | {project name} |
| **验证日期** | {YYYY-MM-DD} |
| **验证人** | Claude Code (whitebox-verify skill) |
| **Base URL** | {base_url} |

## 验证总览

| 指标 | 值 |
|------|-----|
| 总页面数 | {total} |
| 通过 | {passed} |
| 失败 | {failed} |
| 跳过 | {skipped} |
| P0 缺陷 | {p0} |
| P1 缺陷 | {p1} |
| P2 缺陷 | {p2} |

## 缺陷清单

| # | 级别 | 页面 | 交互 | 缺陷描述 | 根因 | 修复建议 |
|---|------|------|------|---------|------|---------|

## 详细验证记录

### 页面: {page_name}

**URL**: `{url}`
**加载状态**: ✅ PASS / ❌ FAIL
**Error overlay**: 无 / 有 ({detail})

#### 交互 1: {interaction description}

| 步骤 | 操作 | 预期 | 实际 | 结果 |
|------|------|------|------|------|
| 1 | {action} | {expected API call} | {actual API call} | ✅/❌ |
| 2 | {check body field} | {expected value} | {actual value} | ✅/❌ |
| 3 | {check response} | {expected status} | {actual status} | ✅/❌ |
| 4 | {check UI state} | {expected state} | {actual state} | ✅/❌ |

#### API 审计

**请求**: `{method} {url}`
- 发送字段: {list of fields in body}
- 响应字段: {list of fields in response}
- 缺失字段: {fields expected but not in response}
- 额外字段: {unexpected fields}

#### 截图

- 加载后: `{screenshot path}`
- 操作后: `{screenshot path}`

---

（重复上述模板，对每个页面的每个交互）


## v2.2 强制：维度键必须带模式前缀
所有维度结论键使用 `Debug-A…Debug-H` 或 `Journey-A…Journey-J`；裸字母键（如 `D: PASS`）视为无效报告，返工。
