#!/usr/bin/env bash
set -euo pipefail
LOG_DIR="${LOG_DIR:-./ci-logs}"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BUILD_LOG="$LOG_DIR/build-$TIMESTAMP.log"
DIAG_LOG="$LOG_DIR/diagnose-$TIMESTAMP.log"

echo "=== START DIAGNOSE $TIMESTAMP ===" | tee "$DIAG_LOG"

# 1) Environment info
echo "Node: $(node -v 2>/dev/null || echo 'missing')" | tee -a "$DIAG_LOG"
echo "NPM: $(npm -v 2>/dev/null || echo 'missing')" | tee -a "$DIAG_LOG"
echo "Yarn: $(yarn -v 2>/dev/null || echo 'missing')" | tee -a "$DIAG_LOG"
echo "OS: $(uname -a)" | tee -a "$DIAG_LOG"

# 2) Clean install (fail fast)
echo "Running clean install..." | tee -a "$DIAG_LOG"
rm -rf node_modules
if [ -f package-lock.json ]; then
  npm ci 2>&1 | tee -a "$DIAG_LOG" || echo "INSTALL_FAILED" >> "$DIAG_LOG"
else
  yarn --frozen-lockfile 2>&1 | tee -a "$DIAG_LOG" || echo "INSTALL_FAILED" >> "$DIAG_LOG"
fi

# 3) Run build and capture output
echo "Running build..." | tee -a "$DIAG_LOG"
set +e
npm run build 2>&1 | tee "$BUILD_LOG"
BUILD_EXIT=${PIPESTATUS[0]}
set -e

# 4) Quick grep for common failure signatures
echo "Scanning logs for common errors..." | tee -a "$DIAG_LOG"
grep -E "craco|@craco/craco|Cannot find module|Module not found|ENOTFOUND|EACCES|out of memory|port in use|ERR!" "$BUILD_LOG" || true
grep -E "BUILD_FAILED|error" "$BUILD_LOG" | tail -n 50 >> "$DIAG_LOG" || true

# 5) If build succeeded, finish
if [ "$BUILD_EXIT" -eq 0 ]; then
  echo "BUILD_OK" | tee -a "$DIAG_LOG"
  echo "Build succeeded. Logs: $BUILD_LOG"
  exit 0
fi

# 6) Attempt targeted fixes for craco-related failures
echo "Primary build failed (exit $BUILD_EXIT). Attempting craco fix..." | tee -a "$DIAG_LOG"
if grep -q "craco" "$BUILD_LOG" || grep -q "@craco/craco" "$BUILD_LOG"; then
  echo "Detected craco issue. Reinstalling @craco/craco and retrying build..." | tee -a "$DIAG_LOG"
  npm i --no-save @craco/craco 2>&1 | tee -a "$DIAG_LOG" || true
  npm ci 2>&1 | tee -a "$DIAG_LOG" || true
  set +e
  npm run build 2>&1 | tee "$LOG_DIR/build-craco-retry-$TIMESTAMP.log"
  RETRY_EXIT=${PIPESTATUS[0]}
  set -e
  if [ "$RETRY_EXIT" -eq 0 ]; then
    echo "CRACO_FIX_OK" | tee -a "$DIAG_LOG"
    exit 0
  fi
  echo "Craco retry failed (exit $RETRY_EXIT)." | tee -a "$DIAG_LOG"
fi

# 7) Fallback: try react-app-rewired
echo "Attempting fallback: react-app-rewired..." | tee -a "$DIAG_LOG"
npm i --no-save react-app-rewired 2>&1 | tee -a "$DIAG_LOG" || true
# backup package.json
cp package.json package.json.bak-"$TIMESTAMP"
# replace craco/react-scripts with react-app-rewired in scripts (best-effort)
node -e "
const fs=require('fs');
let p=JSON.parse(fs.readFileSync('package.json'));
if(p.scripts){
  for(const k of Object.keys(p.scripts)){
    p.scripts[k]=p.scripts[k].replace(/craco/g,'react-app-rewired').replace(/react-scripts/g,'react-app-rewired');
  }
}
fs.writeFileSync('package.json',JSON.stringify(p,null,2));
console.log('package.json scripts patched for react-app-rewired');
"
npm ci 2>&1 | tee -a "$DIAG_LOG" || true
set +e
npm run build 2>&1 | tee "$LOG_DIR/build-rewired-$TIMESTAMP.log"
FALLBACK_EXIT=${PIPESTATUS[0]}
set -e
if [ "$FALLBACK_EXIT" -eq 0 ]; then
  echo "FALLBACK_OK" | tee -a "$DIAG_LOG"
  exit 0
fi

# 8) Final: upload logs and abort with clear message
echo "All automated attempts failed. Collecting artifacts..." | tee -a "$DIAG_LOG"
tar -czf "$LOG_DIR/artifacts-$TIMESTAMP.tar.gz" "$BUILD_LOG" "$DIAG_LOG" "$LOG_DIR/build-craco-retry-$TIMESTAMP.log" "$LOG_DIR/build-rewired-$TIMESTAMP.log" || true
echo "Artifacts: $LOG_DIR/artifacts-$TIMESTAMP.tar.gz" | tee -a "$DIAG_LOG"
echo "FAIL_ABORT" | tee -a "$DIAG_LOG"
# Print last 200 lines of build log for quick glance
echo "=== LAST 200 LINES OF BUILD LOG ==="
tail -n 200 "$BUILD_LOG" || true
exit 1