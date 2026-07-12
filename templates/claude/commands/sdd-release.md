# /sdd:release — 部署

部署阶段（optional，可 skip）。调 sdd-release skill。

## 用法

```
/sdd:release                    # 引导选 mode
/sdd:release --mode manual      # 产出 deploy checklist
/sdd:release --mode automated   # 触发 deploy pipeline
/sdd:release --mode skip        # 跳过部署（纯 spec/文档/重构，或外部 CI 处理）
```

## 说明

- mode：manual（deploy checklist）/ automated（触发 pipeline + 记录结果）/ skip（记录 no-deploy 理由）
- 硬前置：verify gate 已过
- skip 模式：调用 `sdd run release --mode skip`，由 CLI 重新验证后推进到 archive
- 产出：release note / changelog / deploy 结果 / 回滚路径
- 之后推进到 `/sdd:archive`
