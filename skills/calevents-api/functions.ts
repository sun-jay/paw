/**
 * CalEvents API — access UC Berkeley club events from calevents.app
 *
 * No secrets required — all endpoints are public.
 * Uses Next.js Server Actions (RSC flight format).
 */

const BASE_URL = "https://www.calevents.app/";
const TZ = "America/Los_Angeles";

// Action IDs — may change on site redeploy
const ACTION_IDS = {
  getEventsCursor: "401c0e0dfc59bb54ebd1f5552b818e5c25470e4e94",
  getEvents: "4032696f58d6087744e15a74dbeb91eb0a67e51d1b",
  getEventById: "40d3ab02ee13af663bef55b38ea8c13145ba5b060b",
  getAccountsWithEventCounts: "001ccc61eeae9e12d9d70bd76024dbccc3cfba984b",
  getClubsForDirectory: "00573be2de8aa4203536f3755e43543ce387253c16",
} as const;

// ---------------------------------------------------------------------------
// RSC response parser
// ---------------------------------------------------------------------------

function parseRscResponse(raw: string): any {
  // Strategy 1: Look for "1:" record (small responses)
  let idx = raw.indexOf("\n1:");
  if (idx >= 0) {
    return extractJson(raw.slice(idx + 3));
  }
  if (raw.startsWith("1:")) {
    return extractJson(raw.slice(2));
  }

  // Strategy 2: Large responses use T (text) records — find JSON inside
  const eventsIdx = raw.indexOf('{"events"');
  if (eventsIdx >= 0) {
    return extractJson(raw.slice(eventsIdx));
  }

  // Strategy 3: Array response
  const arrayIdx = raw.indexOf('[{"events_id"');
  if (arrayIdx >= 0) {
    return extractJson(raw.slice(arrayIdx));
  }

  return null;
}

function extractJson(jsonStr: string): any {
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const c = jsonStr[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (c === "\\" && inString) { escapeNext = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (!inString) {
      if (c === "{" || c === "[") bracketCount++;
      else if (c === "}" || c === "]") {
        bracketCount--;
        if (bracketCount === 0) return JSON.parse(jsonStr.slice(0, i + 1));
      }
    }
  }
  return JSON.parse(jsonStr);
}

// ---------------------------------------------------------------------------
// Generic server action caller
// ---------------------------------------------------------------------------

async function callAction(actionId: string, args: any[] = []): Promise<any> {
  const form = new FormData();
  form.append(`1_$ACTION_ID_${actionId}`, "");
  form.append("0", JSON.stringify(args));

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Next-Action": actionId,
    },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`CalEvents API error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  const parsed = parseRscResponse(text);
  if (parsed === null) throw new Error("Failed to parse RSC response");
  return parsed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventLink(eventId: string): string {
  return `https://www.calevents.app/events?event=${eventId}`;
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "no date";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(time: string | null): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function stripCursor(cursor: any): any {
  if (!cursor) return null;
  return {
    date: typeof cursor.date === "string" ? cursor.date.replace(/^\$D/, "") : cursor.date,
    createdAt: typeof cursor.createdAt === "string" ? cursor.createdAt.replace(/^\$D/, "") : cursor.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Raw functions
// ---------------------------------------------------------------------------

export async function raw_getEventsCursor(opts?: {
  cursor?: { date: string; createdAt: string } | null;
  direction?: "future" | "past";
  limit?: number;
}): Promise<{ events: any[]; hasMore: boolean; nextCursor: any }> {
  const params = {
    cursor: opts?.cursor ?? null,
    direction: opts?.direction ?? "future",
    limit: opts?.limit ?? 50,
  };
  const result = await callAction(ACTION_IDS.getEventsCursor, [params]);
  if (result.nextCursor) {
    result.nextCursor = stripCursor(result.nextCursor);
  }
  return result;
}

export async function raw_getEvents(): Promise<any[]> {
  return callAction(ACTION_IDS.getEvents);
}

export async function raw_getEventById(eventId: string): Promise<any> {
  return callAction(ACTION_IDS.getEventById, [eventId]);
}

export async function raw_getAccountsWithEventCounts(): Promise<any> {
  return callAction(ACTION_IDS.getAccountsWithEventCounts);
}

export async function raw_getClubsForDirectory(): Promise<any> {
  return callAction(ACTION_IDS.getClubsForDirectory);
}

// ---------------------------------------------------------------------------
// Readable functions
// ---------------------------------------------------------------------------

export async function readable_upcomingEvents(limit: number = 20): Promise<string> {
  const data = await raw_getEventsCursor({ direction: "future", limit });
  const events = data.events ?? [];

  if (events.length === 0) return "No upcoming events found.";

  const lines: string[] = [`## Upcoming Berkeley Events (${events.length})`, ""];

  for (const e of events) {
    const time = e.start_time ? ` at ${fmtTime(e.start_time)}` : "";
    const endTime = e.end_time ? `–${fmtTime(e.end_time)}` : "";
    const loc = e.location ? ` | ${e.location}` : "";
    const type = e.event_type ? ` [${e.event_type}]` : "";
    const club = e.club_username ? ` — @${e.club_username}` : "";

    lines.push(`- [**${e.title}**](${eventLink(e.events_id)})${type}${club}`);
    lines.push(`  ${fmtDate(e.date)}${time}${endTime}${loc}`);
    if (e.description) {
      const desc = e.description.slice(0, 120);
      lines.push(`  ${desc}${e.description.length > 120 ? "..." : ""}`);
    }
    lines.push("");
  }

  if (data.hasMore) lines.push("_More events available — increase limit or paginate._");
  return lines.join("\n");
}

export async function readable_searchEvents(query: string, limit: number = 50): Promise<string> {
  // Fetch events and filter client-side (no server search endpoint)
  const data = await raw_getEventsCursor({ direction: "future", limit: 200 });
  const events = (data.events ?? []).filter((e: any) => {
    const q = query.toLowerCase();
    return (
      (e.title?.toLowerCase().includes(q)) ||
      (e.description?.toLowerCase().includes(q)) ||
      (e.club_username?.toLowerCase().includes(q)) ||
      (e.location?.toLowerCase().includes(q)) ||
      (e.event_type?.toLowerCase().includes(q))
    );
  }).slice(0, limit);

  if (events.length === 0) return `No upcoming events matching "${query}".`;

  const lines: string[] = [`## Events matching "${query}" (${events.length})`, ""];

  for (const e of events) {
    const time = e.start_time ? ` at ${fmtTime(e.start_time)}` : "";
    const loc = e.location ? ` | ${e.location}` : "";
    const club = e.club_username ? ` — @${e.club_username}` : "";

    lines.push(`- [**${e.title}**](${eventLink(e.events_id)})${club}`);
    lines.push(`  ${fmtDate(e.date)}${time}${loc}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function readable_clubDirectory(): Promise<string> {
  const clubs = await raw_getAccountsWithEventCounts();
  if (!Array.isArray(clubs) || clubs.length === 0) return "No clubs found.";

  // Sort by event count descending
  const sorted = [...clubs].sort((a: any, b: any) => (b.event_count ?? 0) - (a.event_count ?? 0));

  const lines: string[] = [`## Berkeley Club Directory (${sorted.length} clubs)`, ""];
  for (const c of sorted.slice(0, 50)) {
    const count = c.event_count ?? 0;
    lines.push(`- **@${c.username}** — ${count} event${count !== 1 ? "s" : ""}`);
  }

  if (sorted.length > 50) lines.push(`\n_...and ${sorted.length - 50} more clubs._`);
  return lines.join("\n");
}
