# /sdd:test — 测试矩阵

测试矩阵与用例阶段。调 sdd-test skill。

## 用法

```
/sdd:test
```

## 说明

- 底层：LLMWiki MCP（via sdd-harness §5）
- 产出：test matrix + 归一化测试用例写入 LLMWiki `wiki/testing/cases/TC-*.md`（带 frontmatter）
- code graph：query_graph("impact") 定位回归风险
- traceability：用例经 backlink 关联到需求/spec/AC
- 之后自动推进到 `/sdd:code`
