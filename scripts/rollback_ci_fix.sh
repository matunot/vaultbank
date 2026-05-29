#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Find latest backup folder
LATEST_BACKUP=$(ls -d .ci_fix_backups_* 2>/dev/null | sort -V | tail -n 1 || true)
if [ -z "$LATEST_BACKUP" ]; then
  echo "No backup folders found (.ci_fix_backups_*). Nothing to restore."
  exit 1
fi

echo "Restoring from backup: $LATEST_BACKUP"

# Files to restore (add or remove entries as needed)
RESTORE_FILES=(
  ".github/workflows/deploy.yml"
  "vercel.json"
  "package-lock.json"
  "package.json"
)

for f in "${RESTORE_FILES[@]}"; do
  if [ -f "$LATEST_BACKUP/$f" ]; then
    mkdir -p "$(dirname "$f")"
    cp -a "$LATEST_BACKUP/$f" "$f"
    echo "Restored $f"
  else
    echo "Backup does not contain $f — skipping"
  fi
done

# Restore node_modules by reinstalling if lockfile present
if [ -f package-lock.json ]; then
  echo "Running npm ci to restore node_modules from package-lock.json"
  npm ci --no-audit --no-fund
else
  echo "No package-lock.json found in repo root after restore. Skipping npm ci."
fi

echo "Rollback complete. Review changes, then commit if desired:"
echo "  git status --porcelain"
echo "  git add -A && git commit -m 'chore: rollback CI fix from $LATEST_BACKUP' && git push origin main"