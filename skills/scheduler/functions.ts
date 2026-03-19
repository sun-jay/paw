import { readFileSync, writeFileSync, existsSync, symlinkSync, unlinkSync } from "fs";
import { resolve, join } from "path";
import { execSync } from "child_process";

const HEARTBEAT_DIR = resolve(import.meta.dir, "../../heartbeat");
const SCHEDULE_PATH = join(HEARTBEAT_DIR, "schedule.json");
const PLIST_SRC = join(HEARTBEAT_DIR, "com.paw.heartbeat.plist");
const PLIST_DEST = join(
  process.env.HOME ?? "",
  "Library/LaunchAgents/com.paw.heartbeat.plist"
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduleEntry {
  id: string;
  skill: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRun: string | null;
}

type ScheduleUpdate = Partial<Omit<ScheduleEntry, "id">>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function read(): ScheduleEntry[] {
  if (!existsSync(SCHEDULE_PATH)) return [];
  return JSON.parse(readFileSync(SCHEDULE_PATH, "utf-8"));
}

function write(entries: ScheduleEntry[]): void {
  writeFileSync(SCHEDULE_PATH, JSON.stringify(entries, null, 2) + "\n");
}

function validateCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return `Expected 5 fields, got ${parts.length}`;
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  const names = ["minute", "hour", "day-of-month", "month", "day-of-week"];
  for (let i = 0; i < 5; i++) {
    const field = parts[i]!;
    if (field === "*") continue;
    for (const segment of field.split(",")) {
      const base = segment.split("/")[0]!;
      if (base === "*") continue;
      const nums = base.split("-").map(Number);
      for (const n of nums) {
        if (isNaN(n) || n < ranges[i]![0] || n > ranges[i]![1]) {
          return `Invalid ${names[i]} value "${segment}" (range: ${ranges[i]![0]}-${ranges[i]![1]})`;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CRUD functions
// ---------------------------------------------------------------------------

export function listEntries(): ScheduleEntry[] {
  return read();
}

export function getEntry(id: string): ScheduleEntry | null {
  return read().find((e) => e.id === id) ?? null;
}

export function addEntry(entry: ScheduleEntry): string {
  const cronErr = validateCron(entry.cron);
  if (cronErr) return `✗ Invalid cron "${entry.cron}": ${cronErr}`;

  if (!entry.id) return "✗ Entry must have an id";
  if (!entry.skill) return "✗ Entry must have a skill name";
  if (!entry.prompt) return "✗ Entry must have a prompt";

  const entries = read();
  if (entries.some((e) => e.id === entry.id)) {
    return `✗ Entry with id "${entry.id}" already exists — use updateEntry to modify`;
  }

  entries.push({
    id: entry.id,
    skill: entry.skill,
    cron: entry.cron,
    prompt: entry.prompt,
    enabled: entry.enabled ?? true,
    lastRun: null,
  });

  write(entries);
  return `✓ Added schedule entry "${entry.id}" — ${entry.cron}`;
}

export function updateEntry(id: string, updates: ScheduleUpdate): string {
  const entries = read();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return `✗ No entry with id "${id}"`;

  if (updates.cron) {
    const cronErr = validateCron(updates.cron);
    if (cronErr) return `✗ Invalid cron "${updates.cron}": ${cronErr}`;
  }

  entries[idx] = { ...entries[idx]!, ...updates, id };
  write(entries);
  return `✓ Updated entry "${id}"`;
}

export function removeEntry(id: string): string {
  const entries = read();
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) return `✗ No entry with id "${id}"`;
  write(filtered);
  return `✓ Removed entry "${id}"`;
}

export function enableEntry(id: string): string {
  return updateEntry(id, { enabled: true });
}

export function disableEntry(id: string): string {
  return updateEntry(id, { enabled: false });
}

// ---------------------------------------------------------------------------
// launchd management
// ---------------------------------------------------------------------------

export function installLaunchd(): string {
  if (!existsSync(PLIST_SRC)) {
    return `✗ Plist not found at ${PLIST_SRC}`;
  }

  try {
    if (existsSync(PLIST_DEST)) {
      try {
        execSync(`launchctl unload "${PLIST_DEST}"`, { stdio: "pipe" });
      } catch {}
      unlinkSync(PLIST_DEST);
    }

    symlinkSync(PLIST_SRC, PLIST_DEST);
    execSync(`launchctl load "${PLIST_DEST}"`, { stdio: "pipe" });

    return `✓ Heartbeat installed and loaded — dispatcher runs every 60s\n  Plist: ${PLIST_DEST}\n  Logs: ${join(HEARTBEAT_DIR, "logs/")}`;
  } catch (e: any) {
    return `✗ Failed to install launchd: ${e.message}`;
  }
}

export function uninstallLaunchd(): string {
  try {
    if (existsSync(PLIST_DEST)) {
      try {
        execSync(`launchctl unload "${PLIST_DEST}"`, { stdio: "pipe" });
      } catch {}
      unlinkSync(PLIST_DEST);
      return "✓ Heartbeat uninstalled — dispatcher stopped";
    }
    return "✗ Heartbeat not installed (plist not found)";
  } catch (e: any) {
    return `✗ Failed to uninstall launchd: ${e.message}`;
  }
}
