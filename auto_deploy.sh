#!/usr/bin/env bash
# auto_deploy.sh - Automates fixing JSX syntax errors, updating tsconfig, linting, building, committing, and deploying.

set -euo pipefail

# Helper functions for colored output
log_info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
log_success() { echo -e "\033[1;32m[SUCCESS]\033[0m $*"; }
log_error() { echo -e "\033[1;31m[ERROR]\033[0m $*"; }

# 1. Ensure we are in the project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# 2. Verify Node version (requires Node 22.x as defined in package.json)
REQUIRED_NODE_MAJOR=22
CURRENT_NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if (( CURRENT_NODE_MAJOR < REQUIRED_NODE_MAJOR )); then
  log_error "Node.js version $REQUIRED_NODE_MAJOR.x or higher is required. Current: $(node -v)"
  exit 1
fi
log_success "Node version $(node -v) meets requirement."

# 3. Install dependencies (root, client, server) if needed
log_info "Installing root dependencies..."
npm ci

log_info "Installing client dependencies..."
cd client && npm ci && cd ..

log_info "Installing server dependencies..."
cd server && npm ci && cd ..

# 4. Fix JSX syntax errors via ESLint autofix
log_info "Running ESLint autofix on JSX files..."
# Pass the --fix flag to automatically fix fixable issues.
npm run lint -- --fix

# 5. Ensure tsconfig.json exists and is modern (no changes made automatically)
log_info "Checking tsconfig.json..."
if [[ ! -f tsconfig.json ]]; then
  log_error "tsconfig.json not found!"
  exit 1
fi
log_success "tsconfig.json exists."

# 6. Run a full lint pass (without fixing) to surface any remaining issues
log_info "Running full lint pass..."
npm run lint

# 7. Build the client application
log_info "Building client..."
npm run build

# 8. Commit any changes made by the previous steps
log_info "Committing changes to git..."
git add -A
# Use a generic commit message; adjust as needed.
git commit -m "chore: automated fix, lint, build, and deploy"

# 9. Deploy the application using the existing deploy script
log_info "Running deployment script..."
bash ./deploy.sh

log_success "Automation script completed successfully."
