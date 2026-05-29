#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(pwd)"
BACKUP_DIR="$REPO_ROOT/.ci_fix_backups_$(date +%s)"
mkdir -p "$BACKUP_DIR"

echo "== VaultBank CI/CD auto-fix starting =="
echo "Backup dir: $BACKUP_DIR"

# 1) Backup important files if they exist
for f in ".github/workflows/deploy.yml" "vercel.json" "package.json" "package-lock.json"; do
  if [ -f "$f" ]; then
    mkdir -p "$(dirname "$BACKUP_DIR/$f")"
    cp -a "$f" "$BACKUP_DIR/$f"
    echo "Backed up $f"
  fi
done

# 2) Normalize line endings for YAML, SH, JS, JSON files to LF
echo "Normalizing line endings (LF) for .yml .yaml .sh .json .js .ts files..."
find . -type f \( -name "*.yml" -o -name "*.yaml" -o -name "*.sh" -o -name "*.json" -o -name "*.js" -o -name "*.ts" \) -print0 \
  | xargs -0 -n1 bash -c 'file="$0"; awk '\''{ sub("\r$", ""); print }'\'' "$file" > "$file.tmp" && mv "$file.tmp" "$file"'

# 3) Patch GitHub Actions workflow: install actionlint, use Node 18, robust install/build
WORKFLOW=".github/workflows/deploy.yml"
if [ -f "$WORKFLOW" ]; then
  echo "Patching $WORKFLOW"
  cp "$WORKFLOW" "$WORKFLOW.bak"

  # If actionlint install step not present, insert it before running actionlint or create a lint job
  # We'll replace node-version: 20 -> 18 and ensure actionlint install + run exist
  perl -0777 -pe '
    s/node-version:\s*20/node-version: 18/g;
    if (/name:\s*lint[\s\S]*?run:\s*actionlint/m) {
      # ensure install step exists before run actionlint
      s/(name:\s*lint[\s\S]*?steps:\s*\n)/$1  - name: Install actionlint\n    run: |\n      curl -sSL https:\/\/github.com\/rhysd\/actionlint\/releases\/latest\/download\/actionlint_linux_amd64.tar.gz \\\n+      | tar -xz -C \/usr\/local\/bin\n/m;
    } else {
      # add a lint job if none exists
      s/(jobs:\s*\n)/$1  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Checkout repo\n        uses: actions\/checkout@v4\n\n      - name: Install actionlint\n        run: |\n          curl -sSL https:\/\/github.com\/rhysd\/actionlint\/releases\/latest\/download\/actionlint_linux_amd64.tar.gz \\\n+          | tar -xz -C \/usr\/local\/bin\n\n      - name: Run actionlint\n        run: actionlint\n\n/m;
    }
    # Ensure build job uses Node 18 and uses npm ci || npm install and robust build step
    s/(uses:\s*actions\/setup-node@v[0-9]+[\s\S]*?with:\s*\n\s*node-version:\s*)\d+/$1 18/;
    s/run:\s*npm ci\s*$/run: npm ci || npm install/m;
    s/run:\s*npm run build\s*$/run: |\n          if [ -d client ]; then\n            cd client && npm run build\n          else\n            npm run build\n          fi/m;
  ' "$WORKFLOW.bak" > "$WORKFLOW" || cp "$WORKFLOW.bak" "$WORKFLOW"

  echo "Patched workflow saved."
else
  echo "No workflow found at $WORKFLOW — creating a robust deploy workflow."
  mkdir -p "$(dirname "$WORKFLOW")"
  cat > "$WORKFLOW" <<'YML'
name: VaultBank CI/CD

on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Install actionlint
        run: |
          curl -sSL https://github.com/rhysd/actionlint/releases/latest/download/actionlint_linux_amd64.tar.gz \
          | tar -xz -C /usr/local/bin

      - name: Run actionlint
        run: actionlint

  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Use Node 18
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install dependencies
        run: npm ci || npm install

      - name: Build
        run: |
          if [ -d client ]; then
            cd client && npm run build
          else
            npm run build
          fi

  deploy:
    needs: [lint, build]
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Vercel
        run: npx vercel --prod --yes
YML
  echo "Created new workflow at $WORKFLOW"
fi

# 4) Ensure package.json has lint and build scripts; add if missing
if [ -f package.json ]; then
  echo "Ensuring package.json scripts exist"
  # Use jq if available, otherwise fallback to node
  if command -v jq >/dev/null 2>&1; then
    has_lint=$(jq -r '.scripts.lint // empty' package.json || echo "")
    has_build=$(jq -r '.scripts.build // empty' package.json || echo "")
    tmpfile="$(mktemp)"
    cp package.json "$tmpfile"
    if [ -z "$has_lint" ]; then
      jq '.scripts.lint="eslint ."' "$tmpfile" > "$tmpfile.tmp" && mv "$tmpfile.tmp" "$tmpfile"
      echo "Added lint script"
    fi
    if [ -z "$has_build" ]; then
      jq '.scripts.build="DISABLE_ESLINT_PLUGIN=true craco build"' "$tmpfile" > "$tmpfile.tmp" && mv "$tmpfile.tmp" "$tmpfile"
      echo "Added build script"
    fi
    mv "$tmpfile" package.json
  else
    # node-based edit
    node -e '
      const fs = require("fs");
      const p = "package.json";
      const pkg = JSON.parse(fs.readFileSync(p,"utf8"));
      pkg.scripts = pkg.scripts || {};
      if(!pkg.scripts.lint) pkg.scripts.lint = "eslint .";
      if(!pkg.scripts.build) pkg.scripts.build = "DISABLE_ESLINT_PLUGIN=true craco build";
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
    '
    echo "Updated package.json scripts via node"
  fi
else
  echo "No package.json found — aborting."
  exit 1
fi

# 5) Remove node_modules and package-lock.json to regenerate a clean lockfile
echo "Removing node_modules and package-lock.json to regenerate lockfile..."
rm -rf node_modules package-lock.json

# 5b) Clean up subfolders (client, api, server) if they contain a package-lock.json
echo "Cleaning up subfolders (client, api, server)..."
for subdir in client api server; do
  if [ -d "$subdir" ]; then
    echo "Processing $subdir..."
    cd "$subdir"
    if [ -f package-lock.json ]; then
      echo "Removing node_modules and package-lock.json in $subdir..."
      rm -rf node_modules package-lock.json
      echo "Running npm install in $subdir..."
      npm install
    else
      echo "No package-lock.json in $subdir, skipping."
    fi
    cd "$REPO_ROOT"
  fi
done

# 6) Fresh install to regenerate lockfile
echo "Running npm install to regenerate package-lock.json..."
npm install

# 7) Pin compatible versions and install missing runtime deps
echo "Pinning TypeScript 4.9.5, upgrading craco, installing exceljs..."
npm install typescript@4.9.5 --save-dev
npm install @craco/craco@^7.0.0 --save
npm install exceljs --save

# 8) Patch vercel.json outputDirectory to client/build if needed
if [ -f vercel.json ]; then
  echo "Patching vercel.json outputDirectory -> client/build"
  cp vercel.json "$BACKUP_DIR/vercel.json.bak"
  # Use perl to replace or add
  perl -0777 -pe '
    if ("outputDirectory"\s*:\s*"[^"]+") {
      s/"outputDirectory"\s*:\s*"[^"]+"/"outputDirectory": "client\/build"/g;
    } else {
      s/(\{)/$1\n  "buildCommand": "cd client && npm run build",\n  "outputDirectory": "client\/build",/;
    }
  ' vercel.json.bak > vercel.json || true
else
  echo '{ "buildCommand": "cd client && npm run build", "outputDirectory": "client/build" }' > vercel.json
  echo "Created vercel.json with client/build outputDirectory"
fi

# 9) Convert any CRLF in scripts to LF again (safety)
find . -type f \( -name "*.sh" -o -name "*.yml" -o -name "*.yaml" -o -name "*.json" \) -print0 \
  | xargs -0 -n1 bash -c 'file="$0"; awk '\''{ sub("\r$", ""); print }'\'' "$file" > "$file.tmp" && mv "$file.tmp" "$file"'

# 10) Git commit only if there are changes
echo "Checking git status..."
git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "ci: fix workflow, regenerate lockfile, pin TS+Craco, add exceljs, patch vercel.json"
  echo "Pushing changes to origin/main..."
  git push origin main
fi

# 11) Redeploy to Vercel (requires Vercel CLI auth)
echo "Triggering Vercel production deploy..."
npx vercel --prod --yes || true

# 12) Verify deployment health (attempt to find Vercel URL and curl it)
echo "Attempting to locate Vercel production URL..."
FRONTEND_URL=""
if command -v npx >/dev/null 2>&1; then
  # Try to list deployments; this requires Vercel CLI logged in
  FRONTEND_URL=$(npx vercel ls vaultbank --prod --limit=1 2>/dev/null | grep -Eo 'https://[a-zA-Z0-9._-]+\.vercel\.app' | head -n1 || true)
fi

if [ -z "$FRONTEND_URL" ]; then
  echo "Could not auto-detect Vercel URL. If you know the URL, run: curl -I <your-vercel-url>"
  echo "Auto-fix script finished. Check Vercel dashboard for the new deployment."
else
  echo "Found frontend URL: $FRONTEND_URL"
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" || echo "000")
  echo "Frontend HTTP status: $HTTP_STATUS"
  if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Frontend is healthy (200 OK)."
  else
    echo "⚠️ Frontend returned status $HTTP_STATUS — check build logs on Vercel."
  fi
fi

echo "== VaultBank CI/CD auto-fix completed =="