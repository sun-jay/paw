# PAW — Personal Agent Workspace


## Project Defaults

- Runtime: **Bun** (never Node)
- Language: **TypeScript** (strict mode, no build step)
- Secrets: only `OP_SERVICE_ACCOUNT_TOKEN` lives in `.env` — everything else goes through 1Password via the secretsmanager skill
- Never log, print, or expose secret values in output
- Skills live in `skills/<name>/` — see `skills/how_to_use_skills.md` for conventions

## Custom Instructions

<!-- Add your own project-specific instructions below this line -->
