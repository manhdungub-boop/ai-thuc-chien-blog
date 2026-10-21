#!/usr/bin/env python3
import unittest

from configure_cloudflare_worker_builds import (
    ALLOWED_DEPLOY_COMMANDS,
    EXPECTED_DEPLOY_COMMAND,
    PRIMARY_BUILD_TOKEN_NAME,
    SECONDARY_TEST_WORKER_NAME,
    SECONDARY_TEST_WORKER_TAG,
    SECONDARY_TEST_WORKER_TRIGGER_UUID,
    EXPECTED_PREVIEW_COMMAND,
    PRODUCTION_TRIGGERS,
    REPO_ID,
    REPO_NAME,
    TARGET_BUILD_COMMAND,
    changes_for,
    preview_spec,
    resolve_primary_build_token,
    validate_trigger,
)


def trigger_for(spec, **overrides):
    trigger = {
        "trigger_uuid": spec["trigger_uuid"],
        "external_script_id": spec["tag"],
        "root_directory": "/",
        "branch_includes": [spec["branch"]],
        "branch_excludes": [],
        "deploy_command": spec["deploy_command"],
        "build_command": "legacy build command",
        "build_token_uuid": "test-token-uuid",
        "repo_connection": {"repo_name": REPO_NAME, "repo_id": REPO_ID},
    }
    trigger.update(overrides)
    return trigger


class TriggerValidationTests(unittest.TestCase):
    def test_both_production_workers_match(self):
        for spec in PRODUCTION_TRIGGERS:
            with self.subTest(worker=spec["name"]):
                self.assertEqual(validate_trigger([trigger_for(spec)], spec)["trigger_uuid"], spec["trigger_uuid"])

    def test_production_trigger_with_preview_command_is_safe_to_normalize(self):
        spec = PRODUCTION_TRIGGERS[0]
        trigger = trigger_for(spec, deploy_command=EXPECTED_PREVIEW_COMMAND)
        self.assertEqual(validate_trigger([trigger], spec)["trigger_uuid"], spec["trigger_uuid"])
        self.assertEqual(
            changes_for(trigger, spec),
            {"build_command": TARGET_BUILD_COMMAND, "deploy_command": EXPECTED_DEPLOY_COMMAND},
        )

    def test_preview_trigger_with_deploy_command_is_safe_to_normalize(self):
        spec = preview_spec("b" * 32, "00000000-0000-4000-8000-000000000001", "feature/example")
        trigger = trigger_for(spec, deploy_command=EXPECTED_DEPLOY_COMMAND)
        self.assertEqual(validate_trigger([trigger], spec)["trigger_uuid"], spec["trigger_uuid"])
        self.assertEqual(
            changes_for(trigger, spec),
            {"build_command": TARGET_BUILD_COMMAND, "deploy_command": EXPECTED_PREVIEW_COMMAND},
        )

    def test_trigger_with_unexpected_command_is_rejected(self):
        spec = PRODUCTION_TRIGGERS[0]
        with self.assertRaisesRegex(ValueError, "unexpected deploy command"):
            validate_trigger([trigger_for(spec, deploy_command="rm -rf /")], spec)

    def test_wrong_worker_tag_is_rejected(self):
        spec = PRODUCTION_TRIGGERS[0]
        with self.assertRaisesRegex(ValueError, "tag mismatch"):
            validate_trigger([trigger_for(spec, external_script_id="wrong-tag")], spec)

    def test_wrong_repository_is_rejected(self):
        spec = PRODUCTION_TRIGGERS[0]
        wrong_repo = {"repo_name": "other", "repo_id": "1"}
        with self.assertRaisesRegex(ValueError, "repository identity mismatch"):
            validate_trigger([trigger_for(spec, repo_connection=wrong_repo)], spec)

    def test_production_must_include_main(self):
        spec = PRODUCTION_TRIGGERS[0]
        with self.assertRaisesRegex(ValueError, "production branch validation failed"):
            validate_trigger([trigger_for(spec, branch_includes=["develop"])], spec)

    def test_preview_must_not_include_main(self):
        spec = preview_spec("b" * 32, "00000000-0000-4000-8000-000000000001", "feature/example")
        trigger = trigger_for(spec, branch_includes=["*", "main"], branch_excludes=[])
        with self.assertRaisesRegex(ValueError, "preview wildcard does not exclude main"):
            validate_trigger([trigger], spec)

    def test_missing_or_duplicate_trigger_is_rejected(self):
        spec = PRODUCTION_TRIGGERS[0]
        with self.assertRaisesRegex(ValueError, "found 0"):
            validate_trigger([], spec)
        trigger = trigger_for(spec)
        with self.assertRaisesRegex(ValueError, "found 2"):
            validate_trigger([trigger, dict(trigger)], spec)

    def test_already_correct_trigger_requires_no_changes(self):
        spec = PRODUCTION_TRIGGERS[1]
        trigger = trigger_for(spec, build_command=TARGET_BUILD_COMMAND, deploy_command=EXPECTED_DEPLOY_COMMAND)
        self.assertEqual(changes_for(trigger, spec), {})

    def test_only_expected_commands_are_allowed(self):
        self.assertEqual(ALLOWED_DEPLOY_COMMANDS, {EXPECTED_DEPLOY_COMMAND, EXPECTED_PREVIEW_COMMAND})

    def test_resolves_exact_known_good_primary_token(self):
        primary = {"build_token_uuid": "primary-token-uuid"}
        records = [{"build_token_uuid": "primary-token-uuid", "build_token_name": PRIMARY_BUILD_TOKEN_NAME}]
        self.assertEqual(resolve_primary_build_token(primary, records), "primary-token-uuid")

    def test_missing_primary_token_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "no build token UUID"):
            resolve_primary_build_token({}, [])

    def test_missing_or_duplicate_token_record_is_rejected(self):
        primary = {"build_token_uuid": "primary-token-uuid"}
        with self.assertRaisesRegex(ValueError, "found 0"):
            resolve_primary_build_token(primary, [])
        record = {"build_token_uuid": "primary-token-uuid", "build_token_name": PRIMARY_BUILD_TOKEN_NAME}
        with self.assertRaisesRegex(ValueError, "found 2"):
            resolve_primary_build_token(primary, [record, dict(record)])

    def test_unknown_primary_token_name_is_rejected(self):
        primary = {"build_token_uuid": "primary-token-uuid"}
        records = [{"build_token_uuid": "primary-token-uuid", "build_token_name": "unexpected token"}]
        with self.assertRaisesRegex(ValueError, "name did not match"):
            resolve_primary_build_token(primary, records)

    def test_build_token_patch_is_scoped_to_explicit_preview_spec(self):
        spec = preview_spec("b" * 32, "00000000-0000-4000-8000-000000000001", "feature/example")
        trigger = trigger_for(spec, build_command=TARGET_BUILD_COMMAND, deploy_command=EXPECTED_PREVIEW_COMMAND)
        spec["use_build_token_uuid"] = "primary-token-uuid"
        self.assertEqual(changes_for(trigger, spec), {"build_token_uuid": "primary-token-uuid"})
        production = PRODUCTION_TRIGGERS[0]
        production_trigger = trigger_for(production, build_command=TARGET_BUILD_COMMAND, deploy_command=EXPECTED_DEPLOY_COMMAND)
        self.assertEqual(changes_for(production_trigger, production), {})

    def test_secondary_test_worker_token_change_requires_explicit_exact_identity_opt_in(self):
        spec = dict(PRODUCTION_TRIGGERS[1])
        self.assertEqual(spec["name"], SECONDARY_TEST_WORKER_NAME)
        self.assertEqual(spec["tag"], SECONDARY_TEST_WORKER_TAG)
        self.assertEqual(spec["trigger_uuid"], SECONDARY_TEST_WORKER_TRIGGER_UUID)
        trigger = trigger_for(spec, build_command=TARGET_BUILD_COMMAND, deploy_command=EXPECTED_DEPLOY_COMMAND, build_token_uuid="stale-token-uuid")
        spec["use_build_token_uuid"] = "primary-token-uuid"
        # No allow_token_change flag means production token references remain untouched by default.
        self.assertEqual(changes_for(trigger, spec), {})
        spec["allow_token_change"] = True
        self.assertEqual(changes_for(trigger, spec), {"build_token_uuid": "primary-token-uuid"})

    def test_primary_production_token_cannot_be_changed_even_with_opt_in_flag(self):
        spec = dict(PRODUCTION_TRIGGERS[0])
        trigger = trigger_for(spec, build_command=TARGET_BUILD_COMMAND, deploy_command=EXPECTED_DEPLOY_COMMAND, build_token_uuid="primary-current-token")
        spec["use_build_token_uuid"] = "different-token"
        spec["allow_token_change"] = True
        self.assertEqual(changes_for(trigger, spec), {})

    def test_secondary_token_opt_in_rejects_wrong_tag_or_trigger_identity(self):
        for field, value in [("tag", "wrong-tag"), ("trigger_uuid", "00000000-0000-4000-8000-000000000002"), ("name", "other-worker")]:
            with self.subTest(field=field):
                spec = dict(PRODUCTION_TRIGGERS[1])
                spec[field] = value
                spec["use_build_token_uuid"] = "primary-token-uuid"
                spec["allow_token_change"] = True
                trigger = trigger_for(PRODUCTION_TRIGGERS[1], build_command=TARGET_BUILD_COMMAND, deploy_command=EXPECTED_DEPLOY_COMMAND, build_token_uuid="stale-token-uuid")
                self.assertEqual(changes_for(trigger, spec), {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
