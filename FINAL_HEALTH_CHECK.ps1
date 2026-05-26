# FINAL_HEALTH_CHECK.ps1 - run after deploy
# Updated based on user feedback to simplify health checks.
Write-Host "� Checking VaultBank production health..."

# Grab API token from environment
$apiToken = $env:NEXT_PUBLIC_API_TOKEN

if ($apiToken) {
    $headers = @{ Authorization = "Bearer $apiToken" }
    Write-Host "✅ Using API token from NEXT_PUBLIC_API_TOKEN"
}
else {
    $headers = @{}
    Write-Host "⚠️ No API token found, proceeding without Authorization header"
}

# Define endpoints to check
$endpoints = @(
    "/",
    "/api/alerts",
    "/api/transfers",
    "/api/auth/login",
    "/api/reports"
)

# Base URL (replace with your Vercel domain)
$baseUrl = "https://vaultbank.vercel.app"

foreach ($endpoint in $endpoints) {
    try {
        $response = Invoke-WebRequest -Uri ($baseUrl + $endpoint) -Headers $headers -UseBasicParsing
        Write-Host "✅ GET $endpoint succeeded: $($response.StatusCode)"
    }
    catch {
        Write-Host "❌ GET $endpoint failed: $($_.Exception.Message)"
    }
}

# Retain original checks
Write-Host "🔍 Listing production environment variables..."
vercel env ls

Write-Host "📜 Tail recent Vercel logs..."
vercel logs $baseUrl --scope production --since 1h