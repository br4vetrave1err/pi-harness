#!/bin/bash
# git-sync.sh — auto-pull and restart container when git changes detected
# Runs on HOST (Windows) or inside container (if enabled)
# Usage: ./git-sync.sh [interval_seconds]
set -e
INTERVAL=${1:-15}
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH=${GIT_BRANCH:-main}
LOG_PREFIX="[git-sync]"

log() { echo "$LOG_PREFIX [$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

if [ ! -d "$REPO_DIR/.git" ]; then
  log "ERROR: $REPO_DIR is not a git repo. Run: git init && git remote add origin <url>"
  exit 1
fi

# ensure we can pull without interactive prompts
git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true

log "Watching $REPO_DIR (branch: $BRANCH) every ${INTERVAL}s — auto-restart on change"
LAST_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")

while true; do
  sleep "$INTERVAL"
  # fetch quietly
  if ! git fetch origin "$BRANCH" --quiet 2>&1 | while read -r line; do log "[fetch] $line"; done; then
    log "WARN: git fetch failed, retry in ${INTERVAL}s"
    continue
  fi

  REMOTE_HASH=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
  LOCAL_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")

  if [ -z "$REMOTE_HASH" ]; then
    continue
  fi

  if [ "$REMOTE_HASH" != "$LOCAL_HASH" ]; then
    log "🔄 Change detected $LOCAL_HASH -> $REMOTE_HASH, pulling..."
    # stash local changes if any (keep volume safe)
    if ! git diff --quiet 2>/dev/null; then
      log "Local mods detected, stashing"
      git stash push -m "auto-sync stash $(date -u +%Y-%m-%dT%H:%M:%SZ)" --keep-index || true
    fi
    
    if git pull --ff-only --quiet 2>&1 | while read -r line; do log "[pull] $line"; done; then
      NEW_HASH=$(git rev-parse HEAD)
      log "✅ Pulled $NEW_HASH"
      
      # Detect if Dockerfile / compose / entrypoint changed -> need rebuild
      CHANGED_FILES=$(git diff --name-only "$LOCAL_HASH" "$NEW_HASH" 2>/dev/null || echo "")
      log "Changed files: $CHANGED_FILES"
      
      if echo "$CHANGED_FILES" | grep -qiE "Dockerfile|docker-compose|docker-entrypoint|requirements|package\.json"; then
        log "🔨 Infra changed, rebuilding container..."
        if command -v docker >/dev/null 2>&1; then
          docker compose up -d --build 2>&1 | while read -r line; do log "[docker] $line"; done
          log "✅ Rebuilt & restarted"
          # notify slack if configured
          [ -x ./slack_webhook.sh ] && ./slack_webhook.sh "🔄 Auto-rebuilt container from $LOCAL_HASH -> $NEW_HASH" || true
        else
          log "WARN: docker not found, cannot rebuild automatically"
        fi
      else
        # Code-only change — volume mount already synced, just restart if needed
        # For pi_agent, volume mount means no restart needed for code, but restart to reload env
        if [ "${RESTART_ON_CODE_CHANGE:-0}" = "1" ]; then
          log "♻️  Restarting container (RESTART_ON_CODE_CHANGE=1)..."
          docker compose restart pi_agent 2>&1 | while read -r line; do log "[docker] $line"; done || true
        else
          log "ℹ️  Code synced via volume, no restart needed (set RESTART_ON_CODE_CHANGE=1 to force restart)"
        fi
        [ -x ./slack_webhook.sh ] && ./slack_webhook.sh "🔄 Auto-synced code $NEW_HASH" || true
      fi
      LAST_HASH=$NEW_HASH
    else
      log "❌ git pull failed, will retry"
      # try merge fallback
      git pull --rebase --autostash 2>&1 | while read -r line; do log "[rebase] $line"; done || true
    fi
  # else no change, silent unless DEBUG
  fi
done
