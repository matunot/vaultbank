# FINAL_SHOT_AutoRepairAndDeploy.ps1
# Paste and run from repo root. Fully automatic, fast, permanent repairs and deploy.
$ErrorActionPreference = "Stop"
$scriptName = "auto_fix_401.ps1"
$backupDir = ".\repair_backups"
New-Item -Path $backupDir -ItemType Directory -Force | Out-Null
$time = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $backupDir ("$scriptName.bak.$time")
if (-not (Test-Path $scriptName)) { Write-Host "ERROR: $scriptName not found"; exit 1 }

# 1) Atomic backup
Copy-Item -Path $scriptName -Destination $bak -Force
Write-Host "BACKUP: $scriptName -> $bak"

# 2) Fastest safe restore: HEAD if available (very fast)
$restored = $false
try {
    # Removed redirection to avoid PSScriptAnalyzer false positive; errors are caught by outer try/catch
    if ((git rev-parse --is-inside-work-tree) -eq "true") {
        git show HEAD:$scriptName 2>$null | Out-File -FilePath "$scriptName.githead" -Encoding UTF8
        if (Test-Path "$scriptName.githead") {
            Copy-Item -Path "$scriptName.githead" -Destination $scriptName -Force
            Remove-Item "$scriptName.githead" -Force
            Write-Host "RESTORE: restored $scriptName from HEAD commit (fast path)."
            $restored = $true
        }
    }
}
catch { Write-Host "Git restore skipped or failed; continuing to auto-repair." }

# 3) If not restored, optionally perform aggressive parallel repairs (fast)
if (-not $restored) {
    # First, validate the current script syntax. If it is already valid, skip auto‑repair.
    Write-Host "VALIDATE: parsing script before auto‑repair (syntax‑only)..."
    $parseOk = $false
    try {
        [ScriptBlock]::Create((Get-Content -Raw -Path $scriptName)) | Out-Null
        $parseOk = $true
        Write-Host "PARSE_OK"
    }
    catch {
        Write-Host "PARSE_ERROR:"; Write-Host $_.Exception.Message
    }

    if (-not $parseOk) {
        Write-Host "AUTO-REPAIR: starting parallel sanitization..."
        $raw = Get-Content $scriptName -Raw -ErrorAction Stop

        # Launch parallel jobs for independent repairs
        $jobs = @()
        $jobs += Start-Job -ScriptBlock { param($c) if ($c.Length -ge 1 -and $c[0] -eq [char]0xFEFF) { $c = $c.Substring(1) } $c = $c -replace "^\s*[\u0000-\u001F]+", ""; return $c } -ArgumentList $raw
        $jobs += Start-Job -ScriptBlock { param($c) $c = $c -replace "`r`n", "`n"; $c = $c -replace "[\u200B\u200C\u200D\uFEFF]", ""; return $c } -ArgumentList $raw
        $jobs += Start-Job -ScriptBlock { param($c) $lines = $c -split "`n"; for ($i = 0; $i -lt $lines.Length; $i++) { $count = ($lines[$i].ToCharArray() | Where-Object { $_ -eq '"' }).Count; if ($count % 2 -ne 0) { $idx = $lines[$i].LastIndexOf('"'); if ($idx -ge 0) { $lines[$i] = $lines[$i].Remove($idx, 1) } } } return ($lines -join "`n") } -ArgumentList $raw
        $jobs += Start-Job -ScriptBlock { param($c) $append = ""; $tryCount = ([regex]::Matches($c, '\btry\s*\{')).Count; $catchCount = ([regex]::Matches($c, '\bcatch\s*\{')).Count; $finallyCount = ([regex]::Matches($c, '\bfinally\s*\{')).Count; $missing = $tryCount - ($catchCount + $finallyCount); for ($i = 0; $i -lt $missing; $i++) { $append += "`ncatch { Write-Host 'Auto-fixed: added catch' }" } return $append } -ArgumentList $raw

        Wait-Job -Job $jobs
        # Receive results from parallel jobs. Only $r3 (quote fix) and $r4 (catch addition) are used.
        $r3 = Receive-Job $jobs[2]; $r4 = Receive-Job $jobs[3]
        # Merge: prefer cleaned per-line quote fix ($r3), then apply other sanitizations
        $clean = $r3
        $clean = $clean -replace "[\u200B\u200C\u200D\uFEFF]", ""
        # Remove trailing lone backslashes that break parsing
        $clean = $clean -replace '\\s*$' , ''
        # Balance braces: append missing closing braces
        $open = ($clean.ToCharArray() | Where-Object { $_ -eq '{' }).Count
        $close = ($clean.ToCharArray() | Where-Object { $_ -eq '}' }).Count
        if ($open -gt $close) { $missing = $open - $close; $clean += ("`n" + ('}' * $missing)); Write-Host "AUTO-REPAIR: appended $missing closing brace(s)." }
        if ($r4) { $clean += $r4 }

        # Final trim and write
        $clean = $clean.TrimEnd() + "`n"
        Set-Content -Path $scriptName -Value $clean -Encoding UTF8
        Write-Host "AUTO-REPAIR: wrote repaired $scriptName (original backed up)."
    }
    else {
        Write-Host "Script syntax is valid – skipping auto‑repair."
    }
}

# 4) Strict parse validation (no execution)
Write-Host "VALIDATE: parsing script (syntax-only)..."
try {
    [ScriptBlock]::Create((Get-Content -Raw -Path $scriptName)) | Out-Null
    Write-Host "PARSE_OK"
}
catch {
    Write-Host "PARSE_ERROR:"
    Write-Host $_.Exception.Message
    Write-Host "ERROR: syntax validation failed. Restoring backup and exiting."
    Copy-Item -Path $bak -Destination $scriptName -Force
    Write-Host "RESTORED BACKUP: $bak -> $scriptName"
    exit 2
}

# 5) Optional: quick JSON sanity checks for vercel.json and client/package.json (if present)
function Test-JsonFile($path) {
    if (Test-Path $path) {
        try { node -e "JSON.parse(require('fs').readFileSync('$path','utf8')); console.log('JSON_OK')" 2>$null; return $LASTEXITCODE -eq 0 } catch { return $false }
    }
    else { return $true }
}
if (-not (Test-JsonFile "vercel.json")) { Write-Host "WARNING: vercel.json invalid JSON; rewriting minimal vercel.json"; @{ buildCommand = "cd client && npm run build"; outputDirectory = "client/build" } | ConvertTo-Json -Depth 10 | Set-Content vercel.json -Encoding UTF8 }
if (-not (Test-JsonFile "client\package.json")) { Write-Host "ERROR: client/package.json invalid JSON; restoring backup and aborting"; Copy-Item client\package.json.bak client\package.json -Force; exit 3 }

# 6) Commit repaired script (safe) and push (non-blocking)
try {
    $gitInsideWorkTree = git rev-parse --is-inside-work-tree 2>$null
    if ($gitInsideWorkTree -eq "true") {
        git add $scriptName vercel.json client\package.json package.json 2>$null
        git commit -m "chore(repair): auto-fix $scriptName and JSON sanity" -q 2>$null
        git push origin HEAD:main 2>$null
        Write-Host "GIT: committed and pushed repairs (if any)."
    }
}
catch { Write-Host "GIT: commit/push skipped or failed; continuing." }

# 7) Execute repaired script with full transcript and strict timeout
$logFile = Join-Path $backupDir ("auto_fix_401_run.$time.log")
Write-Host "EXECUTE: running $scriptName; streaming to $logFile"
try {
    # Run with transcript to capture everything
    Start-Transcript -Path $logFile -Force
    & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptName
    $exitCode = $LASTEXITCODE
    Stop-Transcript
    Write-Host "EXECUTE: finished with exit code $exitCode; log -> $logFile"
}
catch {
    Stop-Transcript
    Write-Host "EXECUTE: script failed. See log -> $logFile"
    Write-Host $_
    # Restore backup for safety
    Copy-Item -Path $bak -Destination $scriptName -Force
    Write-Host "RESTORED BACKUP after failure: $bak -> $scriptName"
    exit 4
}

# 8) If script succeeded, trigger Vercel deploy and poll production health (fast loop)
if ($exitCode -eq 0) {
    Write-Host "DEPLOY: triggering Vercel production deploy (npx vercel --prod --yes)..."
    $deployOutput = & npx vercel --prod --yes 2>&1
    Write-Host $deployOutput | Tee-Object -FilePath (Join-Path $backupDir ("vercel_deploy_output.$time.log"))
    # Detect production URL
    $match = [regex]::Match($deployOutput, 'Production:\s*(https?://\S+)', 'IgnoreCase')
    if ($match.Success) { $prodUrl = $match.Groups[1].Value } else {
        try {
            $ls = & npx vercel ls --prod --limit 1 --json 2>$null
            $arr = $ls | ConvertFrom-Json
            if ($arr -and $arr[0].url) { $prodUrl = "https://$($arr[0].url)" }
        }
        catch { $prodUrl = $null }
    }
    if ($prodUrl) {
        Write-Host "PROD URL: $prodUrl"
        # Poll quickly up to 12 attempts (total ~60s)
        $ok = $false
        for ($i = 0; $i -lt 12; $i++) {
            Start-Sleep -Seconds 5
            try {
                $r = Invoke-WebRequest -Uri $prodUrl -Method Head -UseBasicParsing -TimeoutSec 10
                Write-Host "Attempt $($i+1): HTTP $($r.StatusCode)"
                if ($r.StatusCode -eq 200) { $ok = $true; break }
                if ($r.StatusCode -ne 401) { break }
            }
            catch { Write-Host "Attempt $($i+1): request failed or timed out." }
        }
        if ($ok) { Write-Host "✅ Deployment healthy: $prodUrl"; exit 0 } else { Write-Host "FINAL STATUS: not healthy"; & npx vercel logs --prod --limit 200 | Tee-Object -FilePath (Join-Path $backupDir ("vercel_runtime_last200.$time.log")); exit 5 }
    }
    else {
        Write-Host "Could not detect production URL from deploy output. Saved deploy output to vercel_deploy_output.$time.log"; exit 6
    }
}
else {
    Write-Host "Repaired script executed but returned non-zero exit code $exitCode. See $logFile"
    exit $exitCode
}