# 二轮席1（架构一致性）8 条 findings 处置记录（2026-11-03，proposal v2 → v2.1）

| # | 严重度 | finding 摘要 | 处置 |
|---|---|---|---|
| 1 | major | consensus-round1.md「不存在」 | **误报**：文件实存（8166B）且已提交于 c2e4832——评审侧 find 竞争。盘上与 git 双证 |
| 2 | major | 非目标「不引入新机读格式」与 features.md 机读格式矛盾 | 已改：非目标限定为「不引入 SDD.Delivery.* 之外的新机读**契约**格式」；features.md 声明为正本侧治理登记表（编译器消费面、非交付契约面）——已声明例外 |
| 3 | minor | Requirement IDs 必填单值，「留空 unresolved」会被编译器拒 | 已改：字段事实源节写明变更期表示法 = config.basis 登记 proposal 派生 requirement 条目（Requirement IDs 指向它）；step 0 技能快照替换从条件式改**必做非条件** |
| 4 | minor | 晋升键标题含逗号会碎裂 ID | 已改：晋升约束补「需求标题不得含半角逗号（字段分隔符），冲突即拒绝」 |
| 5 | minor | 草稿命名 vs host-ports 既有默认路径矛盾 | 已改：变更内文件命名保持 host-ports 默认锚点（tests/domain-cases.md + domain-cases.config.json），正本走 run.input.domainCases override（运行时原生字段，无需改 comet）；三层图 draft 名标注为示意 |
| 6 | minor | AC-6 文件名指代歧义（模板名 vs 运行时名） | 已改：AC-6 统一运行时真实名 domain-cases.config.json |
| 7 | minor | AC-6 漏收敛文档行与 classic-integration 断言更新 | 已改：AC-6 补 comet-ai-devops-convergence.md T 门交付物行 + classic-integration 单 ref 断言更新点名 |
| 8 | minor | V/Kp 行预声明了非目标未定的工件形状 | 已改：V/Kp 行标注「具体形状待实证」 |
