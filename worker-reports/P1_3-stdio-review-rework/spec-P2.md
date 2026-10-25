# P1_3 native stdio transport：独立 Spec 审查

结论：**REQUEST_CHANGES，一项实证 P2 当前性回传缺口。** 本报告不把它称为已伪造业务PASS；候选始终保持managedClosureEligible/runtimeQualified=false。缺口在transport所声明的当前tuple校验窗口，不是生产SourceReader或OS资格已经交付。

候选e361f097b09276288b6dc65db82d3e66d4374c12；base1c66edf4237b3b5039ce5b1e63f84401e2c785d0。tree `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness` 前后tracked clean；只读审两份源码/测试、报告与本地0.163已采集schema，不依赖Standards结果。

## [P2] turn/completed到原进程close之间的context变化未在最终回传复核

位置 `lib/adapters/harness.js:385–389`。turn/completed通知处调用current()，工具执行/工具reply也复核，但close分支在settle operation.done与closed之前直接写OBSERVED_TERMINAL，不再次检查currentContext。于是最后通知后、实际进程关闭前的原ActionBinding漂移被遗漏。

已做一次本地数据型反例：复用原notifications peer的完整initialize/thread/turn、普通telemetry、dynamic item/tool request/真实文件IO/reply和turn completed；只在该私有peer增加正常关闭屏障。公共observe已见protocolComplete=true且process.closed=false时，把受保护currentContext.actionBinding.epoch从1改为2，再释放同一peer正常exit0。实际operation.done返回：

```json
{"status":"OBSERVED_TERMINAL","reason":null,"oldEpoch":1,"currentEpoch":2,"process":{"pid":19796,"exitCode":0,"signal":null,"closed":true},"protocolComplete":true,"managedClosureEligible":false,"runtimeQualified":false}
```

预期最终回传应标明旧绑定已UNVERIFIED/UNKNOWN的安全断言真实失败（1fail/exit1），不是缺依赖、超时、0匹配或真实模型调用。Node peer已实际close；失败后finally仍只清理自己fixture，未留进程。完整派生test、实际peer、wire、stdout/stderr/proof与UTC输入摘要保留。没有修改候选、原协议消息或已有oracle。

最小修复方向：回传最终done/closed观测前再次校验原tuple，失败保持粘性UNKNOWN/stale；真实进程exit0/closed和已发生turn历史仍如实保留，不能改写成失败进程、隐式重连/重启或重跑副作用。后续Native最终接纳仍必须独立复验；该上层义务不代替本transport已经声明的回传前校验。已终止后的历史观测也不应被宣称自动获得新epoch授权。

## 独立窄检查与源码核对

对原测试逐字节tmp副本执行（依赖链接仅读取，不是OS只读挂载证明）：

```sh
node --test --test-reporter=tap '--test-name-pattern=native schema ordinary lifecycle|one RPC id|exact in-flight duplicates|native timeout|changed current input after tool|UTF8 character' test/comet-driver.test.js
```

固定Node24.15.0，**8/8、0fail/0skip、exit0**；含普通通知及早到tool顺序、RPC id换call拒绝、真实inflight去重、timeout仍alive/原handle cancel、tool执行后漂移抑制reply及UTF8跨写。没有重复全76/52。既有测试8绿不覆盖上述实际close窗口。10265明确终态exit0；新增反例同步exec已终态，测试exit1、外层记录器exit0仅表示取证完成。

其余有限构造与要求一致：固定regular executable/hash与精确app-server --listen stdio://，环境字段白名单、原HOME/CODEX_HOME不改绑；context由固定CODE回读而不是重算合法output；run/execution与thread/turn/call/RPC绑定、inflight/late replay区分、JSON重复键/UTF8/size有界；UNKNOWN不是closed，observe/cancel仅原handle且不重连。原普通lifecycle schema字段及早到响应路径有实际peer检查，不能据schema文件或fake happy-peer声称真实app-server已可用。执行/审批/MCP/协作等非获准协议面拒绝不等于能撤回此前真实builtin副作用，真实配置/工具无旁路仍未验。

原调用只是单连接协议pending/call观测，没有新业务phase/sessionledger/queue或业务签名；turn完成/client0不返回Gate verdict。实际SourceReader、工具路径/用途权限、I02 interactive/workerframe、canonical输出安装、模型身份/隔离和真实消费者/恢复仍明确未提供；任何真实CLI启动仍需单独授权和资格，不能借本构造进行认证或模型调用。

## 输入、原始证据与保全

harness SHA a4236d094cc993d4b88ec6b86e89b45cc40196d5ca5da20ab4bdc4b0a719de75；test SHA0d9ffd8a7cdeca3371198b242765d87fd0f27b6dc677865218a6c81adf7827fe。原manifest SHA7b1470cce03cb603a6845ce1fa627939532cd514365944cbf69715384895ed47：49tracked/92raw及42组raw/display逐项hash匹配。原75/76的late replay、此前准备/peer cleanup失败仍保留，不改写成当前通过。

独立证据根 `/private/tmp/P1_3-stdio-spec-l7yzh6tm/`：metadata.json记录8项命令/输入/UTC/exit，stdout SHA768c621d86176ea59cc6f0c6bc70b6685934b29de57f37dedac76d183e3bd0b1；close-context-metadata.json记录反例，stdout SHA6aac4479b84dfd54f3dad964e1c09d3913a61c6bce724eb961781b9befa32321。反例在mirror/test/close-context.test.js；close-context-peer.mjs、close-context-wire.jsonl、close-context-proof.json保留实际原字节。

实际外部guard调用0；没有真实codex/Claude/ZCode、auth/model/MCP/Docker/API、下载、全局配置或源码/锁/计划写，未派agent。原候选输入前后不变，业务接受增量0。修复交原作者和Root独立复验，不能把此组件代替最终129/103。

独立核对非material静态输入数：28。
审查 UTC：2026-10-25T23:16:36.977577+00:00
