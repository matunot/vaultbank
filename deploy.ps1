<#
Cline automation script — run from repository root (Windows PowerShell)

This script automates the full deployment workflow for the VaultBank project.
It performs the following steps:
1) Ensure client build script and craco dependency
2) Create or update vercel.json at repo root
3) Clean and reinstall client dependencies
4) Verify craco binary exists (fallback install if needed)
5) Commit changes and push to origin main
6) Trigger Vercel production deploy and wait
7) Poll Vercel for the production URL and validate it

Prerequisites:
 - Node.js 22.x installed (ensure `node -v` reports a 22.x version)
 - npm installed
 - git installed and configured with remote `origin`
 - Vercel CLI installed globally (`npm i -g vercel`)
 - Access to the repository with push rights

Run this script from the repository root using PowerShell:
   .\deploy.ps1
#>

$ErrorActionPreference = "Stop"

# 1) Ensure client build script and craco dependency
$clientPkg = "client\package.json"
if (-Not (Test-Path $clientPkg)) {
    Write-Host "ERROR: client/package.json not found"
    exit 1
}

# Load package.json
$pkg = Get-Content $clientPkg -Raw | ConvertFrom-Json

# Ensure scripts.build and scripts.start
if (-Not $pkg.scripts) { $pkg | Add-Member -MemberType NoteProperty -Name scripts -Value @{} -Force }
$pkg.scripts.build = "craco build"
$pkg.scripts.start = "craco start"

# Ensure engines.node is set to 22.x
if (-Not $pkg.engines) { $pkg | Add-Member -MemberType NoteProperty -Name engines -Value @{} -Force }
$pkg.engines.node = "22.x"

# Ensure @craco/craco in dependencies (or devDependencies)
$hasCraco = $false
if ($pkg.dependencies -and $pkg.dependencies."@craco/craco") { $hasCraco = $true }
if ($pkg.devDependencies -and $pkg.devDependencies."@craco/craco") { $hasCraco = $true }
if (-Not $hasCraco) {
    if (-Not $pkg.dependencies) { $pkg | Add-Member -MemberType NoteProperty -Name dependencies -Value @{} -Force }
    $pkg.dependencies."@craco/craco" = "^7.0.0"
}

# Save modified package.json
$pkg | ConvertTo-Json -Depth 10 | Set-Content $clientPkg -Encoding UTF8

# 2) Create or update vercel.json at repo root
$vercelPath = "vercel.json"
$vercelJson = @{
    buildCommand = "cd client && npm run build"
    outputDirectory = "client/build"
}

if (Test-Path $vercelPath) {
    # Load existing vercel.json and merge while preserving existing routes
    $existing = Get-Content $vercelPath -Raw | ConvertFrom-Json
    $merged = $existing | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    $merged.buildCommand = $vercelJson.buildCommand
    $merged.outputDirectory = $vercelJson.outputDirectory
    # Preserve routes if they exist
    if ($existing.routes) { $merged.routes = $existing.routes }
    $merged | ConvertTo-Json -Depth 10 | Set-Content $vercelPath -Encoding UTF8
} else {
    $vercelJson | ConvertTo-Json -Depth 5 | Set-Content $vercelPath -Encoding UTF8
}

# 3) Clean and reinstall client dependencies
Write-Host "Removing client\node_modules and package-lock.json..."
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "client\node_modules"
Remove-Item -Force -ErrorAction SilentlyContinue "client\package-lock.json"
Write-Host "Installing dependencies in client..."
Push-Location client
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed"; Pop-Location; exit 1 }
Pop-Location

# 4) Verify craco binary exists
if (-Not (Test-Path "client\node_modules\.bin\craco")) {
    Write-Host "craco binary missing; attempting global install fallback..."
    npm install @craco/craco --prefix client --no-audit --no-fund
    if (-Not (Test-Path "client\node_modules\.bin\craco")) { Write-Host "craco install failed"; exit 1 }
}
95 | # 5) Commit changes and push to origin main
96 | # Include all modified files, especially the CI workflow file
97 | git add client/package.json vercel.json .github/workflows/deploy.yml
98 | git commit -m "chore: update CI workflow and deployment script"
99 | git push origin HEAD:main
git push origin HEAD:main

# 6) Ensure Vercel uses Node 22.x in project settings via vercel.json engines override
# (vercel will respect package.json engines; ensure project setting matches)

# 7) Trigger Vercel production deploy and wait
Write-Host "Triggering Vercel production deploy..."
npx vercel --prod --yes
if ($LASTEXITCODE -ne 0) { Write-Host "Vercel deploy command failed"; exit 1 }

# 8) Poll Vercel inspect URL from last output to find production URL (fallback: read from vercel CLI output)
Start-Sleep -Seconds 5
Write-Host "Waiting 10 seconds for deployment to stabilize..."
Start-Sleep -Seconds 10

# 9) Try to fetch production URL from Vercel project alias (best-effort)
$deploys = npx vercel ls --prod --limit 1 --json 2>$null | ConvertFrom-Json
if ($deploys -and $deploys[0].url) {
    $prodUrl = "https://$($deploys[0].url)"
} else {
    $prodUrl = $null
}

if (-Not $prodUrl) {
    Write-Host "Could not auto-detect production URL. Attempting to open Vercel dashboard..."
    npx vercel --prod --yes --debug
    Write-Host "Deployment triggered. Check Vercel dashboard for the production URL."
    exit 0
}

# 10) Validate production URL
Write-Host "Validating production URL: $prodUrl"
try {
    $resp = Invoke-WebRequest -Uri $prodUrl -UseBasicParsing -Method Head -TimeoutSec 30
    if ($resp.StatusCode -eq 200) { Write-Host "✅ Deployment successful, VaultBank live at $prodUrl"; exit 0 }
    else { Write-Host "Deployment returned status $($resp.StatusCode). Check Vercel logs."; exit 1 }
} catch {
    Write-Host "Failed to reach $prodUrl. Check Vercel logs. $_"
    exit 1
}
