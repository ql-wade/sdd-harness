# I04 诊断隐私 P2 返工交接

输入 `4ed312dec99e4563131193186a3f1a93655cc968`，沿原 I04、原隔离树与分支。类型 P2 的 43 项回归继续保留；本候选仍是建设工件，whole I04、生产登记、受管角色、Kp 和同 Run 仍未验收，业务场景接纳数为 0。

## 修复

坏 JSON 会使原生 JSON.parse 异常引用输入前缀。此前 domain、registry、refs 的 catch 都把它拼进 stderr；相对输入路径、未知 argv 和顶层堆栈也可能回显任意片段。本轮通过现有公开 CLI 真实复现了 `PRIV3KEY_i` 和短哨兵 `mQ7v`，没有使用实际秘密。

六类 JSON 输入共用读/parse 边界：文件失败只返回固定类别与白名单 `FILE_READ_*`，JSON 语法失败只返回 `JSON_INVALID`；domain 只附固定文件名，不拼文本、路径、原生 message 或 stack。未知 argv 也改为固定类别/原因码。类型前置和原 v1 接口保留，没有 schemaVersion 变化。

未预期的异常会重新抛到单独的 `INTERNAL_FAILURE` 非零出口，不伪装成无效 JSON、不转绿；未知异常消息和任意 error.code 不输出。盘点同时收紧 Git、realpath、源盘点、SQLite 和 SDK 的原始诊断出口，保留阶段、退出状态与有界原因码。成功的私有 fixture 数据仍按原协议作为数据返回。逐调用点和实际证据边界见 [diagnostic-callers.json](diagnostic-callers.json)，没有把静态盘点冒充每个故障分支的动态注入。

## 实测

固定 Node 24.15.0 与相同 PATH，完整 UTC/argv/cwd/输入前后 SHA/退出码/raw-display 绑定见 [runs.jsonl](runs.jsonl)。

| 记录 | 结果 | 范围 |
| --- | --- | --- |
| 01-diagnostics-red | 0/10，exit 1 | 四入口 × 六来源坏 JSON、实际 ENOENT/EISDIR、路径/argv/意外异常泄露 |
| 02-diagnostics-green | 10/10，exit 0 | 相同诊断边界全部转绿，零 skip |
| 03-final-owned | **53/53，exit 0，零 skip** | 原 43 项加新增 10 组，最终源码一次完整窄回归 |

新增组完成 103 次公开 CLI 调用：48 次坏 JSON、48 次实际文件读取失败、3 次坏 argv、4 次意外异常。失效输入的私有 I/O guard 阻断源/运行时访问尝试；没有伪造执行事实。最终 stdout 原始 SHA256 为 `0bd6ccacc97aba4833bc020308fb13047366be2abf5b2042189b169c8eb26cae`，最终输入六文件摘要见 [input.json](input.json)。这不是 canonical required 或业务场景的新分母。ignored 作者 TestPack 的只读结构校验另得 `PACK_STRUCTURE_VALID`，没有把它当执行或业务通过。

## 保全与范围

既有 I04 的 195 个索引文件与 P3 的 179 个记录先逐字节核对。CURRENT 仅切向本报告，其旧字节保留为 [prior-CURRENT.txt](prior-CURRENT.txt)；其他原文件不改。主树和工人各 7 个配置的摘要/缺席状态一致，四个域 JSON 未改，详见 [preservation.json](preservation.json)。

本轮没有重启唯一成功过的原生宿主探针，没有模型 turn、真实 Wiki/全局 DB 读取、活注册、许可或 canonical 台账写入。原 43 项仍运行并清理其原有一次性 SDK/MCP/SQLite 夹具。未变的 I01 41 项和全仓 14 项基线归因不重复，未宣称当前全仓通过。之前的 stdio/native-host 证据按原修订保全，不能继承成生产角色或 Kp 通过。

请 root 继续双轴独立复验和唯一串行集成；生产接线与 whole I04 仍由原 owner/唯一 DAG 接纳。ignored 原始证据为 `.local/I04-convergence/rework-diagnostics/`，回收工人树前须保留。
