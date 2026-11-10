#!/usr/bin/env python3
"""Offline-only trigger validation helpers; all Cloudflare API mutation is disabled."""
import json
import os
import re
import sys

ACCOUNT_ID = "92cf091bbac8b4879ec65feb30b4715b"
REPO_NAME = "ai-thuc-chien-blog"
REPO_ID = "1423636651"
TARGET_BUILD_COMMAND = "npm run build"
EXPECTED_DEPLOY_COMMAND = "npx wrangler deploy"
EXPECTED_PREVIEW_COMMAND = "npx wrangler preview"
PRIMARY_BUILD_TOKEN_NAME = "ai-thuc-chien-blog build token"
ALLOWED_DEPLOY_COMMANDS = {EXPECTED_DEPLOY_COMMAND, EXPECTED_PREVIEW_COMMAND}
PRODUCTION_TRIGGERS = (
    {"name": "ai-thuc-chien-blog", "tag": "f0142edba057434191f9d452ba159e00",
     "trigger_uuid": "fefb9a7f-85ff-474e-b2ad-fb83eb000c05",
     "branch": "main", "kind": "production", "deploy_command": EXPECTED_DEPLOY_COMMAND},
    {"name": "ai-thuc-chien-blog-moi", "tag": "b1481a57488a4839b9a745f93b7dad61",
     "trigger_uuid": "c0af6fef-ce6b-4516-a092-433c59f2c9a6",
     "branch": "main", "kind": "production", "deploy_command": EXPECTED_DEPLOY_COMMAND},
)


def preview_spec(tag, trigger_uuid, branch):
    return {
        "name": "preview:" + branch,
        "tag": tag,
        "trigger_uuid": trigger_uuid,
        "branch": branch,
        "kind": "preview",
        "deploy_command": EXPECTED_PREVIEW_COMMAND,
    }


def validate_trigger(triggers, spec):
    matches = [t for t in triggers if t.get("trigger_uuid") == spec["trigger_uuid"]]
    if len(matches) != 1:
        raise ValueError(f"{spec['name']}: expected one matching trigger; found {len(matches)}")
    trigger = matches[0]
    if trigger.get("external_script_id") != spec["tag"]:
        raise ValueError(f"{spec['name']}: Worker tag mismatch; refusing to update")
    repo = trigger.get("repo_connection") or {}
    if repo.get("repo_name") != REPO_NAME or str(repo.get("repo_id")) != REPO_ID:
        raise ValueError(f"{spec['name']}: repository identity mismatch; refusing to update")
    if trigger.get("root_directory") != "/":
        raise ValueError(f"{spec['name']}: root directory changed; inspect before updating")
    if trigger.get("deploy_command") not in ALLOWED_DEPLOY_COMMANDS:
        raise ValueError(f"{spec['name']}: unexpected deploy command; refusing to update")
    if not trigger.get("build_token_uuid"):
        raise ValueError(f"{spec['name']}: build token UUID missing; refusing to update")

    includes = trigger.get("branch_includes") or []
    excludes = trigger.get("branch_excludes") or []
    if spec["kind"] == "production":
        if spec["branch"] != "main" or "main" not in includes or "main" in excludes:
            raise ValueError(f"{spec['name']}: production branch validation failed; refusing to update")
    else:
        branch = spec["branch"]
        if not branch or branch == "main" or (branch not in includes and "*" not in includes):
            raise ValueError(f"{spec['name']}: preview branch mismatch; refusing to update")
        # A wildcard preview trigger must explicitly exclude main to avoid deploy overlap.
        if "*" in includes and "main" not in excludes:
            raise ValueError(f"{spec['name']}: preview wildcard does not exclude main; refusing to update")
        if "main" in includes:
            raise ValueError(f"{spec['name']}: preview trigger includes main; refusing to update")
    return trigger


def resolve_primary_build_token(primary_trigger, token_records):
    """Return only the known-good primary build token UUID after exact metadata checks."""
    token_uuid = (primary_trigger or {}).get("build_token_uuid")
    if not token_uuid:
        raise ValueError("Primary Worker trigger has no build token UUID")
    matches = [item for item in token_records if item.get("build_token_uuid") == token_uuid]
    if len(matches) != 1:
        raise ValueError(f"Primary Worker build token must have one current record; found {len(matches)}")
    if matches[0].get("build_token_name") != PRIMARY_BUILD_TOKEN_NAME:
        raise ValueError("Primary Worker build token name did not match the verified token; refusing reuse")
    return token_uuid


def changes_for(trigger, spec):
    desired = {
        "build_command": TARGET_BUILD_COMMAND,
        "deploy_command": spec["deploy_command"],
    }
    # Token changes are only allowed when explicitly attached to a preflighted preview spec.
    if spec.get("kind") == "preview" and spec.get("use_build_token_uuid"):
        desired["build_token_uuid"] = spec["use_build_token_uuid"]
    return {key: value for key, value in desired.items() if trigger.get(key) != value}


def main():
    print(
        "DISABLED: Cloudflare Workers Builds changes are locked until the exact Preview Worker tag/trigger UUID pair is independently verified and allowlisted.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
