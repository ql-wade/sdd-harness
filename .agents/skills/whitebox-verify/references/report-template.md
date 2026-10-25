# Whitebox Verify 验证报告模板

## 基本信息

| 字段 | 值 |
|------|-----|
| **项目** | {project name} |
| **验证日期** | {YYYY-MM-DD} |
| **验证人** | {actual harness} (whitebox-verify skill) |
| **Base URL / 构建** | {base_url / actual build identity} |
| **Run / Case** | {actual run_id / case_id} |
| **交接来源** | {trusted project root / TestPack path + SHA-256 when supplied, otherwise original approved case/test references / basis + test + log identity checks} |
| **作者缺口** | {missing design/cases/scripts/oracles and owner; no silent authoring} |
| **浏览器 / tab / viewport** | {actual backend / tab / viewport} |
| **能力与限制** | {observed / unsupported / unknown; tool evidence refs} |

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

> **verdict 微格式（每维度必附）**：表格区每个维度附一行单行机器可读结论 `VERDICT|<mode>-<dim>|STATUS|<evidence-ref>`（mode-dim 取 `Debug-A`…`Debug-H` / `Journey-A`…`Journey-J`；STATUS ∈ PASS / FAIL / UNVERIFIED / EVIDENCE_UNSTABLE；终局报告禁用 `planned`）。**四态全部强制 evidence-ref——UNVERIFIED 同样必须带**：其 evidence-ref 指向"为何无法验证"的证据（环境限制探测、超时记录、工具不可用报错），而不是留空或写一句说明。降级写 UNVERIFIED 不等于逃证。机器校验命令：`python3 scripts/lint_debug_verdicts.py <report.md> [--allow-planned]`

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

| 步骤 | 真实截图 / 原生附件引用 | 捕获时间 | URL/tab | 文件 hash（已导出时） |
|---|---|---|---|---|
| 加载 / 终态 / 失败 | {actual image reference} | {actual capture time} | {actual target} | {actual SHA-256 or native-only} |

按 browser-execution.md 的工具协议展示关键图像；路径需真实存在，只有原生图像时不编造文件。另附独立终态读回、首次/最终回归命令、退出码、失败/跳过/重试计数。截图与 DOM、请求、读回都关联同一 run/case。

---

（重复上述模板，对每个页面的每个交互）


## v2.2 强制：维度键必须带模式前缀
所有维度结论键使用 `Debug-A…Debug-H` 或 `Journey-A…Journey-J`；裸字母键（如 `D: PASS`）视为无效报告，返工。

## Journey 汇总渲染（ledger → 报告桥接）

对已通过 STRUCTURE_PASS 校验的 journey ledger，用脚本渲染汇总（journey/case/hop/mandatory 计数、A-J 维度状态表、findings 按 P0/P1/P2 分级、run.sources 与 provenance trust level）：

```bash
python3 scripts/render_journey_summary.py <ledger.json> [--json]
```

`--json` 输出同构 summary 对象。输出头部带 `derived-from-ledger: <path>`——该汇总是派生视图，不得当作执行证据（R3 共识）。
