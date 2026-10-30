import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This diagnostic cannot authenticate a reviewer or source until the real host is wired.
export function inspectConstructionReadiness({root, mode, consumer} = {}) {
  const refusal = (reason, exit = 2, extra = {}) => ({verdict:'NOT-EXERCISED', scope:'component/preflight', managedClosureEligible:false, reason, exit, ...extra});
  if (!((mode === 'construction' && consumer === 'P1_3') || (mode === 'preverify' && consumer === 'VERIFY'))) {
    return refusal('MODE_CONSUMER_MISMATCH', 1);
  }
  try {
    const base=path.resolve(root);
    const dir=path.join(base,'openspec/changes/delivery-foundation-rearchitecture');
    const contractBytes=fs.readFileSync(path.join(dir,'execution-contract.json'));
    const lock=JSON.parse(fs.readFileSync(path.join(dir,'drift-lock.json'),'utf8'));
    const contractHash=crypto.createHash('sha256').update(contractBytes).digest('hex');
    if(lock.execution_contract_sha256!==contractHash) return refusal('CONTRACT_DRIFT');
    const contract=JSON.parse(contractBytes);
    if (mode === 'construction') {
      if(!contract.dependency_readiness?.limited_artifact_edges?.some(edge=>edge.task==='P1_3' && edge.dependency==='P2_4')) return refusal('CONSTRUCTION_EDGE_NOT_REGISTERED');
      const manifest=path.join(base,'worker-reports/P2_4-construction-manifest.json');
      if(!fs.existsSync(manifest)) return refusal('CONSTRUCTION_MANIFEST_MISSING');
      return refusal('PROTECTED_CONSTRUCTION_VERIFIER_UNAVAILABLE');
    }
    const bindings=contract.repair_obligation_bindings;
    const ids=contract.repair_obligation_closure?.atomic_assertion_ids;
    if(!Array.isArray(bindings)||!Array.isArray(ids)||ids.length!==67||new Set(ids).size!==ids.length) return refusal('ASSERTION_REGISTRY_INVALID');
    const assertions=bindings.flatMap(binding=>Array.isArray(binding?.assertions)?binding.assertions:[]);
    if(assertions.length!==67 || new Set(assertions.map(item=>item?.id)).size!==67 || assertions.some(item=>!ids.includes(item?.id))) return refusal('ASSERTION_REGISTRY_INVALID');
    const pending=assertions.filter(item=>item?.registration!=='REGISTERED').length;
    if(pending) return refusal('ASSERTION_REGISTRATION_INCOMPLETE',2,{pending});
    return refusal('PROTECTED_PREVERIFY_VERIFIER_UNAVAILABLE');
  } catch { return refusal('PRECHECK_INPUT_UNAVAILABLE'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.length!==4 || args[0]!=='--mode' || args[2]!=='--consumer') {
    console.log(JSON.stringify({verdict:'NOT-EXERCISED',scope:'component/preflight',managedClosureEligible:false,reason:'INVALID_ARGUMENTS'}));
    process.exitCode=1;
  } else {
    const result=inspectConstructionReadiness({root:process.cwd(),mode:args[1],consumer:args[3]});
    console.log(JSON.stringify(result));process.exitCode=result.exit;
  }
}
