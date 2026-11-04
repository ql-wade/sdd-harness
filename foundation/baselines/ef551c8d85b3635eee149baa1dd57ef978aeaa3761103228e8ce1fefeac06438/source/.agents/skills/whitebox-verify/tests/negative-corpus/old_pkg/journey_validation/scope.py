from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .artifacts import payload, require_types
from .common import Artifact, RunContext, parse_time, require_refs, require_text
from .journey import JourneyResult


def declared_plan_digest(value: Any, errors: list[str]) -> str | None:
    if not isinstance(value, dict):
        errors.append("plan: required object")
        return None
    return require_text(value, "digest", "plan", errors)


def _scope(results: list[JourneyResult], run: RunContext) -> dict[str, Any]:
    journeys = [result.projection for result in results if result.journey_id]
    journeys.sort(key=lambda item: item["journey_id"])
    requirements = sorted(
        {requirement for journey in journeys for requirement in journey["requirement_ids"]}
    )
    topology = sorted(run.service_topology.values(), key=lambda item: item["component"])
    return {"requirements": requirements, "service_topology": topology, "journeys": journeys}


def validate_frozen_plan(
    value: Any,
    results: list[JourneyResult],
    run: RunContext,
    catalog: dict[str, Artifact],
    errors: list[str],
) -> None:
    if not isinstance(value, dict):
        return
    plan_id = require_text(value, "plan_id", "plan", errors)
    if value.get("status") != "frozen":
        errors.append("plan.status: must be 'frozen'")
    frozen_at = parse_time(value.get("frozen_at"), "plan.frozen_at", errors)
    digest = require_text(value, "digest", "plan", errors)
    refs = set(require_refs(value, "evidence", "plan", errors))
    if len(refs) != 1:
        errors.append("plan.evidence: exactly one frozen scope artifact is required")
    require_types(refs, {"scope-plan"}, catalog, "plan.evidence", errors)
    earliest_command = min(
        (command.started_at for command in run.commands.values() if command.started_at),
        default=None,
    )
    if frozen_at and earliest_command and frozen_at > earliest_command:
        errors.append("plan.frozen_at: scope must be frozen before command execution")
    expected_scope = _scope(results, run)
    for ref in refs:
        artifact = catalog.get(ref)
        if artifact is None:
            continue
        if digest != artifact.digest:
            errors.append("plan.digest: must equal the frozen scope artifact SHA-256")
        if artifact.captured_at and earliest_command and artifact.captured_at > earliest_command:
            errors.append("plan.evidence: scope artifact must predate command execution")
        if artifact.path and not artifact.path.is_file():
            errors.append("plan.evidence: scope artifact file does not exist")
        elif artifact.path and earliest_command:
            modified = datetime.fromtimestamp(artifact.path.stat().st_mtime, tz=timezone.utc)
            if modified > earliest_command:
                errors.append("plan.evidence: scope file mtime must predate command execution")
        report = payload(ref, "scope-plan", catalog)
        if report is None:
            continue
        if report.get("plan_id") != plan_id:
            errors.append("plan.evidence: embedded plan_id does not match")
        if report.get("frozen_at") != value.get("frozen_at"):
            errors.append("plan.evidence: embedded frozen_at does not match")
        if report.get("scope") != expected_scope:
            errors.append("plan.evidence: frozen scope does not match current Journey declarations")
