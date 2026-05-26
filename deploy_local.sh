#!/usr/bin/env bash

# Local deployment script mirroring the GitHub Actions workflow
# This script performs a clean install, builds the client with ESLint disabled,
# deploys to Vercel, and runs the post‑deploy health check.

set -e

echo "=== Starting local deployment ==="

# Step 1: Install root dependencies
echo "Installing root dependencies..."
npm ci

# Step 2: Install client dependencies
echo "Installing client dependencies..."
cd client
npm ci

# Step 3: Build client with ESLint disabled
echo "Building client (ESLint disabled)..."
npx cross-env DISABLE_ESLINT_PLUGIN=true craco build

# Step 4: Deploy to Vercel
echo "Deploying to Vercel..."
# Ensure VERCEL_TOKEN is set in the environment or via .env
npx vercel --prod --yes

# Step 5: Run post‑deploy health check
echo "Running post‑deploy health check..."
# Use PowerShell script for health check (works on Windows and via pwsh on *nix)
pwsh "$(pwd)/../FINAL_HEALTH_CHECK.ps1"

echo "=== Local deployment completed successfully ==="