/**
 * Daily Briefing — orchestrates Canvas, EdStem, and school email into a single brief.
 *
 * Dependencies: canvas, edstem, gws-mail (activated via skill_dependencies)
 *
 * NOTE: Google Calendar and personal Gmail are MCP tools — the agent must call those
 * separately and merge the results. This file handles the code-accessible sources.
 */

const TZ = "America/Los_Angeles";

// ---------------------------------------------------------------------------
// Spring 2026 course config
// ---------------------------------------------------------------------------

const CANVAS_COURSE_IDS = [1552931, 1553372, 1551874, 1552095, 1553928];
const ED_ACTIVE_COURSE_IDS = [94278, 94543];

const COURSE_NAMES: Record<number, string> = {
  1552931: "STAT 135",
  1553372: "INDENG 151",
  1551874: "LS 4/104",
  1552095: "LS 138",
  1553928: "CIVENG 198",
};

const ED_COURSE_NAMES: Record<number, string> = {
  94278: "STAT 135",
  94543: "IEOR 198",
};

const ED_KEYWORDS = ["exam", "midterm", "quiz", "CBTF", "homework", "due", "deadline", "office hours", "final"];

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

function assignmentLink(courseId: number, assignmentId: number): string {
  return `https://bcourses.berkeley.edu/courses/${courseId}/assignments/${assignmentId}`;
}

function edLink(courseId: number, threadId: number): string {
  return `https://edstem.org/us/courses/${courseId}/discussion/${threadId}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Canvas brief
// ---------------------------------------------------------------------------

export async function raw_canvasBrief(): Promise<{
  todo: any[];
  missing: any[];
  upcoming: any[];
  assignmentsDueSoon: { assignment: any; submission: any; courseId: number }[];
  announcements: any[];
}> {
  // Lazy import — canvas functions are available because skill_dependencies resolved them
  const canvas = await import("../canvas/functions.ts");

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + 14);

  // Phase 1: parallel fetch of overview data
  const [todo, missing, upcoming, courses] = await Promise.all([
    canvas.raw_getTodo().catch(() => []),
    canvas.raw_getMissingSubmissions().catch(() => []),
    canvas.raw_getUpcomingEvents().catch(() => []),
    canvas.raw_getCourses().catch(() => []),
  ]);

  // Phase 2: per-course assignments (parallel)
  const assignmentResults = await Promise.all(
    CANVAS_COURSE_IDS.map(async (courseId) => {
      try {
        const assignments = await canvas.raw_getAssignments(courseId);
        return { courseId, assignments };
      } catch {
        return { courseId, assignments: [] };
      }
    })
  );

  // Filter to assignments due in next 14 days
  const dueSoon: { assignment: any; courseId: number }[] = [];
  for (const { courseId, assignments } of assignmentResults) {
    for (const a of assignments) {
      if (!a.due_at) continue;
      const dueDate = new Date(a.due_at);
      if (dueDate >= now && dueDate <= cutoff) {
        dueSoon.push({ assignment: a, courseId });
      }
    }
  }

  // Phase 3: check submission status for due-soon assignments (parallel)
  const withSubmissions = await Promise.all(
    dueSoon.map(async ({ assignment, courseId }) => {
      try {
        const submission = await canvas.raw_getSubmission(courseId, assignment.id);
        return { assignment, submission, courseId };
      } catch {
        return { assignment, submission: null, courseId };
      }
    })
  );

  // Phase 4: announcements (single call with all course IDs)
  let announcements: any[] = [];
  try {
    announcements = await canvas.raw_getAnnouncements(CANVAS_COURSE_IDS);
    // Filter to last 7 days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    announcements = announcements.filter(
      (a: any) => new Date(a.posted_at ?? a.created_at) >= weekAgo
    );
  } catch {}

  return {
    todo,
    missing,
    upcoming,
    assignmentsDueSoon: withSubmissions,
    announcements,
  };
}

// ---------------------------------------------------------------------------
// EdStem brief
// ---------------------------------------------------------------------------

export async function raw_edBrief(): Promise<{
  recentThreads: { courseId: number; courseName: string; threads: any[] }[];
  keywordHits: { courseId: number; keyword: string; threads: any[] }[];
}> {
  const ed = await import("../edstem/functions.ts");

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Phase 1: recent threads for each course (parallel)
  const recentResults = await Promise.all(
    ED_ACTIVE_COURSE_IDS.map(async (courseId) => {
      try {
        const data = await ed.raw_listThreads(courseId, { limit: 25, sort: "new" });
        const threads = (data.threads ?? []).filter((t: any) => {
          const created = new Date(t.created_at);
          return created >= weekAgo;
        });
        return { courseId, courseName: ED_COURSE_NAMES[courseId] ?? `Course ${courseId}`, threads };
      } catch {
        return { courseId, courseName: ED_COURSE_NAMES[courseId] ?? `Course ${courseId}`, threads: [] };
      }
    })
  );

  // Phase 2: keyword searches (parallel, batched)
  const keywordSearches = ED_ACTIVE_COURSE_IDS.flatMap((courseId) =>
    ED_KEYWORDS.map((keyword) => ({ courseId, keyword }))
  );

  const keywordResults = await Promise.all(
    keywordSearches.map(async ({ courseId, keyword }) => {
      try {
        const data = await ed.raw_listThreads(courseId, { search: keyword, limit: 5, sort: "new" });
        const threads = (data.threads ?? []).filter((t: any) => {
          const created = new Date(t.created_at);
          return created >= weekAgo;
        });
        return { courseId, keyword, threads };
      } catch {
        return { courseId, keyword, threads: [] };
      }
    })
  );

  // Deduplicate keyword hits (remove threads already in recent)
  const recentIds = new Set(recentResults.flatMap((r) => r.threads.map((t: any) => t.id)));
  const uniqueKeywordHits = keywordResults
    .map((r) => ({
      ...r,
      threads: r.threads.filter((t: any) => !recentIds.has(t.id)),
    }))
    .filter((r) => r.threads.length > 0);

  return { recentThreads: recentResults, keywordHits: uniqueKeywordHits };
}

// ---------------------------------------------------------------------------
// School email brief
// ---------------------------------------------------------------------------

export async function raw_schoolEmail(): Promise<{ messages: { id: string; from: string; subject: string; date: string; snippet: string }[] }> {
  const gwsMail = await import("../gws-mail/functions.ts");

  let result: any;
  try {
    result = await gwsMail.raw_searchMessages("newer_than:3d");
  } catch {
    return { messages: [] };
  }

  const msgList = result.messages ?? [];
  if (msgList.length === 0) return { messages: [] };

  // Fetch headers for each (up to 15)
  const detailed = await Promise.all(
    msgList.slice(0, 15).map(async (m: any) => {
      try {
        const full = await gwsMail.raw_getMessage(m.id);
        const headers = full.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
        return {
          id: m.id,
          from: get("From"),
          subject: get("Subject"),
          date: get("Date"),
          snippet: full.snippet ?? "",
        };
      } catch {
        return { id: m.id, from: "?", subject: "?", date: "?", snippet: "" };
      }
    })
  );

  return { messages: detailed };
}

// ---------------------------------------------------------------------------
// Combined readable brief
// ---------------------------------------------------------------------------

export async function readable_academicBrief(): Promise<string> {
  // Run all three sources in parallel
  const [canvasData, edData, emailData] = await Promise.all([
    raw_canvasBrief().catch((e) => ({ todo: [], missing: [], upcoming: [], assignmentsDueSoon: [], announcements: [], error: e.message })),
    raw_edBrief().catch((e) => ({ recentThreads: [], keywordHits: [], error: e.message })),
    raw_schoolEmail().catch((e) => ({ messages: [], error: e.message })),
  ]);

  const lines: string[] = [];

  // --- CANVAS SECTION ---
  lines.push("# Canvas Data", "");

  // Missing submissions
  const missing = (canvasData as any).missing ?? [];
  if (missing.length > 0) {
    lines.push(`## Missing Submissions (${missing.length})`, "");
    for (const a of missing) {
      const course = COURSE_NAMES[a.course_id] ?? `course ${a.course_id}`;
      lines.push(`- **${a.name}** (${course}) — was due ${fmtDate(a.due_at)} — [link](${a.html_url ?? ""})`);
    }
    lines.push("");
  }

  // Assignments due soon with submission status
  const dueSoon = (canvasData as any).assignmentsDueSoon ?? [];
  if (dueSoon.length > 0) {
    lines.push(`## Assignments Due in Next 14 Days (${dueSoon.length})`, "");
    for (const { assignment: a, submission: s, courseId } of dueSoon) {
      const course = COURSE_NAMES[courseId] ?? `course ${courseId}`;
      const submitted = s?.submitted_at ? "SUBMITTED" : "NOT SUBMITTED";
      const grade = s?.grade ? ` | Grade: ${s.grade}` : "";
      const link = assignmentLink(courseId, a.id);
      lines.push(`- **${a.name}** (${course}) — due ${fmtDate(a.due_at)} — ${submitted}${grade} — [link](${link})`);
    }
    lines.push("");
  }

  // TODO items
  const todo = (canvasData as any).todo ?? [];
  if (todo.length > 0) {
    lines.push(`## Canvas TODO (${todo.length})`, "");
    for (const item of todo) {
      const a = item.assignment;
      if (!a) continue;
      lines.push(`- **${a.name}** (${item.context_name ?? ""}) — due ${fmtDate(a.due_at)} — [link](${a.html_url ?? ""})`);
    }
    lines.push("");
  }

  // Announcements
  const announcements = (canvasData as any).announcements ?? [];
  if (announcements.length > 0) {
    lines.push(`## Canvas Announcements (last 7 days: ${announcements.length})`, "");
    for (const a of announcements) {
      const courseCode = a.context_code?.replace("course_", "") ?? "";
      const course = COURSE_NAMES[Number(courseCode)] ?? courseCode;
      const preview = stripHtml(a.message ?? "").slice(0, 200);
      lines.push(`- **${a.title}** (${course}) — ${fmtDate(a.posted_at)} — [link](${a.html_url ?? ""})`);
      if (preview) lines.push(`  ${preview}${preview.length >= 200 ? "..." : ""}`);
    }
    lines.push("");
  }

  // --- EDSTEM SECTION ---
  lines.push("# EdStem Data", "");

  const recentThreads = (edData as any).recentThreads ?? [];
  for (const { courseId, courseName, threads } of recentThreads) {
    if (threads.length === 0) continue;
    const announcements = threads.filter((t: any) => t.type === "announcement");
    const questions = threads.filter((t: any) => t.type !== "announcement");

    if (announcements.length > 0) {
      lines.push(`## ${courseName} — Announcements (${announcements.length})`, "");
      for (const t of announcements) {
        const cat = t.category ? ` [${t.category}]` : "";
        lines.push(`- **${t.title}**${cat} — by ${t.user?.name ?? "?"} — ${fmtDate(t.created_at)} — [link](${edLink(courseId, t.id)})`);
      }
      lines.push("");
    }

    if (questions.length > 0) {
      lines.push(`## ${courseName} — Recent Threads (${questions.length})`, "");
      for (const t of questions.slice(0, 10)) {
        const answered = t.is_answered ? " [answered]" : "";
        lines.push(`- **${t.title}**${answered} — ${fmtDate(t.created_at)} — [link](${edLink(courseId, t.id)})`);
      }
      lines.push("");
    }
  }

  // Keyword hits not already seen
  const keywordHits = (edData as any).keywordHits ?? [];
  if (keywordHits.length > 0) {
    lines.push("## EdStem Keyword Hits (exam/midterm/quiz/CBTF/deadline)", "");
    for (const { courseId, keyword, threads } of keywordHits) {
      for (const t of threads) {
        lines.push(`- [${keyword}] **${t.title}** (${ED_COURSE_NAMES[courseId] ?? courseId}) — ${fmtDate(t.created_at)} — [link](${edLink(courseId, t.id)})`);
      }
    }
    lines.push("");
  }

  // --- SCHOOL EMAIL SECTION ---
  const emails = (emailData as any).messages ?? [];
  if (emails.length > 0) {
    lines.push("# School Email (sjayaram@berkeley.edu)", "");
    lines.push(`## Recent Messages (${emails.length})`, "");
    for (const m of emails) {
      lines.push(`- **${m.subject}** — from ${m.from} — ${m.date} (id: ${m.id})`);
      if (m.snippet) lines.push(`  ${m.snippet.slice(0, 150)}`);
    }
    lines.push("");
  }

  // Error notes
  if ((canvasData as any).error) lines.push(`> Canvas error: ${(canvasData as any).error}`, "");
  if ((edData as any).error) lines.push(`> EdStem error: ${(edData as any).error}`, "");
  if ((emailData as any).error) lines.push(`> School email error: ${(emailData as any).error}`, "");

  return lines.join("\n");
}
