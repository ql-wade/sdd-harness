# /sdd:archive — 归档与知识沉淀

归档阶段（最终阶段）。调 sdd-archive skill（封装 trinity-archive）。

## 用法

```
/sdd:archive
```

## 说明

- 底层：trinity-archive + LLMWiki MCP writeback（via sdd-harness §5）
- spec 提升：`openspec/specs/<slug>/`（registry 关，扁平 namespace）或 `openspec/specs/<domain>/`（registry 开）
- LLMWiki writeback：product → `wiki/product/`、engineering → `wiki/engineering/<domain>/`、testing → `wiki/testing/`、补 concepts/entities backlink
- 硬前置：verify + release gate 已过
- 完成后 change 归档，workflow 结束
