#!/bin/sh
# Cwd-agnostic Vercel build for the VaultBank monorepo.
# Works no matter which Vercel "Root Directory" a project uses:
#   repo root  -> builds ./client, normalizes output to ./dist
#   client/    -> builds in place, output already ./dist
#   server/    -> builds ../client, normalizes output to ./dist
set -e
if [ -f client/package.json ]; then APP=client
elif [ -f ../client/package.json ]; then APP=../client
elif [ -f package.json ]; then APP=.
else echo "vercel-build: cannot locate app (cwd=$(pwd))"; exit 1; fi
echo "vercel-build: APP=$APP cwd=$(pwd)"
if [ "$APP" = "." ]; then npm install; else npm --prefix "$APP" install; fi
if [ "$APP" = "." ]; then npm run build; else npm --prefix "$APP" run build; fi
if [ "$APP/dist" -ef dist ] 2>/dev/null; then echo "vercel-build: output already at ./dist"
else rm -rf dist && cp -r "$APP/dist" dist; fi
echo "vercel-build: done"; ls dist
