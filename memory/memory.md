# Memory

## Project Architecture
<!-- updated: YYYY-MM-DD -->
- PAW uses Bun + TypeScript, skills framework with `skill.yml` config and `functions.ts` implementation
- Secrets managed via 1Password (`paw_vault` vault), bootstrapped by secretsmanager skill
- Only `OP_SERVICE_ACCOUNT_TOKEN` stored locally in `.env`; everything else via `op://` references

## Active Skills
<!-- updated: YYYY-MM-DD -->
- **secretsmanager** — bootstrap skill, handles activation + 1Password integration
- **edstem** — Ed Discussion API (threads, courses, announcements). Secret: `ED_API_TOKEN`
- **canvas** — Canvas LMS API (assignments, submissions, announcements). Secret: `CANVAS_API_TOKEN`
- **gws-mail** — Google Workspace email via GWS CLI. Secrets: `GWS_CLIENT_ID`, `GWS_CLIENT_SECRET`, `GWS_REFRESH_TOKEN`
- **daily-brief** — orchestrates canvas, edstem, gws-mail into combined brief
- **calevents-api** — CalEvents (calevents.app) public API. No secrets needed

## User Profile
<!-- updated: YYYY-MM-DD -->
<!-- Add user profile information here: name, email, timezone, etc. -->

## User Preferences
<!-- updated: YYYY-MM-DD -->
- Timezone: America/Los_Angeles (Pacific Time)
<!-- Add user preferences here -->
