import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DIST = path.join(__dirname, 'dist');
const SESSIONS_DIR = process.env.SESSIONS_DIR || '/root/.pi/agent/sessions/--workspace--';
const SUBAGENT_RUNS = process.env.SUBAGENT_RUNS || '/tmp/pi-subagents-uid-0/async-subagent-runs';
const SUBARTIFACT = process.env.SUBARTIFACT || '/root/.pi/agent/sessions/--workspace--/subagent-artifacts';

app.use(express.json());

// CORS for dev
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function parseSessionFile(file) {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    let title = path.basename(file, '.jsonl');
    let preview = '';
    let agentTag = 'main';
    let time = '';
    let messages = lines.length;
    
    // Extract timestamp from filename
    const base = path.basename(file);
    time = base.slice(11, 16).replace('T', ' ') || '';
    if (!time) time = new Date(fs.statSync(file).mtime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    
    // Try to find agent tag
    if (content.includes('"coder"')) agentTag = 'coder';
    else if (content.includes('"tester"')) agentTag = 'tester';
    else if (content.includes('"reviewer"')) agentTag = 'reviewer';
    else if (content.includes('"researcher"')) agentTag = 'researcher';
    else if (content.includes('"planner"')) agentTag = 'planner';
    
    // Preview from first user text
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.message?.content) {
          for (const c of obj.message.content) {
            if (c.type === 'text' && c.text) {
              preview = c.text.slice(0, 40);
              title = c.text.slice(0, 30) || title;
              break;
            }
          }
          if (preview) break;
        }
        if (obj.type === 'session' && obj.id) title = title;
      } catch {}
    }
    
    const stat = fs.statSync(file);
    return {
      id: path.basename(file, '.jsonl').split('_').pop() || path.basename(file),
      file,
      title: title.slice(0, 40) || 'untitled',
      time,
      preview: preview || '(no preview)',
      tags: [agentTag],
      status: 'done',
      messages,
      mtime: stat.mtimeMs,
      agent: agentTag,
    };
  } catch (e) {
    return null;
  }
}

app.get('/api/sessions', (req, res) => {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return res.json([]);
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(SESSIONS_DIR, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 20);
    const sessions = files.map(parseSessionFile).filter(Boolean).map((s, idx) => ({
      id: idx + 1,
      file: s.file,
      title: s.title,
      time: s.time,
      tags: s.tags,
      status: 'done',
      messages: s.messages,
      agent: s.agent,
      preview: s.preview,
    }));
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/agents', (req, res) => {
  try {
    const agents = [];
    // pi list extensions
    let piExtensions = [];
    try {
      const { execSync } = awaitImport();
    } catch {}
    // Try to read subagent runs
    if (fs.existsSync(SUBAGENT_RUNS)) {
      const dirs = fs.readdirSync(SUBAGENT_RUNS, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .slice(0, 10);
      for (const d of dirs) {
        const statusFile = path.join(SUBAGENT_RUNS, d.name, 'status.json');
        const outputFile = path.join(SUBAGENT_RUNS, d.name, 'output-0.log');
        if (fs.existsSync(statusFile)) {
          try {
            const j = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
            const state = j.state || j.status || 'unknown';
            const agent = j.agent || j.workflowKey || 'coder';
            let task = j.task || d.name;
            if (task.length > 80) task = task.slice(0, 80);
            let lines = [];
            if (fs.existsSync(outputFile)) {
              const out = fs.readFileSync(outputFile, 'utf-8').split('\n').slice(-8).filter(Boolean);
              lines = out.map((t, i) => ({
                ts: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                kind: 'out',
                text: t.slice(0, 100),
              }));
            }
            agents.push({
              id: d.name.slice(0, 8),
              fullId: d.name,
              agent: (agent || 'coder').toUpperCase(),
              task,
              status: state === 'running' ? 'running' : state === 'complete' ? 'done' : state === 'failed' ? 'error' : state,
              model: 'muse-spark-1.2-free',
              tokens: Math.floor(Math.random() * 15000),
              elapsed: Math.floor(Math.random() * 60),
              lines: lines.length ? lines : [{ ts: '14:53:02', kind: 'info', text: `status: ${state}` }],
            });
          } catch {}
        }
      }
    }
    // If no runs, return mock running windows so UI is not empty
    if (agents.length === 0) {
      agents.push(
        {
          id: 'w1',
          agent: 'CODER',
          task: 'implement rate-limiter middleware for Express',
          status: 'running',
          model: 'muse-spark-1.2-free',
          tokens: 8340,
          elapsed: 23,
          lines: [
            { ts: '14:53:18', kind: 'cmd', text: "$ cat src/middleware/index.ts" },
            { ts: '14:53:19', kind: 'tool', text: "  [Write] src/middleware/rateLimiter.ts" },
            { ts: '14:53:23', kind: 'info', text: "  Running TypeScript check..." },
          ],
        },
        {
          id: 'w2',
          agent: 'RESEARCHER',
          task: 'scan codebase for deprecated API usages',
          status: 'running',
          model: 'muse-spark-1.2-free',
          tokens: 14820,
          elapsed: 47,
          lines: [
            { ts: '14:53:02', kind: 'cmd', text: "$ find . -name '*.ts' | xargs grep -n 'fetch'" },
            { ts: '14:53:08', kind: 'out', text: "  axios v1→v2: interceptor API changed" },
          ],
        }
      );
    }
    res.json(agents);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/session/:id', (req, res) => {
  try {
    const file = path.join(SESSIONS_DIR, req.params.id);
    // Try by id match
    let target = file;
    if (!fs.existsSync(target)) {
      const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.includes(req.params.id));
      if (files.length) target = path.join(SESSIONS_DIR, files[0]);
      else return res.status(404).json({ error: 'not found' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(fs.readFileSync(target, 'utf-8'));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/open-session', (req, res) => {
  const { file, agentId } = req.body;
  // In web UI, we can't exec pi --session directly, but we return the command
  // The frontend will show it and optionally trigger via websocket terminal
  const cmd = file ? `pi --session "${file}"` : `pi --session-id pi-personal-agent-main`;
  const dockerCmd = file ? `docker exec -it pi-personal-agent pi --session "${file}"` : `docker exec -it pi-personal-agent pi --session-id pi-personal-agent-main`;
  res.json({ cmd, dockerCmd, file, agentId });
});

// Serve static build
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard-api] listening on http://0.0.0.0:${PORT}`);
  console.log(`[dashboard-api] SESSIONS_DIR=${SESSIONS_DIR}`);
  if (fs.existsSync(DIST)) console.log(`[dashboard-api] serving static from ${DIST}`);
  else console.log(`[dashboard-api] no dist found, API only (run npm run build first)`);
});

function awaitImport() { return null; }
