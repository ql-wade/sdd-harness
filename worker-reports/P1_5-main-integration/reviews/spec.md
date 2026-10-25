# P1_5 probe repair — independent Spec review

结论：限定范围 PASS，阻断项 0。仅支持测试及探针修复，不签 whole P1_5、C01–C08 真实旅程、方法执行、Runner/OS 或知识资格。

## 固定输入

- Candidate: `aad310f1122c0edf5408b5e524a7155b5850fbb0`; base: `2d2506fb3b355ebd1ad53cc3aea2a64905df23d9`。
- Tree: `/Volumes/mac-extend/codex/worktrees/comet-method-profile/sdd-harness`；审查前后 tracked clean。
- Evidence index SHA256: `6f95e8b375bf78a615a3f992fa0ba257984e6d7ce9e191d3de0d4c30b655001b`。
- 规格边界：原 tasks.md P1_5 / 1.5.a–b，及 Root 本轮限定“两项回归修复”。使用 code-review 的独立 Spec 轴，不启动额外审查者。

## 核对结果

1. C08 历史输入是真实原文件 538 bytes，SHA256 `07e4c35d6ba821b7fc2b9810c0e14e67c6fdb126202a6db98c9b3a18c3903357`，与 base Git blob 一致。当前 Core6da 的原 requiredArtifactClosure 拒绝缺 requires；未把现宿主伪装成 1.3.1 或声称重新执行历史 CLI。
2. 当前宿主 1.14.3 与隔离 1.11.0 均实际 version/status，原 predicate 接受真实闭包；四种坏 requires、未知依赖、循环依赖及缺 applyRequires 继续拒绝。没有 skip 或全局降级，临时工程及临时 HOME 由测试清理。
3. 方法源不是任意重 hash 自批：MF SHA `8030fd62…e46d2e` 与批准提交 `3f69f9c5…` 的 Git blob 相等。11 方法全部 245 文件逐项与 MF、当前、base Git blob、sealed2aba 字节相等。测试固定 source-upgrades 与 sealed manifest 摘要；摘要算法为完整 hash+方法名/相对路径行排序、LF 连接、无末尾 LF，与批准算法一致。非 SKILL dotfile 修改且自填新摘要、缺 dotfile、额外文件均拒绝，恢复后接受。
4. diff 未修改方法正文、SDK、锁、合同、任务/DAG 或原 delivery-cases/1_5.mjs。C01–C07 原断言保留；本次增加 C08 分层观察和源漂移反例。README 明确 SOURCE_PIN_ONLY/NOT_EXECUTED/NOT_VERIFIED，没有扩大资格。
5. 独立核 31 项 raw/display 的 size/SHA 全匹配；3 份历史文件逐字节等于 base Git；历史 RED 与 setup-only 错误没有冒充当前成功。

## 独立执行

命令：`PATH=/Users/mac/.nvm/versions/node/v24.15.0/bin:$PATH /Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap test/classic-integration.test.js`

cwd 为上述 worker tree；原工具句柄 93026 明确终态 exit0：24 tests / 24 pass / 0 fail / 0 skip，1743.821917 ms。独立只读证据核对句柄 25583 终态 exit0：31 raw/display、3 originals、245 approved/base/current/sealed files、538B legacy input 全匹配。未 Docker/model/API/secret/new-package 操作。

未验：真实 C07 lifecycle、真实独立方法/角色、OS/ACL、Kp/Kt 远端执行和整体交付；现有组件/协议测试的成功不能升级这些义务。最终串行接纳归 Root。本轮未发现需先修正的 Spec 偏离。

审查记录 UTC：2026-10-25T18:45:58.011100+00:00
