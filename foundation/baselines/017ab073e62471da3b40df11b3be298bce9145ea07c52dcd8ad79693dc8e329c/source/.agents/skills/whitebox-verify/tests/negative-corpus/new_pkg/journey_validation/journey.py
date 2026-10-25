from __future__ import annotations

import json
import posixpath
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from .artifacts import (
    payload,
    require_case_scope,
    require_component_binding,
    require_correlation,
    require_hop_scope,
    require_journey_scope,
    require_types,
)
from .common import (
    Artifact,
    DIMENSIONS,
    RunContext,
    artifact_hashes,
    authority_satisfied,
    canonical_digest,
    is_concrete_text,
    is_browser_action,
    is_dom_assertion,
    is_network_assertion,
    is_test_assertion,
    is_text,
    require_bool,
    require_independent,
    require_list,
    require_refs,
    sha256_file,
    require_text,
    require_text_list,
)


VALID_TRANSPORTS = {
    "module",
    "http/rpc",
    "message/event",
    "db/read-model",
    "cache/index",
    "object/artifact",
    "browser",
}
VALID_SCOPES = {"first_party", "external", "user", "infrastructure"}
VALID_AUTHORITIES = {"unit", "component", "contract", "integration", "real-stack", "browser/ux"}
VALID_CONTRACT_MODES = {
    "consumer-provider", "message-schema", "storage-schema", "native-contract"
}
VALID_READBACK_QUERY_TYPES = {
    "database", "http-read-model", "event-store", "object-store", "cache-index", "cli"
}
ASYNC_RISKS = {"retry", "duplicate", "idempotency", "ordering", "timeout", "replay", "dlq"}
DATA_TRANSPORTS = {"db/read-model", "cache/index", "object/artifact"}
PROHIBITED_NA = {"out of scope", "not requested", "no time", "probably unaffected"}
DIMENSION_RESULT_TYPES = {
    "A": {"runner-report", "readback-report", "browser-report"},
    "B": {"browser-report"},
    "C": {"browser-report", "accessibility-report"},
    "D": {"runner-report", "readback-report", "trace", "raw-log"},
    "E": {"runner-report", "readback-report", "browser-report", "trace"},
    "F": {"runner-report", "contract-report", "trace", "readback-report", "browser-report"},
    "G": {"runner-report", "trace", "raw-log"},
    "H": {"runner-report", "trace", "raw-log", "readback-report"},
    "I": {"runner-report", "contract-report", "ci-report", "provenance-report"},
    "J": {"runner-report", "ci-report", "command-report"},
}


@dataclass
class CaseState:
    definitions: dict[str, dict[str, Any]] = field(default_factory=dict)
    correlations: dict[str, str] = field(default_factory=dict)
    passing_cases: set[str] = field(default_factory=set)
    passing_hops: set[str] = field(default_factory=set)
    risks_by_hop: dict[str, set[str]] = field(default_factory=dict)
    runtime_refs: set[str] = field(default_factory=set)
    runner_ids: set[str] = field(default_factory=set)
    runner_ids_by_case: dict[str, set[str]] = field(default_factory=dict)
    path_projection: list[dict[str, Any]] = field(default_factory=list)
    case_projection: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class HopState:
    mandatory_ids: set[str] = field(default_factory=set)
    expected_ids: set[str] = field(default_factory=set)
    transports: set[str] = field(default_factory=set)
    risks: set[str] = field(default_factory=set)
    runtime_refs: set[str] = field(default_factory=set)
    projection: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class JourneyResult:
    journey_id: str | None
    correlations: set[str]
    runtime_refs: set[str]
    runner_ids: set[str]
    case_ids: set[str]
    hop_ids: set[str]
    projection: dict[str, Any]


def _validate_dimensions(
    journey: dict[str, Any], path: str, journey_id: str | None,
    case_state: CaseState, hop_state: HopState, run: RunContext,
    catalog: dict[str, Artifact], errors: list[str]
) -> dict[str, str]:
    value = journey.get("dimensions")
    if not isinstance(value, dict):
        errors.append(f"{path}.dimensions: required object with A-J")
        return {}
    statuses: dict[str, str] = {}
    for dimension in DIMENSIONS:
        item_path = f"{path}.dimensions.{dimension}"
        item = value.get(dimension)
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        status = item.get("status")
        if status not in {"pass", "n_a"}:
            errors.append(f"{item_path}.status: must be 'pass' or 'n_a'")
            continue
        statuses[dimension] = status
        refs = require_refs(item, "evidence", item_path, errors)
        require_types(set(refs), set(type_.artifact_type for type_ in catalog.values()), catalog, item_path, errors)
        require_journey_scope(set(refs), journey_id, catalog, item_path, errors)
        if status == "pass":
            required_cases_list = require_text_list(item, "required_case_ids", item_path, errors)
            required_hops_list = require_text_list(item, "required_hop_ids", item_path, errors)
            required_cases = set(required_cases_list)
            required_hops = set(required_hops_list)
            required_authority = require_text(item, "required_authority", item_path, errors)
            test_obligations = require_text_list(item, "test_obligations", item_path, errors)
            if any(not is_test_assertion(obligation, dimension) for obligation in test_obligations):
                errors.append(
                    f"{item_path}.test_obligations must be a canonical machine-readable test assertion"
                )
            if len(required_cases) != len(required_cases_list):
                errors.append(f"{item_path}.required_case_ids: duplicate Case IDs are forbidden")
            if len(required_hops) != len(required_hops_list):
                errors.append(f"{item_path}.required_hop_ids: duplicate Hop IDs are forbidden")
            unknown_cases = required_cases - set(case_state.definitions)
            unknown_hops = required_hops - hop_state.expected_ids
            if unknown_cases:
                errors.append(f"{item_path}: unknown required Cases {', '.join(sorted(unknown_cases))}")
            if unknown_hops:
                errors.append(f"{item_path}: unknown required Hops {', '.join(sorted(unknown_hops))}")
            missing_passing_cases = required_cases - case_state.passing_cases
            if missing_passing_cases:
                errors.append(
                    f"{item_path}: required Cases are not passing "
                    f"{', '.join(sorted(missing_passing_cases))}"
                )
            if required_authority not in VALID_AUTHORITIES:
                errors.append(f"{item_path}.required_authority: unsupported authority")
            actual_types = {catalog[ref].artifact_type for ref in refs if ref in catalog}
            if not (actual_types & DIMENSION_RESULT_TYPES[dimension]):
                errors.append(
                    f"{item_path}: dimension {dimension} pass evidence has no executable result authority"
                )
            clean_refs: list[str] = []
            obligation_mismatch = False
            for ref in refs:
                artifact = catalog.get(ref)
                if artifact is None or artifact.artifact_type not in DIMENSION_RESULT_TYPES[dimension]:
                    continue
                report = artifact.payload
                results = report.get("dimension_results") if isinstance(report, dict) else None
                result = results.get(dimension) if isinstance(results, dict) else None
                if not isinstance(result, dict) or result.get("status") != "pass":
                    continue
                observed_obligations = result.get("test_obligations")
                if (
                    not isinstance(observed_obligations, list)
                    or any(not is_text(obligation) for obligation in observed_obligations)
                    or sorted(observed_obligations) != sorted(test_obligations)
                ):
                    obligation_mismatch = True
                    continue
                commands = [
                    command for command in run.commands.values()
                    if (ref in command.outputs or ref in command.evidence)
                    and command.phase != "red"
                    and command.expected == "pass"
                    and command.exit_code == 0
                ]
                if not commands:
                    continue
                if not (artifact.case_ids & case_state.passing_cases):
                    continue
                if dimension not in {"I", "J"} and not (artifact.hop_ids & hop_state.expected_ids):
                    continue
                clean_refs.append(ref)
            if obligation_mismatch:
                errors.append(
                    f"{item_path}: dimension {dimension} result does not match frozen test obligations"
                )
            if not clean_refs:
                errors.append(
                    f"{item_path}: dimension {dimension} pass evidence lacks a clean non-RED result "
                    "with an explicit dimension result and matching Case/Hop scope"
                )
            clean_artifacts = [catalog[ref] for ref in clean_refs if ref in catalog]
            covered_cases = set().union(*(artifact.case_ids for artifact in clean_artifacts)) if clean_artifacts else set()
            covered_hops = set().union(*(artifact.hop_ids for artifact in clean_artifacts)) if clean_artifacts else set()
            if required_cases - covered_cases:
                errors.append(f"{item_path}: clean dimension evidence misses required Case scope")
            if required_hops - covered_hops:
                errors.append(f"{item_path}: clean dimension evidence misses required Hop scope")
            authorities = {
                report.authority for report in run.runners.values()
                if report.evidence & set(clean_refs)
            }
            if any(artifact.artifact_type == "browser-report" for artifact in clean_artifacts):
                authorities.add("browser/ux")
            if any(artifact.artifact_type == "contract-report" for artifact in clean_artifacts):
                authorities.add("contract")
            if required_authority and not authority_satisfied(required_authority, authorities):
                errors.append(
                    f"{item_path}: clean dimension evidence does not satisfy required authority "
                    f"'{required_authority}'"
                )
        if status == "n_a":
            reason = require_text(item, "reason", item_path, errors)
            if reason and any(phrase in reason.lower() for phrase in PROHIBITED_NA):
                errors.append(f"{item_path}.reason: generic scope/time rationale is forbidden")
    return statuses


def _validate_doubles(
    journey: dict[str, Any], path: str, run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    doubles: dict[str, str] = {}
    projection: list[dict[str, Any]] = []
    for index, item in enumerate(require_list(journey, "test_doubles", path, errors, allow_empty=True)):
        item_path = f"{path}.test_doubles[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        double_id = require_text(item, "double_id", item_path, errors)
        name = require_text(item, "name", item_path, errors)
        boundary = require_text(item, "boundary", item_path, errors)
        reason = require_text(item, "reason", item_path, errors)
        contract_refs = set(require_refs(item, "contract_evidence", item_path, errors, allow_empty=True))
        if boundary not in {"external", "first_party"}:
            errors.append(f"{item_path}.boundary: must be external or first_party")
        if boundary == "first_party":
            errors.append(f"{item_path}.boundary: first-party doubles cannot appear in a closing Journey ledger")
        if boundary == "external":
            if not contract_refs:
                errors.append(f"{item_path}.contract_evidence: external double needs verified contract evidence")
            require_types(contract_refs, {"contract-report"}, catalog, item_path, errors)
            if not contract_refs.issubset(run.outputs_by_kind.get("contract", set())):
                errors.append(f"{item_path}.contract_evidence: must come from a contract command")
        if double_id:
            if double_id in doubles:
                errors.append(f"{item_path}.double_id: duplicate '{double_id}'")
            doubles[double_id] = boundary or ""
            projection.append({
                "double_id": double_id,
                "name": name,
                "boundary": boundary,
                "reason": reason,
                "contract_evidence": sorted(contract_refs),
            })
    projection.sort(key=lambda item: item["double_id"] or "")
    return doubles, projection


def _validate_double_use(
    double_ids: list[str], doubles: dict[str, str], path: str, errors: list[str]
) -> None:
    for double_id in double_ids:
        boundary = doubles.get(double_id)
        if boundary is None:
            errors.append(f"{path}: undeclared test double '{double_id}'")
        elif boundary == "first_party":
            errors.append(f"{path}: first-party double '{double_id}' cannot participate in closing evidence")


def _validate_paths(journey: dict[str, Any], path: str, errors: list[str]) -> tuple[
    dict[str, dict[str, Any]], list[dict[str, Any]]
]:
    paths: dict[str, dict[str, Any]] = {}
    projection: list[dict[str, Any]] = []
    for index, item in enumerate(require_list(journey, "required_paths", path, errors)):
        item_path = f"{path}.required_paths[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        path_id = require_text(item, "path_id", item_path, errors)
        path_type = require_text(item, "path_type", item_path, errors)
        mandatory = require_bool(item, "mandatory", item_path, errors)
        closure_case_id = require_text(item, "closure_case_id", item_path, errors)
        hop_sequence = require_text_list(item, "required_hop_ids", item_path, errors)
        hop_ids = set(hop_sequence)
        if len(hop_sequence) != len(hop_ids):
            errors.append(f"{item_path}.required_hop_ids: duplicate Hop IDs are forbidden")
        risks = set(require_text_list(item, "risk_obligations", item_path, errors, allow_empty=True))
        if path_id:
            if path_id in paths:
                errors.append(f"{item_path}.path_id: duplicate '{path_id}'")
            paths[path_id] = {
                "mandatory": mandatory is True,
                "path_type": path_type,
                "closure_case_id": closure_case_id,
                "hop_ids": hop_ids,
                "hop_sequence": hop_sequence,
                "risks": risks,
            }
            if mandatory is True:
                projection.append(
                    {
                        "path_id": path_id,
                        "path_type": path_type,
                        "closure_case_id": closure_case_id,
                        "required_hop_ids": hop_sequence,
                        "risk_obligations": sorted(risks),
                    }
                )
    if not any(item["mandatory"] for item in paths.values()):
        errors.append(f"{path}.required_paths: at least one path must be mandatory")
    return paths, sorted(projection, key=lambda item: item["path_id"])


def _validate_case_definitions(
    journey: dict[str, Any],
    path: str,
    paths: dict[str, dict[str, Any]],
    doubles: dict[str, str],
    errors: list[str],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    cases: dict[str, dict[str, Any]] = {}
    projection: list[dict[str, Any]] = []
    for index, item in enumerate(require_list(journey, "cases", path, errors)):
        item_path = f"{path}.cases[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        if "result" in item or "evidence" in item:
            errors.append(f"{item_path}: runtime result/evidence belongs in case_results")
        case_id = require_text(item, "case_id", item_path, errors)
        path_id = require_text(item, "path_id", item_path, errors)
        correlation = require_text(item, "correlation", item_path, errors)
        preconditions = require_text(item, "preconditions", item_path, errors)
        action = require_text(item, "action", item_path, errors)
        terminal_oracle = require_text(item, "terminal_oracle", item_path, errors)
        authority = require_text(item, "required_authority", item_path, errors)
        runner_project = require_text(item, "runner_project", item_path, errors)
        hop_sequence = require_text_list(item, "hop_ids", item_path, errors)
        hop_ids = set(hop_sequence)
        if len(hop_sequence) != len(hop_ids):
            errors.append(f"{item_path}.hop_ids: duplicate Hop IDs are forbidden")
        risks = set(require_text_list(item, "risk_obligations", item_path, errors, allow_empty=True))
        double_ids = require_text_list(item, "test_double_ids", item_path, errors, allow_empty=True)
        _validate_double_use(double_ids, doubles, f"{item_path}.test_double_ids", errors)
        if path_id and path_id not in paths:
            errors.append(f"{item_path}.path_id: undeclared path '{path_id}'")
        if authority and authority not in VALID_AUTHORITIES:
            errors.append(f"{item_path}.required_authority: unsupported authority '{authority}'")
        if case_id:
            if case_id in cases:
                errors.append(f"{item_path}.case_id: duplicate '{case_id}'")
            cases[case_id] = {
                "path_id": path_id,
                "correlation": correlation,
                "authority": authority,
                "runner_project": runner_project,
                "hop_ids": hop_ids,
                "hop_sequence": hop_sequence,
                "risks": risks,
            }
            projection.append(
                {
                    "case_id": case_id,
                    "path_id": path_id,
                    "required_authority": authority,
                    "runner_project": runner_project,
                    "correlation": correlation,
                    "preconditions": preconditions,
                    "action": action,
                    "terminal_oracle": terminal_oracle,
                    "hop_ids": hop_sequence,
                    "risk_obligations": sorted(risks),
                    "test_double_ids": sorted(double_ids),
                }
            )
    correlations = [item["correlation"] for item in cases.values() if item["correlation"]]
    if len(set(correlations)) != len(correlations):
        errors.append(f"{path}.cases: correlation value must be unique per Case")
    return cases, sorted(projection, key=lambda item: item["case_id"])


def _runner_supports_case(
    runner_ids: list[str],
    case_id: str,
    journey_id: str | None,
    definition: dict[str, Any],
    run: RunContext,
    path: str,
    errors: list[str],
) -> None:
    authorities: set[str] = set()
    covered_hops: set[str] = set()
    for runner_id in runner_ids:
        report = run.runners.get(runner_id)
        if report is None:
            errors.append(f"{path}: undeclared runner report '{runner_id}'")
            continue
        authorities.add(report.authority)
        if report.project != definition.get("runner_project"):
            errors.append(
                f"{path}: runner '{runner_id}' project does not match frozen Case runner_project"
            )
        if journey_id and journey_id not in report.journey_ids:
            errors.append(f"{path}: runner '{runner_id}' is not scoped to Journey '{journey_id}'")
        if case_id not in report.case_ids:
            errors.append(f"{path}: runner '{runner_id}' does not contain Case '{case_id}'")
        covered_hops |= report.hop_ids
    missing_hops = definition["hop_ids"] - covered_hops
    if missing_hops:
        errors.append(f"{path}: runner reports miss Case hops {', '.join(sorted(missing_hops))}")
    required = definition.get("authority")
    if required and not authority_satisfied(required, authorities):
        errors.append(f"{path}: required authority '{required}' is not backed by runner evidence")


def _validate_case_results(
    journey: dict[str, Any],
    path: str,
    journey_id: str | None,
    paths: dict[str, dict[str, Any]],
    cases: dict[str, dict[str, Any]],
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> CaseState:
    state = CaseState(definitions=cases)
    state.correlations = {
        case_id: definition["correlation"] for case_id, definition in cases.items()
        if definition["correlation"]
    }
    state.path_projection = [
        {
            "path_id": path_id,
            "path_type": definition["path_type"],
            "closure_case_id": definition["closure_case_id"],
            "required_hop_ids": definition["hop_sequence"],
            "risk_obligations": sorted(definition["risks"]),
        }
        for path_id, definition in paths.items() if definition["mandatory"]
    ]
    result_ids: set[str] = set()
    passing_by_path: dict[str, set[str]] = {}
    risks_by_path: dict[str, set[str]] = {}
    for index, item in enumerate(require_list(journey, "case_results", path, errors)):
        item_path = f"{path}.case_results[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        case_id = require_text(item, "case_id", item_path, errors)
        result = require_text(item, "result", item_path, errors)
        runner_ids = require_text_list(item, "runner_report_ids", item_path, errors)
        state.runner_ids.update(runner_ids)
        refs = set(require_refs(item, "evidence", item_path, errors))
        definition = cases.get(case_id or "")
        if case_id in result_ids:
            errors.append(f"{item_path}.case_id: duplicate result for '{case_id}'")
        if case_id:
            result_ids.add(case_id)
        if definition is None:
            errors.append(f"{item_path}.case_id: undeclared Case '{case_id}'")
            continue
        if result != "pass":
            errors.append(f"{item_path}.result: must be 'pass' for closure")
            continue
        correlation = definition["correlation"]
        require_correlation(refs, correlation, catalog, item_path, errors, exact=True)
        require_journey_scope(refs, journey_id, catalog, item_path, errors, exact=True)
        require_case_scope(refs, case_id, catalog, item_path, errors, exact=True)
        _runner_supports_case(runner_ids, case_id or "", journey_id, definition, run, item_path, errors)
        state.runner_ids_by_case[case_id or ""] = set(runner_ids)
        state.passing_cases.add(case_id or "")
        state.passing_hops |= definition["hop_ids"]
        state.runtime_refs |= refs
        path_id = definition["path_id"]
        if path_id:
            passing_by_path.setdefault(path_id, set()).update(definition["hop_ids"])
            risks_by_path.setdefault(path_id, set()).update(definition["risks"])
        for hop_id in definition["hop_ids"]:
            state.risks_by_hop.setdefault(hop_id, set()).update(definition["risks"])

    for case_id in sorted(set(cases) - result_ids):
        errors.append(f"{path}.case_results: missing result for Case '{case_id}'")
    for path_id, definition in paths.items():
        if not definition["mandatory"]:
            continue
        if path_id not in passing_by_path:
            errors.append(f"{path}.required_paths: mandatory path '{path_id}' has no passing Case")
            continue
        closure_case_id = definition.get("closure_case_id")
        closure_case = cases.get(closure_case_id or "")
        if closure_case is None:
            errors.append(
                f"{path}.required_paths.{path_id}: closure_case_id must name a declared Case"
            )
        elif closure_case.get("path_id") != path_id:
            errors.append(
                f"{path}.required_paths.{path_id}: closure Case must belong to the same path"
            )
        elif closure_case_id not in state.passing_cases:
            errors.append(
                f"{path}.required_paths.{path_id}: closure Case must be passing"
            )
        elif (
            closure_case.get("hop_sequence") != definition["hop_sequence"]
            or not closure_case.get("risks", set()).issuperset(definition["risks"])
        ):
            errors.append(
                f"{path}.required_paths.{path_id}: must be closed by one passing Case with the "
                "full ordered Hop sequence and all path risks under one correlation"
            )
        missing_hops = definition["hop_ids"] - passing_by_path[path_id]
        if missing_hops:
            errors.append(
                f"{path}.required_paths.{path_id}: passing Cases miss required hops "
                f"{', '.join(sorted(missing_hops))}"
            )
        missing_risks = definition["risks"] - risks_by_path.get(path_id, set())
        if missing_risks:
            errors.append(
                f"{path}.required_paths.{path_id}: passing Cases miss risks "
                f"{', '.join(sorted(missing_risks))}"
            )
            for risk in sorted(missing_risks):
                errors.append(
                    f"{path}.required_paths.{path_id}: risk '{risk}' has no passing Case"
                )
    return state


def _validate_contract_report(
    refs: set[str],
    hop: dict[str, Any],
    run: RunContext,
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
) -> None:
    require_types(refs, {"contract-report"}, catalog, path, errors)
    if not refs.issubset(run.outputs_by_kind.get("contract", set())):
        errors.append(f"{path}: contract evidence must come from a contract command")
    for ref in refs:
        producing_commands = [
            command for command in run.commands.values()
            if ref in command.outputs and command.kind == "contract"
            and command.expected == "pass" and command.exit_code == 0
        ]
        if len(producing_commands) != 1:
            errors.append(
                f"{path}: contract evidence must have exactly one passing producing command"
            )
        for endpoint in ("producer", "consumer"):
            if hop.get(f"{endpoint}_scope") != "first_party":
                continue
            component = hop.get(endpoint)
            if not any(component in command.source_revisions for command in producing_commands):
                errors.append(
                    f"{path}: contract command is not source-bound to '{component}'"
                )
        report = payload(ref, "contract-report", catalog)
        if report is None:
            continue
        expected = {
            "status": "pass",
            "producer": hop.get("producer"),
            "consumer": hop.get("consumer"),
            "contract": hop.get("contract"),
            "contract_version": hop.get("contract_version"),
            "contract_digest": hop.get("contract_digest"),
            "verification_mode": hop.get("verification_mode"),
            "producer_build_digest": hop.get("producer_build_digest"),
            "consumer_build_digest": hop.get("consumer_build_digest"),
        }
        for key, expected_value in expected.items():
            if report.get(key) != expected_value:
                if key in {
                    "contract_digest", "verification_mode",
                    "producer_build_digest", "consumer_build_digest",
                }:
                    errors.append(
                        f"{path}: contract-report {key} does not match the frozen Hop"
                    )
                else:
                    errors.append(f"{path}: contract-report field '{key}' does not match the Hop")
        interactions = report.get("interaction_ids")
        if not isinstance(interactions, list) or any(not is_text(item) for item in interactions):
            errors.append(f"{path}: contract-report requires interaction_ids")
        elif sorted(interactions) != sorted(hop.get("interaction_ids", [])):
            errors.append(f"{path}: contract-report interaction_ids do not match the frozen Hop")
        provider_states = report.get("provider_state_ids")
        if not isinstance(provider_states, list) or any(not is_text(item) for item in provider_states):
            errors.append(f"{path}: contract-report requires provider_state_ids")
        elif sorted(provider_states) != sorted(hop.get("provider_state_ids", [])):
            errors.append(f"{path}: contract-report provider_state_ids do not match the frozen Hop")
        if report.get("verification_mode") not in VALID_CONTRACT_MODES:
            errors.append(f"{path}: contract-report requires a supported verification_mode")
        digest = report.get("contract_digest")
        if not isinstance(digest, str) or re.fullmatch(r"sha256:[0-9a-fA-F]{64}", digest) is None:
            errors.append(f"{path}: contract-report requires a sha256 contract_digest")
        for endpoint in ("producer", "consumer"):
            key = f"{endpoint}_build_digest"
            observed = report.get(key)
            component = hop.get(endpoint)
            if hop.get(f"{endpoint}_scope") == "first_party":
                artifact = catalog.get(ref)
                if artifact is not None and component not in artifact.source_revisions:
                    errors.append(
                        f"{path}: contract evidence is not source-bound to '{component}'"
                    )
                source = run.sources.get(component)
                expected_digest = source.build_digest if source else None
                if observed != expected_digest:
                    errors.append(f"{path}: contract-report {key} does not match run.sources")
            elif observed != hop.get(key):
                errors.append(f"{path}: contract-report {key} does not match frozen external identity")
        checks = {
            "provider_states_verified": True,
            "pending": False,
            "wip": False,
            "deployment_compatibility": "pass",
        }
        for key, expected_value in checks.items():
            if report.get(key) != expected_value:
                errors.append(f"{path}: contract-report {key} must be {expected_value!r}")


def _validate_hop_endpoint(
    endpoint: str | None,
    scope: str | None,
    label: str,
    first_party: set[str],
    path: str,
    errors: list[str],
) -> str | None:
    if scope not in VALID_SCOPES:
        errors.append(f"{path}.{label}_scope: unsupported scope '{scope}'")
    if scope == "first_party" and endpoint not in first_party:
        errors.append(f"{path}.{label}: first-party endpoint '{endpoint}' is absent from first_party_components")
    if scope != "first_party" and endpoint in first_party:
        errors.append(f"{path}.{label}_scope: endpoint is declared first-party")
    return endpoint if scope == "first_party" else None


def _validate_hop_policy(fields: dict[str, Any], path: str, errors: list[str]) -> None:
    transport = fields["transport"]
    if transport not in VALID_TRANSPORTS:
        errors.append(f"{path}.transport: unsupported transport '{transport}'")
    if fields["authority"] not in VALID_AUTHORITIES:
        errors.append(f"{path}.required_authority: unsupported authority '{fields['authority']}'")
    if fields["mandatory"] and not {fields["producer_scope"], fields["consumer_scope"]} & {"first_party"}:
        errors.append(f"{path}: mandatory hop must include a first-party endpoint")
    if fields["mandatory"] and transport != "module" and fields["contract_required"] is not True:
        errors.append(f"{path}.contract_required: mandatory cross-boundary hop requires true")
    if transport == "message/event" and not ASYNC_RISKS.issubset(fields["risks"]):
        missing = ", ".join(sorted(ASYNC_RISKS - fields["risks"]))
        errors.append(f"{path}.risk_obligations: async hop missing {missing}")


def _parse_expected_hop(
    item: Any,
    path: str,
    first_party: set[str],
    doubles: dict[str, str],
    errors: list[str],
) -> tuple[dict[str, Any] | None, set[str]]:
    if not isinstance(item, dict):
        errors.append(f"{path}: required object")
        return None, set()
    fields = {
        "hop_id": require_text(item, "hop_id", path, errors),
        "producer": require_text(item, "producer", path, errors),
        "consumer": require_text(item, "consumer", path, errors),
        "producer_scope": require_text(item, "producer_scope", path, errors),
        "consumer_scope": require_text(item, "consumer_scope", path, errors),
        "transport": require_text(item, "transport", path, errors),
        "mandatory": require_bool(item, "mandatory", path, errors) is True,
        "contract_required": require_bool(item, "contract_required", path, errors),
        "contract": require_text(item, "contract", path, errors),
        "contract_version": require_text(item, "contract_version", path, errors),
        "contract_digest": require_text(item, "contract_digest", path, errors),
        "verification_mode": require_text(item, "verification_mode", path, errors),
        "producer_build_digest": require_text(item, "producer_build_digest", path, errors),
        "consumer_build_digest": require_text(item, "consumer_build_digest", path, errors),
        "authority": require_text(item, "required_authority", path, errors),
    }
    for key in ("consistency", "producer_oracle", "wire_oracle", "consumer_oracle"):
        fields[key] = require_text(item, key, path, errors)
    fields["double_ids"] = require_text_list(item, "allowed_double_ids", path, errors, allow_empty=True)
    fields["risks"] = set(require_text_list(item, "risk_obligations", path, errors, allow_empty=True))
    fields["interaction_ids"] = sorted(require_text_list(item, "interaction_ids", path, errors))
    fields["provider_state_ids"] = sorted(require_text_list(item, "provider_state_ids", path, errors))
    if len(fields["interaction_ids"]) != len(set(fields["interaction_ids"])):
        errors.append(f"{path}.interaction_ids: duplicate IDs are forbidden")
    if len(fields["provider_state_ids"]) != len(set(fields["provider_state_ids"])):
        errors.append(f"{path}.provider_state_ids: duplicate IDs are forbidden")
    if (
        fields["contract_digest"]
        and re.fullmatch(r"sha256:[0-9a-fA-F]{64}", fields["contract_digest"]) is None
    ):
        errors.append(f"{path}.contract_digest: required sha256 digest")
    if fields["verification_mode"] not in VALID_CONTRACT_MODES:
        errors.append(f"{path}.verification_mode: unsupported contract verification mode")
    _validate_double_use(fields["double_ids"], doubles, f"{path}.allowed_double_ids", errors)
    seen = {
        endpoint for endpoint in (
            _validate_hop_endpoint(fields["producer"], fields["producer_scope"], "producer", first_party, path, errors),
            _validate_hop_endpoint(fields["consumer"], fields["consumer_scope"], "consumer", first_party, path, errors),
        ) if endpoint
    }
    _validate_hop_policy(fields, path, errors)
    return fields, seen


def _hop_projection(fields: dict[str, Any]) -> dict[str, Any]:
    return {
        "hop_id": fields["hop_id"],
        "producer": fields["producer"],
        "consumer": fields["consumer"],
        "producer_scope": fields["producer_scope"],
        "consumer_scope": fields["consumer_scope"],
        "transport": fields["transport"],
        "contract": fields["contract"],
        "contract_version": fields["contract_version"],
        "contract_digest": fields["contract_digest"],
        "verification_mode": fields["verification_mode"],
        "interaction_ids": fields["interaction_ids"],
        "provider_state_ids": fields["provider_state_ids"],
        "producer_build_digest": fields["producer_build_digest"],
        "consumer_build_digest": fields["consumer_build_digest"],
        "required_authority": fields["authority"],
        "consistency": fields["consistency"],
        "producer_oracle": fields["producer_oracle"],
        "wire_oracle": fields["wire_oracle"],
        "consumer_oracle": fields["consumer_oracle"],
        "risk_obligations": sorted(fields["risks"]),
        "allowed_double_ids": sorted(fields["double_ids"]),
    }


def _parse_expected_hops(
    journey: dict[str, Any],
    path: str,
    first_party: set[str],
    doubles: dict[str, str],
    errors: list[str],
) -> tuple[dict[str, dict[str, Any]], HopState]:
    expected: dict[str, dict[str, Any]] = {}
    state = HopState()
    seen_components: set[str] = set()
    for index, item in enumerate(require_list(journey, "expected_hops", path, errors)):
        item_path = f"{path}.expected_hops[{index}]"
        fields, seen = _parse_expected_hop(item, item_path, first_party, doubles, errors)
        seen_components |= seen
        if fields is None or not fields["hop_id"]:
            continue
        hop_id = fields["hop_id"]
        if hop_id in expected:
            errors.append(f"{item_path}.hop_id: duplicate '{hop_id}'")
        expected[hop_id] = item
        state.expected_ids.add(hop_id)
        state.transports.add(fields["transport"] or "")
        state.risks |= fields["risks"]
        if fields["mandatory"]:
            state.mandatory_ids.add(hop_id)
            state.projection.append(_hop_projection(fields))
    if not state.mandatory_ids:
        errors.append(f"{path}.expected_hops: at least one hop must be mandatory")
    for component in sorted(first_party - seen_components):
        errors.append(f"{path}.expected_hops: first-party component '{component}' is absent from the Hop graph")
    state.projection.sort(key=lambda item: item["hop_id"])
    return expected, state


def _hop_runner_authority(
    hop_id: str, case_id: str | None, journey_id: str | None, expected: dict[str, Any],
    allowed_runner_ids: set[str], run: RunContext, path: str, errors: list[str]
) -> None:
    reports = [
        report for runner_id, report in run.runners.items()
        if runner_id in allowed_runner_ids
        and hop_id in report.hop_ids and (not journey_id or journey_id in report.journey_ids)
        and (not case_id or case_id in report.case_ids)
        and report.phase != "red"
    ]
    authorities = {report.authority for report in reports}
    required = expected.get("required_authority")
    if required and not authority_satisfied(required, authorities):
        errors.append(
            f"{path}: Hop required authority '{required}' is not backed by referenced Case runner evidence"
        )
    for endpoint in ("producer", "consumer"):
        if expected.get(f"{endpoint}_scope") != "first_party":
            continue
        component = expected.get(endpoint)
        if not any(component in report.source_revisions for report in reports):
            errors.append(f"{path}: Hop runner evidence is not source-bound to '{component}'")


def _validate_observed_hop(
    item: dict[str, Any],
    expected: dict[str, Any],
    journey_id: str | None,
    case_state: CaseState,
    run: RunContext,
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
) -> set[str]:
    case_id = require_text(item, "case_id", path, errors)
    definition = case_state.definitions.get(case_id or "")
    if definition is None or case_id not in case_state.passing_cases:
        errors.append(f"{path}.case_id: observed Hop must bind to a passing Case")
        correlation = None
    else:
        correlation = definition["correlation"]
        if expected.get("hop_id") not in definition.get("hop_ids", set()):
            errors.append(f"{path}: observed Hop is absent from its bound Case")
    producer_refs = set(require_refs(item, "producer_evidence", path, errors))
    wire_refs = set(require_refs(item, "wire_evidence", path, errors))
    consumer_refs = set(require_refs(item, "consumer_evidence", path, errors))
    contract_refs: set[str] = set()
    if expected.get("contract_required") is True:
        contract_refs = set(require_refs(item, "contract_evidence", path, errors))
    groups = {
        "producer": producer_refs,
        "wire": wire_refs,
        "consumer": consumer_refs,
        "contract": contract_refs,
    }
    require_independent(groups, catalog, path, errors)
    runtime_refs = producer_refs | wire_refs | consumer_refs
    require_types(
        producer_refs | consumer_refs,
        {"raw-log", "trace", "runner-report", "readback-report", "browser-report"},
        catalog,
        path,
        errors,
    )
    require_types(
        wire_refs,
        {"raw-log", "trace", "runner-report", "browser-report"},
        catalog,
        path,
        errors,
    )
    require_correlation(runtime_refs, correlation, catalog, path, errors, exact=True)
    require_journey_scope(runtime_refs, journey_id, catalog, path, errors, exact=True)
    require_journey_scope(contract_refs, journey_id, catalog, path, errors)
    require_case_scope(runtime_refs, case_id, catalog, path, errors, exact=True)
    require_hop_scope(
        runtime_refs | contract_refs, expected.get("hop_id"), catalog, path, errors,
        exact=True,
    )
    if expected.get("producer_scope") == "first_party":
        require_component_binding(
            producer_refs, expected.get("producer"), catalog, f"{path}: producer evidence is not source-bound", errors
        )
    if expected.get("consumer_scope") == "first_party":
        require_component_binding(
            consumer_refs, expected.get("consumer"), catalog, f"{path}: consumer evidence is not source-bound", errors
        )
    if contract_refs:
        _validate_contract_report(contract_refs, expected, run, catalog, f"{path}.contract_evidence", errors)

    risks = (
        set(expected.get("risk_obligations", [])) & definition.get("risks", set())
        if definition is not None else set(expected.get("risk_obligations", []))
    )
    risk_evidence = item.get("risk_evidence")
    if not isinstance(risk_evidence, dict):
        errors.append(f"{path}.risk_evidence: required object")
        risk_evidence = {}
    for risk in sorted(risks):
        refs = set(require_refs(risk_evidence, risk, f"{path}.risk_evidence", errors))
        require_types(refs, {"runner-report", "trace", "raw-log", "readback-report"}, catalog, path, errors)
        require_correlation(
            refs, correlation, catalog, f"{path}.risk_evidence.{risk}", errors,
            exact=True,
        )
        require_journey_scope(refs, journey_id, catalog, f"{path}.risk_evidence.{risk}", errors)
        require_case_scope(
            refs, case_id, catalog, f"{path}.risk_evidence.{risk}", errors,
            exact=True,
        )
        require_hop_scope(refs, expected.get("hop_id"), catalog, f"{path}.risk_evidence.{risk}", errors)
        runtime_refs |= refs
        if risk not in case_state.risks_by_hop.get(expected.get("hop_id"), set()):
            errors.append(f"{path}: risk '{risk}' has no passing Case")
    return runtime_refs


def _validate_hops(
    journey: dict[str, Any],
    path: str,
    journey_id: str | None,
    first_party: set[str],
    doubles: dict[str, str],
    paths: dict[str, dict[str, Any]],
    case_state: CaseState,
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> HopState:
    expected, state = _parse_expected_hops(journey, path, first_party, doubles, errors)
    observed: dict[tuple[str, str], dict[str, Any]] = {}
    observed_by_hop: dict[str, list[dict[str, Any]]] = {}
    for index, item in enumerate(require_list(journey, "observed_hops", path, errors)):
        item_path = f"{path}.observed_hops[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        hop_id = require_text(item, "hop_id", item_path, errors)
        case_id = require_text(item, "case_id", item_path, errors)
        if hop_id and case_id:
            key = (case_id, hop_id)
            if key in observed:
                errors.append(
                    f"{item_path}: duplicate observed Hop '{hop_id}' for Case '{case_id}'"
                )
            if hop_id not in expected:
                errors.append(f"{item_path}.hop_id: unexpected hop '{hop_id}'")
            observed[key] = item
            observed_by_hop.setdefault(hop_id, []).append(item)
            if hop_id in expected:
                state.runtime_refs |= _validate_observed_hop(
                    item, expected[hop_id], journey_id, case_state, run, catalog,
                    item_path, errors,
                )
                _hop_runner_authority(
                    hop_id, case_id, journey_id, expected[hop_id],
                    case_state.runner_ids_by_case.get(case_id, set()), run, item_path, errors
                )
    for hop_id in sorted(state.mandatory_ids):
        if not observed_by_hop.get(hop_id):
            errors.append(f"{path}.observed_hops: mandatory expected hop '{hop_id}' is missing")
    for hop_id in sorted(case_state.passing_hops - state.expected_ids):
        errors.append(f"{path}.cases: passing Case references undeclared hop '{hop_id}'")
    for hop_id in sorted(state.mandatory_ids - case_state.passing_hops):
        errors.append(f"{path}.cases: mandatory hop '{hop_id}' has no passing Case coverage")
    for path_id, definition in paths.items():
        if definition["mandatory"]:
            nonmandatory = definition["hop_ids"] - state.mandatory_ids
            if nonmandatory:
                errors.append(
                    f"{path}.required_paths.{path_id}: required hops must be mandatory: "
                    f"{', '.join(sorted(nonmandatory))}"
                )
            assigned_risks = set().union(*(
                set(expected[hop_id].get("risk_obligations", []))
                for hop_id in definition["hop_sequence"] if hop_id in expected
            ))
            for risk in sorted(definition["risks"] - assigned_risks):
                errors.append(
                    f"{path}.required_paths.{path_id}: path risk '{risk}' is not assigned "
                    "to a required Hop"
                )
            closure_case_id = definition.get("closure_case_id")
            for hop_id in definition["hop_sequence"]:
                if (closure_case_id, hop_id) not in observed:
                    errors.append(
                        f"{path}.required_paths.{path_id}: observed Hops must use closure Case "
                        f"'{closure_case_id}' for Hop '{hop_id}'"
                    )
    return state


def _path_items(journey: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in journey.get("required_paths", []):
        if isinstance(item, dict) and is_text(item.get("path_id")):
            result[item["path_id"]] = {
                "mandatory": item.get("mandatory") is True,
                "hop_ids": set(item.get("required_hop_ids", [])) if isinstance(item.get("required_hop_ids"), list) else set(),
            }
    return result


def _validate_tdd_phase(
    tdd: dict[str, Any],
    phase: str,
    test_identity: str | None,
    case_id: str | None,
    correlation: str | None,
    journey_id: str | None,
    run: RunContext,
    catalog: dict[str, Artifact],
    path: str,
    errors: list[str],
) -> tuple[set[str], Any]:
    item_path = f"{path}.tdd.{phase}"
    item = tdd.get(phase)
    if not isinstance(item, dict):
        errors.append(f"{item_path}: required object")
        return set(), None
    command_id = require_text(item, "command_id", item_path, errors)
    runner_id = require_text(item, "runner_report_id", item_path, errors)
    refs = set(require_refs(item, "evidence", item_path, errors))
    require_correlation(refs, correlation, catalog, item_path, errors, every=False)
    require_journey_scope(refs, journey_id, catalog, item_path, errors)
    require_case_scope(refs, case_id, catalog, item_path, errors)
    command = run.commands.get(command_id or "")
    expected = "fail" if phase == "red" else "pass"
    if command is None:
        errors.append(f"{item_path}.command_id: undeclared command '{command_id}'")
    elif command.phase != phase or command.expected != expected:
        errors.append(f"{item_path}: command must be {phase}/{expected}")
    elif command.test_identity != test_identity:
        errors.append(f"{item_path}: command test_identity does not match tdd.test_identity")
    runner = run.runners.get(runner_id or "")
    if runner is None or runner.phase != phase:
        errors.append(f"{item_path}.runner_report_id: must reference a {phase} runner report")
    elif case_id and case_id not in runner.case_ids:
        errors.append(f"{item_path}: runner report does not contain TDD Case '{case_id}'")
    if phase == "red":
        method = require_text(item, "method", item_path, errors)
        require_text(item, "failure_signature", item_path, errors)
        if method not in {"pre-fix", "mutation", "fault-injection"}:
            errors.append(f"{item_path}.method: unsupported RED method")
        if method != "pre-fix":
            refs |= set(require_refs(item, "control_evidence", item_path, errors))
    return refs, command


def _validate_tdd_order(
    tdd: dict[str, Any], red: Any, green: Any, path: str, errors: list[str]
) -> None:
    if not red or not green:
        return
    if red.completed_at and green.started_at and red.completed_at > green.started_at:
        errors.append(f"{path}.tdd: RED must complete before GREEN starts")
    red_item = tdd.get("red")
    method = red_item.get("method") if isinstance(red_item, dict) else None
    if method == "pre-fix" and red.source_fingerprints == green.source_fingerprints:
        errors.append(f"{path}.tdd: pre-fix RED and GREEN require distinct source fingerprints")


def _validate_tdd(
    journey: dict[str, Any],
    path: str,
    journey_id: str | None,
    case_state: CaseState,
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> set[str]:
    tdd = journey.get("tdd")
    if not isinstance(tdd, dict):
        errors.append(f"{path}.tdd: required object")
        return set()
    test_identity = require_text(tdd, "test_identity", f"{path}.tdd", errors)
    case_id = require_text(tdd, "case_id", f"{path}.tdd", errors)
    correlation = case_state.correlations.get(case_id or "")
    red_refs, red = _validate_tdd_phase(
        tdd, "red", test_identity, case_id, correlation, journey_id, run, catalog, path, errors
    )
    green_refs, green = _validate_tdd_phase(
        tdd, "green", test_identity, case_id, correlation, journey_id, run, catalog, path, errors
    )
    require_independent({"red": red_refs, "green": green_refs}, catalog, f"{path}.tdd", errors)
    _validate_tdd_order(tdd, red, green, path, errors)
    return red_refs | green_refs


def _validate_terminal(
    journey: dict[str, Any],
    path: str,
    journey_id: str | None,
    first_party: set[str],
    case_state: CaseState,
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> tuple[set[str], list[str], str | None, list[dict[str, Any]]]:
    terminal = journey.get("terminal_oracle")
    item_path = f"{path}.terminal_oracle"
    if not isinstance(terminal, dict):
        errors.append(f"{item_path}: required object")
        return set(), [], None, []
    if terminal.get("status") != "pass":
        errors.append(f"{item_path}.status: must be 'pass'")
    claim = require_text(terminal, "claim", item_path, errors)
    case_id = require_text(terminal, "case_id", item_path, errors)
    authorities = require_text_list(terminal, "authority_components", item_path, errors)
    expectation_by_component: dict[str, dict[str, Any]] = {}
    expectation_projection: list[dict[str, Any]] = []
    for index, item in enumerate(require_list(terminal, "readback_expectations", item_path, errors)):
        expectation_path = f"{item_path}.readback_expectations[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{expectation_path}: required object")
            continue
        component = require_text(item, "authority_component", expectation_path, errors)
        query_type = require_text(item, "query_type", expectation_path, errors)
        query = require_text(item, "query", expectation_path, errors)
        command_id = require_text(item, "command_id", expectation_path, errors)
        command_text = require_text(item, "command", expectation_path, errors)
        if query_type and query_type not in VALID_READBACK_QUERY_TYPES:
            errors.append(f"{expectation_path}.query_type: unsupported readback query type")
        if "expected" not in item:
            errors.append(f"{expectation_path}.expected: required frozen value")
        timeout = item.get("timeout_ms")
        if type(timeout) is not int or timeout <= 0:
            errors.append(f"{expectation_path}.timeout_ms: required positive integer")
        if component:
            if component in expectation_by_component:
                errors.append(f"{expectation_path}.authority_component: duplicate '{component}'")
            normalized = {
                "authority_component": component,
                "query_type": query_type,
                "query": query,
                "expected": item.get("expected"),
                "timeout_ms": timeout,
                "command_id": command_id,
                "command": command_text,
            }
            expectation_by_component[component] = normalized
            expectation_projection.append(normalized)
    if set(authorities) != set(expectation_by_component):
        errors.append(
            f"{item_path}.readback_expectations: must define exactly one frozen expectation "
            "for every authority component"
        )
    surface = set(require_refs(terminal, "surface_evidence", item_path, errors))
    authority = set(require_refs(terminal, "authority_evidence", item_path, errors))
    require_independent({"surface": surface, "authority": authority}, catalog, item_path, errors)
    correlation = case_state.correlations.get(case_id or "")
    if case_id not in case_state.passing_cases:
        errors.append(f"{item_path}.case_id: terminal oracle must bind to a passing Case")
    require_correlation(
        surface | authority, correlation, catalog, item_path, errors, exact=True
    )
    require_journey_scope(surface | authority, journey_id, catalog, item_path, errors)
    require_case_scope(surface | authority, case_id, catalog, item_path, errors, exact=True)
    require_types(authority, {"readback-report", "runner-report", "trace", "raw-log"}, catalog, item_path, errors)
    readback_refs = {
        ref for ref in authority
        if ref in catalog and catalog[ref].artifact_type == "readback-report"
    }
    if not readback_refs:
        errors.append(f"{item_path}: terminal authority requires a readback-report")
    for ref in readback_refs:
        direct_commands = [
            command for command in run.commands.values()
            if ref in command.outputs
            and command.phase in {"journey", "browser"}
            and command.expected == "pass"
            and command.exit_code == 0
        ]
        if not direct_commands:
            errors.append(
                f"{item_path}: readback-report must be a direct output of a passing Journey command"
            )
    bound = set().union(*(catalog[ref].source_revisions.keys() for ref in authority if ref in catalog))
    for component in authorities:
        if component not in first_party:
            errors.append(f"{item_path}.authority_components: '{component}' is not first-party")
        if component not in bound:
            errors.append(f"{item_path}: authority evidence is not source-bound to '{component}'")
        matching = []
        for ref in readback_refs:
            report = payload(ref, "readback-report", catalog)
            if report is not None and report.get("authority_component") == component:
                matching.append((ref, report))
        if not matching:
            errors.append(f"{item_path}: no readback-report names authority component '{component}'")
        if len(matching) > 1:
            errors.append(f"{item_path}: authority component '{component}' has duplicate readback reports")
        frozen = expectation_by_component.get(component)
        for ref, report in matching:
            artifact = catalog.get(ref)
            if artifact is not None and component not in artifact.source_revisions:
                errors.append(
                    f"{item_path}: readback-report is not source-bound to authority "
                    f"component '{component}'"
                )
            if report.get("status") != "pass":
                errors.append(f"{item_path}: readback-report status must be pass")
            if report.get("claim") != claim:
                errors.append(f"{item_path}: readback-report claim must match terminal oracle")
            if not is_text(report.get("query")):
                errors.append(f"{item_path}: readback-report requires authoritative query")
            if frozen is not None:
                for key in ("query_type", "query", "expected", "timeout_ms"):
                    if report.get(key) != frozen.get(key):
                        errors.append(
                            f"{item_path}: readback-report {key} does not match frozen readback expectation"
                        )
                frozen_command_id = frozen.get("command_id")
                command = run.commands.get(frozen_command_id or "")
                if command is None or ref not in command.outputs:
                    errors.append(
                        f"{item_path}: readback-report must be output by frozen command "
                        f"'{frozen_command_id}'"
                    )
                else:
                    if command.command != frozen.get("command"):
                        errors.append(
                            f"{item_path}: readback command does not match frozen command semantics"
                        )
                    if (
                        command.phase not in {"journey", "browser"}
                        or command.expected != "pass"
                        or command.exit_code != 0
                    ):
                        errors.append(
                            f"{item_path}: frozen readback command must be a passing Journey command"
                        )
                    require_journey_scope(
                        command.evidence, journey_id, catalog,
                        f"{item_path}.readback_command", errors,
                    )
                    require_case_scope(
                        command.evidence, case_id, catalog,
                        f"{item_path}.readback_command", errors, exact=True,
                    )
                    require_correlation(
                        command.evidence, correlation, catalog,
                        f"{item_path}.readback_command", errors, exact=True,
                    )
            if "expected" not in report or "observed" not in report:
                errors.append(f"{item_path}: readback-report requires expected and observed values")
            elif frozen is not None and report.get("observed") != frozen.get("expected"):
                errors.append(f"{item_path}: readback-report observed value does not match frozen expectation")
            elif report.get("expected") != report.get("observed"):
                errors.append(f"{item_path}: readback-report expected and observed values differ")
            convergence = report.get("convergence_ms")
            timeout = report.get("timeout_ms")
            if type(convergence) is not int or convergence < 0:
                errors.append(f"{item_path}: readback-report convergence_ms must be non-negative")
            if type(timeout) is not int or timeout <= 0:
                errors.append(f"{item_path}: readback-report timeout_ms must be positive")
            if type(convergence) is int and type(timeout) is int and convergence > timeout:
                errors.append(f"{item_path}: readback-report exceeded its convergence timeout")
    expectation_projection.sort(key=lambda item: item["authority_component"] or "")
    return surface | authority, sorted(authorities), claim, expectation_projection


def _validate_browser_report(
    report: dict[str, Any], spec: dict[str, Any], claim: str | None,
    path: str, errors: list[str]
) -> None:
    scalar_checks = {
        "status": "pass",
        "route": spec.get("route"),
        "browser": spec.get("browser"),
        "project": spec.get("project"),
        "persona": spec.get("persona"),
        "terminal_oracle": claim,
    }
    for key, expected in scalar_checks.items():
        if report.get(key) != expected:
            errors.append(f"{path}: browser-report {key} must be {expected!r}")
    for key in ("actions", "dom_assertions", "network_observations", "viewports"):
        observed = require_text_list(report, key, path, errors)
        expected = spec.get(f"expected_{key}") if key != "viewports" else spec.get(key)
        if key != "viewports" and observed != expected:
            errors.append(f"{path}: {key} do not match frozen browser semantics")
    for key in ("console_errors", "unexpected_network_failures"):
        if report.get(key) != []:
            errors.append(f"{path}: browser-report {key} must be empty")
    if not isinstance(report.get("expected_network_failures"), list):
        errors.append(f"{path}: browser-report expected_network_failures must be a list")
    elif report.get("expected_network_failures") != spec.get("expected_network_failures"):
        errors.append(f"{path}: browser-report expected_network_failures do not match frozen scope")
    if report.get("viewports") != spec.get("viewports"):
        errors.append(f"{path}: browser-report viewports do not match frozen scope")
    for key in ("reload_passed", "accessibility_passed"):
        if report.get(key) is not True:
            errors.append(f"{path}: browser-report {key} must be true")


def _normalized_scan_path(value: str, path: str, errors: list[str]) -> str | None:
    candidate = PurePosixPath(value)
    normalized = candidate.as_posix()
    if candidate.is_absolute() or ".." in candidate.parts or normalized != value or normalized in {".", ""}:
        errors.append(f"{path}: must be a normalized relative path without traversal")
        return None
    return normalized


def _resolve_relative_import(
    source: str, specifier: str, scanned: set[str], path: str, errors: list[str]
) -> str | None:
    base = posixpath.normpath(posixpath.join(posixpath.dirname(source), specifier))
    candidates = [base]
    if PurePosixPath(base).suffix == "":
        extensions = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json")
        candidates.extend(base + extension for extension in extensions)
        candidates.extend(posixpath.join(base, "index" + extension) for extension in extensions)
    matches = sorted({candidate for candidate in candidates if candidate in scanned})
    if len(matches) != 1:
        qualifier = "omitted or unresolved" if not matches else "ambiguous"
        errors.append(
            f"{path}: relative import '{specifier}' from '{source}' is {qualifier} "
            "in scanned_files"
        )
        return None
    return matches[0]


def _parse_module_specifiers(
    sources: dict[str, str], path: str, errors: list[str]
) -> dict[str, set[str]]:
    node = shutil.which("node")
    helper = Path(__file__).parents[1] / "parse_js_module_graph.cjs"
    if node is None:
        errors.append(f"{path}: Node.js is required for AST route dependency scanning")
        return {}
    if not helper.is_file():
        errors.append(f"{path}: bundled AST route dependency parser is missing")
        return {}
    request = {
        "files": [
            {"path": relative, "source": source}
            for relative, source in sorted(sources.items())
        ]
    }
    try:
        completed = subprocess.run(
            [node, "--no-warnings", "--expose-internals", str(helper)],
            input=json.dumps(request, sort_keys=True),
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        errors.append(f"{path}: AST route dependency parser failed: {error}")
        return {}
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "unknown parser failure"
        errors.append(f"{path}: AST route dependency parser failed: {detail}")
        return {}
    try:
        response = json.loads(completed.stdout)
    except ValueError:
        errors.append(f"{path}: AST route dependency parser returned invalid JSON")
        return {}
    items = response.get("files") if isinstance(response, dict) else None
    if not isinstance(items, list):
        errors.append(f"{path}: AST route dependency parser omitted files[]")
        return {}
    result: dict[str, set[str]] = {}
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict) or item.get("path") not in sources:
            errors.append(f"{path}: AST route dependency parser returned an unknown file")
            continue
        relative = item["path"]
        if relative in seen:
            errors.append(f"{path}: AST route dependency parser duplicated '{relative}'")
            continue
        seen.add(relative)
        parse_errors = item.get("errors")
        specifiers = item.get("specifiers")
        if not isinstance(parse_errors, list) or not all(isinstance(value, str) for value in parse_errors):
            errors.append(f"{path}: AST route dependency parser returned invalid errors for '{relative}'")
            continue
        if not isinstance(specifiers, list) or not all(isinstance(value, str) for value in specifiers):
            errors.append(f"{path}: AST route dependency parser returned invalid specifiers for '{relative}'")
            continue
        for detail in parse_errors:
            if "browser interception/replay behavior" in detail:
                label = "scanned source contains browser interception/replay behavior"
            elif "computed module specifier" in detail or "static string argument" in detail:
                label = "computed dynamic import/require"
            else:
                label = "unsupported module-loading syntax"
            errors.append(f"{path}: {label} in '{relative}': {detail}")
        result[relative] = set(specifiers)
    for omitted in sorted(set(sources) - seen):
        errors.append(f"{path}: AST route dependency parser omitted '{omitted}'")
    return result


def _derive_source_edges(
    paths: list[str], run: RunContext, path: str, errors: list[str]
) -> set[tuple[str, str]]:
    if run.base_dir is None:
        return set()
    scanned = set(paths)
    edges: set[tuple[str, str]] = set()
    external_packages: set[str] = set()
    local_packages: set[str] = set()
    for manifest_path in sorted(value for value in paths if PurePosixPath(value).name == "package.json"):
        target = (run.base_dir / manifest_path).resolve()
        try:
            manifest = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, ValueError):
            errors.append(f"{path}: scanned package manifest '{manifest_path}' is not valid JSON")
            continue
        if not isinstance(manifest, dict):
            errors.append(f"{path}: scanned package manifest '{manifest_path}' must be an object")
            continue
        name = manifest.get("name")
        if isinstance(name, str) and name:
            local_packages.add(name)
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            dependencies = manifest.get(section, {})
            if not isinstance(dependencies, dict):
                continue
            for package_name, version in dependencies.items():
                if not isinstance(package_name, str) or not isinstance(version, str):
                    continue
                if version.startswith(("workspace:", "file:", "link:", "./", "../")):
                    local_packages.add(package_name)
                else:
                    external_packages.add(package_name)
        workspaces = manifest.get("workspaces", [])
        if isinstance(workspaces, dict):
            workspaces = workspaces.get("packages", [])
        if isinstance(workspaces, list):
            for workspace_pattern in workspaces:
                if not isinstance(workspace_pattern, str) or not workspace_pattern:
                    continue
                if PurePosixPath(workspace_pattern).is_absolute() or ".." in PurePosixPath(workspace_pattern).parts:
                    errors.append(
                        f"{path}: package manifest '{manifest_path}' has an unsafe workspace pattern"
                    )
                    continue
                for workspace_target in target.parent.glob(workspace_pattern):
                    workspace_manifest = (
                        workspace_target / "package.json"
                        if workspace_target.is_dir() else workspace_target
                    )
                    if workspace_manifest.name != "package.json" or not workspace_manifest.is_file():
                        continue
                    try:
                        resolved_workspace = workspace_manifest.resolve()
                        resolved_workspace.relative_to(run.base_dir)
                        workspace_value = json.loads(
                            resolved_workspace.read_text(encoding="utf-8")
                        )
                    except (OSError, UnicodeError, ValueError):
                        errors.append(
                            f"{path}: workspace manifest '{workspace_manifest}' is unreadable or invalid"
                        )
                        continue
                    workspace_name = (
                        workspace_value.get("name") if isinstance(workspace_value, dict) else None
                    )
                    if isinstance(workspace_name, str) and workspace_name:
                        local_packages.add(workspace_name)
    interception_patterns = (
        re.compile(r"\b(?:page|context)\s*\.\s*route\s*\("),
        re.compile(r"\broute\s*\.\s*fulfill\s*\("),
        re.compile(r"\brouteFromHAR\s*\("),
        re.compile(r"\bserviceWorkers?\s*:"),
        re.compile(r"\bproxy\s*:"),
    )
    source_suffixes = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
    sources: dict[str, str] = {}
    for relative in paths:
        if PurePosixPath(relative).suffix.lower() not in source_suffixes:
            continue
        target = (run.base_dir / relative).resolve()
        if not target.is_file():
            continue
        try:
            source_text = target.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            errors.append(f"{path}: scanned source '{relative}' is not readable UTF-8")
            continue
        sources[relative] = source_text
        if any(pattern.search(source_text) for pattern in interception_patterns):
            errors.append(
                f"{path}: scanned source contains browser interception/replay behavior "
                f"in '{relative}'"
            )
    parsed_specifiers = _parse_module_specifiers(sources, path, errors)
    for relative, specifiers in sorted(parsed_specifiers.items()):
        for specifier in sorted(specifiers):
            if specifier.startswith("node:"):
                continue
            if specifier.startswith("."):
                resolved = _resolve_relative_import(relative, specifier, scanned, path, errors)
                if resolved:
                    edges.add((relative, resolved))
                continue
            parts = specifier.split("/")
            package_name = "/".join(parts[:2]) if specifier.startswith("@") and len(parts) >= 2 else parts[0]
            if package_name in local_packages or package_name not in external_packages:
                errors.append(
                    f"{path}: unresolved non-relative import '{specifier}' from '{relative}'; "
                    "local aliases/workspaces must resolve to scanned files and external packages "
                    "must be declared by a scanned package.json"
                )
    return edges


def _validate_route_scan_files(
    report: dict[str, Any], scan_roots: list[str], expected_entrypoints: list[str], run: RunContext,
    path: str, errors: list[str]
) -> list[str]:
    declared_paths = require_text_list(report, "scanned_paths", path, errors)
    items = require_list(report, "scanned_files", path, errors)
    normalized_files: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        item_path = f"{path}.scanned_files[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        relative = require_text(item, "path", item_path, errors)
        digest = require_text(item, "sha256", item_path, errors)
        normalized = _normalized_scan_path(relative, f"{item_path}.path", errors) if relative else None
        if digest and re.fullmatch(r"[0-9a-fA-F]{64}", digest) is None:
            errors.append(f"{item_path}.sha256: required SHA-256 hex digest")
        if not normalized or not digest:
            continue
        if normalized in seen:
            errors.append(f"{item_path}.path: duplicate scanned file '{normalized}'")
        seen.add(normalized)
        normalized_files.append({"path": normalized, "sha256": digest.lower()})
        if run.base_dir is not None:
            target = (run.base_dir / normalized).resolve()
            try:
                target.relative_to(run.base_dir)
            except ValueError:
                errors.append(f"{item_path}.path: scanned file escapes the ledger directory")
                continue
            if not target.is_file():
                errors.append(f"{item_path}.path: scanned file does not exist")
            elif sha256_file(target) != digest.lower():
                errors.append(f"{item_path}.sha256: does not match scanned file content")
    normalized_files.sort(key=lambda item: item["path"])
    paths = [item["path"] for item in normalized_files]
    if declared_paths != paths:
        errors.append(f"{path}: scanned_paths must exactly match sorted scanned_files paths")

    path_set = set(paths)
    entrypoints: list[str] = []
    for index, value in enumerate(require_text_list(report, "entrypoints", path, errors)):
        normalized = _normalized_scan_path(value, f"{path}.entrypoints[{index}]", errors)
        if normalized:
            entrypoints.append(normalized)
    executed_specs: list[str] = []
    for index, value in enumerate(require_text_list(report, "executed_spec_paths", path, errors)):
        normalized = _normalized_scan_path(value, f"{path}.executed_spec_paths[{index}]", errors)
        if normalized:
            executed_specs.append(normalized)
    if len(entrypoints) != len(set(entrypoints)):
        errors.append(f"{path}.entrypoints: duplicate paths are forbidden")
    if len(executed_specs) != len(set(executed_specs)):
        errors.append(f"{path}.executed_spec_paths: duplicate paths are forbidden")
    if sorted(entrypoints) != sorted(expected_entrypoints):
        errors.append(f"{path}: route scan entrypoints do not match frozen browser scope")
    for value in entrypoints + executed_specs:
        if value not in path_set:
            errors.append(f"{path}: route scan entrypoint/executed spec references an unscanned file")
    if not set(entrypoints).issubset(executed_specs):
        errors.append(f"{path}: every route scan entrypoint must be an executed spec")
    if not any(
        re.search(r"(?:^|/)[^/]+\.(?:spec|test)\.[^/]+$", value, re.IGNORECASE)
        for value in executed_specs
    ):
        errors.append(f"{path}: route scan must include a real executed spec path")

    dependency_edges: list[dict[str, str]] = []
    seen_edges: set[tuple[str, str]] = set()
    for index, item in enumerate(require_list(report, "dependency_edges", path, errors, allow_empty=True)):
        item_path = f"{path}.dependency_edges[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        source = require_text(item, "from", item_path, errors)
        target = require_text(item, "to", item_path, errors)
        normalized_source = _normalized_scan_path(source, f"{item_path}.from", errors) if source else None
        normalized_target = _normalized_scan_path(target, f"{item_path}.to", errors) if target else None
        if not normalized_source or not normalized_target:
            continue
        edge = (normalized_source, normalized_target)
        if edge in seen_edges:
            errors.append(f"{item_path}: duplicate dependency edge")
        seen_edges.add(edge)
        dependency_edges.append({"from": normalized_source, "to": normalized_target})
        if normalized_source not in path_set or normalized_target not in path_set:
            errors.append(f"{item_path}: dependency edge references an unscanned file")
    dependency_edges.sort(key=lambda item: (item["from"], item["to"]))
    derived_edges = _derive_source_edges(paths, run, path, errors)
    if seen_edges != derived_edges:
        errors.append(f"{path}: dependency_edges do not match resolved source imports")

    adjacency: dict[str, set[str]] = {}
    for edge in dependency_edges:
        adjacency.setdefault(edge["from"], set()).add(edge["to"])
    reachable = set(entrypoints)
    pending = list(entrypoints)
    while pending:
        source = pending.pop()
        for target in adjacency.get(source, set()):
            if target not in reachable:
                reachable.add(target)
                pending.append(target)
    helper_paths = {
        value for value in paths
        if re.search(r"(?:^|/)(?:fixtures?|helpers?|setup)(?:/|\.|$)", value, re.IGNORECASE)
    }
    for helper in sorted(helper_paths - reachable):
        errors.append(f"{path}: transitive fixture/helper '{helper}' is unreachable from an entrypoint")

    graph = {
        "scanned_files": normalized_files,
        "dependency_edges": dependency_edges,
        "entrypoints": sorted(entrypoints),
        "executed_spec_paths": sorted(executed_specs),
    }
    expected_graph_digest = "sha256:" + canonical_digest(graph)
    if report.get("resolved_dependency_graph_digest") != expected_graph_digest:
        errors.append(f"{path}: route scan dependency graph digest does not match the resolved graph")
    normalized_roots = [
        normalized for root in scan_roots
        if (normalized := _normalized_scan_path(root, f"{path}.route_scan_roots", errors))
    ]
    for root in normalized_roots:
        if run.base_dir is None:
            prefix = root.rstrip("/") + "/"
            if not any(scanned == root or scanned.startswith(prefix) for scanned in paths):
                errors.append(f"{path}: route scan does not cover frozen root '{root}'")
            continue
        root_target = (run.base_dir / root).resolve()
        try:
            root_target.relative_to(run.base_dir)
        except ValueError:
            errors.append(f"{path}: route scan root '{root}' escapes the ledger directory")
            continue
        expected_files: set[str] = set()
        if root_target.is_file():
            expected_files.add(root)
        elif root_target.is_dir():
            for child in root_target.rglob("*"):
                if not child.is_file():
                    continue
                resolved_child = child.resolve()
                try:
                    relative_child = resolved_child.relative_to(run.base_dir).as_posix()
                except ValueError:
                    errors.append(
                        f"{path}: file beneath route scan root '{root}' escapes the ledger directory"
                    )
                    continue
                expected_files.add(relative_child)
        else:
            errors.append(f"{path}: frozen route scan root '{root}' does not exist")
            continue
        for omitted in sorted(expected_files - set(paths)):
            errors.append(f"{path}: route scan root '{root}' omits file '{omitted}'")
    return paths


def _validate_browser(
    journey: dict[str, Any],
    path: str,
    journey_id: str | None,
    entry_kind: str | None,
    case_state: CaseState,
    terminal_claim: str | None,
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> tuple[set[str], dict[str, Any]]:
    browser = journey.get("browser")
    item_path = f"{path}.browser"
    if not isinstance(browser, dict):
        errors.append(f"{item_path}: required object")
        return set(), {}
    required = require_bool(browser, "required", item_path, errors)
    if entry_kind == "browser" and required is not True:
        errors.append(f"{item_path}: browser entry requires browser.required true")
    if not required:
        reason = require_text(browser, "reason", item_path, errors)
        refs = set(require_refs(browser, "applicability_evidence", item_path, errors))
        require_types(refs, {"scope-plan", "source-identity", "provenance-report"}, catalog, item_path, errors)
        return set(), {"required": False, "reason": reason}

    case_id = require_text(browser, "case_id", item_path, errors)
    route = require_text(browser, "route", item_path, errors)
    browser_name = require_text(browser, "browser", item_path, errors)
    project = require_text(browser, "project", item_path, errors)
    persona = require_text(browser, "persona", item_path, errors)
    viewports = require_text_list(browser, "viewports", item_path, errors)
    expected_failures = require_text_list(
        browser, "expected_network_failures", item_path, errors, allow_empty=True
    )
    expected_actions = require_text_list(browser, "expected_actions", item_path, errors)
    expected_dom_assertions = require_text_list(
        browser, "expected_dom_assertions", item_path, errors
    )
    expected_network_observations = require_text_list(
        browser, "expected_network_observations", item_path, errors
    )
    for key, values, validator in (
        ("expected_actions", expected_actions, is_browser_action),
        ("expected_dom_assertions", expected_dom_assertions, is_dom_assertion),
        ("expected_network_observations", expected_network_observations, is_network_assertion),
    ):
        if any(not validator(value) for value in values):
            errors.append(
                f"{item_path}.{key} must contain canonical machine-readable browser assertions"
            )
    scan_roots = require_text_list(browser, "route_scan_roots", item_path, errors)
    scan_entrypoints = require_text_list(browser, "route_scan_entrypoints", item_path, errors)
    spec = {
        "required": True,
        "case_id": case_id,
        "route": route,
        "browser": browser_name,
        "project": project,
        "persona": persona,
        "viewports": viewports,
        "expected_network_failures": expected_failures,
        "expected_actions": expected_actions,
        "expected_dom_assertions": expected_dom_assertions,
        "expected_network_observations": expected_network_observations,
        "route_scan_roots": scan_roots,
        "route_scan_entrypoints": scan_entrypoints,
    }
    report_refs = set(require_refs(browser, "report_evidence", item_path, errors))
    scan_refs = set(require_refs(browser, "route_scan_evidence", item_path, errors))
    require_types(report_refs, {"browser-report"}, catalog, item_path, errors)
    require_types(scan_refs, {"route-scan-report"}, catalog, item_path, errors)
    if not report_refs.issubset(run.outputs_by_kind.get("browser", set())):
        errors.append(f"{item_path}.report_evidence: must be output by a browser command")
    if not scan_refs.issubset(run.outputs_by_kind.get("route-interception-scan", set())):
        errors.append(f"{item_path}.route_scan_evidence: must be output by a route-interception-scan command")
    require_independent({"browser": report_refs, "route-scan": scan_refs}, catalog, item_path, errors)
    correlation = case_state.correlations.get(case_id or "")
    require_correlation(report_refs, correlation, catalog, item_path, errors, exact=True)
    require_journey_scope(report_refs | scan_refs, journey_id, catalog, item_path, errors)
    require_case_scope(report_refs, case_id, catalog, item_path, errors, exact=True)
    if case_id not in case_state.passing_cases:
        errors.append(f"{item_path}.case_id: browser report must bind to a passing Case")
    for ref in report_refs:
        report = payload(ref, "browser-report", catalog)
        if report is not None:
            _validate_browser_report(report, spec, terminal_claim, item_path, errors)
    for ref in scan_refs:
        report = payload(ref, "route-scan-report", catalog)
        if report is None:
            continue
        if report.get("status") != "pass":
            errors.append(f"{item_path}: route-scan-report status must be pass")
        if report.get("first_party_interceptions") != []:
            errors.append(f"{item_path}: first-party route interception is forbidden")
        if report.get("transitive_fixtures_scanned") is not True:
            errors.append(f"{item_path}: route scan must cover transitive fixtures")
        scanned_paths = _validate_route_scan_files(
            report, scan_roots, scan_entrypoints, run, item_path, errors
        )
        if not any(
            re.search(r"(?:^|/)(?:fixtures?|helpers?|setup)(?:/|\.|$)", value, re.IGNORECASE)
            for value in scanned_paths
        ):
            errors.append(f"{item_path}: route scan must include transitive fixtures/helpers")
        for key in (
            "runtime_interception_events", "har_routes", "service_worker_routes", "proxy_routes"
        ):
            if report.get(key) != []:
                errors.append(f"{item_path}: route-scan-report {key} must be empty")
    return report_refs, spec


def _validate_ci_expectations(
    journey: dict[str, Any], path: str, required: bool | None,
    case_ids: set[str], run: RunContext, errors: list[str]
) -> list[dict[str, Any]]:
    items = require_list(journey, "ci_expectations", path, errors, allow_empty=required is not True)
    if required is True and not items:
        errors.append(f"{path}.ci_expectations: required when ci_required is true")
    if required is False and items:
        errors.append(f"{path}.ci_expectations: must be empty when ci_required is false")
    result: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    source_pairs = {(source.repo, source.revision) for source in run.sources.values()}
    for index, item in enumerate(items):
        item_path = f"{path}.ci_expectations[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        expectation_id = require_text(item, "expectation_id", item_path, errors)
        repository = require_text(item, "repository", item_path, errors)
        head_sha = require_text(item, "head_sha", item_path, errors)
        workflow = require_text(item, "workflow", item_path, errors)
        job = require_text(item, "job", item_path, errors)
        environment = require_text(item, "environment", item_path, errors)
        runner_os = require_text(item, "runner_os", item_path, errors)
        labels = sorted(require_text_list(item, "runner_labels", item_path, errors))
        required_case_list = require_text_list(item, "required_case_ids", item_path, errors)
        if len(required_case_list) != len(set(required_case_list)):
            errors.append(
                f"{item_path}.required_case_ids: duplicate required Case IDs are forbidden"
            )
        required_cases = sorted(required_case_list)
        matrix = item.get("matrix")
        if not isinstance(matrix, dict) or not matrix:
            errors.append(f"{item_path}.matrix: required non-empty object")
            matrix = {}
        if repository and head_sha and (repository, head_sha) not in source_pairs:
            errors.append(f"{item_path}: repository/head_sha must match run.sources")
        unknown_cases = set(required_cases) - case_ids
        if unknown_cases:
            errors.append(f"{item_path}: unknown required Cases {', '.join(sorted(unknown_cases))}")
        if expectation_id in seen_ids:
            errors.append(f"{item_path}.expectation_id: duplicate '{expectation_id}'")
        if expectation_id:
            seen_ids.add(expectation_id)
        result.append({
            "expectation_id": expectation_id,
            "repository": repository,
            "head_sha": head_sha,
            "workflow": workflow,
            "job": job,
            "matrix": matrix,
            "environment": environment,
            "runner_os": runner_os,
            "runner_labels": labels,
            "required_case_ids": required_cases,
        })
    return sorted(result, key=canonical_digest)


def _validate_grill(
    journey: dict[str, Any],
    path: str,
    journey_id: str | None,
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> None:
    grill = journey.get("grill")
    item_path = f"{path}.grill"
    if not isinstance(grill, dict):
        errors.append(f"{item_path}: required object")
        return
    if grill.get("status") != "pass":
        errors.append(f"{item_path}.status: must be 'pass'")
    refs = set(require_refs(grill, "evidence", item_path, errors))
    require_types(refs, {"subagent-report"}, catalog, item_path, errors)
    require_journey_scope(refs, journey_id, catalog, item_path, errors)
    roles = run.roles_by_journey.get(journey_id or "", {})
    if not ({"grill reviewer", "griller"} & set(roles)):
        errors.append(f"{item_path}: requires an independent Grill Reviewer")
    for index, finding in enumerate(require_list(grill, "findings", item_path, errors, allow_empty=True)):
        finding_path = f"{item_path}.findings[{index}]"
        if not isinstance(finding, dict):
            errors.append(f"{finding_path}: required object")
            continue
        require_text(finding, "finding_id", finding_path, errors)
        require_text(finding, "claim", finding_path, errors)
        severity = require_text(finding, "severity", finding_path, errors)
        status = require_text(finding, "status", finding_path, errors)
        require_refs(finding, "evidence", finding_path, errors)
        if severity not in {"P0", "P1", "P2"}:
            errors.append(f"{finding_path}.severity: must be P0, P1, or P2")
        if status not in {"open", "fixed", "resolved", "accepted"}:
            errors.append(f"{finding_path}.status: unsupported finding status")
        if severity in {"P0", "P1"}:
            if status not in {"fixed", "resolved"}:
                errors.append(f"{finding_path}: open {severity} blocks closure")
            require_refs(finding, "resolution_evidence", finding_path, errors)


def _enforce_roles(journey_id: str | None, run: RunContext, path: str, errors: list[str]) -> None:
    roles = run.roles_by_journey.get(journey_id or "", {})
    if "journey mapper" not in roles:
        errors.append(f"{path}: Journey mode requires a completed Journey Mapper subagent")
    designers = {"test/contract designer", "test designer", "contract designer", "journey runner"}
    if not designers & set(roles):
        errors.append(f"{path}: Journey mode requires a completed Test/Contract Designer or Journey Runner subagent")
    if not {"grill reviewer", "griller"} & set(roles):
        errors.append(f"{path}: Journey mode requires a completed Grill Reviewer subagent")
    selected = [roles[role] for role in roles if role in designers | {"journey mapper", "grill reviewer", "griller"}]
    if len(set(selected)) < 3:
        errors.append(f"{path}: Journey roles require three distinct agent IDs")


def _enforce_dimensions(
    statuses: dict[str, str], hop_state: HopState, entry_kind: str | None, path: str, errors: list[str]
) -> set[str]:
    required = {"A", "E", "F", "J"}
    if entry_kind == "browser" or "browser" in hop_state.transports:
        required |= {"B", "C"}
    if hop_state.transports & DATA_TRANSPORTS:
        required.add("D")
    if "message/event" in hop_state.transports:
        required |= {"G", "H"}
    if hop_state.risks & {"duplicate", "ordering", "idempotency"}:
        required.add("G")
    if hop_state.risks & {"retry", "timeout", "replay", "dlq", "compensation"}:
        required.add("H")
    if "compatibility" in hop_state.risks:
        required.add("I")
    for dimension in sorted(required):
        if statuses.get(dimension) != "pass":
            errors.append(f"{path}.dimensions.{dimension}: must pass for this Journey")
    return required


def validate_journey(
    journey: Any,
    index: int,
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> JourneyResult:
    path = f"journeys[{index}]"
    if not isinstance(journey, dict):
        errors.append(f"{path}: required object")
        return JourneyResult(None, set(), set(), set(), set(), set(), {})
    journey_id = require_text(journey, "journey_id", path, errors)
    requirement_ids = require_text_list(journey, "requirement_ids", path, errors)
    business_outcome = require_text(journey, "business_outcome", path, errors)
    entry = journey.get("entry")
    entry_kind = require_text(entry, "kind", f"{path}.entry", errors)
    entry_description = require_text(entry, "description", f"{path}.entry", errors)
    if entry_kind not in {"browser", "api", "cli", "scheduler", "event"}:
        errors.append(f"{path}.entry.kind: unsupported ingress kind")
    first_party = set(require_text_list(journey, "first_party_components", path, errors))
    ci_required = require_bool(journey, "ci_required", path, errors)
    for component in first_party:
        if component not in run.sources:
            errors.append(f"{path}.first_party_components: '{component}' lacks source identity")
        if component not in run.service_components:
            errors.append(f"{path}.first_party_components: '{component}' lacks lifecycle evidence")

    doubles, doubles_projection = _validate_doubles(journey, path, run, catalog, errors)
    paths, path_projection = _validate_paths(journey, path, errors)
    cases, case_projection = _validate_case_definitions(journey, path, paths, doubles, errors)
    ci_projection = _validate_ci_expectations(
        journey, path, ci_required, set(cases), run, errors
    )
    case_state = _validate_case_results(
        journey, path, journey_id, paths, cases, run, catalog, errors
    )
    case_state.path_projection = path_projection
    case_state.case_projection = case_projection
    tdd_refs = _validate_tdd(journey, path, journey_id, case_state, run, catalog, errors)
    hop_state = _validate_hops(
        journey, path, journey_id, first_party, doubles, paths, case_state,
        run, catalog, errors
    )
    terminal_refs, authority_components, terminal_claim, readback_projection = _validate_terminal(
        journey, path, journey_id, first_party, case_state, run, catalog, errors
    )
    browser_refs, browser_projection = _validate_browser(
        journey, path, journey_id, entry_kind, case_state, terminal_claim, run, catalog, errors
    )
    _validate_grill(journey, path, journey_id, run, catalog, errors)
    statuses = _validate_dimensions(
        journey, path, journey_id, case_state, hop_state, run, catalog, errors
    )
    required_dimensions = _enforce_dimensions(statuses, hop_state, entry_kind, path, errors)
    _enforce_roles(journey_id, run, path, errors)

    runtime_refs = case_state.runtime_refs | tdd_refs | hop_state.runtime_refs | terminal_refs | browser_refs
    dimension_projection = {}
    dimensions = journey.get("dimensions") if isinstance(journey.get("dimensions"), dict) else {}
    for dimension in DIMENSIONS:
        item = dimensions.get(dimension)
        entry_projection: dict[str, Any] = {"status": statuses.get(dimension)}
        if isinstance(item, dict) and statuses.get(dimension) == "n_a":
            entry_projection["reason"] = item.get("reason")
        elif isinstance(item, dict) and statuses.get(dimension) == "pass":
            entry_projection.update({
                "required_case_ids": sorted(item.get("required_case_ids", [])),
                "required_hop_ids": sorted(item.get("required_hop_ids", [])),
                "required_authority": item.get("required_authority"),
                "test_obligations": sorted(item.get("test_obligations", [])),
            })
        dimension_projection[dimension] = entry_projection
    terminal = journey.get("terminal_oracle") if isinstance(journey.get("terminal_oracle"), dict) else {}
    projection = {
        "journey_id": journey_id,
        "requirement_ids": sorted(requirement_ids),
        "business_outcome": business_outcome,
        "entry_kind": entry_kind,
        "entry_description": entry_description,
        "first_party_components": sorted(first_party),
        "terminal_claim": terminal_claim,
        "terminal_case_id": terminal.get("case_id"),
        "terminal_authority_components": authority_components,
        "terminal_readback_expectations": readback_projection,
        "mandatory_paths": path_projection,
        "mandatory_hops": hop_state.projection,
        "cases": case_projection,
        "dimension_applicability": dimension_projection,
        "required_dimensions": sorted(required_dimensions),
        "test_doubles": doubles_projection,
        "browser_required": entry_kind == "browser" or "browser" in hop_state.transports,
        "browser_spec": browser_projection,
        "ci_required": ci_required is True,
        "ci_expectations": ci_projection,
    }
    return JourneyResult(
        journey_id,
        set(case_state.correlations.values()),
        runtime_refs,
        case_state.runner_ids,
        set(case_state.definitions),
        hop_state.expected_ids,
        projection,
    )
