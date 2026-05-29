#!/usr/bin/env bash

# clean.sh – Remove node_modules and caches

set -e

echo "=== Cleaning node_modules and caches ==="

# Remove root node_modules if present
if [ -d "node_modules" ]; then
  rm -rf node_modules
  echo "Removed root node_modules"
fi

# Remove client node_modules and lock file
if [ -d "client/node_modules" ]; then
  rm -rf client/node_modules
  echo "Removed client/node_modules"
fi
if [ -f "client/package-lock.json" ]; then
  rm -f client/package-lock.json
  echo "Removed client/package-lock.json"
fi

# Remove server node_modules and lock file (if any)
if [ -d "server/node_modules" ]; then
  rm -rf server/node_modules
  echo "Removed server/node_modules"
fi
if [ -f "server/package-lock.json" ]; then
  rm -f server/package-lock.json
  echo "Removed server/package-lock.json"
fi

# Clean npm cache
npm cache clean --force

echo "=== Clean complete ==="
