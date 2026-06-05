import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Sparkles, Clock, History, ChevronRight, ListChecks } from "lucide-react";
import { useAcademicTree } from "@/hooks/use-academic-tree";
import { createQuickQuizSession, listMyQuizSessions } from "@/lib/quiz-session.functions";

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  pending_review: { label: "Awaiting Review", tone: "bg-amber-500/15 text-amber-300" },
  ready: { label: "Ready", tone: "bg-emerald-500/15 text-emerald-300" },
  in_progress: { label: "In Progress", tone: "bg-blue-500/15 text-blue-300" },
  submitted: { label: "Submitted", tone: "bg-violet-500/15 text-violet-300" },
  expired: { label: "Expired", tone: "bg-rose-500/15 text-rose-300" },
  rejected: { label: "Rejected", tone: "bg-rose-500/15 text-rose-300" },
};

export function QuickQuizFlow() {
  const tree = useAcademicTree();
  const navigate = useNavigate();
  const [levelCode, setLevelCode] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);

  const subjects = useMemo(
    () => (tree.data?.subjects ?? []).filter((s) => !levelCode || s.level === levelCode),
    [tree.data, levelCode],
  );
  const chapters = useMemo(
    () => (tree.data?.chapters ?? []).filter((c) => !subjectId || c.subject_id === subjectId),
    [tree.data, subjectId],
  );

  const create = useServerFn(createQuickQuizSession);
  const list = useServerFn(listMyQuizSessions);
  const history = useQuery({
    queryKey: ["my-quiz-sessions"],
    queryFn: () => list(),
    staleTime: 10_000,
  });

  const startMut = useMutation({
    mutationFn: () =>
      create({
        data: { chapterId: chapterId!, subjectId, level: levelCode },
      }),
    onSuccess: ({ id }) => {
      toast.success("Quiz request sent. Waiting for admin review.");
      navigate({ to: "/quick-quiz/$id", params: { id } });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <header className="glass-card rounded-3xl p-6">
        <div className="flex items-center gap-3">
          <div className="bg-cta-gradient flex h-10 w-10 items-center justify-center rounded-xl shadow-glow">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight">Quick Quiz</h1>
            <p className="text-sm text-muted-foreground">
              Pick a chapter — we'll build a 10-question, 10-minute timed quiz after admin review.
            </p>
          </div>
        </div>
      </header>

      {/* Picker */}
      <section className="glass-card rounded-3xl p-6 space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Level</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(tree.data?.levels ?? []).map((l) => {
              const active = levelCode === l.code;
              return (
                <button
                  key={l.code}
                  onClick={() => {
                    setLevelCode(l.code);
                    setSubjectId(null);
                    setChapterId(null);
                  }}
                  className={`rounded-xl px-3 py-2 text-sm transition-all ${
                    active
                      ? "bg-cta-gradient text-white shadow-glow"
                      : "bg-muted/40 text-foreground/80 hover:bg-muted"
                  }`}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        </div>

        {levelCode && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subject</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {subjects.length === 0 && (
                <p className="text-sm text-muted-foreground">No subjects published for this level yet.</p>
              )}
              {subjects.map((s) => {
                const active = subjectId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSubjectId(s.id);
                      setChapterId(null);
                    }}
                    className={`rounded-xl px-3 py-2 text-sm transition-all ${
                      active
                        ? "bg-cta-gradient text-white shadow-glow"
                        : "bg-muted/40 text-foreground/80 hover:bg-muted"
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {subjectId && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Chapter</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {chapters.length === 0 && (
                <p className="text-sm text-muted-foreground">No chapters yet for this subject.</p>
              )}
              {chapters.map((c) => {
                const active = chapterId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setChapterId(c.id)}
                    className={`group flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm transition-all ${
                      active
                        ? "bg-cta-gradient text-white shadow-glow"
                        : "bg-muted/40 text-foreground/80 hover:bg-muted"
                    }`}
                  >
                    <span className="min-w-0 truncate">{c.name}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border/40 pt-4">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />10 questions</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />10 minutes</span>
          </div>
          <button
            disabled={!chapterId || startMut.isPending}
            onClick={() => startMut.mutate()}
            className="inline-flex items-center gap-2 rounded-xl bg-cta-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-opacity disabled:opacity-50"
          >
            {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Quiz
          </button>
        </div>
      </section>

      {/* History */}
      <section className="glass-card rounded-3xl p-6">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Recent attempts</h2>
        </div>
        {history.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No quick quizzes yet.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {((history.data ?? []) as any[]).map((s: any) => {
              const meta = STATUS_LABEL[s.status] ?? { label: s.status, tone: "bg-muted" };
              return (
                <li key={s.id}>
                  <button
                    onClick={() => navigate({ to: "/quick-quiz/$id", params: { id: s.id } })}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left hover:opacity-90"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {s.question_count} questions · {Math.round((s.duration_seconds ?? 600) / 60)} min
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {s.score != null && (
                        <span className="text-sm font-semibold">
                          {s.score}/{s.question_count}
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>
                        {meta.label}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
