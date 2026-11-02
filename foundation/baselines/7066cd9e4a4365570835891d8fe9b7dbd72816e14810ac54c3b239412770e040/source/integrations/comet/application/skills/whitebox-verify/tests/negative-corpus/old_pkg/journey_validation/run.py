from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .artifacts import payload, require_component_binding, require_types
from .common import (
    Artifact,
    CommandRecord,
    RunContext,
    RunnerRecord,
    SourceIdentity,
    is_text,
    parse_time,
    require_bool,
    require_count,
    require_independent,
    require_list,
    require_refs,
    require_text,
    require_text_list,
)


VALID_PHASES = {
    "identity",
    "red",
    "green",
    "contract",
    "journey",
    "browser",
    "lifecycle",
    "route-scan",
    "grill",
    "security",
    "ci",
}
VALID_KINDS = {
    "test",
    "contract",
    "browser",
    "source-identity",
    "route-interception-scan",
    "lifecycle",
    "redaction",
    "ci",
    "other",
}
VALID_AUTHORITIES = {"unit", "component", "contract", "integration", "real-stack", "browser/ux"}
MAX_RUN_DURATION = timedelta(hours=24)
FUTURE_SKEW = timedelta(seconds=5)


def _revision_map(value: Any, run: RunContext, path: str, errors: list[str]) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        errors.append(f"{path}: required non-empty component->revision object")
        return {}
    result: dict[str, str] = {}
    for component, revision in value.items():
        if not is_text(component) or not is_text(revision):
            errors.append(f"{path}: component and revision must be non-placeholder strings")
            continue
        result[component] = revision
        source = run.sources.get(component)
        if source is None:
            errors.append(f"{path}.{component}: component is absent from run.sources")
        elif source.revision != revision:
            errors.append(f"{path}.{component}: revision does not match run.sources")
    return result


def _fingerprint_map(
    value: Any, run: RunContext, path: str, errors: list[str]
) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        errors.append(f"{path}: required non-empty component->fingerprint object")
        return {}
    result: dict[str, str] = {}
    for component, fingerprint in value.items():
        if not is_text(component) or not is_text(fingerprint):
            errors.append(f"{path}: component and fingerprint must be non-placeholder strings")
            continue
        result[component] = fingerprint
        if component not in run.sources:
            errors.append(f"{path}.{component}: component is absent from run.sources")
    return result


def parse_header(value: Any, plan_digest: str | None, errors: list[str]) -> RunContext:
    run = RunContext(plan_digest=plan_digest)
    if not isinstance(value, dict):
        errors.append("run: required object")
        return run
    run.run_id = require_text(value, "run_id", "run", errors)
    status = require_text(value, "status", "run", errors)
    if status and status != "executed":
        errors.append("run.status: must be 'executed' for closure")
    run.started_at = parse_time(value.get("started_at"), "run.started_at", errors)
    run.completed_at = parse_time(value.get("completed_at"), "run.completed_at", errors)
    require_text(value, "environment", "run", errors)
    if run.started_at and run.completed_at:
        if run.completed_at < run.started_at:
            errors.append("run.completed_at: must not precede started_at")
        if run.completed_at - run.started_at > MAX_RUN_DURATION:
            errors.append("run: duration exceeds 24 hours; split evidence into bounded runs")
        if run.completed_at > datetime.now(timezone.utc) + FUTURE_SKEW:
            errors.append("run.completed_at: must not be in the future")

    for index, item in enumerate(require_list(value, "sources", "run", errors)):
        path = f"run.sources[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path}: required object")
            continue
        component = require_text(item, "component", path, errors)
        repo = require_text(item, "repo", path, errors)
        revision = require_text(item, "revision", path, errors)
        fingerprint = require_text(item, "dirty_fingerprint", path, errors)
        build_digest = require_text(item, "build_digest", path, errors)
        refs = set(require_refs(item, "identity_evidence", path, errors))
        if component and component in run.sources:
            errors.append(f"{path}.component: duplicate '{component}'")
        if all((component, repo, revision, fingerprint, build_digest)):
            run.sources[component] = SourceIdentity(
                component, repo, revision, fingerprint, build_digest
            )
            run.source_identity_refs[component] = refs
    return run


def _compare_command_payload(
    declared: dict[str, Any], ref: str, catalog: dict[str, Artifact], path: str, errors: list[str]
) -> None:
    report = payload(ref, "command-report", catalog)
    if report is None:
        return
    keys = (
        "command_id",
        "phase",
        "kind",
        "command",
        "expected",
        "exit_code",
        "started_at",
        "completed_at",
        "test_identity",
        "source_revisions",
        "source_fingerprints",
        "outputs",
    )
    for key in keys:
        if report.get(key) != declared.get(key):
            errors.append(f"{path}: command-report field '{key}' does not match the ledger")


def _validate_command_semantics(
    phase: str | None,
    kind: str | None,
    expected: str | None,
    exit_code: Any,
    test_identity: Any,
    path: str,
    errors: list[str],
) -> int:
    if phase and phase not in VALID_PHASES:
        errors.append(f"{path}.phase: unsupported phase '{phase}'")
    if kind and kind not in VALID_KINDS:
        errors.append(f"{path}.kind: unsupported command kind '{kind}'")
    if expected not in {"pass", "fail"}:
        errors.append(f"{path}.expected: must be 'pass' or 'fail'")
    if type(exit_code) is not int:
        errors.append(f"{path}.exit_code: required integer")
        return 0
    if expected == "pass" and exit_code != 0:
        errors.append(f"{path}.exit_code: pass command must exit zero")
    if expected == "fail" and exit_code == 0:
        errors.append(f"{path}.exit_code: expected-fail command must exit non-zero")
    if expected == "fail" and phase != "red":
        errors.append(f"{path}: only RED phase may expect failure")
    if phase in {"red", "green"} and not is_text(test_identity):
        errors.append(f"{path}.test_identity: required for RED/GREEN commands")
    return exit_code


def _validate_command_times(started: Any, completed: Any, run: RunContext, path: str, errors: list[str]) -> None:
    if started and completed and completed < started:
        errors.append(f"{path}.completed_at: must not precede started_at")
    if started and run.started_at and started < run.started_at:
        errors.append(f"{path}.started_at: predates run.started_at")
    if completed and run.completed_at and completed > run.completed_at:
        errors.append(f"{path}.completed_at: exceeds run.completed_at")


def _parse_command(
    item: Any,
    path: str,
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> CommandRecord | None:
    if not isinstance(item, dict):
        errors.append(f"{path}: required object")
        return None
    command_id = require_text(item, "command_id", path, errors)
    phase = require_text(item, "phase", path, errors)
    kind = require_text(item, "kind", path, errors)
    command = require_text(item, "command", path, errors)
    expected = require_text(item, "expected", path, errors)
    started = parse_time(item.get("started_at"), f"{path}.started_at", errors)
    completed = parse_time(item.get("completed_at"), f"{path}.completed_at", errors)
    test_identity = item.get("test_identity")
    revisions = _revision_map(
        item.get("source_revisions"), run, f"{path}.source_revisions", errors
    )
    fingerprints = _fingerprint_map(
        item.get("source_fingerprints"), run, f"{path}.source_fingerprints", errors
    )
    refs = set(require_refs(item, "evidence", path, errors))
    outputs = set(require_refs(item, "outputs", path, errors, allow_empty=True))
    exit_code = _validate_command_semantics(
        phase, kind, expected, item.get("exit_code"), test_identity, path, errors
    )
    _validate_command_times(started, completed, run, path, errors)
    require_types(refs, {"command-report"}, catalog, f"{path}.evidence", errors)
    for ref in refs:
        _compare_command_payload(item, ref, catalog, path, errors)
    if not command_id:
        return None
    return CommandRecord(
        command_id=command_id,
        phase=phase or "",
        kind=kind or "",
        command=command or "",
        expected=expected or "",
        exit_code=exit_code,
        started_at=started,
        completed_at=completed,
        evidence=refs,
        outputs=outputs,
        test_identity=test_identity.strip() if is_text(test_identity) else None,
        source_fingerprints=fingerprints,
        source_revisions=revisions,
    )


def _register_command(record: CommandRecord, run: RunContext, path: str, errors: list[str]) -> None:
    if record.command_id in run.commands:
        errors.append(f"{path}.command_id: duplicate '{record.command_id}'")
    run.commands[record.command_id] = record
    run.outputs_by_kind.setdefault(record.kind, set()).update(record.outputs)


def _validate_source_identities(run: RunContext, catalog: dict[str, Artifact], errors: list[str]) -> None:
    for component, refs in run.source_identity_refs.items():
        path = f"run.sources[{component}].identity_evidence"
        require_types(refs, {"source-identity"}, catalog, path, errors)
        if not refs.issubset(run.outputs_by_kind.get("source-identity", set())):
            errors.append(f"{path}: must be output by a source-identity command")
        require_component_binding(refs, component, catalog, path, errors)
        expected = run.sources[component].as_dict()
        for ref in refs:
            report = payload(ref, "source-identity", catalog)
            if report is None:
                continue
            for key, expected_value in expected.items():
                if report.get(key) != expected_value:
                    errors.append(f"{path}: '{ref}' field '{key}' does not match run.sources")


def validate_commands(
    value: Any, run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    for index, item in enumerate(require_list(value, "commands", "run", errors)):
        path = f"run.commands[{index}]"
        record = _parse_command(item, path, run, catalog, errors)
        if record is not None:
            _register_command(record, run, path, errors)
    _validate_source_identities(run, catalog, errors)


def _compare_runner_payload(
    declared: dict[str, Any], ref: str, catalog: dict[str, Artifact], path: str, errors: list[str]
) -> None:
    report = payload(ref, "runner-report", catalog)
    if report is None:
        return
    keys = (
        "report_id",
        "command_id",
        "phase",
        "authority",
        "project",
        "source_revisions",
        "passed",
        "failed",
        "skipped",
        "retried",
        "flaky",
        "dimension_results",
        "journey_ids",
        "case_ids",
        "hop_ids",
    )
    for key in keys:
        if report.get(key) != declared.get(key):
            errors.append(f"{path}: runner-report field '{key}' does not match the ledger")


def _validate_runner_counts(item: dict[str, Any], phase: str | None, path: str, errors: list[str]) -> None:
    counts = {
        name: require_count(item, name, path, errors)
        for name in ("passed", "failed", "skipped", "retried", "flaky")
    }
    if phase == "red":
        if not counts.get("failed"):
            errors.append(f"{path}.failed: RED report must contain a real failing test")
        return
    if not counts.get("passed"):
        errors.append(f"{path}.passed: closing report must contain a passing test")
    for name in ("failed", "skipped", "retried", "flaky"):
        if counts.get(name) not in {0, None}:
            errors.append(f"{path}.{name}: must be zero for closure")


def _validate_runner_command(
    command_id: str | None,
    phase: str | None,
    refs: set[str],
    run: RunContext,
    path: str,
    errors: list[str],
) -> None:
    command = run.commands.get(command_id or "")
    if command is None:
        errors.append(f"{path}.command_id: undeclared command '{command_id}'")
        return
    if phase != command.phase:
        errors.append(f"{path}.phase: must match command phase")
    if not refs.issubset(command.outputs):
        errors.append(f"{path}.evidence: runner report must be a declared command output")


def _parse_runner(
    item: Any, path: str, run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> RunnerRecord | None:
    if not isinstance(item, dict):
        errors.append(f"{path}: required object")
        return None
    report_id = require_text(item, "report_id", path, errors)
    command_id = require_text(item, "command_id", path, errors)
    phase = require_text(item, "phase", path, errors)
    authority = require_text(item, "authority", path, errors)
    project = require_text(item, "project", path, errors)
    revisions = _revision_map(
        item.get("source_revisions"), run, f"{path}.source_revisions", errors
    )
    journey_ids = set(require_text_list(item, "journey_ids", path, errors))
    case_ids = set(require_text_list(item, "case_ids", path, errors, allow_empty=True))
    hop_ids = set(require_text_list(item, "hop_ids", path, errors, allow_empty=True))
    refs = set(require_refs(item, "evidence", path, errors))
    require_types(refs, {"runner-report"}, catalog, f"{path}.evidence", errors)
    for ref in refs:
        _compare_runner_payload(item, ref, catalog, path, errors)
    _validate_runner_command(command_id, phase, refs, run, path, errors)
    _validate_runner_counts(item, phase, path, errors)
    if authority and authority not in VALID_AUTHORITIES:
        errors.append(f"{path}.authority: unsupported authority '{authority}'")
    if not report_id:
        return None
    return RunnerRecord(
        report_id, command_id or "", phase or "", authority or "",
        project or "", revisions, journey_ids, case_ids, hop_ids, refs
    )


def validate_runners(
    value: Any, run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    for index, item in enumerate(require_list(value, "runner_reports", "run", errors)):
        path = f"run.runner_reports[{index}]"
        report = _parse_runner(item, path, run, catalog, errors)
        if report is None:
            continue
        if report.report_id in run.runners:
            errors.append(f"{path}.report_id: duplicate '{report.report_id}'")
        run.runners[report.report_id] = report


def validate_services(
    value: Any, run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    for index, item in enumerate(require_list(value, "services", "run", errors)):
        path = f"run.services[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path}: required object")
            continue
        component = require_text(item, "component", path, errors)
        mode = require_text(item, "mode", path, errors)
        require_text(item, "start_or_deployment", path, errors)
        endpoint = require_text(item, "endpoint", path, errors)
        auth_fixture = require_text(item, "auth_fixture", path, errors)
        start_or_deployment = item.get("start_or_deployment")
        readiness = set(require_refs(item, "readiness_evidence", path, errors))
        lifecycle = set(require_refs(item, "lifecycle_evidence", path, errors))
        logs = set(require_refs(item, "log_evidence", path, errors))
        if component not in run.sources:
            errors.append(f"{path}.component: component lacks run.sources identity")
        if component in run.service_components:
            errors.append(f"{path}.component: duplicate service '{component}'")
        if component:
            run.service_components.add(component)
            run.service_topology[component] = {
                "component": component,
                "mode": mode or "",
                "start_or_deployment": start_or_deployment if is_text(start_or_deployment) else "",
                "endpoint": endpoint or "",
                "auth_fixture": auth_fixture or "",
            }
        if mode not in {"local-process", "shared-deployment"}:
            errors.append(f"{path}.mode: unsupported lifecycle mode")
        require_types(readiness | lifecycle, {"lifecycle-report"}, catalog, path, errors)
        require_types(logs, {"raw-log", "trace"}, catalog, f"{path}.log_evidence", errors)
        outputs = run.outputs_by_kind.get("lifecycle", set())
        if not (readiness | lifecycle | logs).issubset(outputs):
            errors.append(f"{path}: lifecycle evidence must be output by lifecycle commands")
        require_component_binding(readiness | lifecycle | logs, component, catalog, path, errors)
        for ref in readiness | lifecycle:
            report = payload(ref, "lifecycle-report", catalog)
            if report is None:
                continue
            if report.get("component") != component or report.get("mode") != mode:
                errors.append(f"{path}: lifecycle-report does not match component/mode")
            for key in ("ready", "remained_ready"):
                if report.get(key) is not True:
                    errors.append(f"{path}: lifecycle-report {key} must be true")
            expected_teardown = "pass" if mode == "local-process" else "not_applicable"
            if report.get("teardown_status") != expected_teardown:
                errors.append(f"{path}: lifecycle-report teardown_status must be '{expected_teardown}'")


def validate_subagents(
    value: Any, run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    agents: set[str] = set()
    evidence_groups: dict[str, set[str]] = {}
    for index, item in enumerate(require_list(value, "subagents", "run", errors)):
        path = f"run.subagents[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{path}: required object")
            continue
        role = require_text(item, "role", path, errors)
        status = require_text(item, "status", path, errors)
        agent_id = require_text(item, "agent_id", path, errors)
        journey_ids = set(require_text_list(item, "journey_ids", path, errors))
        revisions = _revision_map(item.get("source_revisions"), run, f"{path}.source_revisions", errors)
        refs = set(require_refs(item, "evidence", path, errors))
        require_types(refs, {"subagent-report"}, catalog, f"{path}.evidence", errors)
        if status != "completed":
            errors.append(f"{path}.status: must be 'completed'")
        if agent_id in agents:
            errors.append(f"{path}.agent_id: duplicate agent_id '{agent_id}'")
        if agent_id:
            agents.add(agent_id)
            evidence_groups[agent_id] = refs
        for ref in refs:
            report = payload(ref, "subagent-report", catalog)
            if report is None:
                continue
            expected = {
                "role": role,
                "status": status,
                "agent_id": agent_id,
                "journey_ids": sorted(journey_ids),
                "source_revisions": revisions,
            }
            for key, expected_value in expected.items():
                observed = report.get(key)
                if key == "journey_ids" and isinstance(observed, list):
                    observed = sorted(observed)
                if observed != expected_value:
                    errors.append(f"{path}: subagent-report field '{key}' does not match")
        if role and agent_id:
            for journey_id in journey_ids:
                role_map = run.roles_by_journey.setdefault(journey_id, {})
                role_map[role.lower()] = agent_id
    require_independent(evidence_groups, catalog, "run.subagents", errors)


def _validate_provenance(
    value: dict[str, Any], run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    provenance = value.get("provenance") if isinstance(value, dict) else None
    path = "run.provenance"
    if not isinstance(provenance, dict):
        errors.append(f"{path}: required object")
    else:
        level = require_text(provenance, "level", path, errors)
        refs = set(require_refs(provenance, "evidence", path, errors))
        if level != "local-observed":
            errors.append(
                f"{path}.level: local validator cannot certify cryptographic attestation; "
                "use local-observed and verify signed provenance as a separate external gate"
            )
        expected_type = "provenance-report"
        require_types(refs, {expected_type}, catalog, f"{path}.evidence", errors)
        for ref in refs:
            report = payload(ref, expected_type, catalog)
            if report is None:
                continue
            if report.get("status") != "pass":
                errors.append(f"{path}: provenance report status must be pass")
            if not is_text(report.get("observer")) or report.get("tool_output_capture") is not True:
                errors.append(f"{path}: local provenance requires observer and tool_output_capture=true")
        run.trust_level = "local-observed"


def _valid_sha256_digest(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-fA-F]{64}", value) is not None


def _matrix_masks_failure(value: Any) -> bool:
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower().replace("-", "_") == "continue_on_error" and child is True:
                return True
            if _matrix_masks_failure(child):
                return True
    if isinstance(value, list):
        return any(_matrix_masks_failure(item) for item in value)
    return False


def _validate_ci_case_results(report: dict[str, Any], path: str, errors: list[str]) -> None:
    required_case_list = require_text_list(report, "required_case_ids", path, errors)
    required_cases = set(required_case_list)
    if len(required_case_list) != len(required_cases):
        errors.append(f"{path}.required_case_ids: duplicate required Case IDs are forbidden")
    observed_cases: set[str] = set()
    totals = {key: 0 for key in ("passed", "failed", "skipped", "retried", "flaky")}
    for index, item in enumerate(require_list(report, "case_results", path, errors)):
        item_path = f"{path}.case_results[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: required object")
            continue
        case_id = require_text(item, "case_id", item_path, errors)
        if case_id in observed_cases:
            errors.append(f"{item_path}.case_id: duplicate CI Case '{case_id}'")
        if case_id:
            observed_cases.add(case_id)
        if item.get("status") != "pass":
            errors.append(f"{item_path}.status: must be 'pass'")
        if _matrix_masks_failure(item):
            errors.append(f"{item_path}: Case result cannot use continue-on-error")
        if "run_attempt" in item and item.get("run_attempt") != 1:
            errors.append(f"{item_path}: Case result run_attempt must be 1")
        counts = {
            key: require_count(item, key, item_path, errors)
            for key in totals
        }
        if not counts.get("passed"):
            errors.append(f"{item_path}.passed: must be a positive integer")
        for key in ("failed", "skipped", "retried", "flaky"):
            if counts.get(key) not in {0, None}:
                errors.append(f"{item_path}.{key}: must be zero")
        for key, value in counts.items():
            if value is not None:
                totals[key] += value
    if observed_cases != required_cases:
        errors.append(f"{path}.case_results: Case IDs must exactly match required_case_ids")
    top_level = {
        "passed": report.get("passed"),
        "failed": report.get("failed"),
        "skipped": report.get("skipped_count"),
        "retried": report.get("retried"),
        "flaky": report.get("flaky"),
    }
    if top_level != totals:
        errors.append(f"{path}: top-level counts must equal summed case_results")

def _validate_ci(
    value: dict[str, Any], run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    ci = value.get("ci")
    path = "run.ci"
    if not isinstance(ci, dict):
        errors.append(f"{path}: required object")
    else:
        required = require_bool(ci, "required", path, errors)
        refs = set(require_refs(ci, "evidence", path, errors))
        if required:
            require_types(refs, {"ci-report"}, catalog, f"{path}.evidence", errors)
            if not refs.issubset(run.outputs_by_kind.get("ci", set())):
                errors.append(f"{path}.evidence: must be output by a CI command")
            for ref in refs:
                report = payload(ref, "ci-report", catalog)
                if report is None:
                    continue
                checks = {
                    "conclusion": "success",
                    "skipped": False,
                    "cancelled": False,
                    "continue_on_error": False,
                    "run_attempt": 1,
                    "retried": 0,
                }
                for key, expected in checks.items():
                    if report.get(key) != expected:
                        errors.append(f"{path}: ci-report {key} must be {expected!r}")
                for key in ("repository", "head_sha", "workflow", "job", "environment", "runner_os"):
                    if not is_text(report.get(key)):
                        errors.append(f"{path}: ci-report requires {key}")
                matrix = report.get("matrix")
                if not isinstance(matrix, dict) or not matrix:
                    errors.append(f"{path}: ci-report matrix must be a non-empty object")
                elif _matrix_masks_failure(matrix):
                    errors.append(f"{path}: ci-report matrix cannot mask continue-on-error")
                require_text_list(report, "runner_labels", f"{path}.ci-report", errors)
                for count in ("passed", "failed", "skipped_count", "retried", "flaky"):
                    require_count(report, count, f"{path}.ci-report", errors)
                for count in ("failed", "skipped_count", "retried", "flaky"):
                    if report.get(count) not in {0, None}:
                        errors.append(f"{path}: ci-report {count} must be zero")
                if not report.get("passed"):
                    errors.append(f"{path}: ci-report passed must be a positive integer")
                if not _valid_sha256_digest(report.get("report_artifact_digest")):
                    errors.append(f"{path}: ci-report requires a sha256 report_artifact_digest")
                _validate_ci_case_results(report, f"{path}.ci-report", errors)
        else:
            require_text(ci, "reason", path, errors)

def _validate_redaction(
    value: dict[str, Any], run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    redaction = value.get("redaction")
    path = "run.redaction"
    if not isinstance(redaction, dict):
        errors.append(f"{path}: required object")
        return
    if redaction.get("status") != "pass":
        errors.append(f"{path}.status: must be 'pass'")
    refs = set(require_refs(redaction, "evidence", path, errors))
    require_types(refs, {"redaction-report"}, catalog, f"{path}.evidence", errors)
    if not refs.issubset(run.outputs_by_kind.get("redaction", set())):
        errors.append(f"{path}.evidence: must be output by a redaction command")
    expected_scanned = set(catalog) - refs
    for ref in refs:
        report = payload(ref, "redaction-report", catalog)
        if report is None:
            continue
        if report.get("status") != "pass" or report.get("findings") != []:
            errors.append(f"{path}: redaction-report must pass with no findings")
        scanned = report.get("scanned_evidence_ids")
        if not isinstance(scanned, list) or set(scanned) != expected_scanned:
            errors.append(f"{path}: redaction-report must cover every other evidence artifact")


def validate_provenance_and_gates(
    value: Any, run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    if not isinstance(value, dict):
        return
    _validate_provenance(value, run, catalog, errors)
    _validate_ci(value, run, catalog, errors)
    _validate_redaction(value, run, catalog, errors)


def validate_run_details(
    value: Any, run: RunContext, catalog: dict[str, Artifact], errors: list[str]
) -> None:
    if not isinstance(value, dict):
        return
    validate_commands(value, run, catalog, errors)
    validate_runners(value, run, catalog, errors)
    validate_services(value, run, catalog, errors)
    validate_subagents(value, run, catalog, errors)
    validate_provenance_and_gates(value, run, catalog, errors)
