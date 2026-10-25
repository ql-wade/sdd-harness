# P1_3 stdio close R3：独立 Spec 复审

结论：**APPROVE_CLOSE_P2_REPAIR_CONSTRUCTION_ONLY**，原close窗口P2在该组件范围关闭；本次未发现新Spec阻断。不签wholeP1_3、生产provider/source、真实CLI/模型/MCP、角色/OS/I02/canonical输出或最终129/103资格。

候选8b0f937fde6209a31175f4a167ffecbf43185919；链1c66edf→e361f09→62011e0→8b0f937。tree `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness` 前后tracked clean。未依赖Standards结论，独立审实际源码/新测试、原P2与失败保全材料并运行当前窄边界。

## 原缺口与修复

e361在turn/completed已检查后、真实close前epoch1→2仍返回OBSERVED_TERMINAL。现在close回调先如实记录ended/exitCode/signal，再在最终done/closed快照前调用current()；失败进入粘性UNKNOWN/NATIVE_CONTEXT_STALE。它没有覆盖原contextDigest、换绑新epoch或把真实exit0说成失败进程。已UNKNOWN的timeout reason也不被后来的恢复/close重写。

8b0的产品harness与62011逐字节相同（SHA6e4439c298e5d269a38bc269140eb4076f2e27ea4c78acc639bed71d83c0b8eb）；仅替换新close测试的host-watch依赖。e361已有76义务的原测试字节仍是当前文件完整前缀，未删除或改原oracle。

## 独立实际复验

固定Node24.15.0，原测试逐字节临时副本及读取依赖链接，阻断真实外部工具：

```sh
node --test --test-reporter=tap '--test-name-pattern=native close rechecks' test/comet-driver.test.js
```

实际 **5tests/5pass/0fail/0skip/0cancel，exit0**，2087.4705ms；只跑该窄组，未重复81/52。稳定、epoch变化、current callback抛错和timeout后恢复四子例及父测试全部通过。外部guard调用0，输入前后一致。

测试不是先await close再改输入：它用public observe(protocolComplete)和peer实际stdin EOF marker确认turn/completed已经消费，同时明确closed=false、kill(pid,0)成功且真实声明输出存在；这时才修改epoch或callback，再写release让原peer正常退出。条件轮询与有界deadline不把固定睡眠当成功证据，不用fs.watch或修改系统limit。缺marker/不能到达屏障会失败；peer安全deadline会exit91，不伪造成功。

稳定例最终OBSERVED_TERMINAL；epoch/throw例done及closed均UNKNOWN/NATIVE_CONTEXT_STALE，仍是相同handle/digest、真实exit0/signalnull/closedtrue及completed turn历史。timeout例done先记录alive/UNKNOWN，closed随后记录真实正常结束，reason仍NATIVE_TIMEOUT_UNKNOWN。恢复旧context后start返回同一operation，UNKNOWN不复活、不新增工具副作用。稳定例关闭后再改变当前context，observe保持历史终态，后续Native admission仍独立复验，符合历史事实与当前资格的分层。

## 证据与边界

独立UTC2026-10-25T23:38:25.786533Z至23:38:27.912052Z，句柄80127明确终态exit0，无已知未关闭peer。原始argv/cwd/输入/退出和stdout/stderr在 `/private/tmp/P1_3-stdio-spec-r3-zvuh0a8z/metadata.json`；stdout SHA c6420d87bbf9926aac74a1eddcbcff73449507311d49d0b4b22d53d2c9501d19，stderr为空。临时测试副本SHA7933f916a113d7bf273859e6e9c6b7fc1e1ea24a7838bb7bad29a623e8a4890e与当前原文件相同。

原R3 manifest SHA60c3d00353d6285b03092c335dc0a79fbc1aa3203bb319966c748f4cc714c1f1：27tracked/34raw及14组raw/display逐项hash匹配，结束再核无漂移；inputDigest16eaacbe1759e42074f4d1e4658ebb7ed289b9b8ce44da049100b40084f53611保持。原R2普通watch也EMFILE的SETUP阻断未被覆盖或改作行为RED；R3旧e361负控5total/2pass/3fail保留，只有epoch/throw两子例和父汇总失败，不冒作3条独立缺陷。作者81/81是作者必要回归，不替代本轴5项或Root主检出复跑。

没有真实codex/Claude/ZCode、auth/model/MCP/Docker/API、网络/包安装、全局设置或候选/Root锁/计划写，未派agent。修复只是CODE组件的最终当前性窗口；原SourceReader、权限/工具通道、物理隔离、实际模型与消费者/同Run恢复义务仍UNVERIFIED。Root两轴与主相关/全仓后才可串行接纳该组件，业务接受增量0。

审查 UTC：2026-10-25T23:39:23.514416+00:00
独立metadata SHA256：`2b66ceed563301f40dd38e166125dafe7ccea65b89eeb0a2311843c956124f28`。
