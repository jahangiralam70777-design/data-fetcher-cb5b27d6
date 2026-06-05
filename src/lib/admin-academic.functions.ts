import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const statusEnum = z.enum(["draft", "published", "archived"]);
const levelCode = z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Forbidden: admin role required");
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `item-${Date.now()}`;
}

// ============================================================
// TREE — single fetch to drive the whole Academic Manager UI
// ============================================================
export const adminGetAcademicTree = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const [levelsRes, subjectsRes, chaptersRes, mcqRes, quizRes] = await Promise.all([
      sb.from("levels").select("*").order("sort_order", { ascending: true }),
      sb.from("subjects").select("id,name,slug,level,color,icon,description,status,sort_order,updated_at").order("sort_order", { ascending: true }),
      sb.from("chapters").select("id,name,slug,subject_id,description,status,sort_order,updated_at").order("sort_order", { ascending: true }),
      sb.from("mcqs").select("id,chapter_id,status"),
      sb.from("quizzes").select("id,subject_id,chapter_id,kind,status"),
    ]);
    if (levelsRes.error) throw levelsRes.error;
    if (subjectsRes.error) throw subjectsRes.error;
    if (chaptersRes.error) throw chaptersRes.error;
    if (mcqRes.error) throw mcqRes.error;
    if (quizRes.error) throw quizRes.error;

    type Mcq = { id: string; chapter_id: string; status: string };
    type Qz = { id: string; subject_id: string | null; chapter_id: string | null; kind: string; status: string };

    const mcqByChapter = new Map<string, number>();
    for (const m of (mcqRes.data ?? []) as Mcq[]) {
      mcqByChapter.set(m.chapter_id, (mcqByChapter.get(m.chapter_id) ?? 0) + 1);
    }
    const quizByChapter = new Map<string, number>();
    const mockByChapter = new Map<string, number>();
    const quizBySubject = new Map<string, number>();
    const mockBySubject = new Map<string, number>();
    for (const q of (quizRes.data ?? []) as Qz[]) {
      if (q.chapter_id) {
        if (q.kind === "mock") mockByChapter.set(q.chapter_id, (mockByChapter.get(q.chapter_id) ?? 0) + 1);
        else quizByChapter.set(q.chapter_id, (quizByChapter.get(q.chapter_id) ?? 0) + 1);
      }
      if (q.subject_id) {
        if (q.kind === "mock") mockBySubject.set(q.subject_id, (mockBySubject.get(q.subject_id) ?? 0) + 1);
        else quizBySubject.set(q.subject_id, (quizBySubject.get(q.subject_id) ?? 0) + 1);
      }
    }

    return {
      levels: levelsRes.data ?? [],
      subjects: subjectsRes.data ?? [],
      chapters: chaptersRes.data ?? [],
      counts: {
        mcqByChapter: Object.fromEntries(mcqByChapter),
        quizByChapter: Object.fromEntries(quizByChapter),
        mockByChapter: Object.fromEntries(mockByChapter),
        quizBySubject: Object.fromEntries(quizBySubject),
        mockBySubject: Object.fromEntries(mockBySubject),
      },
    };
  });

// ============================================================
// LEVELS
// ============================================================
const levelInput = z.object({
  code: levelCode,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  color: z.string().trim().max(20).nullable().optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).default(0),
  status: statusEnum.default("published"),
});

export const adminCreateLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof levelInput>) => levelInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("levels").insert(data);
    if (error) throw error;
    return { ok: true };
  });

export const adminUpdateLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { code: string } & Partial<z.infer<typeof levelInput>>) =>
    levelInput.partial().extend({ code: levelCode }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { code, ...patch } = data;
    const { error } = await context.supabase.from("levels").update(patch).eq("code", code);
    if (error) throw error;
    return { ok: true };
  });

export const adminDeleteLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { code: string }) => z.object({ code: levelCode }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { count, error: ce } = await context.supabase
      .from("subjects")
      .select("id", { count: "exact", head: true })
      .eq("level", data.code);
    if (ce) throw ce;
    if ((count ?? 0) > 0) throw new Error(`Cannot delete level: ${count} subject(s) still assigned`);
    const { error } = await context.supabase.from("levels").delete().eq("code", data.code);
    if (error) throw error;
    return { ok: true };
  });

// ============================================================
// SUBJECTS
// ============================================================
const subjectInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(80).optional(),
  level: levelCode.default("professional"),
  description: z.string().trim().max(1000).nullable().optional(),
  color: z.string().trim().max(20).nullable().optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).default(0),
  status: statusEnum.default("published"),
});

export const adminCreateSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof subjectInput>) => subjectInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const slug = data.slug?.trim() || slugify(data.name);
    const { data: row, error } = await context.supabase
      .from("subjects")
      .insert({ ...data, slug })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id };
  });

export const adminUpdateSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string } & Partial<z.infer<typeof subjectInput>>) =>
    subjectInput.partial().extend({ id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("subjects")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  });

export const adminDeleteSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { count, error: ce } = await context.supabase
      .from("chapters")
      .select("id", { count: "exact", head: true })
      .eq("subject_id", data.id);
    if (ce) throw ce;
    if ((count ?? 0) > 0) throw new Error(`Cannot delete subject: ${count} chapter(s) inside`);
    const { error } = await context.supabase.from("subjects").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const adminReorderSubjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { ids: string[] }) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await Promise.all(
      data.ids.map((id, idx) =>
        context.supabase.from("subjects").update({ sort_order: idx }).eq("id", id),
      ),
    );
    return { ok: true };
  });

// ============================================================
// CHAPTERS
// ============================================================
const chapterInput = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(120).optional(),
  subject_id: z.string().uuid(),
  description: z.string().trim().max(2000).nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).default(0),
  status: statusEnum.default("published"),
});

export const adminCreateChapter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof chapterInput>) => chapterInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const slug = data.slug?.trim() || slugify(data.name);
    const { data: row, error } = await context.supabase
      .from("chapters")
      .insert({ ...data, slug })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id };
  });

export const adminUpdateChapter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string } & Partial<z.infer<typeof chapterInput>>) =>
    chapterInput.partial().extend({ id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("chapters")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  });

export const adminDeleteChapter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { count, error: ce } = await context.supabase
      .from("mcqs")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", data.id);
    if (ce) throw ce;
    if ((count ?? 0) > 0) throw new Error(`Cannot delete chapter: ${count} MCQ(s) inside`);
    const { error } = await context.supabase.from("chapters").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const adminReorderChapters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { ids: string[] }) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await Promise.all(
      data.ids.map((id, idx) =>
        context.supabase.from("chapters").update({ sort_order: idx }).eq("id", id),
      ),
    );
    return { ok: true };
  });
