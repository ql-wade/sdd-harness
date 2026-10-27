#!/usr/bin/env python3
"""P4_3 consistency check: verification-results.json vs execution-state.json.

Validates:
1. accepted node set equality (execution-state accepted_plan_nodes count vs indexed nodes)
2. every indexed accepted node has >=1 evidence pointer
3. every evidence pointer resolves on disk (repo-root relative or change-dir relative
   or ledger#event reference present in execution-ledger.jsonl)
4. layer partition covers exactly the 34 accepted nodes, no overlap
Exit 0 pass / 1 input invalid / 2 verification failed.
"""
import json
import os
import sys

REPO = "/Users/mac/Code/sdd-harness"
CHANGE = os.path.join(REPO, "openspec/changes/delivery-foundation-rearchitecture")

try:
    state = json.load(open(os.path.join(CHANGE, "execution-state.json")))
    results = json.load(open(os.path.join(CHANGE, "verification-results.json")))
except Exception as e:  # noqa: BLE001
    print(f"INPUT_INVALID: {e}")
    sys.exit(1)

failures = []

# 1. accepted set equality
state_nodes = state["node_status"]
accepted_state = {n for n, v in state_nodes.items() if str(v.get("status", "")).startswith("ACCEPTED")}
indexed = {n["node_id"] for n in results["nodes"]}
if state["accepted_plan_nodes"] != len(accepted_state):
    failures.append(f"state internal: accepted_plan_nodes={state['accepted_plan_nodes']} vs status-scan={len(accepted_state)}")
if len(indexed) != results["counts"]["accepted_plan_nodes"]:
    failures.append(f"results internal: nodes={len(indexed)} vs counts.accepted={results['counts']['accepted_plan_nodes']}")
if accepted_state != indexed:
    failures.append(f"node set diff: only-in-state={sorted(accepted_state - indexed)} only-in-index={sorted(indexed - accepted_state)}")

# 2/3. evidence pointers
ledger_text = open(os.path.join(CHANGE, "execution-ledger.jsonl")).read()
for n in results["nodes"]:
    if not n.get("evidence"):
        failures.append(f"{n['node_id']}: no evidence pointer")
        continue
    for ptr in n["evidence"]:
        if "#" in ptr:
            base, frag = ptr.split("#", 1)
            resolved_base = None
            for prefix in (REPO, CHANGE):
                if os.path.exists(os.path.join(prefix, base)):
                    resolved_base = os.path.join(prefix, base)
                    break
            if resolved_base is None:
                failures.append(f"{n['node_id']}: evidence path unresolved: {ptr}")
                continue
            if base == "execution-ledger.jsonl":
                if f'"event": "{frag}"' not in ledger_text and f'"{frag}"' not in ledger_text:
                    failures.append(f"{n['node_id']}: ledger event not found: {frag}")
            elif base == "execution-state.json" and frag.startswith("node_status."):
                node_ref = frag.split(".", 1)[1]
                if node_ref not in state["node_status"]:
                    failures.append(f"{n['node_id']}: node_status key not found: {node_ref}")
            else:
                failures.append(f"{n['node_id']}: unsupported fragment pointer: {ptr}")
            continue
        cand = [os.path.join(REPO, ptr), os.path.join(CHANGE, ptr)]
        if not any(os.path.exists(c) for c in cand):
            failures.append(f"{n['node_id']}: evidence path unresolved: {ptr}")

# 4. layer partition
layers = results["layers"]
layer_nodes = []
for k, v in layers.items():
    if isinstance(v, list):
        layer_nodes += [(k, x) for x in v]
    elif isinstance(v, dict):
        for sub, arr in v.items():
            layer_nodes += [(f"{k}/{sub}", x) for x in arr]
seen = [x for _, x in layer_nodes]
if len(seen) != len(set(seen)):
    failures.append("layer partition has duplicate node(s)")
if set(seen) != indexed:
    failures.append(f"layer partition != indexed nodes: only-layers={sorted(set(seen) - indexed)} only-index={sorted(indexed - set(seen))}")

# review conclusion presence
for n in results["nodes"]:
    if not n.get("review"):
        failures.append(f"{n['node_id']}: no independent review conclusion")

print(f"state: total={state['total_plan_nodes']} accepted={len(accepted_state)} pending={len(state['node_status']) - len(accepted_state)}")
print(f"index: nodes={len(indexed)} layers={len(layer_nodes)} gap tiers L/H/E="
      f"{len(results['gap_registry']['tier_local'])}/{len(results['gap_registry']['tier_human'])}/{len(results['gap_registry']['tier_external'])}")
if failures:
    print("VERIFICATION_FAILED:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(2)
print("CONSISTENCY_PASS: accepted set equal, every accepted node has >=1 resolvable evidence pointer and review conclusion, layer partition exact.")
