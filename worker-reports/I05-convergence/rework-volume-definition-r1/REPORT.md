# I05 P2 返工：具名卷定义闭合

基点93c8b40b0bf23930fb689739cd030972ca81c0c4，沿原I05，只改code-knowledge.mjs、原测试和本轮报告。候选待独立双审；whole I05仍UNVERIFIED，不扩部署/生成。

原门只核验服务挂载字符串，未核准顶层同名卷定义。Standards反例把codewiki-data配置为local driver + bind driver_opts/device，validate却exit0。公开CLI真实RED确认20个定义负例均漏验、固定空定义正例通过。修复后只有一个字面volumes根、两条唯一codewiki-data:/codewiki-logs:空定义可接受；driver/driver_opts/device/external/name、别名、流式/嵌套配置、缺失/额外/重复定义拒绝。服务层原绝对/相对/伪named/long/flow bind门保留。

收口自检另复现quoted/explicit重复volumes根与include重定向三个同根入口，RED3个子项失败后，将根节点限定为当前模板字面services:/volumes:/networks:，不引入通用YAML parser或新配置选项。合法但超出当前固定模板的别名/include/其它根字段也受控拒绝，须由后续显式模板变更重新评审。

固定NVM Node24.15.0与同PATH（守卫优先），六个fake CLI/fetch阳性控制通过。五公开路径对两个卷的16组重定向负例均返回exit2/结构化HOST_MOUNT_FORBIDDEN；另外7个定义/根负例及原空定义正例保留。最终22个顶层检查、24个新增子项，TAP46/46、0fail/skip，0外部调用。中间43/43及二次RED/GREEN原样保留。registry/secret-ref源未变，按原控制器要求不机械复跑旧41或无关全仓。

每组UTC/argv/cwd/PATH/实体输入SHA/exit和raw/display摘要见run-results。tracked自产元数据便携归一化，raw原样保存在.local/I05-convergence/rework-volume-definition-r1。没有运行Docker、读取/etc或其它所示路径、调用API/模型、读取secret、启动服务或改变grant/ACL/canonical。

93c8旧报告（除明确允许更新的CURRENT指针）逐字保留，旧66项manifest文件SHA仍40ef6d40ff19bcbdd54859e65f4b1822eb87647b7a3980bc394377fdb286ef13，17份旧公共源码body摘要不变。CURRENT仅指向本轮候选，不继承旧通过为当前资源资格。源/provider/MCP/真实生成与恢复等未完范围继续按原RESUME/RUNTIME-QUALIFICATION-PLAN在同I05承接。
