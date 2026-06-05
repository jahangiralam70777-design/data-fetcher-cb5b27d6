/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEFAULT_COUNT = 10;
const DEFAULT_DURATION = 600;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Create a new pending Quick Quiz session ----------
const createInput = z.object({
  chapterId: z.string().uuid(),
  subjectId: z.string().uuid().optional().nullable(),
  level: z.string().trim().max(40).optional().nullable(),
  questionCount: z.number().int().min(1).max(50).optional(),
  durationSeconds: z.number().int().min(60).max(3600).optional(),
});

export const createQuickQuizSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof createInput>) => createInput.parse(i))
  .handler(async ({ data, context }) => {
    const sb = (context.supabase as any) as any;
    const count = data.questionCount ?? DEFAULT_COUNT;
    const duration = data.durationSeconds ?? DEFAULT_DURATION;

    const { data: pool, error: pErr } = await sb
      .from("mcqs")
      .select("id")
      .eq("chapter_id", data.chapterId)
      .eq("status", "published");
    if (pErr) throw pErr;
    const ids = (pool ?? []).map((m: { id: string }) => m.id);
    if (ids.length === 0) {
      throw new Error("No published MCQs available in this chapter yet.");
    }
    const picked = shuffle(ids).slice(0, Math.min(count, ids.length));

    const { data: row, error } = await sb
      .from("quiz_sessions")
      .insert({
        user_id: context.userId,
        chapter_id: data.chapterId,
        subject_id: data.subjectId ?? null,
        level: data.level ?? null,
        mcq_ids: picked,
        status: "pending_review",
        duration_seconds: duration,
        question_count: picked.length,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id as string };
  });

// ---------- Read a session (own or admin) ----------
export const getQuizSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = (context.supabase as any) as any;
    const { data: s, error } = await sb
      .from("quiz_sessions")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!s) throw new Error("Session not found");

    // SECURITY: Enforce ownership. Only the session's owner (or an admin
    // RPC path) may read it. Without this guard any authenticated user
    // could enumerate UUIDs and read other students' submitted answers
    // and revealed correct options.
    if (s.user_id !== context.userId) {
      const { data: isAdmin } = await sb.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Session not found");
    }

    // attach minimal mcq payload only when student is allowed to see questions
    // (during attempt) or when reviewing the result.
    const includeFull = s.status === "in_progress" || s.status === "submitted" || s.status === "expired";
    let mcqs: Array<{
      id: string;
      question: string;
      option_a: string;
      option_b: string;
      option_c: string;
      option_d: string;
      correct_option?: string;
      explanation?: string | null;
    }> = [];

    if (includeFull && s.mcq_ids?.length) {
      const reveal = s.status === "submitted" || s.status === "expired";
      const cols = reveal
        ? "id,question,option_a,option_b,option_c,option_d,correct_option,explanation"
        : "id,question,option_a,option_b,option_c,option_d";
      const { data: rows, error: mErr } = await sb
        .from("mcqs")
        .select(cols)
        .in("id", s.mcq_ids as string[]);
      if (mErr) throw mErr;
      const map = new Map(((rows ?? []) as any[]).map((r: any) => [r.id, r]));
      mcqs = (s.mcq_ids as string[]).map((id) => map.get(id)).filter(Boolean) as typeof mcqs;
    }
    return { session: s, mcqs };
  });

// ---------- Student: start an approved session ----------
export const startQuizSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = (context.supabase as any) as any;
    const { data: s, error } = await sb
      .from("quiz_sessions")
      .select("id,status,user_id,started_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!s || s.user_id !== context.userId) throw new Error("Not found");
    if (s.status === "in_progress") return { ok: true };
    if (s.status !== "ready") throw new Error("Session is not approved yet.");

    const { error: uErr } = await sb
      .from("quiz_sessions")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", data.id);
    if (uErr) throw uErr;
    return { ok: true };
  });

// ---------- Student: submit answers ----------
const submitInput = z.object({
  id: z.string().uuid(),
  answers: z.record(z.string().uuid(), z.string().regex(/^[A-D]$/)),
});
export const submitQuizSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof submitInput>) => submitInput.parse(i))
  .handler(async ({ data, context }) => {
    const sb = (context.supabase as any) as any;
    const { data: s, error } = await sb
      .from("quiz_sessions")
      .select("id,status,user_id,mcq_ids,started_at,duration_seconds")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!s || s.user_id !== context.userId) throw new Error("Not found");
    if (s.status !== "in_progress" && s.status !== "ready") {
      throw new Error("Session already finalized.");
    }

    const { data: mcqs, error: mErr } = await sb
      .from("mcqs")
      .select("id,correct_option")
      .in("id", s.mcq_ids as string[]);
    if (mErr) throw mErr;
    const correctMap = new Map(
      (mcqs ?? []).map((m: { id: string; correct_option: string }) => [m.id, (m.correct_option || "").toUpperCase()]),
    );

    let correct = 0;
    let wrong = 0;
    for (const id of s.mcq_ids as string[]) {
      const given = (data.answers[id] || "").toUpperCase();
      if (!given) continue;
      if (given === correctMap.get(id)) correct++;
      else wrong++;
    }

    // detect expired
    const startedAt = s.started_at ? new Date(s.started_at).getTime() : Date.now();
    const elapsed = (Date.now() - startedAt) / 1000;
    const expired = elapsed > (s.duration_seconds ?? DEFAULT_DURATION) + 5;

    const { error: uErr } = await sb
      .from("quiz_sessions")
      .update({
        status: expired ? "expired" : "submitted",
        submitted_at: new Date().toISOString(),
        answers: data.answers,
        score: correct,
        correct_count: correct,
        wrong_count: wrong,
      })
      .eq("id", data.id);
    if (uErr) throw uErr;
    return { ok: true, score: correct, correct, wrong, expired };
  });

// ---------- Student: list my sessions ----------
export const listMyQuizSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("quiz_sessions")
      .select("id,chapter_id,status,score,correct_count,wrong_count,question_count,duration_seconds,created_at,submitted_at,started_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  });
