# PAW — Personal Agent Workspace


## Project Defaults

- Runtime: **Bun** (never Node)
- Language: **TypeScript** (strict mode, no build step)
- Secrets: only `OP_SERVICE_ACCOUNT_TOKEN` lives in `.env` — everything else goes through 1Password via the secretsmanager skill
- Never log, print, or expose secret values in output
- Skills live in `skills/<name>/` — see `skills/how_to_use_skills.md` for conventions

## Skills

- Skills live in `skills/<name>/` — each has a `skill.md` (frontmatter + docs) and optional `functions.ts`
- Read `skills/how_to_use_skills.md` for conventions on creating, activating, and wiring secrets
- To use a skill: `activate("skillname")` from `skills/secretsmanager/functions.ts`, then import its functions
- The secretsmanager skill is the bootstrap — it handles activation, dependency resolution, and 1Password secret injection for all other skills

## Custom Instructions

<!-- Add your own project-specific instructions below this line -->
