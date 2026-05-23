# Cline automation: remove BOM, validate JSON, ensure craco build, redeploy to Vercel, validate.
# Run from repository root (PowerShell). Fully automatic.

$ErrorActionPreference = "Stop"

# 0) Helpers
function Remove-BOMFromFile($path) {
    if (-Not (Test-Path $path)) { return $false }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        # remove BOM
        $newBytes = $bytes[3..($bytes.Length - 1)]
        [System.IO.File]::WriteAllBytes($path, $newBytes)
        return $true
    }
    # also remove any leading ZERO WIDTH NO-BREAK SPACE U+FEFF if present as UTF-8 sequence 0xEF 0xBB 0xBF already handled
    return $false
}

# 1) Backups
if (Test-Path package.json) { Copy-Item package.json package.json.bak -Force }
if (Test-Path client\package.json) { Copy-Item client\package.json client\package.json.bak -Force }
if (Test-Path vercel.json) { Copy-Item vercel.json vercel.json.bak -Force }

# 2) Remove BOM from client/package.json and root package.json if present
if (Remove-BOMFromFile "client\package.json") { Write-Host "Removed BOM from client/package.json" }
if (Remove-BOMFromFile "package.json") { Write-Host "Removed BOM from root package.json" }

# 3) Validate and fix client/package.json JSON parse errors (best-effort)
try {
    $rawClient = Get-Content "client\package.json" -Raw -ErrorAction Stop
    $clientPkg = $rawClient | ConvertFrom-Json -ErrorAction Stop
    Write-Host "client/package.json parsed OK"
}
catch {
    Write-Host "client/package.json invalid JSON. Attempting to sanitize and rewrite."
    # Remove any non-printable control characters at start
    $san = $rawClient -replace '^\s*[\uFEFF\u0000-\u001F]+' , ''
    try {
        $clientPkg = $san | ConvertFrom-Json -ErrorAction Stop
        $san | Set-Content "client\package.json" -Encoding UTF8
        Write-Host "Sanitized client/package.json and saved."
    }
    catch {
        Write-Host "Failed to auto-parse client/package.json. Restoring backup and aborting."
        if (Test-Path "client\package.json.bak") { Copy-Item "client\package.json.bak" "client\package.json" -Force }
        exit 1
    }
}

# 4) Ensure client scripts and craco dependency
if (-Not $clientPkg.scripts) { $clientPkg | Add-Member -MemberType NoteProperty -Name scripts -Value @{} -Force }
$clientPkg.scripts.build = "craco build"
$clientPkg.scripts.start = "craco start"
if (-Not $clientPkg.dependencies) { $clientPkg | Add-Member -MemberType NoteProperty -Name dependencies -Value @{} -Force }
# Ensure @craco/craco has a proper version string
$clientPkg.dependencies."@craco/craco" = "^7.0.0"

# Save fixed client/package.json without BOM using .NET API to avoid BOM
# Serialize client/package.json without BOM
$clientJson = $clientPkg | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("client\package.json", $clientJson, $utf8NoBom)
Write-Host "Ensured client/package.json has build script and @craco/craco dependency."

# 5) Fix vercel.json: parse; if invalid, create minimal valid file and preserve routes if possible
$vercelObj = $null
$needVercelRewrite = $false
if (Test-Path "vercel.json") {
    try {
        $vercelRaw = Get-Content "vercel.json" -Raw -ErrorAction Stop
        $vercelObj = $vercelRaw | ConvertFrom-Json -ErrorAction Stop
        Write-Host "vercel.json parsed OK"
    }
    catch {
        Write-Host "vercel.json invalid. Attempting to preserve routes and rewrite."
        $needVercelRewrite = $true
        $routesMatch = [regex]::Match($vercelRaw, '"routes"\s*:\s*(\[[\s\S]*?\])', 'IgnoreCase')
        if ($routesMatch.Success) {
            try { $routesObj = $routesMatch.Groups[1].Value | ConvertFrom-Json; Write-Host "Preserved routes block." } catch { $routesObj = $null; Write-Host "Could not parse routes block." }
        }
        else { $routesObj = $null }
    }
}
else {
    $needVercelRewrite = $true
}

if ($needVercelRewrite -or -not $vercelObj) {
    $newVercel = @{ buildCommand = "cd client && npm run build"; outputDirectory = "client/build" }
    if ($routesObj) { $newVercel.Add("routes", $routesObj) }
    $newVercel | ConvertTo-Json -Depth 10 | Set-Content vercel.json -Encoding UTF8
    Write-Host "Wrote valid vercel.json"
}

# 6) Align root package.json engines to match the local Node version (22.x)
try {
    $rootRaw = Get-Content "package.json" -Raw -ErrorAction Stop
    $rootPkg = $rootRaw | ConvertFrom-Json -ErrorAction Stop
    if (-Not $rootPkg.engines) { $rootPkg | Add-Member -MemberType NoteProperty -Name engines -Value @{} -Force }
    $rootPkg.engines.node = "22.x"
    $rootJson = $rootPkg | ConvertTo-Json -Depth 10
    # Write root package.json without BOM
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText("package.json", $rootJson, $utf8NoBom)
    Write-Host "Set root package.json engines.node = 22.x"
}
catch {
    Write-Host "Warning: could not parse root package.json; skipping engines update."
}

# 7) Clean and reinstall client dependencies
Write-Host "Removing client/node_modules and client/package-lock.json..."
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "client\node_modules"
Remove-Item -Force -ErrorAction SilentlyContinue "client\package-lock.json"
Write-Host "Installing client dependencies..."
Push-Location client
# Use npm.cmd to avoid potential command parsing issues
npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed in client"; Pop-Location; exit 1 }
Pop-Location
Write-Host "Dependencies installed."

# 8) Verify craco binary exists; install if missing
if (-Not (Test-Path "client\node_modules\.bin\craco")) {
    Write-Host "craco binary missing; installing @craco/craco in client..."
    npm install @craco/craco --prefix client --no-audit --no-fund
    if (-Not (Test-Path "client\node_modules\.bin\craco")) { Write-Host "craco install failed"; exit 1 }
}

# 9) Commit and push changes
git add client/package.json vercel.json package.json
git commit -m "ci: fix BOM and JSON, ensure craco build, align Node to 22.x" -q 2>$null
git push origin HEAD:main
Write-Host "Committed and pushed fixes."

# 9.5) Link Vercel project and trigger production deploy
Write-Host "Linking Vercel project..."
$linkOutput = & cmd /c "npx vercel link --yes --project vaultbank --scope matus-projects-c3e42681" 2>&1
Write-Host $linkOutput
Write-Host "Triggering Vercel production deploy..."
$deployOutput = & cmd /c "npx vercel --prod --yes" 2>&1
Write-Host $deployOutput

# 11) Detect production URL
$prodUrl = $null
$match = [regex]::Match($deployOutput, 'Production:\s*(https?://\S+)', 'IgnoreCase')
if ($match.Success) { $prodUrl = $match.Groups[1].Value }
if (-not $prodUrl) {
    try {
        $lsJson = & npx vercel ls --prod --limit 1 --json 2>$null
        if ($lsJson) {
            $arr = $lsJson | ConvertFrom-Json
            if ($arr -and $arr[0].url) { $prodUrl = "https://$($arr[0].url)" }
        }
    }
    catch {}
}

# 12) Validate production URL
if ($prodUrl) {
    Write-Host "Validating production URL: $prodUrl"
    try {
        $resp = Invoke-WebRequest -Uri $prodUrl -Method Head -UseBasicParsing -TimeoutSec 30
        Write-Host "HTTP status: $($resp.StatusCode)"
        if ($resp.StatusCode -eq 200) { Write-Host "✅ Deployment successful, VaultBank live at $prodUrl"; exit 0 } else { Write-Host "Deployment returned status $($resp.StatusCode). Check Vercel logs."; exit 1 }
    }
    catch { Write-Host "Could not reach $prodUrl. Check Vercel logs. $_"; exit 1 }
}
else {
    Write-Host "Could not auto-detect production URL. Run 'npx vercel --prod --yes --debug' or check Vercel dashboard."
    exit 1
}
