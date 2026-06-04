# VaultBank Production Secrets Setup Script
# ==========================================
# Usage: .\scripts\set-secrets.ps1
# This script sets all 19 production secrets for GitHub Actions and Vercel.
# IMPORTANT: Replace all REPLACE_* placeholders with real values before running.

param(
    [string]$GithubRepo = "matunot/vaultbank",
    [switch]$SkipGithub,
    [switch]$SkipVercel,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  VaultBank Production Secrets Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Prompt for secrets ──────────────────────────────────────────
function Get-SecretValue {
    param([string]$Prompt, [string]$Default = "")
    if ($Default -ne "") {
        $val = Read-Host "$Prompt (default: $Default)"
        if ($val -eq "") { return $Default }
    }
    else {
        $val = Read-Host $Prompt
    }
    return $val
}

Write-Host "Enter production secrets below." -ForegroundColor Yellow
Write-Host "Press Enter to skip any secret (it will not be set)." -ForegroundColor Yellow
Write-Host ""

$secrets = @{}

# Core
$secrets["JWT_SECRET"] = Get-SecretValue "JWT_SECRET (64-char random hex)"
$secrets["DATABASE_URL"] = Get-SecretValue "DATABASE_URL (postgres://...)"
$secrets["CLIENT_URL"] = Get-SecretValue "CLIENT_URL" "https://vaultbank.vercel.app"

# SMTP
$secrets["SMTP_HOST"] = Get-SecretValue "SMTP_HOST"
$secrets["SMTP_PORT"] = Get-SecretValue "SMTP_PORT" "587"
$secrets["SMTP_USER"] = Get-SecretValue "SMTP_USER"
$secrets["SMTP_PASS"] = Get-SecretValue "SMTP_PASS"
$secrets["SMTP_FROM"] = Get-SecretValue "SMTP_FROM" "no-reply@vaultbank.com"

# Stripe
$secrets["PAYMENT_PROVIDER_STRIPE_KEY"] = Get-SecretValue "PAYMENT_PROVIDER_STRIPE_KEY (pk_live_...)"
$secrets["PAYMENT_PROVIDER_STRIPE_SECRET"] = Get-SecretValue "PAYMENT_PROVIDER_STRIPE_SECRET (sk_live_...)"
$secrets["PAYMENT_PROVIDER_STRIPE_WEBHOOK_SECRET"] = Get-SecretValue "PAYMENT_PROVIDER_STRIPE_WEBHOOK_SECRET (whsec_...)"

# Razorpay
$secrets["PAYMENT_PROVIDER_RAZORPAY_KEY"] = Get-SecretValue "PAYMENT_PROVIDER_RAZORPAY_KEY (rzp_live_...)"
$secrets["PAYMENT_PROVIDER_RAZORPAY_SECRET"] = Get-SecretValue "PAYMENT_PROVIDER_RAZORPAY_SECRET"
$secrets["PAYMENT_PROVIDER_RAZORPAY_WEBHOOK_SECRET"] = Get-SecretValue "PAYMENT_PROVIDER_RAZORPAY_WEBHOOK_SECRET"

# PayPal
$secrets["PAYMENT_PROVIDER_PAYPAL_CLIENT_ID"] = Get-SecretValue "PAYMENT_PROVIDER_PAYPAL_CLIENT_ID"
$secrets["PAYMENT_PROVIDER_PAYPAL_SECRET"] = Get-SecretValue "PAYMENT_PROVIDER_PAYPAL_SECRET"
$secrets["PAYMENT_PROVIDER_PAYPAL_WEBHOOK_ID"] = Get-SecretValue "PAYMENT_PROVIDER_PAYPAL_WEBHOOK_ID"

# Google Pay / UPI
$secrets["PAYMENT_PROVIDER_GOOGLEPAY_MERCHANT_ID"] = Get-SecretValue "PAYMENT_PROVIDER_GOOGLEPAY_MERCHANT_ID"
$secrets["PAYMENT_PROVIDER_UPI_PROVIDER"] = Get-SecretValue "PAYMENT_PROVIDER_UPI_PROVIDER" "razorpay"

# Filter out empty values
$secrets = $secrets.GetEnumerator() | Where-Object { $_.Value -ne "" } | ForEach-Object { @{ Key = $_.Key; Value = $_.Value } }

Write-Host ""
Write-Host "Secrets to set: $($secrets.Count)" -ForegroundColor Green
foreach ($s in $secrets) {
    $masked = $s.Value.Substring(0, [Math]::Min(8, $s.Value.Length)) + "***"
    Write-Host "  $($s.Key) = $masked"
}
Write-Host ""

if ($DryRun) {
    Write-Host "[DRY RUN] Would set $($secrets.Count) secrets. Exiting." -ForegroundColor Yellow
    exit 0
}

# ── Set GitHub Secrets ──────────────────────────────────────────
if (-not $SkipGithub) {
    Write-Host "Setting GitHub Secrets for $GithubRepo ..." -ForegroundColor Cyan
    foreach ($s in $secrets) {
        Write-Host "  Setting $($s.Key)..."
        & gh secret set $s.Key --body $s.Value --repo $GithubRepo
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  FAILED to set $($s.Key)" -ForegroundColor Red
        }
        else {
            Write-Host "  OK $($s.Key)" -ForegroundColor Green
        }
    }
    Write-Host "GitHub secrets complete." -ForegroundColor Green
    Write-Host ""
}

# ── Set Vercel Environment Variables ────────────────────────────
if (-not $SkipVercel) {
    Write-Host "Setting Vercel Environment Variables (production + preview) ..." -ForegroundColor Cyan

    # Check if vercel CLI is available
    $vercelAvailable = $null -ne (Get-Command vercel -ErrorAction SilentlyContinue)
    if (-not $vercelAvailable) {
        Write-Host "  WARNING: Vercel CLI not found. Install with: npm i -g vercel" -ForegroundColor Yellow
        Write-Host "  Skipping Vercel env setup. You can set these manually in the Vercel dashboard." -ForegroundColor Yellow
        Write-Host ""
    }
    else {
        foreach ($env in @("production", "preview")) {
            Write-Host "  --- $env ---" -ForegroundColor Magenta
            foreach ($s in $secrets) {
                Write-Host "  Setting $($s.Key) for $env..."
                echo $s.Value | & vercel env add $s.Key $env
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "  FAILED to set $($s.Key) for $env" -ForegroundColor Red
                }
                else {
                    Write-Host "  OK $($s.Key)" -ForegroundColor Green
                }
            }
        }
        Write-Host "Vercel env setup complete." -ForegroundColor Green
    }
    Write-Host ""
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  All secrets set!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Configure provider webhooks (Stripe, Razorpay, PayPal)"
Write-Host "  2. Merge PR and redeploy"
Write-Host "  3. Run pre-canary verification"
Write-Host "  4. Enable 5% canary"