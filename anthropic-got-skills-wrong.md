# Anthropic Got Skills Wrong: Here's How to Fix Them

*How a personal agent framework exposed the fundamental gap in Claude Code's skill system — and what a production-grade skill architecture actually looks like.*

---

## The Promise

When Anthropic shipped skills in Claude Code, the pitch was compelling: portable, reusable instruction sets that extend what Claude can do. Write a `SKILL.md`, drop it in `.claude/skills/`, and suddenly your AI assistant knows how to deploy your app, review PRs in your team's style, or query your internal APIs.

They even got the ecosystem play right. The Agent Skills open standard now works across 40+ platforms — GitHub Copilot, Cursor, Gemini CLI, and more. A skill you write for Claude Code works in VS Code. That's genuinely good.

But after building a production personal agent system on top of Claude Code, I've come to a conclusion: **Anthropic's skill system is fundamentally incomplete.** It solves the easy problem (giving Claude instructions) while ignoring the hard ones (state, secrets, composition, and autonomy).

Here's what's broken, and how I fixed it.

---

## Problem 1: Skills Are Just Prompts

An Anthropic skill is a markdown file. That's it. `SKILL.md` contains YAML frontmatter and instructions that get injected into Claude's context when invoked.

```yaml
---
name: deploy
description: Deploy the application to production
allowed-tools: Bash(npm run deploy)
---

To deploy, run `npm run deploy` and verify the health check...
```

This is fine for "tell Claude how to do X" use cases. But a *real* skill — one that integrates with external services — needs more than instructions. It needs **executable logic**.

Consider an EdStem integration. You need to:
- Authenticate with OAuth tokens
- Paginate through API responses
- Parse nested JSON structures
- Handle rate limits and errors
- Transform raw data into readable output

You can't prompt-engineer your way through pagination logic. You need code.

### The Fix: Two-Layer Function Architecture

In PAW (Personal Agent Workspace), every skill has an optional `functions.ts` alongside its config:

```
skills/edstem/
├── skill.yml
└── functions.ts
```

Functions follow a two-layer pattern:

```typescript
// Layer 1: Raw API access — returns Promise<any>
export async function raw_listThreads(courseId: number): Promise<any> {
  const res = await fetch(`https://edstem.org/api/courses/${courseId}/threads`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  return res.json();
}

// Layer 2: Readable output — returns Promise<string>
export async function readable_listThreads(courseId: number): Promise<string> {
  const data = await raw_listThreads(courseId);
  return data.threads
    .map(t => `- [${t.title}](https://edstem.org/us/courses/${courseId}/discussion/${t.id})`)
    .join("\n");
}
```

**Why two layers?** Because sometimes the agent needs structured data for further processing (`raw_*`), and sometimes it needs human-readable output for a conversation (`readable_*`). Anthropic's approach forces everything through natural language — Claude reads instructions, generates bash commands or API calls, and hopes for the best. That's fine for `git log`. It's not fine for a 14-endpoint API integration with pagination, auth, and error handling.

---

## Problem 2: No Secret Management

This one is almost embarrassing. Anthropic's skill system has **zero built-in secret management**. If your skill needs an API key, you either:

1. Hardcode it (please don't)
2. Reference an environment variable and hope it's set
3. Tell Claude to ask the user for it

None of these are real solutions. Option 2 means every developer on the team needs to manually configure the same env vars. Option 3 means Claude asks for your API key every session.

### The Fix: Declarative Secrets with 1Password

In PAW, every skill declares its secrets in the frontmatter:

```yaml
name: canvas
version: 5
secrets:
  CANVAS_API_TOKEN: "op://personal_agent_workspace/Canvas_LMS/api_token"
skill_dependencies: []
```

The `op://` references point to 1Password items. When a skill is activated, the `secretsmanager` bootstrap skill resolves every secret via `op read`, injects them into `process.env`, and the skill's functions access them normally.

```typescript
function token(): string {
  const t = process.env.CANVAS_API_TOKEN;
  if (!t) throw new Error("Not activated — call activate('canvas') first");
  return t;
}
```

**Key properties:**
- **Single source of truth**: Secrets live in 1Password, not in `.env` files scattered across machines
- **Lazy injection**: Only secrets for activated skills (and their dependencies) are loaded
- **No exposure**: The agent can create and list secrets but never log or print values
- **One bootstrap secret**: Only `OP_SERVICE_ACCOUNT_TOKEN` lives in `.env` — everything else flows through 1Password

Anthropic could ship this tomorrow. MCP servers already have credential configuration in `settings.json`. Extending that pattern to skills is straightforward.

---

## Problem 3: No Dependency Resolution

Anthropic skills are islands. Skill A can't declare that it depends on Skill B. If you have a `daily-brief` skill that needs data from Canvas, EdStem, and Gmail, you just... write all the instructions in one giant skill? Copy-paste shared logic?

### The Fix: Dependency Trees with Deduplication

PAW skills declare dependencies:

```yaml
name: daily-brief
version: 3
secrets: {}
skill_dependencies:
  - canvas
  - edstem
  - gws-mail
```

When you activate `daily-brief`, the secretsmanager resolves the full dependency tree depth-first:

1. Activate `canvas` → inject `CANVAS_API_TOKEN`
2. Activate `edstem` → inject `ED_API_TOKEN`
3. Activate `gws-mail` → inject `GWS_CLIENT_ID`, `GWS_CLIENT_SECRET`, `GWS_REFRESH_TOKEN`
4. Activate `daily-brief` → all dependencies ready

Circular dependencies are detected and throw. Duplicates are skipped (if A→C and B→C, C loads once). All functions from all activated skills become available:

```typescript
const result = await activate("daily-brief");
// result.functions = {
//   canvas: ["raw_getProfile", "readable_myCourses", "readable_todo", ...],
//   edstem: ["raw_getUser", "readable_listThreads", ...],
//   "gws-mail": ["raw_triage", "readable_triage", ...],
//   "daily-brief": ["readable_academicBrief", ...]
// }
```

This is how you build composite skills that *orchestrate* rather than *duplicate*.

---

## Problem 4: No Autonomous Execution

Anthropic skills only run when a human is in the loop. You type `/daily-brief` or Claude auto-invokes based on conversation context. But what about skills that should run on a schedule? A morning briefing at 8 AM. A deadline reminder 24 hours before due dates. An inbox triage every few hours.

Claude Code has `/loop` for polling, but that requires an active session. Close your laptop and it stops.

### The Fix: Heartbeat Scheduler

PAW includes a `scheduler` skill backed by launchd (macOS) that runs a dispatcher every 60 seconds:

```
launchd (every 60s) → dispatcher.ts → checks schedule.json → spawns Claude Code sessions
```

Each scheduled entry is a skill + prompt + cron expression:

```json
{
  "id": "daily-brief",
  "skill": "daily-brief",
  "cron": "0 8 * * *",
  "prompt": "Activate the daily-brief skill and run readable_academicBrief(). Send the output to Sunny.",
  "enabled": true
}
```

The dispatcher uses `--print` mode to run headless Claude Code sessions, captures logs, and tracks last-run timestamps for idempotency. Skills become **autonomous agents** that work even when you're asleep.

---

## Problem 5: No State Persistence

Every Claude Code skill invocation starts fresh. There's no built-in way for a skill to remember what happened last time. Did you already triage this email? Did you already remind the user about this deadline? Was this assignment already submitted when you last checked?

### The Fix: Structured Memory

PAW separates memory from skills:

- `memory/MEMORY.md` — curated facts, preferences, decisions
- Topic-specific files (`memory/debugging.md`, etc.) for detailed notes
- Auto-update triggers so the agent writes to memory when preferences change, corrections happen, or new information surfaces

Skills don't manage their own state. Instead, the agent reads memory at the start of each session and updates it when durable knowledge changes. This means a scheduled 8 AM briefing can reference yesterday's briefing context, know which classes you dropped, and skip assignments you've already submitted.

---

## The Fundamental Disconnect

Anthropic designed skills for **developer tooling**: help Claude write better code, follow team conventions, run deployments. That's a valid use case, and skills-as-prompts work fine for it.

But skills-as-prompts break down the moment you want to build a **personal agent** — something that integrates with real APIs, manages real credentials, composes real workflows, and runs autonomously. For that, you need:

| Capability | Anthropic Skills | PAW Skills |
|---|---|---|
| Instructions for Claude | SKILL.md (markdown) | skill.yml `docs` field |
| Executable logic | None (Claude generates commands) | `functions.ts` (typed TypeScript) |
| Secret management | Manual env vars | Declarative 1Password references |
| Dependencies | None | Recursive depth-first resolution |
| Versioning | None | `version` field in frontmatter |
| Scheduled execution | `/loop` (requires active session) | launchd + headless Claude sessions |
| State persistence | None | Structured memory system |
| Error handling | Claude retries (or doesn't) | Typed catch-and-return patterns |
| Function architecture | N/A | `raw_*` + `readable_*` two-layer |

---

## What Anthropic Should Do

The bones are good. The Agent Skills standard is the right abstraction layer for portability. The frontmatter system is extensible. Subagents and hooks show they're thinking about composition and lifecycle. Here's what's missing:

### 1. Add a `functions` directory to the skill spec

Let skills include executable code — TypeScript, Python, whatever. Skills should be able to register functions that Claude can call directly, not just instructions that Claude interprets.

### 2. Add `secrets` to the frontmatter

```yaml
---
name: github-integration
secrets:
  GITHUB_TOKEN:
    source: keychain  # or vault, or env
    reference: "github/personal-access-token"
---
```

The specific backend (1Password, system keychain, Vault, AWS Secrets Manager) matters less than having a *declarative interface* for it.

### 3. Add `skill_dependencies`

```yaml
---
name: daily-summary
dependencies:
  - github-integration
  - slack-integration
---
```

Resolve them recursively. Deduplicate. Detect cycles. This is solved problem — npm, pip, and cargo all do it.

### 4. Add a scheduling primitive

Whether it's cron expressions in frontmatter or a first-class scheduler API, skills need to run without a human present. The `/loop` command is a hack. Ship a real scheduler.

### 5. Add skill-scoped storage

Give each skill a persistent key-value store or file directory. Let skills remember state across invocations. This doesn't need to be complex — even a JSON file per skill would be sufficient.

---

## Conclusion

Anthropic built a skills system optimized for the simplest case: giving Claude better instructions. That's table stakes. The hard problems — secrets, state, composition, autonomy — are left as exercises for the reader.

PAW proves these problems are solvable. A single `secretsmanager` bootstrap skill, typed function layers, declarative dependencies, and a cron dispatcher turn Claude from a smart autocomplete into an actual personal agent. One that wakes up at 8 AM, checks your Canvas assignments, triages your email, reads your EdStem threads, and sends you a briefing — all without you opening a terminal.

The irony is that Anthropic is closer than anyone to shipping this. They have the model, the CLI, the hooks, the subagents, and the MCP ecosystem. They just need to stop treating skills as fancy prompt templates and start treating them as what they should be: **composable, executable, autonomous units of agent capability.**

The building blocks are all there. Someone just needs to assemble them.

---

*Built with PAW (Personal Agent Workspace) — a framework for turning Claude Code into a personal agent. Running on Bun, backed by 1Password, scheduled by launchd.*
