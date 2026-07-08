# /sdd:grill — 澄清

Evidence-driven 业务澄清。调 sdd-grill skill。

## 用法

```
/sdd:grill "变更描述"
```

## 说明

- 底层：grill-me (mattpocock/skills) + sdd-harness skill（knowledge-pack 组装）+ LLMWiki MCP
- 产出：术语定义、边界、冲突日志、ADR 候选 → `openspec/changes/<id>/findings.md`
- 之后自动推进到 `/sdd:product`
