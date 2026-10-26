# Host 组件主检出集成检查点（尚未接纳）

候选 d4de546（生命周期）和 ab90cc2（归档后原Run上下文及bootstrap闭包）均获独立Spec与Standards限定批准。Root已把准确差异应用到主检出，未提交或接纳这九个产品/测试/装配文件；后续还应用74607cc的测试失败消息增强，不改变原预期或时限。

主检出实跑，固定Node24.15.0、原输入前后相同：

| 运行 | 结果 | 结论 |
| --- | --- | --- |
| related-public-seams / session40328 | 240/240，exit0，零跳过 | 关联组件支持 |
| repository-check / session26994 | 1164项，1162通过、2失败，exit1 | missing-manifest子例及父项；输入预检先返回OPENSPEC_INPUTS_UNVERIFIED |
| repository-diagnosis / session93429 | 1164/1164，exit0，零跳过 | 仅准确Runner子进程临时探针；63次Python均成功，不能反推原失败原因 |
| repository-final-uninstrumented / session94581 | 1164项，1161通过、3失败，exit1 | I06队列/null fixture身份查询TIMEOUT；Runner extra-FIFO初始预检PACKAGE_METADATA_UNVERIFIED及其父项 |

最终原始检查不是绿色。诊断轮绿色不能覆盖它。所有原始stdout、stderr、metadata、外部拒绝器记录保存在root-runs；输入哈希一致，不曾放宽5000ms/3s/2000ms、原断言或接受任意UNVERIFIED。

Python诊断探针只临时加入makeBuildContextFixture的准确build-plan子进程，没有全局NODE_OPTIONS。已逐字恢复，恢复回执与63次记录见python-diagnosis。另一个独立工作树的矩阵确实观察到5003.997ms ETIMEDOUT，但不是主失败同次，不能据此把主失败归因于负载或睡眠。主首次失败窗口上海10:04至10:06没有对应pmset Sleep记录。

原作者123个原始证据文件已按原manifest摘要核验并保全在author-raw；独立评审及其最小探针在reviews。candidate-preflight.json记录原候选与已应用字节。当前九文件恢复差异和SHA清单另保存在worker-reports/Root-handoff-20261026。

后继先诊断最终两类前置超时/错误，维持原预期，完成最终未插桩总检查再决定接纳。不得将组件检查、初始镜像D/E或诊断绿色计为129required/103业务场景通过。新Host/bootstrap字节尚未进入真实Runner镜像。
