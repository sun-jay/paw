# PAW — Personal Agent Workspace

A skill-based personal assistant powered by Claude Code. Built with Bun + TypeScript.

## Structure

- **`skills/`** — Modular integrations (Gmail, Google Calendar, Canvas, Ed, etc.), each with a `skill.yml` and optional `functions.ts`
- **`memory/`** — Persistent knowledge store so the agent remembers context across sessions
- **`storage/`** — Scratch directory for generated files (gitignored)

## Setup

1. Install [Bun](https://bun.sh)
2. `bun install`
3. Add `OP_SERVICE_ACCOUNT_TOKEN` to `.env` — all other secrets are managed via the `secretsmanager` skill through 1Password

## Skills

| Skill | Purpose |
|-------|---------|
| `secretsmanager` | Bootstrap skill — activates other skills and injects secrets from 1Password |
| `gws-mail` | Gmail integration |
| `calevents-api` | Google Calendar events |
| `canvas` | Canvas LMS |
| `edstem` | Ed Discussion |
| `daily-brief` | Daily summary/briefing |
| `scheduler` | Task scheduling |

See `skills/how_to_use_skills.md` for conventions on creating new skills.
