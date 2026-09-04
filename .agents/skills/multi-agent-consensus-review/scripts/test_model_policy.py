#!/usr/bin/env python3
"""Tests for provider-specific high-tier model discovery and policy guards."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from dispatch_round import write_or_verify_model_selection
from model_policy import ModelPolicyError, resolve_model_selection


POLICY_ENV = (
    "CAR_CLAUDE_MODEL",
    "CAR_CLAUDE_EFFORT",
    "CAR_CODEX_MODEL",
    "CAR_CODEX_EFFORT",
    "CAR_ZCODE_MODEL",
    "CAR_ZCODE_LITE_MODEL",
    "CAR_CLAUDE_MODEL_CATALOG",
    "CAR_CODEX_MODEL_CATALOG",
    "CAR_ZCODE_MODEL_CATALOG",
)


class ModelPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self._saved_env = {name: os.environ.get(name) for name in POLICY_ENV}
        for name in POLICY_ENV:
            os.environ.pop(name, None)

        self.claude = self.root / "claude-settings.json"
        self.claude.write_text(
            json.dumps({"env": {"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "glm-5.3"}}),
            encoding="utf-8",
        )
        self.codex = self.root / "codex-models.json"
        self.codex.write_text(
            json.dumps({
                "models": [{
                    "slug": "gpt-5.6-sol",
                    "supported_in_api": True,
                    "supported_reasoning_levels": [{"effort": "max"}],
                    "context_window": 272000,
                    "max_context_window": 272000,
                }]
            }),
            encoding="utf-8",
        )
        self.zcode = self.root / "zcode-config.json"
        self.zcode.write_text(
            json.dumps({
                "provider": {
                    "builtin:bigmodel-coding-plan": {
                        "enabled": True,
                        "models": {
                            "GLM-5.3": {
                                "reasoning": {
                                    "enabled": True,
                                    "variants": ["low", "max"],
                                }
                            }
                        },
                    }
                }
            }),
            encoding="utf-8",
        )
        os.environ.update({
            "CAR_CLAUDE_MODEL_CATALOG": str(self.claude),
            "CAR_CODEX_MODEL_CATALOG": str(self.codex),
            "CAR_ZCODE_MODEL_CATALOG": str(self.zcode),
        })

    def tearDown(self) -> None:
        for name, value in self._saved_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        self.temp.cleanup()

    def test_resolves_verified_high_tier_models(self) -> None:
        selection = resolve_model_selection()
        self.assertEqual(selection["zcode"]["model"], "bigmodel/GLM-5.3")
        self.assertEqual(selection["claude-code"]["model"], "glm-5.3")
        self.assertEqual(selection["codex-agent"]["model"], "gpt-5.6-sol")
        self.assertTrue(all(item["verified"] for item in selection.values()))

    def test_zcode_requires_max_reasoning(self) -> None:
        config = json.loads(self.zcode.read_text(encoding="utf-8"))
        config["provider"]["builtin:bigmodel-coding-plan"]["models"]["GLM-5.3"]["reasoning"]["variants"] = ["low"]
        self.zcode.write_text(json.dumps(config), encoding="utf-8")
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_codex_requires_max_reasoning(self) -> None:
        config = json.loads(self.codex.read_text(encoding="utf-8"))
        config["models"][0]["supported_reasoning_levels"] = [{"effort": "high"}]
        self.codex.write_text(json.dumps(config), encoding="utf-8")
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_lower_tier_override_is_rejected(self) -> None:
        os.environ["CAR_ZCODE_MODEL"] = "bigmodel/glm-4.7"
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_missing_catalog_is_blocked(self) -> None:
        os.environ["CAR_CODEX_MODEL_CATALOG"] = str(self.root / "missing.json")
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_model_selection_is_frozen_across_rounds(self) -> None:
        selection = resolve_model_selection()
        run_dir = self.root / "run"
        first_digest = write_or_verify_model_selection(run_dir, selection)
        self.assertTrue(first_digest)
        changed = json.loads(json.dumps(selection))
        changed["zcode"]["model"] = "bigmodel/GLM-4.7"
        with self.assertRaises(ModelPolicyError):
            write_or_verify_model_selection(run_dir, changed)


if __name__ == "__main__":
    unittest.main()
