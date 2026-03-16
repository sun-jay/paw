#!/bin/zsh
# Launches a Claude Code session for a scheduled task.
# Captures the remote control URL and writes it to ~/.claude/remote-url.txt
# for the UserPromptSubmit hook to inject into context.
#
# Usage:
#   launch-agent.sh <prompt> [claude flags...]
#   launch-agent.sh --interactive [claude flags...]
#
# Examples:
#   launch-agent.sh "Run the daily brief and send via iMessage" --dangerously-skip-permissions
#   launch-agent.sh --interactive --dangerously-skip-permissions

PAW_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="$HOME/.claude/remote-url.txt"
LOG_DIR="$PAW_ROOT/heartbeat/logs"
LOG_FILE="/tmp/paw-launch-$$.log"

mkdir -p "$LOG_DIR"

: > "$URL_FILE"
: > "$LOG_FILE"

# Parse args
PROMPT=""
INTERACTIVE=false
CLAUDE_ARGS=()

if [ "$1" = "--interactive" ]; then
  INTERACTIVE=true
  shift
else
  PROMPT="$1"
  shift
fi
CLAUDE_ARGS=("$@")

# Background watcher: extract URL from terminal output
(
  while true; do
    url=$(sed 's/\x1b\[[0-9;]*m//g' "$LOG_FILE" 2>/dev/null \
      | grep -o 'https://claude\.ai/code/session_[a-zA-Z0-9_]*' \
      | head -1)
    if [ -n "$url" ]; then
      echo "$url" > "$URL_FILE"
      break
    fi
    sleep 0.3
  done
) &
WATCHER_PID=$!

TIMESTAMP=$(date +%Y%m%d-%H%M%S)

if [ "$INTERACTIVE" = true ]; then
  script -q "$LOG_FILE" claude "${CLAUDE_ARGS[@]}"
else
  # Non-interactive: use --print for headless execution, log output
  RUN_LOG="$LOG_DIR/run-$TIMESTAMP.log"
  claude --print --dangerously-skip-permissions \
    --system-prompt "You are PAW, Sunny's personal agent. Read CLAUDE.md and memory/memory.md for context. Your working directory is $PAW_ROOT." \
    "${CLAUDE_ARGS[@]}" \
    "$PROMPT" 2>&1 | tee "$LOG_FILE" > "$RUN_LOG"
  echo "--- Run completed at $(date) ---" >> "$RUN_LOG"
fi

# Cleanup
kill $WATCHER_PID 2>/dev/null
rm -f "$LOG_FILE"
