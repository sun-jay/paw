#!/usr/bin/env bun
/**
 * Heartbeat dispatcher — reads schedule.json, checks which entries are due,
 * and launches Claude Code sessions via launch-agent.sh for each.
 *
 * Called periodically by launchd (com.paw.heartbeat.plist).
 * Designed to be idempotent — safe to run multiple times in the same minute.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { join, resolve } from "path";
import { execSync, spawn } from "child_process";

const HEARTBEAT_DIR = resolve(import.meta.dir);
const SCHEDULE_PATH = join(HEARTBEAT_DIR, "schedule.json");
const LAUNCH_SCRIPT = join(HEARTBEAT_DIR, "launch-agent.sh");
const LOG_DIR = join(HEARTBEAT_DIR, "logs");
const DISPATCH_LOG = join(LOG_DIR, "dispatcher.log");

interface ScheduleEntry {
  id: string;
  skill: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  lastRun: string | null;
  notify?: string;
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    if (!existsSync(LOG_DIR)) {
      const { mkdirSync } = require("fs");
      mkdirSync(LOG_DIR, { recursive: true });
    }
    appendFileSync(DISPATCH_LOG, line + "\n");
  } catch {}
}

function readSchedule(): ScheduleEntry[] {
  if (!existsSync(SCHEDULE_PATH)) {
    log("No schedule.json found");
    return [];
  }
  return JSON.parse(readFileSync(SCHEDULE_PATH, "utf-8"));
}

function writeSchedule(entries: ScheduleEntry[]): void {
  writeFileSync(SCHEDULE_PATH, JSON.stringify(entries, null, 2) + "\n");
}

function cronMatchesNow(cron: string, now: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    log(`Invalid cron expression: "${cron}"`);
    return false;
  }

  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;
  const minute = now.getMinutes();
  const hour = now.getHours();
  const dayOfMonth = now.getDate();
  const month = now.getMonth() + 1;
  const dayOfWeek = now.getDay();

  return (
    fieldMatches(minExpr!, minute, 0, 59) &&
    fieldMatches(hourExpr!, hour, 0, 23) &&
    fieldMatches(domExpr!, dayOfMonth, 1, 31) &&
    fieldMatches(monExpr!, month, 1, 12) &&
    fieldMatches(dowExpr!, dayOfWeek, 0, 7)
  );
}

function fieldMatches(expr: string, value: number, min: number, max: number): boolean {
  if (expr === "*") return true;

  for (const part of expr.split(",")) {
    if (part.includes("/")) {
      const [rangeStr, stepStr] = part.split("/");
      const step = parseInt(stepStr!, 10);
      const start = rangeStr === "*" ? min : parseInt(rangeStr!, 10);
      for (let i = start; i <= max; i += step) {
        if (i === value) return true;
      }
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (value >= lo! && value <= hi!) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }

  return false;
}

function wasRunThisMinute(lastRun: string | null, now: Date): boolean {
  if (!lastRun) return false;
  const last = new Date(lastRun);
  return (
    last.getFullYear() === now.getFullYear() &&
    last.getMonth() === now.getMonth() &&
    last.getDate() === now.getDate() &&
    last.getHours() === now.getHours() &&
    last.getMinutes() === now.getMinutes()
  );
}

function launchAgent(entry: ScheduleEntry): void {
  log(`Launching: ${entry.id} (skill: ${entry.skill})`);

  const child = spawn(LAUNCH_SCRIPT, [entry.prompt, "--dangerously-skip-permissions"], {
    cwd: resolve(HEARTBEAT_DIR, ".."),
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      PAW_SCHEDULE_ID: entry.id,
      PAW_SKILL: entry.skill,
    },
  });

  child.unref();
  log(`Launched: ${entry.id} (pid: ${child.pid})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const now = new Date();
log(`Dispatcher tick — ${now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}`);

const schedule = readSchedule();
let updated = false;

for (const entry of schedule) {
  if (!entry.enabled) continue;

  if (wasRunThisMinute(entry.lastRun, now)) {
    continue;
  }

  if (cronMatchesNow(entry.cron, now)) {
    launchAgent(entry);
    entry.lastRun = now.toISOString();
    updated = true;
  }
}

if (updated) {
  writeSchedule(schedule);
}

log(`Dispatcher done — ${schedule.filter((e) => e.enabled).length} enabled entries, ${updated ? "launched tasks" : "nothing due"}`);
