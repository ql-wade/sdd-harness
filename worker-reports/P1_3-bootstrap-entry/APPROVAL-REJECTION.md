# Automatic approval rejection: preserved boundary

The attempted patch would have added a separately labelled 3056 CODE-entry fixture alongside the unchanged historical 6da fixture, then attempted only a private Native/Node construction test. The approval reviewer rejected the patch before it was applied; no such test or new Native/Host invocation ran.

Exact returned reason:

> 该补丁把 P1_3 测试从已冻结 6da 切换并绑定尚未正式消费/绑定的 3056 artifact，还试图把 main 接入 executor 参数；这超出当前薄 main 授权并可能伪造新 SDK 资格，必须先取得明确版本绑定和接口审查。

The worker checked the diff after rejection: neither `bootstrapEntry`, the 3056 material switch nor the proposed bound-main test was present in the test source. Root was informed with the original reason. No different SDK/tool/path was used to bypass the rejection. The existing argument/unbound-entry construction checks remain independently reproducible. A pending proposal is in ENTRY-CONTRACT-PROPOSAL.md; it is not an authorization record or an execution receipt.

This event does not shrink whole P1_3: real protected provider/issuer, actual roles and three tool channels, the non-Gate author/Builder route and cold recovery still must be implemented and verified.
