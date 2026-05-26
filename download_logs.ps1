# download_logs.ps1
# Fetch the latest workflow run logs for the VaultBank repository and extract them.

$owner = "matunot"
$repo = "vaultbank"
$apiUrl = "https://api.github.com/repos/$owner/$repo/actions/runs?per_page=1"

# GitHub API requires a User-Agent header
$headers = @{ "User-Agent" = "PowerShell" }

# Get the latest run JSON
$response = Invoke-WebRequest -Uri $apiUrl -Headers $headers
$runData = $response.Content | ConvertFrom-Json

if ($runData.workflow_runs.Count -eq 0) {
    Write-Error "No workflow runs found."
    exit 1
}

$run = $runData.workflow_runs[0]
$runId = $run.id
$logsUrl = $run.logs_url

Write-Host "Downloading logs for run ID $runId..."

# Download the logs zip
$zipPath = "run_${runId}_logs.zip"
Invoke-WebRequest -Uri $logsUrl -Headers $headers -OutFile $zipPath

# Extract the zip
$extractPath = "run_${runId}_logs"
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

Write-Host "Logs downloaded and extracted to $extractPath"
