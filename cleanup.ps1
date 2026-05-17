# cleanup.ps1 – Remove malicious VBS startup items

# -------------------------------------------------
# This script performs the following actions:
# 1. Deletes any .vbs files in both user and All Users Startup folders.
# 2. Scans the HKCU and HKLM Run registry keys for entries that
#    reference malicious script paths and removes them.
# 3. Logs all actions to a log file for audit purposes.
# 4. Informs the user when cleanup is complete.
# -------------------------------------------------

# Enable logging to file
$logFile = Join-Path $PSScriptRoot "cleanup.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $logFile -Value "[$timestamp] === Cleanup Script Started ==="

function Write-Log {
    param([string]$Message)
    $logEntry = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Add-Content -Path $logFile -Value $logEntry
    Write-Host $Message
}

# Check for admin rights
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Log "Running with Administrator privileges."
}
else {
    Write-Log "NOT running as Administrator. HKLM registry changes may fail."
}

# 1. Remove .vbs files from user Startup folder
$startupPaths = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
)

foreach ($startupPath in $startupPaths) {
    if (Test-Path $startupPath) {
        Write-Log "Cleaning Startup folder: $startupPath"
        Get-ChildItem -Path $startupPath -Filter *.vbs -Force -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Log "Deleting $($_.FullName)"
            try {
                Remove-Item -Path $_.FullName -Force -ErrorAction Stop
                Write-Log "Successfully deleted: $($_.FullName)"
            }
            catch {
                Write-Log "Failed to delete: $($_.FullName) - $_"
            }
        }
    }
    else {
        Write-Log "Startup folder not found (may not exist): $startupPath"
    }
}

# 2. Define registry Run keys to inspect
$runKeys = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
)

# Only include HKLM if running as admin
if ($isAdmin) {
    $runKeys += "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
}

# 3. Target malicious script paths (case‑insensitive) - corrected path
$badPaths = @(
    "C:\ProgramData\SystemConfig\config1.vbs",
    "C:\ProgramData\config1.vbs",
    "SystemConfig"
)

foreach ($key in $runKeys) {
    Write-Log "Scanning registry key: $key"
    try {
        if (Test-Path $key) {
            $props = Get-ItemProperty -Path $key -ErrorAction Stop
            $props.PSObject.Properties |
            ForEach-Object {
                $name = $_.Name
                $value = $_.Value
                foreach ($badPath in $badPaths) {
                    if ($value -like "*$badPath*") {
                        Write-Log "Found suspicious registry entry: $name = $value"
                        try {
                            Remove-ItemProperty -Path $key -Name $name -Force -ErrorAction Stop
                            Write-Log "Successfully removed registry entry: $name from $key"
                        }
                        catch {
                            Write-Log "Failed to remove registry entry: $name - $_"
                        }
                    }
                }
            }
        }
    }
    catch {
        Write-Log "Unable to read $key - $_"
    }
}

Write-Log "Cleanup complete. Please reboot the system."
Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] === Cleanup Script Finished ==="
REPLACE
