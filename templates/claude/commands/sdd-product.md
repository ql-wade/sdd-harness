# /sdd:product — 产品草案

产品草案阶段。调 sdd-product skill。

## 用法

```
/sdd:product
```

## 说明

- 底层：to-prd + prototype + LLMWiki MCP
- 产出：PRD（proposal.md）/ AC（acceptance-criteria.md）/ 功能测试草案（functional-test-draft.yaml）→ `openspec/changes/<id>/`
- LLMWiki 写入：`wiki/product/requirements/` + `wiki/product/acceptance-criteria/`
- 之后自动推进到 `/sdd:dev`
