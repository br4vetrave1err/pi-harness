# Auto-Update & Sync — No Manual Restarts Needed

Your project is mounted as a volume (`E:/projects/pi-harness:/workspace`), so **code changes are already live-synced** into the container instantly. Only `Dockerfile`/`docker-compose.yml`/`docker-entrypoint.sh` changes need a rebuild/restart.

Pick **one** of 3 auto-update modes (or combine them):

---

## 🥇 Option 1: Host Git Poller (Simplest, Recommended for local dev)
No registry, just `git pull` + auto-restart. Works today without GitHub.

**First-time setup (on Windows host, in `E:\projects\pi-harness`):**
```powershell
git init
git remote add origin https://github.com/YOURUSER/pi-harness.git
git add .
git commit -m "initial"
git push -u origin main
```

**Run the watcher:**
```powershell
# Manual (foreground, logs to console):
.\auto-update.ps1           # or
bash git-sync.sh 15         # git-bash / WSL

# As background Scheduled Task (every boot):
# Create task that runs: powershell -File E:\projects\pi-harness\auto-update.ps1
schtasks /create /tn "pi-harness auto-sync" /tr "powershell -File E:\projects\pi-harness\auto-update.ps1" /sc onlogon /ru "%USERNAME%"
```

Or use the Linux sidecar (no Windows task needed):
```powershell
docker compose --profile git-sync up -d   # starts pi-git-sync container that polls git every 15s
docker logs -f pi-git-sync
```

**Behavior:**
- Code-only change (`*.py`, `*.sh`, `workspace/*`) → `git pull` → instantly visible via volume, optional restart if `RESTART_ON_CODE_CHANGE=1`
- Infra change (`Dockerfile`, `docker-compose.yml`) → `docker compose up -d --build` automatically

---

## 🥈 Option 2: In-Container Watcher (Zero host setup)
Add env to `docker-compose.yml` and recreate:

```yaml
environment:
  - ENABLE_GIT_SYNC=1
  - GIT_SYNC_INTERVAL=15
```

Then:
```powershell
docker compose up -d --build
docker logs -f pi-personal-agent  # look for [git-sync] lines
```

Polls `origin/main` from *inside* the container and `git pull` → volume sync. If infra files changed it logs `⚠️ rebuild needed` (requires host rebuild unless you also enable Watchtower).

---

## 🥉 Option 3: Full CI/CD + Watchtower (Production, hands-free rebuilds)

Push → GitHub Actions builds → Pushes to `ghcr.io` → Watchtower pulls & restarts **automatically**.

**Setup:**

1. **Push to GitHub** (make repo public or keep private):
```powershell
git remote add origin https://github.com/YOURUSER/pi-harness.git
git push -u origin main
```

2. **Enable Watchtower** (one-time on host):
```powershell
docker compose --profile auto-update up -d
# or always-on: remove profiles: ["watchtower"] from docker-compose.yml then:
docker compose up -d
```

3. **GitHub Actions is already configured** (`.github/workflows/docker-ci.yml`):
   - Triggers on `push` to `main`
   - Builds multi-arch image, pushes to `ghcr.io/YOURUSER/pi-harness:latest`
   - Watchtower detects new image within 30s and does `--rolling-restart` + `--cleanup`

4. **Optional: make GHCR package public** → GitHub → Packages → Visibility: Public (if Watchtower needs pull without auth). For private, add:
```powershell
# on host:
echo $GITHUB_TOKEN | docker login ghcr.io -u YOURUSER --password-stdin
```

**Flow:**
```
git push → Actions (build & push ghcr.io) → Watchtower (30s poll) → docker compose restart → Slack notify
```

---

## 🔍 Verify

```powershell
docker ps  # should see pi-personal-agent (+ pi-watchtower or pi-git-sync if enabled)
docker logs -f pi-personal-agent --tail 20
docker logs -f pi-watchtower --tail 20
docker logs -f pi-git-sync --tail 20
```

**Logs already fixed:** With `FREEFLOW_LOG_LEVEL=debug` and new entrypoint, all logs stream to `docker logs`. See `docker-entrypoint.sh`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `fatal: not a git repository` | `git init` + `git remote add origin ...` in `E:\projects\pi-harness` |
| `would be overwritten by merge` | `git stash` or `git reset --hard origin/main` |
| Watchtower not restarting | Ensure label `com.centurylinklabs.watchtower.enable=true` on `pi_agent` and `--label-enable` on watchtower, `docker logs pi-watchtower` |
| Volume not syncing | Check `E:/projects/pi-harness` path is correct for Docker Desktop (Settings → Resources → File Sharing) |
| Need faster poll | Set `GIT_SYNC_INTERVAL=5` or Watchtower `--interval 10` |

## Recommended

- **Local dev:** Option 1 (`git-sync.sh` + `auto-update.ps1` or `--profile git-sync`)
- **Prod / team:** Option 3 (CI + Watchtower) + keep Option 1 as fallback
