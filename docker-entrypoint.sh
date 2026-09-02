#!/bin/bash
set -e

# --- Detailed logging setup ---
export PYTHONUNBUFFERED=${PYTHONUNBUFFERED:-1}
export PYTHONIOENCODING=${PYTHONIOENCODING:-utf-8}
export FREEFLOW_LOG_LEVEL=${FREEFLOW_LOG_LEVEL:-debug}
export FREEFLOW_DEBUG=${FREEFLOW_DEBUG:-1}
export NODE_ENV=${NODE_ENV:-development}

# Ensure log directories exist
mkdir -p /root/.pi/agent
touch /root/.pi/agent/pi-freeflow.log 2>/dev/null || true
chmod 644 /root/.pi/agent/pi-freeflow.log 2>/dev/null || true

echo "================================================================================"
echo "[entrypoint] pi-personal-agent starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[entrypoint] FREEFLOW_LOG_LEVEL=$FREEFLOW_LOG_LEVEL FREEFLOW_DEBUG=$FREEFLOW_DEBUG PYTHONUNBUFFERED=$PYTHONUNBUFFERED"
echo "[entrypoint] Log files:"
echo "  - pi-freeflow: /root/.pi/agent/pi-freeflow.log"
echo "  - pi sessions: /root/.pi/agent/sessions/"
echo "  - docker logs: docker logs pi-personal-agent  / docker compose logs -f"
echo "================================================================================"

# Function to tail a log file to stdout with prefix and follow
tail_with_prefix() {
  local file="$1"
  local prefix="$2"
  # Wait for file to exist, then tail -F with unbuffered output
  (
    while true; do
      if [ -f "$file" ]; then
        # use stdbuf -oL to force line buffering, tail -F to follow rotations
        stdbuf -oL tail -n 0 -F "$file" 2>/dev/null | while IFS= read -r line; do
          echo "[$prefix] $line"
        done
      fi
      sleep 1
    done
  ) &
}

# Start tailing pi-freeflow log (current + rotated) to stdout -> visible in `docker logs`
tail_with_prefix "/root/.pi/agent/pi-freeflow.log" "pi-freeflow"

# Tail rotated logs if they appear
for i in 1 2 3; do
  tail_with_prefix "/root/.pi/agent/pi-freeflow.log.$i" "pi-freeflow.$i"
done

# Tail pi-freeflow catalog and relay state changes (debug)
if [ "${TAIL_SESSIONS:-0}" = "1" ]; then
  echo "[entrypoint] Session tailing enabled (TAIL_SESSIONS=1)"
  tail_with_prefix "/root/.pi/agent/sessions/--workspace--/pi-personal-agent-main.jsonl" "session-main"
fi

# Start task_watcher if enabled (default: off, enable with ENABLE_TASK_WATCHER=1)
if [ "${ENABLE_TASK_WATCHER:-0}" = "1" ] && [ -x /tools/task_watcher.sh ]; then
  echo "[entrypoint] Starting task_watcher.sh..."
  stdbuf -oL -eL /tools/task_watcher.sh 2>&1 | while IFS= read -r line; do echo "[task_watcher] $line"; done &
  echo "[entrypoint] task_watcher pid $!"
else
  echo "[entrypoint] task_watcher disabled (set ENABLE_TASK_WATCHER=1 to enable)"
fi

# Optional: in-container git auto-sync (polls /workspace for git changes)
if [ "${ENABLE_GIT_SYNC:-0}" = "1" ]; then
  INTERVAL=${GIT_SYNC_INTERVAL:-15}
  echo "[entrypoint] Enabling in-container git-sync every ${INTERVAL}s (ENABLE_GIT_SYNC=1)..."
  (
    cd /workspace
    git config --global --add safe.directory /workspace 2>/dev/null || true
    while true; do
      sleep "$INTERVAL"
      if [ -d /workspace/.git ]; then
        if git fetch --quiet 2>&1 | grep -v "^$" ; then echo "[git-sync] fetch output"; fi
        LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
        REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")
        if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
          echo "[git-sync] 🔄 $LOCAL -> $REMOTE, pulling..."
          if git pull --ff-only --quiet 2>&1 | while read -r l; do echo "[git-sync] $l"; done; then
            echo "[git-sync] ✅ pulled, code synced via volume (no rebuild needed for code-only changes)"
            if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -qiE "Dockerfile|docker-compose|docker-entrypoint"; then
              echo "[git-sync] ⚠️  Infra files changed — rebuild needed! Run on HOST: docker compose up -d --build"
              echo "[git-sync] Or enable watchtower for auto-rebuild (see docker-compose.yml)"
            fi
          else
            echo "[git-sync] ❌ pull failed"
          fi
        fi
      fi
    done
  ) 2>&1 | while IFS= read -r line; do echo "$line"; done &
  echo "[entrypoint] git-sync pid $!"
else
  echo "[entrypoint] git-sync disabled (set ENABLE_GIT_SYNC=1 to poll /workspace)"
fi

# Optional: start pi-freeflow daemon eagerly for immediate logs (non-blocking)
if [ "${EAGER_DAEMON:-0}" = "1" ]; then
  echo "[entrypoint] Eagerly starting pi-freeflow daemon..."
  (pi --help >/dev/null 2>&1 &)
fi

echo "[entrypoint] Container ready. Tailing logs to stdout (docker logs -f pi-personal-agent)..."
echo "[entrypoint] For verbose live view inside container: tail -F /root/.pi/agent/pi-freeflow.log"

# Keep container alive and forward signals
# Use `tail -F` as keepalive that also ensures we have a foreground process
# But we already have background tails; now block with infinite wait that logs heartbeat
cleanup() {
  echo "[entrypoint] Shutting down..."
  jobs -p | xargs -r kill 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT

# Heartbeat every 5 minutes to prove container is alive in docker logs (optional, disable with HEARTBEAT=0)
if [ "${HEARTBEAT:-1}" = "1" ]; then
  (
    while true; do
      sleep 300
      echo "[heartbeat] $(date -u +%Y-%m-%dT%H:%M:%SZ) container alive | FREEFLOW_LOG_LEVEL=$FREEFLOW_LOG_LEVEL sessions=$(ls /root/.pi/agent/sessions/--workspace-- 2>/dev/null | wc -l) log_size=$(du -h /root/.pi/agent/pi-freeflow.log 2>/dev/null | cut -f1)"
    done
  ) &
fi

# Block forever, but allow `docker exec` to work
# If a command is passed to entrypoint, exec it instead of tailing forever
if [ $# -gt 0 ]; then
  echo "[entrypoint] Executing custom command: $*"
  exec "$@"
else
  # Default: keep alive and wait for background jobs
  wait
fi
