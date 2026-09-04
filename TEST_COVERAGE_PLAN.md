# TEST_COVERAGE_PLAN — Pi-Harness

**Date:** 2026-09-04  
**Companion:** `TASKS.md` (first-principles task DAG) — this file is *how to prove* each task.  
**Project type:** Dockerized Node/React + shell + Pi agent harness. No test framework currently installed (only `playwright ^1.62.1` `package.json:3`). All commands below are proposed to-add.

---

## 1. Strategy

### Triangle (bounded by fleet bus)

```
        E2E (Playwright + docker exec)
       /  verifies the bus is same via two surfaces  \
      /   8 scenarios, <5 min, CI gate                 \
     /__________________________________________________\
    Integration  (HTTP ↔ FS ↔ CLI)
        22 scenarios, `curl + ls` contracts,
        mocked fleet fixtures, shellcheck
   /______________________________________________\
  Unit (Vitest + Bats + bash -n + grep lints)
      67 cases, pure function `readFleetStatus`,
      component props, agent frontmatter
```

### What "coverage" means here

- **Line coverage threshold 80%** on `dashboard/server.js:25` `readFleetStatus()` and `dashboard/src/App.tsx` — the reconciler is the trust anchor; if it drifts, everything lies.
- **Scenario coverage 100% on invariants** defined `TASKS.md:2` (stale→failed, window/spent, path traversal, TTL double-filter, shell vs PI dispatch). Those are not negotiable — one missing scenario = P0 bug returns.
- **No coverage theater:** Distinct `describe` per failure mode listed in `TASKS.md:3 If it lies` row is required.

### Tooling to install

```bash
# dashboard/backend shared
npm --prefix dashboard install -D vitest@^3 jsdom@^26 @testing-library/react@^16 @testing-library/jest-dom@^6 msw@^2 supertest@^7

# cli
# bats-core via npm or winget, shellcheck already in ubuntu:24.04 Dockerfile:2 apt-get

# e2e
npx playwright install --with-deps chromium
# inside WSL/Docker: apt-get install -y libnss3 libatk

# lint infra
npm i -D ajv@^8 yaml-front-matter@^4
```

### Scripts to add

```json
// dashboard/package.json scripts
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:cov": "vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=75",
  "test:api": "vitest run --run tests/api",
  "test:unit": "vitest run --run tests/unit"
}
// root package.json scripts
{
  "test": "npm --prefix dashboard run test:cov && bats tests/cli/*.bats",
  "test:e2e": "node test_ui_playwright.js && npx playwright test tests/e2e --reporter=list",
  "lint:agents": "node tests/lint/agents.mjs",
  "lint:infra": "shellcheck dashboard.sh .pi/dashboard.sh git-sync.sh task_watcher.sh slack_webhook.sh docker-entrypoint.sh"
}
```

### CI gates (`.github/workflows/docker-ci.yml` augmentation)

Add job `test` before `build-and-push`: `npm ci`, `npm --prefix dashboard test:cov` (fails <80), `shellcheck`, `lint:agents`, `npx playwright test` with `services.dashboard` health `curl --retry 5 http://localhost:3001/api/fleet`. Block merge on red.

---

## 2. Test Data & Fixtures

Centralize under `tests/fixtures/` (create).

| Fixture | Content | Used by |
|---------|---------|---------|
| `fleet/status-running.json` | `state:running totalTokens:{total:1200,window:800} durationMs:12000` | C4/C5 unit |
| `fleet/status-object-tokens.json` | `totalTokens:{window:3100, total:4200}` `PLAN-fleet-observability-UI.md:18` | window/spent |
| `fleet/status-stale.json` | `lastUpdate: now-35s state:running` | stale→failed |
| `fleet/status-paused.json` | `state:paused` → `waiting` `server.js:96` | waiting |
| `fleet/status-children.json` | `children:[{agent:"researcher"}]` + `workflowGraph: done scout→running worker` | nested |
| `fleet/events.jsonl` | 6 lines `run.started, step.completed, steer.*` | events tab |
| `fleet/output-0.log` | 120 lines `cat src/middleware/index.ts` style | tail + bounded |
| `sessions/valid.jsonl` | 34 msgs `{"message":{"content":[{"type":"text","text":"coder fix"}]}}` `server.js:147` | sessions |
| `sessions/malformed.jsonl` | 2 good lines + 1 `}{` + 1 empty | parse robustness |
| `sessions/large.jsonl` | 5.5 MB `>5MB guard` `server.js:315` | size guard |
| `agents/coder.valid.md` | full frontmatter good | lint |
| `agents/coder.bad.md` | missing `default.subagent` | lint FAIL |
| `agents/tester.bad.md` | contains `default.subagent` leaf violation | lint FAIL |

Helper `tests/helpers/fleet.mjs`:

```js
export function mkTmpFleet(dirs) { /* write status.json files to tmpdir, set env SUBAGENT_RUNS */ }
export async function seedFleet(fixtureNames) {}
```

---

## 3. Unit Tests (67 cases)

Run: `npm --prefix dashboard run test:unit -- --reporter=verbose`

Coverage target: `dashboard/server.js` lines 80%, branches 75%. `dashboard/src/App.tsx` components lines 75%.

### 3.1 C4 Fleet Reconciler `readFleetStatus()` — `dashboard/server.js:25`

| ID | Scenario | Input | Expected | Notes |
|----|----------|-------|----------|-------|
| **U-C4-01** | Empty `SUBAGENT_RUNS` does not throw | no dir | `[]` | `server.js:27` `existsSync` guard |
| **U-C4-02** | Skips dir without `status.json` | `runId/` empty | skip, `length 0` | `34 continue` |
| **U-C4-03** | Parses minimal `status.json` running | `status-running.json` | `state running, fleetState running, status running` | task/agent fallback `41` |
| **U-C4-04** | `state paused` → `waiting` | `status-paused.json` | `status waiting` | `96` map |
| **U-C4-05** | `state complete` → `done` | `{state:"complete"}` | `status done` | `96` |
| **U-C4-06** | `state failed`→`error`, `stopped`→`error` | both | `error` | `96` |
| **U-C4-07** | Stale `running + lastUpdate 35s ago` → `failed`, frozen `durationMs` | stale fixture now-35s | `state failed, durationMs = lastUpdate-startedAt` not growing | `49–52` prevents 616s bug |
| **U-C4-08** | `pending` + stale 35s also → `failed` | `pending` 35s | `failed` | `49` `(running||pending)` |
| **U-C4-09** | Fresh running `durationMs=null` computed `now-startedAt` | 12s ago, `durationMs undefined` | `Math.floor((now-startedAt)/1000)` | `56` |
| **U-C4-10** | Negative `durationMs` clamped 0 | `durationMs:-5` | `0` | `58` |
| **U-C4-11** | `totalTokens` object `{total}` picked | `object-tokens` `window:3100 total:4200` | `tokens 4200` (total first) `61` | `typeof object` branch |
| **U-C4-12** | `totalTokens` object `{window}` when total missing | `{window:3100}` | `tokens 3100` | `61` fallback |
| **U-C4-13** | `totalTokens` number path | `{"totalTokens": 8340}` | `8340` | `62` |
| **U-C4-14** | `totalTokens` absent fallback random? Must not crash | `{}` | `0` or mocked random stub → in test override `Math.random` → deterministic | `62` + `108` `random()` only if `fleetLoaded`, unit mocks it to 0 |
| **U-C4-15** | Non-number `totalTokens` string coerced | `{"totalTokens":"4000"}` | `4000` `Number()` | `63` |
| **U-C4-16** | Output tail 8 lines produced | `output-0.log` 120 lines | `lines.length 8`, last 8 only `74`, `kind` mapping  `76` | |
| **U-C4-17** | Missing output falls back to `events.jsonl` 5 lines | no `output-*` but `events.jsonl` | `event` kind `82–89` | |
| **U-C4-18** | Neither log nor events → `state: running` info | empty dir | single `{kind:"info", text:"state: running"}` `93` | |
| **U-C4-19** | `LogLineView` kind classification | lines with `ERR`, `[tool]`, `cmd` | `err/out/tool` per regex | |
| **U-C4-20** | Sort `startedAt desc` newest first | 3 dirs `startedAt 100,300,200` | order `300,200,100` `125` | FleetView order |
| **U-C4-21** | Malformed `status.json` JSON skipped not thrown | `{bad json` | skipped, fleet length excludes it | `121 catch` |
| **U-C4-22** | `children[]` preserved (nested) | `status-children.json` | `children` array passthrough if exists | extended field `C4-P4-01` |
| **U-C4-23** | `sessionFile` & `sessionId` passthrough | `sessionFile:"/root/.pi/.../abc.jsonl"` | equals | `113` |
| **U-C4-24** | Bounded `lines=200` helper tail capped | `output-0.log` 500 lines `?lines=200` | `200` not 500 `C4-P1-03` | integration also but unit helper |

**Assertions that must appear verbatim in test file:**

```js
expect(readFleetStatus().find(f=>f.runId==="stale-run").fleetState).toBe("failed");
expect(readFleetStatus().find(f=>f.runId==="stale-run").durationMs).toBeLessThan(35_000);
```

### 3.2 C5 Backend pure helpers `parseSessionFile()` — `dashboard/server.js:129`

| ID | Scenario | Input | Expected |
|----|----------|-------|----------|
| **U-C5-01** | Parses `valid.jsonl` title/preview/agent/time | 34 msgs, `coder` text | `title.slice0,30`, `preview 40`, `agentTag coder`, `messages 34`, `mtime` |
| **U-C5-02** | Agent tag fallback `coder|tester|reviewer|researcher|planner|main` | each keyword file | correct |
| **U-C5-03** | Time from filename `2026-09-04T09_41_00` → `09 41` `139` else `mtime` | filename suffix | deterministic |
| **U-C5-04** | Malformed session JSON line skipped | `}{` + 2 good | still parses 2 msgs |
| **U-C5-05** | Empty file `catch` → `null` `171` | `""` | `null` |
| **U-C5-06** | `stat.mtimeMs` captured for sort `178` | | number >0 |

### 3.3 C6 Frontend components — `dashboard/src/App.tsx`

 Framework: `vitest + jsdom + @testing-library/react + @testing-library/jest-dom`

| ID | Component | Scenario | Assert |
|----|-----------|----------|--------|
| **U-C6-01** | `StatusDot` | `running` shows `RUN` green `#39ff6e` pulse, `waiting WAIT amber`, `done DONE grey`, `error ERR red` | `76–95` color+label+pulse class `agent-running` |
| **U-C6-02** | `LogLineView` | `kind err` prefix `✕` red `102`, `tool` `⚙` amber, `info` `»` blue | `98–104` style map |
| **U-C6-03** | `AgentWindowCard` | `isActive true` border = `AGENT_COLORS[agent]` else `#1e2b1e` `132`, pulse `running` cursor blink `166` | computed style |
| **U-C6-04** | `AgentWindowCard` | truncates long `task 200ch` properly, `tokens /1000 .1f k tok` `154` | |
| **U-C6-05** | `Sidebar` | filter `ALL` vs `CODER` toggles; skeleton 4 bars when `conversations===null && isLoading` `243`; empty `no sessions` `251` | `192` |
| **U-C6-06** | `Topbar` | renders `running/waiting/done` props `303`, `tick` time `en-GB` | `320` |
| **U-C6-07** | `InputBar` | `agent` chips `RESEARCHER default` `356`, mode toggle `SHELL|PI` `405` correct colors, `↵ send (mode)` `433`, disabled `sending` `376` | |
| **U-C6-08** | `InputBar` | `Enter` with non-empty calls `onDispatch` with trimmed `ag, task, mode` then clears `val` `384–398`; empty no call | mock |
| **U-C6-09** | `App` conversations guard | `sRes === []` reachable no fallback, `sRes null` first load FALLBACK `491`, subsequent `null` keep prev `499` | null-is-loading prevents flash `445` |
| **U-C6-10** | `App` fleet→windows mapping | `fleetArr` mapping `505–516` normalizes `id\|runId.fullId`, `activeOnly` double filter `520` | |
| **U-C6-11** | `App` `handleSelectSession` | clicking session with `fleetRunId` opens `modalAgentId = fleetHit.id` `557`; without fleet does `POST /api/open-session` `559` | msw |
| **U-C6-12** | Modal derived `modalWin` | `__session_<id>` vs fleet hit `572–576` cmd string `575` `docker exec` `576` | |
| **U-C6-13** | Keyboard shortcut guard | input focused + `f` does not open modal `464–467`; `Esc` closes `469` | fire `keydown` on input |
| **U-C6-14** | Tabs switching | `log→transcript→events→artifacts→session` `749` active tab styling | `activeTab` state |

### 3.4 C7 CLI helpers — `dashboard.sh:44` `get_agent_tag`, `format_session_line`, `get_running_agents`, `get_fleet_stats`

| ID | Scenario | Expect |
|----|----------|--------|
| **U-C7-01** | `get_agent_tag` extracts `"agent":"tester"` | `tester` |
| **U-C7-02** | fallback `grep coder` → `coder`, else `main` | |
| **U-C7-03** | `format_session_line` truncates `preview` 32ch, strips quotes `53` | |
| **U-C7-04** | `get_running_agents` empty shows `○ idle — no fleet agents running` `76` | |
| **U-C7-05** | `get_fleet_stats` sums `totalTokens` same parser as `readFleetStatus` — **BUG FIX REQUIRED:** handle object tokens | if bug still, test expects fix `grep -o '"total"'` |
| **U-C7-06** | `get_fleet_stats` zero fleet mock fallback `30880` `41` | `99` still acceptable for unit but integration expects non-mock when fleet present |

### 3.5 C2 Agents frontmatter lint — `.pi/agents/*.md`

| ID | Scenario | Expect |
|----|----------|--------|
| **U-C2-01** | `coder.md` contains `name: coder`, `tools` includes `read,write,edit,bash,grep,default.subagent`, `thinking: xhigh`, `inheritProjectContext: true` `coder.md:4` | pass |
| **U-C2-02** | `coder.md` `defaultContext: fork` required | pass |
| **U-C2-03** | `tester.md` must not contain `default.subagent` leaf | fail if found |
| **U-C2-04** | `tester.md` contains `Test verdict:` template | pass |
| **U-C2-05** | Unknown `thinking:` value `ultra` fails | fail |
| **U-C2-06** | Missing YAML `---` header fails | fail |

### 3.6 C3 Workflow branching

| ID | Scenario | Input `tester.output` contains | Expected path |
|----|----------|-------------------------------|---------------|
| **U-C3-01** | 1 round PASS no FAIL | `Test verdict: PASS` | `rounds:1 final pass` `41` |
| **U-C3-02** | tester1 FAIL → coder2→tester2 PASS | FAIL on `tester1` then PASS | `rounds:2` `39` |
| **U-C3-03** | FAIL FAIL → coder3→tester3 | double FAIL | `rounds:3` `37` |
| **U-C3-04** | `PASS with notes` treated as PASS (stop early) | per `.pi/prompts/...=9` | `PASS with notes` stops |
| **U-C3-05** | `runs.run` throws → workflow propagates not silent | mock throw | catch surfaces |

---

## 4. Integration Tests (22 cases)

Run: `npm --prefix dashboard run test:api` or `node --test tests/integration/*.test.mjs` + `bats tests/cli/*.bats`

Harness: `supertest` or raw `spawn node server.js` on random port + `curl`. Provide `tests/helpers/fleet.mjs` to seed temp dir before each suite.

#### 4.1 `GET /api/fleet` & `GET /api/agents` contract

| ID | Request | Assert | Invariant from |
|----|---------|--------|----------------|
| **I-C5-01** | `GET /api/fleet` with 2 running 1 stale-35s → returns 2 not 3 stale filtered to `failed` but still in `all` vs filtered | JSON `fleet.length 2`, `total 3`, `filtered true` `server.js:224` | `C4-P1-02` |
| **I-C5-02** | `GET /api/fleet?all=true` shows `done` older than 30s | `DONE_TTL 30s` | `210` |
| **I-C5-03** | `GET /api/agents` active-only matches `GET /api/fleet` running+waiting counts | both TTL same `237` | `C5-P1-04` |
| **I-C5-04** | `GET /api/fleet` empty → `fleet [] count 0` not fallback mock | no `w1` leak | `server.js:218` |
| **I-C5-05** | `GET /api/agents?fallback=true` when empty returns 2 mock `w1,w2` `264` | contains `CODER` | `260` |
| **I-C5-06** | Fleet fields present: `runId,id,fullId,agent,task,status,fleetState,model,tokens,elapsed,durationMs,lines,sessionFile` | schema `server.js:98` | `PLAN-fleet-observability-UI:18` |
| **I-C5-07** | `lines` is 8 elements with `ts,kind,text` each `slice(0,120)` | exactly 8 or fewer if short | `74` |
| **I-C5-08** | `totalTokens` object in fixture → `/api/fleet` normalized `tokens` | 3100 case | `60` |

#### 4.2 `GET /api/sessions` + session file

| ID | Request | Assert |
|----|---------|--------|
| **I-C5-09** | `GET /api/sessions` sorts 20 newest `mtimeMs desc` `178`, enriches `fleetRunId` via `fleetBySession` `182` | first session fleetState correlation |
| **I-C5-10** | `GET /api/session/:id` `encodeURIComponent(basename)` returns `200 application/json` with `Content-Type` `318` | good path `299` |
| **I-C5-11** | `GET /api/session/:id` non-existent → `404 {error:'not found'}` `309` | includes `id` in body |
| **I-C5-12** | `GET /api/session/:id` path traversal `../` trimmed via `path.join(SESSIONS_DIR, decoded)` still inside SESSIONS_DIR — must fail not leak | assert no `../` escape, depends on unimplemented but required guard — if guard missing, test documents P1 fix |
| **I-C5-13** | `GET /api/session/:id` `stat.size >5MB` → truncated `slice(-500KB)` `316` | mock 5.5MB fixture returns `500KB ±` headers |
| **I-C5-14** | `GET /api/session-stats` aggregates `totalTokens/toolCalls/tasksComplete/uptime` `278`, uptime `HH:MM:SS` `284` | `totalTokens` sum matches fleet + `fleetCount` field |

#### 4.3 `POST /api/dispatch`

| ID | Scenario | Assert |
|----|----------|--------|
| **I-C5-15** | `POST /api/dispatch {"agent":"coder","task":"echo hi","mode":"shell"}` `326` → `201? 200 queued:true runId 36+4` creates dir + `status.json:running` + `events.jsonl run.started` + `output-0.log` `368` | visible in next `GET /api/fleet` within `poll 1s` |
| **I-C5-16** | Missing `task` empty → `400 {error:'task required'}` `329` | throws before spawn |
| **I-C5-17** | `PI` mode `{"mode":"pi"}` valid → `docker exec -d` spawn `340` — on host without docker returns gracefully `fallback to shell` note not crash | assert no `ECONNREFUSED` throw |
| **I-C5-18** | Shell dispatch spawns `sh -c` loop into `output-0.log` → tail grows after 1s; `setTimeout 8s` marks `complete` `410` | `fs.readFileSync output` contains `[done]` after `await delay(9000)` |
| **I-C5-19** | Dispatch truncates `cleanTask 2000ch` `331` | 3000ch input produces 2000ch `status.json.task` |

#### 4.4 Control plane `steer`/`stop`/`open-session`

| ID | Scenario | Assert |
|----|----------|--------|
| **I-C5-20** | `POST /api/fleet/:id/steer {message:"hi",mode:"follow_up"}` → `200 {status:'queued',runId}` writes `supervisor-channels/<runId>.steer.json` `468` with `mode,message,ts,from` | `fs.existsSync` |
| **I-C5-21** | `POST /api/fleet/:id/steer` missing `message` → `400 message required` `459` | |
| **I-C5-22** | `POST /api/fleet/:id/stop` → `200 {status:'stop_queued'}` file `stop.requested` `484`; `GET /api/fleet/:id` still `404` if bad id | |
| **I-C5-23** | `POST /api/fleet/bogus/steer` unknown id → `404 fleet run not found` `464` | |
| **I-C5-24** | `POST /api/open-session {file, agentId}` `425` resolves `runId→sessionFile` else `file` → returns `{cmd,dockerCmd}` `434` | `docker exec -it` correct quotes |
| **I-C5-25** | `GET /api/fleet/:id` with `id|runId|fullId` all resolve same hit `441`; `?lines=200` capped not unbounded | lines ≤50 `452` |

#### 4.5 CLI ↔ HTTP parity (`bats`)

| ID | Check | Command |
|----|-------|---------|
| **I-C7-01** | `dashboard.sh` parses same fleet count as `GET /api/fleet` within `±1` (poll race) | `bats` does `count_be=$(docker exec pi-dashboard node -e "require('./server.js')")` vs `count_sh=$(bash dashboard.sh --dump)` — implement `--dump` flag or parse function directly |
| **I-C7-02** | `shellcheck` clean `dashboard.sh`, `task_watcher.sh`, `docker-entrypoint.sh` | `shellcheck -S warning *.sh` |
| **I-C7-03** | `bash -n` syntax ok all scripts | `bash -n` |
| **I-C7-04** | `dashboard.sh` handles object `totalTokens` (`jq` fallback) — feed fixture `status-object-tokens.json` into `SUBAGENT_RUNS` and assert tokens not empty | regression |

---

## 5. End-to-End Tests (8 core + 4 optional)

Runner: Playwright `chromium` `test_ui_playwright.js:4` extended. Also `tests/e2e/*.spec.ts` for Playwright Test runner. Requirements: `docker compose up -d` already, `pi-personal-agent` idempotent, `pi-dashboard` healthy.

Base URL: `http://localhost:5173` (Vite dev) or `http://localhost:3000` (prod). Spec supports both via `BASE_URL` env.

```bash
# manual
docker compose up -d --build
docker logs -f pi-dashboard --tail 20
node test_ui_playwright.js   # existing smoke
npx playwright test tests/e2e --project=chromium --reporter=list
```

| ID | Scenario | Steps | Expected | Traceability |
|----|----------|-------|----------|--------------|
| **E2E-01** | Tracer bullet: dispatch shell → card appears → updates → modal | `goto BASE_URL` `domcontentloaded 15s` `test_ui_playwright.js:7` `page.goto`; `fetch('/api/dispatch',{agent:'coder',task:'sleep 2 && echo hello',mode:'shell'})` via InputBar typing or direct `POST`; `waitForTimeout 3000`; `$$ agent grids` count `1`; `click first card`; `waitForSelector div.fixed.inset-0` `61`; assert modal `Live Log` tab shows `echo hello` or `[dispatch]` | Card <1s optimistic + <3s fleet; modal `● live` `762` | `TASKS C5-P1-05→C6-P2-04` |
| **E2E-02** | LEFT sessions correlation + static transcript fallback | `GET /api/sessions` seed `steer` — either spawn shell dispatch then go LEFT click first conversation without fleet; assert modal tabs `session`/`log` show transcript via `fetch('/api/session/:id')` fallback `579–631` not `waiting for logs…` `51` | `sessionLoading` false, `log` contains `text` >20 chars | `C6-P2-03` skeleton guard  |
| **E2E-03** | Modal 5 tabs navigate without crash | Open fleet modal via `f` key `463`; cycle tabs `log,transcript,events,artifacts,session` `749`; every tab heading visible `uppercase` | No `PAGE ERROR` listener `20` | `C6-P2-06` |
| **E2E-04** | Steer from modal writes file + events timeline | With running `sleep 20` dispatch, type `steerMsg="focus scope"` select `follow_up`, click `Send s` `820`; assert `POST /api/fleet/:id/steer 200 queued` network; reopen `events` tab shows `steer.requested→delivered` | `supervisor-channels/<runId>.steer.json` exists `docker exec pi-dashboard ls` | `C5-P1-06` |
| **E2E-05** | Stop from modal transitions `running→stopped` | `click Stop D` `827`; poll `GET /api/fleet/:id` 5s expect `stopping\|stopped\|failed` | Button confirm if modal asks, state badge `STOPPED` | `C5-P1-06` |
| **E2E-06** | InputBar mode PI vs SHELL dispatch both visible | Send SHELL `echo pi-mode-test` then PI `echo pi-test` (PI via docker exec may need dummy `pi list` fallback) — expect 2 windows total `windows.length 2` grid `xl:grid-cols-2 671` | Two colors `SHELL #39ff6e vs PI #4da6ff` `408` | `C6-P2-05` |
| **E2E-07** | Poll 1s keeps live without SSE drift | Record `elapsed` `154` text, `wait 3000`, re-read `elapsed` increased `≈3s` | TTL not hiding running; blink `cursor-blink 54` visible | `C6-P2-02` |
| **E2E-08** | Large session truncation | Seed host `5.5MB jsonl` into `SESSIONS_DIR` `server.js:315`; click its left row; assert `session` tab or `log` shows `~500KB` slice not 5MB freeze; network `content-length ≤ 600KB` | 5s `AbortController` fallback succeeds `599` | `C4-P1-03` |
| **E2E-09** *(opt)* | SSE upgrade <200ms vs poll 1s | Enable `C5-P3-03` SSE; launch dispatch, assert `fleet/stream` `text/event-stream` and first `data:` <200ms | requires SSE branch | P2 |
| **E2E-10** *(opt)* | `?all=true` shows stale DONE hidden in default | Dispatch completes then wait 35s `DONE_TTL 30s`, check hidden without `?all=true`, visible with | `?all` param | `C5-P1-04` |
| **E2E-11** *(opt)* | Snapshot regression | `page.screenshot({fullPage:true, path: artifacts/today.png})` `13,59` compare via `toHaveScreenshot` | no unintended layout shift | polish |
| **E2E-12** *(opt)* | Keyboard nav `f/j/k/x/?/Esc` | With modal closed, press `f` opens, `x` hides tool lines, `?` help modal `44`, `Esc` closes | no JS throw | `C6-P2-07` |

**Playwright hardening (from existing `test_ui_playwright.js:1` gaps):**

- Wait strategy already `domcontentloaded` `7` + `waitForTimeout 3000` `8` replace with `waitForSelector('span:text("active agents")')` for determinism.
- Add `page.route('**/api/fleet', r=>r.continue())` to log payload size; assert no `PAGE ERROR`.
- Save 3 screenshots `13,59` to `test-results/` with git-ignore; set `toHaveScreenshot` baseline once.

**Existing file to evolve:**

- Keep `test_ui_playwright.js:1` as `scripts/smoke.mjs` and add `tests/e2e/fleet.spec.ts` that reuses helpers `goto`, `dispatch`, `openModal`, `steer`, `stop` for CI.
- Add `playwright.config.ts` with `webServer: {command:'npm --prefix dashboard run preview', port:4173}` for CI self-contained run.

---

## 6. Non-Functional & Cross-Cutting

| Area | Check | ID |
|------|-------|----|
| **Security** | `POST /api/fleet/:id/steer` `message` max 2000 `server.js:331` sanitized no XSS in modal `break-all` `767`; `path.join` traversal guard `I-C5-12`; CORS `server.js:17` `*` only GET/POST `Allow-Headers Content-Type`; rate not implemented — document future limit. | `NF-01` |
| **Performance** | `readFleetStatus` does `readdirSync` + `readFileSync` per dir — measure with `100 dirs`, expect <80ms p95. SSE upgrade optional for sub-100ms. Bundle size `dashboard/dist/index-*.js` <200KB gz. | `NF-02` |
| **Resilience** | `pi spawn ENOENT` guard `385` never crashes; `fs.read` catch `121`; stale GC 30s ensures `elapsed` not exploding 616s. | `NF-03` |
| **Observability** | `docker logs pi-dashboard` shows `[dashboard-api] dispatch coder` `332` + `steer/stop`; dashboard health `GET /api/fleet` JSON includes `timestamp, source` `218`. | `NF-04` |
| **Accessibility** | Modals `role=dialog`, `Esc` close `469`, focus trap (missing — P2 gap to fix). Colors meet WCAG contrast `#39ff6e on #0a0c0a` borderline — document exemption for dark hacker theme. | `NF-05` |
| **Compatibility** | `sh` not `bash` fallback `server.js:398` `spawn('sh')` Alpine OK; `command -v pi` guard `dashboard.sh:??`; `printf "%'d"` `100` BusyBox fallback documented. | `NF-06` |

---

## 7. Coverage Targets & Gates

| Suite | Threshold (must pass) | Current gap | First file to cover |
|-------|----------------------|-------------|---------------------|
| **Unit:** `dashboard/server.js:25 readFleetStatus` | **lines 80 / branches 75** | 0% (no tests yet) | `tests/unit/fleet.test.ts` 24 cases `U-C4` |
| **Unit:** `dashboard/src/App.tsx` | **lines 75** | 0% | `tests/unit/App.test.tsx` 14 cases `U-C6` |
| **Integration:** `/api/*` contracts | **scenarios 100% on invariants** (12 P0) | 0% | `tests/integration/fleet.test.mjs` `I-C5-01..25` |
| **CLI:** `shellcheck + bats` | **clean + 6 snapshots** | `shellcheck` passes, bats 0% | `tests/cli/cli.test.bats` `U-C7+I-C7` |
| **E2E:** Playwright 8 core | **8/8 green on chromium headless** | 1 smoke partial (`test_ui_playwright.js` 3 flaky waits) | `tests/e2e/fleet.spec.ts` same as `E2E-01..08` |
| **Agents lint** | **5/5 mdspecific** | 0 | `tests/lint/agents.mjs` |
| **Overall line** (dashboard only) | **≥80 before merge** | 0 → recruit `c8` for server if needed | `npm --prefix dashboard run test:cov` |
| **P0 scenario gate** | **all P0 ids green** else block PR | listed `TASKS.md:6` | CI `test` job |

**Coverage report commands:**

```bash
npm --prefix dashboard run test:cov -- --reporter=verbose --coverage.reporter=lcov --coverage.reporter=text
# opens dashboard/coverage/index.html
bats tests/cli --formatter tap | tee coverage-cli.tap
node test_ui_playwright.js 2>&1 | tee coverage-e2e.log
```

**Badge suggestion:** Add `coverage 80%` shield in `README` via `shields.io`.

---

## 8. Traceability Matrix (case ↔ task ↔ spec)

| Spec section `PLAN-*.md` | Task IDs `TASKS.md:5` | Test IDs in this plan | Proof |
|--------------------------|-----------------------|-----------------------|-------|
| Fleet state `running/paused/complete/failed` | `C4-P1-02` | `U-C4-04..06 U-C4-07` | status→dashboardStatus  `96` |
| Token object `window/spent` `totalCost` | `C4-P4-01` | `U-C4-11..13 I-C5-08` | `totalTokens.window` vs `total` |
| Bounded `64KB/200 msgs` | `C4-P1-03` | `U-C4-24 I-C5-25 E2E-08` | `?lines=200` |
| `window vs spent` topbar `3.1k/4.2k` | `C4-P4-01` | `I-C5-14 E2E-07` | `session-stats` `278` |
| Medium windows workflowGraph+children | `C4-P4-01 C6-P2-04` | `E2E-01` grid 2col | card `flow` `PLAN-obs:55` |
| Fleet modal 5 tabs | `C6-P2-06` | `E2E-03` + `I-C5-09..11` | `Live Log\|Transcript\|Events\|Artifacts\|Session` `749` |
| Steer Tab/mode | `C5-P1-06 C6-P2-06` | `I-C5-20 E2E-04` | `supervisor-channels/*.steer.json` |
| Stop `D` | `C5-P1-06` | `I-C5-22 E2E-05` | `stop.requested` `484` |
| Herdr `H`/`Enter` → `pi --session` | `C6-P2-06` | `E2E-01` modal dockerCmd `576` | `POST /api/open-session 434` |
| Dispatch `shell vs pi` | `C5-P1-05 C6-P2-05` | `I-C5-15..18 E2E-06` | `docker exec -d` `340` + `sh -c` `398` |
| Left highlight `fleetRunId/fleetState` | `C6-P2-03` | `I-C5-09 E2E-02` | `fleetBySession 182` |
| Single source truth counts `fleet.sh = web` | `C7-P2-08` | `I-C7-01 E2E-07` | `readFleetStatus` vs `get_running_agents 57` |
| Stale 30s → failed 616s fix | `C4-P1-02 C0-P4-02` | `U-C4-07 I-C5-01` | `now - lastUpdate >30000 49` |
| Dots clamp 390k | `C1-P0-05` | requested case in `NF-03` infra | `Dockerfile:52 atlasCap` |
| Heartbeat `/tail` | `C0-P0-03` | `I-C7-02` docker logs | `tail_with_prefix 26` |
| Agent `coder/tester` contracts | `C2-P0-07` | `U-C2-01..06` | `coder.md:4 tester.md:34` |
| Workflow max 3 rounds `Test verdict` | `C3-P3-01` | `U-C3-01..05` | `runs.run workflowScript 7` |
| shortcuts `f/j/k/x/D/?/Esc` | `C6-P2-07` | `U-C6-13 E2E-12` | `keydown 463` |
| auto-update git-sync | `C8-P4-04` | `I-C7-04` + manual | `auto-update.ps1 git-sync.sh` |
| CI `docker-ci.yml` | `C9-P4-05` | `NF` + `docker inspect` | `build-and-push 42` |

---

## 9. Gaps Found During Audit (recorded as P1 tasks, now with test IDs)

| # | Gap | Tasks | Tests that will fail until fixed |
|---|-----|-------|----------------------------------|
| **G1** | `dashboard.sh:67` `grep totalTokens` fails on `{total:4200}` object — CLI shows `-` not `4.2k` | `C7-P2-08` | `U-C7-05 I-C7-04` |
| **G2** | TTL mismatch risk: backend `60s/30s` `server.js:210` vs frontend `activeOnly running\|waiting` `App.tsx:520` already double but `session-stats 275` aggregates `all` fleet not filtered — stats may include invisible done | `C5-P1-04` | `I-C5-14` |
| **G3** | `parseSessionFile` title from first `content[type:text]` `152` wrong for toolCall-heavy sessions | `C5-P*` backlog | `U-C5-01` would assert text but current passes only for pure text sessions |
| **G4** | `GET /api/fleet/:id` `44` `readFleetStatus().find` per request O(n) without index; no `Cache-Control` | `NF-02` perf | perf test `100 dirs <80ms` |
| **G5** | Modal session fetch `App.tsx:594` tries localhost fallback `127.0.0.1:3001` but prod `3000` host is container name `pi-dashboard` — fallback never hits in prod | `E2E-02` | `E2E-08` with Vite preview |
| **G6** | No `SESS` dir traversal guard `I-C5-12` listed — current code `path.join 301` not normalized + check | `NF-01` | `I-C5-12` expects fail closed |
| **G7** | `C9` dashboard image not in `docker-ci.yml` registry image — Watchtower never pulls web updates | `C9-P4-05` | manual |

---

## 10. Skeleton Test Files to Create (copy-paste starters)

```
tests/
  fixtures/
    fleet/{status-*.json, events.jsonl, output-0.log}
    sessions/{valid.jsonl, malformed.jsonl, large.jsonl}
    agents/{coder.valid.md, coder.bad.md, tester.bad.md}
  helpers/
    fleet.mjs          mkTmpFleet, seedFleet
    http.mjs           startServer(port=0) helper for integration
  unit/
    fleet.test.ts      U-C4-01..24 (Vitest, mocks fs)
    session.test.ts    U-C5-01..06
    app.test.tsx       U-C6-01..14 (render Sidebar/Topbar)
    agents.test.mjs    U-C2-01..06 (frontmatter ajv)
    workflow.test.mjs  U-C3-01..05 (mock runs)
  cli/
    cli.test.bats      U-C7-01..06 shell helpers sourcing dashboard.sh functions
  integration/
    fleet.test.mjs     I-C5-01..25 (supertest + real temp dirs)
    sessions.test.mjs  I-C5-09..14
  e2e/
    fleet.spec.ts      E2E-01..08 (Playwright Test @playwright/test)
    playwright.config.ts
  lint/
    agents.mjs         U-C2 standalone CLI for pre-commit
```

**Minimal `tests/unit/fleet.test.ts` starter (illustrative):**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('node:fs');
describe('readFleetStatus stale→failed', () => {
  it('U-C4-07 stale 35s freezes durationMs', async () => {
    const now = Date.now();
    const fake = { state:'running', startedAt: now-36000, lastUpdate: now-35000, durationMs: 36000 };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([{name:'run-1', isDirectory:()=>true} as any]);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(fake) as any);
    const { readFleetStatus } = await import('../../dashboard/server.js');
    const [f] = readFleetStatus();
    expect(f.fleetState).toBe('failed');
    expect(f.durationMs).toBe(1000);
  });
});
```

---

## 11. Execution Checklist

- [ ] `npm --prefix dashboard install -D vitest @testing-library/react jsdom msw supertest` then `tests/fixtures/*` created
- [ ] `U-C4-01..24` all green, `c8 --threshold lines 80 branches 75` passes
- [ ] `I-C5-01..25` green against real temp `SUBAGENT_RUNS` (not mocks only)
- [ ] `shellcheck dashboard.sh` clean (or `# shellcheck disable` justified per line)
- [ ] `bats tests/cli/cli.test.bats` 6/6
- [ ] `npx playwright install chromium` then `E2E-01..08` 8/8 headless `BASE_URL` both `5173` and `3000`
- [ ] Fix gaps `G1..G6` — tests `I-C7-04`, `I-C5-12`, `U-C4` variant, `E2E-08` are proof
- [ ] Add `docker-ci.yml` job `test` blocking merge
- [ ] `npm run test:cov && npm run test:e2e` single command <4m locally

---

*This plan is executable as written. Each case maps 1:1 to a falsifiable assertion on a line referenced `file:line`. Implement fixtures + helpers first, then `U-C4` (highest risk reconciler), then `I-C5` (contract), finally `E2E` (slice).*
