# Anthropic got skills wrong. So I open sourced my solution: we need functions, docs, and secrets.

**The problem:** We want Claude Code and Claude Cowork to be able to use CLI/REST interfaces to perform CRUD operations on data (eg Canvas LMS API, Google Workspace CLI, etc)

**Anthropic's solution:** Skills. Literally just a .MD file that contains instructions, docs, and code snippets. Theoretically, this is all you need to use a CLI or hit a REST API with curl. In practice, this is an oversimplification.

**Why Anthropic's skills fall short:**

1. NO SECRETS MANAGEMENT. I found myself just pasting API keys into the skill itself to hastily make things work. This is the WORST security model: no revocation, no rotation, stagnant plaintext storage, and worst of all, you send your keys in plaintext to Anthropic.

2. Why are we storing code in plaintext within an MD file and having the LLM manually print out the code line by line to run it?? This wastes tokens, time (spent generating those tokens), and most importantly introduces extra surface area for failure due to LLM hallucination.

### My solution: the P.A.W. (Personal Agent Workspace) Skills framework:

I built my own skills system as a part of [PAW](https://github.com/sun-jay/paw) — my always-on, proactive personal agent built to be powered by Claude Code (and abide by their TOS).

A real skill has three components: Docs, Functions, and Secrets

```
skills/canvas/
├── skill.yml        # docs AND secrets
└── functions.ts     # executable logic
```

## 1. Docs

As Anthropic's implementation got right, a skill needs instructions that tell the LLM *when* and *how* to use it.

In PAW, docs live in the `docs` field of `skill.yml`:

```yaml
# skills/canvas/skill.yml
name: canvas
secrets:
  CANVAS_API_TOKEN: op://paw_vault/Canvas/credential

docs: |
  ## Canvas LMS
  Integration with Canvas LMS REST API

  ### Functions
  #### Raw (return API JSON)
  - `raw_getCourses()` — list active courses
  - `raw_getAssignments(courseId)` — list assignments for a course
  - `raw_getTodo()` — upcoming to-do items

  #### Readable (return condensed markdown)
  - `readable_weeklyPlan()` — prioritized weekly plan: assignments, grades, submissions
```

- Docs describe what each function does, when to use it, and what it returns
- The `docs` field in `skill.yml` serves the same purpose as Anthropic's entire skill spec

The other parts of the .yml are explained below.

---

## 2. Functions

PAW skills let the LLM manage its own small code library (a .ts file) associated with a skill, complete with type checking, saved procedures, reusable constructs, instant execution (no need to generate the code as output tokens), and all the other reasons humans use .ts files instead of .md files.

### Two layers: `raw_*` and `readable_*`

To further optimize the performance and allow the LLM to synergize with the code, we instruct LLMs to write PAW skills with 2 layers of data processing:

1. `raw_*` — for when the agent needs structured data for further processing (filtering, joining, sorting, composing with another function from a different skill, etc.)
2. `readable_*` — While LLMs are excellent at reading JSON (much better than humans), they are not better at parsing JSON than Typescript. These functions take in raw JSON and return a "report" that is pre-formatted in concise markdown so the LLM doesn't waste tokens parsing raw JSON or hallucinate.

**Key advantage:** A raw Canvas Assignments API response is ~6.2KB of nested JSON. The `readable_*` output is ~0.2KB of clean markdown with links. That's roughly a **31x reduction** in context consumed.

```typescript
// skills/canvas/functions.ts

// raw_* — returns structured JSON, one function per API endpoint
export async function raw_getAssignments(courseId: number): Promise<any[]> {
  return apiAll(`/courses/${courseId}/assignments`, {
    order_by: "due_at",
  });
}

// readable_* — returns condensed markdown, composes raw_* calls
export async function readable_courseAssignments(courseId: number): Promise<string> {
  const assignments = await raw_getAssignments(courseId);
  if (assignments.length === 0) return "No assignments found for this course.";

  const now = new Date();
  const upcoming = assignments.filter((a: any) => a.due_at && new Date(a.due_at) >= now);
  const past = assignments.filter((a: any) => !a.due_at || new Date(a.due_at) < now);

  const lines = [`## Assignments (${assignments.length} total)`, ""];
  // a bunch more md construction
  return lines.join("\n");
}
```

### Self-refining skills

Agents in PAW are encouraged to fix, lint, and test their own code/skills and utilize version control to keep track of the patches.

## 3. Secrets

Anthropic's skill system has **zero built-in secret management**. If your skill needs an API key, you hardcode it, set an env var, or tell Claude to ask the user. All three are broken for the age of highly privileged autonomous agents. Luckily, the 1password CLI with a scoped vault gives us most of the functionality we need for proper secrets management.

In PAW, skills are **directly** associated with their secrets; declared in their frontmatter as references to 1Password.

```yaml
# skills/canvas/skill.yml
name: canvas
secrets:
  CANVAS_API_TOKEN: op://paw_vault/Canvas/credential
```

When the agent activates a skill, `secretsmanager` injects that skill's secrets into the environment. The LLM doesn't worry about 1pass, and never views a single secret - the LLM focuses ONLY on its logic and achieving the user's goal.

```typescript
// skills/secretsmanager/functions.ts
export function resolveSecrets(secretsMap: Record<string, string>): string[] {
  const entries = Object.entries(secretsMap).filter(
    ([, ref]) => ref.startsWith("op://")
  );
  const injected: string[] = [];
  for (const [envName, opRef] of entries) {
    const value = execSync(`op read "${opRef}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    process.env[envName] = value;
    injected.push(envName);
  }
  return injected;
}
```

This architecture gives you **four** vital security properties that Anthropic's approach doesn't:

### 3a. Secrets never reach Anthropic

- `op read` runs locally. The value goes into `process.env` on the local machine. Secrets are handled by the LLM only by alias, and the plaintext never goes to Anthropic.

### 3b. Least-privilege isolation

- Each skill declares **only** the secrets it needs
- Secrets are injected only when that specific skill is activated and can be removed from context upon deactivation
- With Anthropic's approach, even in the ideal case where you use a .env, all env vars are available to all tools for the entire session. One moment your agent is on Reddit, the next, it has been prompt injected into revealing your Gmail credentials — not with PAW

### 3c. Granular rotation and revocation

- I cannot overstate how important this is: ***1password grants instant remote revocation or rotation of any secret, including the master vault key***

### 3d. Kill switch

- The only local secret is `OP_SERVICE_ACCOUNT_TOKEN` — the 1Password service account token that bootstraps everything
- As a corollary of 3c, revoke this one token and the agent loses access to **all** secrets at once
- This is the most fundamental "pull the plug, the agent has gone rogue" e-stop. Don't cut off its compute, cut off its **secrets**. You should NOT give your agent a wallet if you can't remote pull the secret key at any time!
