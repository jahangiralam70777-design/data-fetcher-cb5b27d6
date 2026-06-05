import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useServerFn } from "@tanstack/react-start";
import {
  Search, Users, UserPlus, UserX, Crown, ShieldCheck, Activity,
  TrendingUp, Filter, Loader2, X, Save, Edit3, Eye,
  Sparkles, CircleDot, CheckCircle2, Pause, Play,
  Trash2, RotateCcw, Clock, LogIn, Monitor, AlertTriangle, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  adminListUsers, adminUserStats, adminSetUserStatus, adminSetUserRole, adminUpdateUserProfile,
  adminReferralStats, adminUserAnalytics, adminTopUsers, adminUserSessions,
  adminSoftDeleteUser, adminRestoreUser, adminHardDeleteUser,
} from "@/lib/admin-users.functions";
import { adminListLevels } from "@/lib/admin-mcq.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type User = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  level: string;
  bio: string | null;
  status: "active" | "suspended" | "pending";
  referral_source: string | null;
  created_at: string;
  updated_at: string;
  roles: string[];
  last_login_at: string | null;
  total_login_count: number;
  total_usage_seconds: number;
  deleted_at: string | null;
};

const REFERRAL_OPTIONS = [
  "Facebook",
  "YouTube",
  "Friend/Referral",
  "Teacher",
  "Google Search",
  "WhatsApp",
  "Instagram",
  "Other",
] as const;

const STATUS_TONE: Record<string, string> = {
  active: "border-emerald-400/40 bg-emerald-500/10 text-emerald-400",
  pending: "border-amber-400/40 bg-amber-500/10 text-amber-400",
  suspended: "border-rose-400/40 bg-rose-500/10 text-rose-400",
  deleted: "border-zinc-400/40 bg-zinc-500/10 text-zinc-400",
};

function fmtDuration(seconds: number) {
  if (!seconds || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

function parseDevice(ua: string | null | undefined) {
  const s = ua ?? "";
  if (!s) return "—";
  let browser = "Unknown";
  if (/Edg\//.test(s)) browser = "Edge";
  else if (/Chrome\//.test(s)) browser = "Chrome";
  else if (/Safari\//.test(s)) browser = "Safari";
  else if (/Firefox\//.test(s)) browser = "Firefox";
  const device = /Mobile|Android|iPhone/.test(s) ? "Mobile" : /iPad|Tablet/.test(s) ? "Tablet" : "Desktop";
  return `${browser} · ${device}`;
}

export function UserManagementFlow() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListUsers);
  const statsFn = useServerFn(adminUserStats);
  const referralFn = useServerFn(adminReferralStats);
  const statusFn = useServerFn(adminSetUserStatus);
  const levelsFn = useServerFn(adminListLevels);
  const analyticsFn = useServerFn(adminUserAnalytics);
  const topFn = useServerFn(adminTopUsers);
  const softDeleteFn = useServerFn(adminSoftDeleteUser);
  const restoreFn = useServerFn(adminRestoreUser);
  const hardDeleteFn = useServerFn(adminHardDeleteUser);

  const [search, setSearch] = useState("");
  const [role, setRole] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [level, setLevel] = useState<string>("all");
  const [referralFilter, setReferralFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("lifetime");

  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<User | null>(null);
  const [viewing, setViewing] = useState<User | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ user: User; mode: "soft" | "hard" } | null>(null);

  // realtime
  useEffect(() => {
    const ch = supabase
      .channel("users-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-users"] });
        qc.invalidateQueries({ queryKey: ["admin-user-stats"] });
        qc.invalidateQueries({ queryKey: ["admin-referral-stats"] });
        qc.invalidateQueries({ queryKey: ["admin-user-analytics"] });
        qc.invalidateQueries({ queryKey: ["admin-top-users"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-users"] });
        qc.invalidateQueries({ queryKey: ["admin-user-stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_login_events" }, () => {
        qc.invalidateQueries({ queryKey: ["admin-user-analytics"] });
        qc.invalidateQueries({ queryKey: ["admin-top-users"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const stats = useQuery({ queryKey: ["admin-user-stats"], queryFn: () => statsFn() });
  const analytics = useQuery({ queryKey: ["admin-user-analytics"], queryFn: () => analyticsFn(), staleTime: 15_000 });
  const topMost = useQuery({ queryKey: ["admin-top-users", "most"], queryFn: () => topFn({ data: { order: "most", limit: 10 } }), staleTime: 30_000 });
  const topLeast = useQuery({ queryKey: ["admin-top-users", "least"], queryFn: () => topFn({ data: { order: "least", limit: 10 } }), staleTime: 30_000 });
  const referralStats = useQuery({ queryKey: ["admin-referral-stats"], queryFn: () => referralFn() });
  const levels = useQuery({ queryKey: ["admin-levels"], queryFn: () => levelsFn() });
  const debouncedSearch = useDebouncedValue(search, 300);
  const list = useQuery({
    queryKey: ["admin-users", { search: debouncedSearch, role, status, level, referralFilter, dateRange, page }],
    queryFn: () => listFn({
      data: {
        search: debouncedSearch || undefined,
        role: role === "all" ? undefined : (role as "admin" | "moderator" | "student"),
        status: status === "all" ? undefined : (status as "active" | "suspended" | "pending" | "deleted"),
        level: level === "all" ? undefined : level,
        referralSource: referralFilter === "all" ? undefined : referralFilter,
        dateRange: dateRange === "lifetime" ? undefined : (dateRange as "24h" | "7d" | "30d"),
        page, pageSize: 25,
      },
    }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-user-stats"] });
    qc.invalidateQueries({ queryKey: ["admin-user-analytics"] });
    qc.invalidateQueries({ queryKey: ["admin-top-users"] });
  };

  const statusM = useMutation({
    mutationFn: (v: { id: string; status: User["status"] }) => statusFn({ data: v }),
    onSuccess: (_d, v) => { toast.success(`User ${v.status}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const softDeleteM = useMutation({
    mutationFn: (id: string) => softDeleteFn({ data: { id } }),
    onSuccess: () => { toast.success("User removed (archived)"); invalidate(); setConfirmDelete(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreM = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () => { toast.success("User restored"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const hardDeleteM = useMutation({
    mutationFn: (v: { id: string; confirmName: string }) => hardDeleteFn({ data: v }),
    onSuccess: () => { toast.success("User permanently deleted"); invalidate(); setConfirmDelete(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (list.data?.rows ?? []) as User[];
  const total = list.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));
  const a = analytics.data;

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <section className="glass shadow-card-soft relative overflow-hidden rounded-3xl p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-[var(--neon-purple)]/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <Badge className="bg-cta-gradient border-0 text-white shadow-glow">
              <Sparkles className="mr-1 h-3 w-3" /> Advanced Control Center
            </Badge>
            <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
              User <span className="text-gradient">Management</span>
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Track every user activity, monitor usage, manage students, and view deep analytics — realtime.
            </p>
          </div>
        </div>
      </section>

      {/* Live analytics cards */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          { l: "Total Users", v: a?.total_users ?? stats.data?.total ?? 0, i: Users, c: "#a855f7" },
          { l: "Active 24h", v: a?.active_24h ?? 0, i: Activity, c: "#22d3ee" },
          { l: "Active 7d", v: a?.active_7d ?? 0, i: TrendingUp, c: "#34d399" },
          { l: "Active 30d", v: a?.active_30d ?? 0, i: BarChart3, c: "#fbbf24" },
          { l: "Lifetime Active", v: a?.lifetime_active ?? 0, i: CheckCircle2, c: "#60a5fa" },
          { l: "Total Logins", v: a?.total_logins ?? 0, i: LogIn, c: "#f472b6" },
        ].map(({ l, v, i: Icon, c }) => (
          <div key={l} className="glass shadow-card-soft rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${c}22`, color: c }}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 font-display text-2xl font-bold tracking-tight">{v.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{l}</p>
          </div>
        ))}
      </section>

      {/* Usage panels */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="glass shadow-card-soft rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--neon-blue)]" />
            <h3 className="font-display text-sm font-bold tracking-tight">Platform usage</h3>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { l: "Last 24h", v: a?.usage_24h ?? 0 },
              { l: "Last 7d", v: a?.usage_7d ?? 0 },
              { l: "Last 30d", v: a?.usage_30d ?? 0 },
            ].map((x) => (
              <div key={x.l} className="rounded-xl border border-border/40 bg-background/40 p-3">
                <p className="font-display text-lg font-bold">{fmtDuration(x.v)}</p>
                <p className="text-[10px] text-muted-foreground">{x.l}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-border/40 bg-background/40 p-3 text-center">
            <p className="font-display text-base font-bold">{fmtDuration(a?.avg_session_seconds ?? 0)}</p>
            <p className="text-[10px] text-muted-foreground">Average session per login</p>
          </div>
        </div>

        <div className="glass shadow-card-soft rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <h3 className="font-display text-sm font-bold tracking-tight">Top 10 most active</h3>
          </div>
          <ul className="space-y-1.5 text-xs">
            {(topMost.data ?? []).length === 0 && (
              <li className="text-muted-foreground">No activity recorded yet.</li>
            )}
            {(topMost.data ?? []).map((u, i) => (
              <li key={u.user_id} className="flex items-center justify-between rounded-lg border border-border/30 bg-background/40 px-2 py-1.5">
                <span className="flex items-center gap-2">
                  <span className="w-4 text-[10px] text-muted-foreground">{i + 1}.</span>
                  <span className="truncate">{u.display_name}</span>
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">{u.total_login_count} · {fmtDuration(u.total_usage_seconds)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Least active */}
      <section className="glass shadow-card-soft rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <UserX className="h-4 w-4 text-amber-400" />
          <h3 className="font-display text-sm font-bold tracking-tight">Least active users</h3>
        </div>
        <div className="grid gap-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {(topLeast.data ?? []).map((u) => (
            <div key={u.user_id} className="flex items-center justify-between rounded-lg border border-border/30 bg-background/40 px-2 py-1.5">
              <span className="truncate">{u.display_name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{fmtDuration(u.total_usage_seconds)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Filters */}
      <section className="glass shadow-card-soft rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search users by name…"
              className="h-9 rounded-xl pl-9"
            />
          </div>
          <Select value={dateRange} onValueChange={(v) => { setDateRange(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Date range" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lifetime">Lifetime</SelectItem>
              <SelectItem value="24h">Active 24h</SelectItem>
              <SelectItem value="7d">Active 7d</SelectItem>
              <SelectItem value="30d">Active 30d</SelectItem>
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={(v) => { setRole(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="student">Student</SelectItem>
              <SelectItem value="moderator">Moderator</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-32"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="deleted">Deleted (archived)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={level} onValueChange={(v) => { setLevel(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              {((levels.data as Array<{ code: string; name: string }> | undefined) ?? []).map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={referralFilter} onValueChange={(v) => { setReferralFilter(v); setPage(1); }}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Referral" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {REFERRAL_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="ml-auto text-[10px]"><Filter className="mr-1 h-3 w-3" />{total} users</Badge>
        </div>
      </section>

      {/* Referral analytics */}
      {((referralStats.data?.sources ?? []).length > 0 || (referralStats.data?.unknown ?? 0) > 0) && (
        <section className="glass shadow-card-soft rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold tracking-tight">Where users came from</h3>
              <p className="text-[11px] text-muted-foreground">
                Signup attribution across {referralStats.data?.total ?? 0} profiles
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(referralStats.data?.sources ?? []).map((s) => (
              <button
                key={s.source}
                onClick={() => { setReferralFilter(s.source); setPage(1); }}
                className={`rounded-full border px-3 py-1 text-[11px] transition ${
                  referralFilter === s.source
                    ? "border-[var(--neon-purple)]/60 bg-[var(--neon-purple)]/15 text-foreground"
                    : "border-border/60 bg-background/40 text-foreground/80 hover:text-foreground"
                }`}
              >
                {s.source} <span className="ml-1 font-semibold text-[var(--neon-blue)]">{s.count}</span>
              </button>
            ))}
            {(referralStats.data?.unknown ?? 0) > 0 && (
              <span className="rounded-full border border-border/60 bg-background/40 px-3 py-1 text-[11px] text-muted-foreground">
                Unknown <span className="ml-1 font-semibold">{referralStats.data?.unknown}</span>
              </span>
            )}
          </div>
        </section>
      )}

      {/* Table */}
      <section className="glass shadow-card-soft overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <div>
            <h3 className="font-display text-sm font-bold tracking-tight">All Users</h3>
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
              No users match the current filters.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-background/30 text-muted-foreground">
                <tr className="text-left">
                  {["User", "Level", "Roles", "Status", "Last login", "Logins", "Usage", "Joined", "Actions"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const isAdmin = u.roles.includes("admin");
                  const isDeleted = !!u.deleted_at;
                  const displayStatus = isDeleted ? "deleted" : u.status;
                  return (
                  <tr key={u.id} className={`border-t border-border/30 hover:bg-background/40 ${isDeleted ? "opacity-60" : ""}`}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cta-gradient text-[11px] font-bold text-white shadow-glow">
                          {u.display_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1 truncate text-sm font-medium">
                            {u.display_name}
                            {isAdmin && <Crown className="h-3 w-3 text-amber-400" />}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground">{u.id.slice(0, 8)}…</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground capitalize">{u.level}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 && <span className="text-[10px] text-muted-foreground">none</span>}
                        {u.roles.map((r) => (
                          <Badge key={r} variant="outline" className="text-[10px] capitalize">{r}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] capitalize ${STATUS_TONE[displayStatus]}`}>
                        <CircleDot className="mr-1 h-2 w-2" />{displayStatus}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{fmtDateTime(u.last_login_at)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{(u.total_login_count ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{fmtDuration(u.total_usage_seconds ?? 0)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <IconBtn title="View details" onClick={() => setViewing(u)}><Eye className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn title="Edit profile" onClick={() => setEditing(u)}><Edit3 className="h-3.5 w-3.5" /></IconBtn>
                        {!isDeleted && u.status === "suspended" ? (
                          <IconBtn title="Reactivate" onClick={() => statusM.mutate({ id: u.id, status: "active" })}>
                            <Play className="h-3.5 w-3.5 text-emerald-400" />
                          </IconBtn>
                        ) : !isDeleted ? (
                          <IconBtn title="Suspend" onClick={() => { if (confirm(`Suspend ${u.display_name}?`)) statusM.mutate({ id: u.id, status: "suspended" }); }}>
                            <Pause className="h-3.5 w-3.5 text-amber-400" />
                          </IconBtn>
                        ) : null}
                        {isDeleted ? (
                          <IconBtn title="Restore user" onClick={() => restoreM.mutate(u.id)}>
                            <RotateCcw className="h-3.5 w-3.5 text-emerald-400" />
                          </IconBtn>
                        ) : (
                          <IconBtn
                            title={isAdmin ? "Demote admin first" : "Remove (archive)"}
                            disabled={isAdmin}
                            onClick={() => setConfirmDelete({ user: u, mode: "soft" })}
                          >
                            <UserX className={`h-3.5 w-3.5 ${isAdmin ? "text-muted-foreground" : "text-amber-400"}`} />
                          </IconBtn>
                        )}
                        <IconBtn
                          title={isAdmin ? "Demote admin first" : "Permanent delete"}
                          disabled={isAdmin}
                          onClick={() => setConfirmDelete({ user: u, mode: "hard" })}
                        >
                          <Trash2 className={`h-3.5 w-3.5 ${isAdmin ? "text-muted-foreground" : "text-rose-400"}`} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border/40 px-4 py-3 text-xs text-muted-foreground">
            <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          </div>
        )}
      </section>

      {editing && (
        <UserEditorDialog
          user={editing}
          levels={(levels.data as Array<{ code: string; name: string }>) ?? []}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}

      {viewing && (
        <UserDetailsDialog user={viewing} onClose={() => setViewing(null)} sessionsFn={useServerFn(adminUserSessions)} />
      )}

      {confirmDelete && (
        <ConfirmDeleteDialog
          user={confirmDelete.user}
          mode={confirmDelete.mode}
          onClose={() => setConfirmDelete(null)}
          onSoft={(id) => softDeleteM.mutate(id)}
          onHard={(id, confirmName) => hardDeleteM.mutate({ id, confirmName })}
          pending={softDeleteM.isPending || hardDeleteM.isPending}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-border/40 bg-background/40 p-1.5 hover:border-[var(--neon-purple)]/60 hover:text-[var(--neon-purple)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border/40 disabled:hover:text-foreground"
    >
      {children}
    </button>
  );
}

// ============================================================
// Editor dialog
// ============================================================
function UserEditorDialog({
  user, levels, onClose, onSaved,
}: {
  user: User;
  levels: Array<{ code: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const profileFn = useServerFn(adminUpdateUserProfile);
  const roleFn = useServerFn(adminSetUserRole);
  const statusFn = useServerFn(adminSetUserStatus);

  const [form, setForm] = useState({
    display_name: user.display_name,
    level: user.level,
    bio: user.bio ?? "",
  });
  const [roles, setRoles] = useState<Set<string>>(new Set(user.roles));

  const save = useMutation({
    mutationFn: async () => {
      await profileFn({ data: { id: user.id, display_name: form.display_name, level: form.level, bio: form.bio || null } });
      // sync role grants/revokes
      const target = new Set(roles);
      const current = new Set(user.roles);
      const allRoles = ["admin", "moderator", "student"] as const;
      for (const r of allRoles) {
        const want = target.has(r);
        const had = current.has(r);
        if (want !== had) await roleFn({ data: { id: user.id, role: r, grant: want } });
      }
    },
    onSuccess: () => { toast.success("User updated"); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusM = useMutation({
    mutationFn: (s: User["status"]) => statusFn({ data: { id: user.id, status: s } }),
    onSuccess: (_d, s) => { toast.success(`Marked ${s}`); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> {user.display_name}
          </DialogTitle>
          <DialogDescription>Manage profile, roles, and account status.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label>Display name</Label>
            <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </div>
          <div>
            <Label>Level</Label>
            <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {levels.map((l) => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Bio</Label>
            <Textarea rows={2} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </div>

          <div>
            <Label className="mb-2 block">Roles</Label>
            <div className="grid gap-2">
              {(["student", "moderator", "admin"] as const).map((r) => (
                <div key={r} className="flex items-center justify-between rounded-xl border border-border/40 bg-background/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm capitalize">
                    {r === "admin" ? <Crown className="h-4 w-4 text-amber-400" /> :
                     r === "moderator" ? <ShieldCheck className="h-4 w-4 text-sky-400" /> :
                     <UserPlus className="h-4 w-4 text-emerald-400" />}
                    {r}
                  </div>
                  <Switch
                    checked={roles.has(r)}
                    onCheckedChange={(v) => {
                      const next = new Set(roles);
                      if (v) next.add(r); else next.delete(r);
                      setRoles(next);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Account status</Label>
            <div className="flex gap-2">
              {(["active", "suspended", "pending"] as const).map((s) => (
                <Button
                  key={s}
                  variant={user.status === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => statusM.mutate(s)}
                  disabled={statusM.isPending}
                  className="capitalize"
                >
                  {s === "active" ? <CheckCircle2 className="mr-1 h-3 w-3" /> :
                   s === "suspended" ? <UserX className="mr-1 h-3 w-3" /> :
                   <Activity className="mr-1 h-3 w-3" />}
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" />Close</Button>
          <Button className="bg-cta-gradient text-white" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// View details dialog (sessions, device, activity)
// ============================================================
function UserDetailsDialog({
  user, onClose, sessionsFn,
}: {
  user: User;
  onClose: () => void;
  sessionsFn: ReturnType<typeof useServerFn<typeof adminUserSessions>>;
}) {
  const sessions = useQuery({
    queryKey: ["admin-user-sessions", user.id],
    queryFn: () => sessionsFn({ data: { userId: user.id, limit: 20 } }),
  });
  const lastSession = sessions.data?.[0];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" /> {user.display_name}
          </DialogTitle>
          <DialogDescription className="font-mono text-[10px]">{user.id}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <DetailCard label="Total logins" value={(user.total_login_count ?? 0).toLocaleString()} icon={LogIn} />
          <DetailCard label="Total usage time" value={fmtDuration(user.total_usage_seconds ?? 0)} icon={Clock} />
          <DetailCard label="Last login" value={fmtDateTime(user.last_login_at)} icon={Activity} />
          <DetailCard label="Last device" value={parseDevice(lastSession?.user_agent)} icon={Monitor} />
        </div>

        <div>
          <h4 className="mb-2 mt-3 text-xs font-semibold text-muted-foreground">Recent sessions</h4>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border/40">
            {sessions.isLoading ? (
              <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (sessions.data ?? []).length === 0 ? (
              <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                No login sessions recorded yet.
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="bg-background/40 text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 font-medium">Login</th>
                    <th className="px-2 py-1.5 font-medium">Duration</th>
                    <th className="px-2 py-1.5 font-medium">Device</th>
                  </tr>
                </thead>
                <tbody>
                  {(sessions.data ?? []).map((s) => (
                    <tr key={s.id} className="border-t border-border/30">
                      <td className="px-2 py-1.5 whitespace-nowrap">{new Date(s.login_at).toLocaleString()}</td>
                      <td className="px-2 py-1.5">{s.duration_seconds ? fmtDuration(s.duration_seconds) : <span className="text-emerald-400">Active</span>}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{parseDevice(s.user_agent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" />Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Eye }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className="mt-1 font-display text-sm font-bold">{value}</p>
    </div>
  );
}

// ============================================================
// Confirm soft / hard delete
// ============================================================
function ConfirmDeleteDialog({
  user, mode, onClose, onSoft, onHard, pending,
}: {
  user: User;
  mode: "soft" | "hard";
  onClose: () => void;
  onSoft: (id: string) => void;
  onHard: (id: string, confirmName: string) => void;
  pending: boolean;
}) {
  const [typed, setTyped] = useState("");
  const canHardDelete = typed.trim() === user.display_name.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className={`h-5 w-5 ${mode === "hard" ? "text-rose-400" : "text-amber-400"}`} />
            {mode === "hard" ? "Permanently delete user?" : "Remove user?"}
          </DialogTitle>
          <DialogDescription>
            {mode === "hard"
              ? "This wipes the user, their roles, login history, and authentication record. This cannot be undone."
              : "The user is archived (soft delete) and removed from the active system. You can restore them later."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">User</p>
          <p className="font-display text-sm font-bold">{user.display_name}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{user.id}</p>
        </div>

        {mode === "hard" && (
          <div>
            <Label className="text-xs">Type the display name to confirm</Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={user.display_name}
              className="mt-1"
              autoFocus
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="mr-1 h-4 w-4" />Cancel</Button>
          {mode === "soft" ? (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => onSoft(user.id)}
            >
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <UserX className="mr-1 h-4 w-4" />}
              Remove (archive)
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={pending || !canHardDelete}
              onClick={() => onHard(user.id, typed)}
            >
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              Permanently delete
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
