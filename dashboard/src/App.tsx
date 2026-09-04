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
          <StatusDot status={win.status} />
        </div>
      </div>

      {/* Log body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-[2px] scrollbar-hide min-h-0" style={{ maxHeight: 160 }}>
        {win.lines.map((l, i) => (
          <LogLineView key={i} line={l} />
        ))}
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
}: {
  selected: number | null;
  onSelect: (id: number) => void;
  conversations?: any[];
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const convs = convsProp ?? FALLBACK_CONVERSATIONS;
  const filtered = filter ? convs.filter((c) => c.tags.includes(filter)) : convs;

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
        {filtered.map((conv) => (
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
        ))}
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

function InputBar() {
  const [val, setVal] = useState("");
  const [agent, setAgent] = useState("RESEARCHER");

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
        placeholder="dispatch task to agent..."
        style={{
          background: "transparent",
          color: "#c8e6c8",
          fontFamily: "var(--font-mono)",
          caretColor: "#39ff6e",
        }}
        className="flex-1 text-[11px] px-4 py-3 outline-none placeholder:text-[#3d5c3d] min-w-0"
        onKeyDown={(e) => {
          if (e.key === "Enter" && val.trim()) {
            setVal("");
          }
        }}
      />
      <div
        style={{ borderLeftColor: "#1e2b1e" }}
        className="flex items-center gap-2 px-4 border-l shrink-0"
      >
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
        <span className="text-[9px] text-[#3d5c3d]">↵ send</span>
      </div>
    </div>
  );
}

export default function App() {
  const [selected, setSelected] = useState<number | null>(null);
  const [activeWin, setActiveWin] = useState<string>("w1");
  const [tick, setTick] = useState(0);
  const [conversations, setConversations] = useState<any[]>(FALLBACK_CONVERSATIONS);
  const [windows, setWindows] = useState<AgentWindow[]>(FALLBACK_WINDOWS);
  const [modalAgentId, setModalAgentId] = useState<string | null>(null);
  const [steerMsg, setSteerMsg] = useState("");
  const [steerMode, setSteerMode] = useState<"steer"|"follow_up"|"auto">("follow_up");
  const [stats, setStats] = useState({totalTokens:"30,880", toolCalls:"41", tasksComplete:"1 / 4", uptime:"00:18:42"});

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch real sessions + fleet + stats (falls back to mock) — synced to /subagents-fleet, 1s poll for real-time
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
        if (sRes && Array.isArray(sRes) && sRes.length) setConversations(sRes);
        const fleetArr = aRes && Array.isArray(aRes) ? aRes : aRes?.fleet;
        if (fleetArr && Array.isArray(fleetArr) && fleetArr.length) {
          const mapped = fleetArr.map((f:any)=>({
            id: f.id || f.runId?.slice(0,8),
            runId: f.runId || f.fullId || f.id,
            agent: f.agent || f.rawAgent || "CODER",
            task: f.task || f.runId,
            status: f.status || f.fleetState,
            model: f.model || "muse-spark-1.2-free",
            tokens: f.tokens || 0,
            elapsed: f.elapsed || 0,
            lines: f.lines || [],
            file: f.sessionFile,
            sessionFile: f.sessionFile,
            toolCount: f.toolCount,
          }));
          setWindows(mapped);
        } else if (aRes && Array.isArray(aRes) && aRes.length) {
          setWindows(aRes);
        }
        if (stRes && stRes.totalTokens) {
          setStats({
            totalTokens: typeof stRes.totalTokens === 'number' ? stRes.totalTokens.toLocaleString() : stRes.totalTokens,
            toolCalls: String(stRes.toolCalls ?? stRes.toolCount ?? "41"),
            tasksComplete: stRes.tasksComplete || "1 / 4",
            uptime: stRes.uptime || "00:18:42",
          });
        }
      } catch {}
    };
    fetchAll();
    const iv = setInterval(fetchAll, 1000); // 1s for real-time logs
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const handleSelectSession = async (id: number) => {
    setSelected(id);
    const conv = conversations.find(c=>c.id===id);
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

  const modalWin = modalAgentId ? ((windows as any).find((w:any)=>w.id===modalAgentId) || (modalAgentId.startsWith('__session_') ? {id:modalAgentId, agent:'SESSION', task:'', status:'done', model:'', tokens:0, elapsed:0, lines:[], file: conversations.find(c=>c.id===parseInt(modalAgentId.replace('__session_','')))?.file} as any : null)) : null;
  const modalCmd = modalWin?.file || modalWin?.sessionFile ? `pi --session "${modalWin.file||modalWin.sessionFile}"` : modalWin ? `pi --session ${modalWin.id}` : "";
  const modalDockerCmd = modalWin?.file || modalWin?.sessionFile ? `docker exec -it pi-personal-agent pi --session "${modalWin.file||modalWin.sessionFile}"` : modalWin ? `docker exec -it pi-personal-agent pi --session ${modalWin.id}` : "";

  const runningCount = windows.filter((w: any) => w.status === "running").length;
  const waitingCount = windows.filter((w: any) => w.status === "waiting").length;
  const doneCount = windows.filter((w: any) => w.status === "done").length;

  return (
    <div className="flex flex-col h-full bg-[#0a0c0a] overflow-hidden">
      <Topbar tick={tick} running={runningCount} waiting={waitingCount} done={doneCount} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar — 1/4 */}
        <Sidebar selected={selected} onSelect={handleSelectSession} conversations={conversations} />

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

          {/* Input bar */}
          <InputBar />
        </div>
      </div>
      {/* Live fleet modal — same data as /subagents-fleet, real-time logs, steer/stop like fleet inspector */}
      {modalAgentId && modalWin && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setModalAgentId(null)}>
          <div onClick={e=>e.stopPropagation()} style={{borderColor: AGENT_COLORS[modalWin.agent] || "#39ff6e"}} className="bg-[#0d100d] border rounded-sm max-w-[720px] w-full max-h-[85vh] flex flex-col overflow-hidden">
            {/* modal header */}
            <div style={{borderBottomColor: AGENT_COLORS[modalWin.agent] || "#39ff6e", backgroundColor: (AGENT_COLORS[modalWin.agent]||"#39ff6e")+"0d"}} className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span style={{color: AGENT_COLORS[modalWin.agent]||"#39ff6e"}} className="text-[11px] font-bold tracking-widest">[{modalWin.agent}]</span>
                <span className="text-[11px] text-[#c8e6c8] truncate">{modalWin.task}</span>
                <StatusDot status={modalWin.status as any} />
              </div>
              <button onClick={()=>setModalAgentId(null)} className="text-[#3d5c3d] hover:text-[#c8e6c8] text-[12px] px-2">✕</button>
            </div>
            {/* live log — same as fleet inspector transcript, polls every 1s via parent fetch */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-[#0a0c0a] min-h-[180px] max-h-[320px]">
              <div className="text-[9px] text-[#3d5c3d] tracking-widest uppercase mb-2 flex justify-between">
                <span>live log — synced to /subagents-fleet (status.json + output-*.log)</span>
                <span className="text-[#39ff6e] animate-pulse">● live {modalWin.elapsed}s</span>
              </div>
              {(modalWin.lines && modalWin.lines.length ? modalWin.lines : [{ts:"--",kind:"info" as const,text:"waiting for logs..."}]).map((l:any,i:number)=>(
                <div key={i} className="flex gap-2 text-[10px] leading-relaxed">
                  <span style={{color:"#3d5c3d"}} className="shrink-0 tabular-nums">{l.ts}</span>
                  <span style={{color: l.kind==="err"?"#ff4d4d": l.kind==="tool"?"#ffb547": l.kind==="info"?"#4da6ff":"#6b9b6b"}} className="break-all">{l.text}</span>
                </div>
              ))}
              {modalWin.status==="running" && <div className="flex gap-2 text-[10px] mt-2"><span style={{color:"#3d5c3d"}}>{new Date().toLocaleTimeString("en-GB")}</span><span style={{color: AGENT_COLORS[modalWin.agent]||"#39ff6e"}} className="cursor-blink">▋</span></div>}
            </div>
            {/* fleet actions like /subagents-fleet: steer / stop / transcript */}
            <div style={{borderTopColor:"#1e2b1e"}} className="border-t bg-[#0a0c0a] p-3 space-y-3 shrink-0">
              <div className="flex gap-2">
                <input value={steerMsg} onChange={e=>setSteerMsg(e.target.value)} placeholder="steer / follow_up message to live agent..." className="flex-1 bg-[#111411] border border-[#1e2b1e] text-[11px] text-[#c8e6c8] px-3 py-2 rounded-sm outline-none placeholder:text-[#3d5c3d]" onKeyDown={e=>{if(e.key==="Enter" && steerMsg.trim()){fetch(`/api/fleet/${modalWin.runId||modalWin.id}/steer`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:steerMsg, mode:steerMode})}); setSteerMsg("");}}} />
                <select value={steerMode} onChange={e=>setSteerMode(e.target.value as any)} className="bg-[#111411] border border-[#1e2b1e] text-[9px] text-[#6b9b6b] px-2 rounded-sm">
                  <option value="follow_up">follow_up</option><option value="steer">steer</option><option value="auto">auto</option>
                </select>
                <button onClick={()=>{if(!steerMsg.trim()) return; fetch(`/api/fleet/${modalWin.runId||modalWin.id}/steer`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:steerMsg, mode:steerMode})}); setSteerMsg("");}} style={{backgroundColor: AGENT_COLORS[modalWin.agent]||"#39ff6e", color:"#0a0c0a"}} className="px-4 py-2 text-[10px] font-bold rounded-sm">Send</button>
              </div>
              <div className="flex gap-2 text-[9px]">
                <button onClick={()=>{fetch(`/api/fleet/${modalWin.runId||modalWin.id}/stop`,{method:"POST"});}} style={{borderColor:"#ff4d4d", color:"#ff4d4d"}} className="flex-1 border py-2 rounded-sm hover:bg-[#ff4d4d14]">Stop (D)</button>
                <button onClick={()=>{navigator.clipboard.writeText(modalDockerCmd);}} style={{borderColor:"#1e2b1e", color:"#6b9b6b"}} className="flex-1 border py-2 rounded-sm hover:bg-[#1e2b1e]">Copy pi-vCLI</button>
                <button onClick={()=>setModalAgentId(null)} style={{borderColor:"#1e2b1e", color:"#3d5c3d"}} className="flex-1 border py-2 rounded-sm">Close</button>
              </div>
              <div style={{borderColor:"#1e2b1e"}} className="border bg-[#0a0c0a] p-2 rounded-sm">
                <div className="text-[9px] text-[#3d5c3d] uppercase">land in pi-vCLI (same session as fleet)</div>
                <code className="text-[10px] text-[#4da6ff] break-all">{modalCmd}</code>
                <div className="text-[9px] text-[#3d5c3d] uppercase mt-1">docker</div>
                <code className="text-[10px] text-[#ffb547] break-all">{modalDockerCmd}</code>
              </div>
              <div className="text-[9px] text-[#3d5c3d]">Fleet: {modalWin.model} · {modalWin.tokens} tok · {modalWin.elapsed}s · {modalWin.status} — updates every 1s from status.json + output-*.log</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
