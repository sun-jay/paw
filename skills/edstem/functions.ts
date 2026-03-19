const BASE = "https://us.edstem.org/api";
const TZ = "America/Los_Angeles";

function token(): string {
  const t = process.env.ED_API_TOKEN;
  if (!t) throw new Error("ED_API_TOKEN not set — activate the edstem skill first");
  return t;
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ed API ${res.status}: ${path} — ${body}`);
  }
  return res.json();
}

function edLink(courseId: number, threadId: number): string {
  return `https://edstem.org/us/courses/${courseId}/discussion/${threadId}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Raw layer — one function per endpoint
// ---------------------------------------------------------------------------

export async function raw_getUser(): Promise<any> {
  return api("/user");
}

export async function raw_getCourse(courseId: number): Promise<any> {
  return api(`/courses/${courseId}`);
}

export interface ListThreadsOpts {
  limit?: number;
  offset?: number;
  sort?: "new" | "old" | "top" | "hot" | "recent";
  filter?: "unanswered" | "unresolved" | "resolved" | "starred" | "watched" | "private";
  category?: string;
  search?: string;
}

export async function raw_listThreads(courseId: number, opts: ListThreadsOpts = {}): Promise<any> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.filter) params.set("filter", opts.filter);
  if (opts.category) params.set("category", opts.category);
  if (opts.search) params.set("search", opts.search);
  const qs = params.toString();
  return api(`/courses/${courseId}/threads${qs ? `?${qs}` : ""}`);
}

export async function raw_getThread(threadId: number): Promise<any> {
  return api(`/threads/${threadId}`);
}

export async function raw_getThreadByNumber(courseId: number, number: number): Promise<any> {
  return api(`/courses/${courseId}/threads/${number}`);
}

export interface CreateThreadInput {
  type: "post" | "question" | "announcement";
  title: string;
  category?: string;
  content: string; // XML
  is_pinned?: boolean;
  is_private?: boolean;
  is_anonymous?: boolean;
}

export async function raw_createThread(courseId: number, thread: CreateThreadInput): Promise<any> {
  return api(`/courses/${courseId}/threads`, {
    method: "POST",
    body: JSON.stringify({ thread }),
  });
}

export async function raw_pinThread(threadId: number): Promise<any> {
  return api(`/threads/${threadId}/pin`, { method: "POST" });
}

export async function raw_lockThread(threadId: number): Promise<any> {
  return api(`/threads/${threadId}/lock`, { method: "POST" });
}

export async function raw_starThread(threadId: number): Promise<any> {
  return api(`/threads/${threadId}/star`, { method: "POST" });
}

export async function raw_endorseThread(threadId: number): Promise<any> {
  return api(`/threads/${threadId}/endorse`, { method: "POST" });
}

export interface UserActivityOpts {
  courseID?: number;
  limit?: number;
  offset?: number;
  filter?: "all" | "thread" | "answer" | "comment";
}

export async function raw_getUserActivity(userId: number, opts: UserActivityOpts = {}): Promise<any> {
  const params = new URLSearchParams();
  if (opts.courseID) params.set("courseID", String(opts.courseID));
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  if (opts.filter) params.set("filter", opts.filter);
  const qs = params.toString();
  return api(`/users/${userId}/profile/activity${qs ? `?${qs}` : ""}`);
}

export async function raw_getLessons(courseId: number): Promise<any> {
  return api(`/courses/${courseId}/lessons`);
}

export async function raw_getChallenges(courseId: number): Promise<any> {
  return api(`/courses/${courseId}/challenges`);
}

export async function raw_getResources(courseId: number): Promise<any> {
  return api(`/courses/${courseId}/resources`);
}

// ---------------------------------------------------------------------------
// Readable layer — condensed markdown
// ---------------------------------------------------------------------------

export async function readable_myCourses(): Promise<string> {
  try {
    const data = await raw_getUser();
    const courses = data.courses ?? [];
    if (courses.length === 0) return "No enrolled courses found.";
    const lines = ["## My Ed Courses", ""];
    for (const entry of courses) {
      const c = entry.course;
      lines.push(`- **${c.code ?? ""}** ${c.name} (ID: ${c.id}, ${c.status})`);
    }
    return lines.join("\n");
  } catch (e: any) {
    return `Error listing courses: ${e.message}`;
  }
}

export async function readable_listThreads(courseId: number, opts: ListThreadsOpts = {}): Promise<string> {
  try {
    const data = await raw_listThreads(courseId, { limit: opts.limit ?? 20, ...opts });
    const threads = data.threads ?? [];
    if (threads.length === 0) return "No threads found.";
    const lines = [`## Threads (${threads.length} results)`, ""];
    for (const t of threads) {
      const answered = t.is_answered ? " [answered]" : "";
      const type = t.type === "question" ? "Q" : t.type === "announcement" ? "A" : "P";
      const date = fmtDate(t.created_at);
      const link = edLink(courseId, t.id);
      lines.push(`- [${type}]${answered} **${t.title}** — ${t.category ?? "uncategorized"}, ${date} ([link](${link}))`);
    }
    return lines.join("\n");
  } catch (e: any) {
    return `Error listing threads: ${e.message}`;
  }
}

export async function readable_getThread(threadId: number): Promise<string> {
  try {
    const data = await raw_getThread(threadId);
    const t = data.thread ?? data;
    const lines = [
      `## ${t.title}`,
      `**Type:** ${t.type} | **Category:** ${t.category ?? "none"} | **Answered:** ${t.is_answered ?? false}`,
      `**Created:** ${fmtDate(t.created_at)} | **#${t.number}** | ID: ${t.id}`,
      "",
    ];

    // Strip XML tags for readability
    const content = stripXml(t.document ?? t.content ?? "");
    if (content) lines.push(content, "");

    // Answers
    const answers = t.answers ?? [];
    if (answers.length > 0) {
      lines.push("### Answers", "");
      for (const a of answers) {
        const who = a.user?.name ?? "Anonymous";
        const endorsed = a.is_endorsed ? " [endorsed]" : "";
        lines.push(`**${who}**${endorsed} (${fmtDate(a.created_at)}):`);
        lines.push(stripXml(a.document ?? a.content ?? ""), "");
      }
    }

    // Comments
    const comments = t.comments ?? [];
    if (comments.length > 0) {
      lines.push("### Comments", "");
      for (const c of comments) {
        const who = c.user?.name ?? "Anonymous";
        lines.push(`**${who}** (${fmtDate(c.created_at)}): ${stripXml(c.document ?? c.content ?? "")}`);
      }
    }

    return lines.join("\n");
  } catch (e: any) {
    return `Error fetching thread: ${e.message}`;
  }
}

export async function readable_searchThreads(courseId: number, query: string): Promise<string> {
  return readable_listThreads(courseId, { search: query, limit: 20 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
