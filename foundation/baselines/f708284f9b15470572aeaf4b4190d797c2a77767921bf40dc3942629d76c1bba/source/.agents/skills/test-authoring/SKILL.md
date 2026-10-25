---
name: test-authoring
description: >-
  从需求、规范、代码变更和缺陷记录设计测试用例，并按授权编写或补充可执行测试代码、数据夹具与测试自检。
  当用户要求“写测试用例”“根据需求设计边界/异常/权限场景”“补单测/集成/契约/属性/E2E 测试”“生成可交付测试包”时使用。
  支持只设计用例和设计加自动化两种模式，复用项目现有框架，产出可追溯交接包。
  仅验收、浏览器取证、判断功能是否通过转 whitebox-verify；不承担业务验收结论，不因编写测试而修改产品实现。
metadata:
  version: "1.0.0"
---

# Test Authoring

职责：把有依据的预期行为变成系统化用例、必要的测试代码和可复核交接包。作者自检证明测试可用与缺陷敏感度；独立业务验收由 `whitebox-verify` 负责。

## 入口与写入边界

| 请求 | 行为 |
|---|---|
| 只设计测试用例/测试方案 | design：读需求/代码，输出用例和覆盖/缺口；不写测试代码、不运行测试、不为文档任务打开浏览器 |
| 写/补自动化测试 | automate：设计后逐个落成现有框架中的测试、fixtures 与必要自检；不批量猜尚未确认接口 |
| 只验收/验证交付/浏览器检查 | 交给 whitebox-verify；不要借验收顺手补写测试 |
| 同时编写并验收 | 先作者交付并冻结测试包，再由独立验收上下文检查原始依据与执行；作者不得给自己签验收 PASS |
| 产品功能实现或修复 | 单独开发/TDD 流程承担产品改动。本技能只写已授权的测试与测试辅助文件 |
| 翻译/一般问答 | 不启动测试工作流 |

用户已批准的范围和测试边界直接复用；只有未知规则会改变预期结果、写入权限或关键覆盖时才提问。不要在同一批准范围中反复索要许可。通过读源代码不能获得业务规则的批准，不能把当前输出当正确期望。

## 五段工作流

### 1. 提取测试依据与边界

读需求/已批准规范、变更调用链、已有测试、领域词汇与 ADR。记录需求 ID、源文件与实际内容哈希、公开测试边界、风险与适用环境。区分 requirement（预期依据）与 source（当前实现）；预期来自规范/独立算例/可靠参考，不从实现重算。

产品功能缺失、测试接口不可达、规范矛盾分别登记。没有税率/舍入/权限规则时不能编一个结果；输出已确定部分与明确 unresolved。若全部规则未知，也可交 design-only 的阻塞设计包，不伪造用例或 N/A。

### 2. 建模与用例设计

读 [case-design.md](references/case-design.md)；按所需行为选技术，不强行穷举所有维度。数值/长度用等价类和边界值，组合规则用决策表，生命周期用状态迁移，多参数按风险做 pairwise，代数关系/不变量用属性测试，真实用户路径用场景测试。

读 [dimension-mapping.md](references/dimension-mapping.md)。以语义为先，向 whitebox 导出固定 Journey-A…J 映射，Debug-A…H 单独映射，禁止混用或重新命名字母。每个维度写 required 或有源码依据的 N/A；适用但未知写缺口，不写 N/A。

每条用例具备 ID、需求引用、风险/层级、前置身份与状态、输入、步骤、独立 oracle 与 authority、清理、证据计划。成功、相关拒绝/边界、持久化重入、并发/恢复等依适用性覆盖。设计用例目录可以先完整列出；代码按已确认的行为逐个落地。

### 3. 编写测试与数据夹具（仅 automate）

先复用项目已有框架、fixture、构建/测试命令；不为了少量测试引入第二套框架。普通测试使用公开行为边界，避免私有方法/内部 mock 耦合；独立系统级数据库读回可以是验收 authority，不把单测原则机械套到跨服务终态。

按任务只读相关适配：
- 单测/服务集成：[unit-integration.md](references/unit-integration.md)。
- 浏览器 E2E：[browser-e2e.md](references/browser-e2e.md)。
- HTTP/消息契约：[contracts.md](references/contracts.md)。
- 属性/边界生成：[property-testing.md](references/property-testing.md)。

仅授权测试写入，不修改产品、修改业务期望、扩大权限、安装依赖或发布云端契约来让测试通过。发现产品缺陷时记录可复现 RED，交开发修复；发现可测试性问题时说明所需接口调整，不能自行重构产品。

### 4. 测试自身质量检查

读 [test-quality.md](references/test-quality.md)。新未实现行为亲见预期 RED，区分断言失败与导入/语法/环境错误。已有正确行为不强迫所有测试失败：按风险使用已知旧版、受控故障/变异或 revert-fix 证明能抓住目标缺陷，记录对照；只在隔离副本操作，保留用户原文件。

实际运行自动化测试并保存命令、退出码和原始日志。expected_failure 可以是正确作者产物；ready_for_acceptance 不表示产品通过。没有执行环境则保留设计/代码与阻塞，不能编 run ID、哈希、时间、截图或已通过日志。整个测试重试后转绿保留不稳定记录。

### 5. 冻结交接包

读 [test-pack-contract.md](references/test-pack-contract.md)。TestPack JSON 是唯一机读来源；CSV/YAML 为按需视图，不维护第二份独立规则。设计包状态 design_only，自动化准备就绪状态 ready_for_acceptance；两者都不是验收 verdict。

TestPack 记录真实 basis、case→需求→维度→测试映射、隔离数据/清理、oracle、运行命令、自检日志与内容哈希。用 [case.json](templates/case.json)、[coverage-matrix.csv](templates/coverage-matrix.csv)、[acceptance-handoff.md](templates/acceptance-handoff.md) 作结构参考，不把模板值当执行证据。

在独立选定的项目根目录运行：

```bash
python3 scripts/validate_test_pack.py /actual/test-pack.json --project-root /actual/repository
```

`PACK_STRUCTURE_VALID` 只证明结构/引用/现存文件哈希一致，不证明设计充分、命令实际执行、产品正确或验收通过。验证器不执行包内命令；日志哈希不是签名。设计包可保留明确 unresolved；自动化 ready 包不能有未解决预期。

交给 whitebox 时说明必须执行的用例、已知 RED/环境限制、允许的人工步骤与自动化要求。验收者独立确认 trusted root、原始规范/测试/日志，核对包哈希并重跑测试或真实路径。缺用例/弱断言退回本技能；验收者不能直接改包、改测试或改产品后自行报绿。

## 交付与质量门槛

- 单纯设计：用例、覆盖与未决问题；代码和执行日志保持未生成状态。
- 自动化：测试代码/fixtures、TestPack、真实自检日志与交接说明；若真实自检不可执行，明确未达到 ready，不编造已就绪包。
- 验收结论：不生成业务 accepted、overall_passed 或验收 PASS；“作者自检通过”须指出具体命令和范围。
- 退出前检查独立 oracle、必需路径、数据隔离、无恒真/空跑/忽略失败、哈希与测试文件映射；缺失项交接，不静默删除。
- 新增/修改验证器执行 `bash tests/run_all.sh`；规范来源与选择性采纳见 [upstream-practices.md](references/upstream-practices.md)。
