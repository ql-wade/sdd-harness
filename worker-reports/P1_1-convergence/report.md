# P1_1 工具链收敛实施报告

状态：限定工具链资格通过；独立审查待root接纳。新profile场景验收仍0；不是完整F01/F03交付声明。

## 变更与RED/GREEN

公开seam：package-probes/probe-runtime-claims.mjs。原版真实运行只失败一项：当前host依赖检查exit0被硬编码要求为legacy exit3（02-runtime-claims-before.txt）。修复后区分当前host成功与专门的openspec-legacy-dependency-edges拒绝回放；同一公开probe exit0（13-runtime-claims-green.txt）。不修改外部C08/B08测试和其注册，不放宽其断言。

仅改本任务baseline和probe。源码准备/构建工具未发现需要实现修改的行为故障，保留原实现及断言；不为产生代码改动做无关重构。锁与六补丁摘要保持不变。

## 实际执行

- node --test test/comet-source-preparation.test.js test/comet-build.test.js：9/9通过，零跳过；包括错误摘要、路径穿越、源缓存/模式漂移等拒绝。
- 三个锁定公共npm发行物重新下载并SHA512对比registry.npmjs.org版本元数据：Comet0.4.5、TeamAI0.22.0、OpenSpec1.11.0；来源和SHA256见04-public-artifact-integrity.json。源码commit不能替代npm验证。
- Node24.15.0、项目corepack缓存pnpm10.18.3实际版本读回。TeamAI隔离实装并version成功；一次性未初始化目录status真实拒绝exit1，没有执行TeamAI工作流。
- 使用固定40MB源码归档和当前六补丁，工具tools/comet/build.mjs在全新工作树实际构建：d437093083ad4500253795fe231484c606e925b2404f958e5a7dd4fd4c11cba6，reused=false，CLI0.4.5。
- tools/comet/build.mjs --check-generated --runtime-smoke --json：三族生成物一致；4个上游测试文件255通过/2跳过，exit0；两项上游skip保持原状，不视为managed profile资格。
- 隔离OpenSpec1.11.0实际init/new change/status；当前host全局1.14.3实际version/status。两者真实status含requires且被发布npm原始requiredArtifactClosure接受。
- 历史1.3.1真实status捕获在本轮对同一发布npm函数回放仍被拒绝exit3；这是历史输入重放，未声称当前host运行1.3.1。

- 当前8项P1_1 case断言实际8/8通过、零跳过，其中集成构建验证确实再执行；命令工具输出观察记录见17-case-observation.json（不伪装成原始stdout日志）。
- 受控篡改本工作树构建的dashboard HTML后，公开校验命令真实拒绝BUILD_BASELINE_DRIFT/exit2；finally恢复完全相同字节后再次生成物校验通过，见16-*。这是实际构建缓存负例，不是缺环境作为RED。

## 精确范围与剩余问题

工具链source preparation、patched distribution、CLI兼容分开记录；角色/技能真实harness发现、Comet流程与LLMWiki/Outline/代码Wiki、平台等完整F01/F03场景留给原DAG后续任务和VERIFY。当前方法assets的旧运行调用不由本包资格自动修复。

主检出只读，所有源码/工具实装/构建缓存位于新工作树独立.sdd；没有全局工具升级/降级、服务启动或远端写。未复用旧工作树和主检出可写状态。原始构建输出已做路径脱敏；公共依赖不含私人资料。

全量npm test/scripts/check.sh不在本限定切片重复运行；外部C08 negative和B08已知失败未关闭。独立审查和整节点接纳由root处理，本工人没有修改canonical进度、DAG、contract或其它worker状态。

## 独立复核后的限定修正

四份status证据仅把临时项目根归一化为`<isolated-project>`；原始字节保留在本工作树忽略目录`.local/non-distribution/P1_1-convergence-originals/`，不进入分发或提交。18-path-normalization.json记录每份原始/脱敏摘要及归一化范围；artifact IDs、requires和兼容判定输入未改。旧beab355d/253pass和旧1/1上游兼容case均明确为历史；本轮为d437、255pass/2skip和实际status对发布npm原函数的回放。当前host观测时间绑定本轮qualified_at，2026-10-22观测另存历史。没有再次下载或全量smoke。

Root合入时对三份分发日志去除行尾空格/多余末尾空行；原字节保留在.local审计副本及工人原提交，19-whitespace-normalization.json给出原/分发摘要，语义内容和退出结果未变。当前分发manifest共41项，不将格式处理视为新的运行验证。
