# Memory

## Project Architecture
<!-- added: 2026-03-12 -->
- PAW uses Bun + TypeScript, skills framework with `skill.yml` config and `functions.ts` implementation
- Secrets managed via 1Password (`personal_agent_workspace` vault), bootstrapped by secretsmanager skill
- Only `OP_SERVICE_ACCOUNT_TOKEN` stored locally in `.env`; everything else via `op://` references

## Active Skills
<!-- added: 2026-03-12 -->
- **secretsmanager** — bootstrap skill, handles activation + 1Password integration
- **edstem** — Ed Discussion API (threads, courses, announcements). Secret: `ED_API_TOKEN`

## Known Course IDs (Ed)
<!-- added: 2026-03-12 -->
- STAT 135 Spring 2026: 94278 (active)
- STAT 134 Fall 2025: 84963 (archived)
- STAT 133: 84260 (active)
- EECS 101: 23247 (active)
- Stat 001 community: 26372 (active)
- IEOR 198 Intro to Quant Finance: 94543 (active)

## User Preferences
<!-- added: 2026-03-12 -->
- Timezone: America/Los_Angeles (Pacific Time)
- Prefers concise output, no over-engineering
- Ed links must use full format: `https://edstem.org/us/courses/{courseId}/discussion/{threadId}`
