import { useState, useEffect, useRef } from "react";

const AGENTS = [
  { id: "researcher", color: "#39ff6e", label: "RESEARCHER" },
  { id: "coder", color: "#4da6ff", label: "CODER" },
  { id: "planner", color: "#ffb547", label: "PLANNER" },
  { id: "reviewer", color: "#ff4d4d", label: "REVIEWER" },
  { id: "tester", color: "#c084fc", label: "TESTER" },
];

// Fallback mock — replaced by live /api/sessions when backend is reachable
const FALLBACK_CONVERSATIONS = [
  { id: 1, title: "refactor auth module", time: "09:41", tags: ["coder", "reviewer"], status: "done", messages: 34, file: null as string | null },
  { id: 2, title: "investigate memory leak in worker pool", time: "10:12", tags: ["researcher", "coder"], status: "done", messages: 67, file: null as string | null },
  { id: 3, title: "write unit tests for parser", time: "11:03", tags: ["tester", "coder"], status: "done", messages: 21, file: null as string | null },
  { id: 4, title: "plan Q4 infra migration", time: "12:55", tags: ["planner"], status: "done", messages: 18, file: null as string | null },
  { id: 5, title: "debug websocket disconnect", time: "13:30", tags: ["researcher", "coder", "reviewer"], status: "done", messages: 89, file: null as string | null },
];

type AgentWindow = {
  id: string;
  agent: string;
  task: string;
  status: "running" | "waiting" | "done" | "error";
  model: string;
  tokens: number;
  elapsed: number;
  lines: LogLine[];
};

type LogLine = {
  ts: string;
  kind: "cmd" | "out" | "err" | "info" | "tool";
  text: string;
};

const FALLBACK_WINDOWS: AgentWindow[] = [
  {
    id: "w1", agent: "RESEARCHER", task: "scan codebase for deprecated API usages", status: "running", model: "claude-sonnet-5", tokens: 14820, elapsed: 47,
    lines: [
      { ts: "14:53:02", kind: "cmd", text: "$ find . -name '*.ts' | xargs grep -n 'fetch\\|axios'" },
      { ts: "14:53:08", kind: "out", text: "  axios v1→v2: interceptor API changed" },
    ],
  },
  {
    id: "w2", agent: "CODER", task: "implement rate-limiter middleware for Express", status: "running", model: "claude-sonnet-5", tokens: 8340, elapsed: 23,
    lines: [
      { ts: "14:53:19", kind: "tool", text: "  [Write] src/middleware/rateLimiter.ts" },
      { ts: "14:53:24", kind: "cmd", text: "$ npx tsc --noEmit" },
    ],
  },
];
const INITIAL_WINDOWS = FALLBACK_WINDOWS;

const AGENT_COLORS: Record<string, string> = {
  RESEARCHER: "#39ff6e",
  CODER: "#4da6ff",
  PLANNER: "#ffb547",
  REVIEWER: "#ff4d4d",
  TESTER: "#c084fc",
};

function TagBadge({ tag }: { tag: string }) {
  const agent = AGENTS.find((a) => a.id === tag);
  const color = agent?.color ?? "#6b9b6b";
  return (
    <span
      style={{ color, borderColor: color + "40", backgroundColor: color + "14" }}
      className="text-[9px] px-1 py-px border rounded-sm tracking-widest font-semibold uppercase"
    >
      {agent?.label ?? tag}
    </span>
  );
}

function StatusDot({ status }: { status: AgentWindow["status"] }) {
  const map = {
    running: { color: "#39ff6e", label: "RUN", pulse: true },
    waiting: { color: "#ffb547", label: "WAIT", pulse: false },
    done: { color: "#3d5c3d", label: "DONE", pulse: false },
    error: { color: "#ff4d4d", label: "ERR", pulse: false },
  };
  const s = map[status];
  return (
    <span className="flex items-center gap-1">
      <span
        style={{ backgroundColor: s.color }}
        className={`inline-block w-[6px] h-[6px] rounded-full ${s.pulse ? "agent-running" : ""}`}
      />
      <span style={{ color: s.color }} className="text-[9px] tracking-widest font-semibold">
        {s.label}
      </span>
    </span>
  );
}

function LogLineView({ line }: { line: LogLine }) {
  const styles: Record<string, string> = {
    cmd: "#c8e6c8",
    out: "#6b9b6b",
    err: "#ff4d4d",
    info: "#4da6ff",
    tool: "#ffb547",
  };
  const prefixes: Record<string, string> = {
    cmd: "",
    out: "",
    err: "✕ ",
    info: "» ",
    tool: "⚙ ",
  };
  return (
    <div className="flex gap-2 text-[10px] leading-relaxed">
      <span style={{ color: "#3d5c3d" }} className="shrink-0 tabular-nums">
        {line.ts}
      </span>
      <span style={{ color: styles[line.kind] }} className="break-all">
        {prefixes[line.kind]}{line.text}
      </span>
    </div>
  );
}

function AgentWindowCard({ win, isActive, onClick }: { win: AgentWindow; isActive: boolean; onClick: () => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  const color = AGENT_COLORS[win.agent] ?? "#39ff6e";

  useEffect(() => {
    if (isActive) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [win.lines, isActive]);

  const borderColor = isActive ? color : "#1e2b1e";

  return (
    <div
      onClick={onClick}
      style={{ borderColor }}
      className="border rounded-sm flex flex-col cursor-pointer transition-colors duration-150 bg-[#0d100d] overflow-hidden"
    >
      {/* Header */}
      <div
        style={{ borderBottomColor: borderColor, backgroundColor: color + "0d" }}
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color }} className="text-[10px] font-bold tracking-widest shrink-0">
            [{win.agent}]
          </span>
          <span className="text-[10px] text-[#6b9b6b] truncate">{win.task}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="text-[9px] text-[#3d5c3d] tracking-wide hidden sm:block">{win.model}</span>
          <span className="text-[9px] text-[#3d5c3d] tabular-nums hidden sm:block">
            {(win.tokens / 1000).toFixed(1)}k tok
          </span>
          <span className="text-[9px] text-[#3d5c3d] tabular-nums">{win.elapsed}s</span>
          {win.totalCost ? <span className="text-[8px] text-[#ffb547] hidden sm:block">${Number(win.totalCost).toFixed(4)}</span> : null}
          {win.workflowGraph && <span className="text-[8px] text-[#4da6ff] hidden lg:block">{win.workflowGraph?.flow || win.workflowGraph?.type || 'flow'}</span>}
          {win.children && win.children.length > 0 && <span className="text-[8px] text-[#c084fc]">+{win.children.length}c</span>}
          {win.launchResolvedExtensions && win.launchResolvedExtensions.length > 0 && (
            <span className="text-[7px] text-[#39ff6e] hidden sm:block" title={win.launchResolvedExtensions.join(',')}>
              ✓ {win.launchResolvedExtensions.slice(0,2).join(',').slice(0,12)}
            </span>
          )}
          <StatusDot status={win.status} />
        </div>
      </div>

      {/* Log body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-[2px] scrollbar-hide min-h-0" style={{ maxHeight: 160 }}>
        {win.lines.map((l, i) => (
          <LogLineView key={i} line={l} />
        ))}
        {win.children && win.children.length > 0 && (
          <div className="mt-2 border-t border-[#1e2b1e] pt-1">
            {win.children.map((c:any, idx:number) => (
              <div key={idx} className="ml-3 pl-2 border-l border-[#1e2b1e] text-[9px] text-[#6b9b6b] flex gap-2">
                <span>↳ {c.agent || c.workflowKey || 'child'}</span><span className="text-[#3d5c3d] truncate">{c.task?.slice(0,30) || c.runId?.slice(0,8)}</span><span className="text-[#3d5c3d]">{c.state || ''}</span>
              </div>
            ))}
          </div>
        )}
        {win.status === "running" && (
          <div className="flex gap-2 text-[10px] mt-1">
            <span style={{ color: "#3d5c3d" }} className="shrink-0 tabular-nums">
              {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <span style={{ color }} className="cursor-blink">▋</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Sidebar({
  selected,
  onSelect,
  conversations: convsProp,
  isLoading,
}: {
  selected: number | null;
  onSelect: (id: number) => void;
  conversations?: any[] | null;
  isLoading?: boolean;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  // convsProp === null means still loading -> show empty until fetch resolves
  // FALLBACK only used after fetch fails (App sets FALLBACK explicitly)
  const convs = convsProp ?? [];
  const filtered = filter ? convs.filter((c) => c.tags.includes(filter)) : convs;
  const loading = isLoading && convsProp === null;

  return (
    <div
      style={{ borderRightColor: "#1e2b1e" }}
      className="w-1/4 min-w-[180px] max-w-[260px] flex flex-col border-r bg-[#0a0c0a] shrink-0"
    >
      {/* Sidebar header */}
      <div
        style={{ borderBottomColor: "#1e2b1e" }}
        className="px-3 py-3 border-b shrink-0"
      >
        <div className="text-[9px] text-[#3d5c3d] tracking-[0.2em] uppercase mb-3">
          ~/sessions
        </div>
        {/* Agent filter chips */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilter(null)}
            style={{
              color: filter === null ? "#39ff6e" : "#3d5c3d",
              borderColor: filter === null ? "#39ff6e40" : "#1e2b1e",
              backgroundColor: filter === null ? "#39ff6e14" : "transparent",
            }}
            className="text-[8px] px-2 py-px border rounded-sm tracking-widest uppercase transition-colors"
          >
            ALL
          </button>
          {AGENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setFilter(filter === a.id ? null : a.id)}
              style={{
                color: filter === a.id ? a.color : "#3d5c3d",
                borderColor: filter === a.id ? a.color + "40" : "#1e2b1e",
                backgroundColor: filter === a.id ? a.color + "14" : "transparent",
              }}
              className="text-[8px] px-2 py-px border rounded-sm tracking-widest uppercase transition-colors"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {loading ? (
          // Skeleton while waiting for /api/sessions - prevents flash of FALLBACK
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-3 py-3 border-b border-b-[#0f180f] animate-pulse">
              <div className="h-[10px] bg-[#1e2b1e] rounded-sm w-3/4 mb-2" />
              <div className="h-[8px] bg-[#0f180f] rounded-sm w-1/2" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[10px] text-[#3d5c3d]">no sessions</div>
        ) : (
          filtered.map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            style={{
              borderLeftColor: selected === conv.id ? "#39ff6e" : "transparent",
              backgroundColor: selected === conv.id ? "#39ff6e0a" : "transparent",
            }}
            className="w-full text-left px-3 py-3 border-l-2 transition-colors hover:bg-[#0d100d] border-b border-b-[#0f180f]"
          >
            <div className="flex items-start justify-between gap-1 mb-1">
              <span
                style={{ color: selected === conv.id ? "#c8e6c8" : "#6b9b6b" }}
                className="text-[10px] leading-snug line-clamp-2"
              >
                {conv.title}
              </span>
            </div>
            <div className="flex items-center gap-1 flex-wrap mt-1">
              {conv.tags.map((t) => (
                <TagBadge key={t} tag={t} />
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[9px] text-[#3d5c3d]">{conv.time}</span>
              <span className="text-[9px] text-[#3d5c3d]">{conv.messages} msgs</span>
            </div>
          </button>
        ))
        )}
      </div>

      {/* Sidebar footer */}
      <div style={{ borderTopColor: "#1e2b1e" }} className="px-3 py-3 border-t shrink-0">
        <div className="text-[9px] text-[#3d5c3d] space-y-1">
          <div className="flex justify-between">
            <span>sessions</span>
            <span className="text-[#6b9b6b]">{filtered.length}</span>
          </div>
          <div className="flex justify-between">
            <span>filtered</span>
            <span className="text-[#6b9b6b]">{convs.length} total</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Topbar({ tick, running = 0, waiting = 0, done = 0 }: { tick: number; running?: number; waiting?: number; done?: number }) {

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div
      style={{ borderBottomColor: "#1e2b1e" }}
      className="flex items-center justify-between px-4 py-2 border-b bg-[#0a0c0a] shrink-0"
    >
      <div className="flex items-center gap-4">
        <span style={{ color: "#39ff6e" }} className="text-[11px] font-bold tracking-widest">
          MULTIAGENT
        </span>
        <span className="text-[9px] text-[#3d5c3d] tracking-widest">v0.9.1</span>
        <span style={{ color: "#1e2b1e" }} className="text-[10px]">│</span>
        <div className="flex items-center gap-3 text-[10px]">
          <span>
            <span style={{ color: "#39ff6e" }}>{running}</span>
            <span className="text-[#3d5c3d]"> run</span>
          </span>
          <span>
            <span style={{ color: "#ffb547" }}>{waiting}</span>
            <span className="text-[#3d5c3d]"> wait</span>
          </span>
          <span>
            <span style={{ color: "#3d5c3d" }}>{done}</span>
            <span className="text-[#3d5c3d]"> done</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-[#3d5c3d]">
        <span>
          cpu <span className="text-[#6b9b6b]">12%</span>
        </span>
        <span>
          mem <span className="text-[#6b9b6b]">1.4gb</span>
        </span>
        <span style={{ color: "#1e2b1e" }}>│</span>
        <span style={{ color: "#6b9b6b" }} className="tabular-nums">
          {timeStr}
        </span>
        <span style={{ color: "#39ff6e" }} className="cursor-blink text-[11px]">
          ▋
        </span>
      </div>
    </div>
  );
}

function InputBar({ onDispatch }: { onDispatch?: (agent: string, task: string, mode: string) => void }) {
  const [val, setVal] = useState("");
  const [agent, setAgent] = useState("RESEARCHER");
  const [mode, setMode] = useState<"shell"|"pi">("shell");
  const [sending, setSending] = useState(false);

  return (
    <div
      style={{ borderTopColor: "#1e2b1e" }}
      className="flex items-center gap-0 border-t bg-[#0a0c0a] shrink-0 px-0"
    >
      <div
        style={{ borderRightColor: "#1e2b1e", color: AGENT_COLORS[agent] ?? "#39ff6e" }}
        className="flex items-center gap-2 px-4 py-3 border-r shrink-0"
      >
        <span className="text-[10px] font-bold tracking-widest">[{agent}]</span>
        <span className="text-[#3d5c3d] text-[10px]">▸</span>
      </div>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={mode==='pi' ? "dispatch to pi agent (real subagent)..." : "dispatch task to agent... (shell)"}
        disabled={sending}
        style={{
          background: "transparent",
          color: "#c8e6c8",
          fontFamily: "var(--font-mono)",
          caretColor: "#39ff6e",
          opacity: sending ? 0.5 : 1,
        }}
        className="flex-1 text-[11px] px-4 py-3 outline-none placeholder:text-[#3d5c3d] min-w-0 disabled:opacity-50"
        onKeyDown={async (e) => {
          if (e.key === "Enter" && val.trim() && !sending) {
            const task = val.trim();
            const ag = agent;
            const m = mode;
            setSending(true);
            try {
              if (onDispatch) await onDispatch(ag, task, m);
              else {
                await fetch("/api/dispatch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent: ag.toLowerCase(), task, mode: m})});
              }
            } catch {}
            setVal("");
            setSending(false);
          }
        }}
      />
      <div
        style={{ borderLeftColor: "#1e2b1e" }}
        className="flex items-center gap-2 px-4 border-l shrink-0"
      >
        {/* 2-option toggle: SHELL (fast) vs PI (real agent per agents.md) */}
        <div className="flex border border-[#1e2b1e] rounded-sm overflow-hidden mr-1">
          <button
            onClick={() => setMode("shell")}
            style={{ backgroundColor: mode==="shell" ? "#39ff6e" : "transparent", color: mode==="shell" ? "#0a0c0a" : "#3d5c3d" }}
            className="text-[8px] px-2 py-1 font-bold tracking-widest uppercase"
            title="Shell: fast shell fallback, visible instantly in medium windows"
          >SHELL</button>
          <button
            onClick={() => setMode("pi")}
            style={{ backgroundColor: mode==="pi" ? "#4da6ff" : "transparent", color: mode==="pi" ? "#0a0c0a" : "#3d5c3d" }}
            className="text-[8px] px-2 py-1 font-bold tracking-widest uppercase"
            title="Pi: real subagent via pi-personal-agent (uses .pi/agents/*.md per agents.md), shared volume pi-subagents"
          >PI</button>
        </div>
        {AGENTS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAgent(a.label)}
            style={{
              color: agent === a.label ? a.color : "#3d5c3d",
            }}
            className="text-[8px] tracking-widest uppercase transition-colors hover:text-[#6b9b6b]"
          >
            {a.label[0]}
          </button>
        ))}
        <span style={{ color: "#1e2b1e" }} className="mx-1">│</span>
        <span className="text-[9px] text-[#3d5c3d]">↵ send ({mode})</span>
      </div>
    </div>
  );
}

export default function App() {
  const [selected, setSelected] = useState<number | null>(null);
  const [activeWin, setActiveWin] = useState<string>("w1");
  const [tick, setTick] = useState(0);
  // FIX: null = not yet loaded, prevents flash of static FALLBACK on refresh.
  // FALLBACK is only set after fetch fails (offline demo) - not on first render.
  const [conversations, setConversations] = useState<any[] | null>(null);
  const [windows, setWindows] = useState<AgentWindow[]>([]);
  const [fleetLoaded, setFleetLoaded] = useState(false);
  const [modalAgentId, setModalAgentId] = useState<string | null>(null);
  const [steerMsg, setSteerMsg] = useState("");
  const [steerMode, setSteerMode] = useState<"steer"|"follow_up"|"auto">("follow_up");
  const [showHelp, setShowHelp] = useState(false);
  const [activeTab, setActiveTab] = useState<"log"|"transcript"|"events"|"artifacts"|"session">("log");
  const [showToolDetails, setShowToolDetails] = useState(true);
  const [stats, setStats] = useState({totalTokens:"30,880", toolCalls:"41", tasksComplete:"1 / 4", uptime:"00:18:42"});
  const [sessionLines, setSessionLines] = useState<any[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Keyboard shortcuts like fleet inspector: f, ?, x, Esc, j/k
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'f' && !modalAgentId) { const first = windows[0]; if(first) setModalAgentId(first.id); }
      if (e.key === '?' ) setShowHelp(v=>!v);
      if (e.key === 'Escape' && modalAgentId) setModalAgentId(null);
      if (e.key === 'Escape' && showHelp) setShowHelp(false);
      if (e.key === 'x' || (e.ctrlKey && e.key==='o')) setShowToolDetails(v=>!v);
      if (e.key === 'j' && modalAgentId) { const idx = windows.findIndex(w=>w.id===modalAgentId); if(idx>=0 && idx < windows.length-1) setModalAgentId(windows[idx+1].id); }
      if (e.key === 'k' && modalAgentId) { const idx = windows.findIndex(w=>w.id===modalAgentId); if(idx>0) setModalAgentId(windows[idx-1].id); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [modalAgentId, showHelp, windows]);

  // Fetch real sessions + fleet + stats — synced to /subagents-fleet, 1s poll for real-time. Fixed flash bug: initial FALLBACK_WINDOWS/FALLBACK_CONVERSATIONS caused static flash on refresh then replaced by dynamic.
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const [sRes, aRes, stRes] = await Promise.all([
          fetch("/api/sessions").then(r=>r.ok?r.json():null).catch(()=>null),
          fetch("/api/fleet").then(r=>r.ok?r.json():null).then(j=>j?.fleet||j).catch(()=>null),
          fetch("/api/session-stats").then(r=>r.ok?r.json():null).catch(()=>null),
        ]);
        if (cancelled) return;
        // sRes === null => fetch failed/network error -> use FALLBACK for offline demo
        // sRes === [] => backend reachable but no sessions -> show empty, NOT fallback
        // Only FALLBACK on error keeps static from flashing on every refresh
        if (Array.isArray(sRes)) {
          setConversations(sRes);
        } else if (sRes === null && conversations === null) {
          // first load failed - show fallback instead of infinite skeleton
          setConversations(FALLBACK_CONVERSATIONS);
        } else if (sRes === null) {
          // subsequent poll failed - keep previous dynamic data, don't revert to static
        }
        const fleetArr = aRes && Array.isArray(aRes) ? aRes : aRes?.fleet;
        if (fleetArr && Array.isArray(fleetArr)) {
          if (fleetArr.length) {
            const mapped = fleetArr.map((f:any)=>({
              id: f.id || f.runId?.slice(0,8),
              runId: f.runId || f.fullId || f.id,
              agent: f.agent || f.rawAgent || "CODER",
              task: f.task || f.runId,
              status: f.status || f.fleetState,
              fleetState: f.fleetState || f.status,
              model: f.model || "muse-spark-1.2-free",
              tokens: f.tokens || 0,
              windowTokens: f.windowTokens || f.tokens || 0,
              spentTokens: f.spentTokens || f.tokens || 0,
              totalCost: f.totalCost || 0,
              elapsed: f.elapsed || 0,
              durationMs: f.durationMs || 0,
              lines: f.lines || [],
              file: f.sessionFile,
              sessionFile: f.sessionFile,
              sessionId: f.sessionId || null,
              toolCount: f.toolCount || 0,
              turnCount: f.turnCount || 0,
              lifecycleArtifactVersion: f.lifecycleArtifactVersion || null,
              mode: f.mode || null,
              endedAt: f.endedAt || null,
              workflowGraph: f.workflowGraph || null,
              steps: f.steps || [],
              results: f.results || [],
              launchResolvedExtensions: f.launchResolvedExtensions || [],
              runtimeAcknowledgedExtensions: f.runtimeAcknowledgedExtensions || [],
              modelAttempts: f.modelAttempts || null,
              children: f.children || [],
              cwd: f.cwd || null,
              asyncDir: f.asyncDir || null,
            }));
            // Medium windows = ACTIVE only (running/waiting). Don't show stale DONE like screenshot 4 windows.
            // Backend already filters to active + recent (30s done, 60s error), frontend double-filters to running/waiting for strict active view.
            const activeOnly = mapped.filter((w:any) => w.status === 'running' || w.status === 'waiting');
            setWindows(activeOnly);
          } else {
            // Fleet empty → clear stale windows (prevents showing old DONE or fallback)
            setWindows([]);
          }
        } else if (aRes && Array.isArray(aRes)) {
          if (aRes.length) {
            const activeOnly = (aRes as any[]).filter((w:any) => w.status === 'running' || w.status === 'waiting');
            setWindows(activeOnly);
          } else {
            setWindows([]);
          }
        }
        if (stRes && stRes.totalTokens) {
          setStats({
            totalTokens: typeof stRes.totalTokens === 'number' ? stRes.totalTokens.toLocaleString() : stRes.totalTokens,
            toolCalls: String(stRes.toolCalls ?? stRes.toolCount ?? "41"),
            tasksComplete: stRes.tasksComplete || "1 / 4",
            uptime: stRes.uptime || "00:18:42",
          });
        }
      } catch {} finally {
        if (!cancelled) setFleetLoaded(true);
      }
    };
    fetchAll();
    const iv = setInterval(fetchAll, 1000); // 1s poll fallback
    // SSE upgrade: sub-100ms fleet updates via /api/fleet/stream, fallback to poll if unavailable
    let es: EventSource | null = null;
    let sseActive = false;
    try {
      if (typeof window !== 'undefined' && 'EventSource' in window) {
        es = new EventSource('/api/fleet/stream');
        es.addEventListener('fleet', () => {
          sseActive = true;
          fetchAll();
        });
        es.onopen = () => { sseActive = true; };
        es.onerror = () => {
          // let browser auto-reconnect; keep 1s poll as fallback
          sseActive = false;
        };
      }
    } catch {}
    return () => { cancelled = true; clearInterval(iv); if (es) try { es.close(); } catch {} };
  }, []);

  const handleSelectSession = async (id: number) => {
    setSelected(id);
    const conv = (conversations ?? []).find(c=>c.id===id);
    if (!conv?.file) return;
    // open live fleet modal for this session if it has a fleet child, else just show pi-vCLI cmd
    const fleetHit = (windows as any).find((w:any)=>w.sessionFile===conv.file || w.file===conv.file);
    if (fleetHit) { setModalAgentId(fleetHit.id); setActiveWin(fleetHit.id); return; }
    try {
      const r = await fetch("/api/open-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({file:conv.file})});
      const j = await r.json();
      // for sessions without fleet, show static modal via dedicated state
      (window as any).__staticModal = j;
      setModalAgentId(`__session_${id}`);
    } catch {}
  };

  const handleClickWindow = (win: AgentWindow) => {
    setActiveWin(win.id);
    setModalAgentId(win.id);
  };

  const sessForModal = modalAgentId?.startsWith('__session_') ? (conversations ?? []).find(c=>c.id===parseInt(modalAgentId.replace('__session_',''))) : null;
  const modalWinRaw = modalAgentId ? ((windows as any).find((w:any)=>w.id===modalAgentId) || (modalAgentId.startsWith('__session_') ? {id:modalAgentId, agent: (sessForModal?.agent || sessForModal?.tags?.[0] || 'SESSION').toUpperCase(), task: sessForModal?.title || sessForModal?.preview || '', status:'done', model:'', tokens:0, elapsed:0, lines: sessionLines.length ? sessionLines : [], file: sessForModal?.file} as any : null)) : null;
  const modalWin = modalWinRaw;
  const modalCmd = modalWin?.file || modalWin?.sessionFile ? `pi --session "${modalWin.file||modalWin.sessionFile}"` : modalWin ? `pi --session ${modalWin.id}` : "";
  const modalDockerCmd = modalWin?.file || modalWin?.sessionFile ? `docker exec -it pi-personal-agent pi --session "${modalWin.file||modalWin.sessionFile}"` : modalWin ? `docker exec -it pi-personal-agent pi --session ${modalWin.id}` : "";

  // Fetch session transcript when opening left-panel session (which has no fleet lines) — fixes "waiting for logs..." bug + stuck loading
  useEffect(() => {
    if (!modalAgentId || !modalAgentId.startsWith('__session_')) {
      if (sessionLines.length) setSessionLines([]);
      if (sessionLoading) setSessionLoading(false);
      return;
    }
    const file = (conversations ?? []).find(c=>c.id===parseInt(modalAgentId.replace('__session_','')))?.file;
    if (!file) {
      setSessionLines([{ts:'--',kind:'err',text:'session file not found in conversations'}]);
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setSessionLoading(true);
      const id = encodeURIComponent(file.split('/').pop() || file);
      const urls = [`/api/session/${id}`, `http://127.0.0.1:3001/api/session/${id}`];
      let lastErr: any = null;
      for (const url of urls) {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(()=>ctrl.abort(), 5000);
          const r = await fetch(url, {signal: ctrl.signal});
          clearTimeout(to);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const txt = await r.text();
          const lines = txt.split('\n').filter(Boolean).slice(-120).map((l:any, idx:number) => {
            try {
              const obj = JSON.parse(l);
              const c = obj.message?.content?.[0];
              const text = c?.text || c?.command || obj.toolName || obj.type || l.slice(0,120);
              const kind = obj.message?.role === 'assistant' ? (c?.type==='toolCall' ? 'tool' : 'out') : obj.message?.role==='toolResult' ? (obj.isError?'err':'out') : obj.type==='tool_execution_start' ? 'tool' : obj.type==='session' ? 'info' : 'out';
              const ts = obj.timestamp ? new Date(obj.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : String(idx).padStart(2,'0')+':00:00';
              return { ts, kind, text: String(text).slice(0,140) };
            } catch { return { ts: '--', kind: 'out', text: l.slice(0,120) }; }
          });
          if (!cancelled) {
            setSessionLines(lines.length ? lines : [{ts:'--',kind:'info',text:'(empty session)'}]);
            setSessionLoading(false);
          }
          return;
        } catch (e:any) {
          lastErr = e;
          console.warn(`[session fetch] ${url} failed:`, e.message);
        }
      }
      if (!cancelled) {
        setSessionLines([{ts:'--',kind:'err',text:`failed to load session: ${String(lastErr?.message||lastErr).slice(0,80)} (id ${id})`}]);
        setSessionLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [modalAgentId, conversations]);

  const runningCount = windows.filter((w: any) => w.status === "running").length;
  const waitingCount = windows.filter((w: any) => w.status === "waiting").length;
  const doneCount = windows.filter((w: any) => w.status === "done").length;

  return (
    <div className="flex flex-col h-full bg-[#0a0c0a] overflow-hidden">
      <Topbar tick={tick} running={runningCount} waiting={waitingCount} done={doneCount} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar — 1/4 */}
        <Sidebar selected={selected} onSelect={handleSelectSession} conversations={conversations} isLoading={!fleetLoaded} />

        {/* Main panel — 3/4 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Agent windows grid — 3/4 middle */}
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide">
            {/* Section label */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[9px] text-[#3d5c3d] tracking-[0.2em] uppercase">
                active agents — medium windows (click to land in pi-vCLI)
              </span>
              <div className="flex-1 h-px bg-[#1e2b1e]" />
              <span className="text-[9px] text-[#3d5c3d]">{windows.length} windows</span>
            </div>

            {windows.length === 0 ? (
              <div className="border border-dashed border-[#1e2b1e] bg-[#0d100d] rounded-sm p-6 text-center">
                <div className="text-[11px] text-[#6b9b6b] tracking-widest">
                  {fleetLoaded ? "No active agents — dispatch a task below (SHELL fast, PI real per agents.md)" : "Loading fleet..."}
                </div>
                <div className="text-[9px] text-[#3d5c3d] mt-2">
                  {fleetLoaded ? "Select SHELL for shell echo or PI for real subagent (coder/tester/researcher)" : "Polling /api/fleet every 1s"}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {windows.map((win) => (
                  <AgentWindowCard
                    key={win.id}
                    win={win}
                    isActive={activeWin === win.id}
                    onClick={() => handleClickWindow(win)}
                  />
                ))}
              </div>
            )}

            {/* Stats row */}
            <div className="mt-6 mb-2">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[9px] text-[#3d5c3d] tracking-[0.2em] uppercase">
                  session stats
                </span>
                <div className="flex-1 h-px bg-[#1e2b1e]" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "total tokens", value: stats.totalTokens, color: "#39ff6e" },
                  { label: "tool calls", value: stats.toolCalls, color: "#4da6ff" },
                  { label: "tasks complete", value: stats.tasksComplete, color: "#ffb547" },
                  { label: "session uptime", value: stats.uptime, color: "#c8e6c8" },
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{ borderColor: "#1e2b1e" }}
                    className="border bg-[#0d100d] px-3 py-3 rounded-sm"
                  >
                    <div className="text-[9px] text-[#3d5c3d] tracking-wider mb-1 uppercase">
                      {s.label}
                    </div>
                    <div style={{ color: s.color }} className="text-[14px] font-semibold tabular-nums">
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Input bar — 2 options: SHELL (fast sh) vs PI (real subagent via agents.md) */}
          <InputBar onDispatch={async (ag, task, mode) => {
            // optimistic: add a pending window immediately so user sees feedback
            const tempId = `tmp-${Date.now()}`;
            setWindows(prev => [{id: tempId, agent: ag.toUpperCase(), task: `${task} [${mode}]`, status: "running" as const, model: "muse-spark-1.2-free", tokens: 0, elapsed: 0, lines: [{ts: new Date().toLocaleTimeString('en-GB'), kind: "info" as const, text: `dispatching to ${ag} via ${mode}...`}]}, ...prev]);
            try {
              const r = await fetch("/api/dispatch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent: ag.toLowerCase(), task, mode})});
              const j = await r.json().catch(()=>({}));
              if (!r.ok) throw new Error(j.error||"dispatch failed");
              // Remove optimistic temp after real fleet appears (1s poll will replace); keep temp for 1s then let poll overwrite
              setTimeout(()=> setWindows(prev => prev.filter(w=>w.id!==tempId)), 3000);
            } catch(e:any) {
              setWindows(prev => prev.map(w=>w.id===tempId ? {...w, status:"error" as const, lines:[{ts: new Date().toLocaleTimeString('en-GB'), kind:"err" as const, text: String(e.message||e)}]} : w));
            }
          }} />
        </div>
      </div>
      {/* Live fleet modal — full observability: tabs like /subagents-fleet inspector */}
      {modalAgentId && modalWin && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setModalAgentId(null)}>
          <div onClick={e=>e.stopPropagation()} style={{borderColor: AGENT_COLORS[modalWin.agent] || "#39ff6e"}} className="bg-[#0d100d] border rounded-sm max-w-[840px] w-full max-h-[88vh] flex flex-col overflow-hidden">
            {/* modal header */}
            <div style={{borderBottomColor: AGENT_COLORS[modalWin.agent] || "#39ff6e", backgroundColor: (AGENT_COLORS[modalWin.agent]||"#39ff6e")+"0d"}} className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span style={{color: AGENT_COLORS[modalWin.agent]||"#39ff6e"}} className="text-[11px] font-bold tracking-widest">[{modalWin.agent}]</span>
                <span className="text-[11px] text-[#c8e6c8] truncate">{modalWin.task}</span>
                <StatusDot status={modalWin.status as any} />
                <span className="text-[9px] text-[#3d5c3d] hidden sm:block">{(modalWin as any).fleetState || modalWin.status} · {(modalWin as any).toolCount||0} tools · {(modalWin as any).turnCount||0} turns</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-[#3d5c3d] hidden sm:block">{modalWin.model} · {modalWin.tokens} tok · {modalWin.elapsed}s</span>
                <button onClick={()=>setModalAgentId(null)} className="text-[#3d5c3d] hover:text-[#c8e6c8] text-[12px] px-2">✕</button>
              </div>
            </div>
            {/* tabs like fleet inspector: Live Log / Transcript / Events / Artifacts / Session */}
            <div style={{borderBottomColor:"#1e2b1e"}} className="flex gap-1 px-4 py-2 border-b bg-[#0a0c0a] shrink-0">
              {["log","transcript","events","artifacts","session"].map(tab=>(
                <button key={tab} onClick={()=>setActiveTab(tab as any)} style={{color: activeTab===tab ? "#39ff6e" : "#3d5c3d", borderColor: activeTab===tab ? "#39ff6e" : "#1e2b1e", backgroundColor: activeTab===tab ? "#39ff6e14" : "transparent"}} className="text-[9px] px-3 py-1 border rounded-sm uppercase tracking-widest">
                  {tab}
                </button>
              ))}
              <span className="ml-auto text-[9px] text-[#3d5c3d] hidden sm:block">shortcuts: x tool details · j/k line · PgUp/Dn page · s steer · D stop · ? help</span>
            </div>
            {/* tab content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-[#0a0c0a] min-h-[220px] max-h-[380px]">
              {activeTab==="log" && (
                <>
                  <div className="text-[9px] text-[#3d5c3d] tracking-widest uppercase mb-2 flex justify-between">
                    <span>{String(modalWin.id).startsWith('__session_') ? `session transcript — ${modalWin.file?.split('/').pop() || modalWin.id}` : "live log — status.json + output-*.log (1s poll, same as fleet)"}</span>
                    <span className="text-[#39ff6e] animate-pulse">● {String(modalWin.id).startsWith('__session_') ? (sessionLoading ? "loading..." : "loaded") : `live ${modalWin.elapsed}s`} {showToolDetails?"· tools on":"· tools off"}</span>
                  </div>
                  {(String(modalWin.id).startsWith('__session_') && sessionLoading ? [{ts:"--",kind:"info" as const,text:"loading session..."}] : (modalWin.lines && modalWin.lines.length ? modalWin.lines : [{ts:"--",kind:"info" as const,text:"waiting for logs..."}])).filter((l:any)=>showToolDetails || l.kind!=="tool").map((l:any,i:number)=>(
                    <div key={i} className="flex gap-2 text-[10px] leading-relaxed">
                      <span style={{color:"#3d5c3d"}} className="shrink-0 tabular-nums">{l.ts}</span>
                      <span style={{color: l.kind==="err"?"#ff4d4d": l.kind==="tool"?"#ffb547": l.kind==="info"?"#4da6ff":"#6b9b6b"}} className="break-all">{l.text}</span>
                    </div>
                  ))}
                  {modalWin.status==="running" && !String(modalWin.id).startsWith('__session_') && <div className="flex gap-2 text-[10px] mt-2"><span style={{color:"#3d5c3d"}}>{new Date().toLocaleTimeString("en-GB")}</span><span style={{color: AGENT_COLORS[modalWin.agent]||"#39ff6e"}} className="cursor-blink">▋</span></div>}
                </>
              )}
              {activeTab==="transcript" && (
                <div className="text-[10px] text-[#6b9b6b] space-y-1">
                  <div className="text-[9px] text-[#3d5c3d] uppercase">transcript — subagent({`action:"status", id:"${modalWin.runId||modalWin.id}", view:"transcript", lines:200`})</div>
                  <div className="border border-[#1e2b1e] bg-[#111411] p-3 rounded-sm max-h-[260px] overflow-y-auto">
                    {(modalWin.lines||[]).map((l:any,i:number)=><div key={i} className="flex gap-2"><span className="text-[#3d5c3d] shrink-0">{l.ts}</span><span className="break-all" style={{color: l.kind==="tool"?"#ffb547":"#c8e6c8"}}>{l.text}</span></div>)}
                    <div className="text-[9px] text-[#3d5c3d] mt-2">Full transcript via: <code className="text-[#4da6ff]">subagent status {modalWin.runId||modalWin.id} transcript</code></div>
                  </div>
                </div>
              )}
              {activeTab==="events" && (
                <div className="text-[10px] text-[#6b9b6b] space-y-1">
                  <div className="text-[9px] text-[#3d5c3d] uppercase">events.jsonl — lifecycle + steer</div>
                  <div className="border border-[#1e2b1e] bg-[#111411] p-3 rounded-sm max-h-[260px] overflow-y-auto font-mono">
                    <div>subagent.run.started · {new Date((modalWin as any).startedAt||Date.now()).toLocaleTimeString()} · {modalWin.agent} {modalWin.task.slice(0,40)}</div>
                    <div>subagent.step.started · {modalWin.task.slice(0,40)}</div>
                    <div>subagent.steer.requested → scheduled → routed → delivered (when you Send)</div>
                    <div>subagent.run.completed · {modalWin.status} · {modalWin.elapsed}s · {modalWin.tokens} tok</div>
                    <div className="text-[9px] text-[#3d5c3d] mt-2">Source: { (modalWin as any).asyncDir || "/tmp/pi-subagents-uid-0/..."}/events.jsonl — same as fleet inspector</div>
                  </div>
                </div>
              )}
              {activeTab==="artifacts" && (
                <div className="text-[10px] text-[#6b9b6b] space-y-2">
                  <div className="text-[9px] text-[#3d5c3d] uppercase">artifacts — status.json + subagent-artifacts</div>
                  <div className="border border-[#1e2b1e] bg-[#111411] p-3 rounded-sm space-y-1">
                    <div>status.json: <code className="text-[#4da6ff] break-all">{(modalWin as any).asyncDir||"/tmp/..."}/status.json</code> — state {(modalWin as any).fleetState||modalWin.status}, toolCount {(modalWin as any).toolCount||0}</div>
                    <div>output: <code className="text-[#4da6ff] break-all">{(modalWin as any).asyncDir||"/tmp/..."}/output-0.log</code> — live tail</div>
                    <div>session: <code className="text-[#ffb547] break-all">{(modalWin as any).sessionFile||"--"}</code> — pi-vCLI: <code className="text-[#39ff6e]">pi --session "{(modalWin as any).sessionFile||modalWin.id}"</code></div>
                    <div>artifacts dir: <code className="text-[#c084fc]">/root/.pi/agent/sessions/--workspace--/subagent-artifacts/{modalWin.runId||modalWin.id}_*/</code></div>
                  </div>
                </div>
              )}
              {activeTab==="session" && (
                <div className="text-[10px] text-[#6b9b6b] space-y-2">
                  <div className="text-[9px] text-[#3d5c3d] uppercase">session — full status.json</div>
                  <div className="border border-[#1e2b1e] bg-[#111411] p-3 rounded-sm space-y-1">
                    <div>runId: <code className="text-[#c8e6c8]">{modalWin.runId||modalWin.id}</code> · id: {(modalWin as any).id} · fullId: {(modalWin as any).fullId}</div>
                    <div>sessionId: <code className="text-[#ffb547] break-all">{(modalWin as any).sessionId || (modalWin as any).sessionFile || '--'}</code></div>
                    <div>mode: <code className="text-[#c8e6c8]">{(modalWin as any).mode || '--'}</code> · state: {(modalWin as any).fleetState||modalWin.status} · lifecycle: {(modalWin as any).lifecycleArtifactVersion || '--'}</div>
                    <div>startedAt: {new Date((modalWin as any).startedAt||0).toLocaleString()} · endedAt: {(modalWin as any).endedAt ? new Date((modalWin as any).endedAt).toLocaleString() : '--'} · duration: {modalWin.elapsed}s ({(modalWin as any).durationMs||0}ms)</div>
                    <div>tokens window/spent: {(modalWin as any).windowTokens||modalWin.tokens} / {(modalWin as any).spentTokens||modalWin.tokens} · totalCost: ${(modalWin as any).totalCost ? `$${Number((modalWin as any).totalCost).toFixed(4)}` : '--'} · cwd: {(modalWin as any).cwd||'--'}</div>
                    <div>model: {modalWin.model} · attempts: {(modalWin as any).modelAttempts ? JSON.stringify((modalWin as any).modelAttempts).slice(0,60) : '--'}</div>
                    <div>launchResolved: <span className="text-[#39ff6e]">{((modalWin as any).launchResolvedExtensions||[]).join(', ') || '--'}</span> · runtimeAck: <span className="text-[#4da6ff]">{((modalWin as any).runtimeAcknowledgedExtensions||[]).join(', ') || '--'}</span> {(modalWin as any).launchResolvedExtensions?.length ? <span className="text-[#39ff6e] ml-1">✓ ack</span> : null}</div>
                    {(modalWin as any).workflowGraph && <div>workflowGraph: <code className="text-[#4da6ff] break-all">{JSON.stringify((modalWin as any).workflowGraph).slice(0,120)}</code></div>}
                    {(modalWin as any).children && (modalWin as any).children.length>0 && (
                      <div>children ({(modalWin as any).children.length}):
                        <div className="ml-2 mt-1 space-y-1">
                          {(modalWin as any).children.map((c:any,i:number)=>(
                            <div key={i} className="ml-2 pl-2 border-l border-[#1e2b1e]">↳ {c.agent||c.workflowKey} {c.runId?.slice(0,8)} {c.state} {c.task?.slice(0,40)}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(modalWin as any).steps && (modalWin as any).steps.length>0 && <div>steps: {(modalWin as any).steps.length} · results: {(modalWin as any).results?.length||0}</div>}
                    <div>toolCount: {(modalWin as any).toolCount||0} · turnCount: {(modalWin as any).turnCount||0} · asyncDir: <code className="text-[#3d5c3d] break-all">{(modalWin as any).asyncDir||'--'}</code></div>
                  </div>
                </div>
              )}
            </div>
            {/* fleet controls */}
            <div style={{borderTopColor:"#1e2b1e"}} className="border-t bg-[#0a0c0a] p-3 space-y-3 shrink-0">
              <div className="flex gap-2">
                <input value={steerMsg} onChange={e=>setSteerMsg(e.target.value)} placeholder="steer / follow_up message to live agent... (s)" className="flex-1 bg-[#111411] border border-[#1e2b1e] text-[11px] text-[#c8e6c8] px-3 py-2 rounded-sm outline-none placeholder:text-[#3d5c3d]" onKeyDown={e=>{if(e.key==="Enter" && steerMsg.trim()){fetch(`/api/fleet/${modalWin.runId||modalWin.id}/steer`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:steerMsg, mode:steerMode})}); setSteerMsg("");}}} />
                <select value={steerMode} onChange={e=>setSteerMode(e.target.value as any)} className="bg-[#111411] border border-[#1e2b1e] text-[9px] text-[#6b9b6b] px-2 rounded-sm">
                  <option value="follow_up">follow_up (Tab)</option><option value="steer">steer</option><option value="auto">auto</option>
                </select>
                <button onClick={()=>{if(!steerMsg.trim()) return; fetch(`/api/fleet/${modalWin.runId||modalWin.id}/steer`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:steerMsg, mode:steerMode})}); setSteerMsg("");}} style={{backgroundColor: AGENT_COLORS[modalWin.agent]||"#39ff6e", color:"#0a0c0a"}} className="px-4 py-2 text-[10px] font-bold rounded-sm">Send s</button>
              </div>
              <div className="flex gap-2 text-[9px]">
                <button onClick={()=>{fetch(`/api/fleet/${modalWin.runId||modalWin.id}/stop`,{method:"POST"});}} style={{borderColor:"#ff4d4d", color:"#ff4d4d"}} className="flex-1 border py-2 rounded-sm hover:bg-[#ff4d4d14]">Stop D</button>
                <button onClick={()=>setShowToolDetails(v=>!v)} style={{borderColor:"#1e2b1e", color: showToolDetails?"#39ff6e":"#6b9b6b"}} className="flex-1 border py-2 rounded-sm">{showToolDetails?"Hide":"Show"} tools x</button>
                <button onClick={()=>{navigator.clipboard.writeText(modalDockerCmd);}} style={{borderColor:"#1e2b1e", color:"#6b9b6b"}} className="flex-1 border py-2 rounded-sm hover:bg-[#1e2b1e]">Copy pi-vCLI H</button>
                <button onClick={()=>setModalAgentId(null)} style={{borderColor:"#1e2b1e", color:"#3d5c3d"}} className="flex-1 border py-2 rounded-sm">Close Esc</button>
              </div>
              <div style={{borderColor:"#1e2b1e"}} className="border bg-[#0a0c0a] p-2 rounded-sm">
                <div className="text-[9px] text-[#3d5c3d] uppercase">land in pi-vCLI (same session as fleet inspector Enter/H)</div>
                <code className="text-[10px] text-[#4da6ff] break-all">{modalCmd}</code>
                <div className="text-[9px] text-[#3d5c3d] uppercase mt-1">docker</div>
                <code className="text-[10px] text-[#ffb547] break-all">{modalDockerCmd}</code>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* help modal (?) */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={()=>setShowHelp(false)}>
          <div onClick={e=>e.stopPropagation()} style={{borderColor:"#39ff6e"}} className="bg-[#0d100d] border rounded-sm max-w-[560px] w-full p-4">
            <div className="text-[11px] text-[#39ff6e] tracking-widest mb-3">Shortcuts — same as /subagents-fleet</div>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-[#6b9b6b]">
              <div><span className="text-[#c8e6c8]">↑↓/j/k</span> select card</div><div><span className="text-[#c8e6c8]">f</span> open fleet modal</div>
              <div><span className="text-[#c8e6c8]">Shift+K/J</span> line</div><div><span className="text-[#c8e6c8]">PgUp/Dn</span> page</div>
              <div><span className="text-[#c8e6c8]">x / Ctrl+O</span> toggle tool details</div><div><span className="text-[#c8e6c8]">s</span> steer (Tab cycles)</div>
              <div><span className="text-[#c8e6c8]">D</span> stop</div><div><span className="text-[#c8e6c8]">H</span> Herdr / pi-vCLI</div>
              <div><span className="text-[#c8e6c8]">Enter</span> Herdr</div><div><span className="text-[#c8e6c8]">Esc</span> close</div>
              <div><span className="text-[#c8e6c8]">r</span> refresh</div><div><span className="text-[#c8e6c8]">?</span> help</div>
            </div>
            <div className="text-[9px] text-[#3d5c3d] mt-3">Source: pi-subagents docs/observability.md — FleetView, fleet inspector, async artifacts, status fields, host inspection RPC.</div>
            <button onClick={()=>setShowHelp(false)} style={{borderColor:"#1e2b1e"}} className="w-full mt-3 border text-[10px] py-2 rounded-sm text-[#6b9b6b]">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
