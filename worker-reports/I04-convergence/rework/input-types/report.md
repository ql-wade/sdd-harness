# I04 输入边界 P2 返工交接

输入 `703cfa3bd1591722b64a88229394225c1768b115`，沿原 I04、原隔离树与分支；原实施基点 `93753a4`。这里只提交建设工件，whole I04、生产宿主登记、真实角色、Kp 与同一 Comet Run 仍未验收，业务场景接纳数仍为 0。

## 修复

- 四域文档和全部实际消费字段采用同一类型前置：对象、数组及元素、非空字符串、布尔、正整数。81 个节点包含容器与可选观察字段，详见 [消费清单](consumer-inventory.json)。非法结构在摘要、项目路径解析、源盘点和解释器执行之前返回 JSON `REJECTED`、退出 2、`executed=false`、`runtimeExecuted=false`。
- commit/tree/requirements 摘要先检查字符串类型再匹配正则，不再允许数组隐式转为摘要。四入口共用这一边界，未新增 schemaVersion；合法最小 `*.v1` 配置和缺省 observation 均可用。
- 只读 qualify 的 `runtimeExecuted` 从实际子进程 pid 产生。源目录缺席时不会把工作区匹配冒充解释器已执行；版本读回先校验对象/字符串，仅投影 python/mcp，未知字段不能覆盖 status。
- 既有测试 JSON 解析失败报告器使用了错误的 `AssertionError(string)`，会掩盖 CLI 原始错误。改为 options 对象；第一次失败日志保留，第二次专门重现空文档原始错误。

## 实测

固定 Node 24.15.0 与相同 PATH；准确 UTC、argv、cwd、输入前后摘要、退出码及 raw/display 哈希见 [runs.jsonl](runs.jsonl)。

| 记录 | 结果 | 证明范围 |
| --- | --- | --- |
| 01-input-types-red | 0/5，exit 1 | 原 commit 数组被 validate 放行；旧测试报告器的遮蔽也保留 |
| 02-null-documents-red | 0/4，exit 1 | 修正报告器后四入口空文档边界 |
| 03-all-types-red | 0/15，exit 1 | 嵌套类型、隐式转换、源/子进程越界尝试和虚假执行元数据 |
| 04-all-types-green | 15/15，exit 0 | 同一类型边界全部转绿 |
| 05-final-owned | **43/43，0 skip，exit 0** | 原 27 项加新增 16 组，最终源码一次完整窄回归 |

最终新增组执行 451 次公开 CLI 调用：顶层 null 16 次，其他顶层错误 80 次，commit/tiers 反例 12 次，80 个嵌套字段反例 × 四入口 320 次，私有 I/O tripwire 16 次，缺源运行时 1 次，最小合法配置 6 次。这是作者测试分母，未改当前 required 或业务场景分母。tripwire 是测试夹具，不授予任何运行权限。

最终 stdout 原始 SHA256：`5db2c6a7362c028dc8e89dd1df5dfbb16e2658930d3cc6973f11f4a870b69c92`。所有输入在本次执行前后相同；最终六文件摘要见 [input.json](input.json)。作者 TestPack 仅保存在 ignored 证据中；只读结构校验另得 `PACK_STRUCTURE_VALID`，它不代表执行通过或业务验收。实际 stdio/native SQLite/FTS 正负路径由原 27 项中的既有私有夹具回归覆盖；未重启成功过的那次原生宿主探针。

## 保全与交回

既有 I04 157 个索引文件和 P3 179 个记录逐字节相同。主检出和工人各 7 个活配置的 SHA/缺席状态前后一致。四个域 JSON 未修改；旧 CURRENT 字节存为 [prior-CURRENT.txt](prior-CURRENT.txt)，CURRENT 只切向本返工报告。未读取真实知识树或全局数据库，未新增模型 turn 或原生宿主探针、活注册及真实项目知识副作用。原有 27 项仍产生并清理其一次性 SDK/MCP 夹具。

未重跑未变的 I01 41 项，也未重复全仓 14 项基线归因；旧报告和原始证据完整保留，不宣称本轮全仓回归通过。原生宿主历史只保留它当时的隔离 fixture 观察；生产 launcher/登记、受管角色、知识权限和业务 Run 的缺口仍交原 owner，不能转为当前通过。

请 root 对本候选做双轴独立复验并串行集成。具体构建与注册接线仍按原 DAG/原 owner；本工人不写 canonical 计划、许可、主状态或真实知识。原始证据位于 ignored `.local/I04-convergence/rework-input-types/`，清理此工人树前须由 root 保留。
