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

项目配置中的适用性理由、作者自检和日志是待审声明；文件存在及摘要一致不能证明语义充分、命令真实执行或审查者独立。

保存完整 projection 后，在消费 TestPack 或 TestContract 前用同一参数加 `--verify <projection-path>` 重新计算；漂移退出 2。把 `--verify` 与 `--view testpack` 或 `--view contract` 一起使用，从同一已核对的投影提取已有 v1 兼容视图；核对到消费之间仍需由受控门禁重新核源。设计态合同带 `sourceReadiness: design_only`，不能满足受管 V 执行门；未决设计不生成 TestContract。工具不运行命令、不派发、不授予门禁。缺少独立 T 审查或可信来源时不放行；移交 whitebox 时同时提供原 Markdown、需求/设计、完整投影与实际作者自检证据。
