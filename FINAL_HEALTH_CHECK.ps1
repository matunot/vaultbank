# FINAL_HEALTH_CHECK.ps1 - run after deploy
Write-Host '🔍 Checking VaultBank production health...'
$prodUrl = 'https://vaultbank-e5r3gy2bv-matus-projects-c3e42681.vercel.app'
 
# 1) HTTP status check
try {
    $r = Invoke-WebRequest -Uri $prodUrl -Method Head -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    Write-Host ('HTTP Status: {0}' -f $r.StatusCode)
}
catch {
    Write-Host ('HTTP request failed: {0}' -f $_.Exception.Message)
}
 
# 2) SSL/TLS check
# SSL/TLS check - use OpenSSL if available, otherwise skip
if (Get-Command openssl -ErrorAction SilentlyContinue) {
    Write-Host 'SSL Expiry:'
    & openssl s_client -connect vaultbank-e5r3gy2bv-matus-projects-c3e42681.vercel.app:443 -servername vaultbank-e5r3gy2bv-matus-projects-c3e42681.vercel.app -quiet | openssl x509 -noout -dates
}
else {
    Write-Host 'OpenSSL not found - skipping SSL expiry check.'
}
 
# 3) Env var sanity (list production vars)
Write-Host 'Listing production environment variables:'
npx vercel env ls
 
# 4) Dependency audit
npm audit --production
 
# 5) Log tail (last 100 lines)
npx vercel logs --limit 100