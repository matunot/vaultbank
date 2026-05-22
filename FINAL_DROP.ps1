# FINAL_DROP.ps1 — ultra-fast repair + deploy
$ErrorActionPreference = "Stop"
$script = "auto_fix_401.ps1"
$bak = ".\\repair_backups\\$script.bak.$((Get-Date).ToString('yyyyMMdd_HHmmss'))"
New-Item -ItemType Directory -Force -Path .\\repair_backups | Out-Null
Copy-Item $script $bak -Force

# 🔧 Syntax repair (BOM, quotes, braces, try/catch)
$content = Get-Content $script -Raw
if ($content[0] -eq [char]0xFEFF) { $content = $content.Substring(1) }
$content = $content -replace "[\u200B\u200C\u200D\uFEFF]", "" -replace "\\\\s*$", ""
$open = ($content.ToCharArray() | Where-Object { $_ -eq '{' }).Count
$close = ($content.ToCharArray() | Where-Object { $_ -eq '}' }).Count
if ($open -gt $close) { $content += ("`n" + ('}' * ($open - $close))) }
Set-Content $script $content -Encoding UTF8

# ✅ Validate syntax
try { [ScriptBlock]::Create((Get-Content -Raw $script)) | Out-Null; Write-Host "PARSE_OK" } catch { Write-Host "PARSE_ERROR: $($_.Exception.Message)"; Copy-Item $bak $script -Force; exit 2 }

# 📝 Commit & push
git add $script vercel.json client\\package.json package.json
git commit -m "final-drop: repair + deploy" -q 2>$null
git push origin HEAD:main

# 🚀 Run script + deploy
powershell -NoProfile -ExecutionPolicy Bypass -File $script
$deployOut = npx vercel --prod --yes 2>&1
Write-Host $deployOut

# 🌐 Detect prod URL
$match = [regex]::Match($deployOut, 'Production:\\s*(https?://\\S+)', 'IgnoreCase')
$prodUrl = if ($match.Success) { $match.Groups[1].Value } else { (npx vercel ls --prod --limit 1 --json | ConvertFrom-Json)[0].url }
$prodUrl = "https://$prodUrl"
Write-Host "Production URL: $prodUrl"

# 🔄 Poll until 200 OK
for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 5
    try {
        $r = Invoke-WebRequest -Uri $prodUrl -Method Head -UseBasicParsing -TimeoutSec 10
        Write-Host "Attempt $($i+1): HTTP $($r.StatusCode)"
        if ($r.StatusCode -eq 200) { Write-Host "✅ LIVE: $prodUrl"; exit 0 }
        if ($r.StatusCode -ne 401) { break }
    }
    catch { Write-Host "Attempt $($i+1): failed" }
}
Write-Host "❌ Still not 200. Check Vercel logs."
npx vercel logs --prod --limit 200
exit 1