const BASE = process.env.CANVAS_BASE_URL ?? "https://canvas.instructure.com/api/v1";
const TZ = "America/Los_Angeles";

function token(): string {
  const t = process.env.CANVAS_API_TOKEN;
  if (!t) throw new Error("CANVAS_API_TOKEN not set — activate the canvas skill first");
  return t;
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${token()}` };
}

async function api(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Canvas API ${res.status}: ${path} — ${body}`);
  }
  return res.json();
}

/** Fetch all pages for a paginated endpoint */
async function apiAll(path: string, params?: Record<string, string>): Promise<any[]> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("per_page", "50");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  let results: any[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: headers() });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Canvas API ${res.status}: ${path} — ${body}`);
    }
    const data = await res.json();
    results = results.concat(data);

    // Parse Link header for next page
    const link = res.headers.get("link");
    nextUrl = null;
    if (link) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) nextUrl = match[1];
    }
  }

  return results;
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

function courseLink(courseId: number): string {
  return `${BASE.replace("/api/v1", "")}/courses/${courseId}`;
}

function assignmentLink(courseId: number, assignmentId: number): string {
  return `${BASE.replace("/api/v1", "")}/courses/${courseId}/assignments/${assignmentId}`;
}

// ---------------------------------------------------------------------------
// Raw layer
// ---------------------------------------------------------------------------

export async function raw_getProfile(): Promise<any> {
  return api("/users/self/profile");
}

export async function raw_getTodo(): Promise<any[]> {
  return api("/users/self/todo");
}

export async function raw_getUpcomingEvents(): Promise<any[]> {
  return api("/users/self/upcoming_events");
}

export async function raw_getMissingSubmissions(): Promise<any[]> {
  return apiAll("/users/self/missing_submissions");
}

export async function raw_getGrades(): Promise<any[]> {
  return apiAll("/users/self/enrollments", {
    "include[]": "current_grading_period_scores",
  });
}

export async function raw_getCourses(): Promise<any[]> {
  return apiAll("/courses", { enrollment_state: "active" });
}

export async function raw_getDashboard(): Promise<any[]> {
  return api("/dashboard/dashboard_cards");
}

export async function raw_getAssignments(courseId: number): Promise<any[]> {
  return apiAll(`/courses/${courseId}/assignments`, {
    order_by: "due_at",
  });
}

export async function raw_getAssignment(courseId: number, assignmentId: number): Promise<any> {
  return api(`/courses/${courseId}/assignments/${assignmentId}`);
}

export async function raw_getSubmission(courseId: number, assignmentId: number): Promise<any> {
  return api(`/courses/${courseId}/assignments/${assignmentId}/submissions/self`);
}

export async function raw_getAnnouncements(courseIds: number[]): Promise<any[]> {
  const url = new URL(`${BASE}/announcements`);
  url.searchParams.set("per_page", "20");
  for (const id of courseIds) {
    url.searchParams.append("context_codes[]", `course_${id}`);
  }
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Canvas API ${res.status}: /announcements — ${body}`);
  }
  return res.json();
}

export async function raw_getModules(courseId: number): Promise<any[]> {
  return apiAll(`/courses/${courseId}/modules`, { "include[]": "items" });
}

export async function raw_getFiles(courseId: number, searchTerm?: string): Promise<any[]> {
  const params: Record<string, string> = {};
  if (searchTerm) params.search_term = searchTerm;
  return apiAll(`/courses/${courseId}/files`, params);
}

export async function raw_getDiscussionTopics(courseId: number): Promise<any[]> {
  return apiAll(`/courses/${courseId}/discussion_topics`);
}

// ---------------------------------------------------------------------------
// Readable layer
// ---------------------------------------------------------------------------

export async function readable_myCourses(): Promise<string> {
  try {
    const courses = await raw_getCourses();
    if (courses.length === 0) return "No active courses found.";
    const lines = ["## My Canvas Courses", ""];
    for (const c of courses) {
      const name = c.course_code ? `**${c.course_code}** — ${c.name}` : `**${c.name}**`;
      lines.push(`- ${name} (ID: ${c.id}) — [link](${courseLink(c.id)})`);
    }
    return lines.join("\n");
  } catch (e: any) {
    return `Error listing courses: ${e.message}`;
  }
}

export async function readable_todo(): Promise<string> {
  try {
    const items = await raw_getTodo();
    if (items.length === 0) return "No to-do items.";
    const lines = ["## Canvas To-Do", ""];
    for (const item of items) {
      const a = item.assignment;
      if (!a) continue;
      const due = fmtDate(a.due_at);
      const link = a.html_url ?? "";
      const course = item.context_name ?? "";
      lines.push(`- **${a.name}** — ${course}, due ${due} — [link](${link})`);
    }
    return lines.join("\n");
  } catch (e: any) {
    return `Error fetching to-do: ${e.message}`;
  }
}

export async function readable_missingSubmissions(): Promise<string> {
  try {
    const items = await raw_getMissingSubmissions();
    if (items.length === 0) return "No missing submissions!";
    const lines = ["## Missing Submissions", ""];
    for (const a of items) {
      const due = fmtDate(a.due_at);
      const link = a.html_url ?? "";
      const course = a.course_id ? `(course ${a.course_id})` : "";
      lines.push(`- **${a.name}** ${course} — due ${due} — [link](${link})`);
    }
    return lines.join("\n");
  } catch (e: any) {
    return `Error fetching missing submissions: ${e.message}`;
  }
}

export async function readable_courseAssignments(courseId: number): Promise<string> {
  try {
    const assignments = await raw_getAssignments(courseId);
    if (assignments.length === 0) return "No assignments found for this course.";

    const now = new Date();
    const upcoming = assignments.filter(
      (a: any) => a.due_at && new Date(a.due_at) >= now
    );
    const past = assignments.filter(
      (a: any) => !a.due_at || new Date(a.due_at) < now
    );

    const lines = [`## Assignments (${assignments.length} total)`, ""];

    if (upcoming.length > 0) {
      lines.push("### Upcoming", "");
      for (const a of upcoming) {
        const due = fmtDate(a.due_at);
        const pts = a.points_possible != null ? ` (${a.points_possible} pts)` : "";
        const link = assignmentLink(courseId, a.id);
        lines.push(`- **${a.name}**${pts} — due ${due} — [link](${link})`);
      }
      lines.push("");
    }

    if (past.length > 0) {
      lines.push("### Past", "");
      for (const a of past.slice(-10)) {
        const due = fmtDate(a.due_at);
        const pts = a.points_possible != null ? ` (${a.points_possible} pts)` : "";
        const link = assignmentLink(courseId, a.id);
        lines.push(`- **${a.name}**${pts} — due ${due} — [link](${link})`);
      }
    }

    return lines.join("\n");
  } catch (e: any) {
    return `Error fetching assignments: ${e.message}`;
  }
}

export async function readable_announcements(courseIds?: number[]): Promise<string> {
  try {
    let ids = courseIds;
    if (!ids || ids.length === 0) {
      const courses = await raw_getCourses();
      ids = courses.map((c: any) => c.id);
    }
    if (ids.length === 0) return "No courses found.";

    const announcements = await raw_getAnnouncements(ids);
    if (announcements.length === 0) return "No recent announcements.";

    const lines = ["## Recent Announcements", ""];
    for (const a of announcements) {
      const date = fmtDate(a.posted_at ?? a.created_at);
      const course = a.context_code?.replace("course_", "") ?? "";
      const link = a.html_url ?? "";
      // Strip HTML tags from message for preview
      const preview = (a.message ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim()
        .slice(0, 150);
      lines.push(`- **${a.title}** — course ${course}, ${date} — [link](${link})`);
      if (preview) lines.push(`  ${preview}${preview.length >= 150 ? "…" : ""}`);
    }
    return lines.join("\n");
  } catch (e: any) {
    return `Error fetching announcements: ${e.message}`;
  }
}

export async function readable_weeklyPlan(): Promise<string> {
  try {
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [courses, todo, missing, grades] = await Promise.all([
      raw_getCourses(),
      raw_getTodo(),
      raw_getMissingSubmissions(),
      raw_getGrades(),
    ]);

    const courseMap = new Map<number, string>();
    for (const c of courses) {
      courseMap.set(c.id, c.course_code ?? c.name);
    }

    const lines = ["## Weekly Plan", `*${fmtDate(now.toISOString())} → ${fmtDate(weekEnd.toISOString())}*`, ""];

    // Missing submissions (urgent)
    if (missing.length > 0) {
      lines.push("### Missing / Overdue", "");
      for (const a of missing) {
        const due = fmtDate(a.due_at);
        const link = a.html_url ?? "";
        const course = courseMap.get(a.course_id) ?? `course ${a.course_id}`;
        lines.push(`- **${a.name}** (${course}) — was due ${due} — [link](${link})`);
      }
      lines.push("");
    }

    // To-do items
    if (todo.length > 0) {
      lines.push("### Upcoming To-Do", "");
      for (const item of todo) {
        const a = item.assignment;
        if (!a) continue;
        const due = fmtDate(a.due_at);
        const link = a.html_url ?? "";
        const course = item.context_name ?? "";
        lines.push(`- **${a.name}** (${course}) — due ${due} — [link](${link})`);
      }
      lines.push("");
    }

    // Grades
    const courseGrades = grades.filter(
      (e: any) => e.type === "StudentEnrollment" && e.enrollment_state === "active"
    );
    if (courseGrades.length > 0) {
      lines.push("### Current Grades", "");
      for (const e of courseGrades) {
        const course = courseMap.get(e.course_id) ?? `course ${e.course_id}`;
        const score = e.grades?.current_score ?? e.computed_current_score;
        const grade = e.grades?.current_grade ?? "";
        const display = score != null ? `${score}%${grade ? ` (${grade})` : ""}` : "N/A";
        lines.push(`- **${course}**: ${display}`);
      }
    }

    return lines.join("\n");
  } catch (e: any) {
    return `Error building weekly plan: ${e.message}`;
  }
}

export async function readable_dailyBrief(): Promise<string> {
  try {
    const [courses, todo, upcoming, missing] = await Promise.all([
      raw_getCourses(),
      raw_getTodo(),
      raw_getUpcomingEvents(),
      raw_getMissingSubmissions(),
    ]);

    const courseIds = courses.map((c: any) => c.id);
    const courseMap = new Map<number, string>();
    for (const c of courses) {
      courseMap.set(c.id, c.course_code ?? c.name);
    }

    let announcements: any[] = [];
    try {
      announcements = courseIds.length > 0 ? await raw_getAnnouncements(courseIds) : [];
    } catch {
      // announcements endpoint can fail on some courses
    }

    // Filter announcements to last 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const recentAnnouncements = announcements.filter(
      (a: any) => new Date(a.posted_at ?? a.created_at) >= threeDaysAgo
    );

    const lines = ["## Daily Brief", `*${fmtDate(new Date().toISOString())}*`, ""];

    if (missing.length > 0) {
      lines.push(`### Missing Submissions (${missing.length})`, "");
      for (const a of missing) {
        const due = fmtDate(a.due_at);
        const link = a.html_url ?? "";
        const course = courseMap.get(a.course_id) ?? `course ${a.course_id}`;
        lines.push(`- **${a.name}** (${course}) — was due ${due} — [link](${link})`);
      }
      lines.push("");
    }

    if (todo.length > 0) {
      lines.push(`### To-Do (${todo.length})`, "");
      for (const item of todo) {
        const a = item.assignment;
        if (!a) continue;
        const due = fmtDate(a.due_at);
        const link = a.html_url ?? "";
        const course = item.context_name ?? "";
        lines.push(`- **${a.name}** (${course}) — due ${due} — [link](${link})`);
      }
      lines.push("");
    }

    if (upcoming.length > 0) {
      lines.push(`### Upcoming Events (${upcoming.length})`, "");
      for (const e of upcoming) {
        const title = e.title ?? e.assignment?.name ?? "Event";
        const date = fmtDate(e.start_at ?? e.assignment?.due_at);
        const link = e.html_url ?? e.assignment?.html_url ?? "";
        lines.push(`- **${title}** — ${date} — [link](${link})`);
      }
      lines.push("");
    }

    if (recentAnnouncements.length > 0) {
      lines.push(`### Recent Announcements (${recentAnnouncements.length})`, "");
      for (const a of recentAnnouncements) {
        const date = fmtDate(a.posted_at ?? a.created_at);
        const link = a.html_url ?? "";
        lines.push(`- **${a.title}** — ${date} — [link](${link})`);
      }
    }

    if (todo.length === 0 && missing.length === 0 && upcoming.length === 0) {
      lines.push("All clear — nothing urgent today!");
    }

    return lines.join("\n");
  } catch (e: any) {
    return `Error building daily brief: ${e.message}`;
  }
}
