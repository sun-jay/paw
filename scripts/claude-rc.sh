#!/bin/zsh
# Starts Claude Code, captures the remote control URL from terminal output,
# and writes it to ~/.claude/remote-url.txt for the UserPromptSubmit hook
# to inject into Claude's context.
#
# Usage: claude-rc.sh [claude flags...]

URL_FILE="$HOME/.claude/remote-url.txt"
LOG_FILE="/tmp/claude-rc-$$.log"
: > "$URL_FILE"
: > "$LOG_FILE"

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

# Run claude interactively with output capture
script -q "$LOG_FILE" claude "$@"

# Cleanup
kill $WATCHER_PID 2>/dev/null
rm -f "$LOG_FILE"
