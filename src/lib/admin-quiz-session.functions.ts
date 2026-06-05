/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Forbidden: admin role required");
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- List sessions (review queue) ----------
const listInput = z.object({
  status: z
    .enum(["pending_review", "ready", "in_progress", "submitted", "expired", "rejected", "all"])
    .default("pending_review"),
  page: z.number().int().min(1).max(2000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const adminListQuizSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof listInput>) => listInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin((context.supabase as any), context.userId);
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = (context.supabase as any)
      .from("quiz_sessions")
      .select(
        "id,user_id,chapter_id,subject_id,level,status,question_count,duration_seconds,score,correct_count,wrong_count,created_at,started_at,submitted_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error, count } = await q;
    if (error) throw error;

    // enrich with chapter/student display
    const userIds = Array.from(new Set((rows ?? []).map((r: { user_id: string }) => r.user_id)));
    const chapterIds = Array.from(new Set((rows ?? []).map((r: { chapter_id: string }) => r.chapter_id)));
    type ProfileRow = { id: string; display_name: string | null; email?: string | null };
    type ChapterRow = { id: string; name: string };
    const [profiles, chapters] = await Promise.all([
      userIds.length
        ? (context.supabase as any).from("profiles").select("id,display_name,email").in("id", userIds)
        : Promise.resolve({ data: [] as ProfileRow[] }),
      chapterIds.length
        ? (context.supabase as any).from("chapters").select("id,name").in("id", chapterIds)
        : Promise.resolve({ data: [] as ChapterRow[] }),
    ]);
    const pMap = new Map(
      (((profiles as { data: ProfileRow[] | null }).data ?? []) as ProfileRow[]).map((p) => [p.id, p]),
    );
    const cMap = new Map(
      (((chapters as { data: ChapterRow[] | null }).data ?? []) as ChapterRow[]).map((c) => [c.id, c]),
    );

    return {
      rows: (rows ?? []).map((r: { user_id: string; chapter_id: string } & Record<string, unknown>) => ({
        ...r,
        student: pMap.get(r.user_id) ?? null,
        chapter: cMap.get(r.chapter_id) ?? null,
      })),
      count: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const adminQuizSessionStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin((context.supabase as any), context.userId);
    const sb = (context.supabase as any) as any;
    const todayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [pending, ready, inProgress, submittedToday] = await Promise.all([
      sb.from("quiz_sessions").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
      sb.from("quiz_sessions").select("id", { count: "exact", head: true }).eq("status", "ready"),
      sb.from("quiz_sessions").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
      sb
        .from("quiz_sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "submitted")
        .gte("submitted_at", todayIso),
    ]);
    return {
      pending: pending.count ?? 0,
      ready: ready.count ?? 0,
      inProgress: inProgress.count ?? 0,
      submittedToday: submittedToday.count ?? 0,
    };
  });

// ---------- Detail with full MCQ payload + chapter pool ----------
export const adminGetQuizSessionDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin((context.supabase as any), context.userId);
    const sb = (context.supabase as any) as any;
    const { data: s, error } = await sb.from("quiz_sessions").select("*").eq("id", data.id).maybeSingle();
    if (error) throw error;
    if (!s) throw new Error("Session not found");

    const [mcqResp, poolResp, profileResp, chapterResp] = await Promise.all([
      s.mcq_ids?.length
        ? sb
            .from("mcqs")
            .select("id,question,option_a,option_b,option_c,option_d,correct_option,explanation,difficulty")
            .in("id", s.mcq_ids as string[])
        : Promise.resolve({ data: [] }),
      sb
        .from("mcqs")
        .select("id,question,difficulty")
        .eq("chapter_id", s.chapter_id)
        .eq("status", "published")
        .limit(500),
      sb.from("profiles").select("id,display_name,email").eq("id", s.user_id).maybeSingle(),
      sb.from("chapters").select("id,name").eq("id", s.chapter_id).maybeSingle(),
    ]);

    type MR = { id: string } & Record<string, unknown>;
    const map = new Map((((mcqResp as { data: MR[] | null }).data ?? []) as MR[]).map((m) => [m.id, m]));
    const orderedMcqs = (s.mcq_ids as string[]).map((id) => map.get(id)).filter(Boolean) as any[];

    return {
      session: s,
      mcqs: orderedMcqs,
      pool: ((poolResp as { data: any[] | null }).data ?? []) as any[],
      student: (profileResp as { data: any }).data ?? null,
      chapter: (chapterResp as { data: any }).data ?? null,
    } as any;
  });

// ---------- Replace one question ----------
const replaceInput = z.object({
  sessionId: z.string().uuid(),
  oldMcqId: z.string().uuid(),
  newMcqId: z.string().uuid(),
});
export const adminReplaceQuizSessionQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof replaceInput>) => replaceInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin((context.supabase as any), context.userId);
    const sb = (context.supabase as any) as any;
    const { data: s, error } = await sb
      .from("quiz_sessions")
      .select("id,status,mcq_ids")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!s) throw new Error("Session not found");
    if (s.status !== "pending_review") throw new Error("Only pending sessions can be edited");
    const arr = (s.mcq_ids as string[]).map((id) => (id === data.oldMcqId ? data.newMcqId : id));
    if (new Set(arr).size !== arr.length) throw new Error("Question already in this quiz");
    const { error: uErr } = await sb.from("quiz_sessions").update({ mcq_ids: arr }).eq("id", data.sessionId);
    if (uErr) throw uErr;
    return { ok: true };
  });

// ---------- Regenerate all questions ----------
export const adminRegenerateQuizSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { sessionId: string }) =>
    z.object({ sessionId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin((context.supabase as any), context.userId);
    const sb = (context.supabase as any) as any;
    const { data: s, error } = await sb
      .from("quiz_sessions")
      .select("id,status,chapter_id,question_count")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!s) throw new Error("Session not found");
    if (s.status !== "pending_review") throw new Error("Only pending sessions can be regenerated");
    const { data: pool, error: pErr } = await sb
      .from("mcqs")
      .select("id")
      .eq("chapter_id", s.chapter_id)
      .eq("status", "published");
    if (pErr) throw pErr;
    const ids = (pool ?? []).map((m: { id: string }) => m.id);
    if (ids.length === 0) throw new Error("No published MCQs in this chapter");
    const picked = shuffle(ids).slice(0, Math.min(s.question_count ?? 10, ids.length));
    const { error: uErr } = await sb
      .from("quiz_sessions")
      .update({ mcq_ids: picked, question_count: picked.length })
      .eq("id", data.sessionId);
    if (uErr) throw uErr;
    return { ok: true, count: picked.length };
  });

// ---------- Approve session ----------
const approveInput = z.object({
  sessionId: z.string().uuid(),
  durationSeconds: z.number().int().min(60).max(3600).optional(),
});
export const adminApproveQuizSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof approveInput>) => approveInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin((context.supabase as any), context.userId);
    const sb = (context.supabase as any) as any;
    const patch: Record<string, unknown> = {
      status: "ready",
      approved_by: context.userId,
      approved_at: new Date().toISOString(),
    };
    if (data.durationSeconds) patch.duration_seconds = data.durationSeconds;
    const { error } = await sb
      .from("quiz_sessions")
      .update(patch)
      .eq("id", data.sessionId)
      .eq("status", "pending_review");
    if (error) throw error;
    return { ok: true };
  });

// ---------- Reject session ----------
export const adminRejectQuizSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { sessionId: string; reason?: string }) =>
    z.object({ sessionId: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin((context.supabase as any), context.userId);
    const { error } = await (context.supabase as any)
      .from("quiz_sessions")
      .update({ status: "rejected", reject_reason: data.reason ?? null })
      .eq("id", data.sessionId)
      .eq("status", "pending_review");
    if (error) throw error;
    return { ok: true };
  });
