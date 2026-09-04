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

# Runtime patch: pi-freeflow dots clamp (host bind mount may have stale 512K)
# Patch both /opt (image) and /root/.pi (host volume) idempotently; also feynman EXDEV
if command -v python3 >/dev/null 2>&1; then
  python3 << 'PYPATCH' 2>&1 | sed 's/^/[entrypoint-patch] /' || true
import pathlib
def patch_proxy(p):
    try:
        t = pathlib.Path(p).read_text()
        if 'AtlasCloud safe limit' not in t:
            if 'getModelDef' not in t:
                t = t.replace('import { KILO_MODEL_IDS, resolveCanonicalModelId } from "./models.ts";', 'import { KILO_MODEL_IDS, getModelDef, resolveCanonicalModelId } from "./models.ts";')
            old='if (isKilo && parsedBody) {\n'
            new='''if (isKilo && parsedBody) {
                    // Clamp max_completion_tokens to AtlasCloud safe limit (dots fails >390k, advertised 512k is overstated)
                    try {
                        const modelDef = getModelDef(parsedBody.model as string);
                        if (modelDef) {
                            const safeLimit = Math.min(modelDef.maxTokens ?? 32000, (modelDef.contextWindow ?? 128000) - 1000);
                            const atlasCap = (typeof parsedBody.model === 'string' && parsedBody.model.includes('dots')) ? 390000 : safeLimit;
                            const limit = Math.min(safeLimit, atlasCap);
                            if (typeof (parsedBody as any).max_completion_tokens === 'number' && (parsedBody as any).max_completion_tokens > limit) {
                                (parsedBody as any).max_completion_tokens = limit;
                            }
                            if (typeof (parsedBody as any).max_tokens === 'number' && (parsedBody as any).max_tokens > limit) {
                                (parsedBody as any).max_tokens = limit;
                            }
                            if (typeof (parsedBody as any).max_completion_tokens === 'number' && (parsedBody as any).max_completion_tokens > 390000 && typeof parsedBody.model === 'string' && parsedBody.model.includes('dots')) {
                                (parsedBody as any).max_completion_tokens = 390000;
                            }
                        } else {
                            if (typeof (parsedBody as any).max_completion_tokens === 'number' && (parsedBody as any).max_completion_tokens > 390000) {
                                (parsedBody as any).max_completion_tokens = 390000;
                            }
                            if (typeof (parsedBody as any).max_tokens === 'number' && (parsedBody as any).max_tokens > 390000) {
                                (parsedBody as any).max_tokens = 390000;
                            }
                        }
                    } catch {}
'''
            if old in t:
                t=t.replace(old,new)
                pathlib.Path(p).write_text(t)
                print(f'patched proxy {p}')
    except Exception as e:
        print(f'proxy patch fail {p}: {e}')
for fp in ['/opt/pi-freeflow/src/proxy.ts','/root/.pi/agent/npm/node_modules/pi-freeflow/src/proxy.ts']:
    patch_proxy(fp)
for fp in ['/opt/pi-freeflow/src/models.ts','/root/.pi/agent/npm/node_modules/pi-freeflow/src/models.ts']:
    try:
        t=pathlib.Path(fp).read_text()
        old='id: "dots-studio/dots-3-note-preview:free",\n\t\tname: "Dots3-Note Preview (512K)",\n\t\treasoning: true,\n\t\tcontextWindow: 512_000,\n\t\tmaxTokens: 512_000,'
        new='id: "dots-studio/dots-3-note-preview:free",\n\t\tname: "Dots3-Note Preview (390K)",\n\t\treasoning: true,\n\t\tcontextWindow: 512_000,\n\t\tmaxTokens: 390_000,'
        if old in t:
            t=t.replace(old,new)
            pathlib.Path(fp).write_text(t)
            print(f'fixed dots model {fp}')
    except Exception as e:
        print(f'model patch fail {fp}: {e}')
# feynman EXDEV
try:
    import re
    fp='/opt/feynman/node_modules/@companion-ai/feynman/scripts/lib/runtime-workspace-restore.mjs'
    p=pathlib.Path(fp)
    if p.exists():
        t=p.read_text()
        if 'renameOrCopySync' not in t:
            t=t.replace('renameSync,', 'renameSync,\n\tcpSync,')
            helper='\n// Helper: rename with EXDEV fallback (cross-device)\nfunction renameOrCopySync(src, dest) {\n  try { return renameSync(src, dest); } catch (e) {\n    if (e && e.code === "EXDEV") {\n      cpSync(src, dest, { recursive: true, force: true });\n      rmSync(src, { recursive: true, force: true });\n      return;\n    }\n    throw e;\n  }\n}\n'
            t=t.replace('} from "node:fs";', '} from "node:fs";'+helper)
            placeholder='__RENAMESYNC_HELPER__'
            t=t.replace('return renameSync(src, dest);', f'return {placeholder}(src, dest);')
            t=re.sub(r'renameSync\(', 'renameOrCopySync(', t)
            t=t.replace(f'{placeholder}(', 'renameSync(')
            p.write_text(t)
            print(f'patched feynman {fp}')
except Exception as e:
    print(f'feynman patch fail: {e}')
PYPATCH
fi

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
        if ! git fetch --quiet 2>&1 | while read -r line; do [ -n "$line" ] && echo "[git-sync] $line"; done; then
          echo "[git-sync] fetch failed, will retry"
          continue
        fi
        LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
        REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")
        if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
          echo "[git-sync] 🔄 $LOCAL -> $REMOTE, pulling..."
          if git pull --ff-only --quiet 2>&1 | while read -r l; do echo "[git-sync] $l"; done; then
            echo "[git-sync] ✅ pulled, code synced via volume (no rebuild needed for code-only changes)"
            if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -qiE "Dockerfile|docker-compose|docker-entrypoint|requirements|package\.json"; then
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
