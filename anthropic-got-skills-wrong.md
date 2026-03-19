# Anthropic Got Skills Wrong: Here's How to Fix Them

*How a personal agent framework exposed the fundamental gap in Claude Code's skill system — and what a production-grade skill architecture actually looks like.*

---

## The Promise

When Anthropic shipped skills in Claude Code, the pitch was compelling: portable, reusable instruction sets that extend what Claude can do. Write a `SKILL.md`, drop it in `.claude/skills/`, and suddenly your AI assistant knows how to deploy your app, review PRs in your team's style, or query your internal APIs.

They even got the ecosystem play right. The Agent Skills open standard now works across 40+ platforms — GitHub Copilot, Cursor, Gemini CLI, and more. A skill you write for Claude Code works in VS Code. That's genuinely good.

But after building a production personal agent system on top of Claude Code, I've come to a conclusion: **Anthropic's skill system is fundamentally incomplete.** It solves the easy problem (giving Claude instructions) while ignoring the hard ones (state, secrets, composition, and autonomy).

Here's what's broken, and how I fixed it.

---

## What a Skill Actually Is (And What Anthropic Thinks It Is)

Anthropic thinks a skill is a markdown file. `SKILL.md` — YAML frontmatter plus instructions, injected into Claude's context when invoked.

```yaml
---
name: deploy
description: Deploy the application to production
allowed-tools: Bash(npm run deploy)
---

To deploy, run `npm run deploy` and verify the health check...
```

That's not a skill. That's a prompt with metadata.

A real skill — one that integrates with external services, handles credentials safely, and improves over time — has **three components**:

```
skills/canvas/
├── skill.yml        # docs + secrets + metadata
└── functions.ts     # executable logic
```

**1. Functions** — typed, executable code that does the actual work. Not instructions for Claude to interpret. Not bash commands for Claude to generate. Real functions with real error handling.

**2. Docs** — instructions and context that Claude reads to understand *when* and *how* to use the functions. This is the part Anthropic got right.

**3. Secrets** — declarative references to credentials, loaded only when the skill is activated, never sent to Anthropic's servers.

Anthropic ships component 2 and calls it done. Here's why the other two matter more than you think.

---

## Problem 1: Skills Can't Do Anything

An Anthropic skill tells Claude *about* an API. A PAW skill *calls* the API. The difference is enormous.

Consider an EdStem integration. You need to:
- Authenticate with OAuth tokens
- Paginate through API responses
- Parse nested JSON structures
- Handle rate limits and errors
- Transform raw data into readable output

You can't prompt-engineer your way through pagination logic. You need code.

### The Fix: Two-Layer Function Architecture

PAW functions follow a `raw_*` / `readable_*` pattern:

```typescript
// Layer 1: Raw — returns structured JSON for programmatic use
export async function raw_listThreads(courseId: number): Promise<any> {
  const res = await fetch(`https://edstem.org/api/courses/${courseId}/threads`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  return res.json();
}

// Layer 2: Readable — returns markdown string, saves tokens
export async function readable_listThreads(courseId: number): Promise<string> {
  const data = await raw_listThreads(courseId);
  return data.threads
    .map(t => `- [${t.title}](https://edstem.org/us/courses/${courseId}/discussion/${t.id})`)
    .join("\n");
}
```

**Why two layers?** Because dumping raw JSON into Claude's context is a waste of tokens. The `readable_*` layer pre-formats API responses into concise markdown — Claude gets exactly what it needs to answer the user, nothing more. When the agent needs structured data for further processing (filtering, sorting, piping into another function), it calls `raw_*` instead.

Anthropic's approach forces everything through natural language — Claude reads instructions, generates bash commands or API calls, and hopes for the best. That's fine for `git log`. It's not fine for a 14-endpoint API integration with pagination, auth, and error handling.

### The Self-Refining Loop

Here's the part that makes this architecture compound: **Claude can fix its own skills.**

When a `readable_*` function returns garbled output, or a `raw_*` function hits an unexpected API change, Claude doesn't just work around it — it opens `functions.ts`, fixes the bug, bumps the `version` in `skill.yml`, and updates the docs if signatures changed. The next invocation uses the fixed code.

Anthropic skills can't do this. A `SKILL.md` is a static document. If the instructions are wrong, Claude follows them anyway and fails. There's no feedback loop. The skill doesn't get better with use — it gets stale.

---

## Problem 2: No Secret Management (And a Security Nightmare)

This one is almost embarrassing. Anthropic's skill system has **zero built-in secret management**. If your skill needs an API key, you either:

1. Hardcode it (please don't)
2. Reference an environment variable and hope it's set
3. Tell Claude to ask the user for it

None of these are real solutions. But the real problem is worse than inconvenience — it's a **security architecture failure**.

When you put secrets in environment variables or `.env` files, they're available to *every* tool Claude uses for the *entire* session. Claude can access your GitHub token when it's supposed to be querying Canvas. It can read your email credentials when it's supposed to be checking assignments. There's no isolation, no least-privilege, no revocation path.

And here's the part nobody talks about: those secrets flow through Anthropic's API in tool calls. Every `Bash` command Claude runs gets sent to Anthropic's servers as part of the conversation. If your env var contains `GITHUB_TOKEN=ghp_xxxx` and Claude runs `echo $GITHUB_TOKEN` (or even `env | grep TOKEN`), that secret is now in Anthropic's logs.

### The Fix: Least-Privilege Secrets with Remote Revocation

In PAW, every skill declares its secrets in the frontmatter:

```yaml
name: canvas
version: 5
secrets:
  CANVAS_API_TOKEN: "op://personal_agent_workspace/Canvas_LMS/api_token"
skill_dependencies: []
```

The `op://` references point to 1Password items. When — and *only* when — Claude activates that specific skill, the `secretsmanager` bootstrap skill resolves its secrets via `op read` and injects them into the runtime.

```typescript
function token(): string {
  const t = process.env.CANVAS_API_TOKEN;
  if (!t) throw new Error("Not activated — call activate('canvas') first");
  return t;
}
```

This gives you **least-privilege by default**: Claude can't touch your Gmail credentials when it's doing Canvas work, because those secrets aren't loaded until the Gmail skill is explicitly activated. But the security properties go deeper:

**Secrets never reach Anthropic.** The `op read` call happens locally. The resolved value goes into `process.env` on the local machine. When `functions.ts` makes an API call, it reads the token from the local environment and sends it directly to the target API (Canvas, EdStem, Gmail). The secret never appears in a tool call, never gets sent to Anthropic's servers, never enters the conversation context. The only way it leaks is if Claude deliberately runs a command to print it — and that's a visible, auditable action the user can catch.

**Any individual secret can be rotated remotely.** If your Canvas API token is compromised, you rotate it in 1Password. The next time the skill activates, `op read` pulls the new value. No redeployment. No `.env` file updates. No SSH-ing into machines.

**Any individual secret can be revoked instantly.** Delete the 1Password item or remove the agent's access to it. The next activation fails cleanly with a clear error. You've surgically removed one capability without touching anything else.

**The agent's master key is revocable too.** The only secret that lives in `.env` is `OP_SERVICE_ACCOUNT_TOKEN` — the 1Password service account token that bootstraps everything else. Revoke or rotate this one token and the agent loses access to *all* secrets simultaneously. It's a kill switch for the entire credential chain.

This is the security model that agents need: **layered, granular, remotely revocable, with secrets that never transit through the AI provider.** Anthropic could ship this. They already have credential configuration for MCP servers in `settings.json`. Extending that pattern to skills is straightforward.

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
| Skill anatomy | Markdown file (prompts only) | Functions + Docs + Secrets |
| Executable logic | None (Claude generates commands) | `functions.ts` with `raw_*` + `readable_*` layers |
| Token efficiency | Raw JSON dumped into context | `readable_*` pre-formats to concise markdown |
| Self-improvement | Static — skill never changes | Claude fixes functions & docs as it uses them |
| Secret management | Env vars (always loaded, visible) | Declarative 1Password (loaded per-skill) |
| Secret isolation | All secrets available all the time | Least-privilege — only activated skill's secrets load |
| Secrets reach AI provider? | Yes (via tool calls and context) | No — resolved locally, sent directly to target API |
| Secret revocation | Manual `.env` edits on every machine | Remote rotation/revocation per-secret from 1Password |
| Agent kill switch | None | Revoke `OP_SERVICE_ACCOUNT_TOKEN` |
| Dependencies | None | Recursive depth-first resolution with dedup |
| Versioning | None | `version` field in frontmatter |
| Scheduled execution | `/loop` (requires active session) | launchd + headless Claude sessions |
| State persistence | None | Structured memory system |

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
