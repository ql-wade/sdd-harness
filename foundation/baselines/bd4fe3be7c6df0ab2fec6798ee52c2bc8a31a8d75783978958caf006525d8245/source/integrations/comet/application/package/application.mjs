import { createClassicApplication as factory } from '@rpamis/comet/applications/classic';
import { createBindings } from './bindings.mjs';
const composition = {"extensions":[{"afterStep":"full.open.evidence","artifactRefs":[".sdd/delivery/gates/r/receipt-bundle.json"],"id":"requirements-open","skillId":"grill-me","validator":{"id":"sdd.delivery.gate.r","version":"1"}},{"afterStep":"full.design.evidence","artifactRefs":[".sdd/delivery/gates/a/receipt-bundle.json"],"id":"architecture-consensus","skillId":"multi-agent-consensus-review","validator":{"id":"sdd.delivery.gate.a","version":"1"}},{"afterStep":"full.design.evidence","artifactRefs":[".sdd/delivery/gates/t/receipt-bundle.json"],"id":"test-design-review","skillId":"test-authoring","validator":{"id":"sdd.delivery.gate.t","version":"1"}},{"afterStep":"full.build.plan.evidence","artifactRefs":[".sdd/delivery/gates/p/receipt-bundle.json"],"id":"build-plan-unique","skillId":"claude-parallel-tdd-planner","validator":{"id":"sdd.delivery.gate.p","version":"1"}},{"afterStep":"full.verify.check.evidence","artifactRefs":[".sdd/delivery/gates/v/receipt-bundle.json"],"id":"verify-whitebox","skillId":"whitebox-verify","validator":{"id":"sdd.delivery.gate.v","version":"1"}},{"afterStep":"full.verify.check.evidence","artifactRefs":[".sdd/delivery/gates/kp/receipt-bundle.json"],"id":"knowledge-project-closeout","skillId":"openspec-lifecycle-guard","validator":{"id":"sdd.delivery.gate.kp","version":"1"}}],"kind":"classic","order":["requirements-open","architecture-consensus","test-design-review","build-plan-unique","verify-whitebox","knowledge-project-closeout"],"profile":"full","replacements":[{"skillId":"comet-open-full-open","stepId":"full.open"},{"skillId":"grill-me-full-design-handoff","stepId":"full.design.handoff"},{"skillId":"grill-me-full-design-document","stepId":"full.design.document"},{"skillId":"comet-build-full-build-configure","stepId":"full.build.configure"},{"skillId":"claude-parallel-tdd-planner-full-build-plan","stepId":"full.build.plan"},{"skillId":"tdd-full-build-execute","stepId":"full.build.execute"},{"skillId":"comet-verify-full-verify-run","stepId":"full.verify.run"},{"skillId":"comet-archive-full-archive-prepare","stepId":"full.archive.prepare"},{"skillId":"comet-archive-full-archive-deliver","stepId":"full.archive.deliver"}]};
export async function createApplication(context) {
  const implementations = await createBindings(context);
  for (const key of Object.keys(implementations)) if (!['validators','executors'].includes(key)) throw new Error('实现集合不能覆盖领域流程或转移处理器：'+key);
  for (const key of ['validators','executors']) {
    const identities = new Set();
    for (const entry of implementations[key] ?? []) {
      const identity = key === 'validators' ? entry.id+'@'+entry.version : entry.id;
      if (!entry.id || (key === 'validators' && (!entry.version || typeof entry.validate !== 'function')) || identities.has(identity)) throw new Error('重复或无效实现身份：'+identity);
      identities.add(identity);
    }
  }
  const resolveValidator = (ref) => { const result = implementations.validators?.find(entry => entry.id === ref.id && entry.version === ref.version); if (!result) throw new Error('未注册方案要求的验证器：'+ref.id+'@'+ref.version); return result; };
  const extensions = composition.extensions.map(extension => ({...extension, validator:resolveValidator(extension.validator)}));
  return factory(context, {...composition, extensions, executors:implementations.executors});
}
