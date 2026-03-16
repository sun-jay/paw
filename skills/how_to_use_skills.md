# How to Use Skills

## Activating a Skill

Call `activate(skillName)` from `skills/secretsmanager/functions.ts`. The skill name matches its folder name under `skills/`.

```typescript
import { activate } from "./secretsmanager/functions.ts";
const result = await activate("myskill");
console.log(result.summary);
```

`activate` does the following in order:
1. Reads `skills/<skillName>/skill.yml` and parses it
2. Walks `skill_dependencies` recursively (depth-first, deduplicates, detects cycles)
3. Merges all `secrets` from the full dependency tree
4. Calls `op read` for each `op://` reference via the secretsmanager and sets `process.env`
5. Dynamically imports `functions.ts` from every skill in the tree
6. Returns `{ summary, functions, docs }`

If a skill has no `functions.ts` yet, it still activates — the summary will note `(no functions.ts yet)`.

## skill.yml Format

Every skill folder must have a `skill.yml`. It is a plain YAML file with config fields and an optional `docs` field for documentation.

```yaml
name: myskill
version: 1
secrets:
  MY_TOKEN: op://personal_agent_workspace/myskill/token
skill_dependencies: []
schedule: null

docs: |
  ## My Skill

  Description of what this skill does.

  ### Functions
  - raw_doThing(arg) → returns full API response
  - readable_doThing(arg) → returns condensed markdown
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Must match the folder name |
| `version` | number | yes | Increment when the skill changes |
| `secrets` | Record\<string, string\> | yes | `ENV_VAR: op://ref` pairs. Use `{}` if none. Use `.env` for secrets loaded from the root .env file |
| `skill_dependencies` | string[] | yes | Skill names this depends on. Use `[]` if none |
| `schedule` | string \| null | no | Cron expression for scheduled skills |
| `docs` | string | no | Markdown documentation for agent reference. Returned as `docs` in the activation result. Write it as if explaining the skill to another agent — what each function does, what it returns, when to use raw vs readable. |

## functions.ts Format

Two layers of functions:

- **`raw_*`** — return `Promise<any>` or `Promise<any[]>`. One function per API endpoint. Direct responses, no transformation.
- **`readable_*`** — return `Promise<string>`. Compose multiple `raw_*` calls. Output is markdown or plain text, condensed for token efficiency. Convert timestamps to Pacific Time.

All secrets are accessed via `process.env.SECRET_NAME` — never hardcoded. Functions should catch errors and return readable error strings, not throw.

## Creating a New Skill

1. Create the folder: `skills/<skillname>/`
2. Write `skill.yml` with the frontmatter and docs (see format above)
3. **Create the 1Password secret** using `createSecret` from the secretsmanager skill. This is mandatory — never hardcode tokens or skip this step, even during development:
   ```typescript
   import { createSecret } from "./secretsmanager/functions.ts";
   createSecret("MySkill", "credential", "the-token-value");
   ```
   The `op://` reference in `skill.yml` should match: `op://personal_agent_workspace/MySkill/credential`
4. Write `functions.ts` with the raw and readable layers
5. Test by calling `activate("skillname")` — this resolves secrets from 1Password and imports functions. Never set `process.env` tokens manually, even for testing.

## Updating a Skill

1. Edit `functions.ts` with the changes
2. Increment `version` in `skill.yml` frontmatter
3. Update the `docs` field in `skill.yml` if signatures changed
4. Test by calling `activate("skillname")` and exercising the changed functions
5. Once tested and working, commit the changes with a message describing what changed

## Deleting a Skill

1. Remove the skill's folder from `skills/`
2. Remove it from any other skill's `skill_dependencies` list
3. The secret stays in 1Password — the user deletes it manually through the 1Password app if no longer needed

## Skills and Secrets

### How secrets flow

```
.env (root)                    1Password vault
    │                              │
    └─ OP_SERVICE_ACCOUNT_TOKEN    └─ op://personal_agent_workspace/*/...
           │                              │
           ▼                              ▼
    secretsmanager ──── op read ──── fetches secret values
           │
           ▼
    process.env.SECRET_NAME ──── available to skill functions
```

- The **only** secret stored locally is `OP_SERVICE_ACCOUNT_TOKEN` in the root `.env` (gitignored)
- Every other secret lives in the `personal_agent_workspace` vault in 1Password
- Skills declare which secrets they need in their `skill.yml` frontmatter as `ENV_VAR: op://reference` pairs
- When `activate` runs, it collects all secrets from the skill + its dependencies, fetches them from 1Password via `op read`, and sets them on `process.env`
- Skill functions access secrets via `process.env.SECRET_NAME` — they never see `op://` references or raw tokens
- A skill can only access secrets declared in its own frontmatter or in its dependencies' frontmatter

### What the agent can do with secrets

- **Create** new secrets via `createSecret(itemName, fieldName, value)` — for setting up new integrations
- **List** secret names via `listSecrets()` — returns titles and metadata, never values
- **Read metadata** via `getSecretMetadata(itemName)` — returns field labels, types, timestamps, never values

### What the agent cannot do with secrets

- **Delete** or **edit** existing secrets — the user does this in the 1Password app
- **See raw values** in conversation — secrets are injected into `process.env`, the agent only knows alias names
- **Access undeclared secrets** — only secrets in the activated skill's dependency tree are injected

## Dependencies

Skills can depend on other skills via `skill_dependencies`. When you activate a skill, its entire dependency tree is resolved:

- Dependencies are loaded depth-first
- Duplicates are skipped (if A and B both depend on C, C loads once)
- Circular dependencies throw an error naming the cycle
- All secrets from the full tree are merged and injected
- All `functions.ts` from the full tree are imported

A skill with dependencies doesn't need to declare its dependencies' secrets — they come along automatically.

## Vault

- **Name**: `personal_agent_workspace`
- **Provider**: 1Password
- **Access**: via service account token with read + write permissions
- **CLI**: `op` (1Password CLI v2.32.1+)
