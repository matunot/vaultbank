#!/usr/bin/env bash

# ------------------------------------------------------------
# Setup branch protection for the main branch using GitHub CLI.
# ------------------------------------------------------------
#
# This script configures branch protection on the `main` branch to
# enforce the following rules:
#   * Require the CI smoke test to pass before merging.
#   * Enforce admin protection.
#   * Require code owner reviews and dismiss stale reviews.
#   * Disallow force pushes and require a linear history.
#
# Prerequisites:
#   * GitHub CLI (`gh`) must be installed and authenticated.
#   * You must have write/admin permissions on the repository.
#
# Usage:
#   OWNER="your-github-username-or-org"
#   REPO="vaultbank"
#   ./scripts/setup_branch_protection.sh "$OWNER" "$REPO"
#
# If you prefer the GitHub web UI, you can enable branch protection
# manually under Settings → Branches → Branch protection rules.

set -euo pipefail

# Accept owner and repo as arguments, or read from environment variables.
OWNER="${1:-${GITHUB_OWNER:-}}"
REPO="${2:-${GITHUB_REPO:-}}"

if [[ -z "$OWNER" || -z "$REPO" ]]; then
  echo "Error: Owner and repository name must be provided as arguments or via GITHUB_OWNER/GITHUB_REPO env vars."
  exit 1
fi

BRANCH="main"
# The name of the required status check as defined in the CI workflow.
STATUS_CHECK="Smoke Test"

echo "Applying branch protection to $OWNER/$REPO:$BRANCH..."

gh api \
  -X PUT \
  /repos/$OWNER/$REPO/branches/$BRANCH/protection \
  -f required_status_checks='{"strict":true,"contexts":["$STATUS_CHECK"]}' \
  -f enforce_admins=true \
  -f required_pull_request_reviews='{"dismiss_stale_reviews":true,"require_code_owner_reviews":true}' \
  -f restrictions='null' \
  -f required_linear_history=true \
  -f allow_force_pushes=false

echo "Branch protection applied successfully."
