# Auto-fix VaultBank production 401: sync env, redeploy, validate
# Run from repository root in PowerShell. Requires Vercel CLI (npx vercel) and login or VERCEL_TOKEN env var.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function ConvertFrom-EnvFile($path) {
    $map = @{}
    if (-Not (Test-Path $path)) { return $map }
    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $idx = $line.IndexOf('=')
            if ($idx -gt 0) {
                $k = $line.Substring(0, $idx).Trim()
                $v = $line.Substring($idx + 1).Trim()
                if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
                if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length - 2) }
                if ($k) { $map[$k] = $v }
            }
        }
    }
    return $map
}

# 1) Detect production URL from Vercel (best‑effort)
Write-Host "Detecting latest production URL..."
try {
    $ls = & npx vercel ls --prod --limit 1 --json 2>$null
    $arr = $ls | ConvertFrom-Json
    if ($arr -and $arr[0].url) {
        $prodUrl = "https://$($arr[0].url)"
        Write-Host "Found production URL: $prodUrl"
    }
    else {
        $prodUrl = $null
        Write-Host "No production URL found via vercel ls."
    }
}
catch {
    $prodUrl = $null
    Write-Host "vercel ls failed; will use deploy output later."
}

# 2) Quick check of current production response (if URL known)
if ($prodUrl) {
    try {
        $resp = Invoke-WebRequest -Uri $prodUrl -Method Head -UseBasicParsing -TimeoutSec 15
        Write-Host "Production HTTP status: $($resp.StatusCode)"
        if ($resp.StatusCode -ne 401 -and $resp.StatusCode -ne 403) {
            Write-Host "No 401 detected; nothing to fix."
            exit 0
        }
        Write-Host "401 detected — proceeding to sync env vars and redeploy."
    }
    catch {
        Write-Host "Could not reach production URL; proceeding to sync env vars and redeploy."
    }
}

# 3) Collect candidate env vars from local .env files
$envFiles = @(
    "client/.env.production",
    "client/.env",
    "client/.env.local",
    ".env.production",
    ".env",
    ".env.local"
)
$localVars = @{}
foreach ($f in $envFiles) {
    if (Test-Path $f) {
        Write-Host "Parsing $f"
        $parsed = ConvertFrom-EnvFile $f
        foreach ($k in $parsed.Keys) {
            if (-not $localVars.ContainsKey($k)) { $localVars[$k] = $parsed[$k] }
        }
    }
}
if ($localVars.Count -eq 0) {
    Write-Host "No local .env files found or no variables present. Aborting env sync."
    exit 1
}

# 4) List existing Vercel env vars (production) and build a set
Write-Host "Listing Vercel environment variables (production)..."
$vercelListRaw = & npx vercel env ls --scope $(npx vercel whoami 2>$null) --json 2>&1
if (-not $vercelListRaw) {
    try { $vercelListRaw = & npx vercel env ls --json 2>$null } catch {}
}
$existing = @{}
if ($vercelListRaw) {
    try {
        $vercelArr = $vercelListRaw | ConvertFrom-Json
        foreach ($item in $vercelArr) {
            if ($item.environment -eq "production") {
                $existing[$item.key] = $true
            }
        }
    }
    catch {
        Write-Host "Could not parse vercel env list; will attempt to add missing keys anyway."
    }
}

# 5) Add missing keys to Vercel production
$tokenArg = ""
if ($env:VERCEL_TOKEN) { $tokenArg = "--token $env:VERCEL_TOKEN" }
foreach ($k in $localVars.Keys) {
    if (-not $existing.ContainsKey($k)) {
        Write-Host "Adding missing env var to Vercel production: $k"
        $val = $localVars[$k]
        $cmdArgs = @("vercel", "env", "add", $k, $val, "production", "--yes")
        if ($tokenArg) { $cmdArgs += $tokenArg }
        Write-Host ("Running: npx " + ($cmdArgs -join ' '))
        try {
            & npx $cmdArgs 2>&1 | Write-Host
        }
        catch {
            Write-Host "Direct add failed; attempting interactive fallback."
            & npx vercel env add $k production --yes $tokenArg
            Start-Sleep -Seconds 1
        }
    }
    else {
        Write-Host "Env var already present in Vercel: $k"
    }
}

# 6) Trigger a production deploy
Write-Host "Triggering Vercel production deploy..."
$deployOutput = & npx vercel --prod --yes 2>&1
Write-Host $deployOutput

# 7) Try to detect production URL from deploy output
$match = [regex]::Match($deployOutput, 'Production:\s*(https?://\S+)', 'IgnoreCase')
if ($match.Success) {
    $prodUrl = $match.Groups[1].Value
    Write-Host "Detected production URL: $prodUrl"
}

# 8) Validate production URL repeatedly (poll for up to 90 seconds)
if ($prodUrl) {
    $ok = $false
    for ($i = 0; $i -lt 9; $i++) {
        Start-Sleep -Seconds 10
        try {
            $r = Invoke-WebRequest -Uri $prodUrl -Method Head -UseBasicParsing -TimeoutSec 15
            Write-Host "Attempt $($i+1): HTTP $($r.StatusCode)"
            if ($r.StatusCode -eq 200) {
                $ok = $true
                break
            }
            if ($r.StatusCode -ne 401) {
                break
            }
        }
        catch {
            Write-Host "Attempt $($i+1): request failed or timed out."
        }
    }
    if ($ok) {
        Write-Host "✅ Deployment successful and responding 200 at $prodUrl"
        exit 0
    }
    else {
        Write-Host "Final status not 200. Last known URL: $prodUrl"
        exit 1
    }
}
else {
    Write-Host "Could not detect production URL from deploy output. Check Vercel dashboard."
    exit 1
}
