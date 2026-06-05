import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Shared schemas ----------
const optionStr = z.string().trim().min(1).max(1000);
const mcqOptionEnum = z.enum(["A", "B", "C", "D"]);
const difficultyEnum = z.enum(["easy", "medium", "hard"]);
const statusEnum = z.enum(["draft", "published", "archived"]);

const mcqInputSchema = z.object({
  chapter_id: z.string().uuid(),
  question: z.string().trim().min(3).max(4000),
  option_a: optionStr,
  option_b: optionStr,
  option_c: optionStr,
  option_d: optionStr,
  correct_option: mcqOptionEnum,
  explanation: z.string().trim().max(4000).nullable().optional(),
  difficulty: difficultyEnum.default("medium"),
  status: statusEnum.default("published"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

// ---------- Helpers ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Forbidden: admin role required");
}

// ---------- Subjects (admin view: all statuses) ----------
export const adminListSubjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("subjects")
      .select("id,name,slug,level,description,icon,color,sort_order,status")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

// ---------- Levels (admin view) ----------
export const adminListLevels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("levels")
      .select("code,name,color,icon,sort_order,status")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

const subjectInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/),
  description: z.string().trim().max(500).nullable().optional(),
  status: statusEnum.default("published"),
  sort_order: z.number().int().min(0).max(9999).default(0),
});

export const adminCreateSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof subjectInput>) => subjectInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("subjects")
      .insert(data)
      .select("id,name,slug,status,sort_order")
      .single();
    if (error) throw error;
    return row;
  });

// ---------- Chapters ----------
export const adminListChapters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { subjectId: string }) =>
    z.object({ subjectId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("chapters")
      .select("id,name,slug,description,sort_order,status,subject_id")
      .eq("subject_id", data.subjectId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });

const chapterInput = z.object({
  subject_id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9-]+$/),
  description: z.string().trim().max(500).nullable().optional(),
  status: statusEnum.default("published"),
  sort_order: z.number().int().min(0).max(9999).default(0),
});

export const adminCreateChapter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof chapterInput>) => chapterInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("chapters")
      .insert(data)
      .select("id,name,slug,status,sort_order,subject_id")
      .single();
    if (error) throw error;
    return row;
  });

// ---------- MCQs ----------
const listInput = z.object({
  chapterId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  status: statusEnum.optional(),
  difficulty: difficultyEnum.optional(),
  page: z.number().int().min(1).max(2000).default(1),
  pageSize: z.number().int().min(1).max(500).default(20),
});

export const adminListMcqs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof listInput>) => listInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    let q = context.supabase
      .from("mcqs")
      .select(
        "id,question,option_a,option_b,option_c,option_d,correct_option,explanation,difficulty,status,tags,chapter_id,updated_at",
        { count: "exact" },
      )
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (data.chapterId) q = q.eq("chapter_id", data.chapterId);
    if (data.status) q = q.eq("status", data.status);
    if (data.difficulty) q = q.eq("difficulty", data.difficulty);
    if (data.search) q = q.ilike("question", `%${data.search}%`);

    // subjectId filter requires a join — do a 2-step
    if (data.subjectId && !data.chapterId) {
      const { data: chRows, error: ce } = await context.supabase
        .from("chapters")
        .select("id")
        .eq("subject_id", data.subjectId);
      if (ce) throw ce;
      const ids = (chRows ?? []).map((c) => c.id);
      if (ids.length === 0) return { rows: [], count: 0, page: data.page, pageSize: data.pageSize };
      q = q.in("chapter_id", ids);
    }

    const { data: rows, error, count } = await q;
    if (error) throw error;
    return { rows: rows ?? [], count: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

export const adminCreateMcq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof mcqInputSchema>) => mcqInputSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("mcqs")
      .insert({ ...data, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw error;
    return row;
  });

const updateInput = mcqInputSchema.partial().extend({
  id: z.string().uuid(),
});
export const adminUpdateMcq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof updateInput>) => updateInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("mcqs").update(patch).eq("id", id);
    if (error) throw error;
    return { ok: true };
  });

export const adminDeleteMcq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("mcqs").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Bulk delete (selected ids) ----------
const bulkDeleteInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  level: z.string().trim().max(40).nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
  chapterId: z.string().uuid().nullable().optional(),
});
export const adminBulkDeleteMcqs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof bulkDeleteInput>) => bulkDeleteInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const ids = data.ids;
    const chunkSize = 500;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const slice = ids.slice(i, i + chunkSize);
      const { error, count } = await context.supabase
        .from("mcqs")
        .delete({ count: "exact" })
        .in("id", slice);
      if (error) throw error;
      deleted += count ?? slice.length;
    }
    try {
      const { data: prof } = await context.supabase
        .from("profiles").select("display_name").eq("id", context.userId).maybeSingle();
      await (context.supabase as unknown as { from: (t: string) => { insert: (v: unknown) => Promise<unknown> } }).from("mcq_delete_audit").insert({
        admin_id: context.userId,
        admin_name: prof?.display_name ?? null,
        deleted_count: deleted,
        scope: "selected",
        level: data.level ?? null,
        subject_id: data.subjectId ?? null,
        chapter_id: data.chapterId ?? null,
        mcq_ids: ids,
      });
    } catch { /* non-fatal */ }
    return { deleted };
  });

// ---------- Delete all matching current scope ----------
const deleteAllInput = z
  .object({
    level: z.string().trim().max(40).nullable().optional(),
    subjectId: z.string().uuid().nullable().optional(),
    chapterId: z.string().uuid().nullable().optional(),
    confirm: z.literal("DELETE"),
  })
  .refine((v) => !!(v.chapterId || v.subjectId || v.level), {
    message: "A level, subject, or chapter scope is required",
  });
export const adminDeleteAllMcqs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof deleteAllInput>) => deleteAllInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    let chapterIds: string[] = [];
    if (data.chapterId) {
      chapterIds = [data.chapterId];
    } else if (data.subjectId) {
      const { data: ch, error } = await context.supabase
        .from("chapters").select("id").eq("subject_id", data.subjectId);
      if (error) throw error;
      chapterIds = (ch ?? []).map((c) => c.id);
    } else if (data.level) {
      const { data: subs, error: se } = await context.supabase
        .from("subjects").select("id").eq("level", data.level);
      if (se) throw se;
      const sIds = (subs ?? []).map((s) => s.id);
      if (sIds.length === 0) return { deleted: 0 };
      const { data: ch, error } = await context.supabase
        .from("chapters").select("id").in("subject_id", sIds);
      if (error) throw error;
      chapterIds = (ch ?? []).map((c) => c.id);
    }
    if (chapterIds.length === 0) return { deleted: 0 };

    let deleted = 0;
    const chunkSize = 200;
    for (let i = 0; i < chapterIds.length; i += chunkSize) {
      const slice = chapterIds.slice(i, i + chunkSize);
      const { error, count } = await context.supabase
        .from("mcqs")
        .delete({ count: "exact" })
        .in("chapter_id", slice);
      if (error) throw error;
      deleted += count ?? 0;
    }
    try {
      const { data: prof } = await context.supabase
        .from("profiles").select("display_name").eq("id", context.userId).maybeSingle();
      await (context.supabase as unknown as { from: (t: string) => { insert: (v: unknown) => Promise<unknown> } }).from("mcq_delete_audit").insert({
        admin_id: context.userId,
        admin_name: prof?.display_name ?? null,
        deleted_count: deleted,
        scope: "all",
        level: data.level ?? null,
        subject_id: data.subjectId ?? null,
        chapter_id: data.chapterId ?? null,
        mcq_ids: [],
      });
    } catch { /* non-fatal */ }
    return { deleted };
  });

export const adminSetMcqStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; status: z.infer<typeof statusEnum> }) =>
    z.object({ id: z.string().uuid(), status: statusEnum }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("mcqs")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Bulk import ----------
const bulkInput = z.object({
  chapter_id: z.string().uuid(),
  defaults: z
    .object({
      difficulty: difficultyEnum.optional(),
      status: statusEnum.optional(),
    })
    .optional(),
  items: z.array(mcqInputSchema.omit({ chapter_id: true })).min(1).max(500),
});

export const adminBulkImportMcqs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof bulkInput>) => bulkInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const rows = data.items.map((it) => ({
      ...it,
      chapter_id: data.chapter_id,
      difficulty: it.difficulty ?? data.defaults?.difficulty ?? "medium",
      status: it.status ?? data.defaults?.status ?? "published",
      created_by: context.userId,
    }));
    const { error, count } = await context.supabase
      .from("mcqs")
      .insert(rows, { count: "exact" });
    if (error) throw error;
    return { inserted: count ?? rows.length };
  });
