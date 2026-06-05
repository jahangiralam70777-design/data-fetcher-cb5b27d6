import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronRight,
  FolderTree,
  Layers,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  BookOpen,
  GraduationCap,
  ListChecks,
  Eye,
  EyeOff,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  adminCreateChapter,
  adminCreateLevel,
  adminCreateSubject,
  adminDeleteChapter,
  adminDeleteLevel,
  adminDeleteSubject,
  adminGetAcademicTree,
  adminUpdateChapter,
  adminUpdateLevel,
  adminUpdateSubject,
} from "@/lib/admin-academic.functions";
import {
  adminListMcqs,
  adminDeleteMcq,
  adminSetMcqStatus,
} from "@/lib/admin-mcq.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


type Level = {
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  status: "draft" | "published" | "archived";
};
type Subject = {
  id: string;
  name: string;
  slug: string;
  level: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  status: "draft" | "published" | "archived";
};
type Chapter = {
  id: string;
  name: string;
  slug: string;
  subject_id: string;
  description: string | null;
  sort_order: number;
  status: "draft" | "published" | "archived";
};

type DialogState =
  | { kind: "none" }
  | { kind: "level"; mode: "create" | "edit"; data?: Level }
  | { kind: "subject"; mode: "create" | "edit"; levelCode?: string; data?: Subject }
  | { kind: "chapter"; mode: "create" | "edit"; subjectId?: string; data?: Chapter };

export function AcademicStructureManager() {
  const qc = useQueryClient();
  const fetchTree = useServerFn(adminGetAcademicTree);

  const tree = useQuery({
    queryKey: ["admin-academic-tree"],
    queryFn: () => fetchTree(),
  });

  const [search, setSearch] = useState("");
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [mcqChapter, setMcqChapter] = useState<Chapter | null>(null);

  // Realtime: refresh tree on any related change
  useEffect(() => {
    const ch = supabase
      .channel("admin-academic-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "levels" }, () => qc.invalidateQueries({ queryKey: ["admin-academic-tree"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "subjects" }, () => qc.invalidateQueries({ queryKey: ["admin-academic-tree"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "chapters" }, () => qc.invalidateQueries({ queryKey: ["admin-academic-tree"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "mcqs" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-academic-tree"] });
        qc.invalidateQueries({ queryKey: ["academic-chapter-mcqs"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-academic-tree"] });

  const levels: Level[] = tree.data?.levels ?? [];
  const subjects: Subject[] = tree.data?.subjects ?? [];
  const chapters: Chapter[] = tree.data?.chapters ?? [];
  const counts = tree.data?.counts ?? {
    mcqByChapter: {},
    quizByChapter: {},
    mockByChapter: {},
    quizBySubject: {},
    mockBySubject: {},
  };

  const activeLevel = selectedLevel ?? levels[0]?.code ?? null;
  const filteredSubjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return subjects
      .filter((s) => (activeLevel ? s.level === activeLevel : true))
      .filter((s) => (term ? s.name.toLowerCase().includes(term) : true));
  }, [subjects, activeLevel, search]);

  const activeSubject = selectedSubject ?? filteredSubjects[0]?.id ?? null;
  const subjectChapters = useMemo(
    () => chapters.filter((c) => c.subject_id === activeSubject),
    [chapters, activeSubject],
  );

  // ---- Aggregate level stats ----
  const levelStats = useMemo(() => {
    const map: Record<string, { subjects: number; chapters: number; mcqs: number; quizzes: number; mocks: number }> = {};
    for (const lv of levels) map[lv.code] = { subjects: 0, chapters: 0, mcqs: 0, quizzes: 0, mocks: 0 };
    for (const s of subjects) {
      if (!map[s.level]) map[s.level] = { subjects: 0, chapters: 0, mcqs: 0, quizzes: 0, mocks: 0 };
      map[s.level].subjects += 1;
      map[s.level].quizzes += counts.quizBySubject[s.id] ?? 0;
      map[s.level].mocks += counts.mockBySubject[s.id] ?? 0;
      const subjChapters = chapters.filter((c) => c.subject_id === s.id);
      map[s.level].chapters += subjChapters.length;
      for (const ch of subjChapters) {
        map[s.level].mcqs += counts.mcqByChapter[ch.id] ?? 0;
        map[s.level].quizzes += counts.quizByChapter[ch.id] ?? 0;
        map[s.level].mocks += counts.mockByChapter[ch.id] ?? 0;
      }
    }
    return map;
  }, [levels, subjects, chapters, counts]);

  // ---------- Mutations ----------
  const deleteLevelFn = useServerFn(adminDeleteLevel);
  const deleteSubjectFn = useServerFn(adminDeleteSubject);
  const deleteChapterFn = useServerFn(adminDeleteChapter);

  const delLevel = useMutation({
    mutationFn: (code: string) => deleteLevelFn({ data: { code } }),
    onSuccess: () => { toast.success("Level deleted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delSubject = useMutation({
    mutationFn: (id: string) => deleteSubjectFn({ data: { id } }),
    onSuccess: () => { toast.success("Subject deleted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const delChapter = useMutation({
    mutationFn: (id: string) => deleteChapterFn({ data: { id } }),
    onSuccess: () => { toast.success("Chapter deleted"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass rounded-3xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-cta-gradient flex h-11 w-11 items-center justify-center rounded-2xl shadow-glow">
              <FolderTree className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold tracking-tight">
                Academic <span className="text-gradient">Structure Manager</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                Single source of truth for Levels → Subjects → Chapters across CA Aspire BD
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search subjects…"
                className="w-56 pl-9"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog({ kind: "level", mode: "create" })}
            >
              <Plus className="mr-1 h-4 w-4" /> Level
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setDialog({ kind: "subject", mode: "create", levelCode: activeLevel ?? "professional" })
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Subject
            </Button>
          </div>
        </div>
      </div>

      {/* Level cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {levels.map((lv) => {
          const s = levelStats[lv.code] ?? { subjects: 0, chapters: 0, mcqs: 0, quizzes: 0, mocks: 0 };
          const isActive = activeLevel === lv.code;
          return (
            <button
              key={lv.code}
              onClick={() => { setSelectedLevel(lv.code); setSelectedSubject(null); }}
              className={`group relative overflow-hidden rounded-3xl border p-4 text-left transition-all ${
                isActive ? "border-primary/60 bg-card shadow-glow" : "border-border/60 bg-card/40 hover:bg-card"
              }`}
              style={{
                background: isActive && lv.color
                  ? `linear-gradient(135deg, ${lv.color}25, transparent 60%)`
                  : undefined,
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ background: (lv.color ?? "#a855f7") + "33", color: lv.color ?? "#a855f7" }}
                  >
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-display text-base font-bold">{lv.name}</p>
                    <p className="text-[11px] text-muted-foreground">{lv.description ?? "—"}</p>
                  </div>
                </div>
                <Badge variant={lv.status === "published" ? "default" : "outline"} className="text-[10px]">
                  {lv.status}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-2 text-center">
                <Stat label="Subj" value={s.subjects} />
                <Stat label="Chap" value={s.chapters} />
                <Stat label="MCQ" value={s.mcqs} />
                <Stat label="Quiz" value={s.quizzes} />
                <Stat label="Mock" value={s.mocks} />
              </div>
              <div className="mt-3 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <IconBtn
                  title="Edit level"
                  onClick={(e) => { e.stopPropagation(); setDialog({ kind: "level", mode: "edit", data: lv }); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn
                  title="Delete level"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete level "${lv.name}"?`)) delLevel.mutate(lv.code);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </IconBtn>
              </div>
            </button>
          );
        })}
        {!tree.isLoading && levels.length === 0 && (
          <div className="col-span-full rounded-3xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No levels yet — create one to get started.
          </div>
        )}
      </div>

      {/* Subject + Chapter columns */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        {/* Subjects column */}
        <div className="glass rounded-3xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-bold uppercase tracking-wider">Subjects</h2>
              <Badge variant="outline" className="text-[10px]">{filteredSubjects.length}</Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setDialog({ kind: "subject", mode: "create", levelCode: activeLevel ?? "professional" })
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <ul className="space-y-1.5">
            {filteredSubjects.map((s) => {
              const isActive = activeSubject === s.id;
              const chapCount = chapters.filter((c) => c.subject_id === s.id).length;
              return (
                <li key={s.id}>
                  <div
                    onClick={() => setSelectedSubject(s.id)}
                    className={`group flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all ${
                      isActive ? "border-primary/60 bg-primary/10" : "border-transparent hover:bg-muted/50"
                    }`}
                  >
                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isActive ? "rotate-90" : ""}`} />
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: s.color ?? "#a855f7" }}
                    />
                    <span className="flex-1 truncate font-medium">{s.name}</span>
                    <Badge variant="outline" className="text-[10px]">{chapCount} ch</Badge>
                    <Badge variant={s.status === "published" ? "default" : "secondary"} className="text-[10px]">
                      {s.status}
                    </Badge>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconBtn
                        title="Edit subject"
                        onClick={(e) => { e.stopPropagation(); setDialog({ kind: "subject", mode: "edit", data: s }); }}
                      >
                        <Pencil className="h-3 w-3" />
                      </IconBtn>
                      <IconBtn
                        title="Delete subject"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete subject "${s.name}"?`)) delSubject.mutate(s.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </IconBtn>
                    </div>
                  </div>
                </li>
              );
            })}
            {filteredSubjects.length === 0 && (
              <li className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                No subjects for this level yet.
              </li>
            )}
          </ul>
        </div>

        {/* Chapters column */}
        <div className="glass rounded-3xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-bold uppercase tracking-wider">Chapters</h2>
              <Badge variant="outline" className="text-[10px]">{subjectChapters.length}</Badge>
            </div>
            <Button
              size="sm"
              disabled={!activeSubject}
              onClick={() => activeSubject && setDialog({ kind: "chapter", mode: "create", subjectId: activeSubject })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Chapter
            </Button>
          </div>
          {!activeSubject ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              <Sparkles className="mx-auto mb-2 h-5 w-5" />
              Select a subject to view its chapters.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {subjectChapters.map((c) => (
                <li
                  key={c.id}
                  className="group flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm hover:border-border/60 hover:bg-muted/40"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
                    {c.sort_order + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMcqChapter(c)}
                    className="flex-1 truncate text-left hover:text-primary"
                    title="View & manage MCQs"
                  >
                    <p className="truncate font-medium">{c.name}</p>
                    {c.description && (
                      <p className="truncate text-[11px] text-muted-foreground">{c.description}</p>
                    )}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setMcqChapter(c)}
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-[10px] font-semibold hover:bg-muted"
                      title="View MCQs"
                    >
                      <ListChecks className="h-3 w-3" /> {counts.mcqByChapter[c.id] ?? 0}
                    </button>
                    <Pill label="Quiz" value={counts.quizByChapter[c.id] ?? 0} />
                    <Pill label="Mock" value={counts.mockByChapter[c.id] ?? 0} />
                  </div>
                  <Badge variant={c.status === "published" ? "default" : "secondary"} className="text-[10px]">
                    {c.status}
                  </Badge>
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <IconBtn
                      title="Edit chapter"
                      onClick={() => setDialog({ kind: "chapter", mode: "edit", data: c })}
                    >
                      <Pencil className="h-3 w-3" />
                    </IconBtn>
                    <IconBtn
                      title="Delete chapter"
                      onClick={() => {
                        if (confirm(`Delete chapter "${c.name}"?`)) delChapter.mutate(c.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </IconBtn>
                  </div>
                </li>
              ))}
              {subjectChapters.length === 0 && (
                <li className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No chapters yet — add the first one.
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <EntityDialog state={dialog} onClose={() => setDialog({ kind: "none" })} onSaved={invalidate} levels={levels} subjects={subjects} />
      {mcqChapter && (
        <ChapterMcqsDialog
          chapter={mcqChapter}
          onClose={() => setMcqChapter(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/40 py-1.5">
      <p className="font-mono text-sm font-bold">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label} {value}
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-md p-1.5 hover:bg-muted"
    >
      {children}
    </button>
  );
}

// ============================================================
// Dialog (level / subject / chapter)
// ============================================================
function EntityDialog({
  state,
  onClose,
  onSaved,
  levels,
  subjects,
}: {
  state: DialogState;
  onClose: () => void;
  onSaved: () => void;
  levels: Level[];
  subjects: Subject[];
}) {
  const createLevelFn = useServerFn(adminCreateLevel);
  const updateLevelFn = useServerFn(adminUpdateLevel);
  const createSubjectFn = useServerFn(adminCreateSubject);
  const updateSubjectFn = useServerFn(adminUpdateSubject);
  const createChapterFn = useServerFn(adminCreateChapter);
  const updateChapterFn = useServerFn(adminUpdateChapter);

  const open = state.kind !== "none";
  const title =
    state.kind === "level" ? `${state.mode === "create" ? "Create" : "Edit"} Level`
    : state.kind === "subject" ? `${state.mode === "create" ? "Create" : "Edit"} Subject`
    : state.kind === "chapter" ? `${state.mode === "create" ? "Create" : "Edit"} Chapter`
    : "";

  // Form state per kind
  const [form, setForm] = useState<Record<string, unknown>>({});

  // Reset form whenever dialog state changes
  useMemo(() => {
    if (state.kind === "level") {
      setForm(state.data ? { ...state.data } : { code: "", name: "", color: "#a855f7", icon: "GraduationCap", sort_order: levels.length, status: "published" });
    } else if (state.kind === "subject") {
      setForm(state.data ? { ...state.data } : { name: "", level: state.levelCode ?? "professional", color: "#a855f7", icon: "BookOpen", sort_order: 0, status: "published" });
    } else if (state.kind === "chapter") {
      setForm(state.data ? { ...state.data } : { name: "", subject_id: state.subjectId ?? "", sort_order: 0, status: "published" });
    } else {
      setForm({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (state.kind === "level") {
        if (state.mode === "create") return createLevelFn({ data: form as never });
        return updateLevelFn({ data: form as never });
      }
      if (state.kind === "subject") {
        if (state.mode === "create") return createSubjectFn({ data: form as never });
        return updateSubjectFn({ data: form as never });
      }
      if (state.kind === "chapter") {
        if (state.mode === "create") return createChapterFn({ data: form as never });
        return updateChapterFn({ data: form as never });
      }
    },
    onSuccess: () => { toast.success("Saved"); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state.kind === "level" && "Levels group subjects by curriculum tier."}
            {state.kind === "subject" && "Subjects live inside a level and group chapters."}
            {state.kind === "chapter" && "Chapters hold MCQs, quizzes, mocks, notes and resources."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {state.kind === "level" && (
            <>
              <Field label="Code (lowercase, unique)" required>
                <Input
                  value={(form.code as string) ?? ""}
                  disabled={state.mode === "edit"}
                  onChange={(e) => set("code", e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="e.g. professional"
                />
              </Field>
            </>
          )}

          <Field label="Name" required>
            <Input value={(form.name as string) ?? ""} onChange={(e) => set("name", e.target.value)} />
          </Field>

          {state.kind === "subject" && (
            <Field label="Level">
              <Select value={(form.level as string) ?? "professional"} onValueChange={(v) => set("level", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {levels.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}

          {state.kind === "chapter" && (
            <Field label="Subject">
              <Select value={(form.subject_id as string) ?? ""} onValueChange={(v) => set("subject_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Description">
            <Textarea
              rows={2}
              value={(form.description as string) ?? ""}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>

          {(state.kind === "level" || state.kind === "subject") && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Color">
                <Input type="color" value={(form.color as string) ?? "#a855f7"} onChange={(e) => set("color", e.target.value)} />
              </Field>
              <Field label="Icon name">
                <Input value={(form.icon as string) ?? ""} onChange={(e) => set("icon", e.target.value)} placeholder="lucide icon name" />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Sort order">
              <Input
                type="number"
                value={Number(form.sort_order ?? 0)}
                onChange={(e) => set("sort_order", Number(e.target.value))}
              />
            </Field>
            <Field label="Status">
              <Select value={(form.status as string) ?? "published"} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">
        {label}{required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

// ============================================================
// Chapter MCQs dialog — full management for one chapter
// ============================================================
type ChapterMcq = {
  id: string;
  question: string;
  correct_option: string;
  difficulty: "easy" | "medium" | "hard";
  status: "draft" | "published" | "archived";
  tags: string[];
};

function ChapterMcqsDialog({ chapter, onClose }: { chapter: Chapter; onClose: () => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListMcqs);
  const delFn = useServerFn(adminDeleteMcq);
  const statusFn = useServerFn(adminSetMcqStatus);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const q = useQuery({
    queryKey: ["academic-chapter-mcqs", chapter.id, search, page],
    queryFn: () =>
      listFn({
        data: { chapterId: chapter.id, search: search || undefined, page, pageSize },
      }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["academic-chapter-mcqs", chapter.id] });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("MCQ deleted"); invalidate(); qc.invalidateQueries({ queryKey: ["admin-academic-tree"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: "published" | "draft" }) => statusFn({ data: vars }),
    onSuccess: (_d, v) => { toast.success(v.status === "published" ? "Published" : "Unpublished"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (q.data?.rows ?? []) as ChapterMcq[];
  const total = q.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            MCQs · {chapter.name}
          </DialogTitle>
          <DialogDescription>
            Manage all MCQs in this chapter. Changes go live instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search question text…"
              className="pl-9"
            />
          </div>
          <Badge variant="outline" className="text-[10px]">{total} total</Badge>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-xl border border-border/60">
          {q.isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading MCQs…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No MCQs in this chapter yet.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Question</th>
                  <th className="px-3 py-2 w-16">Ans</th>
                  <th className="px-3 py-2 w-20">Difficulty</th>
                  <th className="px-3 py-2 w-24">Status</th>
                  <th className="px-3 py-2 w-28 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-t border-border/40 hover:bg-muted/30">
                    <td className="max-w-[360px] px-3 py-2">
                      <p className="line-clamp-2 font-medium">{m.question}</p>
                      {m.tags?.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m.tags.slice(0, 3).map((t) => (
                            <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-display font-bold text-primary">{m.correct_option}</td>
                    <td className="px-3 py-2 capitalize">{m.difficulty}</td>
                    <td className="px-3 py-2">
                      <Badge variant={m.status === "published" ? "default" : "secondary"} className="text-[10px] capitalize">
                        {m.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <IconBtn
                          title={m.status === "published" ? "Unpublish" : "Publish"}
                          onClick={() => statusMut.mutate({ id: m.id, status: m.status === "published" ? "draft" : "published" })}
                        >
                          {m.status === "published" ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </IconBtn>
                        <IconBtn
                          title="Delete MCQ"
                          onClick={() => { if (confirm("Delete this MCQ?")) del.mutate(m.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" /> Close</Button>
          <Button asChild>
            <a href={`/admin/mcq`} onClick={onClose}>Open MCQ Manager →</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
