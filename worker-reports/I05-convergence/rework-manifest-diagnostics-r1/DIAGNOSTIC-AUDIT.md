# I05 自有诊断入口盘点

| 入口 | 本轮处理 |
| --- | --- |
| manifest读取/JSON解析 | 分开识别已知路径/权限errno与SyntaxError。静态label+白名单code，不读取原生message/stack，不把输入路径加入错误。预期输入退出1；未知读取/解析异常为INTERNAL_FAILURE退出2。 |
| registry/refs读取/JSON解析 | 复用同一小型own helper，消除未知异常被catch-all伪装成普通输入的问题；label/prefix均由固定调用点提供。 |
| 域文件读取/解析 | 只有Graph的已知ENOENT可用既定缺席默认；其他预期文件输入受控拒绝，未知异常优先返回INTERNAL_FAILURE。聚合诊断只用固定文件名，不回路径或异常正文。 |
| qualification输入摘要 | 使用本次已读取的registry文本，不再额外打开文件形成第二个未保护的异常出口。 |
| argv/endpoint | 既有未知option/command静态标签不回退；unknown probe和最终fallback也改静态，不拼入case/command。 |
| freshness拒绝 | generation状态、未授权source ID及commit拒绝文案不再插入manifest值；拒绝code、freshness判断和UNVERIFIED语义保留。 |
| up拒绝 | 不把调用方lock.reason拼入error。已验证的数量仍可作为结构事实。 |
| 未捕获内部异常 | 最外层只输出静态INTERNAL_FAILURE并退出2，不伪装缺文件，不打印message/stack。 |
| 安全YAML | 固定程序、结构检查和Node返回协议逐字未改，截取段SHA另验；Python的ForbiddenYaml文本仅由固定枚举产生。 |

正常输出的工件来源字段仍按既有接口保留；它们不作为原生异常字符串回显。没有调整secret regex，也没有靠猜测任意短字符串是否“像凭据”来隐藏诊断。既有权限、freshness与运行资格判断未放宽。
