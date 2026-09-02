# Simple host wrapper – always attaches to main persistent pi session inside container
# Usage: .\pi.ps1              # opens main session (same as docker exec -it pi-personal-agent bash)
#        .\pi.ps1 --help       # pi help
#        .\pi.ps1 -p "hello"   # one-shot
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
$container = "pi-personal-agent"
# ensure container is running
$running = docker inspect -f "{{.State.Running}}" $container 2>$null
if ($running -ne "true") {
  Write-Host "Starting $container..."
  docker compose --project-directory $PSScriptRoot up -d | Out-Host
  Start-Sleep 2
}
if (-not $Args -or $Args.Count -eq 0) {
  docker exec -it $container pi-main
} else {
  # pass through to pi-main (which uses --session-id pi-personal-agent-main)
  docker exec -it $container pi-main @Args
}
