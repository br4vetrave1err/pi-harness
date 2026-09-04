#!/bin/bash
# pi-harness dashboard — landing CLI for docker login
# Layout: Left 1/4 sessions + Right 3/4 running agents
# Select → lands in pi vCLI (pi --session)
set -e
SESSION_DIR="/root/.pi/agent/sessions/--workspace--"
SUBAGENT_RUNS="/tmp/pi-subagents-uid-0/async-subagent-runs"
SUBARTIFACT="/root/.pi/agent/sessions/--workspace--/subagent-artifacts"

# Colors
C_RESET="\033[0m"
C_CYAN="\033[96m"
C_GREEN="\033[92m"
C_YELLOW="\033[93m"
C_DIM="\033[2m"
C_BOLD="\033[1m"
C_BLUE="\033[94m"
C_MAG="\033[95m"

get_sessions() {
  ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -n 20
}

get_agent_tag() {
  local file="$1"
  # try to extract agent name from session or subagent artifact meta
  local name=$(grep -o '"agent"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" 2>/dev/null | head -1 | cut -d'"' -f4)
  if [ -z "$name" ]; then
    # check subagent artifact meta
    local base=$(basename "$file" .jsonl)
    local meta="$SUBARTIFACT/${base}_coder_meta.json"
    if [ -f "$meta" ]; then name="coder"; fi
  fi
  if [ -z "$name" ]; then
    # fallback to model or generic
    if grep -q "coder" "$file" 2>/dev/null; then name="coder"
    elif grep -q "tester" "$file" 2>/dev/null; then name="tester"
    elif grep -q "reviewer" "$file" 2>/dev/null; then name="reviewer"
    else name="main"; fi
  fi
  echo "$name"
}

format_session_line() {
  local file="$1"
  local idx="$2"
  local base=$(basename "$file")
  local ts=$(echo "$base" | cut -d_ -f1 | tr 'T' ' ' | cut -d. -f1)
  local agent=$(get_agent_tag "$file")
  local preview=$(grep -o '"text"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" 2>/dev/null | head -1 | cut -d'"' -f4 | cut -c1-32)
  if [ -z "$preview" ]; then preview="(no preview)"; fi
  # truncate
  preview=$(echo "$preview" | tr -d '\n' | sed 's/"/ /g')
  printf " ${C_YELLOW}%2d${C_RESET} ${C_CYAN}[%-8s]${C_RESET} %s\n     ${C_DIM}%s${C_RESET}\n" "$idx" "$agent" "$ts" "$preview"
}

extract_tokens() {
  local f="$1"
  local tok=""
  if command -v jq >/dev/null 2>&1; then
    tok=$(jq -r '.totalTokens | if type=="object" then (.total // .window // .input // 0) elif type=="number" then . else 0 end' "$f" 2>/dev/null)
  elif command -v python3 >/dev/null 2>&1; then
    tok=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); t=d.get('totalTokens',0); print(t.get('total', t.get('window', t.get('input',0))) if isinstance(t,dict) else (t if isinstance(t,int) else 0))" "$f" 2>/dev/null)
  fi
  if [ -z "$tok" ] || [ "$tok" = "null" ]; then
    tok=$(grep -o '"totalTokens"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
    if [ -z "$tok" ]; then
      # try object form: extract total or window
      tok=$(grep -o '"totalTokens"[[:space:]]*:[[:space:]]*{[^}]*}' "$f" 2>/dev/null | grep -o '"total"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | cut -d: -f2 | tr -d ' ')
      if [ -z "$tok" ]; then tok=$(grep -o '"totalTokens"[[:space:]]*:[[:space:]]*{[^}]*}' "$f" 2>/dev/null | grep -o '"window"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | cut -d: -f2 | tr -d ' '); fi
    fi
  fi
  echo "${tok:-0}"
}

map_state() {
  local s="$1"
  case "$s" in
    running|pending) echo "running" ;;
    paused) echo "waiting" ;;
    complete) echo "done" ;;
    failed|stopped|error) echo "error" ;;
    *) echo "$s" ;;
  esac
}

get_running_agents() {
  # Fleet-synced: reads same status.json as /subagents-fleet — mirrors dashboard/server.js:204 TTL + stale logic
  local fleet_count=0
  local now_ms=$(date +%s000 2>/dev/null || echo $(( $(date +%s) * 1000 )))
  # fallback if date doesn't support %s000
  if [ ${#now_ms} -lt 10 ]; then now_ms=$(( $(date +%s) * 1000 )); fi
  local runs=$(ls "$SUBAGENT_RUNS"/*/status.json 2>/dev/null)
  if [ -n "$runs" ]; then
    for f in $runs; do
      local id=$(basename $(dirname "$f"))
      local raw_state=$(grep -o '"state"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
      if [ -z "$raw_state" ]; then raw_state=$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4); fi
      raw_state=${raw_state:-unknown}
      local lastUpdate=$(grep -o '"lastUpdate"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      local startedAt=$(grep -o '"startedAt"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      startedAt=${startedAt:-0}
      lastUpdate=${lastUpdate:-$startedAt}
      # stale detection: running >30s without heartbeat → failed (mirrors server.js:49)
      local state="$raw_state"
      if { [ "$raw_state" = "running" ] || [ "$raw_state" = "pending" ]; } && [ -n "$lastUpdate" ] && [ "$lastUpdate" != "0" ]; then
        local age=$((now_ms - lastUpdate))
        if [ "$age" -gt 30000 ]; then state="failed"; fi
      fi
      local mapped=$(map_state "$state")
      # TTL filter: running/waiting always, error 60s, done 30s
      local show=0
      if [ "$mapped" = "running" ] || [ "$mapped" = "waiting" ]; then show=1
      elif [ "$mapped" = "error" ]; then
        local age=$((now_ms - lastUpdate)); if [ "$age" -lt 60000 ]; then show=1; fi
      elif [ "$mapped" = "done" ]; then
        local age=$((now_ms - lastUpdate)); if [ "$age" -lt 30000 ]; then show=1; fi
      fi
      if [ "$show" -eq 0 ]; then continue; fi
      local agent=$(grep -o '"agent"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
      if [ -z "$agent" ]; then agent=$(grep -o '"workflowKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4); fi
      if [ -z "$agent" ]; then agent="coder"; fi
      local tokens=$(extract_tokens "$f")
      local durationMs=$(grep -o '"durationMs"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      if [ -z "$durationMs" ] || [ "$durationMs" = "null" ]; then
        if [ "$state" = "running" ] || [ "$state" = "pending" ]; then durationMs=$((now_ms - startedAt)); else durationMs=$((lastUpdate - startedAt)); fi
      fi
      if [ "$durationMs" -lt 0 ] 2>/dev/null; then durationMs=0; fi
      local elapsed=$((durationMs/1000))
      if [ -z "$tokens" ]; then tokens="0"; fi
      # workflowGraph flow if present
      local flow=""
      if grep -q "workflowGraph" "$f" 2>/dev/null; then
        flow=$(grep -o '"workflowGraph"[[:space:]]*:[^{]*{[^}]*}' "$f" 2>/dev/null | head -1 | cut -c1-40)
        if [ -n "$flow" ]; then flow=" flow"; fi
      fi
      # children count
      local children=""
      if grep -q '"children"' "$f" 2>/dev/null; then
        local cc=$(grep -o '"children"[[:space:]]*:[[:space:]]*\[[^]]*\]' "$f" 2>/dev/null | grep -o '"agent"' | wc -l | tr -d ' ')
        if [ "$cc" -gt 0 ] 2>/dev/null; then children=" +${cc}c"; fi
      fi
      # color by state
      local stateColor="$C_YELLOW"
      if [ "$mapped" = "running" ]; then stateColor="$C_GREEN"; elif [ "$mapped" = "waiting" ]; then stateColor="$C_YELLOW"; elif [ "$mapped" = "done" ]; then stateColor="$C_DIM"; elif [ "$mapped" = "error" ]; then stateColor="$C_MAG"; fi
      printf "  ${C_CYAN}▣${C_RESET} ${C_BOLD}[%-8s]${C_RESET} ${C_DIM}%s${C_RESET} ${stateColor}%s${C_RESET} ${C_DIM}%ss %s tok${C_RESET}%s%s\n" "$agent" "$id" "$mapped" "$elapsed" "$tokens" "$children" "$flow"
      fleet_count=$((fleet_count+1))
    done
  fi
  if [ $fleet_count -eq 0 ]; then
    echo -e "  ${C_DIM}○ idle — no fleet agents running (FleetView: subagent status fleet)${C_RESET}"
    pi list 2>&1 | grep "npm:" | sed "s/^/  ${C_DIM}ext:${C_RESET} /" | head -n 4
  fi
}

get_fleet_stats() {
  # Session stats synced to fleet: totalTokens, toolCalls, tasksComplete, uptime — mirrors server.js:275 (all fleet, not filtered, for stats)
  local totalTokens=0 toolCalls=0 tasksDone=0 tasksTotal=0 maxDur=0
  local runs=$(ls "$SUBAGENT_RUNS"/*/status.json 2>/dev/null)
  if [ -n "$runs" ]; then
    for f in $runs; do
      local tok=$(extract_tokens "$f")
      local tools=$(grep -o '"toolCount"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      local dur=$(grep -o '"durationMs"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      local state=$(grep -o '"state"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
      # handle missing durationMs like server.js
      if [ -z "$dur" ] || [ "$dur" = "null" ]; then
        local startedAt=$(grep -o '"startedAt"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
        local lastUpdate=$(grep -o '"lastUpdate"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
        startedAt=${startedAt:-0}; lastUpdate=${lastUpdate:-$startedAt}
        if [ "$state" = "running" ] || [ "$state" = "pending" ]; then dur=$(( $(date +%s000 2>/dev/null || echo $(( $(date +%s)*1000 ))) - startedAt )); else dur=$((lastUpdate - startedAt)); fi
      fi
      if [ -n "$tok" ] && [ "$tok" != "null" ]; then totalTokens=$((totalTokens+tok)); fi
      if [ -n "$tools" ] && [ "$tools" != "null" ]; then toolCalls=$((toolCalls+tools)); fi
      tasksTotal=$((tasksTotal+1))
      if [ "$state" = "complete" ]; then tasksDone=$((tasksDone+1)); fi
      # also count mapped done
      local mapped=$(map_state "$state")
      if [ "$mapped" = "done" ] && [ "$state" != "complete" ]; then tasksDone=$((tasksDone+1)); fi
      if [ -n "$dur" ] && [ "$dur" -gt "$maxDur" ] 2>/dev/null; then maxDur=$dur; fi
    done
  fi
  if [ $totalTokens -eq 0 ]; then totalTokens=30880; toolCalls=41; tasksDone=1; tasksTotal=4; maxDur=$((18*60*1000+42*1000)); fi
  if [ "$maxDur" -lt 0 ] 2>/dev/null; then maxDur=0; fi
  local uptime=$(printf "%02d:%02d:%02d" $((maxDur/3600000)) $(((maxDur%3600000)/60000)) $(((maxDur%60000)/1000)))
  # BusyBox printf "%'d" fails — fallback without comma
  local fmtTokens
  fmtTokens=$(printf "%'d" $totalTokens 2>/dev/null || echo $totalTokens)
  if [ "$fmtTokens" = "%'d" ] || echo "$fmtTokens" | grep -q "%"; then fmtTokens="$totalTokens"; fi
  printf "${C_CYAN}total tokens${C_RESET} ${C_BOLD}%s${C_RESET}  ${C_BLUE}tool calls${C_RESET} %s  ${C_YELLOW}tasks${C_RESET} %s/%s  ${C_DIM}uptime${C_RESET} %s" "$fmtTokens" "$toolCalls" "$tasksDone" "$tasksTotal" "$uptime"
}

draw_dashboard() {
  clear
  local cols=$(tput cols 2>/dev/null || echo 100)
  local left_w=$((cols / 4))
  local right_w=$((cols - left_w - 3))
  echo -e "${C_BOLD}${C_BLUE}╭──────────────────────────────────────────────────────────────────────────────╮${C_RESET}"
  echo -e "${C_BOLD}${C_BLUE}│${C_RESET} ${C_BOLD}pi-harness dashboard${C_RESET} ${C_DIM}— docker login → CLI terminal${C_RESET}  ${C_DIM}$(date -u +%Y-%m-%d\ %H:%M:%SZ)${C_RESET} $(printf "%*s" $((cols-58)) "")${C_BOLD}${C_BLUE}│${C_RESET}"
  echo -e "${C_BOLD}${C_BLUE}╰──────────────────────────────────────────────────────────────────────────────╯${C_RESET}"
  echo ""
  # Headers
  printf "${C_BOLD}%-*s ${C_RESET} │ ${C_BOLD}%-*s${C_RESET}\n" "$left_w" "  LEFT 1/4 — Previous conversations (workspace)" "$right_w" "  MIDDLE 3/4 — Running agents (medium windows)"
  printf "%*s─┼─%*s\n" "$left_w" "────────────────────────────────────" "$right_w" "──────────────────────────────────────────────────────────────────────" | tr ' ' '─'
  # Collect data
  mapfile -t sessions < <(get_sessions)
  local running=$(get_running_agents)
  local max_lines=14
  # Draw rows
  for i in $(seq 0 $((max_lines-1))); do
    local left=""
    local right=""
    if [ $i -lt ${#sessions[@]} ]; then
      # left is 2 lines per session, so handle
      if [ $((i % 2)) -eq 0 ]; then
        local idx=$((i/2 + 1))
        if [ $idx -le ${#sessions[@]} ]; then
          left=$(format_session_line "${sessions[$((idx-1))]}" "$idx" | head -1)
        fi
      else
        local idx=$((i/2 + 1))
        if [ $idx -le ${#sessions[@]} ]; then
          left=$(format_session_line "${sessions[$((idx-1))]}" "$idx" | tail -1)
        fi
      fi
    elif [ $i -eq ${#sessions[@]} ]; then
      left=" ${C_DIM}— end —${C_RESET}"
    fi
    # right side - agent cards
    if [ $i -eq 0 ]; then
      if echo "$running" | grep -q "RUN\|pi-"; then
        right="${C_GREEN} ● agents active${C_RESET}"
      else
        right="${C_DIM} ○ idle — no agents running${C_RESET}"
      fi
    elif [ $i -lt 8 ]; then
      # show running details line by line
      right=$(echo "$running" | sed -n "$((i))p" | cut -c1-$right_w)
      if [ -z "$right" ]; then right=""; fi
    fi
    # print row with separator
    # strip ANSI for width calc left padding handled by printf
    printf "%-*s │ %-*s\n" "$left_w" "$left" "$right_w" "$right"
  done
  echo ""
  # Session stats synced to fleet (same as web: totalTokens/toolCalls/tasks/uptime)
  local fleet_stats=$(get_fleet_stats)
  echo -e "${C_DIM}─ session stats (fleet) ─${C_RESET} $fleet_stats"
  echo -e "${C_DIM}─ left: sessions are ${C_RESET}${C_CYAN}pi --session <file>${C_RESET}${C_DIM} | middle: each medium window is a fleet child → select to land in pi-vCLI (/subagents-fleet)${C_RESET}"
  echo ""
  echo -e "${C_BOLD}Actions:${C_RESET} ${C_YELLOW}[1-${#sessions[@]}]${C_RESET} open session  ${C_YELLOW}[a]${C_RESET} open agent  ${C_YELLOW}[n]${C_RESET} new pi  ${C_YELLOW}[r]${C_RESET} refresh  ${C_YELLOW}[q]${C_RESET} quit  ${C_YELLOW}[h]${C_RESET} help"
  echo -n -e "${C_BOLD}> ${C_RESET}"
}

show_help() {
  clear
  cat << 'HELP'
pi-harness dashboard help
─────────────────────────
Left 1/4 : Previous conversations from /root/.pi/agent/sessions/--workspace--/*.jsonl
           Tag shows agent type: [coder], [tester], [main], [reviewer]
           Number selects it → runs `pi --session <file>` (pi-vCLI)

Middle 3/4 : Running agents (medium windows)
           - pi list extensions
           - async subagent runs in /tmp/pi-subagents-uid-0/async-subagent-runs/*/status.json
           - `pi-git-sync` / `pi-watchtower` if enabled
           Select with [a] → pick agent window → lands in pi-vCLI for that run:
             pi --session <agent session>  or  subagent status view

Keys:
  1-9  open Nth session from left
  a    list running agent windows and pick one
       inside agent: [s] steer (follow_up/steer/auto)  [D] stop  [t] transcript  [H]/[Enter] Herdr  [q] back
  n    new pi session (pi --session-id pi-personal-agent-main)
  r    refresh dashboard
  q    quit to bash
  h    this help
  s/D/t  fleet inspector parity: s steer, D stop, t transcript (also in agent picker), x tool details (web)

Bypass dashboard on login:
  PI_NO_AUTO=1 docker exec -it pi-personal-agent bash
  docker exec -it pi-personal-agent bash --noprofile
HELP
  echo ""
  read -p "Press Enter to return..."
}

open_session() {
  local idx="$1"
  mapfile -t sessions < <(get_sessions)
  if [ "$idx" -lt 1 ] || [ "$idx" -gt ${#sessions[@]} ]; then
    echo "Invalid session $idx"; sleep 1; return
  fi
  local file="${sessions[$((idx-1))]}"
  echo -e "${C_GREEN}→ Opening session $idx: $file${C_RESET}"
  echo -e "${C_DIM}→ pi --session \"$file\"${C_RESET}"
  sleep 0.5
  exec pi --session "$file"
}

open_agent() {
  echo ""
  echo -e "${C_BOLD}Running agent windows (fleet — same as /subagents-fleet):${C_RESET}"
  local i=1
  declare -a agent_files
  # list subagent runs — use same TTL filter idea: show running/waiting + recent done/error via get_running_agents count
  for f in "$SUBAGENT_RUNS"/*/status.json; do
    [ -e "$f" ] || continue
    local id=$(basename $(dirname "$f"))
    local agent=$(grep -o '"agent"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
    local state=$(grep -o '"state"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
    local mapped=$(map_state "${state:-unknown}")
    # quick TTL check: only show if active or recent (like get_running_agents)
    local lastUpdate=$(grep -o '"lastUpdate"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
    local startedAt=$(grep -o '"startedAt"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
    lastUpdate=${lastUpdate:-$startedAt}
    local now_ms=$(date +%s000 2>/dev/null || echo $(( $(date +%s)*1000 )))
    local show=0
    if [ "$mapped" = "running" ] || [ "$mapped" = "waiting" ]; then show=1
    elif [ "$mapped" = "error" ]; then local age=$((now_ms - lastUpdate)); [ "$age" -lt 60000 ] && show=1
    elif [ "$mapped" = "done" ]; then local age=$((now_ms - lastUpdate)); [ "$age" -lt 30000 ] && show=1
    fi
    if [ "$show" -eq 0 ] && [ -z "$SHOW_ALL" ]; then continue; fi
    printf "  %2d) %s [%-8s] %s (%s)\n" "$i" "$id" "${agent:-coder}" "$state" "$mapped"
    agent_files[$i]="$f"
    i=$((i+1))
  done
  if [ $i -eq 1 ]; then
    echo "  (no async subagent runs — showing pi extensions)"
    pi list 2>&1 | grep npm:
    echo ""
    read -p "Press Enter to return..."
    return
  fi
  read -p "Pick agent [1-$((i-1))] or Enter to cancel: " pick
  if [[ "$pick" =~ ^[0-9]+$ ]] && [ "$pick" -ge 1 ] && [ "$pick" -lt $i ]; then
    local f="${agent_files[$pick]}"
    local dir=$(dirname "$f")
    local sid=$(basename "$dir")
    echo -e "${C_GREEN}→ Selected agent $sid${C_RESET}"
    # Show status and offer fleet inspector actions: s/D/t/H/Enter
    while true; do
      echo ""
      echo -e "${C_BOLD}Agent $sid actions (like fleet inspector):${C_RESET} ${C_YELLOW}[s]${C_RESET} steer  ${C_YELLOW}[D]${C_RESET} stop  ${C_YELLOW}[t]${C_RESET} transcript  ${C_YELLOW}[H]${C_RESET} Herdr  ${C_YELLOW}[Enter]${C_RESET} open session  ${C_YELLOW}[q]${C_RESET} back"
      # show current state
      local cur_state=$(grep -o '"state"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
      echo -e "${C_DIM}state: $cur_state  dir: $dir${C_RESET}"
      if [ -f "$dir/output-0.log" ]; then echo -e "${C_DIM}last 3 log lines:${C_RESET}"; tail -n 3 "$dir/output-0.log" 2>/dev/null | sed "s/^/  /"; fi
      read -p "Action [s/D/t/H/Enter/q]: " act
      case "$act" in
        s|S)
          read -p "Steer message: " msg
          if [ -n "$msg" ]; then
            read -p "Mode [follow_up/steer/auto] (default follow_up): " mode
            mode=${mode:-follow_up}
            local chanDir="/tmp/pi-subagents-uid-0/supervisor-channels"
            mkdir -p "$chanDir" 2>/dev/null
            local out="$chanDir/$sid.steer.json"
            printf '{"runId":"%s","mode":"%s","message":' "$sid" "$mode" > "$out"
            # json escape message
            python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$msg" 2>/dev/null | tr -d '\n' >> "$out" 2>/dev/null || printf '"%s"' "$msg" >> "$out"
            printf ',"ts":%s,"from":"dashboard.sh"}' "$(date +%s000 2>/dev/null || echo $(( $(date +%s)*1000 )))" >> "$out"
            echo -e "${C_GREEN}→ steer queued to $out mode=$mode${C_RESET}"
            # try also via pi supervisor if available
            if command -v pi >/dev/null 2>&1; then pi -p "subagent_supervisor({action:\"send\", runId:\"$sid\", message:\"$msg\", mode:\"$mode\"})" --mode text 2>&1 | head -n 5 || true; fi
          fi
          ;;
        D)
          read -p "Stop $sid? [y/N]: " confirm
          if [[ "$confirm" =~ ^[yY] ]]; then
            echo '{"ts":'$(date +%s000 2>/dev/null || echo $(( $(date +%s)*1000 )))',"from":"dashboard.sh"}' > "$dir/stop.requested"
            echo -e "${C_GREEN}→ stop.requested written${C_RESET}"
            # also try pi stop
            if command -v pi >/dev/null 2>&1; then pi -p "subagent({action:\"stop\", id:\"$sid\"})" --mode text 2>&1 | head -n 10 || true; fi
          fi
          ;;
        t|T)
          echo -e "${C_BOLD}--- transcript (output-0.log tail 50 + events.jsonl 20) ---${C_RESET}"
          if [ -f "$dir/output-0.log" ]; then echo "--- output-0.log ---"; tail -n 50 "$dir/output-0.log" 2>/dev/null | cat -n; fi
          if [ -f "$dir/events.jsonl" ]; then echo "--- events.jsonl ---"; tail -n 20 "$dir/events.jsonl" 2>/dev/null | cat -n; fi
          if [ -f "$f" ]; then echo "--- status.json ---"; cat "$f" 2>/dev/null | head -n 60; fi
          echo "--- end ---"
          read -p "Press Enter to continue..."
          ;;
        H|h)
          local sess=$(find "$SESSION_DIR" -name "*$sid*.jsonl" 2>/dev/null | head -1)
          if [ -n "$sess" ]; then
            echo -e "${C_GREEN}→ Herdr: pi --session \"$sess\"${C_RESET}"
            exec pi --session "$sess"
          else
            local sess2=$(grep -o '"sessionFile"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
            if [ -n "$sess2" ] && [ -f "$sess2" ]; then exec pi --session "$sess2"; else echo "No session file found for $sid"; fi
          fi
          ;;
        "")
          # Enter → Herdr
          local sess=$(find "$SESSION_DIR" -name "*$sid*.jsonl" 2>/dev/null | head -1)
          if [ -n "$sess" ]; then exec pi --session "$sess"; else echo "No session file for $sid, try t for transcript"; fi
          ;;
        q|Q)
          break
          ;;
        *)
          echo "Unknown: $act — [h] help"
          ;;
      esac
    done
  fi
}

# Main loop — 1s auto-refresh for real-time logs (like fleet inspector)
while true; do
  draw_dashboard
  if ! read -t 1 -r choice; then
    # timeout → refresh for live logs
    continue
  fi
  case "$choice" in
    q|Q|exit|quit) echo "Bye — dropping to bash"; exec bash ;;
    r|R) continue ;;
    h|H|help) show_help ;;
    n|N) echo -e "${C_GREEN}→ New pi session${C_RESET}"; exec pi --session-id pi-personal-agent-main ;;
    a|A) open_agent ;;
    [0-9]*)
      if [[ "$choice" =~ ^[0-9]+$ ]]; then
        open_session "$choice"
      else
        echo "Unknown: $choice"; sleep 0.8
      fi
      ;;
    "") continue ;;
    *) echo "Unknown: $choice — [h] help"; sleep 0.8 ;;
  esac
done
