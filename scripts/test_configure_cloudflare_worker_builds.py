#!/usr/bin/env python3
import os
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

import configure_cloudflare_worker_builds as updater
from configure_cloudflare_worker_builds import (
    ALLOWED_PREVIEW_DEPLOY_COMMANDS,
    REPO_ID,
    REPO_NAME,
    TARGET_BUILD_COMMAND,
    changes_for,
    preview_spec,
    validate_trigger,
)

SAFE_DEPLOY = "npx wrangler@4 deploy --config wrangler.preview.jsonc --keep-vars"


def trigger_for(spec, **overrides):
    trigger = {
        "trigger_uuid": spec["trigger_uuid"],
        "external_script_id": spec["tag"],
        "root_directory": "/",
        "branch_includes": [spec["branch"]],
        "branch_excludes": [],
        "deploy_command": SAFE_DEPLOY,
        "build_command": "legacy build command",
        "build_token_uuid": "preview-token-uuid",
        "repo_connection": {"repo_name": REPO_NAME, "repo_id": REPO_ID},
    }
    trigger.update(overrides)
    return trigger


class PreviewTriggerValidationTests(unittest.TestCase):
    def setUp(self):
        self.spec = preview_spec("b" * 32, "00000000-0000-4000-8000-000000000001", "feature/example")

    def test_exact_preview_trigger_is_accepted(self):
        trigger = trigger_for(self.spec)
        self.assertEqual(validate_trigger([trigger], self.spec)["trigger_uuid"], self.spec["trigger_uuid"])

    def test_wrong_worker_tag_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "tag mismatch"):
            validate_trigger([trigger_for(self.spec, external_script_id="wrong-tag")], self.spec)

    def test_wrong_repository_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "repository identity mismatch"):
            validate_trigger([trigger_for(self.spec, repo_connection={"repo_name": "other", "repo_id": "1"})], self.spec)

    def test_wrong_root_directory_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "root directory changed"):
            validate_trigger([trigger_for(self.spec, root_directory="/subdir")], self.spec)

    def test_unapproved_deploy_command_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Preview-only allowlist"):
            validate_trigger([trigger_for(self.spec, deploy_command="npx wrangler deploy")], self.spec)

    def test_missing_preview_token_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "build token UUID missing"):
            validate_trigger([trigger_for(self.spec, build_token_uuid="")], self.spec)

    def test_preview_branch_must_be_included(self):
        with self.assertRaisesRegex(ValueError, "preview branch mismatch"):
            validate_trigger([trigger_for(self.spec, branch_includes=["another/branch"])], self.spec)

    def test_preview_must_not_include_main(self):
        with self.assertRaisesRegex(ValueError, "overlap main"):
            validate_trigger([trigger_for(self.spec, branch_includes=["feature/example", "main"])], self.spec)

    def test_wildcard_preview_must_exclude_main(self):
        with self.assertRaisesRegex(ValueError, "overlap main"):
            validate_trigger([trigger_for(self.spec, branch_includes=["*"], branch_excludes=[])], self.spec)

    def test_wildcard_preview_is_allowed_when_main_is_excluded(self):
        trigger = trigger_for(self.spec, branch_includes=["*"], branch_excludes=["main"])
        self.assertEqual(validate_trigger([trigger], self.spec)["trigger_uuid"], self.spec["trigger_uuid"])

    def test_missing_or_duplicate_trigger_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "found 0"):
            validate_trigger([], self.spec)
        trigger = trigger_for(self.spec)
        with self.assertRaisesRegex(ValueError, "found 2"):
            validate_trigger([trigger, dict(trigger)], self.spec)

    def test_preview_spec_rejects_main_branch(self):
        with self.assertRaisesRegex(ValueError, "non-production Preview"):
            preview_spec("b" * 32, "00000000-0000-4000-8000-000000000001", "main")

    def test_changes_only_update_build_command(self):
        trigger = trigger_for(self.spec)
        self.assertEqual(changes_for(trigger, self.spec), {"build_command": TARGET_BUILD_COMMAND})
        trigger["build_command"] = TARGET_BUILD_COMMAND
        self.assertEqual(changes_for(trigger, self.spec), {})

    def test_deploy_command_and_build_token_are_never_patch_fields(self):
        trigger = trigger_for(self.spec, build_command="old", deploy_command=SAFE_DEPLOY, build_token_uuid="keep-this")
        patch = changes_for(trigger, self.spec)
        self.assertEqual(set(patch), {"build_command"})
        self.assertNotIn("deploy_command", patch)
        self.assertNotIn("build_token_uuid", patch)

    def test_only_known_preview_deploy_commands_are_allowed(self):
        self.assertIn(SAFE_DEPLOY, ALLOWED_PREVIEW_DEPLOY_COMMANDS)
        self.assertNotIn("npx wrangler deploy", ALLOWED_PREVIEW_DEPLOY_COMMANDS)

    def test_production_specs_are_rejected(self):
        production = dict(self.spec, kind="production")
        with self.assertRaisesRegex(ValueError, "Preview triggers only"):
            validate_trigger([trigger_for(self.spec)], production)
        with self.assertRaisesRegex(ValueError, "Only Preview trigger changes"):
            changes_for(trigger_for(self.spec), production)

    def test_main_uses_only_the_explicit_preview_api_path(self):
        current = trigger_for(self.spec, build_command="old build command")
        calls = []

        def fake_api(path, token, method="GET", payload=None):
            calls.append((path, method, payload))
            if method == "PATCH":
                current.update(payload or {})
                return {}
            return [current]

        env = {
            "CLOUDFLARE_WORKERS_BUILDS_API_TOKEN": "test-token",
            "PREVIEW_TRIGGER_UUID": self.spec["trigger_uuid"],
            "PREVIEW_WORKER_TAG": self.spec["tag"],
            "PREVIEW_BRANCH": self.spec["branch"],
        }
        with patch.dict(os.environ, env, clear=True), patch.object(updater, "api_request", side_effect=fake_api), redirect_stdout(StringIO()):
            result = updater.main()

        self.assertEqual(result, 0)
        self.assertEqual([method for _, method, _ in calls], ["GET", "PATCH", "GET"])
        self.assertTrue(all(self.spec["tag"] in path or self.spec["trigger_uuid"] in path for path, _, _ in calls))
        patch_payloads = [payload for _, method, payload in calls if method == "PATCH"]
        self.assertEqual(patch_payloads, [{"build_command": TARGET_BUILD_COMMAND}])
        self.assertEqual(current["deploy_command"], SAFE_DEPLOY)
        self.assertEqual(current["build_token_uuid"], "preview-token-uuid")
        self.assertEqual(current["branch_includes"], [self.spec["branch"]])

    def test_main_fails_without_preview_target_before_any_api_call(self):
        with patch.dict(os.environ, {"CLOUDFLARE_WORKERS_BUILDS_API_TOKEN": "test-token"}, clear=True), patch.object(updater, "api_request") as api, redirect_stdout(StringIO()):
            result = updater.main()
        self.assertEqual(result, 2)
        api.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
