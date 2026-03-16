# Memory

## Project Architecture
<!-- updated: 2026-03-12 -->
- PAW uses Bun + TypeScript, skills framework with `skill.yml` config and `functions.ts` implementation
- Secrets managed via 1Password (`personal_agent_workspace` vault), bootstrapped by secretsmanager skill
- Only `OP_SERVICE_ACCOUNT_TOKEN` stored locally in `.env`; everything else via `op://` references

## Active Skills
<!-- updated: 2026-03-12 -->
- **secretsmanager** — bootstrap skill, handles activation + 1Password integration
- **edstem** — Ed Discussion API (threads, courses, announcements). Secret: `ED_API_TOKEN`
- **canvas** — Canvas LMS API (assignments, submissions, announcements)
- **gws-mail** — Google Workspace school email (sjayaram@berkeley.edu)
- **daily-brief** — orchestrates canvas, edstem, gws-mail into combined academic brief
- **calevents-api** — CalEvents (calevents.app) public API. No secrets needed. Club events from 1000+ Berkeley orgs

## Known Course IDs (Ed)
<!-- updated: 2026-03-12 -->
- STAT 135 Spring 2026: 94278 (active)
- STAT 134 Fall 2025: 84963 (archived)
- STAT 133: 84260 (active)
- EECS 101: 23247 (active)
- Stat 001 community: 26372 (active)
- IEOR 198 Intro to Quant Finance: 94543 (active)

## User Profile — Sunny (Saurabh Jayaram)
<!-- updated: 2026-03-12 -->
- UC Berkeley Statistics, College of CDSS, expected May 2027, GPA 3.7 (transferred from DVC)
- Email: sjayaram@berkeley.edu | Stripe username: sjayaram
- Founder of CalEvents (calevents.app) — 2,000+ users, AI event aggregation from Instagram
- Incoming SWE intern at Stripe NYC (28 Liberty St, FiDi), May 26–Aug 14, 2026
  - Top team pref: Leverage/Minions (AI coding agents) or Developer Infrastructure
  - Bristol Global Mobility case 89401 (Carl Edgett), Nomad temp housing
- Resume: `/Users/sunnyjay/Documents/Saurabh_Jayaram_Resume.pdf`
- Previously: Relixir (YC X25, SF — ETL pipelines, microservices, vector DB indexer), Keygraph (PearVC — Go/gRPC microservices, IAM/MDM, GraphQL), Armanino LLP (Databricks ETL)
- 10+ hackathon wins (Stanford, Berkeley, UCLA, UPenn), Palantir Devcon Fellowship
- Key projects: CalEvents (AWS, LLM workflows), GPU neural net in C++/CUDA (custom kernels, CuBLAS/cuDNN)
- Languages: Java, JS/TS, Python, C/C++, C#, Go, Swift; ML: PyTorch, CUDA; Infra: AWS, Docker, Postgres, Redis
- YC Startup School 2026 waitlist (rolling decisions)
- ASUC RSO partnership contact: Naomi Tran (Office of the President)

### Interests & Hobbies
<!-- updated: 2026-03-12 -->
- Jazz piano (baritone voice), learning Clair de Lune
- Fitness (Equinox), looksmaxxing
- AI/ML infrastructure, agentic systems, LLM APIs — long-term goal: Anthropic or OpenAI
- Startup ecosystems, VC, fintech

### Courses (Spring 2026)
<!-- updated: 2026-03-14 -->
- STAT 135, INDENG 151, LS 4/104, LS 138
- Dropped: CIVENG 198 (Crude Awakening) — dropped on CalCentral but still shows on Canvas

### Close Friends
<!-- updated: 2026-03-12 -->
- Ibrahim — met via cold DM to work out together

## User Preferences
<!-- updated: 2026-03-14 -->
- Timezone: America/Los_Angeles (Pacific Time)
- Prefers concise output, no over-engineering
- Communicates casually/informally, prefers direct/substantive feedback
- Ed links must use full format: `https://edstem.org/us/courses/{courseId}/discussion/{threadId}`
