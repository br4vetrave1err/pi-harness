# Required E2E Test Cases — Frontend Dashboard (Workflows / UI / Agents)

**Source:** `TASKS.md` Phase 2 (`C6-P2-*`, `C7-P2-08`) + Phase 3 (`C3-P3-*`) + `TEST_COVERAGE_PLAN.md` §5 (existing 12). This file expands to every user-accessible workflow/UI/agent via the dashboard at `http://localhost:3000` / `5173`.  
**Status:** `EXISTING` = already in `tests/e2e/fleet.spec.mjs` or `test_ui_playwright.js`; `TODO` = required, not yet implemented.  
**Run:** `npx playwright test tests/e2e --project=chromium` (or `node test_ui_playwright.js` for smoke).

---

## 1. Gap Analysis (current vs required)

| Category | Required | Existing | Missing |
|----------|----------|----------|---------|
| **UI** Topbar/Sidebar/Windows/InputBar/Modal/Help | 18 | 5 (`E2E-01,02,03,07,12` partial) | 13 |
| **Agents** via dashboard dispatch | 10 | 2 (`E2E-06` shell+pi) | 8 |
| **Workflows** via dashboard | 10 | 1 (`E2E-01` tracer) | 9 |
| **Total** | **38** | **8** | **30** |

Existing files:
- `tests/e2e/fleet.spec.mjs` 4 tests (`E2E-01` dispatch, `E2E-02` session, `E2E-04` steer, `E2E-03` modal)
- `test_ui_playwright.js` smoke 1 test (partial `E2E-01,07` but flaky `waitForTimeout`, clicks `ALL` not session, no `f`/`?`/`x` checks)
- No dedicated agent-chip or workflow-round tests.

---

## 2. Required E2E Matrix

### 2.1 UI — Topbar / Sidebar / Windows / InputBar / Modal / Help

| ID | Category | User story | Steps (Playwright) | Expected | Priority | Status | Trace |
|----|----------|------------|--------------------|----------|----------|--------|-------|
| **E2E-UI-01** | Topbar | User sees live counts | `goto /` wait `span:text("active agents")`; `GET /api/fleet` vs Topbar `running/waiting/done` props `App.tsx:303` | Topbar `running` == `windows.filter running` ±1, time ticks `en-GB` every 1s `458` | P1 | TODO | `C6-P2-02` |
| **E2E-UI-02** | Topbar | `active agents` vs `○ idle` | `GET /api/fleet` empty → check `○ idle`; dispatch `sleep 2` → `● agents active` green `232` | Text flips within 1s of poll | P1 | TODO | `C6-P2-04` |
| **E2E-UI-03** | Sidebar | Filter chips `ALL/CODER/TESTER/…` | Click `ALL` → all `26` buttons; click `CODER` → filtered count `page.$$('div.w-1/4 button')` where title contains `[coder]` | `Sidebar:212` filter works, active chip `bg-[#39ff6e]` | P1 | TODO | `C6-P2-03` |
| **E2E-UI-04** | Sidebar | Empty sessions | Seed `SESSIONS_DIR` empty (temp dir via `SUBAGENT_RUNS` mock) → `GET /api/sessions` `[]` → check `no sessions` `251` | Shows `no sessions` not skeleton | P2 | TODO | `C6-P2-03` |
| **E2E-UI-05** | Sidebar | Skeleton `conversations===null` | `page.route('**/api/sessions', r=> delay 2s)` → check 4 gray bars `243` before `FALLBACK` | No `FALLBACK_CONVERSATIONS` flash `445` | P1 | TODO | `C6-P2-03` |
| **E2E-UI-06** | Sidebar | Click session with `fleetRunId` opens fleet modal, without opens `__session_` | `GET /api/sessions` pick one with `fleetRunId!=null` and one `null`; click each → check `modalWin.id` starts `__session_` vs `runId` `572` | Same `runId` as `subagent status fleet` `182` | P0 | **EXISTING** `E2E-02` partial | `C6-P2-03` |
| **E2E-UI-07** | Windows | `No active agents` vs `Loading fleet…` | Fresh `GET /api/fleet` empty → `No active agents — dispatch… 659`; first load `fleetLoaded false` → `Loading fleet…` | Not both | P1 | TODO | `C6-P2-04` |
| **E2E-UI-08** | Windows | `running` amber vs `done` grey vs `error` red border | Dispatch `sleep 20` → card `isActive` border `AGENT_COLORS[agent]` `132` `running` pulse `StatusDot 54`; wait 35s → `done` hidden without `?all` | Card color matches `isActive` `132` | P0 | **EXISTING** `E2E-01` partial | `C6-P2-04` |
| **E2E-UI-09** | Windows | `workflowGraph flow + children` indented | Seed `status.json` with `children:[{agent:researcher}]` + `workflowGraph:{flow:"scout→worker"}` → check card shows `+1c` and `flow` `C4-P4-01` | Children `ml-3 pl-2 border-l` `C4-P4-01` | P1 | TODO | `C4-P4-01` |
| **E2E-UI-10** | Windows | Tokens `k tok` `1.2k` and `elapsed` increments | Record `elapsed` `154`, wait `3000`, re-read → `≈+3` | `toFixed(1)k` `154` | P1 | TODO | `C6-P2-04` |
| **E2E-UI-11** | InputBar | `SHELL|PI` toggle color `405` + agent chips `RESEARCHER default 356` + `↵ send (mode)` `433` | Click `SHELL` → `bg-[#39ff6e]`; click `PI` → `bg-[#4da6ff]`; select `coder` chip → `bg-[#c084fc]` | Toggle works, disabled `sending 376` | P0 | **EXISTING** `E2E-06` partial | `C6-P2-05` |
| **E2E-UI-12** | InputBar | Optimistic `tempId` appears `50ms` then fleet replaces `1-3s` | Type `echo e2e/inputbar` `POST /api/dispatch shell` mock; check `page.$$ eval windows.length` immediate +1; after poll `runId` replaces `tmp-` | No duplicate `tempId` after `3000` GC `714` | P0 | **EXISTING** `E2E-01` partial | `C6-P2-05` |
| **E2E-UI-13** | InputBar | Empty task does not dispatch | `Enter` with empty → `fetch` not called `384` | `windows.length` unchanged | P1 | TODO | `C6-P2-05` |
| **E2E-UI-14** | Modal | 5 tabs `log|transcript|events|artifacts|session` `749` cycle without crash | `click first card 567` → `waitForSelector div.fixed.inset-0`; click each tab; check `uppercase` heading visible | No `PAGE ERROR` `20` | P0 | **EXISTING** `E2E-03` | `C6-P2-06` |
| **E2E-UI-15** | Modal | `Live Log ● live` + toolDetails toggle `x` hides `kind=tool` `764` | In `log` tab, check `● live` `762`; press `x` → `tool` lines hidden | `showToolDetails` `749` | P1 | TODO | `C6-P2-06` |
| **E2E-UI-16** | Modal | `Session` tab full `status.json` fields `window/spent/totalCost/lifecycle/mode/children` `C4-P4-01` | In `session` tab, check `runId`, `window/spent`, `totalCost $`, `lifecycleArtifactVersion`, `children` indented | All fields from `TEST_COVERAGE_PLAN:18` present | P1 | TODO | `C4-P4-01` |
| **E2E-UI-17** | Modal | Copy `pi-vCLI H` copies `docker exec -it pi-personal-agent pi --session …` `829` | Click `Copy pi-vCLI H` → `navigator.clipboard.readText()` contains `pi --session` `576` | `modalDockerCmd 576` | P1 | TODO | `C6-P2-06` |
| **E2E-UI-18** | Help | `?` help modal `44` `f/j/k/x/D/H/Enter/Esc/?` | Press `?` → `div.bg-black/70` visible `900` grid 2 cols; `Esc` closes | `showHelp 44` | P2 | **EXISTING** `E2E-12` partial | `C6-P2-07` |
| **E2E-UI-19** | Responsive | `xl:grid-cols-2` 2 windows side-by-side `671` | Dispatch 2 `shell` `sleep 10` → `windows.length 2` → `getBoundingClientRect` of 2 cards `x` diff >100 | `671` | P2 | TODO | `C6-P2-04` |
| **E2E-UI-20** | Error | `waiting for logs…` only for fleet, not `__session_` | Create `status.json` without `output-0.log` nor `events.jsonl` → modal `log` shows `waiting for logs… 93` for fleet, but `__session_` shows `loading session` `51` | Correct fallback | P1 | TODO | `C4-P1-02` |

### 2.2 Agents — via dashboard dispatch (user picks chip + task + mode)

| ID | Category | User story | Steps | Expected | Priority | Status | Trace |
|----|----------|------------|-------|----------|----------|--------|-------|
| **E2E-AG-01** | Agent | Dispatch `coder` shell `echo coder via ui` | Select chip `coder`, `task=echo coder via ui`, `mode=shell`, `Enter` → `GET /api/fleet` `agent CODER` `mode shell` | Card `[CODER]` green border `AGENT_COLORS` | P0 | **EXISTING** `E2E-01` | `C2-P0-06` |
| **E2E-AG-02** | Agent | Dispatch `tester` shell ` Tester must read git diff` | Select `tester`, `mode=shell`, `task=tester task` → fleet `TESTER` | `tester` leaf: no `default.subagent` `tester.md:34` — not spawned recursively | P1 | TODO | `C2-P0-07` |
| **E2E-AG-03** | Agent | Dispatch `researcher` via `pi` mode (needs `pi-web-access`) | Select `researcher`, `mode=pi`, `task=research SDLC` → wait `GET /api/fleet` `RESEARCHER` `totalCost` object | `pi list` shows `pi-web-access` `C1-P0-04` | P1 | TODO | `C1-P0-04` |
| **E2E-AG-04** | Agent | `coder` delegates to `reviewer` (subagent) visible as `children` | Task that triggers `default.subagent reviewer` (e.g., `Use coder to implement X and delegate review`) → check card `+1c` and `children[0].agent reviewer` indented | `children` `C4-P4-01` | P1 | TODO | `C2-P0-06` |
| **E2E-AG-05** | Agent | `tester` leaves `Test verdict: PASS/FAIL` | After `coder` `sleep 2 && echo hello`, dispatch `tester` `mode=shell` with `tester` prompt → check `output-0.log` contains `Test verdict:` `tester.md:37` | `PASS` or `FAIL` present | P0 | TODO | `C2-P0-07` |
| **E2E-AG-06** | Agent | Invalid agent name falls back | `POST /api/dispatch {"agent":"unknown","task":"hi"}` via `fetch` from `page.evaluate` → check `agent` defaults `coder` `server.js:340` | No 500 | P2 | TODO | `C5-P1-05` |
| **E2E-AG-07** | Agent | `feynman` via `coder` `bash feynman search` | Dispatch `coder` `mode=shell` `task=feynman search "SDLC" --max-results 2` → check `output-0.log` `feynman` | `feynman --version 0.3.47` `C1-P0-04` | P2 | TODO | `C1-P0-04` |
| **E2E-AG-08** | Agent | `pi-freeflow` model `dots-studio/dots-3-note-preview:free` `390K` | Check card `model` `muse-spark-1.2-free` and `GET /api/fleet?all=true` `modelAttempts[0].model` `freeflow/muse-spark...:xhigh` `C1-P0-05` | `maxTokens 390K` `proxy clamp` | P1 | TODO | `C1-P0-05` |
| **E2E-AG-09** | Agent | Switch agent without losing input | Type `task=hello`, switch chip `coder→tester` → `input` value preserved `384` | `val` not cleared on chip switch | P2 | TODO | `C6-P2-05` |
| **E2E-AG-10** | Agent | `web_search` tool via `coder` | Dispatch `coder` `task=Use web_search to find pi docs` → check `output-0.log` `web_search` | `pi-web-access` present | P2 | TODO | `C1-P0-04` |

### 2.3 Workflows — via dashboard (the only way user can trigger them)

| ID | Category | User story | Steps | Expected | Priority | Status | Trace |
|----|----------|------------|-------|----------|----------|--------|-------|
| **E2E-WF-01** | Workflow | `coder-1` implements, `tester-1` PASS `1 round` | `POST /api/dispatch {agent:coders, task:"Add hello.txt", mode:shell}` with `workflowScript`? Or via UI: select `coder` `task=Implement hello.txt and commit` → after `coder-1` `git log --oneline -1` new commit, then `tester-1` `Test verdict: PASS` → `rounds 1 final PASS` `workflows/coder-tester-loop.js:41` | `rounds 1` | P0 | TODO | `C3-P3-01` |
| **E2E-WF-02** | Workflow | `tester-1 FAIL` → `coder-2 fix` → `tester-2 PASS` `2 rounds` | Seed repo with failing file, run workflow, mock `tester1.output includes FAIL` → trigger `coder-2` → `tester2 PASS` | `rounds 2` `coderOutputs 2` | P0 | TODO | `C3-P3-01` |
| **E2E-WF-03** | Workflow | `FAIL FAIL` → `3 rounds` | Mock `tester2 FAIL` → `coder-3` → `tester3` `rounds 3` | `rounds 3` | P1 | TODO | `C3-P3-01` |
| **E2E-WF-04** | Workflow | `PASS with notes` stops early (like `PASS`) | Mock `tester1 output PASS with notes` → no `coder-2` | `rounds 1` not `2` `hasFail()` `9` | P1 | TODO | `C3-P3-02` |
| **E2E-WF-05** | Workflow | Prompt `/prompt-workflow coder-tester-loop your task` mirrors JS | `page.evaluate(()=> fetch('/api/dispatch',{method:'POST',body:JSON.stringify({agent:'coder',task:'prompt-workflow test',mode:'pi'})}))` → check fleet sequence `coder→tester` | Same as `E2E-WF-01` | P1 | **EXISTING** `test_ui_playwright` not | `C3-P3-02` |
| **E2E-WF-06** | Workflow | Artifacts `subagent-artifacts/outputs/<runId>/output.md` | After workflow, `docker exec pi-personal-agent ls /root/.pi/agent/sessions/--workspace--/subagent-artifacts/outputs/*/output.md` | File exists `C3-P3-04` | P1 | TODO | `C3-P3-04` |
| **E2E-WF-07** | Workflow | `git commit` with detailed comments | After `coder-1`, `git log --oneline -1` contains `feat:` and `coder.md:8` | Commit present | P1 | TODO | `C3-P3-04` |
| **E2E-WF-08** | Workflow | `tester` uses `git diff HEAD~1` not coder summary | Check `tester` `output-0.log` contains `git diff HEAD~1` `tester.md:32` | `git diff` present | P1 | TODO | `C3-P3-04` |
| **E2E-WF-09** | Workflow | `workflowScriptPath` `async:true` unblocks main chat | `subagent({workflowScriptPath:..., async:true})` → `page` still interactive, `fleet` shows `coder-1 running` within 2s | `async:true` `workflows/coder-tester-loop.js:3` | P1 | TODO | `C3-P3-01` |
| **E2E-WF-10** | Workflow | `subagentOnlyExtensions` leaf `tester` cannot spawn subagents | Dispatch `tester` that tries `default.subagent` → check `modelAttempts error` `default.subagent` unavailable `tester.md:54` | Error `requested unavailable child tools` | P1 | TODO | `C2-P0-07` |

---

## 3. Implementation Plan (Playwright helpers)

```
tests/e2e/
  helpers.ts          goto(url), dispatch(agent,task,mode), waitForFleet(runId, state, 15s), openModal(runId), steer(msg,mode), stop(), expectLogContains(text), getSessionFile(runId)
  fleet.spec.ts       E2E-UI-14, E2E-AG-01..03
  workflows.spec.ts   E2E-WF-01..04 (mock runs.run via page.route or real pi with 60s timeout)
  agents.spec.ts      E2E-AG-04..08
  ui.spec.ts          E2E-UI-01..20

playwright.config.ts  webServer: {command: 'npm --prefix dashboard run preview', port:4173} reuseExistingServer: true
```

**Selectors (stable):**
- `Topbar` `span:text("active agents")` `634`
- `Sidebar` `button:has-text("ALL")` `212` + `div.w-1/4 button` for sessions
- `AgentWindowCard` `div:has-text("▣")` `124` + `StatusDot` `running`
- `InputBar` `input[placeholder="Ask Codex …"]` `353` + `button:has-text("SHELL")` `405`
- `Modal` `div.fixed.inset-0` `731` + `button:has-text("log")` `749`

**Data seeding (no LLM cost for most UI tests):**
- Use `mode:shell` `sleep 2 && echo …` for `E2E-UI-*` and `E2E-AG-01,02` — no LLM.
- For `E2E-WF-*` and `E2E-AG-03,04` with real LLM, tag `@llm` and run nightly, not per-PR, with `test.skip` unless `LLM=1`.

---

## 4. Priority & Gate

| Priority | IDs | Gate |
|----------|-----|------|
| **P0** (blocks tracer) | `E2E-UI-06,08,11,12,14` `E2E-AG-01,05` `E2E-WF-01,02` | Must pass for `main` merge |
| P1 (parity) | `E2E-UI-01,03,05,09,10,15,16,20` `E2E-AG-02,03,04,08` `E2E-WF-03,04,06,07,08,09` | Must pass before `v1.0` |
| P2 (polish) | `E2E-UI-04,18,19` `E2E-AG-06,07,09,10` `E2E-WF-05,10` | Nightly |

Next step: implement `tests/e2e/ui.spec.ts` `E2E-UI-01..20` first (no LLM), then `agents.spec.ts`, then `workflows.spec.ts` with mocked `runs.run` for fast CI.
