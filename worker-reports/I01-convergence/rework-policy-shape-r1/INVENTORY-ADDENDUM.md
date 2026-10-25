# Lock 输入的前置检查补充

在首次盘点后的消费点复核中，确认 source digest 的 RegExp.test 仍可对对象发生隐式转换。为避免将该 lock 路径留给后续复审，增加私有 CLI 副本的实际负例：lock 为 null/数组/未知 schemaVersion、source 为数组、source.sha256 为 toString=null 对象、package.version 为数组，分别走 qualify/up。

本补充先于 lock 分支修复保存。输入文件均在测试私有项目内，工具记录器应证明没有外部 CLI 调用。未修改真实组件 lock。既有缺锁/缺 pin 仍表示 qualification UNVERIFIED；已提供但形状非法的 lock 应在 runtime observation 前结构化拒绝。后续读取使用同一批预检字节和摘要，不用通用 TypeError catch 替代验证。

同一读取链还需保持已声明的 version/integrity 绑定：合法 npm 元数据若只有 license，不能因它与无 package 的 lock 两端字段都为 undefined 而将 license 标为 VERIFIED。该负例不拒绝合法不完整输入，而要求 UNVERIFIED。

最终消费点复核同时将显式 null 的 optional delegates 和用于诊断文本的资源 id 对象纳入公开 CLI 负例。前者不能被 `?? []` 当成缺省值；后者不能在类型检查之前被模板字符串隐式转换。两者均应先返回结构化登记拒绝。
