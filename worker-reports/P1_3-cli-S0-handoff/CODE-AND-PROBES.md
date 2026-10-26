# 最小 S0 CODE 差异与公共 seam 测试（待Root选择，未应用）

只触及既有 `lib/adapters/harness.js` 与对应 `test/comet-driver.test.js`；不加服务、命令菜单、CLI/provider自由配置、phase/queue/session/retry/lease账本。d4de原源码保持冻结。

## 精确接口建议

```js
// 由受保护CODE调用；不是业务JSON可选择的provider/authority。
registration = {
  ...existingFixedRegistration,
  argv: ['app-server', '--listen', 'stdio://'], // caller仍只能这3词
  profileId: 'codex-0.163-s0-initialize-only-v1',
  startPolicy: 'initialize-only'
};
```

新增唯一literal profile。profile缺席时完整保留当前已验component旧行为；该profile存在时强制initialize-only，不允许caller选择turn/start或通过begin绕过。预审deployment CODE固定实际0.163 binary/hash，未登记provider仍0启动；profile名本身不是角色/OS来源证明。

在现有registration validation之后，由同模块内部固定编译器从PROFILE72个literal及受控自有目录生成完整argv。没有 `config`/extraArgv/free-c选项，registration.env不增加可写key。准确remote-control marker只由编译器向child env加固定1，不接受caller传同名值或其它内部env。原HOME/CODEX_HOME存在性和值原样继承。

编译出的argv、固定env addition、profile数据/版本schema摘要和原registration快照必须进入该profile的registrationDigest；保持旧profile缺席时原摘要语义。实际child.spawn消费这个同一编译快照。Root创建/固定0700根与空work目录；compiler拒非本次受控路径、链接/替换、缺失公开instruction或错误SHA。源配置摘要只是漂移检测，不冒称关闭cloud/TOCTOU或native权限。

initialize请求仅此profile改为PROFILE给出的三个capabilities；固定NoMaterialData、空cwd、最多15秒。start()/begin()继续在进程/发送之前拒绝，connect并发共享原handle，ready/done/closed的current()及UNKNOWN规则不变；不放宽capture/frame/timeouts、不改默认main。

接纳/展示之前加可信S0 metadata投影：只返回静态原因、同handle/pid/真实exit/closed、握手布尔和bytes/hash；禁止把现有transport.raw/events、native stderr/error/config/auth正文传给Root模型或写出。callback异常只常量UNKNOWN；未知权限/执行/auth/connector请求一律不响应授权。init-only取消后的UNKNOWN保留，不另造“业务PASSED”。

普通Root一次CLI探针和受管Action资格分开。当前业务constructor要求原ActionBinding；若实际原action/source尚不存在，不能构造dummy min1数据来冒接业务。Root可将单次initialize观察留在普通工具探针支持层，或另审最小init-only CODE端口；本提案不擅改ActionBinding schema或生产provider。

## 本轮之后需要的有效 TDD

仍用私有真实Node stdio peer，不启动真正codex/模型；fixture与实际binary资格分开。纯编译器/公共transport seam覆盖：

| 用例 | 必须观察到的事实 |
|---|---|
| 固定profile精确编译 | expected149词argv和静态env=1原样交peer；只initialize/initialized；没有thread/turn；regDigest绑定compiled快照 |
| 原默认兼容 | 未选profile的原3词argv与旧完整语义/正负例保持 |
| env/argv/profile输入边界 | 自由-c、shell/远程listen、provider/module/role、marker caller覆盖、未知env/profile、accessor/Proxy等先于spawn非零/常量拒绝 |
| 目录/材料/来源 | 独占空work正例；链接/越界/已有冲突/公开instructions坏SHA/配置漂移/二进制变更拒绝且0启动；不覆盖不明文件 |
| marker/profile快照 | 调用后改原registration/env/profile对象不影响argv/digest；不能改startPolicy后启turn |
| 生命周期 | connect重复/并发原handle；start/begin拒绝；稳定ready握手；错id、过大/截断、EOF/timeout、UNKNOWN不复活、close前tuple漂移拒绝；沿用真实exit与原digest |
| 仅元数据输出 | peer送任意合成敏感哨兵到stderr/错误/多余字段，外部metadata无哨兵/body/path/原生stack；bytes/hash真实，异常不序列化原输入 |
| 取消/进程事实 | 只原handle取消；未知不等于进程死亡，不重连/重启；同handle真实close终态独立保存 |

Nodepeer只能证明CODE/协议边界，不能模拟“真实MCP已被关闭”。最后源对应owned/related必要一次，旧d4de与所有raw保留，交Root独立双审；本准备没有执行这组测试。

## 真实 S0 观察（本包未执行）

Root审查固定argv/profile并按现有普通CLI权限核定具体startup类别后，才创建本次probe路径、冻结实际编译结果/输入摘要，执行一次准确binary。只initialize/initialized、最多15秒，同handle清理/实际close，输出whitelist metadata。无thread/turn/auth-status/登录/token读值、无MCP/status/tool列表/连接、无网络listener、无项目材料。

真实S0仍需观察是否有未登记启动进程/环境/网络副作用、固定marker/feature gates是否有效；发现非允许路径即UNKNOWN/停止，不通过检测后UNKNOWN冒“事前工具隔离”。S0没有model请求，不能证明模型可用、正式角色/OS/source或完整20-MCP项目工具闭包。

以后S1/S2另用实际项目cwd与原action/source/工具契约重新核验。不能因18名当前可覆写，就沿用该集合开始项目turn，也不能以普通CLI认证代替控制issuer/Outline/publisher身份。
