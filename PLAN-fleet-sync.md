# Plan: Fleet-Synced Dashboard — active agents medium windows + session stats

**Date:** 2026-09-04
**Scope:** Make web + CLI dashboards use the *same* source as `/subagents-fleet` / `subagent({action:"status", view:"fleet"})` — no separate mock/fs polling. Also document how agents/subagents are created & managed and how `pi-subagents` extension is used.

---

## 1. Goal

- **Single source of truth:** `GET /api/agents` and `GET /api/session-stats` return exactly what `FleetView` / `/subagents-fleet` sees (`status.json` + events + tokens), not a separate `pi list` + filesystem scan.
- **Medium windows (3/4):** Each `AgentWindowCard` is a live fleet child — `running`/`waiting`/`done`/`error`, model, tokens, elapsed, log lines from `output-*.log`, click → `pi --session <sessionFile>` (pi-vCLI).
- **Session stats (bottom row):** Derived from fleet lifecycle artifacts: `totalTokens` (fleet `spent`), `toolCount`, `tasksComplete` (done/total), `session uptime` (fleet `durationMs`).
- **Left 1/4:** Conversations with agent tag `[coder]`/`[tester]` from session files, same as before, but now correlated to fleet children via `sessionId`.

---

## 2. Current Implementation (as-built)

### 2.1 Agents — how they are created/managed

| Layer | Path | How it works |
|-------|------|--------------|
| **Builtin** | `~/.pi/agent/npm/node_modules/pi-subagents/agents/*.md` | `scout, researcher, worker (aliases: coder), reviewer, oracle, delegate` — lowest priority, no model pin |
| **Package** | `package.json: pi.subagents.agents` | Package agents from `pi-subagents` load above builtins |
| **User** | `~/.pi/agent/agents/coder.md`, `tester.md` | Our custom `coder` (high thinking, `tools: read,write,edit,bash,grep,find,ls,web_search,fetch_content,default.subagent,...` + `inheritProjectContext:true`) and `tester` (independent `bash npm test`, ends `Test verdict: PASS/FAIL`). Highest user priority, shadowing builtin `worker` alias. |
| **Project** | `.pi/agents/coder.md`, `.pi/prompts/coder-tester-loop.md` | Versioned, baked into Docker via `COPY .pi/agents/coder.md /root/.pi/agent/agents/coder.md` in `Dockerfile`. |
| **Discovery** | `settings.json: packages: ["npm:pi-freeflow","npm:pi-web-access","npm:pi-subagents"]` | `pi list` shows active. `subagent({action:"list"})` returns authoritative runtime list with `name, description, enabled, agentScope`. |

**Creation:** `pi install npm:pi-subagents` → writes `settings.json`, copies agents to `npm/node_modules/pi-subagents/agents/`. Custom agents are plain markdown with YAML frontmatter (`name, description, tools, thinking, systemPromptMode, inheritProjectContext, timeoutMs`). User runs `subagent({agent:"coder", task:"..."})`.

### 2.2 Subagents — how they run

- **Parent** calls `default.subagent` tool. Two modes:
  - Direct: `subagent({agent:"coder", task:"...", background:false})` — foreground streams in chat.
  - Scripted: `subagent({workflowScript:"const c=await runs.run('coder',{agent:'coder',task}); return ...", timeoutMs:900000})` — stable keys, `runs.all`, `runs.lanes`, `runs.steer`, `bg_wait`.
- **Child** is a forked Pi session (`defaultContext:fork` for coder) with its own session file, inherits `AGENTS.md` but not parent subagent artifacts. Child `contact_supervisor({reason:"need_decision"})` → parent `subagent_supervisor({action:"reply"})` via `supervisor-channels` under `/tmp/pi-subagents-uid-0/`.
- **Config:** `PI_SUBAGENT_MAX_DEPTH=2`, `timeoutMs` (default 30m), `toolBudget`, `usageBudget`.

### 2.3 Fleet — where `/subagents-fleet` reads from

Same place dashboard should read:

```
<tmpdir>/pi-subagents-uid-0/async-subagent-runs/<runId>/
  status.json      // ← widget + subagent({action:"status"}) source
  events.jsonl     // subagent.run.started / step.completed / steer.* etc
  output-0.log     // live tail for LogLineView
  subagent-log-<id>.md
<tmpdir>/pi-subagents-uid-0/async-subagent-results/<runId>.json   // terminal result
<tmpdir>/pi-subagents-uid-0/session-leases/ + supervisor-channels
```

`status.json` fields: `runId, sessionId, sessionFile, state(running|paused|complete|failed|stopped), startedAt, lastUpdate, durationMs, cwd, asyncDir, workflowGraph, steps[], results[], totalTokens, totalCost, toolCount, turnCount, children[]` (nested). `FleetView` and `subagent({action:"status", view:"fleet"})` are projections of this file plus `events.jsonl`.

**Current dashboard server:** `dashboard/server.js` reads `SUBAGENT_RUNS/*/status.json` directly + fallback mock. It does *not* yet use the same reconciliation as `subagent({action:"status"})` (which re-reads canonical artifacts after reconciliation). So drift possible.

### 2.4 Extension usage (`pi-subagents`)

- **Install:** `pi install npm:pi-subagents` → `~/.pi/agent/settings.json: packages` + `extensions/pi-subagents -> /opt/pi-freeflow` style symlink (but for pi-subagents it's `npm/node_modules/pi-subagents`).
- **Load:** `pi` startup reads `settings.json`, loads `pi-subagents/src/extension/index.ts` which registers tools `default.subagent`, `default.subagent_supervisor`, `default.bg_wait`, skills `pi-subagents/council-mode`, prompts `parallel-review/review-loop/council`, and slash commands `/subagents-fleet`, `/subagents-doctor`, `/subagents-watchdog`, etc.
- **Config:** `~/.pi/agent/settings.json: subagents{agentOverrides, maxSubagentSpawnsPerRun:64, fleetViewPlacement, watchdog...}` + `~/.pi/agent/npm/node_modules/pi-subagents/docs/*.md`.
- **Observability:** Fleet inspector, `subagent-async` widget (`PI_SUBAGENT_ASYNC_JSON:`), host RPC `subagent:child-status` events.

---

## 3. Desired Sync Design

**Principle:** Dashboard's `active agents — medium windows` *is* FleetView, and `session stats` *is* fleet lifecycle stats. No second parser.

```
pi TUI FleetView  ─┐
                    ├─► status.json + events.jsonl + output-*.log  (single artifact dir)
dashboard web/CLI ─┘

                    same for session stats: totalTokens/spent, toolCount, durationMs from status.json
```

**Data contract (reuse fleet fields):**

| Dashboard | Fleet source |
|-----------|--------------|
| `AgentWindowCard` agent label/color | `status.json: steps[].agent` or `results[].agent` |
| `task` | `status.json: steps[].task` (first user message) or workflow `label` |
| `status` RUN/WAIT/DONE/ERR | `state: running/paused/complete/failed/stopped` → `running/waiting/done/error` |
| `model, tokens, elapsed` | `model, totalTokens, durationMs` |
| `lines` | `output-0.log` tail (last 8 lines) + `events.jsonl` tool calls |
| Click → pi-vCLI | `sessionFile` → `pi --session <sessionFile>` (exact fleet session, not detached copy) |
| Session stats total tokens / spent | `totalTokens` + `totalCost` |
| Tool calls | `toolCount` |
| Tasks complete | `results.filter(r=>r.ok).length / steps.length` |
| Uptime | `durationMs` |

Left 1/4 conversations already correct (sessions dir), but now correlate `sessionId` to fleet `runId` so clicking a conversation that has an active fleet child jumps to that child, not just the file.

---

## 4. Implementation Steps

### Phase 1 — Backend: share fleet reconciliation (no UI change yet)

1. **Refactor `dashboard/server.js`:**
   - Replace ad-hoc `fs.readFileSync(status.json)` loop with a function `readFleetStatus()` that mimics `subagent({action:"status"})` reconciliation: read `status.json`, merge `events.jsonl` for `toolCount/turnCount`, tail `output-0.log` for `lines`, handle nested `children`.
   - Keep fallback mock only when `SUBAGENT_RUNS` empty and no fleet artifact.
   - Add `GET /api/fleet` that literally shells `pi -p "subagent({action:\"status\",view:\"fleet\"})" --mode json` or directly reads the fleet snapshot file that `/subagents-fleet` would show, and returns it. This becomes the canonical source; `/api/agents` becomes a projection of `/api/fleet`.

2. **Add `GET /api/session-stats`:**
   - Aggregates `totalTokens, totalCost, toolCount, tasksComplete, durationMs` across active fleet runs + `ls sessions --workspace--/*.jsonl` count. Returns `{tokens, toolCalls, tasksComplete, uptime}`.

3. **Add `GET /api/conversations` already exists as `/api/sessions` — enhance it to include `fleetRunId` and `fleetState` by joining `sessionFile` ↔ `status.json.sessionFile`.**

### Phase 2 — Frontend: wire Figma UI to fleet

4. **Update `dashboard/src/App.tsx`:**
   - Replace `fetch("/api/agents")` with `fetch("/api/fleet")` and map to `AgentWindow[]`.
   - `Topbar` already takes `running/waiting/done` from `windows` — keep, but derive from fleet `state` directly.
   - `Sidebar` stays, but `onSelect` now does `POST /api/open-session {file, fleetRunId}` → modal shows `pi --session` + `docker exec` as before — this is correct fleet `sessionFile`.
   - `AgentWindowCard onClick` → `handleClickWindow` now opens `status.json.sessionFile` via same modal (already does), but add `subagent_supervisor` shortcut button in modal: `Copy steer command` → `subagent_supervisor({action:"send", runId: fleetRunId})`.

5. **Keep CLI `dashboard.sh` in sync:**
   - Change its `get_running_agents()` to parse same `status.json` fields as server (not `pi list` alone). Make left 1/4 parsing use `fleetRunId` correlation so numbered selection opens fleet session, not just file.

### Phase 3 — Validation & docs

6. **Validate:**
   - `curl http://localhost:3000/api/fleet` vs `pi -p "subagent({action:\"status\",view:\"fleet\"})" --mode json` — must match (allow `mock` when idle).
   - Click middle window in web UI → modal shows correct `sessionFile` that `docker exec -it pi-personal-agent pi --session <file>` actually attaches to live coder.
   - `docker logs pi-dashboard --tail 20` shows no drift logs.

7. **Docs:** Update `AUTO_UPDATE_README.md` + `PLAN-fleet-sync.md` with “How agents are created/managed” table and extension usage (install/load/config/obs), as above.

---

## 5. Files to Modify

- `dashboard/server.js` — add `readFleetStatus()`, `/api/fleet`, `/api/session-stats`, join logic.
- `dashboard/src/App.tsx` — switch to `/api/fleet`, wire stats, modal.
- `dashboard.sh` — parse `status.json` same as server.
- `docs` — this plan + `AUTO_UPDATE_README.md` section “Agents & Fleet”.
- No change to `pi-subagents` extension itself (use as-is).

---

## 6. Acceptance Criteria

- [ ] `GET /api/fleet` returns same runIds/states as `/subagents-fleet` (or `subagent status fleet`) when coder is running in background.
- [ ] Clicking a middle medium window in web UI opens the *exact* fleet `sessionFile` (verified by `docker exec pi --session` attaching to live logs).
- [ ] Session stats row matches fleet `totalTokens/toolCount/durationMs` (not mock 30,880).
- [ ] Left 1/4 conversation with active fleet child highlights and jumps to that child.
- [ ] `pi install npm:pi-subagents` flow documented, tester/coder creation via `~/.pi/agent/agents/*.md` works, `pi list` + `subagent({action:"list"})` show them.

---

## 7. Risks & Mitigations

- **File-descriptor race on `status.json`** — use same reconciliation as fleet (read events then status, handle `paused`).
- **Web UI not in same UID namespace as fleet tmpdir** — mount `/tmp/pi-subagents-uid-0` into `pi-dashboard` container as `ro` (already planned via `SUBAGENT_RUNS` env).
- **Fallback mock confusion** — keep mock only when fleet empty, label UI “mock — no fleet” clearly.

---

## 8. How to Run (after implementation)

```bash
docker compose up -d --build
docker logs -f pi-dashboard --tail 20
# trigger a coder run
pi -p "Use coder in background to sleep 20 and echo hello"
# web: http://localhost:3000 → middle windows should show that coder run within 3s
# cli: docker exec -it pi-personal-agent bash → dashboard → middle windows same
```

Owner: coder + tester (tester validates `/api/fleet` vs `subagent status`).

