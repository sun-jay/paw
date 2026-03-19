#!/bin/zsh
# Launches a Claude Code session in a new Terminal.app window.
# Captures the remote control URL and writes it to ~/.claude/remote-url.txt
# for the UserPromptSubmit hook to inject into context.
#
# Usage:
#   launch-agent.sh "Run the daily brief..."     # new terminal with initial prompt
#   launch-agent.sh --interactive                 # new terminal, no prompt

PAW_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="$HOME/.claude/remote-url.txt"
RUNNER="/tmp/paw-runner-$$.sh"

: > "$URL_FILE"

# Parse args
PROMPT=""
if [ "$1" = "--interactive" ]; then
  PROMPT=""
else
  PROMPT="$1"
fi

# Write the runner script that executes inside the new terminal
cat > "$RUNNER" <<RUNNER_EOF
#!/bin/zsh
cd "${PAW_ROOT}"
URL_FILE="\$HOME/.claude/remote-url.txt"
LOG_FILE="/tmp/paw-capture-\$\$.log"
: > "\$URL_FILE"
: > "\$LOG_FILE"

# Background watcher: strip control chars and find the session URL
(
  while true; do
    url=\$(cat "\$LOG_FILE" 2>/dev/null \\
      | LC_ALL=C tr -d '\000-\010\013\014\016-\037' \\
      | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' \\
      | grep -o 'https://claude\.ai/code/session_[a-zA-Z0-9_]*' \\
      | head -1)
    if [ -n "\$url" ]; then
      echo "\$url" > "\$URL_FILE"
      break
    fi
    sleep 0.5
  done
) &
WATCHER_PID=\$!

RUNNER_EOF

if [ -n "$PROMPT" ]; then
  cat >> "$RUNNER" <<RUNNER_EOF
script -q "\$LOG_FILE" claude --dangerously-skip-permissions $(printf '%q' "$PROMPT")
RUNNER_EOF
else
  cat >> "$RUNNER" <<RUNNER_EOF
script -q "\$LOG_FILE" claude --dangerously-skip-permissions
RUNNER_EOF
fi

cat >> "$RUNNER" <<'RUNNER_EOF'

kill $WATCHER_PID 2>/dev/null
rm -f "$LOG_FILE"
RUNNER_EOF

chmod +x "$RUNNER"

# Open a new Terminal.app window running the script
osascript -e "tell application \"Terminal\"
  activate
  do script \"${RUNNER}\"
end tell"
