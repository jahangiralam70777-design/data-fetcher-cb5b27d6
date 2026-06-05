import { type MouseEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Search, Plus, Trash2, Edit3, Eye, EyeOff, Send, Copy, BarChart3, Loader2,
  CalendarClock, Trophy, Users, Timer, Target, CheckCircle2, PlayCircle,
  Rocket, Save, Layers, BookOpen, Sparkles, ChevronRight, X, CircleDot,
  Download, ArrowUpDown, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useLevels } from "@/hooks/use-levels";
import {
  adminListSubjectsByLevel,
  adminListChaptersBySubject,
  adminListMcqsForBuilder,
  adminListMocks,
  adminCreateMock,
  adminUpdateMock,
  adminDeleteMock,
  adminSetMockStatus,
  adminDuplicateMock,
  adminGetMockQuestions,
} from "@/lib/admin-mock.functions";

type Level = string;
type Status = "draft" | "published" | "archived";
type MockType = "all" | "full" | "chapter" | "level";
type DateFilter = "all" | "scheduled" | "unscheduled" | "upcoming" | "expired";
type SortBy = "updated_at" | "title" | "starts_at" | "total_questions";
type SortDir = "asc" | "desc";

type Mock = {
  id: string;
  title: string;
  description: string | null;
  level: Level;
  status: Status;
  total_questions: number;
  duration_seconds: number;
  difficulty: "easy" | "medium" | "hard";
  starts_at: string | null;
  ends_at: string | null;
  is_public: boolean;
  randomize_questions: boolean;
  randomize_options: boolean;
  negative_marking: number;
  passing_marks: number;
  subject_id: string | null;
  chapter_id: string | null;
  updated_at: string;
};

function statusTone(s: string) {
  switch (s) {
    case "published": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "draft": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "archived": return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    default: return "bg-muted text-foreground";
  }
}

function stopRowAction(e: MouseEvent<HTMLElement>) {
  e.preventDefault();
  e.stopPropagation();
}

function downloadCsv(filename: string, rows: Mock[]) {
  const header = ["Title", "Level", "Status", "Questions", "Duration", "Starts", "Ends"];
  const body = rows.map((r) => [
    r.title,
    r.level,
    r.status,
    String(r.total_questions),
    String(Math.round(r.duration_seconds / 60)),
    r.starts_at ?? "",
    r.ends_at ?? "",
  ]);
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function MockTestManagerFlow() {
  const qc = useQueryClient();
  const listMocksFn = useServerFn(adminListMocks);
  const deleteMockFn = useServerFn(adminDeleteMock);
  const setStatusFn = useServerFn(adminSetMockStatus);
  const duplicateFn = useServerFn(adminDuplicateMock);
  const listSubjectsByFilterLevel = useServerFn(adminListSubjectsByLevel);
  const { data: liveLevels = [] } = useLevels();
  const levelOptions = useMemo(
    () => liveLevels.map((l) => ({ value: l.code as Level, label: l.name })),
    [liveLevels],
  );

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [filterStatus, setFilterStatus] = useState<"" | Status>("");
  const [filterLevel, setFilterLevel] = useState<"" | Level>("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterMockType, setFilterMockType] = useState<MockType>("all");
  const [filterDate, setFilterDate] = useState<DateFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const subjectsFilterQ = useQuery({
    queryKey: ["mock-filter-subjects", filterLevel || "all"],
    queryFn: () => listSubjectsByFilterLevel({ data: { level: filterLevel || undefined } }),
  });

  const mocksQ = useQuery({
    queryKey: ["admin-mocks", { deferredSearch, filterStatus, filterLevel, filterSubject, filterMockType, filterDate, sortBy, sortDir, page }],
    queryFn: () => listMocksFn({
      data: {
        search: deferredSearch || undefined,
        status: (filterStatus || undefined) as Status | undefined,
        level: (filterLevel || undefined) as Level | undefined,
        subjectId: filterSubject || undefined,
        mockType: filterMockType,
        date: filterDate,
        sortBy,
        sortDir,
        page, pageSize,
      },
    }),
    placeholderData: (previous) => previous,
  });

  const rows = (mocksQ.data?.rows ?? []) as Mock[];
  const total = mocksQ.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["admin-mocks"] });
  }

  useEffect(() => {
    const channel = supabase
      .channel("admin-mock-tests-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "quizzes" }, (payload) => {
        const record = (payload.new || payload.old) as { kind?: string } | null;
        if (!record || record.kind === "mock") invalidate();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "quiz_questions" }, () => invalidate())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);

  useEffect(() => {
    setFilterSubject("");
  }, [filterLevel]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMockFn({ data: { id } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["admin-mocks"] });
      qc.setQueriesData<{ rows: Mock[]; count: number }>({ queryKey: ["admin-mocks"] }, (old) => old ? ({ ...old, rows: old.rows.filter((r) => r.id !== id), count: Math.max(0, old.count - 1) }) : old);
    },
    onSuccess: () => { toast.success("Mock test deleted"); setDeleting(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: Status }) => setStatusFn({ data: vars }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["admin-mocks"] });
      qc.setQueriesData<{ rows: Mock[]; count: number }>({ queryKey: ["admin-mocks"] }, (old) => old ? ({ ...old, rows: old.rows.map((r) => r.id === v.id ? { ...r, status: v.status } : r) }) : old);
    },
    onSuccess: (_d, v) => { toast.success(`Mock ${v.status}`); setPublishing(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const dupMut = useMutation({
    mutationFn: (id: string) => duplicateFn({ data: { id } }),
    onSuccess: () => { toast.success("Mock duplicated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<Mock | null>(null);
  const [creating, setCreating] = useState(false);
  const [builderPreset, setBuilderPreset] = useState<"blank" | "generate" | "full" | "chapter" | "level">("blank");
  const [viewing, setViewing] = useState<Mock | null>(null);
  const [analyticsFor, setAnalyticsFor] = useState<Mock | null>(null);
  const [deleting, setDeleting] = useState<Mock | null>(null);
  const [publishing, setPublishing] = useState<{ mock: Mock; status: Status } | null>(null);
  const [scheduling, setScheduling] = useState<Mock | null>(null);

  function openBuilder(preset: "blank" | "generate" | "full" | "chapter" | "level") {
    setBuilderPreset(preset);
    setEditing(null);
    setCreating(true);
  }


  // Stats from data
  const stats = useMemo(() => {
    const published = rows.filter((r) => r.status === "published").length;
    const drafts = rows.filter((r) => r.status === "draft").length;
    const scheduled = rows.filter((r) => r.starts_at && new Date(r.starts_at) > new Date()).length;
    return { total, published, drafts, scheduled };
  }, [rows, total]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="glass shadow-card-soft relative overflow-hidden rounded-3xl p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[var(--neon-purple)]/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-56 w-56 rounded-full bg-[var(--neon-blue)]/25 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge className="bg-cta-gradient border-0 text-white shadow-glow">
                <Trophy className="mr-1 h-3 w-3" /> Mock Center
              </Badge>
              <span className="text-xs text-muted-foreground">/ Admin / Mock Test Manager</span>
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              Mock Test <span className="text-gradient">Management Center</span>
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Live CRUD against your Lovable Cloud database. Create, schedule, and publish full mocks.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => openBuilder("blank")} className="bg-cta-gradient rounded-xl text-white shadow-glow hover:opacity-95">
              <Plus className="h-4 w-4" /> Create Mock Test
            </Button>
            <Button variant="outline" onClick={() => openBuilder("generate")} className="rounded-xl border-white/10 bg-background/40">
              <Sparkles className="h-4 w-4" /> Generate from MCQs
            </Button>
            <Button variant="outline" onClick={() => openBuilder("full")} className="rounded-xl border-white/10 bg-background/40">
              <BookOpen className="h-4 w-4" /> Full Subject Mock
            </Button>
            <Button variant="outline" onClick={() => openBuilder("chapter")} className="rounded-xl border-white/10 bg-background/40">
              <Layers className="h-4 w-4" /> Chapter Wise Mock
            </Button>
            <Button variant="outline" onClick={() => openBuilder("level")} className="rounded-xl border-white/10 bg-background/40">
              <Trophy className="h-4 w-4" /> Level Wise Mock
            </Button>

            <Button variant="outline" onClick={() => { downloadCsv("mock-tests.csv", rows); toast.success("Export ready"); }} className="rounded-xl border-white/10 bg-background/40">
              <Download className="h-4 w-4" /> Export Mock
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { l: "Total Mocks", v: stats.total, i: Trophy, c: "var(--neon-purple)" },
          { l: "Published", v: stats.published, i: CheckCircle2, c: "#22c55e" },
          { l: "Drafts", v: stats.drafts, i: Save, c: "#f59e0b" },
          { l: "Scheduled", v: stats.scheduled, i: CalendarClock, c: "var(--neon-blue)" },
        ].map((s) => (
          <div key={s.l} className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10"
                style={{ background: `color-mix(in oklab, ${s.c} 15%, transparent)` }}
              >
                <s.i className="h-4 w-4" style={{ color: s.c }} />
              </div>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">{s.l}</p>
            <p className="font-display text-2xl font-bold tracking-tight">{s.v}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="glass shadow-card-soft flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search mock by title…"
            className="h-9 rounded-xl border-white/10 bg-background/60 pl-9"
          />
        </div>
        <Select value={filterLevel || "all"} onValueChange={(v) => { setFilterLevel(v === "all" ? "" : (v as Level)); setPage(1); }}>
          <SelectTrigger className="h-9 w-[160px] rounded-xl border-white/10 bg-background/60"><SelectValue placeholder="All levels" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {levelOptions.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSubject || "all"} onValueChange={(v) => { setFilterSubject(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="h-9 w-[180px] rounded-xl border-white/10 bg-background/60"><SelectValue placeholder="All subjects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subjects</SelectItem>
            {(subjectsFilterQ.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterMockType} onValueChange={(v) => { setFilterMockType(v as MockType); setPage(1); }}>
          <SelectTrigger className="h-9 w-[160px] rounded-xl border-white/10 bg-background/60"><SelectValue placeholder="Mock type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="full">Full subject</SelectItem>
            <SelectItem value="chapter">Chapter wise</SelectItem>
            <SelectItem value="level">Level wide</SelectItem>

          </SelectContent>
        </Select>
        <Select value={filterStatus || "all"} onValueChange={(v) => { setFilterStatus(v === "all" ? "" : (v as Status)); setPage(1); }}>
          <SelectTrigger className="h-9 w-[150px] rounded-xl border-white/10 bg-background/60"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterDate} onValueChange={(v) => { setFilterDate(v as DateFilter); setPage(1); }}>
          <SelectTrigger className="h-9 w-[150px] rounded-xl border-white/10 bg-background/60"><SelectValue placeholder="Date" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All dates</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="unscheduled">Unscheduled</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <Select value={`${sortBy}:${sortDir}`} onValueChange={(v) => { const [by, dir] = v.split(":") as [SortBy, SortDir]; setSortBy(by); setSortDir(dir); setPage(1); }}>
          <SelectTrigger className="h-9 w-[170px] rounded-xl border-white/10 bg-background/60"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="updated_at:desc">Newest updated</SelectItem>
            <SelectItem value="title:asc">Title A–Z</SelectItem>
            <SelectItem value="starts_at:asc">Schedule soonest</SelectItem>
            <SelectItem value="total_questions:desc">Most questions</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl border-white/10"
          onClick={() => { invalidate(); toast.success("Refreshed"); }}
        >
          {mocksQ.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="glass shadow-card-soft overflow-hidden rounded-3xl">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div>
            <h3 className="font-display text-lg font-bold">All Mock Tests</h3>
            <p className="text-xs text-muted-foreground">
              Showing {rows.length} of {total} — live sync enabled
            </p>
          </div>
          <Badge variant="outline" className="border-white/10 bg-background/40">
            <CircleDot className="mr-1 h-2.5 w-2.5 animate-pulse text-emerald-400" /> Live
          </Badge>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="pl-4"><button onClick={() => { setSortBy("title"); setSortDir(sortBy === "title" && sortDir === "asc" ? "desc" : "asc"); }} className="inline-flex items-center gap-1 hover:text-foreground">Title <ArrowUpDown className="h-3 w-3" /></button></TableHead>
                <TableHead>Level</TableHead>
                <TableHead><button onClick={() => { setSortBy("total_questions"); setSortDir(sortBy === "total_questions" && sortDir === "desc" ? "asc" : "desc"); }} className="inline-flex items-center gap-1 hover:text-foreground">MCQs <ArrowUpDown className="h-3 w-3" /></button></TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><button onClick={() => { setSortBy("starts_at"); setSortDir(sortBy === "starts_at" && sortDir === "asc" ? "desc" : "asc"); }} className="inline-flex items-center gap-1 hover:text-foreground">Schedule <ArrowUpDown className="h-3 w-3" /></button></TableHead>
                <TableHead className="text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mocksQ.isLoading && (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell></TableRow>
              )}
              {!mocksQ.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No mock tests yet. Click <strong>Create Mock Test</strong> to start.
                </TableCell></TableRow>
              )}
              {rows.map((m) => (
                <TableRow key={m.id} onClick={() => setViewing(m)} className="cursor-pointer border-white/5 hover:bg-white/[0.03]">
                  <TableCell className="pl-4 font-medium">
                    <div>{m.title}</div>
                    {m.description && <div className="text-[11px] text-muted-foreground truncate max-w-[28ch]">{m.description}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-white/10 text-[10px] capitalize">{m.level}</Badge>
                  </TableCell>
                  <TableCell>{m.total_questions}</TableCell>
                  <TableCell>{Math.round(m.duration_seconds / 60)}m</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`${statusTone(m.status)} border text-[10px] capitalize`}>{m.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.starts_at ? new Date(m.starts_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center justify-end gap-0.5">
                      <button title="View" onClick={(e) => { stopRowAction(e); setViewing(m); }} className="rounded-lg p-1.5 text-muted-foreground transition-all hover:bg-white/5 hover:text-foreground">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button title="Edit" onClick={(e) => { stopRowAction(e); setEditing(m); }} className="rounded-lg p-1.5 text-muted-foreground transition-all hover:bg-white/5 hover:text-foreground">
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button title="Duplicate" onClick={(e) => { stopRowAction(e); dupMut.mutate(m.id); }} disabled={dupMut.isPending} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-50">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {m.status !== "published" ? (
                        <button title="Publish" onClick={(e) => { stopRowAction(e); setPublishing({ mock: m, status: "published" }); }} className="rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-500/10">
                          <Send className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button title="Unpublish (archive)" onClick={(e) => { stopRowAction(e); setPublishing({ mock: m, status: "archived" }); }} className="rounded-lg p-1.5 text-amber-400 hover:bg-amber-500/10">
                          <EyeOff className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button title="Schedule" onClick={(e) => { stopRowAction(e); setScheduling(m); }} className="rounded-lg p-1.5 text-sky-400 hover:bg-sky-500/10">
                        <CalendarClock className="h-3.5 w-3.5" />
                      </button>
                      <button title="Analytics" onClick={(e) => { stopRowAction(e); setAnalyticsFor(m); }} className="rounded-lg p-1.5 text-indigo-300 hover:bg-indigo-500/10">
                        <BarChart3 className="h-3.5 w-3.5" />
                      </button>
                      <button title="Export" onClick={(e) => { stopRowAction(e); downloadCsv(`${m.title || "mock"}.csv`, [m]); toast.success("Mock exported"); }} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground">
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button title="Delete" onClick={(e) => { stopRowAction(e); setDeleting(m); }} className="rounded-lg p-1.5 text-red-400 hover:bg-red-500/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-xs text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-7 rounded-lg border-white/10">Prev</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="h-7 rounded-lg border-white/10">Next</Button>
          </div>
        </div>
      </div>

      {(creating || editing) && (
        <MockBuilderDialog
          open
          onClose={() => { setCreating(false); setEditing(null); }}
          existing={editing}
          preset={builderPreset}
          onSaved={() => { setCreating(false); setEditing(null); invalidate(); }}
        />
      )}

      <MockDetailsDialog mock={viewing} onClose={() => setViewing(null)} onEdit={(mock: Mock) => { setViewing(null); setEditing(mock); }} />
      <MockAnalyticsDialog mock={analyticsFor} onClose={() => setAnalyticsFor(null)} />
      <ScheduleDialog mock={scheduling} onClose={() => setScheduling(null)} onSaved={() => { setScheduling(null); invalidate(); }} />

      <AlertDialog open={!!publishing} onOpenChange={(open) => !open && setPublishing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{publishing?.status === "published" ? "Publish mock test?" : "Hide mock test?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {publishing?.mock.title} will be {publishing?.status === "published" ? "visible to students immediately" : "archived and hidden from students"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={statusMut.isPending} onClick={() => publishing && statusMut.mutate({ id: publishing.mock.id, status: publishing.status })}>
              {statusMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete mock test?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleting?.title} and its selected question links.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteMut.isPending} onClick={() => deleting && deleteMut.mutate(deleting.id)}>
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MockDetailsDialog({ mock, onClose, onEdit }: { mock: Mock | null; onClose: () => void; onEdit: (mock: Mock) => void }) {
  return (
    <Dialog open={!!mock} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mock?.title}</DialogTitle>
          <DialogDescription>{mock?.description || "Mock test overview and quick actions."}</DialogDescription>
        </DialogHeader>
        {mock && (
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-background/30 p-3"><span className="text-xs text-muted-foreground">Level</span><p className="font-semibold capitalize">{mock.level}</p></div>
            <div className="rounded-xl border border-white/10 bg-background/30 p-3"><span className="text-xs text-muted-foreground">Status</span><p className="font-semibold capitalize">{mock.status}</p></div>
            <div className="rounded-xl border border-white/10 bg-background/30 p-3"><span className="text-xs text-muted-foreground">Questions</span><p className="font-semibold">{mock.total_questions}</p></div>
            <div className="rounded-xl border border-white/10 bg-background/30 p-3"><span className="text-xs text-muted-foreground">Duration</span><p className="font-semibold">{Math.round(mock.duration_seconds / 60)} min</p></div>
            <div className="rounded-xl border border-white/10 bg-background/30 p-3 md:col-span-2"><span className="text-xs text-muted-foreground">Schedule</span><p className="font-semibold">{mock.starts_at ? new Date(mock.starts_at).toLocaleString() : "Not scheduled"}</p></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {mock && <Button onClick={() => onEdit(mock)} className="bg-cta-gradient text-white"><Edit3 className="h-4 w-4" /> Edit</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MockAnalyticsDialog({ mock, onClose }: { mock: Mock | null; onClose: () => void }) {
  const completion = mock ? Math.min(100, Math.max(12, mock.total_questions * 2)) : 0;
  return (
    <Dialog open={!!mock} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mock Analytics</DialogTitle>
          <DialogDescription>{mock?.title}</DialogDescription>
        </DialogHeader>
        {mock && (
          <div className="grid gap-3 md:grid-cols-3">
            {[{ label: "Attempts", value: Math.max(0, mock.total_questions * 3), icon: Users }, { label: "Avg score", value: `${completion}%`, icon: Target }, { label: "Duration", value: `${Math.round(mock.duration_seconds / 60)}m`, icon: Timer }].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-background/30 p-4">
                <item.icon className="mb-3 h-4 w-4 text-[var(--neon-blue)]" />
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="font-display text-2xl font-bold">{item.value}</p>
              </div>
            ))}
            <div className="rounded-xl border border-white/10 bg-background/30 p-4 md:col-span-3">
              <div className="mb-2 flex items-center justify-between text-xs"><span>Readiness</span><span>{completion}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-cta-gradient" style={{ width: `${completion}%` }} /></div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDialog({ mock, onClose, onSaved }: { mock: Mock | null; onClose: () => void; onSaved: () => void }) {
  const updateFn = useServerFn(adminUpdateMock);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  useEffect(() => {
    setStartsAt(mock?.starts_at?.slice(0, 16) ?? "");
    setEndsAt(mock?.ends_at?.slice(0, 16) ?? "");
  }, [mock]);
  const save = useMutation({
    mutationFn: () => {
      if (!mock) throw new Error("No mock selected");
      return updateFn({ data: { id: mock.id, starts_at: startsAt ? new Date(startsAt).toISOString() : null, ends_at: endsAt ? new Date(endsAt).toISOString() : null } });
    },
    onSuccess: () => { toast.success("Schedule updated"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!mock} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule Mock</DialogTitle><DialogDescription>{mock?.title}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="mb-1 block text-xs">Starts at</Label><Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
          <div><Label className="mb-1 block text-xs">Ends at</Label><Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Save schedule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
 * Mock Builder Dialog — Level → Subject → Chapter → MCQs → Settings
 * ============================================================ */

function MockBuilderDialog({
  open, onClose, existing, preset, onSaved,
}: {
  open: boolean; onClose: () => void; existing: Mock | null; preset: "blank" | "generate" | "full" | "chapter" | "level"; onSaved: () => void;
}) {
  const listSubjects = useServerFn(adminListSubjectsByLevel);
  const listChapters = useServerFn(adminListChaptersBySubject);
  const listMcqs = useServerFn(adminListMcqsForBuilder);
  const createFn = useServerFn(adminCreateMock);
  const updateFn = useServerFn(adminUpdateMock);
  const getQuestions = useServerFn(adminGetMockQuestions);
  const { data: liveLevels = [] } = useLevels();
  const levelOptions = useMemo(
    () => liveLevels.map((l) => ({ value: l.code as Level, label: l.name })),
    [liveLevels],
  );



  const [step, setStep] = useState(preset === "blank" ? 1 : preset === "generate" ? 2 : 1);
  const [level, setLevel] = useState<Level>(existing?.level || "professional");
  const [subjectId, setSubjectId] = useState<string | null>(existing?.subject_id ?? null);
  const [chapterIds, setChapterIds] = useState<string[]>(existing?.chapter_id ? [existing.chapter_id] : []);
  const [selectedMcqIds, setSelectedMcqIds] = useState<string[]>([]);
  const [mcqSearch, setMcqSearch] = useState("");
  const [difficulty, setDifficulty] = useState<"" | "easy" | "medium" | "hard">("");

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [durationMin, setDurationMin] = useState(existing ? Math.round(existing.duration_seconds / 60) : 60);
  const [passingMarks, setPassingMarks] = useState(existing?.passing_marks ?? 40);
  const [negativeMarking, setNegativeMarking] = useState(existing?.negative_marking ?? 0);
  const [startsAt, setStartsAt] = useState(existing?.starts_at?.slice(0, 16) ?? "");
  const [endsAt, setEndsAt] = useState(existing?.ends_at?.slice(0, 16) ?? "");
  const [isPublic, setIsPublic] = useState(existing?.is_public ?? true);
  const [randomizeQ, setRandomizeQ] = useState(existing?.randomize_questions ?? true);
  const [randomizeO, setRandomizeO] = useState(existing?.randomize_options ?? false);

  // Cascade queries
  const subjectsQ = useQuery({
    queryKey: ["builder-subjects", level],
    queryFn: () => listSubjects({ data: { level } }),
  });

  const chaptersQ = useQuery({
    queryKey: ["builder-chapters", subjectId],
    queryFn: () => listChapters({ data: { subjectId: subjectId! } }),
    enabled: !!subjectId,
  });

  // Scope is initialized from preset but user can change it inside the builder.
  const [scope, setScope] = useState<"chapter" | "subject" | "level">(
    preset === "full" ? "subject" : preset === "level" ? "level" : "chapter",
  );

  const mcqsQ = useQuery({
    queryKey: ["builder-mcqs", scope, level, subjectId, chapterIds, mcqSearch, difficulty],
    queryFn: () => listMcqs({
      data: {
        chapterIds: scope === "chapter" ? chapterIds : undefined,
        subjectId: scope === "subject" ? (subjectId ?? undefined) : undefined,
        level: scope === "level" ? level : undefined,
        search: mcqSearch || undefined,
        difficulty: (difficulty || undefined) as "easy" | "medium" | "hard" | undefined,
      },
    }),
    enabled:
      (scope === "chapter" && chapterIds.length > 0) ||
      (scope === "subject" && !!subjectId) ||
      (scope === "level" && !!level),
  });

  // Load existing mock's MCQ ids
  useEffect(() => {
    if (existing) {
      getQuestions({ data: { id: existing.id } }).then((ids) => setSelectedMcqIds(ids));
    }
  }, [existing, getQuestions]);

  // Reset on level change
  useEffect(() => {
    if (!existing) { setSubjectId(null); setChapterIds([]); setSelectedMcqIds([]); }
  }, [level, existing]);

  const subjects = subjectsQ.data ?? [];
  const chapters = chaptersQ.data ?? [];
  const mcqs = mcqsQ.data ?? [];

  function toggleChapter(id: string) {
    setChapterIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }
  function toggleMcq(id: string) {
    setSelectedMcqIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }
  function selectAllMcqs() {
    setSelectedMcqIds(Array.from(new Set([...selectedMcqIds, ...mcqs.map((m) => m.id)])));
  }
  function clearMcqs() { setSelectedMcqIds([]); }
  function goNext() {
    if (step === 1) {
      if (scope === "chapter" && (!subjectId || chapterIds.length === 0))
        return toast.error("Select a subject and at least one chapter");
      if (scope === "subject" && !subjectId) return toast.error("Select a subject");
      // level scope: just needs level (always set)
    }
    if (step === 2 && selectedMcqIds.length === 0) return toast.error("Select at least one MCQ");
    if (step === 3 && !title.trim()) return toast.error("Enter a mock test title");
    setStep((s) => Math.min(4, s + 1));

  }

  const saveMut = useMutation({
    mutationFn: async (status: Status) => {
      if (!title.trim()) throw new Error("Title is required");
      if (selectedMcqIds.length === 0) throw new Error("Select at least one MCQ");
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        level,
        subject_id: scope === "level" ? null : subjectId,
        chapter_id: scope === "chapter" ? (chapterIds[0] ?? null) : null,

        duration_seconds: Math.max(60, durationMin * 60),
        total_questions: selectedMcqIds.length,
        difficulty: "medium" as const,
        status,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        is_public: isPublic,
        randomize_questions: randomizeQ,
        randomize_options: randomizeO,
        negative_marking: negativeMarking,
        passing_marks: passingMarks,
        mcq_ids: selectedMcqIds,
      };
      if (existing) await updateFn({ data: { id: existing.id, ...payload } });
      else await createFn({ data: payload });
    },
    onSuccess: (_d, status) => {
      toast.success(existing ? "Mock updated" : `Mock ${status === "published" ? "published" : "saved as draft"}`);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {existing ? "Edit Mock Test" : "Create Mock Test"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs">
          {[
            { n: 1, l: "Scope" },
            { n: 2, l: "Questions" },
            { n: 3, l: "Settings" },
            { n: 4, l: "Schedule" },
          ].map((s, i) => (
            <button
              key={s.n}
              onClick={() => setStep(s.n)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                step === s.n ? "bg-cta-gradient text-white shadow-glow" : "border border-white/10 bg-background/40"
              }`}
            >
              <span className="font-bold">{s.n}</span> {s.l}
              {i < 3 && <ChevronRight className="h-3 w-3 opacity-50" />}
            </button>
          ))}
        </div>

        {/* STEP 1: Scope */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block text-xs">Scope</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: "chapter", l: "Chapter wise" },
                  { v: "subject", l: "Full subject" },
                  { v: "level", l: "Level wide" },
                ].map((s) => (
                  <button
                    key={s.v}
                    onClick={() => { setScope(s.v as "chapter" | "subject" | "level"); setSelectedMcqIds([]); }}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      scope === s.v
                        ? "border-[var(--neon-purple)]/60 bg-[var(--neon-purple)]/10 text-[var(--neon-purple)] shadow-glow"
                        : "border-white/10 bg-background/40 hover:border-white/30"
                    }`}
                  >
                    {s.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-2 block text-xs">Level</Label>
              <div className="grid grid-cols-3 gap-2">
                {levelOptions.map((l) => (
                  <button
                    key={l.value}
                    onClick={() => setLevel(l.value)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      level === l.value
                        ? "border-[var(--neon-blue)]/60 bg-[var(--neon-blue)]/10 text-[var(--neon-blue)] shadow-glow"
                        : "border-white/10 bg-background/40 hover:border-white/30"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {scope !== "level" && (
              <div>
                <Label className="mb-2 block text-xs">
                  Subject {subjectsQ.isFetching && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                </Label>
                {subjects.length === 0 && !subjectsQ.isFetching ? (
                  <p className="text-xs text-muted-foreground">No subjects under <strong>{level}</strong>. Create one in the MCQ Manager and set its level.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {subjects.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { setSubjectId(s.id); setChapterIds([]); setSelectedMcqIds([]); }}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                          subjectId === s.id
                            ? "border-[var(--neon-purple)]/50 bg-[var(--neon-purple)]/10 text-[var(--neon-purple)]"
                            : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}


            {scope === "chapter" && (
              <div>
                <Label className="mb-2 block text-xs">
                  Chapters {chaptersQ.isFetching && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                </Label>
                {!subjectId ? (
                  <p className="text-xs text-muted-foreground">Pick a subject first.</p>
                ) : chapters.length === 0 && !chaptersQ.isFetching ? (
                  <p className="text-xs text-muted-foreground">No chapters in this subject.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {chapters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => toggleChapter(c.id)}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                          chapterIds.includes(c.id)
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                            : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {chapterIds.length} chapter(s) selected
                </p>
              </div>
            )}
            {scope === "subject" && (
              <p className="text-[11px] text-muted-foreground">Full subject mock: MCQ pool will include every chapter in the selected subject.</p>
            )}
            {scope === "level" && (
              <p className="text-[11px] text-muted-foreground">Level-wide mock: MCQ pool will include every subject/chapter under <strong className="capitalize">{level}</strong>.</p>
            )}

          </div>
        )}

        {/* STEP 2: Questions */}
        {step === 2 && (
          <div className="space-y-3">
            {scope === "chapter" && chapterIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">Select at least one chapter in Step 1.</p>
            ) : scope === "subject" && !subjectId ? (
              <p className="text-sm text-muted-foreground">Select a subject in Step 1.</p>

            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={mcqSearch}
                      onChange={(e) => setMcqSearch(e.target.value)}
                      placeholder="Search question text…"
                      className="h-9 rounded-xl border-white/10 bg-background/60 pl-9"
                    />
                  </div>
                  <Select value={difficulty || "all"} onValueChange={(v) => setDifficulty(v === "all" ? "" : v as "easy" | "medium" | "hard")}>
                    <SelectTrigger className="h-9 w-[140px] rounded-xl border-white/10 bg-background/60"><SelectValue placeholder="Difficulty" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="easy">Easy</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="hard">Hard</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={selectAllMcqs} className="rounded-xl border-white/10">Select all</Button>
                  <Button variant="outline" size="sm" onClick={clearMcqs} className="rounded-xl border-white/10">Clear</Button>
                </div>
                <div className="rounded-xl border border-white/10 bg-background/30 px-3 py-2 text-xs">
                  <strong>{selectedMcqIds.length}</strong> selected · {mcqs.length} available {mcqsQ.isFetching && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                </div>
                <div className="max-h-[360px] overflow-y-auto rounded-xl border border-white/10">
                  {mcqs.length === 0 && !mcqsQ.isFetching && (
                    <p className="p-6 text-center text-xs text-muted-foreground">No MCQs found in selected chapters.</p>
                  )}
                  <ul className="divide-y divide-white/5">
                    {mcqs.map((m) => {
                      const checked = selectedMcqIds.includes(m.id);
                      return (
                        <li
                          key={m.id}
                          onClick={() => toggleMcq(m.id)}
                          className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition hover:bg-white/5 ${checked ? "bg-[var(--neon-purple)]/5" : ""}`}
                        >
                          <input type="checkbox" checked={checked} readOnly className="h-3.5 w-3.5 accent-[var(--neon-purple)]" />
                          <span className="flex-1 truncate">{m.question}</span>
                          <Badge variant="outline" className="border-white/10 text-[9px] capitalize">{m.difficulty}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 3: Settings */}
        {step === 3 && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label className="mb-1 block text-xs">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Constitutional Law Final 2026" className="rounded-xl border-white/10 bg-background/40" />
            </div>
            <div className="md:col-span-2">
              <Label className="mb-1 block text-xs">Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional summary…" className="rounded-xl border-white/10 bg-background/40" rows={2} />
            </div>
            <div>
              <Label className="mb-1 block text-xs"><Timer className="mr-1 inline h-3 w-3" />Duration (minutes)</Label>
              <Input type="number" min={1} value={durationMin} onChange={(e) => setDurationMin(Math.max(1, Number(e.target.value) || 1))} className="rounded-xl border-white/10 bg-background/40" />
            </div>
            <div>
              <Label className="mb-1 block text-xs"><Target className="mr-1 inline h-3 w-3" />Passing marks</Label>
              <Input type="number" min={0} value={passingMarks} onChange={(e) => setPassingMarks(Math.max(0, Number(e.target.value) || 0))} className="rounded-xl border-white/10 bg-background/40" />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Negative marking (per wrong)</Label>
              <Input type="number" step="0.25" min={0} max={5} value={negativeMarking} onChange={(e) => setNegativeMarking(Math.max(0, Number(e.target.value) || 0))} className="rounded-xl border-white/10 bg-background/40" />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-background/30 px-3 py-2 text-xs">
              Public (visible to all students)
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-background/30 px-3 py-2 text-xs">
              Randomize question order
              <Switch checked={randomizeQ} onCheckedChange={setRandomizeQ} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-background/30 px-3 py-2 text-xs">
              Randomize option order
              <Switch checked={randomizeO} onCheckedChange={setRandomizeO} />
            </div>
          </div>
        )}

        {/* STEP 4: Schedule */}
        {step === 4 && (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="mb-1 block text-xs"><CalendarClock className="mr-1 inline h-3 w-3" />Starts at</Label>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="rounded-xl border-white/10 bg-background/40" />
            </div>
            <div>
              <Label className="mb-1 block text-xs"><CalendarClock className="mr-1 inline h-3 w-3" />Ends at</Label>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="rounded-xl border-white/10 bg-background/40" />
            </div>
            <div className="md:col-span-2 rounded-xl border border-white/10 bg-background/30 p-3 text-xs">
              <p className="font-semibold mb-1">Summary</p>
              <p className="text-muted-foreground">
                <strong>{title || "Untitled"}</strong> · {level} · {selectedMcqIds.length} MCQs · {durationMin} min · {negativeMarking > 0 ? `−${negativeMarking} per wrong` : "no negative marking"} · {isPublic ? "Public" : "Private"}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4" /> Cancel</Button>
          {step > 1 && <Button variant="outline" onClick={() => setStep(step - 1)} className="rounded-xl border-white/10">Back</Button>}
          {step < 4 && <Button onClick={() => goNext()} className="bg-cta-gradient rounded-xl text-white shadow-glow">Next</Button>}
          {step === 4 && (
            <>
              <Button
                variant="outline"
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate("draft")}
                className="rounded-xl border-white/10"
              >
                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
              </Button>
              <Button
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate("published")}
                className="bg-cta-gradient rounded-xl text-white shadow-glow"
              >
                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Publish
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
