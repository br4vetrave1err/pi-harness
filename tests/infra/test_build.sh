#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "=== Infra tests ==="
fail=0

check() {
  local desc="$1"; local cmd="$2"
  if eval "$cmd"; then echo "✓ $desc"; else echo "✗ $desc"; fail=1; fi
}

check "Dockerfile FROM pinned ubuntu:24.04" "grep -q 'FROM ubuntu:24.04' '$ROOT/Dockerfile'"
check "Dockerfile ARG PI_VERSION" "grep -q 'ARG PI_VERSION' '$ROOT/Dockerfile'"
check "Dockerfile healthcheck via feynman patch" "grep -q 'renameOrCopySync' '$ROOT/Dockerfile'"
check "docker-compose pi_agent healthcheck" "grep -q 'healthcheck:' '$ROOT/docker-compose.yml' && grep -q 'pi.*--version' '$ROOT/docker-compose.yml'"
check "docker-compose dashboard healthcheck" "grep -q 'wget.*api/fleet' '$ROOT/docker-compose.yml'"
check "docker-compose pi-subagents volume" "grep -q 'pi-subagents:/tmp/pi-subagents' '$ROOT/docker-compose.yml'"
check "docker-entrypoint trap" "grep -q 'trap cleanup SIGTERM' '$ROOT/docker-entrypoint.sh'"
check "docker-entrypoint tail_with_prefix" "grep -q 'tail_with_prefix' '$ROOT/docker-entrypoint.sh'"
check "docker-entrypoint git-sync interval 15" "grep -q 'GIT_SYNC_INTERVAL:-15' '$ROOT/docker-entrypoint.sh'"
check "git-sync.sh safe.directory" "grep -q 'safe.directory' '$ROOT/git-sync.sh'"
check "auto-update.ps1 Interval 15" "grep -q 'Interval = 15' '$ROOT/auto-update.ps1'"
check "slack_webhook retry" "grep -q 'retry 3' '$ROOT/slack_webhook.sh'"
check "task_watcher PIPESTATUS" "grep -q 'PIPESTATUS' '$ROOT/task_watcher.sh'"
check "dashboard.sh extract_tokens" "grep -q 'extract_tokens' '$ROOT/dashboard.sh'"
check "dashboard.sh map_state" "grep -q 'map_state' '$ROOT/dashboard.sh'"

if [ $fail -eq 0 ]; then echo "All infra tests passed"; exit 0; else echo "Infra tests failed"; exit 1; fi
