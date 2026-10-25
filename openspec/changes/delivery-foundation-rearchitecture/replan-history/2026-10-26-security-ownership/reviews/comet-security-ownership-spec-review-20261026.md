# Spec轴：P1_1安全回移所有权草案

**结论：PASS，仅支持这份元数据所有权修订。无阻断项；不批准补丁内容、生产pin、profile启用或新发行验收。**

审查输入：`.local/comet-reset/security-ownership-amendment/README.md`、`candidate-manifest.json`（SHA256 `5254a625813b82a76541a0f6ce7e97e09409b83df43a9ebbb427269a43dea377`）及 candidate 六份计划文件。六份原始/候选文件的实际 SHA 均与 manifest 对应记录一致；另核 candidate 中未变的 proposal/design/spec/config 与主文件逐字节相同。主冻结计划未被本审查修改。

## 精确差异及级联

- `tasks.md` 只在原 P1_1 的 Files/Owns 增加 `integrations/comet/patches/0004-upstream-security-backports.patch` 与 `test/comet-security-backports.test.js`。移除这两项后任务正文与原文完全对应，未改步骤、checkbox、依赖或验收ID。
- DAG 只扩展 P1_1.owns；移除两条新增项后整个 JSON 与原 DAG 相等，包括 waves、preconditions、conditional 标记和所有完成/未验标记。
- contract 只改变 OpenSpec baseline 摘要；spec-baseline 只改变 tasks 源摘要。分别还原该单字段后，与原 JSON 完全相等。
- drift-lock 只更新对应摘要、P1_1 allowed_paths，以及追加一条明确禁止新流程/权限/生产pin且禁止继承旧green的修订记录。还原这些限定项后与原 lock 完全相等。
- architecture 原字节不变。0001 方法、0002/0003 业务门/后归档职责没有被这份草案改写；新独立0004的方向与原单主控架构兼容。

独立用 guard 源码中的原样 checkbox normalizer 复算：tasks 从 `618d3431…` 到 `8b91e35e764ae52b5628507174d7aadf8cff2927c3a9fddebe62771360fa84e5`；candidate baseline 为 `95a0be3c…`，contract 为 `41fc7da2…`，lock 引用均一致。适用性报告引用 SHA `f28bd366fe3eefca5eb3b6cbbab2008b30c6426b42a24c99538e70b501443100` 也与实际报告匹配。

## 原义务保持

独立计数：**39节点、69工作包、130检查、104场景**；当前 scope 仍为129检查/103场景，只有既有人类F10处置，V_F10继续NOT-EXERCISED，不能任意排除其它缺失/失败。全部检查、completion predicate、接口、construction 例外和依赖语义逐字段不变，没有隐藏豁免。P1_4适用性/平台证明、原宿主/Runner及I02装配隔离义务仍保留，新增Node测试不增加验收分母或替代这些义务。

独立只读运行现有 `plan_guard.py` 对 shadow bundle 的 full 模式：**exit0，valid:true，handoff_ready:true，issues:[]**。这仅为结构结果，不是运行/安全/交付ready。

后续0004必须限定已审的0.4.5 Hook/Eval/Vite安全回移，不借补丁载体引入0.5 Runtime/application、第二主控或新权限。真正新源/补丁pin及其新fingerprint仍须独立内容审查、完整链应用/重建、生成一致性、当前runtime/安全回归与相关Runner验证；旧PASS/旧票只能作历史，不能因所有权草案通过而继承。此阶段没有修改实际upstream lock或生产pin。

本轴只读比较与结构校验；未下载、运行模型/服务、取凭据或修改源码/锁/台账，没有新增Goal/工人或扩展设计。
