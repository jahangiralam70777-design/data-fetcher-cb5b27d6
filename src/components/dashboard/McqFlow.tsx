import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles, Award, Crown, Calculator, Scale, Receipt, Briefcase, Landmark, PiggyBank,
  BookOpen, ChevronRight, ChevronDown, Bookmark, Flame, ArrowLeft, ArrowRight,
  Check, X, Lightbulb, Loader2, Trophy, RotateCw, Eye, Clock, Target,
  CheckCircle2, XCircle, MinusCircle, BarChart3, Flag,
} from "lucide-react";

import { listSubjects, listChapters, listMcqs, listSubjectProgress, listChapterProgress } from "@/lib/learning.functions";
import { useLevels } from "@/hooks/use-levels";
import { saveSessionAttempt } from "@/lib/student-performance.functions";
import {
  toggleMcqBookmark,
  listMyBookmarkIds,
  recordMcqOutcomes,
} from "@/lib/mcq-review.functions";

type Step = 0 | 1 | 2 | 3;

const LEVEL_TONES = [
  "var(--neon-purple)",
  "var(--neon-blue)",
  "oklch(0.82 0.16 85)",
  "var(--neon-pink)",
  "oklch(0.75 0.18 150)",
];
const LEVEL_ICONS = [Sparkles, Award, Crown];


const subjectIconMap: Record<string, { i: typeof Calculator; tone: string }> = {
  accounting: { i: Calculator, tone: "var(--neon-purple)" },
  "financial-accounting": { i: Calculator, tone: "var(--neon-purple)" },
  "management-accounting": { i: PiggyBank, tone: "oklch(0.78 0.15 200)" },
  "cost-accounting": { i: PiggyBank, tone: "oklch(0.78 0.15 200)" },
  audit: { i: Briefcase, tone: "var(--neon-blue)" },
  auditing: { i: Briefcase, tone: "var(--neon-blue)" },
  taxation: { i: Receipt, tone: "var(--neon-pink)" },
  tax: { i: Receipt, tone: "var(--neon-pink)" },
  vat: { i: Receipt, tone: "var(--neon-pink)" },
  law: { i: Scale, tone: "oklch(0.75 0.18 150)" },
  "business-law": { i: Scale, tone: "oklch(0.75 0.18 150)" },
  finance: { i: Landmark, tone: "oklch(0.82 0.16 85)" },
  "corporate-finance": { i: Landmark, tone: "oklch(0.82 0.16 85)" },
};
function iconFor(slug: string) {
  return subjectIconMap[slug?.toLowerCase()] ?? { i: BookOpen, tone: "var(--neon-purple)" };
}

const diffColor: Record<string, string> = {
  easy: "oklch(0.75 0.18 150)",
  medium: "var(--neon-blue)",
  hard: "var(--neon-pink)",
};

const stepLabels = ["Level", "Subject", "Chapter", "Practice"];

type Mcq = {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  explanation: string | null;
  difficulty: string;
};

type Choice = "A" | "B" | "C" | "D";
type AnswerRec = { chosen: Choice | null; timeMs: number } | undefined;

function sanitizeOptionText(value: string | null | undefined): string {
  if (value == null) return "";
  let s = String(value);
  // Remove markdown bold/italic markers (**, __, *, _) wherever they appear
  s = s.replace(/\*+/g, "").replace(/_{2,}/g, "");
  return s.replace(/\s+/g, " ").trim();
}

function normalizeChoice(value: string | null | undefined): Choice | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized === "A" || normalized === "B" || normalized === "C" || normalized === "D"
    ? normalized
    : null;
}

function debugMcq(label: string, payload?: unknown) {
  console.debug(`[MCQ Practice] ${label}`, payload ?? "");
}

function fmtDuration(sec: number) {
  if (!sec) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

type OptionState = "idle" | "correct" | "wrong" | "selected";

type OptionButtonProps = {
  questionId: string;
  optionKey: Choice;
  text: string;
  state: OptionState;
  clickable: boolean;
  onPick: (k: Choice) => void;
};

const OptionButton = memo(function OptionButton({
  optionKey,
  text,
  state,
  clickable,
  onPick,
}: OptionButtonProps) {
  const tone =
    state === "correct" ? "border-emerald-400/60 bg-emerald-400/10"
    : state === "wrong" ? "border-red-400/60 bg-red-400/10"
    : state === "selected" ? "border-primary bg-primary/10"
    : "border-border hover:border-primary/50 hover:bg-muted/40";
  return (
    <button
      type="button"
      onClick={() => clickable && onPick(optionKey)}
      disabled={!clickable}
      className={`group relative flex items-center gap-4 rounded-2xl border p-4 text-left transition-colors duration-150 ${tone} disabled:cursor-default`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-base font-bold transition-colors duration-150 ${
          state === "correct" ? "bg-emerald-500 text-white"
          : state === "wrong" ? "bg-red-500 text-white"
          : state === "selected" ? "bg-cta-gradient text-white shadow-glow"
          : "bg-muted text-foreground group-hover:bg-cta-gradient group-hover:text-white"
        }`}
      >
        {state === "correct" ? <Check className="h-4 w-4" /> : state === "wrong" ? <X className="h-4 w-4" /> : optionKey}
      </span>
      <span className="text-sm font-medium">{text}</span>
    </button>
  );
});

export function McqFlow() {
  const [step, setStep] = useState<Step>(0);
  const [level, setLevel] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [chapterName, setChapterName] = useState<string | null>(null);
  const [openChapter, setOpenChapter] = useState<string | null>(null);

  const [current, setCurrent] = useState(0);
  const [showExp, setShowExp] = useState(false);
  const [answers, setAnswers] = useState<AnswerRec[]>([]);
  const [selectedOption, setSelectedOption] = useState<Choice | null>(null);
  const [sessionStart, setSessionStart] = useState<number>(0);
  const questionStartRef = useRef<number>(Date.now());
  const [finished, setFinished] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAttemptId, setSavedAttemptId] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const toggleFlag = useCallback((i: number) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);
  const autoFinishKeyRef = useRef<string | null>(null);

  const listSubjectsFn = useServerFn(listSubjects);
  const listChaptersFn = useServerFn(listChapters);
  const listMcqsFn = useServerFn(listMcqs);
  const listSubjectProgressFn = useServerFn(listSubjectProgress);
  const listChapterProgressFn = useServerFn(listChapterProgress);
  const saveAttemptFn = useServerFn(saveSessionAttempt);
  const toggleBookmarkFn = useServerFn(toggleMcqBookmark);
  const listBookmarkIdsFn = useServerFn(listMyBookmarkIds);
  const recordOutcomesFn = useServerFn(recordMcqOutcomes);
  const qc = useQueryClient();

  const levelsQ = useLevels();
  const levelsList = levelsQ.data ?? [];
  const levelName = useMemo(
    () => levelsList.find((l) => l.code === level)?.name ?? level ?? "",
    [levelsList, level],
  );


  const bookmarksQ = useQuery({
    queryKey: ["my-bookmark-ids"],
    queryFn: () => listBookmarkIdsFn(),
    staleTime: 60_000,
  });
  const bookmarkSet = useMemo(
    () => new Set<string>(bookmarksQ.data ?? []),
    [bookmarksQ.data],
  );

  async function toggleBookmark(mcqId: string) {
    const wasBookmarked = bookmarkSet.has(mcqId);
    try {
      await toggleBookmarkFn({
        data: {
          mcqId,
          bookmarked: !wasBookmarked,
          chapterId: chapterId ?? null,
          subjectId: subjectId ?? null,
          level: level ?? null,
        },
      });
      qc.invalidateQueries({ queryKey: ["my-bookmark-ids"] });
      qc.invalidateQueries({ queryKey: ["mcq-bookmarks"] });
      qc.invalidateQueries({ queryKey: ["mcq-review-counts"] });
    } catch (e) {
      debugMcq("bookmark failed", e);
    }
  }

  const subjectsQ = useQuery({
    queryKey: ["subjects", level],
    queryFn: () => listSubjectsFn({ data: { level: level ?? undefined } }),
    enabled: !!level,
  });
  const subjectProgressQ = useQuery({
    queryKey: ["subject-progress", level],
    queryFn: () => listSubjectProgressFn({ data: { level: level ?? undefined } }),
    enabled: !!level,
    staleTime: 30_000,
  });
  const subjectProgressMap = useMemo(() => {
    const m = new Map<string, { total: number; completed: number; percent: number }>();
    const rows = (subjectProgressQ.data ?? []) as Array<{ subject_id: string; total: number; completed: number; percent: number }>;
    rows.forEach((r) => m.set(r.subject_id, { total: r.total, completed: r.completed, percent: r.percent }));
    return m;
  }, [subjectProgressQ.data]);

  const chaptersQ = useQuery({
    queryKey: ["chapters", subjectId],
    queryFn: () => listChaptersFn({ data: { subjectId: subjectId! } }),
    enabled: !!subjectId,
  });
  const chapterProgressQ = useQuery({
    queryKey: ["chapter-progress", subjectId],
    queryFn: () => listChapterProgressFn({ data: { subjectId: subjectId! } }),
    enabled: !!subjectId,
    staleTime: 30_000,
  });
  const chapterProgressMap = useMemo(() => {
    const m = new Map<string, { total: number; completed: number; percent: number; accuracy: number }>();
    const rows = (chapterProgressQ.data ?? []) as Array<{ chapter_id: string; total: number; completed: number; percent: number; accuracy: number }>;
    rows.forEach((r) => m.set(r.chapter_id, { total: r.total, completed: r.completed, percent: r.percent, accuracy: r.accuracy }));
    return m;
  }, [chapterProgressQ.data]);

  const mcqsQ = useQuery({
    queryKey: ["mcqs", chapterId],
    queryFn: () => listMcqsFn({ data: { chapterId: chapterId!, limit: 25 } }),
    enabled: !!chapterId && step === 3,
  });

  const mcqs = useMemo(() => (mcqsQ.data ?? []) as Mcq[], [mcqsQ.data]);
  const total = mcqs.length;
  const q = mcqs[current];
  const currentAnswer = answers[current];
  const submittedNow = !!currentAnswer; // true once student clicks Submit (or Skip) for this question
  // Reveal correct/wrong + explanation as soon as this question is submitted, plus in review/finish.
  const revealResults = reviewMode || finished || submittedNow;
  const picked: Choice | null = submittedNow ? (currentAnswer?.chosen ?? null) : selectedOption;

  const options = useMemo(
    () =>
      q
        ? ([
            { k: "A" as Choice, t: sanitizeOptionText(q.option_a) },
            { k: "B" as Choice, t: sanitizeOptionText(q.option_b) },
            { k: "C" as Choice, t: sanitizeOptionText(q.option_c) },
            { k: "D" as Choice, t: sanitizeOptionText(q.option_d) },
          ] as const)
        : ([] as ReadonlyArray<{ k: Choice; t: string }>),
    [q?.id, q?.option_a, q?.option_b, q?.option_c, q?.option_d],
  );

  const correctChoice = useMemo(() => (q ? normalizeChoice(q.correct_option) : null), [q?.id, q?.correct_option]);

  // Stable click handler — ignores re-selecting the same option (prevents
  // duplicate state writes / re-renders from rapid clicks).
  const pickOption = useCallback((k: Choice) => {
    setSelectedOption((prev) => (prev === k ? prev : k));
  }, []);

  // Derived metrics
  const stats = useMemo(() => {
    let correct = 0, wrong = 0, skipped = 0, attempted = 0;
    answers.forEach((a, i) => {
      if (!a || !mcqs[i]) return;
      if (a.chosen === null) skipped++;
      else {
        attempted++;
        if (a.chosen === normalizeChoice(mcqs[i].correct_option)) correct++;
        else wrong++;
      }
    });
    const submitted = answers.filter(Boolean).length;
    const accuracy = attempted ? Math.round((correct / attempted) * 100) : 0;
    const score = total ? Math.round((correct / total) * 100) : 0;
    return { correct, wrong, skipped, attempted, submitted, accuracy, score };
  }, [answers, mcqs, total]);

  const allSubmitted = total > 0 && stats.submitted === total;

  // reset question timer on navigation; rehydrate selectedOption from prior answer
  useEffect(() => {
    questionStartRef.current = Date.now();
    setShowExp(false);
    setSelectedOption(answers[current]?.chosen ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, chapterId]);

  function gotoChapter(id: string, name: string) {
    setChapterId(id);
    setChapterName(name);
    setStep(3);
    setCurrent(0);
    setShowExp(false);
    setAnswers([]);
    setSelectedOption(null);
    setFinished(false);
    setReviewMode(false);
    setSavedAttemptId(null);
    autoFinishKeyRef.current = null;
    setSessionStart(Date.now());
    questionStartRef.current = Date.now();
    debugMcq("chapter start", { chapterId: id, chapterName: name, level, subjectId, subjectName });
  }

  const buildCompletedAnswers = useCallback(
    (source: AnswerRec[]) => mcqs.map((_, i) => source[i] ?? { chosen: null, timeMs: 0 }),
    [mcqs],
  );

  function recordAnswer(chosen: Choice | null) {
    if (!q) return;
    const elapsed = Math.max(0, Date.now() - questionStartRef.current);
    setAnswers((prev) => {
      const next = [...prev];
      next[current] = { chosen, timeMs: Math.min(elapsed, 60 * 60 * 1000) };
      debugMcq("answer recorded", {
        currentIndex: current,
        chosen,
        answeredCount: next.filter(Boolean).length,
        totalQuestions: total,
      });
      return next;
    });
  }

  function submitAnswer(chosen: Choice | null) {
    if (!q || reviewMode) return;
    // Manual submit only — records answer, reveals correctness + explanation, NO auto-advance.
    debugMcq("submit trigger", { currentIndex: current, chosen, isLastQuestion: current === total - 1 });
    recordAnswer(chosen);
    setShowExp(true);
  }

  function nextQ() {
    if (current < total - 1) setCurrent((c) => c + 1);
  }
  function prevQ() {
    if (current > 0) setCurrent((c) => c - 1);
  }
  function jumpTo(i: number) {
    if (i >= 0 && i < total) setCurrent(i);
  }

  const finishPractice = useCallback(async (opts?: { auto?: boolean }) => {
    if (saving || (finished && savedAttemptId)) return;
    const finalizedAnswers = buildCompletedAnswers(answers);
    const totalDurationSec = Math.max(1, Math.round((Date.now() - (sessionStart || Date.now())) / 1000));
    const localCorrect = finalizedAnswers.reduce((sum, a, i) => (
      sum + (a?.chosen !== null && a?.chosen === normalizeChoice(mcqs[i]?.correct_option) ? 1 : 0)
    ), 0);
    const localSkipped = finalizedAnswers.filter((a) => a?.chosen === null).length;
    const localWrong = Math.max(0, total - localCorrect - localSkipped);
    const localAttempted = total - localSkipped;
    const localScore = total ? Math.round((localCorrect / total) * 100) : 0;
    const localAccuracy = localAttempted ? Math.round((localCorrect / localAttempted) * 100) : 0;

    debugMcq("finish trigger", {
      auto: !!opts?.auto,
      currentIndex: current,
      answeredCount: finalizedAnswers.filter(Boolean).length,
      totalQuestions: total,
      localCorrect,
      localWrong,
      localSkipped,
      localScore,
      localAccuracy,
    });

    // Mount the result screen immediately. The DB save runs after this so a
    // network/RLS failure can never strand the student on the last question.
    setAnswers(finalizedAnswers);
    setFinished(true);
    setReviewMode(false);
    setSaving(true);

    // Ensure answer record for every question (missing = skipped)
    const finalAnswers = mcqs.map((m, i) => {
      const a = finalizedAnswers[i];
      return {
        mcqId: m.id,
        chosen: a?.chosen ?? null,
        timeMs: Math.min(a?.timeMs ?? 0, 60 * 60 * 1000),
      };
    });

    try {
      const res = await saveAttemptFn({
        data: {
          kind: "mcq_practice",
          subjectId: subjectId ?? null,
          chapterId: chapterId ?? null,
          level: level ?? null,
          title: chapterName ?? "MCQ Practice",
          durationSeconds: totalDurationSec,
          answers: finalAnswers,
          meta: { auto: !!opts?.auto, score: localScore, accuracy: localAccuracy, correct: localCorrect, wrong: localWrong, skipped: localSkipped },
        },
      });
      setSavedAttemptId(res.attemptId);
      debugMcq("DB save success", { attemptId: res.attemptId, score: res.score, correct: res.correct, total: res.total });
      // Record wrong/mastered outcomes for the Wrong Questions section
      try {
        const outcomes = mcqs.map((m, i) => {
          const a = finalizedAnswers[i];
          const correctOpt = normalizeChoice(m.correct_option);
          return {
            mcqId: m.id,
            chosen: a?.chosen ?? null,
            isCorrect: a?.chosen !== null && a?.chosen === correctOpt,
            correctOption: correctOpt,
          };
        });
        await recordOutcomesFn({
          data: {
            level: level ?? null,
            subjectId: subjectId ?? null,
            chapterId: chapterId ?? null,
            outcomes,
          },
        });
      } catch (e) {
        debugMcq("record outcomes failed", e);
      }
      // Refresh dashboard views immediately
      qc.invalidateQueries({ queryKey: ["student-performance-center"] });
      qc.invalidateQueries({ queryKey: ["student-completion-tracker"] });
      qc.invalidateQueries({ queryKey: ["exam-attempts"] });
      qc.invalidateQueries({ queryKey: ["mcq-wrong"] });
      qc.invalidateQueries({ queryKey: ["mcq-review-counts"] });
      qc.invalidateQueries({ queryKey: ["subject-progress"] });
      qc.invalidateQueries({ queryKey: ["chapter-progress"] });
    } catch (e) {
      debugMcq("DB save failed", e);
    } finally {
      setSaving(false);
    }
  }, [answers, buildCompletedAnswers, chapterId, chapterName, current, finished, level, mcqs, qc, recordOutcomesFn, saveAttemptFn, savedAttemptId, saving, sessionStart, subjectId, total]);

  useEffect(() => {
    if (step !== 3 || total === 0) return;
    debugMcq("state", {
      currentIndex: current,
      answeredCount: stats.submitted,
      totalQuestions: total,
      allSubmitted,
      finished,
      saving,
      reviewMode,
    });
  }, [allSubmitted, current, finished, reviewMode, saving, stats.submitted, step, total]);




  function restartSame() {
    if (!chapterId || !chapterName) return;
    gotoChapter(chapterId, chapterName);
    mcqsQ.refetch();
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-5">
        {/* Premium connected stepper */}
        <div className="glass shadow-card-soft relative overflow-hidden rounded-2xl p-4 sm:p-5">
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[var(--neon-purple)]/15 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 -bottom-16 h-40 w-40 rounded-full bg-[var(--neon-blue)]/15 blur-3xl" />
          <div className="relative flex items-center gap-1 overflow-x-auto">
            {stepLabels.map((l, i) => {
              const active = step === i;
              const done = i < step;
              const locked = i > step;
              const ctxName = i === 0 ? null : i === 1 ? levelName : i === 2 ? subjectName : chapterName;
              return (
                <div key={l} className="flex min-w-fit flex-1 items-center gap-1">
                  <button
                    onClick={() => i <= step && setStep(i as Step)}
                    disabled={locked}
                    className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all ${
                      active
                        ? "bg-gradient-to-r from-[var(--neon-purple)]/15 via-[var(--neon-blue)]/10 to-transparent ring-1 ring-inset ring-[var(--neon-purple)]/40 shadow-glow"
                        : done
                        ? "hover:bg-muted/50"
                        : "opacity-60"
                    } ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span
                      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
                        active
                          ? "bg-cta-gradient text-white shadow-[0_0_18px_var(--neon-purple)]"
                          : done
                          ? "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/40"
                          : "bg-muted/60 text-muted-foreground ring-1 ring-border"
                      }`}
                    >
                      {done ? <Check className="h-4 w-4" /> : i + 1}
                      {active && (
                        <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-[var(--neon-purple)]/30" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[10px] uppercase tracking-widest ${active ? "text-[var(--neon-purple)]" : "text-muted-foreground"}`}>
                        Step {i + 1}
                      </p>
                      <p className={`truncate text-sm font-bold ${active || done ? "text-foreground" : "text-muted-foreground"}`}>
                        {l}
                      </p>
                      {ctxName && (done || active) && (
                        <p className="truncate text-[10px] text-muted-foreground">{ctxName}</p>
                      )}
                    </div>
                  </button>
                  {i < stepLabels.length - 1 && (
                    <div className="hidden h-px w-6 shrink-0 sm:block">
                      <div className={`h-full w-full rounded-full ${done ? "bg-gradient-to-r from-emerald-500/60 to-[var(--neon-purple)]/60" : "bg-border"}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* STEP 1 — LEVEL */}
        {step === 0 && (
          <section className="animate-fade-up">
            <h2 className="font-display text-2xl font-bold">Choose your level</h2>
            <p className="text-sm text-muted-foreground">Pick the difficulty band you want to train at.</p>
            {levelsQ.isLoading ? (
              <LoadingBlock />
            ) : levelsList.length === 0 ? (
              <EmptyState text="No levels published yet." />
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
                {levelsList.map((l, idx) => {
                  const Icon = LEVEL_ICONS[idx % LEVEL_ICONS.length];
                  const tone = l.color || LEVEL_TONES[idx % LEVEL_TONES.length];
                  const active = level === l.code;
                  return (
                    <button
                      key={l.code}
                      onClick={() => { setLevel(l.code); setStep(1); }}
                      className={`group relative rounded-3xl p-px text-left transition-transform hover:-translate-y-1 ${active ? "ring-2 ring-primary" : ""}`}
                      style={{ background: `linear-gradient(135deg, ${tone}, transparent 65%)` }}
                    >
                      <div className="glass relative h-full overflow-hidden rounded-[calc(theme(borderRadius.3xl)-1px)] p-6">
                        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-40 blur-3xl transition-opacity group-hover:opacity-80" style={{ background: tone }} />
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-glow" style={{ background: `linear-gradient(135deg, ${tone}, oklch(0.55 0.2 270))` }}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <h3 className="font-display mt-5 text-xl font-bold">{l.name} Level</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{l.description ?? "Tap to start"}</p>
                        <div className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-gradient">
                          Continue <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}


        {/* STEP 2 — SUBJECT */}
        {step === 1 && (
          <section className="animate-fade-up">
            <h2 className="font-display text-2xl font-bold">Pick a subject</h2>
            <p className="text-sm text-muted-foreground">{levelName} Level · choose your battleground.</p>
            {subjectsQ.isLoading ? (
              <LoadingBlock />
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3">
                {(subjectsQ.data ?? []).map((s) => {
                  const { i: Icon, tone } = iconFor(s.slug);
                  const active = subjectId === s.id;
                  const prog = subjectProgressMap.get(s.id);
                  const pct = prog?.percent ?? 0;
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setSubjectId(s.id); setSubjectName(s.name); setStep(2); }}
                      className={`group relative rounded-3xl p-px text-left transition-transform hover:-translate-y-1 ${active ? "ring-2 ring-primary" : ""}`}
                      style={{ background: `linear-gradient(135deg, ${tone}, transparent 65%)` }}
                    >
                      <div className="glass relative h-full overflow-hidden rounded-[calc(theme(borderRadius.3xl)-1px)] p-5">
                        <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-70" style={{ background: tone }} />
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-white" style={{ background: `linear-gradient(135deg, ${tone}, oklch(0.55 0.2 270))` }}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <h3 className="font-display mt-4 text-lg font-bold">{s.name}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-2">{s.description ?? "Tap to explore chapters"}</p>
                        {prog && prog.total > 0 && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-[11px] font-semibold">
                              <span className="text-muted-foreground">{prog.completed} / {prog.total} MCQs</span>
                              <span className="text-gradient">{pct}%</span>
                            </div>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                              <div className="h-full rounded-full bg-gradient-to-r from-[var(--neon-purple)] to-[var(--neon-blue)] transition-all duration-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
                {!subjectsQ.isLoading && (subjectsQ.data ?? []).length === 0 && <EmptyState text="No subjects published for this level yet." />}
              </div>
            )}
          </section>
        )}

        {/* STEP 3 — CHAPTER */}
        {step === 2 && (
          <section className="animate-fade-up">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-2xl font-bold">Select a chapter</h2>
                <p className="text-sm text-muted-foreground">{levelName} · {subjectName}</p>
              </div>
              <span className="glass rounded-full px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                {(chaptersQ.data ?? []).length} chapters
              </span>
            </div>

            {chaptersQ.isLoading ? (
              <div className="mt-5"><LoadingBlock /></div>
            ) : (chaptersQ.data ?? []).length === 0 ? (
              <div className="mt-5"><EmptyState text="No chapters in this subject yet." /></div>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(chaptersQ.data ?? []).map((c, idx) => {
                  const cprog = chapterProgressMap.get(c.id);
                  const cpct = cprog?.percent ?? 0;
                  const total = cprog?.total ?? 0;
                  const completed = cprog?.completed ?? 0;
                  const accuracy = cprog?.accuracy ?? 0;
                  const isComplete = total > 0 && completed >= total;
                  const isActive = chapterId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => gotoChapter(c.id, c.name)}
                      className={`group relative rounded-3xl p-px text-left transition-all duration-300 hover:-translate-y-1 active:scale-[0.99] ${
                        isActive ? "ring-2 ring-[var(--neon-purple)]" : ""
                      }`}
                      style={{
                        background: isActive
                          ? "linear-gradient(135deg, var(--neon-purple), var(--neon-blue))"
                          : "linear-gradient(135deg, var(--neon-purple) / 0.35, transparent 60%)",
                      }}
                    >
                      <div className="glass relative h-full overflow-hidden rounded-[calc(theme(borderRadius.3xl)-1px)] p-5">
                        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[var(--neon-purple)]/20 blur-3xl opacity-60 transition-opacity group-hover:opacity-100" />
                        <div className="pointer-events-none absolute -left-10 -bottom-10 h-28 w-28 rounded-full bg-[var(--neon-blue)]/20 blur-3xl opacity-40 transition-opacity group-hover:opacity-80" />

                        <div className="relative flex items-start justify-between gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cta-gradient font-display text-base font-bold text-white shadow-glow">
                            {String(idx + 1).padStart(2, "0")}
                          </div>
                          {isComplete ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500 ring-1 ring-emerald-500/30">
                              <Check className="h-3 w-3" /> Done
                            </span>
                          ) : total > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--neon-blue)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--neon-blue)] ring-1 ring-[var(--neon-blue)]/30">
                              In progress
                            </span>
                          ) : null}
                        </div>

                        <h3 className="font-display relative mt-4 line-clamp-2 text-base font-bold leading-snug">
                          {c.name}
                        </h3>
                        {c.description && (
                          <p className="relative mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {c.description}
                          </p>
                        )}

                        <div className="relative mt-4 flex items-center gap-3 text-[11px] font-semibold text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><BookOpen className="h-3 w-3" /> {total || "—"} MCQs</span>
                          {completed > 0 && (
                            <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" /> {accuracy}% acc</span>
                          )}
                        </div>

                        {total > 0 && (
                          <div className="relative mt-3">
                            <div className="flex items-center justify-between text-[10px] font-semibold">
                              <span className="text-muted-foreground">{completed} / {total}</span>
                              <span className="text-gradient">{cpct}%</span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[var(--neon-purple)] via-[var(--neon-blue)] to-emerald-400 transition-all duration-700"
                                style={{ width: `${cpct}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="relative mt-4 inline-flex items-center gap-1 text-xs font-bold text-gradient transition-all group-hover:gap-2">
                          Start Practice <ArrowRight className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* STEP 4 — PRACTICE / RESULT */}
        {step === 3 && (
          <section className="animate-fade-up">
            {/* RESULT SCREEN */}
            {finished && !reviewMode ? (
              <ResultScreen
                stats={stats}
                total={total}
                chapterName={chapterName}
                subjectName={subjectName}
                level={levelName}
                durationSec={Math.max(1, Math.round((Date.now() - sessionStart) / 1000))}
                mcqs={mcqs}
                answers={answers}
                onReview={() => { setReviewMode(true); setCurrent(0); }}
                onRetry={restartSame}
                onNewChapter={() => setStep(2)}
                savedAttemptId={savedAttemptId}
                saving={saving}
                onSaveRetry={() => finishPractice()}
              />
            ) : (
              <div className="glass shadow-glow relative overflow-hidden rounded-3xl p-6">
                <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-[var(--neon-purple)]/25 blur-3xl" />
                <div className="pointer-events-none absolute -left-20 -bottom-20 h-60 w-60 rounded-full bg-[var(--neon-blue)]/20 blur-3xl" />

                {mcqsQ.isLoading ? (
                  <LoadingBlock />
                ) : total === 0 ? (
                  <EmptyState text="No questions published in this chapter yet." />
                ) : q ? (
                  <>
                    <div className="relative flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="glass rounded-xl px-3 py-1.5 text-xs font-semibold">
                          Q {String(current + 1).padStart(2, "0")} / {total}
                        </span>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize text-white" style={{ background: diffColor[q.difficulty] ?? "var(--neon-blue)" }}>
                          {q.difficulty}
                        </span>
                        {reviewMode && (
                          <span className="rounded-full bg-[var(--neon-blue)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--neon-blue)]">
                            <Eye className="mr-1 inline h-3 w-3" /> Review mode
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => q && toggleBookmark(q.id)}
                        title={bookmarkSet.has(q.id) ? "Remove bookmark" : "Bookmark this question"}
                        className={`glass flex h-9 w-9 items-center justify-center rounded-xl transition-transform hover:scale-105 ${
                          bookmarkSet.has(q.id) ? "text-[var(--neon-purple)]" : ""
                        }`}
                      >
                        <Bookmark
                          className="h-4 w-4"
                          fill={bookmarkSet.has(q.id) ? "currentColor" : "none"}
                        />
                      </button>
                    </div>

                    <h3 className="font-display relative mt-6 text-xl font-bold leading-snug sm:text-2xl">
                      {q.question}
                    </h3>

                    <div className="relative mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {options.map((o) => {
                        const isPicked = picked === o.k;
                        const isCorrect = correctChoice === o.k;
                        let state: OptionState = "idle";
                        if (revealResults) {
                          if (isCorrect) state = "correct";
                          else if (isPicked) state = "wrong";
                        } else if (isPicked) state = "selected";
                        const clickable = !reviewMode && !submittedNow;
                        return (
                          <OptionButton
                            key={`${q.id}:${o.k}`}
                            questionId={q.id}
                            optionKey={o.k}
                            text={o.t}
                            state={state}
                            clickable={clickable}
                            onPick={pickOption}
                          />
                        );
                      })}
                    </div>

                    {revealResults && q.explanation && (
                      <div className="relative mt-5">
                        <button onClick={() => setShowExp((s) => !s)} className="glass inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-transform hover:scale-[1.02]">
                          <Lightbulb className="h-3.5 w-3.5 text-[var(--neon-purple)]" />
                          Explanation
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showExp ? "rotate-180" : ""}`} />
                        </button>
                        {showExp && (
                          <div className="animate-fade-up mt-3 rounded-2xl border border-border bg-background/40 p-4 text-sm text-muted-foreground">
                            {q.explanation}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="relative mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        onClick={prevQ}
                        disabled={current === 0}
                        className="glass inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.02] disabled:opacity-40"
                      >
                        <ArrowLeft className="h-4 w-4" /> Previous
                      </button>
                      <div className="flex flex-wrap gap-3">
                        {!reviewMode && !submittedNow && (
                          <>
                            <button
                              onClick={() => submitAnswer(null)}
                              className="rounded-xl border border-border bg-background/40 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
                            >
                              Skip
                            </button>
                            <button
                              onClick={() => selectedOption && submitAnswer(selectedOption)}
                              disabled={!selectedOption}
                              className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                            >
                              <Check className="h-4 w-4" /> Submit Answer
                            </button>
                          </>
                        )}
                        {current < total - 1 ? (
                          <button
                            onClick={nextQ}
                            disabled={!reviewMode && !submittedNow}
                            className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                          >
                            Next <ArrowRight className="h-4 w-4" />
                          </button>
                        ) : reviewMode ? (
                          <button
                            onClick={() => setReviewMode(false)}
                            className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-transform hover:scale-[1.02]"
                          >
                            Back to Result
                          </button>
                        ) : (
                          <button
                            onClick={() => finishPractice()}
                            disabled={saving || !submittedNow}
                            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
                            {saving ? "Saving…" : allSubmitted ? "Finish Practice" : `Finish (${stats.submitted}/${total})`}
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </section>
        )}
      </div>

      {/* RIGHT PANEL */}
      <aside className="space-y-4">
        <div className="glass shadow-card-soft relative overflow-hidden rounded-3xl p-5 backdrop-blur-xl">
          <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[var(--neon-purple)]/20 blur-3xl" />
          <div className="pointer-events-none absolute -left-12 -bottom-12 h-32 w-32 rounded-full bg-[var(--neon-blue)]/15 blur-3xl" />

          <div className="relative flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-bold">Session</h3>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Live progress</p>
            </div>
            <Flame className="h-4 w-4 text-[var(--neon-pink)]" />
          </div>

          {/* Circular progress */}
          <div className="relative mt-5 flex items-center gap-4">
            <div className="relative h-24 w-24 shrink-0">
              <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
                <defs>
                  <linearGradient id="sessProg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--neon-purple)" />
                    <stop offset="100%" stopColor="var(--neon-blue)" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="8" fill="none" className="text-muted/50" />
                <circle
                  cx="50" cy="50" r="42" strokeWidth="8" fill="none" strokeLinecap="round"
                  stroke="url(#sessProg)"
                  strokeDasharray={`${(total ? stats.submitted / total : 0) * 2 * Math.PI * 42} ${2 * Math.PI * 42}`}
                  style={{ transition: "stroke-dasharray 600ms cubic-bezier(.2,.8,.2,1)", filter: "drop-shadow(0 0 8px var(--neon-purple))" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-xl font-bold tabular-nums">{stats.submitted}</span>
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">/ {total || 0}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Accuracy</p>
              <p className="font-display text-2xl font-bold text-gradient tabular-nums">{stats.accuracy}%</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-[var(--neon-blue)] to-[var(--neon-purple)] transition-all duration-700"
                  style={{ width: `${stats.accuracy}%` }}
                />
              </div>
            </div>
          </div>

          {/* Stat pills */}
          <div className="relative mt-5 grid grid-cols-3 gap-2">
            <StatPill label="Correct" value={stats.correct} tone="emerald" />
            <StatPill label="Wrong" value={stats.wrong} tone="rose" />
            <StatPill label="Skipped" value={stats.skipped} tone="amber" />
          </div>
        </div>


        {step === 3 && total > 0 && (
          <div className="glass shadow-card-soft rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold">Question Map</h3>
              {!finished && stats.submitted > 0 && (
                <button
                  onClick={() => finishPractice()}
                  disabled={saving}
                  className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  Finish
                </button>
              )}
            </div>
            <p className="text-xs font-medium text-foreground/70">{chapterName}</p>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {mcqs.map((m, i) => {
                const a = answers[i];
                const isCurrent = i === current;
                const isFlagged = flagged.has(i);
                // Premium, high-contrast tones that read in both themes.
                let cls =
                  "border border-border bg-muted/60 text-foreground/80 dark:bg-zinc-800/80 dark:text-zinc-200";
                if (isCurrent) {
                  cls =
                    "bg-blue-600 text-white border border-blue-700 shadow-[0_0_0_2px_rgba(37,99,235,0.35)] dark:bg-blue-500 dark:border-blue-400";
                } else if (a) {
                  if (a.chosen === null)
                    cls =
                      "bg-amber-600 text-white border border-amber-700 dark:bg-amber-500 dark:border-amber-400";
                  else if (a.chosen === normalizeChoice(m.correct_option))
                    cls =
                      "bg-emerald-700 text-white border border-emerald-800 dark:bg-emerald-600 dark:border-emerald-500";
                  else
                    cls =
                      "bg-rose-700 text-white border border-rose-800 dark:bg-rose-600 dark:border-rose-500";
                }
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      jumpTo(i);
                      toggleFlag(i);
                    }}
                    className={`relative flex h-10 items-center justify-center rounded-lg text-sm font-bold tracking-tight transition-transform hover:scale-110 ${cls}`}
                    title={`Q${i + 1}${a ? (a.chosen === null ? " · skipped" : a.chosen === normalizeChoice(m.correct_option) ? " · correct" : " · wrong") : " · unattempted"}${isFlagged ? " · flagged" : ""}`}
                  >
                    {i + 1}
                    {isFlagged && (
                      <Flag
                        className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 fill-yellow-400 text-yellow-600 drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
                        strokeWidth={2.5}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-medium text-foreground/80">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-700 dark:bg-emerald-600" /> Correct</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-700 dark:bg-rose-600" /> Wrong</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-600 dark:bg-amber-500" /> Skipped</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600 dark:bg-blue-500" /> Current</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted border border-border" /> Unattempted</span>
              <span className="flex items-center gap-1.5"><Flag className="h-3 w-3 fill-yellow-400 text-yellow-600" /> Flagged</span>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Tip: click a number to jump · click again to toggle flag</p>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Result screen                                                      */
/* ------------------------------------------------------------------ */

function ResultScreen({
  stats, total, chapterName, subjectName, level, durationSec,
  mcqs, answers, onReview, onRetry, onNewChapter, savedAttemptId, saving, onSaveRetry,
}: {
  stats: { correct: number; wrong: number; skipped: number; attempted: number; accuracy: number; score: number; submitted: number };
  total: number;
  chapterName: string | null;
  subjectName: string | null;
  level: string | null;
  durationSec: number;
  mcqs: Mcq[];
  answers: AnswerRec[];
  onReview: () => void;
  onRetry: () => void;
  onNewChapter: () => void;
  savedAttemptId: string | null;
  saving: boolean;
  onSaveRetry: () => void;
}) {
  const passed = stats.score >= 60;

  const diffPerf = useMemo(() => {
    const buckets: Record<string, { correct: number; total: number }> = {};
    mcqs.forEach((m, i) => {
      const k = (m.difficulty || "medium").toLowerCase();
      buckets[k] = buckets[k] ?? { correct: 0, total: 0 };
      buckets[k].total++;
      const a = answers[i];
      if (a && a.chosen === normalizeChoice(m.correct_option)) buckets[k].correct++;
    });
    return Object.entries(buckets).map(([k, v]) => ({
      key: k,
      label: k.charAt(0).toUpperCase() + k.slice(1),
      correct: v.correct,
      total: v.total,
      pct: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    }));
  }, [mcqs, answers]);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="glass shadow-glow relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full blur-3xl"
          style={{ background: passed ? "oklch(0.75 0.18 150 / 0.3)" : "var(--neon-pink) / 0.25" }} />
        <div className="pointer-events-none absolute -left-20 -bottom-20 h-60 w-60 rounded-full bg-[var(--neon-blue)]/20 blur-3xl" />

        <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Practice Complete
            </span>
            <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              {passed ? "Great work!" : "Keep going — you got this."}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {level} · {subjectName} · {chapterName}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {new Date().toLocaleString()} {savedAttemptId ? "· saved" : ""}
            </p>
          </div>

          {/* Circular score */}
          <div className="relative">
            <svg width="140" height="140" className="-rotate-90">
              <circle cx="70" cy="70" r="60" stroke="currentColor" strokeWidth="10" fill="none" className="text-muted/40" />
              <circle
                cx="70" cy="70" r="60" strokeWidth="10" fill="none" strokeLinecap="round"
                stroke={passed ? "oklch(0.75 0.18 150)" : "var(--neon-pink)"}
                strokeDasharray={`${(stats.score / 100) * 2 * Math.PI * 60} ${2 * Math.PI * 60}`}
                style={{ filter: `drop-shadow(0 0 10px ${passed ? "oklch(0.75 0.18 150)" : "var(--neon-pink)"})` }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-display text-4xl font-bold ${passed ? "text-emerald-400" : "text-rose-400"}`}>
                {stats.score}%
              </span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Score</span>
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <ResultStat icon={Target} label="Accuracy" value={`${stats.accuracy}%`} tone="var(--neon-purple)" />
          <ResultStat icon={CheckCircle2} label="Correct" value={`${stats.correct}/${total}`} tone="oklch(0.75 0.18 150)" />
          <ResultStat icon={XCircle} label="Wrong" value={String(stats.wrong)} tone="var(--neon-pink)" />
          <ResultStat icon={MinusCircle} label="Skipped" value={String(stats.skipped)} tone="oklch(0.78 0.15 60)" />
          <ResultStat icon={Clock} label="Time" value={fmtDuration(durationSec)} tone="var(--neon-blue)" />
        </div>

        {/* Actions */}
        <div className="relative mt-6 flex flex-wrap gap-3">
          <button
            onClick={onReview}
            className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-transform hover:scale-[1.02]"
          >
            <Eye className="h-4 w-4" /> Review Answers
          </button>
          <button
            onClick={onRetry}
            className="glass inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.02]"
          >
            <RotateCw className="h-4 w-4" /> Retry Chapter
          </button>
          <button
            onClick={onNewChapter}
            className="rounded-xl border border-border bg-background/40 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
          >
            Pick Another Chapter
          </button>
          {!savedAttemptId && (
            <button
              onClick={onSaveRetry}
              disabled={saving}
              className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-400 transition-colors hover:bg-amber-400/15 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Attempt"}
            </button>
          )}
        </div>
      </div>

      {/* Difficulty perf */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="glass shadow-card-soft rounded-3xl p-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[var(--neon-blue)]" />
            <h3 className="font-display text-lg font-bold">Difficulty Breakdown</h3>
          </div>
          <p className="text-xs text-muted-foreground">How you did across question difficulties</p>
          <div className="mt-4 space-y-3">
            {diffPerf.length ? diffPerf.map((d) => (
              <div key={d.key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize font-medium">{d.label}</span>
                  <span className="text-xs text-muted-foreground">{d.correct}/{d.total} · <b className="text-foreground">{d.pct}%</b></span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${d.pct}%`,
                      background: `linear-gradient(90deg, ${diffColor[d.key] ?? "var(--neon-blue)"}, var(--neon-purple))`,
                      boxShadow: `0 0 12px ${diffColor[d.key] ?? "var(--neon-blue)"}`,
                    }} />
                </div>
              </div>
            )) : <p className="text-xs text-muted-foreground">No data.</p>}
          </div>
        </div>

        <div className="glass shadow-card-soft rounded-3xl p-5">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--neon-purple)]" />
            <h3 className="font-display text-lg font-bold">Weak Spots</h3>
          </div>
          <p className="text-xs text-muted-foreground">Questions you got wrong — revisit these</p>
          <ul className="mt-4 space-y-2 max-h-64 overflow-y-auto pr-1">
            {mcqs.map((m, i) => {
              const a = answers[i];
              if (!a || a.chosen === null || a.chosen === normalizeChoice(m.correct_option)) return null;
              return (
                <li key={m.id} className="rounded-xl bg-background/40 p-3 text-xs">
                  <p className="font-medium line-clamp-2">Q{i + 1}. {m.question}</p>
                  <p className="mt-1 text-[10px] text-rose-400">
                    Your answer: {a.chosen} · Correct: <b>{m.correct_option}</b>
                  </p>
                </li>
              );
            })}
            {stats.wrong === 0 && stats.skipped === 0 && (
              <li className="text-xs text-emerald-400">🎯 No weak spots — perfect run.</li>
            )}
            {stats.skipped > 0 && (
              <li className="rounded-xl border border-dashed border-amber-400/30 p-2 text-[10px] text-amber-400">
                {stats.skipped} skipped — open Review to attempt them.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ResultStat({ icon: Icon, label, value, tone }: {
  icon: typeof Target; label: string; value: string; tone: string;
}) {
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-3">
      <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full opacity-30 blur-xl" style={{ background: tone }} />
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color: tone }} />
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      </div>
      <p className="font-display mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function StatPill({ label, value, tone }: { label: string; value: number; tone: "emerald" | "rose" | "amber" }) {
  const toneCls =
    tone === "emerald"
      ? "from-emerald-500/15 to-emerald-500/5 text-emerald-500 ring-emerald-500/20"
      : tone === "rose"
      ? "from-rose-500/15 to-rose-500/5 text-rose-500 ring-rose-500/20"
      : "from-amber-500/15 to-amber-500/5 text-amber-500 ring-amber-500/20";
  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${toneCls} px-2.5 py-2 ring-1 ring-inset transition-transform hover:-translate-y-0.5`}>
      <p className="text-[9px] uppercase tracking-widest opacity-80">{label}</p>
      <p className="font-display mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Stat({ label, value, gradient }: { label: string; value: string; gradient?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`font-display mt-1 text-xl font-bold ${gradient ? "text-gradient" : ""}`}>{value}</p>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
