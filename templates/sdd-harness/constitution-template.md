# SDD Harness Constitution

> 本项目的治理宪法。所有阶段决策的终极过滤器。
> 在 spec 之前建立，约束 grill→archive 全流程。

## 治理原则

1. **Spec 是真相**：OpenSpec specs/ 是系统行为的唯一真相源，代码是实现
2. **Delta 渐进**：用 ADDED/MODIFIED/REMOVED 增量演化规范，不写全量
3. **9 阶段闭环**：每个变更经 grill→product→dev→test→code→review→verify→release→archive
4. **Review 在 Verify 之前**：先审代码质量，再验交付完整性
5. **测试是证据**：whitebox 单测 + preview e2e 是 verify 的实证，不是 code 的附属品
6. **知识沉淀**：每个变更的产出沉淀到 LLMWiki，知识随代码渐进生长

## 技术约束

（由 sdd init 时从 steering 合并，或 claude fill 时生成）

## 决策过滤器

遇到冲突时按此优先级：
```
OpenSpec specs > PRD draft > 代码实现
Human business decision > LLMWiki 历史实现
安全 > 功能 > 性能 > 美观
```

不可逆决策（架构选型、数据模型、API 契约）需 ADR 记录。
