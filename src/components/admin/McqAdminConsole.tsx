import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import * as mammoth from "mammoth";
import { toast } from "sonner";
import {
  Plus, Search, Trash2, Edit3, Eye, EyeOff, Loader2, Upload, X, Check, FolderPlus, BookPlus, AlertCircle,
  Layers, GraduationCap, BookOpen, ChevronRight, Hash, Lock, Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  adminListSubjects, adminListChapters, adminListMcqs, adminListLevels,
  adminCreateMcq, adminUpdateMcq, adminDeleteMcq, adminSetMcqStatus,
  adminCreateSubject, adminCreateChapter, adminBulkImportMcqs,
  adminBulkDeleteMcqs, adminDeleteAllMcqs,
} from "@/lib/admin-mcq.functions";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Mcq = {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  explanation: string | null;
  difficulty: "easy" | "medium" | "hard";
  status: "draft" | "published" | "archived";
  tags: string[];
  chapter_id: string;
};

type Draft = {
  id?: string;
  chapter_id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: "A" | "B" | "C" | "D";
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  status: "draft" | "published" | "archived";
  tags: string;
};

type BulkImportItem = {
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: "A" | "B" | "C" | "D";
  explanation?: string | null;
  difficulty: "easy" | "medium" | "hard";
  status: "draft" | "published" | "archived";
  tags: string[];
};

type ParsedImportRow = BulkImportItem & { source: string; duplicate?: boolean; error?: string };

function emptyDraft(chapterId: string): Draft {
  return {
    chapter_id: chapterId,
    question: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_option: "A",
    explanation: "",
    difficulty: "medium",
    status: "published",
    tags: "",
  };
}

export function McqAdminConsole() {
  const qc = useQueryClient();
  const listSubjectsFn = useServerFn(adminListSubjects);
  const listChaptersFn = useServerFn(adminListChapters);
  const listMcqsFn = useServerFn(adminListMcqs);
  const listLevelsFn = useServerFn(adminListLevels);
  const createMcqFn = useServerFn(adminCreateMcq);
  const updateMcqFn = useServerFn(adminUpdateMcq);
  const deleteMcqFn = useServerFn(adminDeleteMcq);
  const setStatusFn = useServerFn(adminSetMcqStatus);
  const createSubjectFn = useServerFn(adminCreateSubject);
  const createChapterFn = useServerFn(adminCreateChapter);
  const bulkImportFn = useServerFn(adminBulkImportMcqs);
  const bulkDeleteFn = useServerFn(adminBulkDeleteMcqs);
  const deleteAllFn = useServerFn(adminDeleteAllMcqs);

  const [levelCode, setLevelCode] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "draft" | "published" | "archived">("");
  const [difficulty, setDifficulty] = useState<"" | "easy" | "medium" | "hard">("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const levelsQ = useQuery({ queryKey: ["admin-levels"], queryFn: () => listLevelsFn() });
  const subjectsQ = useQuery({ queryKey: ["admin-subjects"], queryFn: () => listSubjectsFn() });
  const chaptersQ = useQuery({
    queryKey: ["admin-chapters", subjectId],
    queryFn: () => listChaptersFn({ data: { subjectId: subjectId! } }),
    enabled: !!subjectId,
  });

  // Subjects filtered by selected level
  const filteredSubjects = useMemo(() => {
    const all = subjectsQ.data ?? [];
    if (!levelCode) return all;
    return all.filter((s: { level?: string }) => s.level === levelCode);
  }, [subjectsQ.data, levelCode]);

  // Auto-pick level/subject/chapter
  useEffect(() => {
    if (!levelCode && levelsQ.data && levelsQ.data.length) setLevelCode(levelsQ.data[0].code);
  }, [levelsQ.data, levelCode]);
  useEffect(() => {
    if (!filteredSubjects.length) { setSubjectId(null); return; }
    if (!subjectId || !filteredSubjects.find((s) => s.id === subjectId)) {
      setSubjectId(filteredSubjects[0].id);
      setChapterId(null);
    }
  }, [filteredSubjects, subjectId]);
  useEffect(() => {
    if (!chapterId && chaptersQ.data && chaptersQ.data.length) setChapterId(chaptersQ.data[0].id);
    if (chapterId && chaptersQ.data && !chaptersQ.data.find((c) => c.id === chapterId)) {
      setChapterId(chaptersQ.data[0]?.id ?? null);
    }
  }, [chaptersQ.data, chapterId]);

  const mcqsQ = useQuery({
    queryKey: ["admin-mcqs", { chapterId, subjectId, search, status, difficulty, page }],
    queryFn: () =>
      listMcqsFn({
        data: {
          chapterId: chapterId ?? undefined,
          subjectId: !chapterId ? subjectId ?? undefined : undefined,
          search: search || undefined,
          status: status || undefined,
          difficulty: difficulty || undefined,
          page,
          pageSize,
        },
      }),
    enabled: !!(chapterId || subjectId),
  });

  // Realtime: any change to mcqs/chapters/subjects/levels => invalidate
  useEffect(() => {
    const ch = supabase
      .channel("admin-mcq-console")
      .on("postgres_changes", { event: "*", schema: "public", table: "mcqs" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-mcqs"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chapters" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-chapters"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "subjects" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-subjects"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "levels" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-levels"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);

  const rows = (mcqsQ.data?.rows ?? []) as Mcq[];
  const total = mcqsQ.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const [editing, setEditing] = useState<Draft | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmAll, setConfirmAll] = useState<null | { step: 1 | 2 }>(null);
  const [deleteAllText, setDeleteAllText] = useState("");

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["admin-mcqs"] });
  }

  // Clear selection when filters change
  useEffect(() => {
    setSelected(new Set());
  }, [levelCode, subjectId, chapterId, search, status, difficulty, page]);

  const saveMut = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = {
        chapter_id: d.chapter_id,
        question: d.question.trim(),
        option_a: d.option_a.trim(),
        option_b: d.option_b.trim(),
        option_c: d.option_c.trim(),
        option_d: d.option_d.trim(),
        correct_option: d.correct_option,
        explanation: d.explanation.trim() || null,
        difficulty: d.difficulty,
        status: d.status,
        tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
      };
      if (d.id) await updateMcqFn({ data: { id: d.id, ...payload } });
      else await createMcqFn({ data: payload });
    },
    onSuccess: () => { setEditing(null); invalidateAll(); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMcqFn({ data: { id } }),
    onSuccess: () => { invalidateAll(); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: Mcq["status"] }) =>
      setStatusFn({ data: vars }),
    onSuccess: (_d, v) => { invalidateAll(); toast.success(v.status === "published" ? "Published" : "Unpublished"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) =>
      bulkDeleteFn({ data: {
        ids,
        level: levelCode ?? null,
        subjectId: subjectId ?? null,
        chapterId: chapterId ?? null,
      } }),
    onSuccess: (res: { deleted: number }) => {
      setSelected(new Set());
      setConfirmBulk(false);
      invalidateAll();
      toast.success(`Deleted ${res.deleted} MCQ${res.deleted === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAllMut = useMutation({
    mutationFn: () =>
      deleteAllFn({ data: {
        level: levelCode ?? null,
        subjectId: subjectId ?? null,
        chapterId: chapterId ?? null,
        confirm: "DELETE" as const,
      } }),
    onSuccess: (res: { deleted: number }) => {
      setSelected(new Set());
      setConfirmAll(null);
      setDeleteAllText("");
      invalidateAll();
      toast.success(`Deleted ${res.deleted} MCQ${res.deleted === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pageIds = rows.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const scopeLabel = chapterId
    ? "this chapter"
    : subjectId
    ? "this subject"
    : levelCode
    ? "this level"
    : "this scope";


  return (
    <div className="space-y-4">
      <div className="glass shadow-card-soft rounded-3xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--neon-blue)]">Admin · Content</p>
            <h1 className="font-display mt-1 text-2xl font-bold md:text-3xl">MCQ Management <span className="text-gradient">Console</span></h1>
            <p className="mt-1 text-sm text-muted-foreground">Real CRUD against your Lovable Cloud database. Changes go live immediately.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowBulk(true)} disabled={!chapterId} className="glass inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold disabled:opacity-50">
              <Upload className="h-4 w-4" /> Bulk Import
            </button>
            <button onClick={() => chapterId && setEditing(emptyDraft(chapterId))} disabled={!chapterId} className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-glow disabled:opacity-50">
              <Plus className="h-4 w-4" /> New MCQ
            </button>
          </div>
        </div>
      </div>

      <AcademicSelectionFlow
        levels={levelsQ.data ?? []}
        subjects={filteredSubjects}
        chapters={chaptersQ.data ?? []}
        levelCode={levelCode}
        subjectId={subjectId}
        chapterId={chapterId}
        onLevel={(code) => { setLevelCode(code); setSubjectId(null); setChapterId(null); setPage(1); }}
        onSubject={(id) => { setSubjectId(id); setChapterId(null); setPage(1); }}
        onChapter={(id) => { setChapterId(id); setPage(1); }}
        onSubjectCreated={() => qc.invalidateQueries({ queryKey: ["admin-subjects"] })}
        onChapterCreated={() => qc.invalidateQueries({ queryKey: ["admin-chapters", subjectId] })}
        createSubject={createSubjectFn}
        createChapter={createChapterFn}
      />



      {/* Filters */}
      <div className="glass shadow-card-soft flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search question text…"
            className="h-10 w-full rounded-xl border border-border/60 bg-background/40 pl-9 pr-3 text-sm outline-none focus:border-[var(--neon-blue)]/60"
          />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="h-10 rounded-xl border border-border/60 bg-background/40 px-3 text-sm">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select value={difficulty} onChange={(e) => { setDifficulty(e.target.value as typeof difficulty); setPage(1); }} className="h-10 rounded-xl border border-border/60 bg-background/40 px-3 text-sm">
          <option value="">All difficulties</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>

      {/* Selection action bar */}
      <div className="glass shadow-card-soft flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Selected</span>
          <span className="font-display font-bold text-gradient">{selected.size}</span>
        </span>
        <button
          onClick={togglePage}
          disabled={pageIds.length === 0}
          className="rounded-lg border border-border bg-background/40 px-3 py-1.5 text-xs font-semibold hover:bg-muted/50 disabled:opacity-40"
        >
          {allOnPageSelected ? "Deselect page" : "Select page"}
        </button>
        <button
          onClick={() => setSelected(new Set())}
          disabled={selected.size === 0}
          className="rounded-lg border border-border bg-background/40 px-3 py-1.5 text-xs font-semibold hover:bg-muted/50 disabled:opacity-40"
        >
          Clear selection
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (selected.size === 0) { toast.error("Select at least one MCQ"); return; }
              setConfirmBulk(true);
            }}
            disabled={selected.size === 0 || bulkDeleteMut.isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40"
          >
            {bulkDeleteMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete selected ({selected.size})
          </button>
          <button
            onClick={() => { setDeleteAllText(""); setConfirmAll({ step: 1 }); }}
            disabled={!(chapterId || subjectId || levelCode) || deleteAllMut.isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-red-500/60 bg-red-600/20 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-600/30 disabled:opacity-40"
          >
            {deleteAllMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertCircle className="h-3.5 w-3.5" />}
            Delete all in {scopeLabel}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="glass shadow-card-soft overflow-hidden rounded-3xl">
        {mcqsQ.isLoading ? (
          <Loader />
        ) : rows.length === 0 ? (
          <Empty text={chapterId ? "No MCQs in this chapter. Create one or bulk import." : "Pick a chapter to start."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all on page"
                      checked={allOnPageSelected}
                      ref={(el) => { if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected; }}
                      onChange={togglePage}
                      className="h-4 w-4 accent-[var(--neon-purple)]"
                    />
                  </th>
                  <th className="px-4 py-3">Question</th>
                  <th className="px-4 py-3 w-20">Answer</th>
                  <th className="px-4 py-3 w-24">Difficulty</th>
                  <th className="px-4 py-3 w-28">Status</th>
                  <th className="px-4 py-3 w-32 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={`border-t border-border/60 transition-colors hover:bg-muted/30 ${selected.has(m.id) ? "bg-[var(--neon-purple)]/5" : ""}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select MCQ"
                        checked={selected.has(m.id)}
                        onChange={() => toggleOne(m.id)}
                        className="h-4 w-4 accent-[var(--neon-purple)]"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="line-clamp-2 font-medium">{m.question}</p>
                      {m.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m.tags.slice(0, 4).map((t) => (
                            <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-display font-bold text-gradient">{m.correct_option}</td>
                    <td className="px-4 py-3 capitalize">{m.difficulty}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn title={m.status === "published" ? "Unpublish" : "Publish"} onClick={() => statusMut.mutate({ id: m.id, status: m.status === "published" ? "draft" : "published" })}>
                          {m.status === "published" ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </IconBtn>
                        <IconBtn title="Edit" onClick={() => setEditing({
                          id: m.id, chapter_id: m.chapter_id, question: m.question,
                          option_a: m.option_a, option_b: m.option_b, option_c: m.option_c, option_d: m.option_d,
                          correct_option: m.correct_option as Draft["correct_option"],
                          explanation: m.explanation ?? "", difficulty: m.difficulty, status: m.status,
                          tags: m.tags.join(", "),
                        })}>
                          <Edit3 className="h-4 w-4" />
                        </IconBtn>
                        <IconBtn title="Delete" danger onClick={() => { if (confirm("Delete this MCQ?")) deleteMut.mutate(m.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <span>{total} MCQs · page {page}/{totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg border border-border bg-background/40 px-3 py-1.5 disabled:opacity-40">Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-lg border border-border bg-background/40 px-3 py-1.5 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>


      {editing && (
        <EditDialog
          draft={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => saveMut.mutate(editing)}
          saving={saveMut.isPending}
          error={saveMut.error as Error | null}
        />
      )}

      {showBulk && chapterId && (
        <BulkImportDialog
          chapterId={chapterId}
          existingQuestions={rows.map((r) => r.question)}
          onClose={() => setShowBulk(false)}
          onDone={() => { setShowBulk(false); invalidateAll(); }}
          run={bulkImportFn}
        />
      )}

      {confirmBulk && (
        <Modal onClose={() => !bulkDeleteMut.isPending && setConfirmBulk(false)} title="Delete selected MCQs?">
          <div className="space-y-3 text-sm">
            <p>
              You are about to permanently delete{" "}
              <span className="font-bold text-red-400">{selected.size}</span>{" "}
              MCQ{selected.size === 1 ? "" : "s"}. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmBulk(false)}
                disabled={bulkDeleteMut.isPending}
                className="rounded-xl border border-border bg-background/40 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => bulkDeleteMut.mutate(Array.from(selected))}
                disabled={bulkDeleteMut.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete {selected.size}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmAll && (
        <Modal onClose={() => !deleteAllMut.isPending && (setConfirmAll(null), setDeleteAllText(""))} title={confirmAll.step === 1 ? "Delete all MCQs in scope?" : "Final confirmation"}>
          <div className="space-y-3 text-sm">
            {confirmAll.step === 1 ? (
              <>
                <p>
                  This will permanently delete <span className="font-bold text-red-400">every MCQ</span> in{" "}
                  <span className="font-semibold">{scopeLabel}</span>. This cannot be undone.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setConfirmAll(null)} className="rounded-xl border border-border bg-background/40 px-4 py-2 text-sm">Cancel</button>
                  <button
                    onClick={() => setConfirmAll({ step: 2 })}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-500/60 bg-red-600/30 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-600/50"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  To confirm, type <span className="font-mono font-bold text-red-300">DELETE</span> below.
                </p>
                <input
                  autoFocus
                  value={deleteAllText}
                  onChange={(e) => setDeleteAllText(e.target.value)}
                  placeholder="DELETE"
                  className="h-10 w-full rounded-xl border border-border/60 bg-background/40 px-3 font-mono text-sm outline-none focus:border-red-400/60"
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => { setConfirmAll(null); setDeleteAllText(""); }}
                    disabled={deleteAllMut.isPending}
                    className="rounded-xl border border-border bg-background/40 px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteAllMut.mutate()}
                    disabled={deleteAllText !== "DELETE" || deleteAllMut.isPending}
                    className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleteAllMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Permanently delete
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- Academic Selection Flow (Level → Subject → Chapter) ---------------- */
type LevelLite = { code: string; name: string; color?: string | null; icon?: string | null };
type NamedRow = { id: string; name: string; status: string; sort_order?: number };

function AcademicSelectionFlow(props: {
  levels: LevelLite[];
  subjects: NamedRow[];
  chapters: NamedRow[];
  levelCode: string | null;
  subjectId: string | null;
  chapterId: string | null;
  onLevel: (code: string) => void;
  onSubject: (id: string) => void;
  onChapter: (id: string) => void;
  onSubjectCreated: () => void;
  onChapterCreated: () => void;
  createSubject: (opts: { data: { name: string; slug: string; sort_order: number; status: "published" } }) => Promise<unknown>;
  createChapter: (opts: { data: { name: string; slug: string; subject_id: string; sort_order: number; status: "published" } }) => Promise<unknown>;
}) {
  const [showSub, setShowSub] = useState(false);
  const [showCh, setShowCh] = useState(false);

  const activeLevel = props.levels.find((l) => l.code === props.levelCode) ?? null;
  const activeSubject = props.subjects.find((s) => s.id === props.subjectId) ?? null;
  const activeChapter = props.chapters.find((c) => c.id === props.chapterId) ?? null;

  const steps = [
    { n: 1, label: "Level", value: activeLevel?.name, icon: Layers, done: !!activeLevel, active: !activeLevel },
    { n: 2, label: "Subject", value: activeSubject?.name, icon: GraduationCap, done: !!activeSubject, active: !!activeLevel && !activeSubject, locked: !activeLevel },
    { n: 3, label: "Chapter", value: activeChapter?.name, icon: BookOpen, done: !!activeChapter, active: !!activeSubject && !activeChapter, locked: !activeSubject },
  ];

  return (
    <div className="glass shadow-card-soft relative overflow-hidden rounded-3xl p-5">
      {/* Subtle ambient glow */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[var(--neon-purple)]/15 blur-3xl" />
      <div className="pointer-events-none absolute -left-24 bottom-0 h-56 w-56 rounded-full bg-[var(--neon-blue)]/15 blur-3xl" />

      {/* Stepper breadcrumb */}
      <div className="relative mb-5 flex flex-wrap items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 rounded-2xl border px-3 py-2 transition-all ${
                s.done
                  ? "border-emerald-400/40 bg-emerald-500/10"
                  : s.active
                    ? "border-transparent bg-cta-gradient text-white shadow-glow"
                    : "border-border/60 bg-background/40 opacity-60"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                  s.done
                    ? "bg-emerald-500/20 text-emerald-300"
                    : s.active
                      ? "bg-white/20 text-white"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {s.done ? <Check className="h-3.5 w-3.5" /> : s.locked ? <Lock className="h-3 w-3" /> : s.n}
              </span>
              <s.icon className="h-3.5 w-3.5 opacity-80" />
              <div className="leading-tight">
                <div className="text-[9px] font-semibold uppercase tracking-widest opacity-70">{s.label}</div>
                <div className="text-[11px] font-semibold truncate max-w-[160px]">{s.value ?? (s.locked ? "Locked" : "Choose…")}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight className={`h-4 w-4 ${s.done ? "text-emerald-400" : "text-muted-foreground/50"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1 — Level */}
      <div className="relative space-y-2">
        <StepHeader n={1} icon={Layers} title="Choose Level" hint="Pick the qualification tier" tint="purple" />
        <div className="flex flex-wrap gap-2">
          {props.levels.map((lv) => {
            const selected = props.levelCode === lv.code;
            return (
              <button
                key={lv.code}
                onClick={() => props.onLevel(lv.code)}
                className={`group relative overflow-hidden rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all duration-200 active:scale-[0.97] ${
                  selected
                    ? "border-transparent text-white shadow-glow"
                    : "border-border/60 bg-background/40 text-foreground hover:-translate-y-0.5 hover:border-[var(--neon-purple)]/40 hover:bg-muted/40"
                }`}
                style={selected ? { background: lv.color ? `linear-gradient(135deg, ${lv.color}, ${lv.color}99)` : undefined } : undefined}
              >
                {selected && !lv.color && (
                  <span className="absolute inset-0 bg-cta-gradient" aria-hidden />
                )}
                <span className="relative inline-flex items-center gap-1.5">
                  {selected && <Check className="h-3 w-3" />}
                  {lv.name}
                </span>
              </button>
            );
          })}
          {props.levels.length === 0 && (
            <p className="text-xs text-muted-foreground">No levels configured.</p>
          )}
        </div>
      </div>

      {/* Step 2 — Subject */}
      <div className={`relative mt-5 space-y-2 transition-opacity ${!activeLevel ? "pointer-events-none opacity-40" : "opacity-100"}`}>
        <StepHeader
          n={2}
          icon={GraduationCap}
          title="Choose Subject"
          hint={activeLevel ? `Within ${activeLevel.name}` : "Select a level first"}
          tint="blue"
          action={
            <button
              onClick={() => setShowSub(true)}
              disabled={!activeLevel}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:border-[var(--neon-blue)]/60 hover:text-foreground disabled:opacity-40"
            >
              <FolderPlus className="h-3 w-3" /> Add
            </button>
          }
        />
        <div className="flex flex-wrap gap-2">
          {props.subjects.map((s) => {
            const selected = props.subjectId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => props.onSubject(s.id)}
                className={`group relative overflow-hidden rounded-xl px-4 py-2.5 text-xs font-semibold transition-all duration-200 active:scale-[0.97] ${
                  selected
                    ? "text-white shadow-glow"
                    : "border border-border/60 bg-background/40 text-foreground hover:-translate-y-0.5 hover:border-[var(--neon-blue)]/40 hover:bg-muted/40"
                }`}
              >
                {selected && (
                  <>
                    <span className="absolute inset-0 bg-cta-gradient" aria-hidden />
                    <span className="absolute inset-0 rounded-xl ring-1 ring-white/30" aria-hidden />
                  </>
                )}
                <span className="relative inline-flex items-center gap-1.5">
                  {selected && <Check className="h-3 w-3" />}
                  {s.name}
                </span>
              </button>
            );
          })}
          {activeLevel && props.subjects.length === 0 && (
            <p className="text-xs text-muted-foreground">No subjects yet — add one to begin.</p>
          )}
        </div>
      </div>

      {/* Step 3 — Chapter (card grid) */}
      <div className={`relative mt-5 space-y-3 transition-opacity ${!activeSubject ? "pointer-events-none opacity-40" : "opacity-100"}`}>
        <StepHeader
          n={3}
          icon={BookOpen}
          title="Choose Chapter"
          hint={activeSubject ? `${props.chapters.length} chapter${props.chapters.length === 1 ? "" : "s"} in ${activeSubject.name}` : "Select a subject first"}
          tint="pink"
          action={
            <button
              onClick={() => setShowCh(true)}
              disabled={!activeSubject}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:border-[var(--neon-pink)]/60 hover:text-foreground disabled:opacity-40"
            >
              <BookPlus className="h-3 w-3" /> Add
            </button>
          }
        />

        {activeSubject && props.chapters.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-background/30 p-6 text-center text-xs text-muted-foreground">
            <BookOpen className="mx-auto mb-2 h-5 w-5 opacity-50" />
            No chapters yet. Click <span className="font-semibold text-foreground">Add</span> to create one.
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {props.chapters.map((c, idx) => {
              const selected = props.chapterId === c.id;
              const num = (c.sort_order ?? idx) + 1;
              return (
                <button
                  key={c.id}
                  onClick={() => props.onChapter(c.id)}
                  className={`group relative overflow-hidden rounded-2xl border p-3.5 text-left transition-all duration-200 active:scale-[0.98] ${
                    selected
                      ? "border-transparent shadow-glow"
                      : "border-border/60 bg-background/40 hover:-translate-y-0.5 hover:border-[var(--neon-pink)]/40 hover:bg-muted/30 hover:shadow-card-soft"
                  }`}
                >
                  {selected && (
                    <>
                      <span className="absolute inset-0 bg-cta-gradient opacity-95" aria-hidden />
                      <span className="absolute inset-0 rounded-2xl ring-1 ring-white/25" aria-hidden />
                      <span className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/20 blur-2xl" aria-hidden />
                    </>
                  )}
                  <div className="relative flex items-start justify-between gap-2">
                    <span
                      className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-[10px] font-bold tabular-nums ${
                        selected
                          ? "bg-white/25 text-white"
                          : "bg-muted/60 text-muted-foreground group-hover:bg-[var(--neon-pink)]/15 group-hover:text-[var(--neon-pink)]"
                      }`}
                    >
                      <Hash className="mr-0.5 h-3 w-3" />
                      {String(num).padStart(2, "0")}
                    </span>
                    {selected ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover:text-[var(--neon-pink)]" />
                    )}
                  </div>
                  <p className={`relative mt-2 line-clamp-2-safe text-[13px] font-semibold leading-snug ${selected ? "text-white" : "text-foreground"}`}>
                    {c.name}
                  </p>
                  <div className={`relative mt-2 flex items-center justify-between text-[10px] ${selected ? "text-white/80" : "text-muted-foreground"}`}>
                    <span className="inline-flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${c.status === "published" ? "bg-emerald-400" : "bg-amber-400"}`} />
                      {c.status}
                    </span>
                    <span className="font-medium opacity-80">Chapter {num}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showSub && (
        <QuickCreateDialog
          title="New subject"
          onClose={() => setShowSub(false)}
          onSubmit={async ({ name, slug }) => {
            await props.createSubject({ data: { name, slug, sort_order: 0, status: "published" } });
            props.onSubjectCreated();
          }}
        />
      )}
      {showCh && props.subjectId && (
        <QuickCreateDialog
          title="New chapter"
          onClose={() => setShowCh(false)}
          onSubmit={async ({ name, slug }) => {
            await props.createChapter({ data: { name, slug, subject_id: props.subjectId!, sort_order: 0, status: "published" } });
            props.onChapterCreated();
          }}
        />
      )}
    </div>
  );
}

function StepHeader({
  n, icon: Icon, title, hint, tint, action,
}: {
  n: number;
  icon: typeof Layers;
  title: string;
  hint: string;
  tint: "purple" | "blue" | "pink";
  action?: React.ReactNode;
}) {
  const tintCls =
    tint === "purple"
      ? "from-[var(--neon-purple)]/30 to-transparent text-[var(--neon-purple)]"
      : tint === "blue"
        ? "from-[var(--neon-blue)]/30 to-transparent text-[var(--neon-blue)]"
        : "from-[var(--neon-pink)]/30 to-transparent text-[var(--neon-pink)]";
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${tintCls}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="leading-tight">
          <h3 className="text-[13px] font-semibold tracking-tight">
            <span className="mr-1.5 text-muted-foreground">Step {n}</span>
            {title}
          </h3>
          <p className="text-[10px] text-muted-foreground">{hint}</p>
        </div>
      </div>
      {action}
    </div>
  );
}



function QuickCreateDialog({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (v: { name: string; slug: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const autoSlug = useMemo(
    () => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    [name],
  );

  return (
    <Modal onClose={onClose} title={title}>
      <div className="space-y-3">
        <Field label="Name">
          <input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(""); }} className="h-10 w-full rounded-xl border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-[var(--neon-blue)]/60" />
        </Field>
        <Field label="Slug (a-z, 0-9, dashes)">
          <input value={slug || autoSlug} onChange={(e) => setSlug(e.target.value)} className="h-10 w-full rounded-xl border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-[var(--neon-blue)]/60" />
        </Field>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border bg-background/40 px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={busy || !name}
            onClick={async () => {
              setBusy(true); setErr(null);
              try { await onSubmit({ name: name.trim(), slug: (slug || autoSlug).trim() }); onClose(); }
              catch (e) { setErr(e instanceof Error ? e.message : "Failed to create"); }
              finally { setBusy(false); }
            }}
            className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-glow disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Edit dialog ---------------- */
function EditDialog({ draft, onChange, onClose, onSave, saving, error }: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: Error | null;
}) {
  return (
    <Modal onClose={onClose} title={draft.id ? "Edit MCQ" : "New MCQ"} wide>
      <div className="grid gap-3">
        <Field label="Question">
          <textarea value={draft.question} onChange={(e) => onChange({ ...draft, question: e.target.value })} className="w-full rounded-xl border border-border/60 bg-background/40 p-3 text-sm outline-none focus:border-[var(--neon-blue)]/60 min-h-[80px]" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(["A", "B", "C", "D"] as const).map((k) => (
            <Field key={k} label={`Option ${k}`}>
              <input
                value={(draft as unknown as Record<string, string>)[`option_${k.toLowerCase()}`]}
                onChange={(e) => onChange({ ...draft, [`option_${k.toLowerCase()}`]: e.target.value })}
                className="h-10 w-full rounded-xl border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-[var(--neon-blue)]/60"
              />
            </Field>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Correct">
            <select value={draft.correct_option} onChange={(e) => onChange({ ...draft, correct_option: e.target.value as Draft["correct_option"] })} className="h-10 w-full rounded-xl border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-[var(--neon-blue)]/60">
              <option>A</option><option>B</option><option>C</option><option>D</option>
            </select>
          </Field>
          <Field label="Difficulty">
            <select value={draft.difficulty} onChange={(e) => onChange({ ...draft, difficulty: e.target.value as Draft["difficulty"] })} className="h-10 w-full rounded-xl border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-[var(--neon-blue)]/60">
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={draft.status} onChange={(e) => onChange({ ...draft, status: e.target.value as Draft["status"] })} className="h-10 w-full rounded-xl border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-[var(--neon-blue)]/60">
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        </div>
        <Field label="Explanation (optional)">
          <textarea value={draft.explanation} onChange={(e) => onChange({ ...draft, explanation: e.target.value })} className="w-full rounded-xl border border-border/60 bg-background/40 p-3 text-sm outline-none focus:border-[var(--neon-blue)]/60 min-h-[60px]" />
        </Field>
        <Field label="Tags (comma separated)">
          <input value={draft.tags} onChange={(e) => onChange({ ...draft, tags: e.target.value })} className="h-10 w-full rounded-xl border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-[var(--neon-blue)]/60" />
        </Field>
        {error && <p className="flex items-center gap-2 text-xs text-red-400"><AlertCircle className="h-3.5 w-3.5" />{error.message}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border bg-background/40 px-4 py-2 text-sm">Cancel</button>
          <button onClick={onSave} disabled={saving} className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-glow disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Bulk import ---------------- */
function BulkImportDialog({ chapterId, existingQuestions, onClose, onDone, run }: {
  chapterId: string;
  existingQuestions: string[];
  onClose: () => void;
  onDone: () => void;
  run: (opts: { data: { chapter_id: string; items: BulkImportItem[] } }) => Promise<{ inserted: number }>;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Live auto-parse as user types/pastes (debounced)
  useEffect(() => {
    if (!text.trim()) { setRows([]); return; }
    const t = setTimeout(() => {
      const parsed = parseMcqText(text, "pasted");
      setRows(dedupe(parsed, existingQuestions));
    }, 200);
    return () => clearTimeout(t);
  }, [text, existingQuestions]);

  const validRows = rows.filter((r) => !r.error && !r.duplicate);
  const invalidCount = rows.filter((r) => r.error).length;
  const dupCount = rows.filter((r) => r.duplicate).length;

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true); setMsg(null); setProgress(3);
    try {
      const parsed: ParsedImportRow[] = [];
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const sourceText = await extractFileText(file);
        const uploadedPath = `${chapterId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        await supabase.storage.from("mcq-imports").upload(uploadedPath, file, { upsert: false }).catch(() => null);
        parsed.push(...parseMcqText(sourceText, file.name));
        setProgress(Math.round(((i + 1) / list.length) * 100));
      }
      setRows(dedupe(parsed, existingQuestions));
      toast.success(`Parsed ${parsed.length} MCQs from ${list.length} file${list.length > 1 ? "s" : ""}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not parse upload";
      setMsg({ kind: "err", text: message });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function go() {
    if (!validRows.length) { toast.error("Nothing valid to import"); return; }
    setBusy(true); setMsg(null);
    try {
      const items: BulkImportItem[] = validRows.map(({ source: _s, duplicate: _d, error: _e, ...item }) => item);
      const res = await run({ data: { chapter_id: chapterId, items } });
      setMsg({ kind: "ok", text: `Inserted ${res.inserted} MCQs` });
      toast.success(`Imported ${res.inserted} MCQs`);
      setTimeout(onDone, 600);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Import failed";
      setMsg({ kind: "err", text: message });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Bulk import MCQs" wide>
      <p className="text-xs text-muted-foreground">
        Paste MCQs in any common format, or drop PDF/DOCX/DOC/TXT files. We auto-detect question, options (A–D or a–d), answer (Answer/Ans/Correct) and explanation.
      </p>
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files); }}
        className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--neon-blue)]/40 bg-background/30 p-5 text-center transition-colors hover:border-[var(--neon-purple)]/60"
      >
        <Upload className="h-5 w-5 text-[var(--neon-blue)]" />
        <span className="mt-1 text-sm font-semibold">Drop files or click to choose</span>
        <span className="text-[11px] text-muted-foreground">PDF · DOCX · DOC · TXT</span>
        <input type="file" multiple accept=".pdf,.doc,.docx,.txt,text/plain,application/pdf" className="sr-only" onChange={(e) => e.target.files && void handleFiles(e.target.files)} />
      </label>
      {progress > 0 && progress < 100 && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/40">
          <div className="h-full rounded-full bg-cta-gradient transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Paste MCQs here (auto-parses as you type)</span>
          {rows.length > 0 && (
            <span>
              <span className="text-emerald-400">{validRows.length} valid</span>
              {invalidCount > 0 && <> · <span className="text-red-400">{invalidCount} invalid</span></>}
              {dupCount > 0 && <> · <span className="text-amber-400">{dupCount} duplicate</span></>}
            </span>
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={SAMPLE_TEXT}
          className="w-full rounded-xl border border-border/60 bg-background/40 p-3 font-mono text-xs outline-none focus:border-[var(--neon-blue)]/60 min-h-[200px]"
        />
      </div>

      {rows.length > 0 && (
        <div className="mt-3 max-h-56 overflow-auto rounded-2xl border border-border/60 bg-background/30">
          {rows.map((row, i) => (
            <div key={`${row.source}-${i}`} className={`border-b border-border/40 p-3 text-xs last:border-b-0 ${row.error ? "bg-destructive/10" : row.duplicate ? "bg-amber-500/10" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-2 font-medium">{row.question || "Untitled question"}</p>
                <span className={row.error ? "text-destructive" : row.duplicate ? "text-amber-400" : "text-emerald-400"}>{row.error ?? (row.duplicate ? "Duplicate" : "Valid")}</span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                A: {row.option_a?.slice(0, 30)} · B: {row.option_b?.slice(0, 30)} · C: {row.option_c?.slice(0, 30)} · D: {row.option_d?.slice(0, 30)} · Ans <b>{row.correct_option}</b>
              </p>
            </div>
          ))}
        </div>
      )}

      {msg && (
        <p className={`mt-3 text-xs ${msg.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-border bg-background/40 px-4 py-2 text-sm">Cancel</button>
        <button onClick={go} disabled={busy || validRows.length === 0} className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-glow disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import {validRows.length || ""}
        </button>
      </div>
    </Modal>
  );
}

async function extractFileText(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "txt" || file.type.startsWith("text/")) return file.text();
  if (ext === "pdf" || file.type === "application/pdf") {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    }));
    return pages.join("\n\n");
  }
  if (ext === "doc" || ext === "docx" || file.name.toLowerCase().endsWith(".docx")) {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  throw new Error(`Unsupported file format: ${file.name}`);
}

/**
 * Tolerant MCQ parser. Handles:
 *  - Question lead-ins: "Question:", "Q1.", "1.", "1)", or none
 *  - Options: "A.", "A)", "A:", "a)", "(A)" — case-insensitive
 *  - Answer: "Answer: B", "Ans: b", "Correct: B", "Correct Answer - B"
 *  - Explanation: "Explanation:", "Reason:", "Solution:" (multi-line until next question)
 */
function parseMcqText(raw: string, source: string): ParsedImportRow[] {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  // Split into question blocks. New block starts at numbered/Q-prefixed line or "Question:" lead-in.
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  const isQuestionStart = (line: string) =>
    /^\s*(?:Q(?:uestion)?\s*\.?\s*)?\d{1,3}[).:-]\s+\S/.test(line) ||
    /^\s*Question\s*[:.-]/i.test(line);

  for (const line of lines) {
    if (isQuestionStart(line) && current.length) {
      blocks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));

  // Fallback: no numbering at all — treat whole text as one block, or split on blank lines if multiple A. markers
  let working = blocks.length > 1 ? blocks : [text];
  if (working.length === 1 && (text.match(/(?:^|\n)\s*\(?A\)?[).:]/gi)?.length ?? 0) > 1) {
    working = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  }

  const out: ParsedImportRow[] = [];
  for (const block of working) {
    const row = parseSingleBlock(block, source);
    if (row) out.push(row);
  }
  return out;
}

function parseSingleBlock(block: string, source: string): ParsedImportRow | null {
  const stripped = block
    .replace(/^\s*Question\s*[:.-]\s*/i, "")
    .replace(/^\s*Q(?:uestion)?\s*\.?\s*\d{1,3}[).:-]?\s*/i, "")
    .replace(/^\s*\d{1,3}[).:-]\s*/i, "")
    .trim();

  // Find option markers — accept A./A)/A:/(A)/a)
  const optRe = /(^|\n)[ \t]*\(?([A-Da-d])\)?[ \t]*[).:.\-][ \t]*/g;
  const markers: { letter: "A" | "B" | "C" | "D"; index: number; matchLen: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = optRe.exec(stripped)) !== null) {
    const letter = m[2].toUpperCase() as "A" | "B" | "C" | "D";
    const start = m.index + m[1].length;
    markers.push({ letter, index: start, matchLen: m[0].length - m[1].length });
  }
  if (markers.length < 4) return null;

  const firstOf = (l: "A" | "B" | "C" | "D") => markers.find((x) => x.letter === l);
  const mA = firstOf("A"), mB = firstOf("B"), mC = firstOf("C"), mD = firstOf("D");
  if (!mA || !mB || !mC || !mD) return null;

  const question = stripped.slice(0, mA.index).trim();

  const afterD = stripped.slice(mD.index + mD.matchLen);
  const ansRe = /\n?\s*(?:Answer|Ans|Correct(?:\s*Answer)?|Correct\s*Option)\s*[:.\-]?\s*\(?([A-Da-d])\)?/i;
  const expRe = /\n?\s*(?:Explanation|Reason|Solution)\s*[:.\-]\s*([\s\S]*)$/i;
  const ansMatch = ansRe.exec(afterD);
  const expMatch = expRe.exec(afterD);
  const cuts = [ansMatch?.index, expMatch?.index].filter((x): x is number => typeof x === "number");
  const cut = cuts.length ? Math.min(...cuts) : afterD.length;
  const optionD = afterD.slice(0, cut).trim();

  const between = (a: typeof mA, b: typeof mA) => stripped.slice(a.index + a.matchLen, b.index).trim();

  const answer = (ansMatch?.[1]?.toUpperCase() ?? "A") as "A" | "B" | "C" | "D";
  const explanation = expMatch?.[1]?.trim() || null;
  const cleanOpt = (s: string) => s.replace(/^[\s).:.\-]+/, "").replace(/[\s.]+$/, "").trim();

  return {
    source,
    question: cleanText(question),
    option_a: cleanOpt(between(mA, mB)),
    option_b: cleanOpt(between(mB, mC)),
    option_c: cleanOpt(between(mC, mD)),
    option_d: cleanOpt(optionD),
    correct_option: answer,
    explanation,
    difficulty: "medium",
    status: "published",
    tags: [],
  };
}

function cleanText(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function dedupe(parsed: ParsedImportRow[], existing: string[]): ParsedImportRow[] {
  const seen = new Set(existing.map(normalizeQuestion));
  return parsed.map((row) => {
    const key = normalizeQuestion(row.question);
    const duplicate = !!key && seen.has(key);
    if (!duplicate && key) seen.add(key);
    return { ...row, duplicate, error: row.error ?? validateImportRow(row) };
  });
}

function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function validateImportRow(row: BulkImportItem) {
  if (row.question.trim().length < 3) return "Question missing";
  if (!row.option_a || !row.option_b || !row.option_c || !row.option_d) return "All 4 options required";
  if (!["A", "B", "C", "D"].includes(row.correct_option)) return "Correct answer must be A-D";
  return undefined;
}

const SAMPLE_TEXT = `1. What is HTML?
A. Programming Language
B. Markup Language
C. Database
D. Operating System
Answer: B
Explanation: HTML is a markup language used to build web pages.

2. What is CSS?
a) Database
b) Styling Language
c) Server
d) Browser
Ans: b
Explanation: CSS is used for styling.`;

/* ---------------- Atoms ---------------- */
function Modal({ children, onClose, title, wide }: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-md">
      <div className={`glass shadow-glow animate-fade-up relative w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-3xl p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background/40 transition-colors ${danger ? "hover:bg-red-500/10 hover:text-red-400" : "hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: Mcq["status"] }) {
  const map: Record<Mcq["status"], string> = {
    published: "bg-emerald-500/15 text-emerald-400 border-emerald-400/40",
    draft: "bg-amber-500/15 text-amber-400 border-amber-400/40",
    archived: "bg-muted text-muted-foreground border-border",
  };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${map[status]}`}>{status}</span>;
}

function Loader() {
  return <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-muted-foreground">{text}</div>;
}
