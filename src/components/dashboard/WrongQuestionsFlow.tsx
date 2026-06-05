import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { XCircle, Loader2, Check, RotateCw, Trash2, ChevronDown } from "lucide-react";

import {
  listWrongMcqs,
  markWrongMcqsMastered,
  removeWrongMcqs,
} from "@/lib/mcq-review.functions";
import { listSubjects, listChapters } from "@/lib/learning.functions";
import { useLevels } from "@/hooks/use-levels";


export function WrongQuestionsFlow() {
  const [level, setLevel] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const navigate = useNavigate();

  const qc = useQueryClient();
  const listFn = useServerFn(listWrongMcqs);
  const masterFn = useServerFn(markWrongMcqsMastered);
  const removeFn = useServerFn(removeWrongMcqs);
  const subjectsFn = useServerFn(listSubjects);
  const chaptersFn = useServerFn(listChapters);

  const subjectsQ = useQuery({
    queryKey: ["subjects", level],
    queryFn: () => subjectsFn({ data: { level: level ?? undefined } }),
  });
  const { data: levelsList = [] } = useLevels();

  const chaptersQ = useQuery({
    queryKey: ["chapters", subjectId],
    queryFn: () => chaptersFn({ data: { subjectId: subjectId! } }),
    enabled: !!subjectId,
  });
  const wrongQ = useQuery({
    queryKey: ["mcq-wrong", { level, subjectId, chapterId }],
    queryFn: () =>
      listFn({
        data: {
          level: level ?? undefined,
          subjectId: subjectId ?? undefined,
          chapterId: chapterId ?? undefined,
        },
      }),
  });

  const items = useMemo(() => (wrongQ.data ?? []).filter((w) => !!w.mcq), [wrongQ.data]);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["mcq-wrong"] });
    qc.invalidateQueries({ queryKey: ["mcq-review-counts"] });
  }

  async function master(mcqId: string) {
    try {
      await masterFn({ data: { mcqIds: [mcqId] } });
      invalidateAll();
    } catch {
      /* silent */
    }
  }
  async function remove(mcqId: string) {
    try {
      await removeFn({ data: { mcqIds: [mcqId] } });
      invalidateAll();
    } catch {
      /* silent */
    }
  }

  return (
    <div className="space-y-5">
      <div className="glass shadow-card-soft rounded-3xl p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400">
            <XCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold">Wrong Questions</h2>
            <p className="text-xs text-muted-foreground">
              Review MCQs you answered incorrectly. Master them to remove from this list.
            </p>
          </div>
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-400">
            {items.length} pending
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <select
            value={level ?? ""}
            onChange={(e) => {
              setLevel(e.target.value || null);
              setSubjectId(null);
              setChapterId(null);
            }}
            className="glass rounded-xl px-3 py-2 text-xs"
          >
            <option value="">All levels</option>
            {levelsList.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>


          <select
            value={subjectId ?? ""}
            onChange={(e) => {
              setSubjectId(e.target.value || null);
              setChapterId(null);
            }}
            className="glass rounded-xl px-3 py-2 text-xs"
          >
            <option value="">All subjects</option>
            {(subjectsQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={chapterId ?? ""}
            onChange={(e) => setChapterId(e.target.value || null)}
            disabled={!subjectId}
            className="glass rounded-xl px-3 py-2 text-xs disabled:opacity-50"
          >
            <option value="">All chapters</option>
            {(chaptersQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="glass shadow-card-soft rounded-3xl p-5">
        {wrongQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-10 text-center text-sm text-muted-foreground">
            🎯 No wrong questions. Complete an MCQ practice to populate this list.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((w) => {
              const m = w.mcq!;
              const open = openId === m.id;
              const opts = [
                { k: "A", t: m.option_a },
                { k: "B", t: m.option_b },
                { k: "C", t: m.option_c },
                { k: "D", t: m.option_d },
              ];
              return (
                <li key={m.id} className="rounded-2xl border border-border bg-card/40 p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{m.question}</p>
                      <p className="mt-1 text-[10px] text-rose-400">
                        Your answer: <b>{w.last_chosen_option ?? "—"}</b> · Correct:{" "}
                        <b className="text-emerald-400">{w.correct_option ?? m.correct_option}</b>
                        {w.retry_count > 0 && (
                          <span className="ml-2 text-muted-foreground">· retried {w.retry_count}x</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => setOpenId(open ? null : m.id)}
                      className="glass rounded-lg px-2 py-1 text-xs"
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    <button
                      onClick={() => master(m.id)}
                      className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20"
                      title="Mark as mastered"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => remove(m.id)}
                      className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/20"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {open && (
                    <div className="animate-fade-up mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {opts.map((o) => {
                        const isCorrect = (w.correct_option ?? m.correct_option) === o.k;
                        const isPicked = w.last_chosen_option === o.k;
                        const tone = isCorrect
                          ? "border-emerald-400/60 bg-emerald-400/10"
                          : isPicked
                          ? "border-rose-400/60 bg-rose-400/10"
                          : "border-border bg-background/40";
                        return (
                          <div key={o.k} className={`rounded-xl border p-3 text-sm ${tone}`}>
                            <span className="mr-2 font-display font-bold">{o.k}.</span>
                            {o.t}
                            {isCorrect && (
                              <span className="ml-2 text-[10px] font-bold text-emerald-400">CORRECT</span>
                            )}
                            {isPicked && !isCorrect && (
                              <span className="ml-2 text-[10px] font-bold text-rose-400">YOUR PICK</span>
                            )}
                          </div>
                        );
                      })}
                      {m.explanation && (
                        <div className="rounded-xl border border-dashed border-border bg-background/30 p-3 text-xs text-muted-foreground sm:col-span-2">
                          <b className="text-foreground">Explanation: </b>{m.explanation}
                        </div>
                      )}
                      <div className="sm:col-span-2 flex justify-end">
                        <button
                          onClick={() => navigate({ to: "/mcq-practice" })}
                          className="bg-cta-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-glow"
                        >
                          <RotateCw className="h-3.5 w-3.5" /> Retry in Practice
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
