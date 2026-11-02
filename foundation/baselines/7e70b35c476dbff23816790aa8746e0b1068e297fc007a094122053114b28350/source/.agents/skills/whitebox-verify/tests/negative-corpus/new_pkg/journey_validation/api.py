from __future__ import annotations

from pathlib import Path
from typing import Any

from .artifacts import payload, scan_sensitive_content, validate_catalog
from .common import Artifact, RunContext, collect_refs, require_list
from .journey import JourneyResult, validate_journey
from .run import parse_header, validate_run_details
from .scope import declared_plan_digest, validate_frozen_plan


def _validate_unique_journeys(
    results: list[JourneyResult], run: RunContext,
    catalog: dict[str, Artifact], errors: list[str]
) -> None:
    seen_ids: set[str] = set()
    seen_correlations: dict[str, str] = {}
    runtime_owners: dict[str, str] = {}
    runner_owners: dict[str, str] = {}
    for result in results:
        journey_id = result.journey_id
        if not journey_id:
            continue
        if journey_id in seen_ids:
            errors.append(f"journeys: duplicate journey_id '{journey_id}'")
        seen_ids.add(journey_id)
        for correlation in result.correlations:
            owner = seen_correlations.get(correlation)
            if owner:
                errors.append(
                    f"journeys[{journey_id}]: correlation value must be unique per Journey; "
                    f"already used by '{owner}'"
                )
            seen_correlations[correlation] = journey_id
        for evidence_id in result.runtime_refs:
            owner = runtime_owners.get(evidence_id)
            if owner:
                errors.append(
                    f"journeys[{journey_id}]: runtime evidence '{evidence_id}' is already owned by '{owner}'"
                )
            runtime_owners[evidence_id] = journey_id
            artifact = catalog.get(evidence_id)
            if artifact is not None and artifact.journey_ids != {journey_id}:
                errors.append(
                    f"journeys[{journey_id}].runtime_evidence[{evidence_id}]: "
                    f"must be scoped to exactly Journey '{journey_id}'"
                )
        for runner_id in result.runner_ids:
            owner = runner_owners.get(runner_id)
            if owner:
                errors.append(
                    f"journeys[{journey_id}]: runner report '{runner_id}' is already owned by '{owner}'"
                )
            runner_owners[runner_id] = journey_id

    by_id = {result.journey_id: result for result in results if result.journey_id}
    for runner_id, runner in run.runners.items():
        if len(runner.journey_ids) != 1:
            errors.append(f"run.runner_reports[{runner_id}]: must be scoped to exactly one Journey")
            continue
        journey_id = next(iter(runner.journey_ids))
        owner = by_id.get(journey_id)
        if owner is None:
            errors.append(f"run.runner_reports[{runner_id}]: unknown Journey '{journey_id}'")
            continue
        unknown_cases = runner.case_ids - owner.case_ids
        unknown_hops = runner.hop_ids - owner.hop_ids
        if unknown_cases:
            errors.append(
                f"run.runner_reports[{runner_id}]: unknown Case IDs {', '.join(sorted(unknown_cases))}"
            )
        if unknown_hops:
            errors.append(
                f"run.runner_reports[{runner_id}]: unknown Hop IDs {', '.join(sorted(unknown_hops))}"
            )


def _ci_projection(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "expectation_id": report.get("expectation_id"),
        "repository": report.get("repository"),
        "head_sha": report.get("head_sha"),
        "workflow": report.get("workflow"),
        "job": report.get("job"),
        "matrix": report.get("matrix"),
        "environment": report.get("environment"),
        "runner_os": report.get("runner_os"),
        "runner_labels": sorted(report.get("runner_labels", []))
        if isinstance(report.get("runner_labels"), list) else report.get("runner_labels"),
        "required_case_ids": sorted(report.get("required_case_ids", []))
        if isinstance(report.get("required_case_ids"), list) else report.get("required_case_ids"),
    }


def _validate_ci_scope(
    document: dict[str, Any], results: list[JourneyResult], catalog: dict[str, Any], errors: list[str]
) -> None:
    required_by_scope = any(result.projection.get("ci_required") is True for result in results)
    run = document.get("run")
    ci = run.get("ci") if isinstance(run, dict) else None
    declared = ci.get("required") if isinstance(ci, dict) else None
    if declared is not required_by_scope:
        errors.append("run.ci.required: must match the frozen Journey scope")
    expectations: dict[str, tuple[dict[str, Any], str | None]] = {}
    for result in results:
        expected_cases: set[str] = set()
        for item in result.projection.get("ci_expectations", []):
            expectation_id = item.get("expectation_id")
            if expectation_id in expectations:
                errors.append(f"journeys: duplicate CI expectation_id '{expectation_id}'")
            if expectation_id:
                expectations[expectation_id] = (item, result.journey_id)
            expected_cases.update(item.get("required_case_ids", []))
        if result.projection.get("ci_required") is True and expected_cases != result.case_ids:
            errors.append(
                f"journeys[{result.journey_id}].ci_expectations: required_case_ids must cover every Case exactly"
            )
    refs = ci.get("evidence", []) if isinstance(ci, dict) else []
    observed_ids: set[str] = set()
    for ref in refs if isinstance(refs, list) else []:
        report = payload(ref, "ci-report", catalog)
        if report is None:
            continue
        projection = _ci_projection(report)
        expectation_id = projection.get("expectation_id")
        expected_entry = expectations.get(expectation_id)
        expected = expected_entry[0] if expected_entry else None
        owner_journey = expected_entry[1] if expected_entry else None
        if expected is None or projection != expected:
            errors.append(f"run.ci.evidence[{ref}]: does not match a frozen CI expectation")
            continue
        artifact = catalog.get(ref)
        if artifact is not None and artifact.journey_ids != {owner_journey}:
            errors.append(
                f"run.ci.evidence[{ref}]: must be scoped only to Journey '{owner_journey}'"
            )
        if artifact is not None and artifact.case_ids != set(expected.get("required_case_ids", [])):
            errors.append(
                f"run.ci.evidence[{ref}]: artifact Case scope must match required_case_ids"
            )
        if expectation_id in observed_ids:
            errors.append(f"run.ci.evidence[{ref}]: duplicate CI expectation result '{expectation_id}'")
        observed_ids.add(expectation_id)
    missing = set(expectations) - observed_ids
    if missing:
        errors.append(f"run.ci.evidence: missing frozen CI expectations {', '.join(sorted(missing))}")


def validate_document(
    document: Any,
    base_dir: Path | None = None,
    *,
    verify_files: bool = True,
) -> list[str]:
    errors: list[str] = []
    if not isinstance(document, dict):
        return ["root: required JSON object"]
    if document.get("schema_version") != "3.0":
        errors.append("schema_version: must be '3.0'")

    plan_value = document.get("plan")
    plan_digest = declared_plan_digest(plan_value, errors)
    run_value = document.get("run")
    run = parse_header(run_value, plan_digest, errors)
    run.base_dir = base_dir.resolve() if base_dir is not None else None
    catalog = validate_catalog(
        document.get("evidence_catalog"), run, base_dir, verify_files, errors
    )
    if verify_files:
        scan_sensitive_content(catalog, errors)
    validate_run_details(run_value, run, catalog, errors)

    journey_values = require_list(document, "journeys", "root", errors)
    results = [
        validate_journey(journey, index, run, catalog, errors)
        for index, journey in enumerate(journey_values)
    ]
    _validate_unique_journeys(results, run, catalog, errors)
    _validate_ci_scope(document, results, catalog, errors)
    validate_frozen_plan(plan_value, results, run, catalog, errors)

    refs = collect_refs(document, "", errors)
    for evidence_id in sorted(refs - set(catalog)):
        errors.append(f"evidence reference '{evidence_id}' is absent from evidence_catalog")
    for evidence_id in sorted(set(catalog) - refs):
        errors.append(f"evidence_catalog.{evidence_id}: unused evidence entry")
    return errors
