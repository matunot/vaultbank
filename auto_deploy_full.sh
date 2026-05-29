#!/usr/bin/env bash
# Auto-detect backend folder and deploy, then connect frontend and redeploy

# 1. Detect backend folder (common names)
if [ -d "vaultbank-server" ]; then BACKEND_DIR="vaultbank-server"; elif [ -d "server" ]; then BACKEND_DIR="server"; elif [ -d "api" ]; then BACKEND_DIR="api"; else BACKEND_DIR=""; fi
if [ -z "$BACKEND_DIR" ]; then
  echo "No backend folder found (vaultbank-server|server|api). Aborting."
  exit 1
fi

# 2. Install, build, run migrations (if scripts exist) and deploy backend to Vercel
cd "$BACKEND_DIR"
npm ci || npm install
# run migrations if package.json has migrate or prisma scripts
if npm run | grep -q "migrate"; then npm run migrate || true; fi
if [ -f "prisma/schema.prisma" ]; then npx prisma migrate deploy || true; fi
# Deploy backend (non-interactive)
BACKEND_DEPLOY_OUTPUT=$(npx vercel --prod --yes 2>&1)
echo "$BACKEND_DEPLOY_OUTPUT"
# Extract deployed backend URL (look for 'Production' line)
BACKEND_URL=$(echo "$BACKEND_DEPLOY_OUTPUT" | grep -Eo 'https://[a-z0-9A-Z._-]+\.vercel\.app' | head -n1)
if [ -z "$BACKEND_URL" ]; then
  echo "Failed to detect backend URL from Vercel output. Aborting."
  exit 1
fi
echo "Backend deployed at: $BACKEND_URL"

# 3. Return to repo root and update frontend config or env
cd ..
# Detect frontend folder (common names)
if [ -d "client" ]; then FRONTEND_DIR="client"; elif [ -d "vaultbank-client" ]; then FRONTEND_DIR="vaultbank-client"; elif [ -d "frontend" ]; then FRONTEND_DIR="frontend"; else FRONTEND_DIR=""; fi
if [ -z "$FRONTEND_DIR" ]; then
  echo "No frontend folder found (client|vaultbank-client|frontend). Aborting."
  exit 1
fi

# 4. Update environment variable in .env.production or config file
# Prefer .env.production; fallback to src/config.js
ENV_FILE="$FRONTEND_DIR/.env.production"
if [ -f "$ENV_FILE" ]; then
  # Replace or add API_BASE_URL
  if grep -q '^REACT_APP_API_BASE_URL=' "$ENV_FILE"; then
    sed -i.bak "s|^REACT_APP_API_BASE_URL=.*|REACT_APP_API_BASE_URL=$BACKEND_URL/api|g" "$ENV_FILE"
  else
    echo "REACT_APP_API_BASE_URL=$BACKEND_URL/api" >> "$ENV_FILE"
  fi
  echo "Updated $ENV_FILE with backend URL."
else
  # Try to update client/src/config.js or client/src/constants.js
  CONFIG_JS="$FRONTEND_DIR/src/config.js"
  if [ -f "$CONFIG_JS" ]; then
    # Replace API_BASE_URL export or add it
    if grep -q "API_BASE_URL" "$CONFIG_JS"; then
      sed -i.bak "s|API_BASE_URL *= *['\"]\.*['\"]|API_BASE_URL = '$BACKEND_URL/api'|g" "$CONFIG_JS" || true
    else
      # Append export
      echo -e "\nexport const API_BASE_URL = '$BACKEND_URL/api';" >> "$CONFIG_JS"
    fi
    echo "Updated $CONFIG_JS with backend URL."
  else
    echo "No .env.production or src/config.js found; creating .env.production in frontend."
    echo "REACT_APP_API_BASE_URL=$BACKEND_URL/api" > "$ENV_FILE"
  fi
fi

# 5. Commit the config change (safe, small commit)
git add "$FRONTEND_DIR/.env.production" "$FRONTEND_DIR/src/config.js" 2>/dev/null || true
git commit -m "chore: wire frontend to backend at $BACKEND_URL" || true
git push origin HEAD || true

# 6. Rebuild and deploy frontend
cd "$FRONTEND_DIR"
npm ci || npm install
# If build script uses DISABLE_ESLINT_PLUGIN, keep it; otherwise run npm run build
if npm run | grep -q "build"; then
  npm run build || true
fi
FRONTEND_DEPLOY_OUTPUT=$(npx vercel --prod --yes 2>&1)
echo "$FRONTEND_DEPLOY_OUTPUT"
FRONTEND_URL=$(echo "$FRONTEND_DEPLOY_OUTPUT" | grep -Eo 'https://[a-z0-9A-Z._-]+\.vercel\.app' | head -n1)
if [ -z "$FRONTEND_URL" ]; then
  echo "Failed to detect frontend URL from Vercel output. aborting."
  exit 1
fi
echo "Frontend deployed at: $FRONTEND_URL"

# 7. Verify signup/login endpoints
# Check health root and API signup endpoint
HTTP_ROOT=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")
HTTP_API=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health" || true)
HTTP_SIGNUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"test":"ping"}' "$BACKEND_URL/api/signup" || true)
echo "Frontend HTTP status: $HTTP_ROOT"
echo "Backend /api/health status: $HTTP_API"
echo "Backend /api/signup (test POST) status: $HTTP_SIGNUP"

# 8. Final message
if [ "$HTTP_ROOT" = "200" ] && [ "$HTTP_API" = "200" ]; then
  echo "SUCCESS: Frontend and backend deployed and connected."
  echo "Frontend: $FRONTEND_URL"
  echo "Backend: $BACKEND_URL"
else
  echo "WARNING: One or more checks failed. Inspect logs in Vercel dashboard for details."
  echo "Frontend: $FRONTEND_URL"
  echo "Backend: $BACKEND_URL"
fi
