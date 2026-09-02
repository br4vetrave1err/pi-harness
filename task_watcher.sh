#!/bin/bash
set -u
# Detailed logging: timestamps + unbuffered output for `docker logs`
export PYTHONUNBUFFERED=1
TASK_FILE="/workspace/task.txt"
POLL_INTERVAL=5

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
log "🔍 Pi Agent Watcher started. Monitoring $TASK_FILE (poll ${POLL_INTERVAL}s) FREEFLOW_LOG_LEVEL=${FREEFLOW_LOG_LEVEL:-info}"

while true; do
  if [ -f "$TASK_FILE" ]; then
    TASK=$(cat "$TASK_FILE")
    log "📥 Task detected: $TASK"
    log "Task file content: $(cat "$TASK_FILE" | head -c 500)"

    if [ -n "$TASK" ]; then
      log "Executing: pi -p \"$TASK\""
      set -o pipefail
      pi -p "$TASK" 2>&1 | while IFS= read -r line; do log "[pi] $line"; done
      EXIT_CODE=${PIPESTATUS[0]:-$?}
      log "pi exit code: $EXIT_CODE"
      if [ $EXIT_CODE -eq 0 ]; then
        log "Sending Slack success notification"
        /tools/slack_webhook.sh "Task completed: $TASK" 2>&1 | while IFS= read -r line; do log "[slack] $line"; done || log "⚠️ slack_webhook failed"
        log "✅ Task executed and notification sent."
      else
        log "Sending Slack failure notification (exit $EXIT_CODE)"
        /tools/slack_webhook.sh "Task failed with exit code $EXIT_CODE: $TASK" 2>&1 | while IFS= read -r line; do log "[slack] $line"; done || log "⚠️ slack_webhook failed"
        log "❌ Task failed with exit code $EXIT_CODE."
      fi
    else
      log "⚠️ Empty task file, skipping pi execution"
    fi

    rm -f "$TASK_FILE"
    log "🗑️  Task file removed."
  fi

  sleep "$POLL_INTERVAL"
done
