# PAW — Personal Agent Workspace


## Project Defaults

- Runtime: **Bun** (never Node)
- Language: **TypeScript** (strict mode, no build step)
- Secrets: only `OP_SERVICE_ACCOUNT_TOKEN` lives in `.env` — everything else goes through 1Password via the secretsmanager skill
- Never log, print, or expose secret values in output
- Skills live in `skills/<name>/` — see `skills/how_to_use_skills.md` for conventions

## Skills

- Skills live in `skills/<name>/` — each has a `skill.yml` (frontmatter + docs) and optional `functions.ts`
- **Before answering questions about external services, APIs, or "what can you do"**: scan `skills/` to see what integrations exist and read their `skill.yml` for capabilities
- Read `skills/how_to_use_skills.md` for conventions on creating, activating, and wiring secrets
- To use a skill: `activate("skillname")` from `skills/secretsmanager/functions.ts`, then import its functions
- The secretsmanager skill is the bootstrap — it handles activation, dependency resolution, and 1Password secret injection for all other skills

## Memory

- Long-term memory lives in `memory/` at the project root
- `memory/MEMORY.md` is the main file — curated facts, preferences, key decisions, and project knowledge
- Additional topic files (e.g., `memory/debugging.md`, `memory/patterns.md`) can be created for detailed notes; link to them from MEMORY.md
- **Before answering questions about prior work, decisions, preferences, or project history**: read `memory/MEMORY.md` and any relevant topic files
- **After learning something durable** (confirmed patterns, user preferences, architectural decisions, solved problems): update the relevant memory file
- Every memory entry must include a timestamp: `<!-- added: YYYY-MM-DD -->`
- Organize memory by topic, not chronologically — update existing sections rather than appending
- Keep MEMORY.md concise; move detailed notes to topic files
- Do not store session-specific or in-progress work in memory — only write confirmed, durable knowledge

## Custom Instructions

<!-- Add your own project-specific instructions below this line -->
