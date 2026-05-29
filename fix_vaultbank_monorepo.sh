#!/usr/bin/env bash
set -euo pipefail

# Root directory of the repository
ROOT="$(pwd)"
BACKUP="$ROOT/.ci_fix_backups_$(date +%s)"
mkdir -p "$BACKUP"
echo "Backup dir: $BACKUP"

# Backup key CI/CD configuration files
for f in ".github/workflows/deploy.yml" "vercel.json" "package.json" "package-lock.json"; do
  if [ -f "$f" ]; then
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp -a "$f" "$BACKUP/$f"
    echo "Backed up $f"
  fi
done

# Normalize line endings to LF for all relevant files
echo "Normalizing line endings..."
find . -type f \( -name "*.yml" -o -name "*.yaml" -o -name "*.sh" -o -name "*.json" -o -name "*.js" -o -name "*.ts" \) -print0 \
  | xargs -0 -n1 bash -c 'awk '\''{ sub("\r$", ""); print }'\'' "$0" > "$0.tmp" && mv "$0.tmp" "$0"'

# Clean node_modules and lockfiles in subfolders
SUBFOLDERS=( "." "client" "api" "server" )
for d in "${SUBFOLDERS[@]}"; do
  if [ -d "$d" ]; then
    echo "Cleaning $d ..."
    rm -rf "$d/node_modules" "$d/package-lock.json" "$d/yarn.lock" "$d/.pnp.*" || true
  fi
done

# Install top-level dependencies to regenerate lockfile
echo "Installing top-level dependencies..."
npm install --no-audit --no-fund

# Pin known compatible packages to avoid version conflicts
echo "Pinning compatibility packages..."
npm install ajv@8.12.0 ajv-keywords@5.1.0 schema-utils@4.3.3 --save-dev || true
npm install typescript@4.9.5 --save-dev || true
npm install @craco/craco@^7.0.0 exceljs --save || true

# Install dependencies in each subfolder that contains a package.json
for d in "${SUBFOLDERS[@]}"; do
  if [ -f "$d/package.json" ]; then
    echo "Installing in $d ..."
    (cd "$d" && npm install --no-audit --no-fund)
  fi
done

# Patch the GitHub Actions workflow to use Node 18 and install actionlint
WF=".github/workflows/deploy.yml"
if [ -f "$WF" ]; then
  cp "$WF" "$BACKUP/deploy.yml.bak"
  # Ensure Node version is 18 (already set in the script, but keep for safety)
  sed -i 's/node-version: 20/node-version: 18/g' "$WF" || true
  # Insert actionlint installation step if not present
  if ! grep -q "Install actionlint" "$WF"; then
    awk 'BEGIN{ins=0} /steps:/{print; if(!ins){print "      - name: Install actionlint\\n        run: |\\n          curl -sSL https://github.com/rhysd/actionlint/releases/latest/download/actionlint_linux_amd64.tar.gz | tar -xz -C /usr/local/bin\\n"; ins=1; next}} {print}' "$WF" > "$WF.tmp" && mv "$WF.tmp" "$WF" || true
  fi
fi

# Patch vercel.json to ensure correct build command and output directory
if [ -f vercel.json ]; then
  cp vercel.json "$BACKUP/vercel.json.bak"
  if command -v jq >/dev/null 2>&1; then
    jq '.outputDirectory="client/build" | .buildCommand="cd client && npm run build"' vercel.json > vercel.json.tmp 2>/dev/null && mv vercel.json.tmp vercel.json || true
  else
    perl -0777 -pe 'if ("outputDirectory"\\s*:\\s*"[^"]+") { s/"outputDirectory"\\s*:\\s*"[^"]+"/"outputDirectory": "client\\/build"/g; } else { s/(\\{)/$1\\n  "buildCommand": "cd client && npm run build",\\n  "outputDirectory": "client\\/build",/; }' vercel.json > vercel.json.tmp 2>/dev/null && mv vercel.json.tmp vercel.json || true
  fi
else
  cat > vercel.json <<'JSON'
{ "buildCommand": "cd client && npm run build", "outputDirectory": "client/build" }
JSON
fi

# Final safety pass to ensure all line endings are LF
find . -type f \( -name "*.sh" -o -name "*.yml" -o -name "*.yaml" -o -name "*.json" \) -print0 \
  | xargs -0 -n1 bash -c 'awk '\''{ sub("\r$", ""); print }'\'' "$0" > "$0.tmp" && mv "$0.tmp" "$0"'

# Commit changes if any
git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "ci: cleanup monorepo lockfiles, pin compatibility deps, patch workflow"
  git push origin main
fi

# Trigger a Vercel deployment if the Vercel CLI is available
if command -v npx >/dev/null 2>&1; then
  echo "Triggering Vercel deploy..."
  npx vercel --prod --yes || true
fi

echo "Done. Check backups at $BACKUP"
