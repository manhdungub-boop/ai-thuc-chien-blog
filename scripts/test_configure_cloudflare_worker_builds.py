#!/usr/bin/env python3
import unittest

from configure_cloudflare_worker_builds import (
    REPO_ID,
    REPO_NAME,
    TARGET_BUILD_COMMAND,
    WORKERS,
    build_update_payload,
    validate_trigger,
)


def trigger_for(spec, **overrides):
    trigger = {
        "trigger_uuid": spec["trigger_uuid"],
        "external_script_id": spec["tag"],
        "root_directory": "/",
        "branch_includes": ["main"],
        # A valid deploy command can differ between projects/environments.
        "deploy_command": "npx wrangler deploy --env production",
        "build_command": "legacy copy command",
        "build_token_uuid": "test-token-uuid",
        "repo_connection": {"repo_name": REPO_NAME, "repo_id": REPO_ID},
    }
    trigger.update(overrides)
    return trigger


class TriggerValidationTests(unittest.TestCase):
    def test_both_expected_workers_match(self):
        for spec in WORKERS:
            with self.subTest(worker=spec["name"]):
                trigger = validate_trigger([trigger_for(spec)], spec)
                self.assertEqual(trigger["trigger_uuid"], spec["trigger_uuid"])

    def test_wrong_worker_tag_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "tag mismatch"):
            validate_trigger(
                [trigger_for(WORKERS[0], external_script_id="wrong-tag")], WORKERS[0]
            )

    def test_wrong_repository_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "repository identity mismatch"):
            validate_trigger(
                [
                    trigger_for(
                        WORKERS[0],
                        repo_connection={"repo_name": "other", "repo_id": "1"},
                    )
                ],
                WORKERS[0],
            )

    def test_project_specific_deploy_command_is_accepted_unchanged(self):
        expected = "npx wrangler deploy --env production"
        trigger = trigger_for(WORKERS[0], deploy_command=expected)
        validated = validate_trigger([trigger], WORKERS[0])
        self.assertEqual(validated["deploy_command"], expected)

    def test_missing_or_empty_deploy_command_is_rejected(self):
        for deploy_command in ("", None):
            with self.subTest(deploy_command=deploy_command):
                with self.assertRaisesRegex(ValueError, "deploy command missing or empty"):
                    validate_trigger(
                        [trigger_for(WORKERS[0], deploy_command=deploy_command)],
                        WORKERS[0],
                    )

    def test_nonproduction_branch_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "production branch main"):
            validate_trigger(
                [trigger_for(WORKERS[0], branch_includes=["develop"])], WORKERS[0]
            )

    def test_missing_or_duplicate_trigger_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "found 0"):
            validate_trigger([], WORKERS[0])
        trigger = trigger_for(WORKERS[0])
        with self.assertRaisesRegex(ValueError, "found 2"):
            validate_trigger([trigger, dict(trigger)], WORKERS[0])

    def test_patch_payload_changes_only_build_command(self):
        trigger = trigger_for(WORKERS[0])
        original_deploy_command = trigger["deploy_command"]
        payload = build_update_payload(trigger)
        self.assertEqual(payload, {"build_command": TARGET_BUILD_COMMAND})
        self.assertEqual(trigger["deploy_command"], original_deploy_command)
        self.assertNotIn("deploy_command", payload)
        self.assertNotIn("root_directory", payload)
        self.assertNotIn("branch_includes", payload)

    def test_no_patch_needed_when_build_command_already_matches(self):
        trigger = trigger_for(WORKERS[0], build_command=TARGET_BUILD_COMMAND)
        self.assertIsNone(build_update_payload(trigger))


if __name__ == "__main__":
    unittest.main(verbosity=2)
