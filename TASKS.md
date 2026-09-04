# TASKS — Pi-Harness First-Principles Breakdown

**Date:** 2026-09-04  
**Source plans:** `PLAN-fleet-sync.md`, `PLAN-fleet-observability-UI.md`  
**Codebase commit:** `main` — codebase scanned 2026-09-04 (see file refs below)  
**Method:** First principles — decompose to irreducible truths, map dependency DAG, then reconstruct as ordered tracer-bullet tasks. No task assumes another's abstractions.

---

## Table of Contents

1. [Method](#1-method)
2. [Irreducible Truths](#2-irreducible-truths--axioms)
3. [Component Decomposition](#3-component-decomposition-first-principles)
4. [Dependency DAG](#4-dependency-dag-build-order)
5. [Phased Task Breakdown](#5-phased-task-breakdown)
6. [Task Index (quick filter)](#6-task-index)
7. [Execution Playbook](#7-execution-playbook)
8. [Traceability Matrix](#8-traceability-matrix)

---

## 1. Method

Conventional breakdown slices by folder (`dashboard/`, `Dockerfile`, `agents/`). First-principles slices by **what must be true for the system to exist at all**, then derives components as mechanisms that make those truths hold.

Steps applied:
1. **Atoms:** 9 statements that remain true even if you delete every file and re-derive the system from physics of processes/files/network.
2. **Mechanisms:** For each atom, the minimal mechanism that enforces it → produces 9 components `C0–C9`.
3. **Per-component primitives:** For each `C`, answer: *What fundamental question does it solve? What state does it own? What are its inputs/outputs? What invariant must never break? What happens if it lies?* — those invariants become acceptance criteria.
4. **DAG:** Edges = "B cannot be proven correct without A being alive". This gives build order for tracer bullets.
5. **Tasks:** Leaf tasks are the *smallest falsifiable claim* — each has a single `verify` command that would fail if the claim is false.

> Rule: a task's `Depends` must be a strict subset of DAG ancestors. If you can implement it without the dependency running, the edge is wrong.

---

## 2. Irreducible Truths / Axioms

These hold regardless of implementation language. If any fails, Pi-Harness does no useful work.

| # | Truth | Why irreducible | Failure symptom |
|---|-------|-----------------|-----------------|
| **T1** | A process can outlive the terminal that started it and its output must be observable after detachment. | `pi` subagents are detached forked Pi sessions; fleet inspector reads `status.json`/`output-0.log` after parent closes. Without durable artifact dir, FleetView is fiction. | `docker logs pi-dashboard` shows stale `RUN` forever, `readFleetStatus()` `dashboard/server.js:25` reads empty dir. |
| **T2** | An agent's identity is a pure function of a Markdown file with YAML frontmatter (`name`, `tools`, `thinking`, `systemPromptMode`). | `pi` discovers agents via file precedence (`~/.pi/agent/agents/coder.md:.pi/agents/coder.md:1` → `dashboard/Dockerfile:91`). No DB. | `pi list` misses `coder`, `subagent({agent:"coder"})` falls back to `worker`. |
| **T3** | The LLM is accessed only through a proxy that clamps token limits per model. | AtlasCloud dots 512k advertised fails at >390k (`Dockerfile:37`). Without clamp, every request 400s. | `pi-freeflow` `proxy.ts:46` throws 400, session hangs. |
| **T4** | File system is the bus: sessions (`*.jsonl`), fleet runs (`status.json`, `events.jsonl`, `output-*.log`), and supervisor channels are just files watched by polling. | Dashboard SSE/poll `dashboard/server.js:203` and CLI `dashboard.sh:58` both tail files. No message queue exists. | Fleet drift: `/api/fleet` ≠ `/subagents-fleet`. |
| **T5** | A workflow is a deterministic script that calls `runs.run()` sequentially and branches on `tester` verdict. | `workflows/coder-tester-loop.js:6` encodes the loop; no external orchestrator. | Coder loops forever or tester PASS ignored. |
| **T6** | The dashboard is a stateless projection — it never writes `status.json` except for local shell mock fallback. | Backend `dashboard/server.js:358` writes mock only when fleet empty; real fleet is mounted volume `pi-subagents` `docker-compose.yml:39`. | Mock overwrites real `pi-subagents` run, corrupting fleet. |
| **T7** | A user needs exactly two interaction surfaces that show the *same* data: HTTP (`/api/fleet`) and TTY (`dashboard.sh`). | Spec `PLAN-fleet-sync.md:66` requires single source of truth. Two renderers, one reader. | Web shows RUN, CLI shows idle. |
| **T8** | Code reaches the container via volume mount immediately, but `Dockerfile`/`docker-entrypoint.sh` changes require rebuild. | `AUTO_UPDATE_README.md:3` — this dichotomy drives git-sync vs watchtower. | Infra change silently not live. |
| **T9** | Every external mutation (git push, Slack webhook, task file) is observed by tailing a log or polling a file with a sleep loop. | `task_watcher.sh:11`, `docker-entrypoint.sh:26` `tail_with_prefix`, `git-sync.sh`. No webhook listener. | Task silently dropped, heartbeat missing. |

---

## 3. Component Decomposition (First Principles)

Each component maps to 1–2 truths. For each: question, owned state, I/O, invariant, lie consequence, source files.

### C0 — Host & Container Substrate
*Truths: T1, T8, T9. Question: Where do processes live and how do they wake up?*

- **Owns:** Container image (`Dockerfile:1`), lifecycle supervisor (`docker-entrypoint.sh:1`), volume graph (`docker-compose.yml:35`), process leases.
- **Inputs:** `Dockerfile`, `.pi/agents/*`, `docker-entrypoint.sh`, env (`FREEFLOW_LOG_LEVEL`, `TAIL_SESSIONS`).
- **Outputs:** Running `pi-personal-agent` with mounted `/workspace`, `/root/.pi`, `/tmp/pi-subagents-uid-0` volume `pi-subagents`.
- **Invariant:** `docker-entrypoint.sh:11` traps SIGTERM and never exits while tails live; `/root/.pi/agent/pi-freeflow.log` is tail-piped to `stdout` so `docker logs` always shows live proxy traffic.
- **If it lies:** Image builds but `pi install npm:pi-freeflow` `Dockerfile:20` skips copying to `/opt/pi-freeflow` → `pi --help` fails inside container.
- **Failure modes:** Docker API 1.25 on watchtower (`docker-compose.yml:45`), CRLF in `.bashrc`, missing `safe.directory` for git-sync.

| File | Lines | Role |
|------|-------|------|
| `Dockerfile` | 1–141 | base ubuntu:24.04, node 22, pi, pi-freeflow dots clamp `37–86`, feynman `28–33`, baked `coder.md` `91` |
| `docker-entrypoint.sh` | 1–136 | tail_with_prefix `26`, git-sync `67`, heartbeat `119`, `wait` keepalive `130` |
| `docker-compose.yml` | 1–116 | volumes `35–39`, watchtower profile `60`, pi-subagents volume `115` |
| `docker-compose.override.yml` | — | local overrides |
| `.dockerignore` | — | build context filter |
| `Dashboard CLI Design/` | — | isolated Figma exploration, not shipped |

### C1 — Pi Runtime & Extensions
*Truths: T2, T3, T9. Question: How does a prompt become tokens?*

- **Owns:** `pi` binary (`@earendil-works/pi-coding-agent` `Dockerfile:16`), extension registry `~/.pi/agent/settings.json`, model catalog.
- **Inputs:** `.pi/config.json:1` `freeflow/dots-studio/dots-3-note-preview:free`, env `OPENACESS/LLM` not used (file wins).
- **Outputs:** Streaming chat, tool calls (`read`, `bash`, `default.subagent`), session `*.jsonl`, background runs under `/tmp/pi-subagents-uid-0/async-subagent-runs/<runId>/`.
- **Invariant:** Proxy `Dockerfile:37` clamp never exceeds `min(safeLimit, atlasCap=390k)`; `launchResolvedExtensions` vs `runtimeAcknowledgedExtensions` badge consistency.
- **If it lies:** Model reports 512k, pi requests 506k, proxy forwards 506k → Atlas 400. Or `pi-web-access` not installed → `web_search` tool missing for tester research.
- **Files:**

| Extension | Install | Provides |
|-----------|---------|----------|
| `pi-freeflow` | `Dockerfile:20` `pi install npm:pi-freeflow` | Kilo gateway proxy, debug log `pi-freeflow.log` |
| `pi-subagents` | `Dockerfile:28` | `default.subagent`, `default.bg_wait`, `FleetView`, `subagent-inspect-rpc` |
| `pi-web-access` | `Dockerfile:27` | `web_search`, `fetch_content` for coder |
| `feynman` | `Dockerfile:30` | standalone `/usr/local/bin/feynman` for lit review |

### C2 — Agent Definitions
*Truths: T2. Question: Who does the work and with what tools?*

- **Owns:** Agent markdown files — pure declarative contracts. Highest priority is `~/.pi/agent/agents/coder.md` (user) shadowing builtin `worker` alias.
- **Inputs:** Markdown + YAML frontmatter.
- **Outputs:** `pi list` + `subagent({action:"list"})` shows `coder` `tester` with `enabled:true`.
- **Invariant:** `coder.md:4` must include `default.subagent` + `inheritProjectContext:true` + `defaultContext:fork` or child inherits stale parent artifacts. `tester.md:34` must forbid `default.subagent` (leaf).
- **If it lies:** Coder cannot delegate review → serial bottleneck. Tester spawns subagents → recursion depth blowup `PI_SUBAGENT_MAX_DEPTH=2`.

| File | Lines | Key field |
|------|-------|-----------|
| `.pi/agents/coder.md` | 1–50 | `tools: read,write,edit,bash,grep,find,ls,web_search,fetch_content,default.subagent,…` `thinking: xhigh` `timeoutMs:600000` |
| `.pi/agents/tester.md` | 1–54 | `thinking: high` `inheritSkills:false` verdict `Test verdict: PASS/FAIL` `33–48` |
| Builtins | `~/.pi/agent/npm/node_modules/pi-subagents/agents/*.md` | `scout,researcher,worker,reviewer,oracle` lower priority |

### C3 — Workflow Orchestration
*Truths: T5. Question: In what order do agents act and when do we stop?*

- **Owns:** Deterministic control flow — no scheduler, just `await runs.run()` + string match on tester output.
- **Inputs:** `args.task` → passes to `coder-1` prompt.
- **Outputs:** `git commit`, tester verdicts, returned `{rounds, final, coderOutputs}`.
- **Invariant:** At most 3 tester rounds `workflows/coder-tester-loop.js:18`; each tester reads `git diff HEAD~1` `tester.md:31` not coder summary; `workflows/coder-tester-loop.js:41` returns single entrypoint promise.
- **If it lies:** `coder-tester-loop.md:29` decision gate bypassed → coder applies tester suggestion that changes scope without user approval.

| File | Lines | Role |
|------|-------|------|
| `workflows/coder-tester-loop.js` | 1–41 | JS workflowScript reusable via `subagent({workflowScriptPath})` |
| `.pi/prompts/coder-tester-loop.md` | 1–46 | Prompt version for `/prompt-workflow`, caps & gate rules `9–29` |

### C4 — Fleet Observability Contract (Source of Truth)
*Truths: T1, T4. Question: How do we *know* what is running without asking the LLM?*

- **Owns:** Filesystem artifacts — the **only** canonical state. Everything else is a projection.
- **Inputs:** Child Pi session forks.
- **Outputs:** `status.json`, `events.jsonl`, `output-0.log`, `process-terminal.json`, `completion-replay/*.json`, `subagent-artifacts/outputs/<runId>/`.
- **Invariant:** `status.json` fields documented `PLAN-fleet-observability-UI.md:18` are stable; `state ∈ {running,paused,complete,failed,stopped}` maps deterministically to `running/waiting/done/error` `dashboard/server.js:96`; stale `running` with `lastUpdate + 30s < now` → `failed` `dashboard/server.js:49` to avoid 616s drift.
- **Boundedness:** Host inspect RPC `PI_SUBAGENT_INSPECT_JSON` limited 64KB/200 msgs `PLAN-fleet-observability-UI.md:17` — dashboard must enforce same via `GET /api/fleet/:id?lines=200`.
- **If it lies:** Dashboard polls `output-0.log` raw `8`-line tail but fleet inspector uses bounded RPC → dashboard leaks beyond 64KB or misses `toolCount`.

**Artifact schema (canonical):**

```
<tmpdir>/pi-subagents-uid-0/async-subagent-runs/<runId>/
  status.json            lifecycleArtifactVersion, runId, sessionId, mode, state, startedAt, lastUpdate, endedAt, durationMs, cwd, asyncDir, sessionFile, outputFile, workflowGraph, steps[], results[], totalTokens{h,total,window,input,output}, totalCost, model, toolCount, turnCount, launchResolvedExtensions, runtimeAcknowledgedExtensions, children[]
  events.jsonl           subagent.run.started, step.started/completed/failed, steer.requested→delivered, run.completed/stopped
  output-0.log           live tail (8 lines default, 50 in modal, 200 bounded)
  process-terminal.json  observed | unknown
<tmpdir>/pi-subagents-uid-0/async-subagent-results/<runId>.json
<tmpdir>/pi-subagents-uid-0/supervisor-channels/<runId>.steer.json
/root/.pi/agent/sessions/--workspace--/*.jsonl   sessionFile (chat transcript)
```

### C5 — Dashboard Backend (`dashboard/server.js`)
*Truths: T4, T6, T7. Question: How does HTTP expose the bus?*

- **Owns:** Express server `3001`, fleet reconciler `readFleetStatus()` `server.js:25`, session parser `parseSessionFile()` `129`.
- **Inputs:** Env `SESSIONS_DIR`, `SUBAGENT_RUNS`, `ASYNC_RESULTS` `server.js:11`; filesystem reads; `spawn docker exec` for PI mode dispatch `338`.
- **Outputs:** REST: `GET /api/sessions`, `GET /api/fleet`, `GET /api/agents`, `GET /api/session/:id`, `GET /api/session-stats`, `GET /api/fleet/:id`, `POST /api/dispatch`, `POST /api/fleet/:id/steer`, `POST /api/fleet/:id/stop`, `POST /api/open-session`; serves `dist/` `491`.
- **Invariants:**
  - Never writes `status.json` except shell-mock path `358–372` with unique `runId = Date.now()+rand` and only when dispatch mode `shell`.
  - `GET /api/fleet` vs `GET /api/agents` share filter: `running|waiting` always, `error` 60s TTL, `done` 30s TTL `204–226` — visible drift would mean TTLs diverged.
  - `GET /api/session/:id` size guard `315` 5MB, last 500KB slice, `Content-Type: application/json`.
  - `POST /api/fleet/:id/steer` writes to `supervisor-channels/<runId>.steer.json` `468` with `mode ∈ {steer,follow_up,auto}`.
  - `POST /api/dispatch` PI mode `340` via `docker exec -d pi-personal-agent pi -p` detached `unref()` — never blocks event loop; shell mode `398` via `sh -c` loop into `output-0.log`.
- **If it lies:** Dispatch without `detached:true` blocks server 8s `410`; missing `error` handler on `spawn('pi')` `385` crashes with ENOENT (fixed in as-built but must stay guarded).
- **Scale bound:** `readdirSync` over `SESSIONS_DIR` 20 files `178`, fleet dirs unbounded — needs GC.

### C6 — Dashboard Frontend (`dashboard/src/App.tsx`)
*Truths: T7. Question: How does a human see the bus?*

- **Owns:** React 19 + Vite 8 + Tailwind 4 SPA served at `3001→3000` via `docker-compose.yml:68` `3000:3001`, proxied dev `5173→3001` `vite.config.ts:16`.
- **Inputs:** Polls `/api/sessions` + `/api/fleet` + `/api/session-stats` every 1s `App.tsx:547` `EventSource` upgrade pending.
- **Outputs:** `Topbar`, `Sidebar`, `AgentWindowCard`, `LogLineView`, `InputBar`, fleet modal with 5 tabs, help `?`.
- **Invariants:**
  - Null-is-loading guard `App.tsx:445` `conversations === null` skeleton prevents FALLBACK_CONVERSATIONS flash on refresh.
  - Fleet → AgentWindow mapping `504–522` normalizes `runId/fullId/id` and filters `activeOnly = running|waiting` double-filter (backend TTL + frontend strict active) — lest DONE stuck 4 windows bug returns.
  - Modal `modalWin` derived `572–576` from `windows.find` or `__session_<id>` session path; session transcript fetch `579–631` bounded 120 lines, abort 5s, 2 URL fallback.
  - Shortcuts `463–477` must not fire when `<input>` focused; `x` toggles `showToolDetails`.
- **If it lies:** `Topbar` counts `634` `running/waiting/done` from `windows` not fleet totals → counts drift from backend. Or `InputBar` optimistic `tempId` `715` not GC 3s → duplicate cards.

| Component | Lines | Key logic |
|-----------|-------|-----------|
| `Topbar` | 303–351 | `running/waiting/done` props, time tick 1s `458` |
| `Sidebar` | 180–301 | `conversations` filter chips, `fleetRunId/fleetState` correlation `195` |
| `AgentWindowCard` | 124–178 | border color `isActive`, tail 160px, blink `165` |
| `LogLineView` | 97–122 | kind→color map, prefix |
| `InputBar` | 353–437 | `mode shell\|pi` toggle `397`, agent chips `420` |
| Fleet modal | 731–841 | 5 tabs `749`, steer `818`, stop `827`, copy `829` |
| `parseSessionFile` backend | `server.js:129` | grep agent tag, time from filename |

### C7 — CLI Dashboard (`dashboard.sh` + `.pi/dashboard.sh`)
*Truths: T4, T7, T9. Question: How does TTY render the same bus without HTTP?*

- **Owns:** Bash TUI with `tput cols` `105`, 1s auto-refresh `251` `read -t 1`.
- **Inputs:** Direct `ls "$SUBAGENT_RUNS"/*/status.json` `62`, `grep -o` fleet parsing `64–68`, sessions `20`.
- **Outputs:** Split `1/4 | 3/4` draw `112–154`, session stats `99`, `open_session` `197` `pi --session`, `open_agent` `210` with `subagent status transcript` fallback `244`.
- **Invariant:** `get_running_agents()` `57` and `get_fleet_stats()` `81` must parse identical fields as `readFleetStatus()` — else single-source guarantee breaks. Colors `12–18` pure ANSI, `set -e` `5` but `read -t 1` timeout is expected non-error `252`.
- **If it lies:** `grep -o '"totalTokens"[[:space:]]*:[[:space:]]*[0-9]*'` `67` fails when `totalTokens` is object `{total,window}` → tokens empty, fallback `"-"` wrong. Bash `printf "%'d"` `100` fails on BusyBox without `'` flag.

### C8 — Support Scripts & Auto-Update
*Truths: T8, T9. Question: How do side effects stay observed?*

| Script | Lines | Purpose | Invariant |
|--------|-------|---------|-----------|
| `task_watcher.sh` | 1–41 | Poll `/workspace/task.txt` `5` `5s`, `pi -p`, Slack notify | `set -u`, `PIPESTATUS`, rm file only after exit code check `36` |
| `slack_webhook.sh` | 1–16 | `curl POST` with `SLACK_WEBHOOK_URL` | Exit 1 if no URL, `--data '{"text":"🤖 *Pi Agent Update:* ...` |
| `git-sync.sh` | — | Host poller alt to `auto-update.ps1` | Same fetch/rev-parse/pull as `docker-entrypoint.sh:76` |
| `auto-update.ps1` | — | Windows Scheduled Task host poller | Must not assume bash; pure git |
| `docker-entrypoint.sh:tail_with_prefix` | 26–41 | `stdbuf -oL tail -n 0 -F` with prefix | Survives rotation, loops on missing file |
| `docker-entrypoint.sh:git-sync` | 67–97 | In-container `ENABLE_GIT_SYNC=1` | Infra change logs `⚠️ rebuild needed` not auto rebuild |
| `workflows/coder-tester-loop.js` | 24 | Orchestration side effect via `git add && git commit` in coder prompt | Tester must use `git diff HEAD~1` fresh |

### C9 — CI/CD (`.github/workflows/docker-ci.yml`)
*Truths: T8, T9. Question: How does `git push` become a new container without human `ssh`?*

- **Owns:** Buildx `30`, GHCR `registry: ghcr.io` `12`, tags `latest`+`sha`+`branch` `37`, platforms `linux/amd64,linux/arm64` `51`, optional SSH deploy `59`.
- **Invariant:** `permissions: packages:write` `16` required; `cache-from/to: type=gha` `49` must persist; gate only `main|master` `5`.
- **If it lies:** Image pushes but `pi-dashboard` `docker-compose.yml:64` `build: ./dashboard` not tagged same repo → Watchtower never pulls it (separate image).

---

## 4. Dependency DAG (Build Order)

```
T8 T1                  T2          T3
C0 ─────────────────┐  C2          C1
│ host/container ───┼── agent defs ─┼── runtime/proxy ──┐
│ Dockerfile        │               │                     │
│ entrypoint        │  C3 workflow  │ C4 bus (fleet)     │
└───────────────────┼── prompts ────┼── status.json ─────┤
                    │               │  events, output    │
               C9 CI/CD             └─── C5 backend ─────┤
                                      server.js          │
                                          │              │
                                  ┌───────┴────────┐     │
                                  C6 frontend      C7 CLI dashboard.sh
                                  App.tsx 5173     │
                                      └──────┬─────┘
                                             │
                                        C8 support scripts
                                        task_watcher, slack, git-sync
```

**Tropic ordering (must build before):**

| Level | Components | Rationale |
|-------|------------|-----------|
| L0 | C0 `Host` | No process without container & volumes; all artifacts need `/tmp/pi-subagents-uid-0` mount |
| L1 | C1 `Runtime` + C2 `Agent defs` | `pi` must list agents before fleet exists; proxy clamp proven before any LLM call |
| L2 | C4 `Bus` | Fleet dir wakes only after subagent ran once; readFleetStatus meaningless before |
| L3 | C3 `Workflow` + C5 `Backend` | Workflow needs `runs.run()` from C1; backend needs C4 files to project |
| L4 | C6 `Frontend` + C7 `CLI` | Renderers consume backend & directly read C4 — either is valid first, but at least one needs C5 |
| L5 | C8 `Support` + C9 `CI/CD` | Watchers notify only after system alive; CI pushes image already built |

**Tracer bullet (thin vertical slice) path:**  
`L0 Dockerfile:16 pi install → C1 pi list → C2 coder.md baked 91 → C4 spawn subagent → C5 GET /api/fleet → C6 card appears within 3s` — each phase below includes this slice validation.

---

## 5. Phased Task Breakdown

> **Conventions:**  
> `ID` format `C<comp>-P<phase>-<n>` (e.g., `C5-P1-01`).  
> `Priority: P0=blocks tracer, P1=required for parity, P2=polish.`  
> `Size: XS <1h, S 1–3h, M 0.5–1d, L 1–2d.`  
> `Verify` is the single shell command that fails if task not done.  
> Every task lists `Files` and `Depends` (DAG ancestor IDs).

### Phase 0 — Foundations (L0+L1) — "Nothing works until this does"

#### C0-P0-01 Docker substrate builds deterministically
- **Files:** `Dockerfile:1`, `.dockerignore`, `docker-compose.yml:1`
- **Depends:** —
- **Size:** M **Priority:** P0
- **Do:** Pin `FROM ubuntu:24.04`, node `22.x`, `@earendil-works/pi-coding-agent` global; split Dockerfile into named stages `base` + `agents` to cache `pi install` layer; remove `rm -rf node_modules` race.
- **Accept:** `docker compose build pi_agent` deterministic (no `apt-get` non-pinned `curl` drift), `docker image history pi-personal-agent` shows cache hit on second build.
- **Verify:** `docker compose build --no-cache && docker compose up -d && docker exec pi-personal-agent pi --version && docker logs pi-personal-agent --tail 20 | grep entrypoint`

#### C0-P0-02 Volume graph & pi-subagents share is correct
- **Files:** `docker-compose.yml:35`, `Dockerfile:88` `mkdir -p /tools`, `dashboard/Dockerfile:10`
- **Depends:** C0-P0-01
- **Size:** S **Priority:** P0
- **Do:** Assert mounts: `E:/projects/pi-harness:/workspace`, `E:/projects/pi-harness/.pi:/root/.pi`, `pi-subagents:/tmp/pi-subagents-uid-0` into both `pi_agent` and `dashboard`; dashboard `SESSIONS_DIR`, `SUBAGENT_RUNS` `server.js:11` resolve inside container; `pi-subagents` volume survives `docker compose down` vs `down -v`.
- **Accept:** Host writes `echo hi > E:/projects/pi-harness/workspace/probe && docker exec pi-personal-agent cat /workspace/workspace/probe` succeeds; fleet run created by pi in `pi_agent` visible via `docker exec pi-dashboard ls /tmp/pi-subagents-uid-0/async-subagent-runs`.
- **Verify:** `touch workspace/probe.txt && docker exec pi-personal-agent ls /workspace/workspace/probe.txt && docker exec pi-dashboard ls /tmp/pi-subagents-uid-0 && rm workspace/probe.txt`

#### C0-P0-03 Entrypoint never dies and logs are debuggable
- **Files:** `docker-entrypoint.sh:1`
- **Depends:** C0-P0-01
- **Size:** S **Priority:** P0
- **Do:** Enforce `set -e`, `tail_with_prefix` `26` with `stdbuf -oL tail -n 0 -F` loop, `HEARTBEAT 300s` `119`, `TAIL_SESSIONS` opt-in `51`, `ENABLE_TASK_WATCHER` `57`, `ENABLE_GIT_SYNC` `67`, trap SIGTERM `111`, final `wait` `135`.
- **Accept:** `HEARTBEAT=1` emits every 300s to `docker logs`; kill `sleep 300` child does not exit container; `freeflow.log` rotation tail continues.
- **Verify:** `docker exec pi-personal-agent ps aux | grep tail && docker logs pi-personal-agent --tail 5 | grep heartbeat || echo "hearbeat not yet"`

#### C1-P0-04 Pi extensions load and report models correctly
- **Files:** `Dockerfile:20,27,28`, `.pi/config.json:1`
- **Depends:** C0-P0-01
- **Size:** S **Priority:** P0
- **Do:** `pi install npm:pi-freeflow` copy to `/opt/pi-freeflow` `22`, `pi install npm:pi-web-access`, `pi install npm:pi-subagents`, symlink `feynman` `30`; ensure `pi --list-models | head` `24` lists dots, `pi list` `29` lists npm extensions, `.pi/config.json` `llm.provider:freeflow` overrides env.
- **Accept:** Inside container `pi list | grep pi-subagents && pi list | grep pi-web-access && feynman --version` all pass.
- **Verify:** `docker exec pi-personal-agent pi list && docker exec pi-personal-agent pi --list-models | head -n 8 && docker exec pi-personal-agent feynman --version`

#### C1-P0-05 Proxy dots clamp prevents 400
- **Files:** `Dockerfile:37–86`
- **Depends:** C1-P0-04
- **Size:** S **Priority:** P0
- **Do:** Patch `/opt/pi-freeflow/src/proxy.ts:46` to `getModelDef`+ `Math.min(maxTokens, contextWindow-1000, 390k dots)` and `models.ts` `dots-studio/dots-3-note-preview:maxTokens 390k`; write idempotent `if 'AtlasCloud safe limit' not in` guard.
- **Accept:** Send `max_completion_tokens 506566` mock body, proxy clamps to `390000`; dots still 512k `contextWindow` unchanged `512_000` for billing.
- **Verify:** `docker exec pi-personal-agent grep -q "AtlasCloud safe limit" /opt/pi-freeflow/src/proxy.ts && docker exec pi-personal-agent grep -q "390_000" /opt/pi-freeflow/src/models.ts`

#### C2-P0-06 Agent markdowns survive bake and host-mount precedence
- **Files:** `.pi/agents/coder.md:1`, `.pi/agents/tester.md:1`, `Dockerfile:91`
- **Depends:** C0-P0-02, C1-P0-04
- **Size:** XS **Priority:** P0
- **Do:** Confirm `Dockerfile:91` copies `coder.md` to `/root/.pi/agent/agents/` and `/workspace/.pi/agents/` (build-time); runtime host mount `.pi:/root/.pi` shadows build copy — edits to `E:/projects/pi-harness/.pi/agents/coder.md:4` live without rebuild; tester `54` never needs rebuild copy.
- **Accept:** Change `coder.md:2` description timestamp, `docker exec pi-personal-agent cat /root/.pi/agent/agents/coder.md | grep description` reflects host edit within 1s (volume, not image).
- **Verify:** `echo "# test" >> .pi/agents/coder.md && docker exec pi-personal-agent grep -q "test" /root/.pi/agent/agents/coder.md && git checkout -- .pi/agents/coder.md`

#### C2-P0-07 Agentic contracts are machine-enforced
- **Files:** `.pi/agents/coder.md:4`, `.pi/agents/tester.md:31`
- **Depends:** C2-P0-06
- **Size:** S **Priority:** P0
- **Do:** Lint agents: `coder` must have `tools includes default.subagent`, `inheritProjectContext true`, `defaultContext fork`, `thinking xhigh`; `tester` must not have `default.subagent`, must include `Test verdict` template `37–48`; write `npm run lint:agents` (grep+ajv for frontmatter) as pre-commit.
- **Accept:** CI fails if `coder.md` missing `default.subagent`; passes when present.
- **Verify:** `node -e "const f=require('fs');const c=f.readFileSync('.pi/agents/coder.md','utf8');if(!c.includes('default.subagent'))throw 1;console.log('coder ok')"`

---

### Phase 1 — Bus & Reconciliation (L2) — "We can observe a run"

#### C4-P1-01 Fleet artifacts exist after a spawn
- **Files:** implicit `pi-subagents` runtime
- **Depends:** C1-P0-04, C2-P0-06
- **Size:** M **Priority:** P0
- **Do:** Define expected `status.json` schema (fields `PLAN-fleet-observability-UI.md:18`), run `pi -p "Use coder in background to sleep 10 && echo hello"` and assert artifacts: `async-subagent-runs/<runId>/status.json`, `events.jsonl`, `output-0.log`, `process-terminal.json`; clean up orphaned `running` older than 30s.
- **Accept:** Within 3s of dispatch, `ls /tmp/pi-subagents-uid-0/async-subagent-runs/*/status.json` has `state:running` with `startedAt`, `output-0.log` tail grows.
- **Verify:** `docker exec pi-personal-agent bash -c "pi -p 'Use coder in background to sleep 5 && echo hello' & sleep 3; ls /tmp/pi-subagents-uid-0/async-subagent-runs/*/status.json"`

#### C4-P1-02 Reconciler `readFleetStatus()` canonical rules
- **Files:** `dashboard/server.js:25`
- **Depends:** C4-P1-01
- **Size:** M **Priority:** P0
- **Do:** Implement & document: parse `status.json` → `state:server.js:39`, `agent/task` fallback chain `41`, `durationMs` calc `48`, stale 30s→failed `49`, `totalTokens` object vs number `60`, tail `output-*.log` 8 lines `74`, fallback `events.jsonl` 5 `85`, map to `dashboardStatus` `96`, sort `startedAt desc` `125`. Add Zod schema for `status.json`.
- **Accept:** Unit test fixtures: `pending+stale 35s→failed duration frozen`, `object totalTokens→number`, `concurrent 5 dirs sorted`, all pass 100%.
- **Verify:** `npm --prefix dashboard test -- readFleetStatus.test 2>&1`

#### C4-P1-03 Bus boundedness & safety limits
- **Files:** `dashboard/server.js:315` 5MB, `PLAN-fleet-observability-UI.md:17` 64KB, `dashboard/server.js:439` 50 lines
- **Depends:** C4-P1-02
- **Size:** S **Priority:** P1
- **Do:** Enforce `GET /api/fleet/:id?lines=200` bounds 64KB/200 msgs session-scoped `foreign_session/not_found/stale` returns; `GET /api/session/:id` `315` size guard 500KB slice; `events.jsonl` read capped 50 lines per request.
- **Accept:** Requesting `lines=200` on 500KB log returns ≤200 lines and `truncated:true` header; no `..` path traversal via `decodeURIComponent` `299`.
- **Verify:** `curl -s http://localhost:3001/api/fleet/<id>?lines=500 | jq .transcript.truncated`

#### C5-P1-04 Backend TTL filtering & aggregation
- **Files:** `dashboard/server.js:203`, `230`, `275`
- **Depends:** C4-P1-02
- **Size:** S **Priority:** P0
- **Do:** Unify TTLs: `GET /api/fleet` + `GET /api/agents` `212`→ `ACTIVE_TTL 60s error`, `DONE_TTL 30s done`, `GET /api/session-stats` `278` `totalTokens/toolCalls/tasksComplete/uptime` derived from `readFleetStatus()` not mocks; fix `window/spent` `totalTokens.window` vs `total` per `PLAN-fleet-observability-UI.md:100`.
- **Accept:** Fresh `complete` within 10s appears in `/api/fleet` but not in `/api/agents` if >60s old; `session-stats` matches fleet `totalTokens` sum within 1.
- **Verify:** `curl -s http://localhost:3001/api/fleet | jq .count && curl -s http://localhost:3001/api/session-stats | jq .fleetCount`

#### C5-P1-05 Dispatch modes: PI vs Shell
- **Files:** `dashboard/server.js:326`, `dashboard/src/App.tsx:397`
- **Depends:** C5-P1-04, C0-P0-02
- **Size:** M **Priority:** P0
- **Do:** `POST /api/dispatch` `326` two paths: PI `340 spawn('docker',['exec','-d','pi-personal-agent','pi','-p',prompt])` with `detached, ignore, unref, error` guard `342`; Shell `358–419` creates unique `runId 36+4`, writes `status.json`/`events.jsonl` `368`, spawns `pi -p` try `377` + `sh -c` fallback `398` both with `error` handlers; `setTimeout` 8s `410` marks complete; inputBar toggle `App.tsx:397`.
- **Accept:** PI dispatch returns `queued:true mode:pi` within 100ms not blocking; shell dispatch creates fleet file visible in 200ms; server does not crash on ENOENT for `pi` binary.
- **Verify:** `curl -s -X POST http://localhost:3001/api/dispatch -H 'Content-Type: application/json' -d '{"agent":"coder","task":"echo hi","mode":"shell"}' | jq .runId`

#### C5-P1-06 Control plane: steer/stop/detach
- **Files:** `dashboard/server.js:457`, `476`, `docker-compose.yml:39` supervisor-channels mount
- **Depends:** C4-P1-01, C5-P1-05
- **Size:** S **Priority:** P1
- **Do:** `POST /api/fleet/:id/steer` `457` writes `supervisor-channels/<runId>.steer.json` `468` `{runId,mode,message,ts,from:'dashboard'}`; `POST /api/fleet/:id/stop` `476` writes `stop.requested` `484`; validate `id` is basename not `../../`, `mode` enum, `message` non-empty 2000char cap; document `pi-subagents` picks up via `subagent_supervisor` event `subagent:control-intercom`.
- **Accept:** Steer file appears, `events.jsonl` later shows `steer.delivered`; stop file appears, state→`stopped` within 5s.
- **Verify:** `RUN=$(curl -s -X POST http://localhost:3001/api/dispatch -d '{"agent":"coder","task":"sleep 20","mode":"shell"}' | jq -r .runId); curl -s -X POST http://localhost:3001/api/fleet/$RUN/steer -d '{"message":"focus scope","mode":"follow_up"}' | jq .status`

---

### Phase 2 — Rendering Surfaces (L4) — "Humans can see the same truth two ways"

#### C6-P2-01 Frontend skeleton & dev proxy
- **Files:** `dashboard/vite.config.ts:1`, `dashboard/package.json:1`, `dashboard/index.html`, `dashboard/src/index.css:1`, `dashboard/src/main.tsx`
- **Depends:** C0-P0-02, C5-P1-04
- **Size:** S **Priority:** P0
- **Do:** `vite.config.ts:11` `host 0.0.0.0 5173 proxy /api→127.0.0.1:3001`, build `outDir dist` `preview 4173`, Tailwind `@theme` tokens `index.css:4`; `main.tsx` mounts `App.tsx`; verify `npm run dev` + `npm run build` + `npm run preview`.
- **Accept:** `npm --prefix dashboard run dev` serves on `4173` no `CORS`; `dist/assets` hashes match `dashboard/dist` already checked in.
- **Verify:** `npm --prefix dashboard run build 2>&1 | tail -n 5`

#### C6-P2-02 Topbar & polling contract
- **Files:** `dashboard/src/App.tsx:303`, `458`, `634`
- **Depends:** C5-P1-04, C6-P2-01
- **Size:** S **Priority:** P1
- **Do:** `Topbar` `303` props `running/waiting/done`, time `toLocaleTimeString en-GB` tick 1s `459`; `useEffect 481` fetches `/api/sessions` `/api/fleet` `/api/session-stats` parallel `Promise.all 483` every `setInterval 1000` `547`; derive `runningCount/waitingCount/doneCount` `634` from `windows`.
- **Accept:** Poll interval 1s ±50ms, no waterfall, cancel on unmount; `?all=true` opt-in visible in devtools but prod hides DONE >30s.
- **Verify:** `curl -s http://localhost:5173/api/fleet | head -n 2` (via proxy) or check Network tab poll 1s

#### C6-P2-03 Sidebar correlation (single-source proof)
- **Files:** `dashboard/src/App.tsx:180`, `dashboard/server.js:175`
- **Depends:** C5-P1-04, C6-P2-02
- **Size:** M **Priority:** P0
- **Do:** Backend `server.js:182` `fleetBySession Map sessionFile→runId`; frontend `Sidebar` `180` chips ALL/CODER/TESTER `212`, conv list from `conversations` `194`, filtered highlight `fleetRunId/fleetState` dot, `onSelect` `551` jumps to fleet child modal if `sessionFile` match else `__session_<id>` static; skeleton `loading && convsProp===null` `196` prevents FALLBACK flash.
- **Accept:** Left session with active child pulses green dot; clicking it opens same modal as middle card (same `runId`); generic session without fleet opens static transcript not `waiting for logs…`.
- **Verify:** `curl -s http://localhost:3001/api/sessions | jq '.[0].fleetRunId'`

#### C6-P2-04 Medium windows grid & active-only rule
- **Files:** `dashboard/src/App.tsx:124`, `37`, `504`
- **Depends:** C4-P1-02, C6-P2-02
- **Size:** M **Priority:** P0
- **Do:** `AgentWindowCard` `124` border `isActive` color, `AGENT_COLORS` map, `LogLineView` `97` `kind→color`, maxHeight 160, `StatusDot` pulse `running`, backend `server.js:230` TTL + frontend `App.tsx:520` `activeOnly running|waiting` double-filter; empty state `659` `No active agents — dispatch …` vs `Loading fleet…`.
- **Accept:** 4-window DONE bug cannot return; `waiting` (paused) shows amber; tokens `k` formatted `154`.
- **Verify:** `curl -s http://localhost:3001/api/fleet | jq '[.fleet[]|select(.status=="done")] | length' # should 0 without ?all`

#### C6-P2-05 InputBar dual dispatch + optimistic update
- **Files:** `dashboard/src/App.tsx:353`, `714`
- **Depends:** C5-P1-05, C6-P2-04
- **Size:** S **Priority:** P0
- **Do:** `InputBar` `353` `agent 5` state `RESEARCHER default`, mode toggle `SHELL|PI` `405`, `onDispatch` `714` optimistic `tempId tmp-${Date.now()}` prepend `status running`, `fetch /api/dispatch` then `setTimeout 3000` GC, error path sets `error` + inline `err` line `725`.
- **Accept:** Press Enter → card appears within 50ms (optimistic), replaced by fleet card within 1–3s polling; PI toggle color `#4da6ff` vs shell `#39ff6e`.
- **Verify:** manual: dispatch `echo test` shell → card appears instantly

#### C6-P2-06 Fleet modal — 5-tab inspector clone
- **Files:** `dashboard/src/App.tsx:731`, `748`, `757`, `773`, `793`, `805`
- **Depends:** C5-P1-06, C4-P1-03, C6-P2-05
- **Size:** L **Priority:** P1 (spec `PLAN-fleet-observability-UI.md:3.1` requires)
- **Do:** Click card `567`→`modalAgentId`, 5 tabs `log|transcript|events|artifacts|session` `749`, `Live Log` auto-scroll 1s poll `50 lines` `451`, `Transcript` 200 bounded, `Events` timeline `785`, `Artifacts` status.json/output/sessionFile `799`, `Session` runId/windowSpent `805`; controls: steer input+mode `818`, Send `s`, Stop `D` `827`, Copy pi-vCLI `H` `829`, show tools `x` `828`; session-transcript effect `579` fetch 120 lines abort 5s 2 URL fallback.
- **Accept:** All 5 tabs render without crash when fleet missing fields; `Esc` closes `471`, `?` toggles help `468`; log filter `showToolDetails` hides `kind=tool` `764`.
- **Verify:** `click first card → modal→Tabs cycle → Steer` see file `supervisor-channels`

#### C6-P2-07 Keyboard shortcuts & help
- **Files:** `dashboard/src/App.tsx:463`
- **Depends:** C6-P2-06
- **Size:** XS **Priority:** P2
- **Do:** Listener `463` guards `INPUT`, `f` open fleet `467`, `?` `468`, `Esc` close `469`, `x/Ctrl+O` `471`, `j/k` next/prev `472` `Enter/H` Herdr already copy.
- **Accept:** Typing `f` in input bar does not open modal; `?` modal lists same shortcuts plane.
- **Verify:** manual keyboard walkthrough

#### C7-P2-08 CLI parity — read same bus
- **Files:** `dashboard.sh:1` entire, `.pi/dashboard.sh` mirror
- **Depends:** C4-P1-02, C5-P1-04
- **Size:** M **Priority:** P1
- **Do:** Mirror backend parser: fix `get_running_agents` `57` to handle `totalTokens` object (extract `jq` if present fallback `grep -P`), unify `durationMs→s`, `state map` same `server.js:96`; `get_fleet_stats` `81` same TTL as backend; color `C_*` constants; `draw_dashboard` `103` cols `tput`, `max_lines 14`, `get_sessions` `20` `head -20`, `open_agent` `210` with `stop/steer/transcript` menu mirroring web `s/D/t` `PLAN-fleet-observability-UI.md:74`.
- **Accept:** `dashboard.sh` vs `curl /api/fleet` show identical `run/wait/done` counts ±1 (race); `s` steer writes same `supervisor-channels` file; `q` drops to bash.
- **Verify:** `bash -n dashboard.sh && shellcheck dashboard.sh; docker exec pi-personal-agent bash /tools/dashboard.sh` (smoke)

---

### Phase 3 — Workflow & Lifecycle (L2/L3) — "Agents loop correctly"

#### C3-P3-01 Coder-tester JS workflow correctness
- **Files:** `workflows/coder-tester-loop.js:1`
- **Depends:** C1-P0-04, C2-P0-07
- **Size:** M **Priority:** P0
- **Do:** Ensure `runs.run("coder-1", {agent:"coder", task})` `7` commit semantics, `tester-1` reads `coder1.output` `13` and `git diff HEAD~1`, branch on `includes("Test verdict: FAIL")` `18`, max 3 rounds `28`, returns `{rounds, final}` `37`; add `try/catch` for spawn failure; document invocation `subagent({workflowScriptPath:"workflows/..."})`.
- **Accept:** Invoked via `pi -p` with workflowScript `async:true` launches coder-1 visible in fleet within 2s; FAIL loops once more.
- **Verify:** `node -c workflows/coder-tester-loop.js && grep -q "Test verdict: FAIL" workflows/coder-tester-loop.js`

#### C3-P3-02 Prompt workflow mirrors JS workflow
- **Files:** `.pi/prompts/coder-tester-loop.md:1`
- **Depends:** C3-P3-01
- **Size:** XS **Priority:** P1
- **Do:** Align prompt `9–29` cap=3 rounds, synthesizer rules `24` do-not-blindly-apply, stop conditions `36–41` identical to JS; `Additional task $@` placeholder `43` interpolated.
- **Accept:** Running `/prompt-workflow coder-tester-loop your task` produces same sequence as JS script.
- **Verify:** `grep -q "max.*3" .pi/prompts/coder-tester-loop.md && grep -q "Test verdict: PASS" .pi/prompts/coder-tester-loop.md`

#### C5-P3-03 Fleet streaming upgrade (SSE)
- **Files:** `dashboard/server.js` new `GET /api/fleet/stream`, `dashboard/src/App.tsx:481` EventSource branch
- **Depends:** C5-P1-04, C6-P2-02
- **Size:** M **Priority:** P2 `PLAN-fleet-observability-UI.md:3.3 push (next)`
- **Do:** SSE endpoint watches `status.json` mtime via `fs.watch` and emits `data: {type:"subagent:async-started|async-complete|child-status", runId}`; frontend `EventSource` replaces 1s poll for sub-100ms; fallback to poll if SSE errors.
- **Accept:** With SSE, card appears <200ms vs 1s; network tab shows `text/event-stream`; disconnect falls back.
- **Verify:** `curl -N http://localhost:3001/api/fleet/stream | head -n 10`

#### C3-P3-04 Workflow artifacts lifecycle
- **Files:** `workflows/coder-tester-loop.js` commit lines, `.pi/agents/coder.md:8` commit rule, `.pi/agents/tester.md:31` read diff
- **Depends:** C3-P3-01
- **Size:** S **Priority:** P1
- **Do:** Coder prompt includes `git add + git commit with detailed comments` vs `git diff` check; tester runs `git diff HEAD~1 + npm test + typecheck` `tester.md:31`; document `{sessionDir}/subagent-artifacts/outputs/<runId>/output.md`.
- **Accept:** After coder-1, `git log --oneline -1` shows commit; tester FAIL cites `file:line` from diff.
- **Verify:** manual run workflowScript + `git log --oneline -2`

---

### Phase 4 — Hardening & Observability (L5) — "We know when we are lying"

#### C4-P4-01 Extended fleet fields (window/spent/cost/children)
- **Files:** `dashboard/server.js:58` `totalTokens`, `PLAN-fleet-observability-UI.md:3.4`
- **Depends:** C4-P1-02
- **Size:** S **Priority:** P1
- **Do:** Expose full `status.json` fields: `lifecycleArtifactVersion, sessionId, mode, endedAt, totalCost, modelAttempts, launchResolvedExtensions, runtimeAcknowledgedExtensions, children[] indented`, surface on card `workflowGraph flow` `PLAN-fleet-observability-UI.md:55`, ack badges, totalCost in stats.
- **Accept:** Card header shows `launchResolvedExtensions` ack badge `✓ pi-web-access`; children nested indented.
- **Verify:** `curl -s http://localhost:3001/api/fleet?all=true | jq '.fleet[0].toolCount'`

#### C0-P4-02 Healthcheck & stale-GC
- **Files:** `docker-compose.yml:1`, `dashboard/server.js:38` stale logic improvements
- **Depends:** C0-P0-03, C4-P1-01
- **Size:** S **Priority:** P1
- **Do:** Add `healthcheck: test: ["CMD", "pi", "--version"] interval 30s` for `pi_agent`; dashboard GC cron `fs.unlink` for `failed` >10min; stale 30s already; log GC.
- **Accept:** `docker inspect --format '{{.State.Health.Status}}' pi-personal-agent` → healthy; stale fleet dir removed after 10min not leaking disk.
- **Verify:** `docker exec pi-personal-agent test -f /root/.pi/agent/pi-freeflow.log && echo healthy`

#### C8-P4-03 Task watcher + Slack reliability
- **Files:** `task_watcher.sh:1`, `slack_webhook.sh:1`, `docker-entrypoint.sh:57`
- **Depends:** C0-P0-03
- **Size:** S **Priority:** P1
- **Do:** Validate `task_watcher` `set -u` `11`, `PIPESTATUS` `21`, no busy loop on empty file `33`, Slack webhook retries 3 with `curl --retry 3`, sanitizes `$TASK` head 500 `15`.
- **Accept:** Drop `echo "sleep 1" > /workspace/task.txt` → `pi -p` exit logged, Slack message if `SLACK_WEBHOOK_URL` set, file removed `36` even on failure.
- **Verify:** `bash -n task_watcher.sh && bash -n slack_webhook.sh && echo ok`

#### C8-P4-04 Git-sync idempotence
- **Files:** `git-sync.sh`, `auto-update.ps1`, `docker-entrypoint.sh:67`
- **Depends:** C0-P0-01, C9 (CI may trigger it)
- **Size:** S **Priority:** P1
- **Do:** All 3 paths share identical logic: `git fetch --quiet`, `rev-parse HEAD vs @{u}`, `pull --ff-only`, `git diff --name-only HEAD@{1} HEAD | grep -qiE Dockerfile|docker-compose|docker-entrypoint` → rebuild marker; `safe.directory` `71`; `sleep 15`; ensure `set -e` not masking fetch failure.
- **Accept:** Local `git commit --allow-empty -m "probe"` + `git push` → inside container/host watcher detects within 30s.
- **Verify:** `git log --oneline -3 && grep -q "git fetch" auto-update.ps1 && grep -q "docker compose up" git-sync.sh`

#### C9-P4-05 CI build provenance & watchtower
- **Files:** `.github/workflows/docker-ci.yml:1`, `docker-compose.yml:46`
- **Depends:** C0-P0-01, C8-P4-04
- **Size:** S **Priority:** P2
- **Do:** Confirm buildx cache `49`, GHCR tags `38`, platforms `51`, SSH deploy `59` `vars.DEPLOY_HOST` guard `61`; dashboard image separate tag docs; watchtower `--label-enable` `47` only watches `com.centurylinklabs.watchtower.enable=true` `7`.
- **Accept:** Push to `main` triggers `build-and-push` → `ghcr.io/<owner>/pi-harness:latest` + `main-<sha>`; watchtower logs `Found new image` within 30s if enabled.
- **Verify:** `gh workflow view "CI/CD - Build & Push + Auto Deploy" 2>/dev/null || echo "check .github/workflows/docker-ci.yml"`

---

### Phase 5 — Tests & Gates (exhaustive; see `TEST_COVERAGE_PLAN.md` for case-level detail)

#### C0-P5-01 Infrastructure tests
- **Files:** `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`
- **Depends:** C0-P0-01
- **Size:** M **Priority:** P1
- **Do:** See TEST_COVERAGE_PLAN `TC-C0` suite: build determinism, volume mount matrix, entrypoint trap, dots clamp idempotence.
- **Verify:** `npm run test:infra` or `bash tests/infra/test_build.sh`

#### C5-P5-02 Backend unit + contract tests
- **Files:** `dashboard/server.js:25`
- **Depends:** C4-P1-02, C5-P1-04
- **Size:** L **Priority:** P0
- **Do:** `TEST_COVERAGE_PLAN TC-C5` 24 unit cases (stale, object tokens, TTL, bounds) + 10 integration (curl vs filesystem).
- **Verify:** `npm --prefix dashboard test -- --coverage --coverage.thresholds` (see TEST_COVERAGE_PLAN `thresholds`)

#### C6-P5-03 Frontend component tests
- **Files:** `dashboard/src/App.tsx:124`
- **Depends:** C6-P2-01
- **Size:** M **Priority:** P1
- **Do:** `TEST_COVERAGE_PLAN TC-C6` React Testing Library: Card border, Topbar counts, Sidebar filter, InputBar mode, modal tabs, skeleton guard.
- **Verify:** `npm --prefix dashboard test -- App.test.tsx`

#### C7-P5-04 CLI snapshot tests
- **Files:** `dashboard.sh:1`
- **Depends:** C7-P2-08
- **Size:** S **Priority:** P1
- **Do:** `TEST_COVERAGE_PLAN TC-C7` `shellcheck` + `bats` snapshot of `draw_dashboard` cols 80/120, parse object totalTokens.
- **Verify:** `shellcheck dashboard.sh && bats tests/cli/cli.test.bats`

#### E2E-P5-05 Playwright fleet vertical slice
- **Files:** `test_ui_playwright.js:1` evolved
- **Depends:** C6-P2-06, C5-P1-05
- **Size:** M **Priority:** P0
- **Do:** `TEST_COVERAGE_PLAN TE2E` `chromium.launch` `test_ui_playwright.js:4` — dispatch shell, assert card <3s, click → modal 5 tabs, steer, session transcript 500KB guard, snapshot.
- **Verify:** `node test_ui_playwright.js` or `npx playwright test`

#### C3-P5-06 Workflow simulation tests
- **Files:** `workflows/coder-tester-loop.js:18`, `.pi/prompts/coder-tester-loop.md:9`
- **Depends:** C3-P3-01
- **Size:** M **Priority:** P1
- **Do:** `TEST_COVERAGE_PLAN TC-C3` `runs` mock, verifier `Test verdict: PASS/FAIL` branching 3 rounds.
- **Verify:** `node tests/workflows/coder_tester_loop.test.js`

---

## 6. Task Index

Filter by priority to plan sprint.

| Priority | IDs |
|----------|-----|
| **P0 tracer blockers** | `C0-P0-01`, `C0-P0-02`, `C0-P0-03`, `C1-P0-04`, `C1-P0-05`, `C2-P0-06`, `C2-P0-07`, `C4-P1-01`, `C4-P1-02`, `C5-P1-04`, `C5-P1-05`, `C6-P2-01`, `C6-P2-03`, `C6-P2-04`, `C3-P3-01`, `C5-P5-02`, `E2E-P5-05` |
| P1 required for parity | `C4-P1-03`, `C5-P1-06`, `C6-P2-02`, `C6-P2-06`, `C7-P2-08`, `C3-P3-02`, `C3-P3-04`, `C4-P4-01`, `C0-P4-02`, `C8-P4-03`, `C8-P4-04`, `C0-P5-01`, `C6-P5-03`, `C7-P5-04`, `C3-P5-06` |
| P2 polish/upgrades | `C6-P2-07`, `C5-P3-03`, `C9-P4-05` |

**Estimated effort (no parallel):** P0 `~5d`, P1 `~6d`, P2 `~2d`. With 2 lanes (backend/frontend) `~7d`.

---

## 7. Execution Playbook

```bash
# lane A — substrate + bus (blocks all)
phase0:  C0-P0-01 → C0-P0-02 → C0-P0-03 → C1-P0-04 → C1-P0-05 → C2-P0-06 → C2-P0-07
phase1a: C4-P1-01 → C4-P1-02 → C4-P1-03
phase1b: C5-P1-04 → C5-P1-05 → C5-P1-06
# lane B — surfaces (can start after phase1a)
C6-P2-01 → C6-P2-02 → C6-P2-03 → C6-P2-04 → C6-P2-05 → C6-P2-06 → C6-P2-07
C7-P2-08 (parallel with C6-P2-04)
# convergence
C3-P3-01 → C3-P3-02 → C3-P3-04
C5-P3-03 (optional SSE)
phase4:  C4-P4-01 → C0-P4-02 → C8-P4-03 → C8-P4-04 → C9-P4-05
phase5:  C0-P5-01 → C5-P5-02 → C6-P5-03 → C7-P5-04 → C3-P5-06 → E2E-P5-05 (gate)
```

Each task PR must include `Verify` output pasted in description.

---

## 8. Traceability Matrix

| Plan spec | Tasks that satisfy it | Proof artifact |
|-----------|----------------------|----------------|
| `PLAN-fleet-sync.md` 3. Desired Sync Design | `C5-P1-04`, `C6-P2-03`, `C7-P2-08` | `curl /api/fleet` == `subagent status fleet` |
| `PLAN-fleet-sync.md` 5. Acceptance Criteria | `E2E-P5-05`, `C6-P2-03` | click window → `pi --session <sessionFile>` |
| `PLAN-fleet-observability-UI.md:1` observability table | `C4-P1-01`, `C4-P4-01` | exposes `workflowGraph, children, cost, process-terminal` |
| `PLAN-fleet-observability-UI.md:3.1` Layout | `C6-P2-04 x-P2-06` | Topbar window/spent, left highlight, modal 5 tabs |
| `PLAN-fleet-observability-UI.md:3.2` Shortcuts mapping | `C6-P2-07` + `C6-P2-06` | `f/j/k/x/D/H/Enter/Esc/?` |
| `PLAN-fleet-observability-UI.md:3.3` Events | `C5-P3-03` SSE or `C6-P2-06` events tab | `events.jsonl` timeline |
| `PLAN-fleet-observability-UI.md:6` Acceptance | `E2E-P5-05` | `GET /api/fleet` matches fleet, steer→delivered, Stop→stopped |

---

*Next: `TEST_COVERAGE_PLAN.md` expands every component's unit/integration/E2E cases derived from `Invariant & If it lies` above. This file is the `what to build`; that file is `how to prove it`.*
