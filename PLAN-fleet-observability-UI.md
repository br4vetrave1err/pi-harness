# Plan: Precision Fleet Control UI — Full Observability Stack

**Date:** 2026-09-04  
**Source:** `https://github.com/nicobailon/pi-subagents/blob/main/docs/observability.md` (v0.64.0)  
**Goal:** Replace static medium windows + session stats with a **live, precise Fleet Inspector clone** in the web dashboard (http://localhost:3000) and CLI `dashboard.sh`, where every shortcut, event, status field, and artifact from the observability stack is interactive.

---

## 1. What the observability stack gives us (current as-built)

| Layer | File / API | What it contains | How FleetView uses it |
|-------|------------|------------------|------------------------|
| **Foreground runs** | In-memory Pi session (not separate process) | Streams compact task + current tool + recent output + tokens/cost/duration + activity freshness. `workflow label` > task. Timeout 30m. | Live cards in chat (`Ctrl+O` expand). |
| **Background runs** | `/tmp/pi-subagents-uid-0/async-subagent-runs/<runId>/` | `status.json` (widget source), `events.jsonl` (wrapper + child Pi JSON + steer events), `output-0.log` (live tail), `subagent-log-<id>.md` | `subagent({action:"status"})`, async widget `● worker 2.0s` |
| **FleetView** | TUI widget below editor | Compact `2 active agents · 1 pane · ↓ 3.1k window · 4.2k spent` → expanded `> main scout running 1m12s ↓2.0k window 2.8k spent`. Counts `active current-session work + Herdr panes`. | Our left 1/4 / middle 3/4 must match these counts. |
| **Fleet inspector** | `/subagents-fleet` + `Ctrl+Alt+F` | Select `↑↓/jk`, scroll `Shift+K/J`, `PgUp/Dn`, `x/Ctrl+O` toggle tool details, `r` refresh, `Esc` close, `Enter`→Herdr, `s`→steer (`steer/follow_up/auto` via Tab), `D`→stop, `H`→Herdr pane | **Web modal must replicate these as buttons/shortcuts.** |
| **Host inspection RPC** | `/subagents-inspect-rpc <reqId> <asyncId> [childId] --lines N` → `PI_SUBAGENT_INSPECT_JSON:<JSON>` | Read-only, bounded (64KB, 200 messages), session-scoped (`foreign_session/not_found/stale`), no fs paths. Returns `task` (first user msg if fresh) + `childId`. | Our `/api/fleet/:id` should proxy this instead of raw `output-0.log` for safety. |
| **Status.json fields** | `lifecycleArtifactVersion, runId/id, sessionId, mode(foreground/background), state(running|paused|complete|failed|stopped), startedAt, lastUpdate, endedAt, durationMs, cwd, asyncDir, sessionFile, outputFile, workflowGraph, steps[], results[], totalTokens, totalCost, model/attemptedModels/modelAttempts, toolCount, turnCount, launchResolvedExtensions, runtimeAcknowledgedExtensions, children[]` | Powers widget + `status` output. `launchResolvedExtensions` is parent intent, `runtimeAcknowledgedExtensions` is child ack (`subagent:acknowledge-extension` bus, 32 ids max). |
| **Lifecycle events** | `events.jsonl`: `subagent.run.started, subagent.step.started, subagent.step.completed/failed/paused/stopped, subagent.steer.requested/scheduled/routed/queued/delivered/failed/recovered, subagent.run.completed/stopped` | Fleet inspector's timeline; we should show as event feed. |
| **Process-terminal proof** | `process-terminal.json` (`observed` only after parent observes runner `close` + lease free, else `unknown`) + `process-terminal-candidate.json`, event `subagent:process-terminal`, `ping.capabilities.processTerminalProof` | Show `● running` vs `○ unknown` vs `✓ observed` in UI. |
| **Output archives** | `<resultsDir>/output-archives/<runId>.json` (64KB per child) + `completion-replay/<runId>.json` (dedupe window) | `bg_wait` reads replay; our UI should read archive for completed runs' full logs. |
| **Workflow artifacts** | `<tmpdir>/chain-runs/{runId}/` (`context.md, plan.md, progress.md`) + `{sessionDir}/subagent-artifacts/outputs/{runId}/` | Session stats `tasksComplete` should count `results[]`. |
| **Events (async)** | `subagent:async-started` (`task` 50ch, `goal` 120ch), `subagent:async-complete` (quiet-grouped if success within window), `subagent:control-intercom`, `subagent:child-status` (`stopping/stopped`, observer hint only) | Use to trigger UI toast + update fleet without polling, or at least poll and show toast. |
| **Shortcuts** | `Ctrl+O` expand, `Ctrl+Alt+F` fleet, `↑↓/jk` select, `Shift+K/J` line, `PgUp/Dn` page, `x/Ctrl+O` tool details, `r` refresh, `Esc` close, `Enter` Herdr, `s` steer (Tab cycles mode), `D` stop, `H` Herdr pane, `foregroundDetachShortcut: ctrl+b` | **Map to web:** `o`/`f` keys, clickable buttons, or `?` help modal. |

---

## 2. Current dashboard gaps

| Area | Current | Gap vs observability |
|------|---------|----------------------|
| **Active agents grid** | Polls `/api/fleet` every 1s, shows `id, agent, task, status, tokens, elapsed, lines (8)` | No `workflowGraph` chain flow (`done scout → running worker`), no `children[]` nested, no `toolCount/turnCount`, no `process-terminal` proof, no `launchResolvedExtensions` ack badge |
| **Modal (click window)** | Shows `pi --session` cmd + live 8-line tail + `Send/D` buttons (writes `supervisor-channels/*.steer.json` stub) | Not using `subagent-inspect-rpc` bounded reply, no `s` Tab cycling, no `x` tool details toggle, no `H` Herdr, no `events.jsonl` timeline |
| **Session stats** | `totalTokens/toolCalls/tasks/uptime` from `fleet.reduce` | Missing `window` vs `spent` (input+cache-read vs total), `totalCost`, `modelAttempts`, `turnCount` |
| **Left 1/4** | `GET /api/sessions` (20 files, tag from `grep coder`) | Not correlated to fleet `sessionFile` → `runId` for live highlight, no `fleetState` badge |
| **CLI `dashboard.sh`** | `get_running_agents` greps `status.json` + `pi list`, `get_fleet_stats` sums, `read -t 1` auto-refresh | No `events.jsonl` tail, no `status` view `transcript` with `index`, no `bg_wait` projection |

---

## 3. Target UI — Precision Fleet Control (web + CLI)

### 3.1 Layout (keep Figma 1/4 + 3/4, add observability chrome)

```
Topbar: MULTIAGENT v0.9.1 │ 2 run 1 wait 1 done │ 3.1k window 4.2k spent │ cpu 12% mem 1.4gb 07:01:33 ▋
        (from fleet: running/waiting/done counts + totalTokens window/spent)

Left 1/4 (conversations): ~/sessions  [ALL][CODER][TESTER]... (filter)
  1 [CODER] refactor auth 09:41 34 msgs ● running (fleetRunId=abc)  ← highlight if fleetState=running
  2 [TESTER] write tests 11:03 21 msgs ○ done
  Footer: sessions 20 filtered 7 | fleet 2 active (from /api/fleet)

Middle 3/4: active agents — medium windows (2-col grid)
  Each card:
    Header: [CODER] implement rate-limiter │ claude-sonnet-5 │ 8.3k tok │ 23s │ ● RUN (pulse) + process-terminal: observed/unknown + ack badges
    Body: live tail 8 lines (output-0.log) + expand → full transcript (200 lines, from /api/fleet/:id?lines=200)
    Footer: workflowGraph: done scout → running worker (if chain) + children[] nested indented
    On click → live modal (not docker cmd popup)

Bottom: session stats (live from fleet): total tokens (window/spent), tool calls, turnCount, tasks 1/4, uptime, totalCost

Modal (click window) — full Fleet Inspector clone:
  Header: [AGENT] task │ model │ tokens window/spent │ elapsed │ StatusDot │ process-terminal
  Tabs: [Live Log] [Transcript] [Events] [Artifacts] [Session]
  Live Log: output-0.log tail 50 lines, auto-scroll, live 1s poll, `x` toggle tool details, `Shift+K/J` line, `PgUp/Dn` page
  Events: events.jsonl timeline (run.started, step.completed, steer.requested→delivered)
  Artifacts: links to subagent-artifacts/outputs/<runId>/output.md, plan.md, progress.md (if workflow)
  Controls (like fleet inspector s/D/H):
    [steer input] [mode: follow_up ▼] [Send s]  (Tab cycles)
    [Stop D] [Detach] [Transcript] [Herdr H] [Copy pi-vCLI]
  Footer: fleetState, toolCount, modelAttempts, ack ids

CLI dashboard.sh: same, but with keys:
  ↑↓/jk select card, Enter → pi --session <sessionFile> (Herdr), s → steer prompt, D → stop, x → toggle details, r → refresh, q → bash
```

### 3.2 Shortcuts mapping (web)

| Fleet inspector | Web dashboard |
|-----------------|---------------|
| `↑↓/jk` select | Arrow keys + click on card |
| `Shift+K/J` line | Buttons `↑` `↓` + `j`/`k` keys |
| `PgUp/Dn` page | `PageUp/Down` + buttons |
| `x/Ctrl+O` tool details | Toggle switch `Show tool calls` |
| `r` refresh | Auto 1s poll + manual `↻` button |
| `s` steer (Tab cycle) | Input + `mode` select + `Send` button (`Enter` sends, `Tab` cycles like fleet) |
| `D` stop | `Stop` button (confirm) → `POST /api/fleet/:id/stop` |
| `H` Herdr | `Open in pi-vCLI` button → `pi --session` |
| `Ctrl+Alt+F` fleet | `f` key opens fleet modal, `Esc` closes |
| `Ctrl+O` expand | `Expand` button on card |

Add `?` help modal listing all shortcuts.

### 3.3 Events to subscribe

- **Polling (MVP):** `GET /api/fleet` every 1s (already), `GET /api/fleet/:id?lines=200` for modal transcript.
- **Push (next):** `GET /api/fleet/stream` as SSE: server watches `status.json` + `events.jsonl` via `fs.watch`, emits `subagent:async-started`, `subagent:async-complete`, `subagent:child-status` (hint), `subagent:control-intercom` as `data:` lines. Frontend `EventSource` updates fleet without poll.

### 3.4 Status fields to surface

- **Card header:** `agent, task (label > task), model, tokens (window/spent), elapsed (durationMs), StatusDot (state), process-terminal (observed/unknown)` + `launchResolvedExtensions`/`runtimeAcknowledgedExtensions` badges (e.g., `✓ pi-web-access`).
- **Card body:** `output-0.log` tail + `workflowGraph` flow line + `children[]` nested (indented, with `▣`).
- **Stats row:** `totalTokens window/spent`, `toolCount`, `turnCount`, `tasksComplete`, `uptime`, `totalCost`.
- **Left sidebar:** `fleetRunId` highlight + `fleetState` dot on conversation row if that session has an active fleet child.

---

## 4. Implementation Steps

### Phase 1 — Backend: expose fleet primitives (no UI yet)

1. **Refactor `dashboard/server.js`:**
   - Enhance `readFleetStatus()` to return full `status.json` fields: `lifecycleArtifactVersion, runId, sessionId, mode, state, startedAt, lastUpdate, endedAt, durationMs, cwd, asyncDir, sessionFile, outputFile, workflowGraph, steps, results, totalTokens{input,output,window,total}, totalCost, toolCount, turnCount, launchResolvedExtensions, runtimeAcknowledgedExtensions, children`.
   - Keep `totalTokens` as object (already fixed for `muse-spark`), expose both `window` and `total`.
   - Add `GET /api/fleet/:id?lines=200` that calls the equivalent of `subagent({action:"status", id, view:"transcript", lines})` — reads `status.json` + `output-*.log` + `events.jsonl` bounded to 64KB/200 lines, returns `{...status, transcript: {lines, truncated}, events: [...], artifacts: [...]}`.
   - Add `GET /api/fleet/:id/events?limit=50` for timeline.
   - Keep `/api/session-stats` but derive from fleet `window/spent` correctly.

2. **Add control endpoints (already stubbed):**
   - `POST /api/fleet/:id/steer {message, mode}` → write `supervisor-channels/<runId>.steer.json` and also try `pi` RPC `subagent_supervisor send` if available. Return `PI_SUBAGENT_INSPECT`-style receipt `{status: queued/delivered/failed, mode}`.
   - `POST /api/fleet/:id/stop {childId?}` → `subagent({action:"stop", id})` or `stop.requested` file. Return `stopping/stopped`.
   - `POST /api/fleet/:id/detach` → `subagent({action:"detach"})`.

### Phase 2 — Frontend: wire observability chrome

3. **Update `dashboard/src/App.tsx`:**
   - Replace `windows` type to include full fleet fields.
   - `Topbar` now shows `window` vs `spent` (from `totalTokens.window` vs `total`).
   - `AgentWindowCard`: add `workflowGraph` flow line, `children` nested, `process-terminal` badge, `ack` badges, `toolCount` footer. Keep click → live modal.
   - **Live modal:** replace static `docker` popup with tabbed Fleet Inspector clone:
     - Tabs: Live Log (auto-scroll, 1s poll of `GET /api/fleet/:id?lines=200`), Transcript, Events (timeline from `events.jsonl`), Artifacts (links to `subagent-artifacts/outputs`), Session (raw `sessionFile` snippet).
     - Controls: `steer` input + `mode` select (Tab cycle), `Send s`, `Stop D` (confirm), `Detach`, `Copy pi-vCLI` (`pi --session <sessionFile>`).
     - Shortcuts: `x` toggle tool calls, `j/k` line, `PgUp/Dn` page, `Esc` close, `f` open fleet, `?` help.
   - Keep `InputBar` dispatch as is (already creates fleet entry).

4. **Update `dashboard.sh`:**
   - `get_running_agents` already fleet-synced; extend to print `workflowGraph` flow and `children` indented.
   - `draw_dashboard` bottom stats now from `GET /api/session-stats` or local `get_fleet_stats` with `window/spent`.
   - `open_agent` now offers `s` steer, `D` stop, `t` transcript (`subagent status transcript`), mirroring fleet inspector keys.

### Phase 3 — Push + polish

5. **Add SSE (optional but recommended for precision):**
   - `GET /api/fleet/stream` SSE that watches `status.json` mtime and emits `data: {"type":"subagent:async-started", runId, task}` etc., using `fs.watch`. Frontend `EventSource` replaces 1s poll for sub-100ms latency.

6. **Validate:**
   - `curl http://localhost:3001/api/fleet` vs `pi -p "subagent({action:\"status\",view:\"fleet\"})" --mode json` → runIds/states match.
   - Spawn `Use coder in background to sleep 10` → middle windows shows `running` + live log tail updating each second, modal `Live Log` scrolls, `Steer` sends and appears in `events.jsonl` as `steer.delivered`.
   - Click `Stop` → `status` → `stopping` → `stopped`, toast.

---

## 5. Files to Modify

- `dashboard/server.js` — add `/api/fleet/:id`, `/api/fleet/:id/events`, `/api/fleet/stream`, enhance `readFleetStatus` to expose all fields, fix steer/stop to use real supervisor channel.
- `dashboard/src/App.tsx` — add `session-stats` live, `AgentWindowCard` workflowGraph/children/ack badges, live modal with tabs + shortcuts, `InputBar` already done.
- `dashboard.sh` — add `workflowGraph` and `children` display, `s/D/t` actions.
- `PLAN-fleet-observability-UI.md` — this doc.

---

## 6. Acceptance Criteria

- [ ] `GET /api/fleet` matches `subagent status fleet` runIds/states/tokens/window/spent within 1s.
- [ ] Middle 3/4 windows show `workflowGraph` flow and `children[]` nested when coder fans out.
- [ ] Click window → live modal with **Live Log** auto-scrolling every 1s, `Events` timeline, `Artifacts` links, `Steer` (follow_up/steer/auto) + `Stop` + `Copy pi-vCLI` all work and reflect in `events.jsonl`.
- [ ] **Session stats** row shows `window/spent` (e.g., `3.1k window 4.2k spent`), `toolCount`, `turnCount`, `totalCost`, not mock `30,880`.
- [ ] CLI `dashboard.sh` `a` → `s` steer and `D` stop work like web, and `x` toggles tool details.
- [ ] Shortcuts `j/k`, `PgUp/Dn`, `x`, `s`+Tab, `D`, `f`, `?` work in web (or at least buttons do).

---

## 7. How Agents Are Created/Managed (for UI context)

See §1 table in this plan and `PLAN-fleet-sync.md`. UI's `InputBar` dispatch `agent: coder|tester|researcher|reviewer|planner` maps directly to `~/.pi/agent/agents/*.md` `name:` — `subagent({agent, task})` will use that file's `tools, thinking, systemPromptMode`. No extra registration needed.

**Extension `pi-subagents` is the control plane:** `pi install npm:pi-subagents` registers the 3 tools + 2 skills + 5 prompts + FleetView + Fleet inspector + host RPC. Our dashboard is a **second observer** of its artifacts, not a replacement — we must not write `status.json` ourselves except for dispatch mock; rely on `readFleetStatus` reconciliation.

---

## 8. How to Run After

```bash
git push
docker compose up -d --build
# web: http://localhost:5173 (HMR) + http://localhost:3000 (prod)
# cli: docker exec -it pi-personal-agent bash → dashboard → middle windows are live fleet
# test: dispatch "sleep 10 && echo hello" via bottom bar → new window appears in <1s, click → Live Log streams, try Steer
```

