/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck, RefreshCw, X, CheckCircle2, XCircle, Clock, Replace } from "lucide-react";
import {
  adminListQuizSessions,
  adminQuizSessionStats,
  adminGetQuizSessionDetail,
  adminReplaceQuizSessionQuestion,
  adminRegenerateQuizSession,
  adminApproveQuizSession,
  adminRejectQuizSession,
} from "@/lib/admin-quiz-session.functions";

const TABS: Array<{ key: any; label: string }> = [
  { key: "pending_review", label: "Pending" },
  { key: "ready", label: "Ready" },
  { key: "in_progress", label: "In Progress" },
  { key: "submitted", label: "Submitted" },
  { key: "all", label: "All" },
];

export function QuizReviewQueueFlow() {
  const [tab, setTab] = useState<string>("pending_review");
  const [openId, setOpenId] = useState<string | null>(null);

  const listFn = useServerFn(adminListQuizSessions);
  const statsFn = useServerFn(adminQuizSessionStats);
  const qc = useQueryClient();

  const stats = useQuery({ queryKey: ["admin-quiz-session-stats"], queryFn: () => statsFn(), staleTime: 10_000 });
  const list = useQuery({
    queryKey: ["admin-quiz-sessions", tab],
    queryFn: () => listFn({ data: { status: tab as any, page: 1, pageSize: 50 } }),
    refetchInterval: 8000,
  });

  return (
    <div className="space-y-6">
      <header className="glass-card rounded-3xl p-6">
        <div className="flex items-center gap-3">
          <div className="bg-cta-gradient flex h-10 w-10 items-center justify-center rounded-xl shadow-glow">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight">Quiz Review Queue</h1>
            <p className="text-sm text-muted-foreground">
              Approve, edit, or regenerate auto-generated student quiz sessions before they start.
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Pending" value={stats.data?.pending ?? 0} tone="bg-amber-500/15 text-amber-300" />
          <StatCard label="Ready" value={stats.data?.ready ?? 0} tone="bg-emerald-500/15 text-emerald-300" />
          <StatCard label="In Progress" value={stats.data?.inProgress ?? 0} tone="bg-blue-500/15 text-blue-300" />
          <StatCard label="Submitted 24h" value={stats.data?.submittedToday ?? 0} tone="bg-violet-500/15 text-violet-300" />
        </div>
      </header>

      <div className="glass-card rounded-3xl p-4">
        <div className="flex flex-wrap gap-2 border-b border-border/40 pb-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                tab === t.key ? "bg-cta-gradient text-white shadow-glow" : "bg-muted/40 text-foreground/80 hover:bg-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {list.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : (list.data?.rows ?? []).length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No sessions in this tab.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {(list.data?.rows ?? []).map((r: any) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.student?.display_name || r.student?.email || r.user_id.slice(0, 8)}
                    <span className="ml-2 text-xs text-muted-foreground">· {r.chapter?.name || "Chapter"}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.question_count} Qs · {Math.round((r.duration_seconds ?? 600) / 60)}m · {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.score != null && (
                    <span className="text-xs font-semibold">{r.score}/{r.question_count}</span>
                  )}
                  <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase">{r.status.replace("_", " ")}</span>
                  <button
                    onClick={() => setOpenId(r.id)}
                    className="rounded-xl bg-cta-gradient px-3 py-1.5 text-xs font-semibold text-white shadow-glow"
                  >
                    Review
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openId && (
        <ReviewDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["admin-quiz-sessions"] });
            qc.invalidateQueries({ queryKey: ["admin-quiz-session-stats"] });
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${tone}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest">{label}</p>
      <p className="mt-0.5 text-2xl font-bold">{value}</p>
    </div>
  );
}

function ReviewDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detailFn = useServerFn(adminGetQuizSessionDetail);
  const replaceFn = useServerFn(adminReplaceQuizSessionQuestion);
  const regenFn = useServerFn(adminRegenerateQuizSession);
  const approveFn = useServerFn(adminApproveQuizSession);
  const rejectFn = useServerFn(adminRejectQuizSession);
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["admin-quiz-session-detail", id],
    queryFn: () => detailFn({ data: { id } }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-quiz-session-detail", id] });
    onChanged();
  };

  const regen = useMutation({
    mutationFn: () => regenFn({ data: { sessionId: id } }),
    onSuccess: () => { toast.success("Regenerated"); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const replace = useMutation({
    mutationFn: (v: { oldMcqId: string; newMcqId: string }) => replaceFn({ data: { sessionId: id, ...v } }),
    onSuccess: () => { toast.success("Replaced"); refresh(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const approve = useMutation({
    mutationFn: () => approveFn({ data: { sessionId: id } }),
    onSuccess: () => { toast.success("Approved — student can start"); refresh(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const reject = useMutation({
    mutationFn: (reason: string) => rejectFn({ data: { sessionId: id, reason } }),
    onSuccess: () => { toast.success("Rejected"); refresh(); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const d = (detail.data ?? {}) as any;
  const s = d.session;
  const mcqs = (d.mcqs ?? []) as any[];
  const pool = (d.pool ?? []) as any[];
  const isPending = s?.status === "pending_review";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <aside className="glass relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold">Review Session</h3>
            <p className="truncate text-xs text-muted-foreground">
              {d.student?.display_name || d.student?.email || s?.user_id?.slice(0, 8)} · {d.chapter?.name || "Chapter"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {detail.isLoading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="flex items-center justify-between rounded-2xl bg-muted/30 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  <Clock className="mr-1 inline h-3 w-3" />
                  {mcqs.length} questions · {Math.round((s?.duration_seconds ?? 600) / 60)} min
                </p>
                {isPending && (
                  <button
                    onClick={() => regen.mutate()}
                    disabled={regen.isPending}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/80"
                  >
                    {regen.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Regenerate all
                  </button>
                )}
              </div>

              <ol className="space-y-3">
                {mcqs.map((m, i) => (
                  <li key={m.id} className="rounded-2xl border border-border/40 bg-muted/20 p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-muted text-[10px] font-bold">{i + 1}</span>
                      <p className="flex-1 text-sm">{m.question}</p>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                      {["a", "b", "c", "d"].map((k) => {
                        const isCorrect = (m.correct_option || "").toLowerCase() === k;
                        return (
                          <div key={k} className={`rounded-lg px-2 py-1 ${isCorrect ? "bg-emerald-500/15 text-emerald-200" : "bg-muted/30"}`}>
                            <b>{k.toUpperCase()}.</b> {m[`option_${k}`]}
                          </div>
                        );
                      })}
                    </div>
                    {isPending && (
                      <div className="mt-2 flex items-center gap-2">
                        <Replace className="h-3 w-3 text-muted-foreground" />
                        <select
                          className="flex-1 rounded-lg bg-muted px-2 py-1 text-xs"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) replace.mutate({ oldMcqId: m.id, newMcqId: e.target.value });
                            e.currentTarget.value = "";
                          }}
                        >
                          <option value="">Replace with…</option>
                          {pool
                            .filter((p) => !mcqs.some((mm) => mm.id === p.id))
                            .slice(0, 200)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {(p.question || "").slice(0, 80)}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        {isPending && (
          <div className="flex items-center gap-2 border-t border-border/40 px-5 py-4">
            <button
              onClick={() => {
                const reason = prompt("Reject reason?") || undefined;
                if (reason !== null) reject.mutate(reason || "");
              }}
              disabled={reject.isPending}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-500/15 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/25"
            >
              <XCircle className="h-4 w-4" /> Reject
            </button>
            <button
              onClick={() => approve.mutate()}
              disabled={approve.isPending}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cta-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-glow disabled:opacity-50"
            >
              {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve & Release
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
