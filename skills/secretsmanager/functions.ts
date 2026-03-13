import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";

const ROOT_DIR = resolve(import.meta.dir, "../..");
const SKILLS_DIR = resolve(import.meta.dir, "..");
const DEFAULT_VAULT = "personal_agent_workspace";

loadEnv();

// ---------------------------------------------------------------------------
// .env loader (no dependencies)
// ---------------------------------------------------------------------------

function loadEnv(): void {
  const envPath = join(ROOT_DIR, ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (no dependencies)
// ---------------------------------------------------------------------------

interface SkillFrontmatter {
  name: string;
  version: number;
  secrets: Record<string, string>;
  skill_dependencies: string[];
  schedule?: string | null;
}

interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

function parseSkillMd(skillName: string): ParsedSkill {
  const skillPath = join(SKILLS_DIR, skillName, "skill.md");
  if (!existsSync(skillPath)) {
    throw new Error(`Skill not found: ${skillName} (expected ${skillPath})`);
  }

  const content = readFileSync(skillPath, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(`Invalid skill.md format for ${skillName}: missing YAML frontmatter`);
  }

  const [, yamlBlock, body] = fmMatch;
  const frontmatter = parseSimpleYaml(yamlBlock!) as unknown as SkillFrontmatter;

  if (!frontmatter.name) throw new Error(`skill.md for ${skillName} missing 'name'`);
  if (frontmatter.version === undefined) throw new Error(`skill.md for ${skillName} missing 'version'`);
  if (!frontmatter.secrets) frontmatter.secrets = {};
  if (!frontmatter.skill_dependencies) frontmatter.skill_dependencies = [];

  return { frontmatter, body: body!.trim() };
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let arrayAccumulator: string[] | null = null;

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();

    if (arrayAccumulator !== null && trimmed.startsWith("- ")) {
      arrayAccumulator.push(trimmed.slice(2).trim());
      continue;
    }

    if (arrayAccumulator !== null && currentKey) {
      result[currentKey] = arrayAccumulator;
      arrayAccumulator = null;
      currentKey = null;
    }

    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (rawValue === "" || rawValue === "[]") {
      const nextLineIdx = yaml.split("\n").indexOf(line) + 1;
      const nextLine = yaml.split("\n")[nextLineIdx]?.trim();
      if (nextLine?.startsWith("- ") || rawValue === "[]") {
        currentKey = key;
        arrayAccumulator = [];
        if (rawValue === "[]") {
          result[key] = [];
          arrayAccumulator = null;
          currentKey = null;
        }
        continue;
      }
      result[key] = {};
      continue;
    }

    if (rawValue === "null") {
      result[key] = null;
    } else if (rawValue === "true") {
      result[key] = true;
    } else if (rawValue === "false") {
      result[key] = false;
    } else if (/^\d+$/.test(rawValue)) {
      result[key] = parseInt(rawValue, 10);
    } else {
      result[key] = rawValue;
    }
  }

  if (arrayAccumulator !== null && currentKey) {
    result[currentKey] = arrayAccumulator;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

interface ResolvedSkill {
  name: string;
  version: number;
  secrets: Record<string, string>;
  body: string;
}

function resolveDependencies(
  skillName: string,
  visited: Set<string> = new Set(),
  chain: string[] = []
): ResolvedSkill[] {
  if (visited.has(skillName)) return [];
  if (chain.includes(skillName)) {
    throw new Error(`Circular dependency detected: ${[...chain, skillName].join(" → ")}`);
  }

  const { frontmatter, body } = parseSkillMd(skillName);
  chain.push(skillName);

  const deps: ResolvedSkill[] = [];
  for (const dep of frontmatter.skill_dependencies) {
    deps.push(...resolveDependencies(dep, visited, [...chain]));
  }

  visited.add(skillName);
  deps.push({
    name: frontmatter.name,
    version: frontmatter.version,
    secrets: frontmatter.secrets,
    body,
  });

  return deps;
}

// ---------------------------------------------------------------------------
// Secret resolution (1Password)
// ---------------------------------------------------------------------------

function checkOpCli(): void {
  try {
    execSync("op --version", { encoding: "utf-8", stdio: "pipe" });
  } catch {
    throw new Error(
      "1Password CLI (op) is not installed.\n" +
      "Install: https://developer.1password.com/docs/cli/get-started/\n" +
      "Then set OP_SERVICE_ACCOUNT_TOKEN in your environment."
    );
  }

  if (!process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    throw new Error(
      "OP_SERVICE_ACCOUNT_TOKEN is not set in the environment.\n" +
      "Create a service account at https://my.1password.com and export the token."
    );
  }
}

export function resolveSecrets(secretsMap: Record<string, string>): string[] {
  const entries = Object.entries(secretsMap).filter(
    ([, ref]) => ref.startsWith("op://")
  );

  if (entries.length === 0) return [];

  checkOpCli();

  const injected: string[] = [];
  for (const [envName, opRef] of entries) {
    try {
      const value = execSync(`op read "${opRef}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      process.env[envName] = value;
      injected.push(envName);
    } catch (e: any) {
      throw new Error(`Failed to resolve secret ${envName} (${opRef}): ${e.message}`);
    }
  }

  return injected;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

interface ActivationResult {
  summary: string;
  functions: Record<string, string[]>;
  docs: string;
}

export async function activate(skillName: string): Promise<ActivationResult> {
  const resolved = resolveDependencies(skillName);

  const mergedSecrets: Record<string, string> = {};
  for (const skill of resolved) {
    Object.assign(mergedSecrets, skill.secrets);
  }

  const injected = resolveSecrets(mergedSecrets);

  const allFunctions: Record<string, string[]> = {};
  for (const skill of resolved) {
    if (skill.name === "secretsmanager") continue;

    const fnPath = join(SKILLS_DIR, skill.name, "functions.ts");
    if (!existsSync(fnPath)) {
      allFunctions[skill.name] = ["(no functions.ts yet)"];
      continue;
    }

    const mod = await import(fnPath);
    allFunctions[skill.name] = Object.keys(mod).filter(
      (k) => typeof mod[k] === "function"
    );
  }

  const primary = resolved[resolved.length - 1]!;
  const deps = resolved.slice(0, -1);

  const lines: string[] = [];
  lines.push(`✓ Activated: ${primary.name} (v${primary.version})`);

  if (deps.length > 0) {
    lines.push(
      `  Dependencies loaded: ${deps.map((d) => `${d.name} (v${d.version})`).join(", ")}`
    );
  }

  if (injected.length > 0) {
    lines.push(`  Secrets injected: ${injected.join(", ")}`);
  } else {
    lines.push("  Secrets injected: (none)");
  }

  lines.push("");
  lines.push("  Available functions:");
  for (const [skillName, fns] of Object.entries(allFunctions)) {
    lines.push(`    ${skillName}:`);
    for (const fn of fns) {
      lines.push(`      - ${fn}`);
    }
  }

  const summary = lines.join("\n");
  return { summary, functions: allFunctions, docs: primary.body };
}

// ---------------------------------------------------------------------------
// Vault management
// ---------------------------------------------------------------------------

export function createSecret(
  itemName: string,
  fieldName: string,
  value: string,
  vault: string = DEFAULT_VAULT
): string {
  checkOpCli();
  try {
    execSync(
      `op item create --vault="${vault}" --category=login --title="${itemName}" "${fieldName}=${value}"`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    return `✓ Created secret: ${itemName}/${fieldName} in vault ${vault}`;
  } catch (e: any) {
    return `✗ Failed to create secret: ${e.message}`;
  }
}

export function listSecrets(vault: string = DEFAULT_VAULT): string {
  checkOpCli();
  try {
    const output = execSync(
      `op item list --vault="${vault}" --format=json`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    const items = JSON.parse(output);
    return items
      .map((i: any) => `- ${i.title} (${i.category}, updated ${i.updated_at})`)
      .join("\n");
  } catch (e: any) {
    return `✗ Failed to list secrets: ${e.message}`;
  }
}

export function getSecretMetadata(
  itemName: string,
  vault: string = DEFAULT_VAULT
): string {
  checkOpCli();
  try {
    const output = execSync(
      `op item get "${itemName}" --vault="${vault}" --format=json`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    const item = JSON.parse(output);
    return JSON.stringify(
      {
        title: item.title,
        category: item.category,
        created_at: item.created_at,
        updated_at: item.updated_at,
        fields:
          item.fields?.map((f: any) => ({ label: f.label, type: f.type })) ?? [],
      },
      null,
      2
    );
  } catch (e: any) {
    return `✗ Failed to get metadata: ${e.message}`;
  }
}
