# PAW — Personal Agent Workspace

PAW turns a repo + Claude Code into a personal agent. You run Claude Code inside this project and it becomes an assistant that can read your email, check your calendar, pull your coursework, and run tasks on a schedule — all through a modular skill system.

## How It Works

1. **Run Claude Code in this repo** — the `CLAUDE.md` file configures it as a personal assistant, not just a coding tool.
2. **Skills** (`skills/`) are modular integrations — Gmail, Google Calendar, Canvas LMS, Ed Discussion, etc. Each skill has a `skill.yml` (config + docs) and a `functions.ts` (API logic). Skills declare their secrets as 1Password references; activation handles the rest.
3. **Memory** (`memory/`) gives the agent persistent knowledge across sessions — preferences, decisions, facts, and project context. It updates automatically when you correct it or tell it something new.
4. **Scheduler** (`heartbeat/`) runs the agent autonomously on a cron schedule via launchd. Define tasks in `schedule.json` and the dispatcher launches headless Claude Code sessions to execute them — daily briefs, periodic checks, whatever you want.

## Setup

1. Install [Bun](https://bun.sh)
2. `bun install`
3. Add `OP_SERVICE_ACCOUNT_TOKEN` to `.env` — all other secrets are managed through 1Password via the `secretsmanager` skill
4. Run `claude` in the project root

## Adding Skills

Each skill lives in `skills/<name>/` with a `skill.yml` and optional `functions.ts`. Secrets are stored in 1Password and injected at activation time — nothing is hardcoded. See `skills/how_to_use_skills.md` for the full guide.
