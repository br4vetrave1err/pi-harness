# auto-update.ps1 — Windows host auto-updater (git pull + docker restart)
# Place in E:\projects\pi-harness\ and run as Scheduled Task or manually
param(
  [int]$Interval = 15,
  [string]$Branch = "main"
)

$RepoDir = $PSScriptRoot
$LogPrefix = "[git-sync]"

function Log($msg) {
  Write-Host "$LogPrefix [$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')] $msg"
}

if (-not (Test-Path "$RepoDir\.git")) {
  Log "ERROR: $RepoDir is not a git repo. Run:"
  Log "  git init; git remote add origin https://github.com/YOURUSER/pi-harness.git"
  exit 1
}

Log "Watching $RepoDir (branch: $Branch) every ${Interval}s"

while ($true) {
  Start-Sleep -Seconds $Interval
  try {
    Push-Location $RepoDir
    git fetch origin $Branch --quiet 2>&1 | ForEach-Object { Log "[fetch] $_" }
    $local = git rev-parse HEAD 2>$null
    $remote = git rev-parse "origin/$Branch" 2>$null
    if ($remote -and $local -ne $remote) {
      Log "🔄 Change detected $local -> $remote, pulling..."
      $changedBefore = git diff --name-only $local $remote 2>$null
      git pull --ff-only --quiet 2>&1 | ForEach-Object { Log "[pull] $_" }
      $new = git rev-parse HEAD
      Log "✅ Pulled $new"
      Log "Changed: $changedBefore"

      if ($changedBefore -match "Dockerfile|docker-compose|docker-entrypoint|requirements|package\.json") {
        Log "🔨 Infra changed, rebuilding..."
        docker compose up -d --build 2>&1 | ForEach-Object { Log "[docker] $_" }
        Log "✅ Rebuilt"
      } else {
        # Volume mount already syncs code, optionally restart
        if ($env:RESTART_ON_CODE_CHANGE -eq "1") {
          Log "♻️ Restarting pi_agent..."
          docker compose restart pi_agent 2>&1 | ForEach-Object { Log "[docker] $_" }
        } else {
          Log "ℹ️ Code synced via volume, no restart needed"
        }
      }
      # Optional Slack notification
      if (Test-Path "$RepoDir\slack_webhook.sh") {
        bash -c "./slack_webhook.sh '🔄 Auto-synced $new'" 2>&1 | ForEach-Object { Log "[slack] $_" }
      }
    }
  } catch {
    Log "WARN: $_"
  } finally {
    Pop-Location
  }
}
