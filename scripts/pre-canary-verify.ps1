#Requires -Version 5.1
<#
.SYNOPSIS
    VaultBank Pre-Canary Verification Script
.DESCRIPTION
    Runs all pre-canary checks and reports Go/No-Go status.
    Run this after secrets are set and deployment is complete.
.PARAMETER BaseUrl
    The production URL to test (default: https://vaultbank.vercel.app)
.EXAMPLE
    .\scripts\pre-canary-verify.ps1
    .\scripts\pre-canary-verify.ps1 -BaseUrl https://vaultbank.vercel.app
#>
param(
    [string]$BaseUrl = "https://vaultbank.vercel.app"
)

$ErrorActionPreference = "Continue"
$Pass = 0
$Fail = 0

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  VaultBank Pre-Canary Verification" -ForegroundColor Cyan
Write-Host "  Target: $BaseUrl" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

function Test-Check {
    param(
        [string]$Name,
        [scriptblock]$Test,
        [string]$Expected = "PASS"
    )
    try {
        $result = & $Test
        if ($result -match $Expected) {
            Write-Host "  [PASS] $Name" -ForegroundColor Green
            $script:Pass++
            return $true
        }
        else {
            Write-Host "  [FAIL] $Name (got: $result)" -ForegroundColor Red
            $script:Fail++
            return $false
        }
    }
    catch {
        Write-Host "  [FAIL] $Name (error: $($_.Exception.Message))" -ForegroundColor Red
        $script:Fail++
        return $false
    }
}

# ============================================
# SECTION 1: Security Headers
# ============================================
Write-Host "--- Security Headers ---" -ForegroundColor Yellow

Test-Check "HSTS Header Present" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/health" -Method Head -UseBasicParsing -ErrorAction Stop
    return $resp.Headers["Strict-Transport-Security"]
} "max-age"

Test-Check "X-Content-Type-Options Header" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/health" -Method Head -UseBasicParsing -ErrorAction Stop
    return $resp.Headers["X-Content-Type-Options"]
} "nosniff"

Test-Check "Referrer-Policy Header" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/health" -Method Head -UseBasicParsing -ErrorAction Stop
    return $resp.Headers["Referrer-Policy"]
} "no-referrer"

Test-Check "X-Frame-Options Header" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl" -Method Head -UseBasicParsing -ErrorAction Stop
    return $resp.Headers["X-Frame-Options"]
} "DENY"

Test-Check "Content-Security-Policy Header" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl" -Method Head -UseBasicParsing -ErrorAction Stop
    return $resp.Headers["Content-Security-Policy"]
} "default-src"

Write-Host ""

# ============================================
# SECTION 2: API Endpoints
# ============================================
Write-Host "--- API Endpoints ---" -ForegroundColor Yellow

Test-Check "Health Endpoint Returns 200" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -ErrorAction Stop
    return "$($resp.StatusCode)"
} "^200$"

Test-Check "Health Response Contains Status OK" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -ErrorAction Stop
    $json = $resp.Content | ConvertFrom-Json
    return $json.status
} "^ok$"

Test-Check "Payments Methods Requires Auth (401/403)" {
    try {
        $resp = Invoke-WebRequest -Uri "$BaseUrl/api/payments/methods" -UseBasicParsing -ErrorAction Stop
        return "$($resp.StatusCode)"
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 401 -or $_.Exception.Response.StatusCode -eq 403) {
            return "$([int]$_.Exception.Response.StatusCode)"
        }
        throw
    }
} "^(401|403)$"

Test-Check "Payments Transfer Endpoint Reachable" {
    try {
        $resp = Invoke-WebRequest -Uri "$BaseUrl/api/payments/transfer" -Method Post -UseBasicParsing -ErrorAction Stop
        return "$($resp.StatusCode)"
    }
    catch {
        $code = [int]$_.Exception.Response.StatusCode
        if ($code -in @(200, 400, 401, 405)) {
            return "$code"
        }
        return "$code"
    }
} "^(200|400|401|405)$"

Write-Host ""

# ============================================
# SECTION 3: Admin Flags Endpoint
# ============================================
Write-Host "--- Admin Flags Endpoint ---" -ForegroundColor Yellow

Test-Check "Admin Flags Endpoint Reachable" {
    try {
        $resp = Invoke-WebRequest -Uri "$BaseUrl/api/admin/flags" -UseBasicParsing -ErrorAction Stop
        return "$($resp.StatusCode)"
    }
    catch {
        $code = [int]$_.Exception.Response.StatusCode
        return "$code"
    }
} "^(200|401|403|405)$"

Write-Host ""

# ============================================
# SECTION 4: SSL/TLS Check
# ============================================
Write-Host "--- SSL/TLS ---" -ForegroundColor Yellow

Test-Check "HTTPS Connection Succeeds" {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $resp = Invoke-WebRequest -Uri "$BaseUrl" -UseBasicParsing -ErrorAction Stop
    return "$($resp.StatusCode)"
} "^200$"

Test-Check "HTTP Redirects to HTTPS" {
    $httpUrl = $BaseUrl -replace "^https://", "http://"
    try {
        $resp = Invoke-WebRequest -Uri $httpUrl -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop
        return "$($resp.StatusCode)"
    }
    catch {
        $code = [int]$_.Exception.Response.StatusCode
        if ($code -in @(301, 302, 307, 308)) {
            return "$code"
        }
        # Some servers block HTTP entirely, which is also acceptable
        return "blocked"
    }
} "^(301|302|307|308|blocked)$"

Write-Host ""

# ============================================
# SECTION 5: Frontend
# ============================================
Write-Host "--- Frontend ---" -ForegroundColor Yellow

Test-Check "Frontend Loads (index.html)" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl" -UseBasicParsing -ErrorAction Stop
    return "$($resp.StatusCode)"
} "^200$"

Test-Check "Frontend Contains React App Root" {
    $resp = Invoke-WebRequest -Uri "$BaseUrl" -UseBasicParsing -ErrorAction Stop
    if ($resp.Content -match "root" -or $resp.Content -match "vaultbank") {
        return "PASS"
    }
    return "FAIL"
} "^PASS$"

Write-Host ""

# ============================================
# SUMMARY
# ============================================
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  RESULTS: $Pass passed, $Fail failed" -ForegroundColor $(if ($Fail -eq 0) { "Green" } else { "Red" })
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if ($Fail -eq 0) {
    Write-Host "  GO: All checks passed. Safe to enable canary." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next step: Enable 5% canary" -ForegroundColor Yellow
    Write-Host '  curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" -d ''{"key":"payments.live_providers_percent","percentage":5}'' https://vaultbank.vercel.app/api/admin/flags' -ForegroundColor DarkGray
    exit 0
}
else {
    Write-Host "  NO-GO: $Fail check(s) failed. Fix before enabling canary." -ForegroundColor Red
    exit 1
}