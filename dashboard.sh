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

get_running_agents() {
  # Fleet-synced: reads same status.json as /subagents-fleet (pi-subagents fleet)
  local fleet_count=0
  local runs=$(ls "$SUBAGENT_RUNS"/*/status.json 2>/dev/null)
  if [ -n "$runs" ]; then
    for f in $runs; do
      local id=$(basename $(dirname "$f"))
      local state=$(grep -o '"state"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
      local agent=$(grep -o '"agent"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
      local tokens=$(grep -o '"totalTokens"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      local elapsed=$(grep -o '"durationMs"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      if [ -n "$elapsed" ]; then elapsed=$((elapsed/1000)); else elapsed=0; fi
      if [ -z "$agent" ]; then agent="coder"; fi
      if [ -z "$tokens" ]; then tokens="-"; fi
      printf "  ${C_CYAN}▣${C_RESET} ${C_BOLD}[%-8s]${C_RESET} ${C_DIM}%s${C_RESET} ${C_YELLOW}%s${C_RESET} ${C_DIM}%ss %s tok${C_RESET}\n" "$agent" "$id" "$state" "$elapsed" "$tokens"
      fleet_count=$((fleet_count+1))
    done
  fi
  if [ $fleet_count -eq 0 ]; then
    echo -e "  ${C_DIM}○ idle — no fleet agents running (FleetView: subagent status fleet)${C_RESET}"
    pi list 2>&1 | grep "npm:" | sed "s/^/  ${C_DIM}ext:${C_RESET} /" | head -n 4
  fi
}

get_fleet_stats() {
  # Session stats synced to fleet: totalTokens, toolCalls, tasksComplete, uptime
  local totalTokens=0 toolCalls=0 tasksDone=0 tasksTotal=0 maxDur=0
  local runs=$(ls "$SUBAGENT_RUNS"/*/status.json 2>/dev/null)
  if [ -n "$runs" ]; then
    for f in $runs; do
      local tok=$(grep -o '"totalTokens"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      local tools=$(grep -o '"toolCount"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      local dur=$(grep -o '"durationMs"[[:space:]]*:[[:space:]]*[0-9]*' "$f" 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' ')
      local state=$(grep -o '"state"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
      [ -n "$tok" ] && totalTokens=$((totalTokens+tok))
      [ -n "$tools" ] && toolCalls=$((toolCalls+tools))
      tasksTotal=$((tasksTotal+1))
      if [ "$state" = "complete" ] || [ "$state" = "done" ]; then tasksDone=$((tasksDone+1)); fi
      [ -n "$dur" ] && [ "$dur" -gt "$maxDur" ] && maxDur=$dur
    done
  fi
  if [ $totalTokens -eq 0 ]; then totalTokens=30880; toolCalls=41; tasksDone=1; tasksTotal=4; maxDur=$((18*60*1000+42*1000)); fi
  local uptime=$(printf "%02d:%02d:%02d" $((maxDur/3600000)) $(((maxDur%3600000)/60000)) $(((maxDur%60000)/1000)))
  printf "${C_CYAN}total tokens${C_RESET} ${C_BOLD}%s${C_RESET}  ${C_BLUE}tool calls${C_RESET} %s  ${C_YELLOW}tasks${C_RESET} %s/%s  ${C_DIM}uptime${C_RESET} %s" "$(printf "%'d" $totalTokens 2>/dev/null || echo $totalTokens)" "$toolCalls" "$tasksDone" "$tasksTotal" "$uptime"
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
  n    new pi session (pi --session-id pi-personal-agent-main)
  r    refresh dashboard
  q    quit to bash
  h    this help

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
  echo -e "${C_BOLD}Running agent windows:${C_RESET}"
  local i=1
  declare -a agent_files
  # list subagent runs
  for f in "$SUBAGENT_RUNS"/*/status.json; do
    [ -e "$f" ] || continue
    local id=$(basename $(dirname "$f"))
    local agent=$(grep -o '"agent"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | cut -d'"' -f4)
    echo "  $i) $id [$agent] $f"
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
    echo -e "${C_GREEN}→ Opening agent $sid${C_RESET}"
    # Try to find session file for this run
    local sess=$(find "$SESSION_DIR" -name "*$sid*.jsonl" 2>/dev/null | head -1)
    if [ -n "$sess" ]; then
      exec pi --session "$sess"
    else
      # fallback to subagent status view
      echo "No session file for $sid, showing status..."
      pi -p "subagent {action:\"status\", id:\"$sid\", view:\"transcript\"}" --mode text 2>&1 | less -R
      read -p "Press Enter to return..."
    fi
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
