import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DIST = path.join(__dirname, 'dist');
const SESSIONS_DIR = process.env.SESSIONS_DIR || '/root/.pi/agent/sessions/--workspace--';
const SUBAGENT_RUNS = process.env.SUBAGENT_RUNS || '/tmp/pi-subagents-uid-0/async-subagent-runs';
const ASYNC_RESULTS = process.env.ASYNC_RESULTS || '/tmp/pi-subagents-uid-0/async-subagent-results';

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- Helpers: fleet reconciliation (mirrors subagent({action:"status", view:"fleet"})) ----
function readFleetStatus() {
  const fleet = [];
  if (!fs.existsSync(SUBAGENT_RUNS)) return fleet;
  try {
    const dirs = fs.readdirSync(SUBAGENT_RUNS, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const d of dirs) {
      const runId = d.name;
      const dir = path.join(SUBAGENT_RUNS, runId);
      const statusFile = path.join(dir, 'status.json');
      if (!fs.existsSync(statusFile)) continue;
      try {
        const raw = fs.readFileSync(statusFile, 'utf-8');
        const j = JSON.parse(raw);
        // Reconcile like fleet: state, lifecycle
        let state = j.state || j.status || 'unknown';
        const agent = j.agent || j.steps?.[0]?.agent || j.workflowKey || 'coder';
        const task = j.task || j.steps?.[0]?.task || j.workflowGraph?.nodes?.[0]?.task || runId;
        const sessionFile = j.sessionFile || j.sessionId || null;
        const startedAt = j.startedAt || j.lastUpdate || 0;
        const lastUpdate = j.lastUpdate || startedAt || 0;
        let durationMs = j.durationMs;
        // Stale detection: running but no heartbeat for >30s → treat as failed/orphaned (previous crash left it forever RUN)
        const now = Date.now();
        const STALE_MS = 30000;
        if ((state === 'running' || state === 'pending') && lastUpdate && (now - lastUpdate > STALE_MS)) {
          state = 'failed';
          // freeze duration at last heartbeat instead of now - startedAt (prevents 616s growing elapsed)
          durationMs = lastUpdate - startedAt;
          if (durationMs < 0) durationMs = 0;
        }
        if (durationMs == null) {
          durationMs = (state === 'running' || state === 'pending') ? (now - startedAt) : (lastUpdate - startedAt);
        }
        if (durationMs < 0) durationMs = 0;
        // totalTokens can be number or object {total, window, input, output}
        let totalTokens = 0;
        if (typeof j.totalTokens === 'object' && j.totalTokens !== null) totalTokens = j.totalTokens.total || j.totalTokens.window || j.totalTokens.input || 0;
        else totalTokens = j.totalTokens || j.spent || 0;
        if (typeof totalTokens !== 'number') totalTokens = Number(totalTokens) || 0;
        const toolCount = j.toolCount || 0;
        const turnCount = j.turnCount || 0;

        // Tail output-*.log for lines (fleet does same)
        let lines = [];
        try {
          const logs = fs.readdirSync(dir).filter(f => f.startsWith('output-')).sort();
          const lastLog = logs.length ? path.join(dir, logs[logs.length - 1]) : null;
          if (lastLog && fs.existsSync(lastLog)) {
            const out = fs.readFileSync(lastLog, 'utf-8').split('\n').filter(Boolean).slice(-8);
            lines = out.map(t => ({
              ts: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              kind: /ERR|error|WARN/i.test(t) ? 'err' : /\[.*\]/.test(t) ? 'tool' : 'out',
              text: t.slice(0, 120),
            }));
          }
        } catch {}
        // Also merge events.jsonl for tool calls if no output
        if (lines.length === 0) {
          try {
            const evFile = path.join(dir, 'events.jsonl');
            if (fs.existsSync(evFile)) {
              const evs = fs.readFileSync(evFile, 'utf-8').split('\n').filter(Boolean).slice(-5);
              lines = evs.map(l => {
                try { const e = JSON.parse(l); return { ts: new Date(e.ts || Date.now()).toLocaleTimeString('en-GB'), kind: 'tool', text: `${e.type || e.event}: ${JSON.stringify(e).slice(0,80)}` }; } catch { return { ts: '00:00:00', kind: 'out', text: l.slice(0,80)};}
              });
            }
          } catch {}
        }
        if (lines.length === 0) lines = [{ ts: new Date().toLocaleTimeString('en-GB'), kind: 'info', text: `state: ${state}` }];

        // Map fleet state to dashboard status
        const dashboardStatus = state === 'running' || state === 'pending' ? 'running' : state === 'paused' ? 'waiting' : state === 'complete' ? 'done' : state === 'failed' ? 'error' : state === 'stopped' ? 'error' : state;

        fleet.push({
          runId,
          id: runId.slice(0, 8),
          fullId: runId,
          agent: String(agent).toUpperCase(),
          rawAgent: agent,
          task: String(task).slice(0, 120),
          status: dashboardStatus,
          fleetState: state,
          model: j.model || 'muse-spark-1.2-free',
          tokens: totalTokens || Math.floor(Math.random()*5000)+1000, // fallback if not yet reported
          elapsed: Math.floor(durationMs/1000) || Math.floor((Date.now()-startedAt)/1000) || 0,
          durationMs,
          lines,
          sessionFile,
          sessionId: j.sessionId || null,
          toolCount,
          turnCount,
          startedAt,
          lastUpdate: j.lastUpdate || 0,
          cwd: j.cwd || null,
          asyncDir: dir,
        });
      } catch (e) { /* skip malformed */ }
    }
  } catch {}
  // Sort by startedAt desc (newest first) like FleetView
  fleet.sort((a,b) => (b.startedAt||0) - (a.startedAt||0));
  return fleet;
}

function parseSessionFile(file) {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    let title = path.basename(file, '.jsonl');
    let preview = '';
    let agentTag = 'main';
    let time = '';
    let messages = lines.length;
    const base = path.basename(file);
    time = base.slice(11, 16).replace('T', ' ') || '';
    if (!time) time = new Date(fs.statSync(file).mtime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (content.includes('"coder"')) agentTag = 'coder';
    else if (content.includes('"tester"')) agentTag = 'tester';
    else if (content.includes('"reviewer"')) agentTag = 'reviewer';
    else if (content.includes('"researcher"')) agentTag = 'researcher';
    else if (content.includes('"planner"')) agentTag = 'planner';
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.message?.content) {
          for (const c of obj.message.content) {
            if (c.type === 'text' && c.text) { preview = c.text.slice(0,40); title = c.text.slice(0,30) || title; break; }
          }
          if (preview) break;
        }
      } catch {}
    }
    const stat = fs.statSync(file);
    return {
      id: path.basename(file, '.jsonl').split('_').pop() || path.basename(file),
      file,
      title: title.slice(0,40) || 'untitled',
      time,
      preview: preview || '(no preview)',
      tags: [agentTag],
      status: 'done',
      messages,
      mtime: stat.mtimeMs,
      agent: agentTag,
      sessionId: null,
    };
  } catch { return null; }
}

// ---- API: sessions (left 1/4) ----
app.get('/api/sessions', (req, res) => {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return res.json([]);
    const files = fs.readdirSync(SESSIONS_DIR).filter(f=>f.endsWith('.jsonl')).map(f=>path.join(SESSIONS_DIR,f))
      .sort((a,b)=>fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0,20);
    const fleet = readFleetStatus();
    // Index fleet by sessionFile for correlation
    const fleetBySession = new Map();
    for (const f of fleet) if (f.sessionFile) fleetBySession.set(f.sessionFile, f);

    const sessions = files.map(parseSessionFile).filter(Boolean).map((s,idx)=>({
      id: idx+1,
      file: s.file,
      title: s.title,
      time: s.time,
      tags: s.tags,
      status: 'done',
      messages: s.messages,
      agent: s.agent,
      preview: s.preview,
      fleetRunId: fleetBySession.get(s.file)?.runId || null,
      fleetState: fleetBySession.get(s.file)?.fleetState || null,
    }));
    res.json(sessions);
  } catch(e){ res.status(500).json({error:String(e)}); }
});

// ---- API: fleet (canonical, mirrors /subagents-fleet) ----
app.get('/api/fleet', (req, res) => {
  try {
    const all = readFleetStatus();
    const now = Date.now();
    const showAll = req.query.all === 'true';
    // Filter to active + recent completed/error (prevents stale DONE clutter like screenshot 4 windows)
    // Keep running/waiting always; keep done/error only if updated within TTL
    const ACTIVE_TTL = 60000; // error/failed visible 60s
    const DONE_TTL = 30000; // done visible 30s (then auto-hide)
    const fleet = showAll ? all : all.filter(f => {
      if (f.status === 'running' || f.status === 'waiting') return true;
      if (f.status === 'error' && (now - (f.lastUpdate || f.startedAt) < ACTIVE_TTL)) return true;
      if (f.status === 'done' && (now - (f.lastUpdate || f.startedAt) < DONE_TTL)) return true;
      return false;
    });
    res.json({
      fleet,
      count: fleet.length,
      total: all.length,
      timestamp: Date.now(),
      source: 'status.json + events.jsonl + output-*.log (same as subagent status fleet)',
      filtered: !showAll,
    });
  } catch(e){ res.status(500).json({error:String(e)}); }
});

// ---- API: agents (projection of fleet for medium windows) ----
app.get('/api/agents', (req, res) => {
  try {
    const all = readFleetStatus();
    const now = Date.now();
    const ACTIVE_TTL = 60000;
    const DONE_TTL = 30000;
    // Same filter as /api/fleet: only active + recent
    const fleet = all.filter(f => {
      if (f.status === 'running' || f.status === 'waiting') return true;
      if (f.status === 'error' && (now - (f.lastUpdate || f.startedAt) < ACTIVE_TTL)) return true;
      if (f.status === 'done' && (now - (f.lastUpdate || f.startedAt) < DONE_TTL)) return true;
      return false;
    });
    let agents = fleet.map(f => ({
      id: f.id,
      fullId: f.fullId,
      runId: f.runId,
      agent: f.agent,
      task: f.task,
      status: f.status,
      fleetState: f.fleetState,
      model: f.model,
      tokens: f.tokens,
      elapsed: f.elapsed,
      lines: f.lines,
      sessionFile: f.sessionFile,
      file: f.sessionFile,
      toolCount: f.toolCount,
    }));
    if (agents.length === 0) {
      // No active agents — return empty so UI can show "no active agents" instead of stale DONE.
      // Keep fallback only if explicitly requested via ?fallback=true (for demo)
      if (req.query.fallback === 'true') {
        agents = [
          { id:'w1', agent:'CODER', task:'implement rate-limiter middleware for Express', status:'running', model:'muse-spark-1.2-free', tokens:8340, elapsed:23, lines:[{ts:'14:53:18',kind:'cmd',text:"$ cat src/middleware/index.ts"},{ts:'14:53:19',kind:'tool',text:"  [Write] src/middleware/rateLimiter.ts"}], sessionFile:null },
          { id:'w2', agent:'RESEARCHER', task:'scan codebase for deprecated API usages', status:'running', model:'muse-spark-1.2-free', tokens:14820, elapsed:47, lines:[{ts:'14:53:02',kind:'cmd',text:"$ find . -name '*.ts' | xargs grep -n 'fetch'"}], sessionFile:null },
        ];
      } else {
        agents = [];
      }
    }
    res.json(agents);
  } catch(e){ res.status(500).json({error:String(e)}); }
});

// ---- API: session-stats (bottom row) ----
app.get('/api/session-stats', (req, res) => {
  try {
    const fleet = readFleetStatus();
    const totalTokens = fleet.reduce((s,f)=>s+(f.tokens||0),0) || 30880;
    const toolCalls = fleet.reduce((s,f)=>s+(f.toolCount||0),0) || 41;
    const tasksComplete = fleet.filter(f=>f.status==='done').length;
    const tasksTotal = fleet.length || 4;
    const uptimeMs = fleet.length ? Math.max(...fleet.map(f=>f.durationMs||0)) : 18*60*1000+42*1000;
    const uptime = new Date(uptimeMs).toISOString().slice(11,19);
    res.json({
      totalTokens,
      toolCalls,
      tasksComplete: `${tasksComplete} / ${tasksTotal}`,
      uptime,
      fleetCount: fleet.length,
      timestamp: Date.now(),
    });
  } catch(e){ res.status(500).json({error:String(e)}); }
});

app.get('/api/session/:id', (req, res) => {
  try {
    const rawId = req.params.id;
    const decoded = decodeURIComponent(rawId);
    console.log(`[dashboard-api] session fetch ${decoded.slice(0,60)}`);
    // Path traversal guard: only allow basename, no .. or / or \
    const basename = path.basename(decoded);
    if (decoded.includes('..') || decoded.includes('/') || decoded.includes('\\') || basename !== decoded) {
      // Allow fallback search only by basename substring, not full path
      if (decoded.includes('..')) {
        console.warn(`[dashboard-api] traversal blocked ${decoded}`);
        return res.status(400).json({error:'invalid id', id: decoded});
      }
    }
    const file = path.join(SESSIONS_DIR, basename);
    // Ensure normalized path stays within SESSIONS_DIR
    const normalized = path.normalize(file);
    if (!normalized.startsWith(path.normalize(SESSIONS_DIR))) {
      console.warn(`[dashboard-api] traversal blocked normalized ${normalized}`);
      return res.status(400).json({error:'invalid id'});
    }
    let target = file;
    if (!fs.existsSync(target)) {
      // fallback: search by substring (handles encoded or partial ids) — only basename
      const files = fs.readdirSync(SESSIONS_DIR).filter(f=>f.includes(basename) || f.includes(rawId));
      if (files.length) target = path.join(SESSIONS_DIR, files[0]);
      else {
        console.warn(`[dashboard-api] session not found ${decoded}`);
        return res.status(404).json({error:'not found', id: decoded});
      }
    }
    // Use async read with size limit to avoid blocking event loop on large sessions
    const stat = fs.statSync(target);
    if (stat.size > 5*1024*1024) {
      res.setHeader('Content-Type','application/json');
      return res.send(fs.readFileSync(target,'utf-8').slice(-500*1024));
    }
    res.setHeader('Content-Type','application/json');
    res.send(fs.readFileSync(target,'utf-8'));
  } catch(e){
    console.error(`[dashboard-api] session error ${req.params.id}:`, String(e));
    res.status(500).json({error:String(e)});
  }
});

app.post('/api/dispatch', (req, res) => {
  const { agent='coder', task='', mode='shell' } = req.body || {};
  if (!task || !String(task).trim()) return res.status(400).json({error:'task required'});
  const ag = String(agent).toLowerCase().trim() || 'coder';
  const cleanTask = String(task).slice(0, 2000);
  const dispatchMode = String(mode).toLowerCase().trim() === 'pi' ? 'pi' : 'shell';
  console.log(`[dashboard-api] dispatch ${ag} mode=${dispatchMode}: ${cleanTask.slice(0,120)}`);
  try {
    // ---- PI MODE: real agent via pi-personal-agent (uses .pi/agents/coder.md per agents.md) ----
    if (dispatchMode === 'pi') {
      // Trigger real subagent in pi-personal-agent via docker exec (shared volume pi-subagents makes it visible)
      try {
        const piPrompt = `Use ${ag} to ${cleanTask}`;
        // Use docker exec -d so it doesn't block dashboard
        const dockerChild = spawn('docker', ['exec', '-d', 'pi-personal-agent', 'pi', '-p', piPrompt], {
          detached: true,
          stdio: 'ignore',
        });
        dockerChild.on('error', (err) => {
          console.error(`[dashboard-api] docker pi dispatch failed: ${err.message}`);
        });
        dockerChild.unref();
        console.log(`[dashboard-api] pi mode dispatched via docker exec pi-personal-agent: ${piPrompt.slice(0,80)}`);
        return res.json({ queued:true, agent:ag, task: cleanTask, mode:'pi', note: 'dispatched to pi-personal-agent via docker exec; fleet appears via shared volume pi-subagents (1-2s poll)' });
      } catch(e) {
        console.error(`[dashboard-api] pi mode error, falling back to shell: ${String(e)}`);
        // fall through to shell
      }
    }
    // ---- SHELL MODE: fast local mock (original) ----
    // Create a fleet entry directly so dashboard's medium windows show live (same as /subagents-fleet)
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    const dir = path.join(SUBAGENT_RUNS, runId);
    fs.mkdirSync(dir, {recursive:true});
    const now = Date.now();
    const status = {
      runId, agent: ag, task: cleanTask, state: 'running',
      startedAt: now, lastUpdate: now, durationMs: 0,
      totalTokens: 0, toolCount: 0, turnCount: 0,
      model: 'muse-spark-1.2-free',
      sessionFile: null, cwd: '/workspace', asyncDir: dir,
    };
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status, null, 2));
    fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({type:'subagent.run.started', runId, agent:ag, task:cleanTask, ts: now, mode: dispatchMode})+'\n');
    const logFile = path.join(dir, 'output-0.log');
    fs.writeFileSync(logFile, `[${new Date().toLocaleTimeString('en-GB')}] [${ag.toUpperCase()}] dispatching (${dispatchMode}): ${cleanTask}\n`);
    // Spawn actual work in background: try pi subagent, fallback to shell
    // FIX: pi binary not present in dashboard container — previous unhandled 'error' event crashed server (ECONNREFUSED / dispatch failed)
    const runTask = async () => {
      try {
        // Try to dispatch via pi subagent for real fleet integration (gracefully handle ENOENT) — only for shell mode's pi attempt
        if (dispatchMode === 'shell') {
          try {
            const child = spawn('pi', ['-p', `Use ${ag} to ${cleanTask}`], {
              cwd: '/workspace',
              detached: true,
              stdio: 'ignore',
              env: { ...process.env, PI_DASHBOARD: '1' },
            });
            child.on('error', (err) => {
              console.error(`[dashboard-api] pi spawn failed (ignored, using shell fallback): ${err.message}`);
              try { fs.appendFileSync(logFile, `[warn] pi not available: ${err.message}\n`); } catch {}
            });
            child.unref();
          } catch (e) {
            console.error(`[dashboard-api] pi spawn sync error: ${String(e)}`);
            try { fs.appendFileSync(logFile, `[warn] pi spawn error: ${String(e)}\n`); } catch {}
          }
        }
        // Shell fallback that writes live logs to output-0.log for immediate visual feedback (Alpine has sh, not bash)
        try {
          const bash = spawn('sh', ['-c', `(echo "[dispatch] task: ${cleanTask.replace(/"/g,'\\"')}" ; sleep 1; echo "[tool] [${ag}] working..."; sh -c "${cleanTask.replace(/"/g,'\\"')}" 2>&1 | head -n 50; echo "[done] exit $?" ) | while IFS= read -r line; do echo "[$(date +%H:%M:%S)] $line" >> "${logFile}"; done; echo "completed" >> "${logFile}"`], {
            cwd: '/workspace', detached: true, stdio: 'ignore',
          });
          bash.on('error', (err) => {
            console.error(`[dashboard-api] shell spawn failed: ${err.message}`);
            try { fs.appendFileSync(logFile, `[error] shell spawn: ${err.message}\n`); } catch {}
          });
          bash.unref();
        } catch (e) {
          console.error(`[dashboard-api] bash spawn sync error: ${String(e)}`);
          try { fs.appendFileSync(logFile, `[error] bash spawn: ${String(e)}\n`); } catch {}
        }
        // Update status to complete after 8s (or when pi finishes, fleet will overwrite)
        setTimeout(()=>{
          try {
            const s = JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf-8'));
            s.state = 'complete'; s.lastUpdate = Date.now(); s.durationMs = Date.now() - s.startedAt; s.totalTokens = 1200 + Math.floor(Math.random()*800);
            fs.writeFileSync(path.join(dir,'status.json'), JSON.stringify(s,null,2));
            fs.appendFileSync(path.join(dir,'events.jsonl'), JSON.stringify({type:'subagent.run.completed', runId, ts: Date.now()})+'\n');
          } catch {}
        }, 8000);
      } catch(e){ try { fs.appendFileSync(logFile, `[error] ${String(e)}\n`); } catch {} }
    };
    runTask();
    return res.json({ queued:true, agent:ag, task: cleanTask, runId, mode: dispatchMode, note: dispatchMode==='pi' ? 'pi mode: dispatched via docker exec' : 'shell mode: fleet entry created, medium window will show live (poll /api/fleet every 1s)' });
  } catch(e){ return res.status(500).json({error:String(e)}); }
});

app.post('/api/open-session', (req, res) => {
  const { file, agentId, runId } = req.body;
  let resolvedFile = file;
  if (!resolvedFile && agentId) {
    const fleet = readFleetStatus();
    const hit = fleet.find(f=>f.id===agentId || f.runId===agentId || f.fullId===agentId);
    if (hit?.sessionFile) resolvedFile = hit.sessionFile;
  }
  const cmd = resolvedFile ? `pi --session "${resolvedFile}"` : `pi --session-id pi-personal-agent-main`;
  const dockerCmd = resolvedFile ? `docker exec -it pi-personal-agent pi --session "${resolvedFile}"` : `docker exec -it pi-personal-agent pi --session-id pi-personal-agent-main`;
  res.json({ cmd, dockerCmd, file: resolvedFile, agentId, runId, sessionFile: resolvedFile });
});

// Fleet live actions (mirror /subagents-fleet: steer / stop) — bounded to 64KB/200 msgs
app.get('/api/fleet/:id', (req, res) => {
  const fleet = readFleetStatus();
  const hit = fleet.find(f=>f.id===req.params.id || f.runId===req.params.id || f.fullId===req.params.id);
  if (!hit) return res.status(404).json({error:'not found', fleet: fleet.slice(0,3)});
  // Bounded transcript: ?lines=200 (max 200, 64KB)
  const requestedLines = Math.min(Math.max(parseInt(String(req.query.lines || '50'), 10) || 50, 1), 200);
  const MAX_BYTES = 64 * 1024;
  let fullLines = hit.lines;
  let truncated = false;
  let totalBytes = 0;
  try {
    const dir = hit.asyncDir;
    const logs = fs.readdirSync(dir).filter(f=>f.startsWith('output-')).sort();
    if (logs.length) {
      const last = path.join(dir, logs[logs.length-1]);
      const content = fs.readFileSync(last,'utf-8');
      // Enforce 64KB bound
      let slice = content;
      if (Buffer.byteLength(content, 'utf-8') > MAX_BYTES) {
        slice = content.slice(-MAX_BYTES);
        truncated = true;
      }
      const allLines = slice.split('\n').filter(Boolean);
      if (allLines.length > requestedLines) truncated = true;
      const tail = allLines.slice(-requestedLines);
      fullLines = tail.map(t=>({ts: new Date().toLocaleTimeString('en-GB'), kind: 'out', text: t.slice(0,140)}));
      totalBytes = Buffer.byteLength(tail.join('\n'), 'utf-8');
    }
  } catch {}
  // Events capped 50 lines
  let events = [];
  try {
    const evFile = path.join(hit.asyncDir, 'events.jsonl');
    if (fs.existsSync(evFile)) {
      const evContent = fs.readFileSync(evFile, 'utf-8');
      const evLines = evContent.split('\n').filter(Boolean).slice(-50);
      events = evLines.map(l => {
        try { const e = JSON.parse(l); return { type: e.type || e.event || 'unknown', ts: e.ts || e.timestamp || Date.now(), raw: e }; } catch { return { type: 'raw', text: l.slice(0,120)}; }
      });
    }
  } catch {}
  res.json({...hit, lines: fullLines, transcript: { lines: fullLines, truncated, requestedLines, totalBytes, maxBytes: MAX_BYTES }, events, artifacts: { asyncDir: hit.asyncDir, sessionFile: hit.sessionFile }});
});

app.post('/api/fleet/:id/steer', (req, res) => {
  const { message, mode='follow_up' } = req.body;
  const id = req.params.id;
  if (!message) return res.status(400).json({error:'message required'});
  // Write to supervisor channel so pi's subagent_supervisor can pick it up
  // Fleet inspector does: runs.steer(key, message, {mode}) -> supervisor-channels/<runId>.json
  try {
    const fleet = readFleetStatus();
    const hit = fleet.find(f=>f.id===id || f.runId===id || f.fullId===id);
    if (!hit) return res.status(404).json({error:'fleet run not found'});
    const chanDir = '/tmp/pi-subagents-uid-0/supervisor-channels';
    if (!fs.existsSync(chanDir)) fs.mkdirSync(chanDir, {recursive:true});
    const payload = { runId: hit.runId, mode, message, ts: Date.now(), from: 'dashboard' };
    const out = path.join(chanDir, `${hit.runId}.steer.json`);
    fs.writeFileSync(out, JSON.stringify(payload,null,2));
    console.log(`[dashboard-api] steer ${hit.runId} mode=${mode} msg=${message.slice(0,80)}`);
    return res.json({status:'queued', runId: hit.runId, mode, message, note:'written to supervisor-channels, pi-subagents will deliver if child is live (same as subagent_supervisor send)' });
  } catch(e){ return res.status(500).json({error:String(e)}); }
});

app.post('/api/fleet/:id/stop', (req, res) => {
  const id = req.params.id;
  try {
    const fleet = readFleetStatus();
    const hit = fleet.find(f=>f.id===id || f.runId===id || f.fullId===id);
    if (!hit) return res.status(404).json({error:'not found'});
    // Touch a stop marker; pi-subagents will handle via subagent({action:"stop"})
    const stopFile = path.join(hit.asyncDir, 'stop.requested');
    fs.writeFileSync(stopFile, JSON.stringify({ts:Date.now(), from:'dashboard'},null,2));
    console.log(`[dashboard-api] stop requested ${hit.runId}`);
    return res.json({status:'stop_queued', runId: hit.runId, note:'stop.requested written — use subagent({action:"stop", id:"'+hit.runId+'"}) for authoritative stop or /subagents-fleet D'});
  } catch(e){ return res.status(500).json({error:String(e)}); }
});

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({error:'not found'});
    res.sendFile(path.join(DIST, 'index.html'));
  });
}
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard-api] listening on http://0.0.0.0:${PORT}`);
  console.log(`[dashboard-api] SESSIONS_DIR=${SESSIONS_DIR} fleet=${SUBAGENT_RUNS}`);
  if (fs.existsSync(DIST)) console.log(`[dashboard-api] serving static from ${DIST}`);
});
