# /sdd:review — Review

独立 Review 阶段（ADR-0010）。调 sdd-review skill。

## 用法

```
/sdd:review
```

## 说明

- 顺序：先 Superpowers code-reviewer（架构 + spec/design 对照），后 open-code-review CLI（行级）
- auto-debug：reviewer 连续拒绝 2 次 → 新起干净 subagent 查根因
- code graph：query_graph("boundary") 检查边界违规
- 产出：`.sdd/runs/<id>/review-notes.md` + learnings 经 findings.md 传播
- 之后自动推进到 `/sdd:verify`
