import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Loader2,
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  ArrowRight,
  Send,
  Trophy,
  RotateCw,
} from "lucide-react";
import {
  getQuizSession,
  startQuizSession,
  submitQuizSession,
} from "@/lib/quiz-session.functions";

type Mcq = {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option?: string;
  explanation?: string | null;
};

type Session = {
  id: string;
  status: string;
  duration_seconds: number;
  question_count: number;
  started_at: string | null;
  submitted_at: string | null;
  mcq_ids: string[];
  answers: Record<string, string>;
  score: number | null;
  correct_count: number | null;
  wrong_count: number | null;
  reject_reason: string | null;
};

const OPT = ["A", "B", "C", "D"] as const;

export function QuickQuizSession({ id }: { id: string }) {
  const get = useServerFn(getQuizSession);
  const start = useServerFn(startQuizSession);
  const submit = useServerFn(submitQuizSession);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const session = useQuery({
    queryKey: ["quiz-session", id],
    queryFn: () => get({ data: { id } }),
    refetchInterval: (q) => {
      const s = q.state.data?.session as Session | undefined;
      if (!s) return 4000;
      if (s.status === "pending_review") return 4000;
      return false;
    },
  });

  const s = session.data?.session as Session | undefined;
  const mcqs = (session.data?.mcqs ?? []) as Mcq[];

  if (session.isLoading) {
    return (
      <div className="glass-card rounded-3xl p-10 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!s) {
    return (
      <div className="glass-card rounded-3xl p-10 text-center">
        <p className="text-sm text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  if (s.status === "pending_review") {
    return (
      <div className="glass-card mx-auto max-w-xl rounded-3xl p-10 text-center">
        <div className="bg-cta-gradient mx-auto flex h-12 w-12 items-center justify-center rounded-2xl shadow-glow">
          <ShieldCheck className="h-6 w-6 text-white" />
        </div>
        <h2 className="mt-4 font-display text-lg font-bold">Awaiting admin review</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your quiz set has been generated. An admin is reviewing the {s.question_count} questions before
          you start. This page will refresh automatically.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking every few seconds…
        </div>
      </div>
    );
  }

  if (s.status === "rejected") {
    return (
      <div className="glass-card mx-auto max-w-xl rounded-3xl p-10 text-center">
        <XCircle className="mx-auto h-8 w-8 text-rose-400" />
        <h2 className="mt-3 font-display text-lg font-bold">Session rejected</h2>
        <p className="mt-2 text-sm text-muted-foreground">{s.reject_reason || "Admin rejected this request."}</p>
        <button
          className="mt-4 rounded-xl bg-cta-gradient px-4 py-2 text-sm font-semibold text-white shadow-glow"
          onClick={() => navigate({ to: "/quick-quiz" })}
        >
          Back to Quick Quiz
        </button>
      </div>
    );
  }

  if (s.status === "ready") {
    return (
      <div className="glass-card mx-auto max-w-xl rounded-3xl p-10 text-center">
        <Trophy className="mx-auto h-8 w-8 text-amber-300" />
        <h2 className="mt-3 font-display text-lg font-bold">Approved — you're ready</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {s.question_count} questions · {Math.round(s.duration_seconds / 60)} minutes. Timer starts the moment you begin.
        </p>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cta-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow"
          onClick={async () => {
            await start({ data: { id } });
            qc.invalidateQueries({ queryKey: ["quiz-session", id] });
          }}
        >
          Start Quiz
        </button>
      </div>
    );
  }

  if (s.status === "in_progress") {
    return <AttemptPlayer session={s} mcqs={mcqs} onSubmit={submit} onDone={() => session.refetch()} />;
  }

  // submitted or expired
  return <ResultView session={s} mcqs={mcqs} onAgain={() => navigate({ to: "/quick-quiz" })} />;
}

function AttemptPlayer({
  session,
  mcqs,
  onSubmit,
  onDone,
}: {
  session: Session;
  mcqs: Mcq[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSubmit: (args: any) => Promise<any>;
  onDone: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => session.answers ?? {});
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useMemo(
    () => (session.started_at ? new Date(session.started_at).getTime() : Date.now()),
    [session.started_at],
  );
  const total = session.duration_seconds;
  const [remaining, setRemaining] = useState(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    return Math.max(0, total - elapsed);
  });
  const submittedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setRemaining(Math.max(0, total - elapsed));
    }, 250);
    return () => clearInterval(t);
  }, [startedAt, total]);

  const doSubmit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const r = await onSubmit({ data: { id: session.id, answers } });
      toast.success(`Submitted · ${r.correct}/${session.question_count} correct`);
      onDone();
    } catch (e) {
      submittedRef.current = false;
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (remaining <= 0 && !submittedRef.current) {
      toast.message("Time's up — auto-submitting");
      doSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const q = mcqs[idx];
  const mm = Math.floor(remaining / 60);
  const ss = Math.floor(remaining % 60);
  const lowTime = remaining < 60;

  if (!q) {
    return (
      <div className="glass-card rounded-3xl p-10 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const answered = Object.keys(answers).length;

  return (
    <div className="space-y-4">
      <div className="glass-card flex items-center justify-between rounded-2xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
            lowTime ? "bg-rose-500/15 text-rose-300" : "bg-muted text-foreground/80"
          }`}>
            <Clock className="h-4 w-4" />
            {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
          </div>
          <p className="text-xs text-muted-foreground">
            Question {idx + 1} of {mcqs.length} · {answered} answered
          </p>
        </div>
        <button
          onClick={doSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-xl bg-cta-gradient px-4 py-2 text-xs font-semibold text-white shadow-glow disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Submit
        </button>
      </div>

      <div className="glass-card rounded-3xl p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Question {idx + 1}
        </p>
        <p className="mt-2 text-base font-medium leading-relaxed">{q.question}</p>

        <div className="mt-5 grid gap-2">
          {OPT.map((letter) => {
            const text = (q as Record<string, string>)[`option_${letter.toLowerCase()}`];
            const selected = answers[q.id] === letter;
            return (
              <button
                key={letter}
                onClick={() => setAnswers((a) => ({ ...a, [q.id]: letter }))}
                className={`group flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                  selected
                    ? "border-transparent bg-cta-gradient text-white shadow-glow"
                    : "border-border/40 bg-muted/30 hover:bg-muted"
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                  selected ? "bg-white/20 text-white" : "bg-muted text-foreground/80"
                }`}>
                  {letter}
                </span>
                <span className="min-w-0">{text}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Previous
          </button>
          {idx < mcqs.length - 1 ? (
            <button
              onClick={() => setIdx((i) => Math.min(mcqs.length - 1, i + 1))}
              className="inline-flex items-center gap-2 rounded-xl bg-cta-gradient px-4 py-2 text-xs font-semibold text-white shadow-glow"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={doSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-cta-gradient px-4 py-2 text-xs font-semibold text-white shadow-glow disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Submit
            </button>
          )}
        </div>
      </div>

      <div className="glass-card rounded-2xl p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Jump to</p>
        <div className="flex flex-wrap gap-1.5">
          {mcqs.map((m, i) => {
            const has = !!answers[m.id];
            const active = i === idx;
            return (
              <button
                key={m.id}
                onClick={() => setIdx(i)}
                className={`h-8 w-8 rounded-lg text-xs font-semibold transition-all ${
                  active
                    ? "bg-cta-gradient text-white shadow-glow"
                    : has
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-muted/40 text-foreground/70 hover:bg-muted"
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ResultView({
  session,
  mcqs,
  onAgain,
}: {
  session: Session;
  mcqs: Mcq[];
  onAgain: () => void;
}) {
  const total = mcqs.length;
  const score = session.score ?? 0;
  const correct = session.correct_count ?? 0;
  const wrong = session.wrong_count ?? 0;
  const unanswered = total - correct - wrong;
  const pct = total ? Math.round((score / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {session.status === "expired" ? "Auto-submitted (time up)" : "Result"}
            </p>
            <p className="mt-1 font-display text-3xl font-bold">
              {score} <span className="text-base text-muted-foreground">/ {total}</span>
            </p>
            <p className="text-sm text-muted-foreground">Accuracy {pct}%</p>
          </div>
          <div className="flex gap-2">
            <Stat label="Correct" value={correct} tone="bg-emerald-500/15 text-emerald-300" />
            <Stat label="Wrong" value={wrong} tone="bg-rose-500/15 text-rose-300" />
            <Stat label="Skipped" value={unanswered} tone="bg-muted text-foreground/80" />
          </div>
          <button
            onClick={onAgain}
            className="inline-flex items-center gap-2 rounded-xl bg-cta-gradient px-4 py-2 text-xs font-semibold text-white shadow-glow"
          >
            <RotateCw className="h-3.5 w-3.5" /> New Quiz
          </button>
        </div>
      </div>

      <div className="glass-card rounded-3xl p-6 space-y-4">
        <h3 className="text-sm font-semibold">Review answers</h3>
        {mcqs.map((m, i) => {
          const chosen = session.answers?.[m.id];
          const correctLetter = (m.correct_option || "").toUpperCase();
          const isCorrect = chosen && chosen === correctLetter;
          return (
            <div key={m.id} className="rounded-2xl border border-border/40 bg-muted/20 p-4">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${
                  isCorrect ? "bg-emerald-500/20 text-emerald-300" : chosen ? "bg-rose-500/20 text-rose-300" : "bg-muted text-foreground/70"
                }`}>{i + 1}</span>
                <p className="flex-1 text-sm font-medium">{m.question}</p>
                {isCorrect ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : chosen ? (
                  <XCircle className="h-4 w-4 text-rose-400" />
                ) : null}
              </div>
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {OPT.map((letter) => {
                  const text = (m as Record<string, string>)[`option_${letter.toLowerCase()}`];
                  const isC = letter === correctLetter;
                  const isCh = letter === chosen;
                  return (
                    <div
                      key={letter}
                      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                        isC
                          ? "bg-emerald-500/15 text-emerald-200"
                          : isCh
                            ? "bg-rose-500/15 text-rose-200"
                            : "bg-muted/40 text-foreground/80"
                      }`}
                    >
                      <span className="font-semibold">{letter}.</span>
                      <span className="min-w-0">{text}</span>
                    </div>
                  );
                })}
              </div>
              {m.explanation && (
                <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground/80">Explanation: </span>
                  {m.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${tone}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest">{label}</p>
      <p className="text-base font-bold">{value}</p>
    </div>
  );
}
