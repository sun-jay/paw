import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TZ = "America/Los_Angeles";

function buildCredsJson(): string {
  const clientId = process.env.GWS_CLIENT_ID;
  const clientSecret = process.env.GWS_CLIENT_SECRET;
  const refreshToken = process.env.GWS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "GWS credentials not set — activate the gws-mail skill first"
    );
  }
  return JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    type: "authorized_user",
  });
}

function gws(args: string): string {
  const ts = Date.now();
  const tmp = join(tmpdir(), `gws-creds-${process.pid}-${ts}.json`);
  const tmpConfigDir = join(tmpdir(), `gws-config-${process.pid}-${ts}`);
  try {
    const { mkdirSync, rmSync } = require("fs");
    mkdirSync(tmpConfigDir, { recursive: true });
    writeFileSync(tmp, buildCredsJson(), { mode: 0o600 });
    return execSync(`gws ${args}`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
      env: {
        ...process.env,
        GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: tmp,
        GOOGLE_WORKSPACE_CLI_CONFIG_DIR: tmpConfigDir,
      },
    }).trim();
  } finally {
    try { unlinkSync(tmp); } catch {}
    try { const { rmSync } = require("fs"); rmSync(tmpConfigDir, { recursive: true, force: true }); } catch {}
  }
}

function gwsJson(args: string): any {
  const out = gws(args);
  // gws sometimes prefixes output with "Using keyring backend: ..." lines
  const jsonStart = out.indexOf("[") !== -1 && (out.indexOf("{") === -1 || out.indexOf("[") < out.indexOf("{"))
    ? out.indexOf("[")
    : out.indexOf("{");
  if (jsonStart === -1) return out;
  return JSON.parse(out.slice(jsonStart));
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Raw layer
// ---------------------------------------------------------------------------

export async function raw_triage(): Promise<any> {
  return gwsJson(
    `gmail users messages list --params '{"userId":"me","labelIds":["INBOX","UNREAD"],"maxResults":20}' --format json`
  );
}

export async function raw_getMessage(messageId: string): Promise<any> {
  return gwsJson(
    `gmail users messages get --params '{"userId":"me","id":"${messageId}","format":"full"}' --format json`
  );
}

export async function raw_searchMessages(query: string): Promise<any> {
  const escaped = query.replace(/'/g, "'\\''");
  return gwsJson(
    `gmail users messages list --params '{"userId":"me","q":"${escaped}","maxResults":20}' --format json`
  );
}

export async function raw_listLabels(): Promise<any> {
  return gwsJson(
    `gmail users labels list --params '{"userId":"me"}' --format json`
  );
}

export async function raw_send(
  to: string,
  subject: string,
  body: string
): Promise<any> {
  const escapedTo = to.replace(/'/g, "'\\''");
  const escapedSubject = subject.replace(/'/g, "'\\''");
  const escapedBody = body.replace(/'/g, "'\\''");
  return gwsJson(
    `gmail +send --to '${escapedTo}' --subject '${escapedSubject}' --body '${escapedBody}' --format json`
  );
}

export async function raw_reply(
  messageId: string,
  body: string
): Promise<any> {
  const escapedBody = body.replace(/'/g, "'\\''");
  return gwsJson(
    `gmail +reply --message-id '${messageId}' --body '${escapedBody}' --format json`
  );
}

export async function raw_calendarList(
  timeMin?: string,
  timeMax?: string
): Promise<any> {
  const now = new Date();
  const min = timeMin ?? now.toISOString();
  const max =
    timeMax ??
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return gwsJson(
    `calendar events list --params '{"calendarId":"primary","timeMin":"${min}","timeMax":"${max}","singleEvents":true,"orderBy":"startTime"}' --format json`
  );
}

// ---------------------------------------------------------------------------
// Readable layer
// ---------------------------------------------------------------------------

export async function readable_triage(): Promise<string> {
  try {
    const result = await raw_triage();
    const messages = result.messages ?? [];
    if (messages.length === 0) return "## School Inbox (sjayaram@berkeley.edu)\n\nNo unread messages.";

    const lines = [`## School Inbox (sjayaram@berkeley.edu) — ${messages.length} unread`, ""];

    // Fetch headers for each message (up to 10)
    for (const m of messages.slice(0, 10)) {
      try {
        const full = await raw_getMessage(m.id);
        const headers = full.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
        lines.push(`- **${get("Subject")}** — from ${get("From")} — ${get("Date")} (id: ${m.id})`);
      } catch {
        lines.push(`- Message ${m.id} (could not fetch details)`);
      }
    }

    return lines.join("\n");
  } catch (e: any) {
    return `Error fetching inbox: ${e.message}`;
  }
}

export async function readable_getMessage(messageId: string): Promise<string> {
  try {
    const msg = await raw_getMessage(messageId);
    const headers = msg.payload?.headers ?? [];
    const get = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const from = get("From");
    const subject = get("Subject");
    const date = get("Date");

    // Extract body text
    let bodyText = "";
    const parts = msg.payload?.parts ?? [msg.payload];
    for (const part of parts) {
      if (part?.mimeType === "text/plain" && part?.body?.data) {
        bodyText = Buffer.from(part.body.data, "base64url").toString("utf-8");
        break;
      }
    }
    if (!bodyText && msg.payload?.body?.data) {
      bodyText = Buffer.from(msg.payload.body.data, "base64url").toString(
        "utf-8"
      );
    }

    return [
      `## Email`,
      "",
      `**From:** ${from}`,
      `**Subject:** ${subject}`,
      `**Date:** ${date}`,
      "",
      bodyText || "(no text content)",
    ].join("\n");
  } catch (e: any) {
    return `Error reading message: ${e.message}`;
  }
}

export async function readable_searchMessages(query: string): Promise<string> {
  try {
    const result = await raw_searchMessages(query);
    const messages = result.messages ?? [];
    if (messages.length === 0) return `No results for "${query}"`;

    const lines = [`## Search: "${query}" (${messages.length} results)`, ""];

    // Fetch headers for each message (up to 10)
    for (const m of messages.slice(0, 10)) {
      try {
        const full = await raw_getMessage(m.id);
        const headers = full.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find(
            (h: any) => h.name.toLowerCase() === name.toLowerCase()
          )?.value ?? "";
        lines.push(
          `- **${get("Subject")}** — from ${get("From")} — ${get("Date")} (id: ${m.id})`
        );
      } catch {
        lines.push(`- Message ${m.id} (could not fetch details)`);
      }
    }

    return lines.join("\n");
  } catch (e: any) {
    return `Error searching: ${e.message}`;
  }
}

export async function readable_send(
  to: string,
  subject: string,
  body: string
): Promise<string> {
  try {
    await raw_send(to, subject, body);
    return `Sent email to ${to}: "${subject}"`;
  } catch (e: any) {
    return `Error sending email: ${e.message}`;
  }
}

export async function readable_calendarToday(): Promise<string> {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await raw_calendarList(
      startOfDay.toISOString(),
      endOfDay.toISOString()
    );
    const events = result.items ?? [];

    if (events.length === 0) return "No school calendar events today.";

    const lines = [
      `## School Calendar — ${fmtDate(now.toISOString())}`,
      "",
    ];

    for (const e of events) {
      const start = e.start?.dateTime ?? e.start?.date;
      const end = e.end?.dateTime ?? e.end?.date;
      const time = e.start?.dateTime
        ? `${fmtDate(start)} – ${fmtDate(end)}`
        : "All day";
      const loc = e.location ? ` — ${e.location}` : "";
      lines.push(`- **${e.summary}** — ${time}${loc}`);
    }

    return lines.join("\n");
  } catch (e: any) {
    return `Error fetching calendar: ${e.message}`;
  }
}
