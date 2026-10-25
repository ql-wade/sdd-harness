# I05 P2 返工：静态输入诊断与内部失败分离

沿原I05，基点4458c173411d2a7304ccd71b00f0aa8808971200，不rebase。候选待独立双审，whole I05和真实运行资格仍UNVERIFIED；没有新增工作流、权限或收尾结论。

原manifest catch把JSON.parse原生message与输入路径拼入error，任意短/noncredential合成文本会回显。现使用小型own读取/JSON诊断helper：静态label和固定errno白名单，SyntaxError是预期输入；未知读取/解析异常明确INTERNAL_FAILURE，不靠secret regex、不打印message/stack/路径，也不catch-all伪装缺文件。预期输入退出1，内部失败退出2。按同根盘点覆盖registry/refs/domain，只有Graph的已知ENOENT可触发原缺席默认；qualification复用已读文本避免第二次不受控I/O。unknown probe/command、freshness的原始status/source值和lock.reason也不再拼入诊断；正常manifest新鲜度/UNVERIFIED判断未放宽。

精确4458不可变原CLI另做一次原始stdout成对取证：短合成body原版exit1且回显PRIV5NOTE_，候选exit1且不回显（MANIFEST_JSON_INVALID）；完整原始流/输入SHA见direct-public-reproduction。公开seam真实RED16fail→GREEN16/16：短坏JSON、任意哨兵、trailing JSON、相对含哨兵路径、真实私有ENOENT/EISDIR拒绝，以及私有fault preload模拟四类输入的未知read/parse异常；正常manifest成功的本地评估仍overall UNVERIFIED，合法JSON业务拒绝与argv错误分别保留原语义。EISDIR只对测试创建的空目录验证拒绝，不枚举或读取宿主资料。

最后原83+新增16完整一次：30顶层+69子项，TAP99/99、0fail/skip、0外部调用。Node精确24.15.0、同PATH/六guard阳性校准和真实隔离PyYAML6.0.3，安全YAML程序、结构检查及Node协议逐字不变（SHA89c94aafcd3fd2a222240f0cc23fd6e6c9dad57900b603d87761bc2be8e306a4）。最终实体输入摘要4b054814b1a99f74ea26885ce73778a6894e3529795f771faeb050a9f694c2d8。未重跑无关全仓或未变共享41。

每组UTC/argv/cwd/PATH/输入/exit/raw与display/metadata哈希见run-results；tracked元数据便携归一化，raw原样在.local/I05-convergence/rework-manifest-diagnostics-r1。旧4458/6a82/93c8报告/manifest和17源body未改（CURRENT仅指向本轮），旧I01/I03/raw/once保留。诊断盘点见DIAGNOSTIC-AUDIT。

主树contract已由dff53…变化至67f06a…，实际可见差异仅.openspec.baseline_sha256；I05 check与case56e396…完全相同。仅记录这项旧/新元数据观察，没有复制contract、修改canonical、扩大scope或继承新权限。无Docker/API/secret/model/source摄入、活配置/ACL/grant/台账动作；原I05剩余真实资格/生成/检索/恢复仍按原RESUME/计划承接。
