import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Search, Plus, Sparkles, Send, EyeOff, Eye, Trash2, Copy, Filter,
  ListChecks, Timer, CheckCircle2, Activity, Trophy, Loader2, X, Save,
  Clock, Shuffle, Edit3, ArrowUp, ArrowDown, Wand2, CheckSquare, ExternalLink, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  adminListQuizzes, adminQuizStats, adminCreateQuiz, adminUpdateQuiz,
  adminDeleteQuiz, adminSetQuizStatus, adminDuplicateQuiz,
  adminGetQuizQuestions, adminSetQuizQuestions,
  adminAutoGenerateQuizzes, adminRegenerateQuizQuestions,
} from "@/lib/admin-quiz.functions";
import { adminListLevels, adminListSubjects, adminListMcqs } from "@/lib/admin-mcq.functions";
import { adminListChapters } from "@/lib/admin-mcq.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { BulkUploadMcqsDialog } from "./BulkUploadMcqsDialog";

type Quiz = {
  id: string; title: string; description: string | null;
  level: string; subject_id: string | null; chapter_id: string | null;
  kind: "quiz" | "mock";
  status: "draft" | "published" | "archived";
  difficulty: "easy" | "medium" | "hard";
  total_questions: number; duration_seconds: number;
  starts_at: string | null; ends_at: string | null;
  is_public: boolean; created_at: string; updated_at: string;
};

const STATUS_TONE: Record<string, string> = {
  published: "border-emerald-400/30 bg-emerald-400/10 text-emerald-400",
  draft: "border-amber-400/30 bg-amber-400/10 text-amber-400",
  archived: "border-rose-400/30 bg-rose-400/10 text-rose-400",
};

export function QuizManagerFlow() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListQuizzes);
  const statsFn = useServerFn(adminQuizStats);
  const levelsFn = useServerFn(adminListLevels);
  const subjectsFn = useServerFn(adminListSubjects);
  const delFn = useServerFn(adminDeleteQuiz);
  const statusFn = useServerFn(adminSetQuizStatus);
  const dupFn = useServerFn(adminDuplicateQuiz);

  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<string>("all");
  const [subjectId, setSubjectId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Quiz | null>(null);
  const [creating, setCreating] = useState(false);
  const [builderFor, setBuilderFor] = useState<Quiz | null>(null);
  const [previewFor, setPreviewFor] = useState<Quiz | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [autoGenOpen, setAutoGenOpen] = useState(false);

  const regenFn = useServerFn(adminRegenerateQuizQuestions);

  // realtime: invalidate on any quiz change
  useEffect(() => {
    const ch = supabase
      .channel("quiz-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "quizzes" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-quizzes"] });
        qc.invalidateQueries({ queryKey: ["admin-quiz-stats"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const stats = useQuery({ queryKey: ["admin-quiz-stats"], queryFn: () => statsFn() });
  const levels = useQuery({ queryKey: ["admin-levels"], queryFn: () => levelsFn() });
  const subjects = useQuery({ queryKey: ["admin-subjects"], queryFn: () => subjectsFn() });

  const filteredSubjects = useMemo(() => {
    const all = (subjects.data ?? []) as Array<{ id: string; name: string; level: string }>;
    return level === "all" ? all : all.filter((s) => s.level === level);
  }, [subjects.data, level]);

  const list = useQuery({
    queryKey: ["admin-quizzes", { search, level, subjectId, status, page }],
    queryFn: () =>
      listFn({
        data: {
          search: search || undefined,
          level: level === "all" ? undefined : level,
          subjectId: subjectId === "all" ? undefined : subjectId,
          status: status === "all" ? undefined : (status as Quiz["status"]),
          kind: "quiz",
          page, pageSize: 20,
        },
      }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-quizzes"] });
    qc.invalidateQueries({ queryKey: ["admin-quiz-stats"] });
  };

  const delM = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Quiz deleted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const statusM = useMutation({
    mutationFn: (v: { id: string; status: Quiz["status"] }) => statusFn({ data: v }),
    onSuccess: (_d, v) => { toast.success(`Quiz ${v.status}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const dupM = useMutation({
    mutationFn: (id: string) => dupFn({ data: { id } }),
    onSuccess: () => { toast.success("Quiz duplicated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const regenM = useMutation({
    mutationFn: (id: string) => regenFn({ data: { quizId: id } }),
    onSuccess: (r: { picked: number }) => { toast.success(`Regenerated · ${r.picked} random MCQs`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (list.data?.rows ?? []) as Quiz[];
  const total = list.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const subjectName = (id: string | null) =>
    (subjects.data as Array<{ id: string; name: string }> | undefined)?.find((s) => s.id === id)?.name ?? "—";

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <section className="glass shadow-card-soft relative overflow-hidden rounded-3xl p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-[var(--neon-purple)]/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <Badge className="bg-cta-gradient border-0 text-white shadow-glow">
              <Sparkles className="mr-1 h-3 w-3" /> Quiz Engine
            </Badge>
            <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              Quiz <span className="text-gradient">Manager</span>
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Build, publish and schedule chapter-wise timed quizzes. Realtime sync — no refresh needed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="border-[var(--neon-purple)]/40" onClick={() => setBulkOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Bulk Upload MCQs
            </Button>
            <Button variant="outline" className="border-emerald-400/40 text-emerald-300" onClick={() => setAutoGenOpen(true)}>
              <Wand2 className="mr-2 h-4 w-4" /> Auto-Generate
            </Button>
            <Button className="bg-cta-gradient text-white shadow-glow" onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create Quiz
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { l: "Total Quizzes", v: stats.data?.total ?? 0, i: ListChecks, c: "#a855f7" },
          { l: "Published", v: stats.data?.published ?? 0, i: Send, c: "#22d3ee" },
          { l: "Drafts", v: stats.data?.draft ?? 0, i: Edit3, c: "#fbbf24" },
          { l: "Archived", v: stats.data?.archived ?? 0, i: EyeOff, c: "#f472b6" },
          { l: "Total Attempts", v: stats.data?.attempts ?? 0, i: Trophy, c: "#34d399" },
        ].map(({ l, v, i: Icon, c }) => (
          <div key={l} className="glass shadow-card-soft rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${c}22`, color: c }}>
                <Icon className="h-4 w-4" />
              </div>
              <Activity className="h-3 w-3 animate-pulse text-emerald-400" />
            </div>
            <p className="mt-3 font-display text-2xl font-bold tracking-tight">{v.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{l}</p>
          </div>
        ))}
      </section>

      {/* Filters */}
      <section className="glass shadow-card-soft rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search quizzes by title…"
              className="h-9 rounded-xl pl-9"
            />
          </div>
          <Select value={level} onValueChange={(v) => { setLevel(v); setSubjectId("all"); setPage(1); }}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              {((levels.data as Array<{ code: string; name: string }> | undefined) ?? []).map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={subjectId} onValueChange={(v) => { setSubjectId(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {filteredSubjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="ml-auto text-[10px]"><Filter className="mr-1 h-3 w-3" />{total} total</Badge>
        </div>
      </section>

      {/* Table */}
      <section className="glass shadow-card-soft overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <div>
            <h3 className="font-display text-sm font-bold tracking-tight">All Quizzes</h3>
            <p className="text-[11px] text-muted-foreground">Page {page} of {totalPages} · live sync</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-glow" /> Realtime
          </div>
        </div>
        <div className="overflow-x-auto">
          {list.isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No quizzes match the current filters.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-background/30 text-muted-foreground">
                <tr className="text-left">
                  {["Title", "Level", "Subject", "Qns", "Duration", "Status", "Updated", "Actions"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/30 hover:bg-background/40">
                    <td className="px-3 py-3">
                      <p className="font-medium">{r.title}</p>
                      {r.description && <p className="line-clamp-1 text-[10px] text-muted-foreground">{r.description}</p>}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{r.level}</td>
                    <td className="px-3 py-3 text-muted-foreground">{subjectName(r.subject_id)}</td>
                    <td className="px-3 py-3 font-mono">{r.total_questions}</td>
                    <td className="px-3 py-3 text-muted-foreground">{Math.round(r.duration_seconds / 60)}m</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] capitalize ${STATUS_TONE[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{new Date(r.updated_at).toLocaleDateString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <IconBtn title="Preview" onClick={() => setPreviewFor(r)}><Eye className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn title="Edit" onClick={() => setEditing(r)}><Edit3 className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn title="Manage MCQs" onClick={() => setBuilderFor(r)}><ListChecks className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn title="Duplicate" onClick={() => dupM.mutate(r.id)}><Copy className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn title="Regenerate random MCQs" onClick={() => { if (confirm("Replace this quiz's questions with a fresh random pick from its chapter?")) regenM.mutate(r.id); }}>
                          <Shuffle className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          title={r.status === "published" ? "Unpublish" : "Publish"}
                          onClick={() => statusM.mutate({ id: r.id, status: r.status === "published" ? "draft" : "published" })}
                        >
                          {r.status === "published" ? <EyeOff className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                        </IconBtn>
                        <IconBtn title="Delete" onClick={() => { if (confirm("Delete this quiz?")) delM.mutate(r.id); }}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border/40 px-4 py-3 text-xs text-muted-foreground">
            <span>Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          </div>
        )}
      </section>

      {(creating || editing) && (
        <QuizEditorDialog
          quiz={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={invalidate}
          levels={(levels.data as Array<{ code: string; name: string }>) ?? []}
          subjects={(subjects.data as Array<{ id: string; name: string; level: string }>) ?? []}
        />
      )}

      {builderFor && (
        <QuestionPickerDialog
          quiz={builderFor}
          onClose={() => setBuilderFor(null)}
          onSaved={invalidate}
        />
      )}

      {previewFor && (
        <QuizPreviewDialog quiz={previewFor} onClose={() => setPreviewFor(null)} />
      )}

      {bulkOpen && (
        <BulkUploadMcqsDialog onClose={() => setBulkOpen(false)} onImported={invalidate} />
      )}

      {autoGenOpen && (
        <AutoGenerateDialog
          onClose={() => setAutoGenOpen(false)}
          onDone={invalidate}
          levels={(levels.data as Array<{ code: string; name: string }>) ?? []}
          subjects={(subjects.data as Array<{ id: string; name: string; level: string }>) ?? []}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-lg border border-border/40 bg-background/40 p-1.5 hover:border-[var(--neon-purple)]/60 hover:text-[var(--neon-purple)]"
    >
      {children}
    </button>
  );
}

// ============================================================
// Editor dialog
// ============================================================
function QuizEditorDialog({
  quiz, onClose, onSaved, levels, subjects,
}: {
  quiz: Quiz | null;
  onClose: () => void;
  onSaved: () => void;
  levels: Array<{ code: string; name: string }>;
  subjects: Array<{ id: string; name: string; level: string }>;
}) {
  const createFn = useServerFn(adminCreateQuiz);
  const updateFn = useServerFn(adminUpdateQuiz);
  const chaptersFn = useServerFn(adminListChapters);
  const mcqListFn = useServerFn(adminListMcqs);
  const setQuestionsFn = useServerFn(adminSetQuizQuestions);

  const [form, setForm] = useState({
    title: quiz?.title ?? "",
    description: quiz?.description ?? "",
    level: quiz?.level ?? (levels[0]?.code ?? "professional"),
    subject_id: quiz?.subject_id ?? "",
    chapter_id: quiz?.chapter_id ?? "",
    difficulty: quiz?.difficulty ?? "medium",
    total_questions: quiz?.total_questions ?? 10,
    duration_minutes: Math.round((quiz?.duration_seconds ?? 600) / 60),
    passing_marks: 0,
    is_public: quiz?.is_public ?? true,
    randomize_questions: true,
    status: quiz?.status ?? "draft",
    auto_attach: !quiz, // default ON when creating
  });

  const filteredSubjects = useMemo(
    () => subjects.filter((s) => s.level === form.level),
    [subjects, form.level],
  );

  const chaptersQ = useQuery({
    queryKey: ["chapters-for", form.subject_id],
    queryFn: () => chaptersFn({ data: { subjectId: form.subject_id } }),
    enabled: !!form.subject_id,
  });

  // Live preview count of available MCQs in the selected chapter
  const poolPreview = useQuery({
    queryKey: ["editor-pool-count", form.chapter_id],
    queryFn: () => mcqListFn({ data: { chapterId: form.chapter_id, status: "published", page: 1, pageSize: 1 } }),
    enabled: !!form.chapter_id,
  });
  const availableCount = poolPreview.data?.count ?? 0;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        description: form.description || null,
        level: form.level,
        subject_id: form.subject_id || null,
        chapter_id: form.chapter_id || null,
        kind: "quiz" as const,
        status: form.status as Quiz["status"],
        difficulty: form.difficulty as Quiz["difficulty"],
        total_questions: form.total_questions,
        duration_seconds: form.duration_minutes * 60,
        is_public: form.is_public,
        randomize_questions: form.randomize_questions,
        randomize_options: false,
        passing_marks: form.passing_marks,
        negative_marking: 0,
      };
      let quizId = quiz?.id;
      if (quiz) {
        await updateFn({ data: { id: quiz.id, ...payload } });
      } else {
        const created = await createFn({ data: payload });
        quizId = (created as { id: string }).id;
      }
      // Auto-attach chapter MCQs on create
      if (!quiz && form.auto_attach && form.chapter_id && quizId) {
        const pool = await mcqListFn({
          data: { chapterId: form.chapter_id, status: "published", page: 1, pageSize: 200 },
        });
        const ids = (pool.rows as Array<{ id: string }>).map((m) => m.id);
        if (ids.length) {
          // shuffle for "random pick"
          for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
          }
          const picked = ids.slice(0, Math.min(form.total_questions, ids.length));
          await setQuestionsFn({ data: { quizId, mcqIds: picked } });
        }
      }
      return { quizId, attached: !quiz && form.auto_attach };
    },
    onSuccess: (r) => {
      toast.success(
        quiz ? "Quiz updated"
          : r.attached ? "Quiz created · MCQs auto-attached from chapter"
          : "Quiz created",
      );
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{quiz ? "Edit Quiz" : "Create Quiz"}</DialogTitle>
          <DialogDescription>Set scope, settings and publish status.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Title *</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label>Description</Label>
            <Textarea rows={2} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <Label>Level</Label>
            <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v, subject_id: "", chapter_id: "" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {levels.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Subject</Label>
            <Select value={form.subject_id} onValueChange={(v) => setForm({ ...form, subject_id: v, chapter_id: "" })}>
              <SelectTrigger><SelectValue placeholder="Choose subject" /></SelectTrigger>
              <SelectContent>
                {filteredSubjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Chapter</Label>
            <Select value={form.chapter_id} onValueChange={(v) => setForm({ ...form, chapter_id: v })} disabled={!form.subject_id}>
              <SelectTrigger><SelectValue placeholder="Choose chapter" /></SelectTrigger>
              <SelectContent>
                {(chaptersQ.data ?? []).map((c: { id: string; name: string }) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Difficulty</Label>
            <Select value={form.difficulty} onValueChange={(v) => setForm({ ...form, difficulty: v as typeof form.difficulty })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label><Timer className="mr-1 inline h-3 w-3" />Total questions</Label>
            <Input type="number" value={form.total_questions} onChange={(e) => setForm({ ...form, total_questions: Math.max(1, Number(e.target.value) || 0) })} />
          </div>
          <div>
            <Label><Clock className="mr-1 inline h-3 w-3" />Duration (minutes)</Label>
            <Input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Math.max(1, Number(e.target.value) || 0) })} />
          </div>
          <div>
            <Label><Trophy className="mr-1 inline h-3 w-3" />Passing marks</Label>
            <Input type="number" value={form.passing_marks} onChange={(e) => setForm({ ...form, passing_marks: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Quiz["status"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/40 px-3 py-2">
            <div className="flex items-center gap-2 text-xs"><Shuffle className="h-3.5 w-3.5" /> Randomize question order</div>
            <Switch checked={form.randomize_questions} onCheckedChange={(v) => setForm({ ...form, randomize_questions: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/40 px-3 py-2">
            <div className="flex items-center gap-2 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Public to students</div>
            <Switch checked={form.is_public} onCheckedChange={(v) => setForm({ ...form, is_public: v })} />
          </div>
          {!quiz && (
            <div className="md:col-span-2 flex items-center justify-between rounded-xl border border-[var(--neon-purple)]/30 bg-[var(--neon-purple)]/10 px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <Wand2 className="h-3.5 w-3.5 text-[var(--neon-purple)]" />
                <span>
                  Auto-attach MCQs from this chapter on create
                  {form.chapter_id && (
                    <span className="ml-2 text-muted-foreground">
                      · {availableCount} available · will pick {Math.min(form.total_questions, availableCount)}
                    </span>
                  )}
                </span>
              </div>
              <Switch checked={form.auto_attach} onCheckedChange={(v) => setForm({ ...form, auto_attach: v })} />
            </div>
          )}
          {!quiz && form.chapter_id && availableCount === 0 && (
            <div className="md:col-span-2 flex items-center justify-between rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs">
              <span>No MCQs available in this chapter yet.</span>
              <Link to="/admin/mcq" className="inline-flex items-center gap-1 font-semibold text-amber-300 hover:underline">
                Go to MCQ Manager <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" />Cancel</Button>
          <Button className="bg-cta-gradient text-white" disabled={!form.title.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {quiz ? "Save changes" : "Create quiz"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Question picker dialog
// ============================================================
type PoolRow = { id: string; question: string; difficulty: string; correct_option: string };

const PickerRow = ({
  m, selected, onToggle,
}: { m: PoolRow; selected: boolean; onToggle: (id: string) => void }) => (
  <label className={`flex cursor-pointer items-start gap-3 border-b border-border/40 p-3 text-xs ${selected ? "bg-[var(--neon-purple)]/10" : "hover:bg-background/40"}`}>
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onToggle(m.id)}
      className="mt-1 h-4 w-4 accent-[var(--neon-purple)]"
    />
    <div className="flex-1">
      <p className="font-medium">{m.question}</p>
      <div className="mt-1 flex gap-2 text-[10px] text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5 capitalize">{m.difficulty}</span>
        <span>Answer: <b className="text-primary">{m.correct_option}</b></span>
      </div>
    </div>
  </label>
);
const MemoPickerRow = memo(PickerRow);

function QuestionPickerDialog({
  quiz, onClose, onSaved,
}: { quiz: Quiz; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const getQ = useServerFn(adminGetQuizQuestions);
  const setQ = useServerFn(adminSetQuizQuestions);
  const mcqList = useServerFn(adminListMcqs);
  const levelsFn = useServerFn(adminListLevels);
  const subjectsFn = useServerFn(adminListSubjects);
  const chaptersFn = useServerFn(adminListChapters);

  // In-modal L→S→C selectors, seeded from the quiz so it "just works" for existing quizzes.
  const [level, setLevel] = useState<string>(quiz.level || "");
  const [subjectId, setSubjectId] = useState<string>(quiz.subject_id ?? "");
  const [chapterId, setChapterId] = useState<string>(quiz.chapter_id ?? "");

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 250);
  const [difficulty, setDifficulty] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const [autoSave, setAutoSave] = useState(true);
  const lastSaved = useRef<string>("");

  // ---- Academic tree (admin view) ----
  const levelsQ = useQuery({ queryKey: ["admin-levels"], queryFn: () => levelsFn(), staleTime: 60_000 });
  const subjectsQ = useQuery({ queryKey: ["admin-subjects"], queryFn: () => subjectsFn(), staleTime: 60_000 });
  const chaptersQ = useQuery({
    queryKey: ["admin-chapters", subjectId],
    queryFn: () => chaptersFn({ data: { subjectId } }),
    enabled: !!subjectId,
    staleTime: 30_000,
  });

  const levels = (levelsQ.data ?? []) as Array<{ code: string; name: string }>;
  const subjects = useMemo(
    () => ((subjectsQ.data ?? []) as Array<{ id: string; name: string; level: string }>)
      .filter((s) => !level || s.level === level),
    [subjectsQ.data, level],
  );
  const chapters = (chaptersQ.data ?? []) as Array<{ id: string; name: string }>;

  // ---- Initial selection from existing quiz ----
  const initial = useQuery({
    queryKey: ["quiz-questions", quiz.id],
    queryFn: () => getQ({ data: { quizId: quiz.id } }),
  });
  useEffect(() => {
    if (initial.data) {
      const ids = (initial.data as Array<{ mcq_id: string }>).map((q) => q.mcq_id);
      setSelected(ids);
      lastSaved.current = ids.join(",");
    }
  }, [initial.data]);

  // ---- Pool query: scoped to chapter (preferred) or subject ----
  const pool = useQuery({
    queryKey: ["quiz-mcq-pool", chapterId || null, subjectId || null, search, difficulty],
    queryFn: () => mcqList({
      data: {
        chapterId: chapterId || undefined,
        subjectId: !chapterId && subjectId ? subjectId : undefined,
        search: search || undefined,
        difficulty: difficulty === "all" ? undefined : (difficulty as "easy" | "medium" | "hard"),
        status: "published",
        page: 1, pageSize: 300,
      },
    }),
    enabled: !!(chapterId || subjectId),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });

  // ---- Realtime: refresh pool on any MCQ change ----
  useEffect(() => {
    const ch = supabase
      .channel(`quiz-picker-${quiz.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "mcqs" }, () => {
        qc.invalidateQueries({ queryKey: ["quiz-mcq-pool"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, quiz.id]);

  // ---- Auto-save (debounced) when selection changes ----
  const save = useMutation({
    mutationFn: (ids: string[]) => setQ({ data: { quizId: quiz.id, mcqIds: ids } }),
    onSuccess: (_d, ids) => {
      lastSaved.current = ids.join(",");
      qc.invalidateQueries({ queryKey: ["admin-quizzes"] });
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    if (!autoSave) return;
    const key = selected.join(",");
    if (key === lastSaved.current) return;
    const t = window.setTimeout(() => save.mutate(selected), 600);
    return () => window.clearTimeout(t);
  }, [selected, autoSave]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useMemo(() => (id: string) =>
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]), []);

  const move = (idx: number, dir: -1 | 1) => {
    setSelected((s) => {
      const j = idx + dir;
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });
  };

  const rows = useMemo(
    () => ((pool.data?.rows ?? []) as PoolRow[]),
    [pool.data],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const shuffle = (arr: string[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const autoPick = (count: number, random: boolean) => {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) { toast.error("No MCQs available in this chapter"); return; }
    const source = random ? shuffle(ids) : ids;
    setSelected(source.slice(0, Math.min(count, source.length)));
    toast.success(`Picked ${Math.min(count, source.length)} MCQs`);
  };

  const pickDifficultyMix = () => {
    const buckets: Record<string, string[]> = { easy: [], medium: [], hard: [] };
    rows.forEach((r) => { (buckets[r.difficulty] ?? buckets.medium).push(r.id); });
    const target = quiz.total_questions || 10;
    const per = Math.ceil(target / 3);
    const mix = [
      ...shuffle(buckets.easy).slice(0, per),
      ...shuffle(buckets.medium).slice(0, per),
      ...shuffle(buckets.hard).slice(0, per),
    ].slice(0, target);
    if (mix.length === 0) { toast.error("No MCQs available in this chapter"); return; }
    setSelected(mix);
    toast.success(`Picked ${mix.length} MCQs across difficulties`);
  };

  const noScope = !chapterId && !subjectId;
  const isEmptyPool = !pool.isLoading && !noScope && rows.length === 0 && !search && difficulty === "all";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Manage Questions · {quiz.title}</DialogTitle>
          <DialogDescription>
            Pulls MCQs directly from the MCQ Practice database. Selected: <b>{selected.length}</b>
            {autoSave && <span className="ml-2 text-emerald-400">· Auto-saving</span>}
          </DialogDescription>
        </DialogHeader>

        {/* Level → Subject → Chapter selectors */}
        <div className="grid gap-2 rounded-xl border border-border/60 bg-background/40 p-3 sm:grid-cols-3">
          <Select value={level} onValueChange={(v) => { setLevel(v); setSubjectId(""); setChapterId(""); }}>
            <SelectTrigger><SelectValue placeholder="Level" /></SelectTrigger>
            <SelectContent>
              {levels.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subjectId} onValueChange={(v) => { setSubjectId(v); setChapterId(""); }} disabled={!level}>
            <SelectTrigger><SelectValue placeholder={level ? "Subject" : "Pick a level first"} /></SelectTrigger>
            <SelectContent>
              {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={chapterId} onValueChange={setChapterId} disabled={!subjectId}>
            <SelectTrigger><SelectValue placeholder={subjectId ? "Chapter" : "Pick a subject first"} /></SelectTrigger>
            <SelectContent>
              {chapters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Auto-pick toolbar */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--neon-purple)]/30 bg-[var(--neon-purple)]/5 p-2">
          <span className="ml-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--neon-purple)]">
            <Wand2 className="h-3.5 w-3.5" /> Smart pick
          </span>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => autoPick(10, false)}>
            Pick 10
          </Button>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => autoPick(quiz.total_questions || 10, true)}>
            <Shuffle className="mr-1 h-3 w-3" /> Random {quiz.total_questions || 10}
          </Button>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={pickDifficultyMix}>
            Difficulty mix
          </Button>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => setSelected(rows.map((r) => r.id))}>
            <CheckSquare className="mr-1 h-3 w-3" /> Select all ({rows.length})
          </Button>
          <Button size="sm" variant="ghost" disabled={selected.length === 0} onClick={() => setSelected([])}>
            Clear
          </Button>
          <label className="ml-auto flex items-center gap-2 px-2 text-xs">
            <Switch checked={autoSave} onCheckedChange={setAutoSave} /> Auto-save
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {/* Pool */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search chapter MCQs…" className="pl-9" />
              </div>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div
              className="max-h-[55vh] overflow-auto rounded-xl border border-border/60"
              style={{ contentVisibility: "auto" } as React.CSSProperties}
            >
              {noScope ? (
                <div className="flex h-40 items-center justify-center p-4 text-center text-xs text-muted-foreground">
                  Pick a Level, Subject and Chapter to load MCQs.
                </div>
              ) : pool.isLoading && rows.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>
              ) : isEmptyPool ? (
                <div className="flex h-40 flex-col items-center justify-center gap-3 p-4 text-center text-xs text-muted-foreground">
                  <p>No MCQs available in this chapter.</p>
                  <Link to="/admin/mcq" className="inline-flex items-center gap-1 rounded-lg border border-[var(--neon-purple)]/40 bg-[var(--neon-purple)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--neon-purple)] hover:border-[var(--neon-purple)]">
                    Go to MCQ Manager <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              ) : rows.length === 0 ? (
                <div className="flex h-32 items-center justify-center p-4 text-center text-xs text-muted-foreground">No MCQs match these filters.</div>
              ) : rows.map((m) => (
                <MemoPickerRow key={m.id} m={m} selected={selectedSet.has(m.id)} onToggle={toggle} />
              ))}
            </div>
          </div>

          {/* Selected with reorder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-semibold text-muted-foreground">Selected order ({selected.length})</p>
              {selected.length > 0 && (
                <button type="button" onClick={() => setSelected([])} className="text-[10px] text-rose-400 hover:underline">Clear all</button>
              )}
            </div>
            <div
              className="max-h-[55vh] overflow-auto rounded-xl border border-border/60"
              style={{ contentVisibility: "auto" } as React.CSSProperties}
            >
              {selected.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">No questions selected yet.</div>
              ) : selected.map((id, i) => {
                const m = byId.get(id);
                return (
                  <div key={id} className="flex items-start gap-2 border-b border-border/40 p-2 text-xs">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px]">{i + 1}</span>
                    <p className="flex-1 line-clamp-2">{m?.question ?? <span className="text-muted-foreground italic">Not in current filter</span>}</p>
                    <div className="flex flex-col gap-1">
                      <button type="button" title="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded border border-border/50 p-0.5 disabled:opacity-30 hover:border-[var(--neon-purple)]/60"><ArrowUp className="h-3 w-3" /></button>
                      <button type="button" title="Move down" disabled={i === selected.length - 1} onClick={() => move(i, 1)} className="rounded border border-border/50 p-0.5 disabled:opacity-30 hover:border-[var(--neon-purple)]/60"><ArrowDown className="h-3 w-3" /></button>
                    </div>
                    <button type="button" title="Remove" onClick={() => toggle(id)} className="rounded border border-border/50 p-0.5 text-rose-400 hover:border-rose-400/60"><X className="h-3 w-3" /></button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <div className="mr-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            {save.isPending ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
            ) : selected.join(",") === lastSaved.current ? (
              <><CheckCircle2 className="h-3 w-3 text-emerald-400" /> All changes saved</>
            ) : (
              <>Unsaved changes</>
            )}
          </div>
          <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" />Close</Button>
          <Button className="bg-cta-gradient text-white" disabled={save.isPending || selected.join(",") === lastSaved.current} onClick={() => save.mutate(selected)}>
            {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



// ============================================================
// Preview dialog
// ============================================================
function QuizPreviewDialog({ quiz, onClose }: { quiz: Quiz; onClose: () => void }) {
  const getQ = useServerFn(adminGetQuizQuestions);
  const mcqList = useServerFn(adminListMcqs);

  const qq = useQuery({
    queryKey: ["preview-quiz-questions", quiz.id],
    queryFn: () => getQ({ data: { quizId: quiz.id } }),
  });

  const ids = (qq.data ?? []).map((r: { mcq_id: string }) => r.mcq_id);

  const pool = useQuery({
    queryKey: ["preview-quiz-mcqs", quiz.chapter_id, quiz.subject_id],
    queryFn: () => mcqList({
      data: {
        chapterId: quiz.chapter_id ?? undefined,
        subjectId: !quiz.chapter_id ? (quiz.subject_id ?? undefined) : undefined,
        page: 1, pageSize: 200,
      },
    }),
    enabled: ids.length > 0,
  });

  const byId = new Map(
    ((pool.data?.rows ?? []) as Array<{ id: string; question: string; option_a: string; option_b: string; option_c: string; option_d: string; correct_option: string; difficulty: string }>)
      .map((m) => [m.id, m]),
  );
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as Array<{ id: string; question: string; option_a: string; option_b: string; option_c: string; option_d: string; correct_option: string; difficulty: string }>;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Preview · {quiz.title}</DialogTitle>
          <DialogDescription>
            {quiz.total_questions} questions · {Math.round(quiz.duration_seconds / 60)} min · <span className="capitalize">{quiz.difficulty}</span> · <span className="capitalize">{quiz.status}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
          {qq.isLoading || (ids.length > 0 && pool.isLoading) ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>
          ) : ordered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              <p>No questions assigned yet. Use <b>Manage MCQs</b> to auto-pick from the chapter pool.</p>
              <Link to="/admin/mcq" className="inline-flex items-center gap-1 rounded-lg border border-[var(--neon-purple)]/40 bg-[var(--neon-purple)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--neon-purple)]">
                Open MCQ Manager <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          ) : ordered.map((m, i) => (
            <div key={m.id} className="glass rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold"><span className="text-muted-foreground">Q{i + 1}.</span> {m.question}</p>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize">{m.difficulty}</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(["A", "B", "C", "D"] as const).map((k) => {
                  const text = (m as unknown as Record<string, string>)[`option_${k.toLowerCase()}`];
                  const ok = m.correct_option === k;
                  return (
                    <div key={k} className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${ok ? "border-emerald-400/40 bg-emerald-400/10" : "border-border/50"}`}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${ok ? "bg-emerald-400/30 text-emerald-300" : "bg-muted"}`}>{k}</span>
                      <span>{text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" />Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Auto-Generate dialog
// ============================================================
function AutoGenerateDialog({
  onClose, onDone, levels, subjects,
}: {
  onClose: () => void;
  onDone: () => void;
  levels: Array<{ code: string; name: string }>;
  subjects: Array<{ id: string; name: string; level: string }>;
}) {
  const autoGenFn = useServerFn(adminAutoGenerateQuizzes);
  const chaptersFn = useServerFn(adminListChapters);

  const [level, setLevel] = useState<string>(levels[0]?.code ?? "professional");
  const [subjectId, setSubjectId] = useState<string>("");
  const [chapterId, setChapterId] = useState<string>("");
  const [questionCount, setQuestionCount] = useState(10);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [overwrite, setOverwrite] = useState(true);
  const [publish, setPublish] = useState(true);
  const [randomizeOptions, setRandomizeOptions] = useState(true);

  const filteredSubjects = useMemo(
    () => subjects.filter((s) => s.level === level),
    [subjects, level],
  );

  const chaptersQ = useQuery({
    queryKey: ["auto-gen-chapters", subjectId],
    queryFn: () => chaptersFn({ data: { subjectId } }),
    enabled: !!subjectId,
  });
  const chapters = (chaptersQ.data ?? []) as Array<{ id: string; name: string }>;

  const run = useMutation({
    mutationFn: () =>
      autoGenFn({
        data: {
          level: !subjectId && !chapterId ? level : null,
          subjectId: subjectId && !chapterId ? subjectId : null,
          chapterId: chapterId || null,
          questionCount,
          durationMinutes,
          overwrite,
          publish,
          randomizeOptions,
        },
      }),
    onSuccess: (r: { created: number; updated: number; skipped: number }) => {
      toast.success(`Auto-generation done · ${r.created} created · ${r.updated} updated · ${r.skipped} skipped`);
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Auto-Generate Quizzes</DialogTitle>
          <DialogDescription>
            Generate one quiz per chapter from existing published MCQs. Pick scope and defaults.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Level</Label>
            <Select value={level} onValueChange={(v) => { setLevel(v); setSubjectId(""); setChapterId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {levels.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Subject (optional)</Label>
            <Select value={subjectId || "__all"} onValueChange={(v) => { setSubjectId(v === "__all" ? "" : v); setChapterId(""); }}>
              <SelectTrigger><SelectValue placeholder="All subjects in level" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All subjects in level</SelectItem>
                {filteredSubjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Chapter (optional)</Label>
            <Select value={chapterId || "__all"} onValueChange={(v) => setChapterId(v === "__all" ? "" : v)} disabled={!subjectId}>
              <SelectTrigger><SelectValue placeholder={subjectId ? "All chapters in subject" : "Pick a subject first"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All chapters in subject</SelectItem>
                {chapters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label><Timer className="mr-1 inline h-3 w-3" />Questions per quiz</Label>
            <Input type="number" min={1} max={200} value={questionCount} onChange={(e) => setQuestionCount(Math.max(1, Number(e.target.value) || 0))} />
          </div>
          <div>
            <Label><Clock className="mr-1 inline h-3 w-3" />Duration (minutes)</Label>
            <Input type="number" min={1} max={360} value={durationMinutes} onChange={(e) => setDurationMinutes(Math.max(1, Number(e.target.value) || 0))} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/40 px-3 py-2">
            <div className="flex items-center gap-2 text-xs"><Shuffle className="h-3.5 w-3.5" /> Shuffle answer options</div>
            <Switch checked={randomizeOptions} onCheckedChange={setRandomizeOptions} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/40 px-3 py-2">
            <div className="flex items-center gap-2 text-xs"><Send className="h-3.5 w-3.5" /> Publish immediately</div>
            <Switch checked={publish} onCheckedChange={setPublish} />
          </div>
          <div className="md:col-span-2 flex items-center justify-between rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <Wand2 className="h-3.5 w-3.5 text-amber-300" />
              Overwrite existing <code className="rounded bg-background/40 px-1">[Auto]</code> quizzes for these chapters
            </div>
            <Switch checked={overwrite} onCheckedChange={setOverwrite} />
          </div>
          <div className="md:col-span-2 rounded-xl border border-border/40 bg-background/30 px-3 py-2 text-[11px] text-muted-foreground">
            Tip: chapters with no published MCQs are skipped. Existing auto-quizzes are detected by title prefix <code>[Auto]</code>.
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" />Cancel</Button>
          <Button className="bg-cta-gradient text-white" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1 h-4 w-4" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
