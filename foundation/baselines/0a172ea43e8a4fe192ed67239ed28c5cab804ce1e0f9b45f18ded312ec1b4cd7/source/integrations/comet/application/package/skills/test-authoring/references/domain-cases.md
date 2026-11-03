# 领域 Markdown 用例与受管投影

按领域维护 Markdown 正文；一个文件可包含多个稳定 Case ID。需求和设计是预期依据，源代码只是当前行为。未确认的业务规则进入 unresolved，不从实现猜测 oracle。保留已批准的旧 TestPack v1 和手工用例原入口。

可从 [用例模板](../templates/domain-cases.md) 和 [配置模板](../templates/domain-case-config.json) 开始；模板只示范结构，所有依据、N/A、命令和环境必须按真实项目替换并独立审查。

当前 `domain-cases/v1` 投影器仅支持显式的字段格式，不会把任意旧 Markdown 自动解释为已批准测试。首行固定 `<!-- domain-cases/v1 -->`，后续每个用例以 `### CASE-ID — 标题` 开始；每个字段一行：

```markdown
<!-- domain-cases/v1 -->
# 领域用例

### TC-EX-1 — 读取记录
- **Requirement IDs**: REQ-1
- **Acceptance**: AC-1
- **Dimensions**: Journey-A
- **Level**: api
- **Priority**: P1
- **Precondition**: 已准备授权用户
- **Input**: 记录存在
- **Step**: 调用读取接口
- **Expected**: 返回该记录
- **Oracle basis**: REQ-1
- **Oracle authority**: 需求规定的响应
- **Cleanup**: 清除隔离数据
- **Evidence**: 请求与响应
- **Check ID**: read-record
```

`Precondition`、`Step`、`Cleanup`、`Evidence`、`Check ID` 可重复，保持顺序；`Requirement IDs` 和 `Dimensions` 使用逗号分隔。一个 Case 的 `Acceptance` 只能是一个 ID；多个验收标准须显式拆成稳定子用例，否则拒绝。未知字段、重复单值字段、无依据的 N/A 和格式版本不符不会被忽略。

按需复用的共性写在可信项目内另一个 Markdown 文件的 `## section-id` 下，以 `- **Inherit**: relative/path.md#section-id` 显式引用；同一字段合并规则保持列表顺序，冲突单值、循环、歧义标题、超深或越界拒绝。完整文件字节进入 basis；共享片段变化使原投影失效。

当前 Markdown 投影只支持设计态；自动化投影因缺少已资格化的作者执行来源而拒绝生成就绪声明。既有 TestPack v1 自动化入口保持可用；`ready_for_acceptance` 不证明独立验收。待明确的设计使用 unresolved，不得填造用例。

受管项目中的配置只记录需求/设计 basis 路径、A–J 适用性及依据、检查 ID/层级/能力/命令和环境清理，不重复维护用例步骤和 oracle。投影工具是项目能力，不是技能主控：从实际 SDD Harness 位置运行 `tools/test-cases/compile-domain-cases.mjs`，用 `--project` 指定可信项目根、`--cases` 和 `--config` 指定根内相对路径。缺工具或格式不能无损映射时保留源设计并将相应受管门禁标为未验证。

## 两层配置（v1.2 语义扩展：库级 ① + 变更级 ②）

投影 config 按归属拆两层，调用方读两文件经 `mergeDomainCaseConfigs` 合并后传入（① 为基底、② 同名键覆盖；basis 数组按 id 并集——② 同 id 替换、异 id 追加，① 的条目不被整体替换摧毁）：

- **① 库级**（`tests/domain-cases/domain-cases.config.json`，跨变更维护）：`basis`（F-ID requirement 条目 + 稳定领域 source 条目）+ `dimensions`（Journey 十键）。
- **② 变更级**（`<changeDir>/tests/domain-cases.config.json`，逐变更）：`project` / `change` / `mode` / `design_basis_id`（指向本变更 design.md 的 source 条目，该条目在 ② 的 basis 内）+ `checks` / `cleanup` / `self_checks` / `unresolved`。
- 机器侧「显式 unresolved」= ② 的 `unresolved` 数组条目（每条含 nonempty `question`）；登记表状态列只是镜像，不被解析。

## 特性登记表 features.md 与 F-ID（v1.2）

F-ID（特性 ID）注册为 `kind:'requirement'` 的 basis 条目（path 指向 features.md，多条目可共享同一 path）。每个已注册 F-ID 必须有 case 或 ② unresolved 条目（投影强制）；features.md 每行固定字段：`F-ID | 来源引用（design.md 节锚点） | 状态（proposed/covered/unresolved）| Journey 维度（A..J 之一）| spec 绑定（晋升后填）`。状态列与 Journey 列是登记侧字段：proposed = 编写期状态（投影前须转 covered 或 unresolved）；Journey 维度仅作分组统计，不承载覆盖语义（绑定唯一键 = 用例 `Requirement IDs` → F-ID）。每个 F-ID 行下可随附**验收节**自由文本块（登记侧，不参与投影）：约定 ≥1 条机制 AC（可判定 pass/fail）+ ≥1 条体验 QC（GWT 单行为、Then 可观察），并标注 verification route（test/inspection）。

## Requirement IDs 两阶段含义（v1.2）

- **变更期**：`Requirement IDs` 指向已注册的 F-ID basis 条目（第一阶段绑定）；`Acceptance` 承载该变更验收（AC-x）。
- **archive 晋升后**：用例保留 F-ID 引用不改写；F-ID → 正式 spec 的映射由 features.md 的「spec 绑定」列承载（`<capability>#<需求标题>` + 需求内容 digest），① 库级基准投影仅限晋升前语料。无 spec delta 的变更，冻结引用记 `change:<name>#AC-x`。

## 覆盖矩阵（v1.2）

编译器为每个已注册 F-ID 生成一行覆盖记录（case 数 / Acceptance 绑定数〔= 绑定该 F-ID 的 case 数〕/ Journey 维度 / level / 状态 covered|unresolved；unresolved 行的 Journey 与 level 置 `'—'`），内嵌 testPack 并以专属条目 `domain-cases/v1:feature-coverage-matrix` 进入 contract.dependencyBaselines。矩阵是生成物，禁止手维护。

项目配置中的适用性理由、作者自检和日志是待审声明；文件存在及摘要一致不能证明语义充分、命令真实执行或审查者独立。

保存完整 projection 后，在消费 TestPack 或 TestContract 前用同一参数加 `--verify <projection-path>` 重新计算；漂移退出 2。把 `--verify` 与 `--view testpack` 或 `--view contract` 一起使用，从同一已核对的投影提取已有 v1 兼容视图；核对到消费之间仍需由受控门禁重新核源。设计态合同带 `sourceReadiness: design_only`，不能满足受管 V 执行门；未决设计不生成 TestContract。工具不运行命令、不派发、不授予门禁。缺少独立 T 审查或可信来源时不放行；移交 whitebox 时同时提供原 Markdown、需求/设计、完整投影与实际作者自检证据。
