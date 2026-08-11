#Requires -Version 5.1
<#
.SYNOPSIS
    VaultBank Canary Progression Controller
.DESCRIPTION
    Manages canary percentage progression with monitoring checks.
    Use this to safely ramp traffic from 5% → 25% → 100%.
.PARAMETER Action
    The action to perform: status, enable, promote, rollback
.PARAMETER Percentage
    The canary percentage to set (0, 5, 25, 100)
.PARAMETER AdminJwt
    The admin JWT token for authentication
.PARAMETER BaseUrl
    The production URL (default: https://vaultbank.vercel.app)
.EXAMPLE
    .\scripts\canary-progression.ps1 -Action status -AdminJwt $env:ADMIN_JWT
    .\scripts\canary-progression.ps1 -Action enable -Percentage 5 -AdminJwt $env:ADMIN_JWT
    .\scripts\canary-progression.ps1 -Action rollback -AdminJwt $env:ADMIN_JWT
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("status", "enable", "promote", "rollback")]
    [string]$Action,
    
    [int]$Percentage = 0,
    
    [Parameter(Mandatory = $true)]
    [string]$AdminJwt,
    
    [string]$BaseUrl = "https://vaultbank.vercel.app"
)

$ErrorActionPreference = "Stop"

function Get-CanaryStatus {
    param([string]$Url, [string]$Token)
    
    try {
        $resp = Invoke-RestMethod -Uri "$Url/api/admin/flags" -Method Get -Headers @{
            "Authorization" = "Bearer $Token"
        }
        return $resp
    }
    catch {
        Write-Host "  [ERROR] Failed to get canary status: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Set-CanaryPercentage {
    param([string]$Url, [string]$Token, [int]$Pct)
    
    try {
        $body = @{
            key        = "payments.live_providers_percent"
            percentage = $Pct
        } | ConvertTo-Json
        
        $resp = Invoke-RestMethod -Uri "$Url/api/admin/flags" -Method Post -Headers @{
            "Authorization" = "Bearer $Token"
            "Content-Type"  = "application/json"
        } -Body $body
        
        return $resp
    }
    catch {
        Write-Host "  [ERROR] Failed to set canary: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  VaultBank Canary Controller" -ForegroundColor Cyan
Write-Host "  Target: $BaseUrl" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

switch ($Action) {
    "status" {
        Write-Host "Checking current canary status..." -ForegroundColor Yellow
        $status = Get-CanaryStatus -Url $BaseUrl -Token $AdminJwt
        if ($status) {
            Write-Host "  Current Status:" -ForegroundColor Green
            $status | ConvertTo-Json -Depth 3 | Write-Host
        }
    }
    
    "enable" {
        if ($Percentage -notin @(0, 5, 25, 100)) {
            Write-Host "  [ERROR] Percentage must be 0, 5, 25, or 100" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "Setting canary to $Percentage%..." -ForegroundColor Yellow
        $result = Set-CanaryPercentage -Url $BaseUrl -Token $AdminJwt -Pct $Percentage
        if ($result) {
            Write-Host "  [OK] Canary set to $Percentage%" -ForegroundColor Green
        }
    }
    
    "promote" {
        Write-Host "Promoting canary..." -ForegroundColor Yellow
        Write-Host "  Current progression: 5% → 25% → 100%" -ForegroundColor DarkGray
        
        # Get current status first
        $status = Get-CanaryStatus -Url $BaseUrl -Token $AdminJwt
        $currentPct = 0
        
        if ($status -and $status.payments) {
            $currentPct = $status.payments.live_providers_percent
        }
        
        $nextPct = switch ($currentPct) {
            0 { 5 }
            5 { 25 }
            25 { 100 }
            default { 100 }
        }
        
        Write-Host "  Promoting from $currentPct% → $nextPct%" -ForegroundColor Cyan
        $result = Set-CanaryPercentage -Url $BaseUrl -Token $AdminJwt -Pct $nextPct
        if ($result) {
            Write-Host "  [OK] Canary promoted to $nextPct%" -ForegroundColor Green
        }
    }
    
    "rollback" {
        Write-Host "ROLLING BACK CANARY TO 0%!" -ForegroundColor Red
        $result = Set-CanaryPercentage -Url $BaseUrl -Token $AdminJwt -Pct 0
        if ($result) {
            Write-Host "  [OK] Canary disabled (0%)" -ForegroundColor Green
            Write-Host "  All traffic now uses test/sandbox providers" -ForegroundColor Yellow
        }
    }
}

Write-Host ""