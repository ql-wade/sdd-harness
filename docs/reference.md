# CLI 完整命令参考（README 的分流清单）

> 索引与常用三条见 [README](../README.md)（doctor / test-gate / check.sh）。
> 退出码契约：`0` 通过，`1` 输入无效，`2` 验证不通过。

```bash
node bin/cli.js test-gate --project . --evidence-dir .sdd/evidence   # 跑测试 + sha256 证据
node bin/cli.js probe --project . --evidence evidence.json           # probe 证据校验
node bin/cli.js generation-capture --project . --out before.json     # 测试清单（生成前）
node bin/cli.js generation-evaluate --project . --before before.json # 测试编写完整性
node bin/cli.js deliverable-audit --project . --run <id>             # 交付物审计
node bin/cli.js evidence-audit --project . --change <id>             # 证据审计
node bin/cli.js workflow-audit --project . --run <id>                # 运行状态审计
node bin/cli.js wiki init                                            # LLMWiki 骨架 + raw/ 复制
node bin/cli.js doctor                                               # 环境自检
```

机器可读输出加 `--json`。各命令的输入校验与拒绝语义见 `bin/cli.js` 与对应
lib 模块。
