## Changelog

### v2.5.0（独立验收职责拆分）
- 测试设计/实现/自检转 test-authoring；whitebox 消费 hash-linked TestPack 并独立验收，缺设计或测试交回作者。
- 清理 routed references 中的测试编写、自动修复和 Slice 实现指令；保留原生浏览器/截图、schema 3 门槛及兼容角色别名。
- 下列版本为历史记录，不覆盖当前职责边界；脚本、测试与运行接口未改。

### v2.3.1（2026-09-18 pipeline 闭环）
- P0×2：scope 工件缺失守卫（--json 错误恒完整，f16 负例）；run_all 负语料改测在用入口。
- 结构：journey.py 四热点分解（输出字节等价）；铁律展开下沉 references/iron-laws.md。
- 新纪律：验证者隔离与结果态优先（双门禁+Unknown 出口）；UNVERIFIED 强制 evidence-ref。
- 新测试：PBT 收窄版（三类确定性变异 PASS 不变量）+ 预算闸门；quick-reference 去密钥去重。
- 延后（全票 DEFER，见 roadmap）：LLM 变异语料生成器；pass^k/flake quarantine。

### v2.3（2026-09-18 多 agent 共识增强：17/17 全票）
- 依据 GitHub 高星测试实践（superpowers TDD/verification-before-completion、Anthropic 官方 security-review 提示词）三方独立评审+全票共识。
- 方法论：调试模式 revert-fix 回归有效性四步；finding 置信度三档+假阳性控制；E 维五类攻击面；claim→证据反查表；Slice 七步闭环（Verify RED 四判据）。
- 工程：校验器 --json 结构化输出（文本模式字节不变）；tests/run_all.sh 单命令自测（14 负例全绿）；负语料 f10-f15 六检测器失败用例；AST 助手三级 acorn 回退+Node 版本护栏；拦截器幂等护栏+XHR 同构拦截。
- 新工具：lint_debug_verdicts.py（调试 verdict 四态门禁）；render_journey_summary.py（ledger→报告桥接，derived-from-ledger 声明）。
- 卫生：铁律 #20 撞车修复+总索引；孤儿 reference 挂载；quick-reference 去重；引用一层化。

### v2.2（2026-09-02 合并 / 2026-09-18 文档层增强）
- 合并 Trinity/Journey/TDD/Whitebox 为单技能统一验证：模式路由置顶、代号空间声明（调试 A-H 与 Journey A-J 禁止跨模式混用）、渐进披露阅读路径。
- 铁律 10 确定性证据纪律（条件等待/确定性数据/证据可复核/重跑不一致两级归因 EVIDENCE_UNSTABLE）；铁律 11 与 Anti-pattern #20 浏览器外证据。
- 评审修订：Playwright 模板条件等待化、YELLOW 仅结论层状态、GREEN 回归夹具（tests/green-fixture/ 双入口实跑 STRUCTURE_PASS 逐字节一致）。
- 文档层增强（2026-09-18）：主文件瘦身（前置/时效/边界/报告要点/缺陷分类/桩节下沉 references/）、铁律编号统一（6/7/8 对齐主文件）、新增回归有效性证明、置信度标注、E 维攻击面五类清单、声称侧反查表、Slice 七步闭环、quick-reference 去重、引用一层化。
- 校验器路径改为相对 skill 根写法（scripts/...），提升可移植性。

<details><summary>历史明细（v2.2.0 完整修订记录 + v1.0–v2.1）</summary>

- v2.2.0 (2026-09-02)：铁律 10 两级归因；Playwright 条件等待化；渐进披露实质化；YELLOW 对齐（校验器契约不变）；版本谱系 2.0.0→2.2.0；工具降级路径（双浏览器全挂封顶 YELLOW）；校验器 canonical 路径；GREEN 回归夹具（tests/green-fixture/）。
- v2.1.0 (2026-08-10)：验证完备性纪律铁律 6-9 + verification-completeness.md（两级动词/旧 verdict 重推导/残留登记/8 维门槛/对抗清单/TC 矩阵 + few-shot）。
- v1.9.0：UI 视觉自查 6 条 + uiChecks JS 对象集成 Phase 1。
- v1.8.0：功能图谱铁律 + Anti-pattern #19 + 修复后回归铁律 + Playwright 回退。
- v1.7.0：安全/审核/限流双侧面验证 + Anti-patterns #17/#18。
- v1.6.x：CRUD 全链路铁律 + 响应字段映射审计（#15/#16）+ Mode B 外置 + Mermaid/Naming 外置。
- v1.5.0：模式 B 六阶段法 + Config Audit + Dual Evidence + Naming/Mermaid 规范（#13-15）。
- v1.0–v1.4：三层验证方法论 / 决策树 + 3-Strike / 时效指导 / 三维度契约铁律 / Anti-patterns #5-12。

</details>
