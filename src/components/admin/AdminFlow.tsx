import {
  Search,
  Bell,
  Moon,
  Sun,
  CircleDot,
  Users,
  ListChecks,
  Trophy,
  Timer,
  Activity,
  Server,
  Upload,
  PlusCircle,
  Send,
  PlayCircle,
  FileUp,
  ArrowUpRight,
  Flame,
  FileText,
  Layers,
  MousePointerClick,
  Eye,
  LogIn,
  Hourglass,
  ShieldCheck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppStore } from "@/stores/app-store";
import { LiveIndicator } from "@/components/realtime/LiveIndicator";
import { AdminQuickControls } from "@/components/admin/AdminQuickControls";
import { FloatingQuickActions } from "@/components/admin/FloatingQuickActions";
import { adminControlCenter, type AdminControlCenter } from "@/lib/admin-dashboard.functions";
import { supabase } from "@/integrations/supabase/client";

const MODULE_ROUTE: Record<string, string> = {
  mcq_practice: "/admin/mcq",
  quiz: "/admin/quiz",
  mock_test: "/admin/mock-test",
  flash_cards: "/admin/flash-cards",
};
const MODULE_ICON: Record<string, typeof ListChecks> = {
  mcq_practice: ListChecks,
  quiz: Timer,
  mock_test: Trophy,
  flash_cards: Layers,
};

function fmtNum(n: number | undefined | null) {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}
function fmtDuration(secs: number) {
  if (!secs) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(secs)}s`;
}
function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - +new Date(iso);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AdminFlow() {
  const fn = useServerFn(adminControlCenter);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-control-center"],
    queryFn: () => fn(),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-4">
      <AdminTopbar />
      <Header />
      <AdminQuickControls />
      <SystemOverviewGrid data={data} loading={isLoading} />
      <ModuleControlGrid data={data} loading={isLoading} />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <UserGrowthChart data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <LoginTrendChart data={data} />
            <ModuleUsageChart data={data} />
          </div>
          <LiveActivityFeed data={data} />
          <QuickActions />
        </div>

        <aside className="space-y-4">
          <TopStudents data={data} />
          <TopFeatures data={data} />
        </aside>
      </div>

      <FloatingQuickActions />
    </div>
  );
}

/* ---------------- Topbar ---------------- */
function AdminTopbar() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const unread = useAppStore((s) => s.notificationsUnread);
  return (
    <div className="glass shadow-card-soft flex items-center gap-3 rounded-2xl p-3">
      <div className="relative flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search users, exams, content…"
          className="h-10 w-full rounded-xl border border-border/60 bg-background/40 pl-9 pr-3 text-sm outline-none focus:border-[var(--neon-blue)]/60"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <LiveIndicator />
        <div className="hidden items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-300 md:flex">
          <CircleDot className="h-3 w-3 animate-pulse" />
          All systems operational
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/40 hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <Link to="/admin/notifications" aria-label="Notifications" className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/40">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cta-gradient px-1 text-[9px] font-bold text-white shadow-glow">
              {unread}
            </span>
          )}
        </Link>
        <Link to="/admin/settings" className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 p-1.5 pr-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cta-gradient text-[10px] font-bold text-white shadow-glow">
            AD
          </div>
          <div className="leading-tight">
            <p className="text-xs font-semibold">Admin</p>
            <p className="text-[10px] text-muted-foreground">Super Admin</p>
          </div>
        </Link>
      </div>
    </div>
  );
}

/* ---------------- Header ---------------- */
function Header() {
  return (
    <div className="glass shadow-card-soft relative overflow-hidden rounded-3xl p-6">
      <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[var(--neon-purple)]/20 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-0 h-56 w-56 rounded-full bg-[var(--neon-blue)]/20 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--neon-blue)]">
            <ShieldCheck className="h-3.5 w-3.5" /> Control Center · Live
          </div>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight md:text-4xl">
            Admin <span className="text-gradient">Control Center</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Manage students, exams, resources and platform analytics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/mcq" className="bg-cta-gradient flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-glow">
            <PlusCircle className="h-4 w-4" /> New Resource
          </Link>
          <Link to="/admin/notifications" className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-background/40 px-4 py-2.5 text-sm">
            <Send className="h-4 w-4" /> Broadcast
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Stat grid ---------------- */
function Spark({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const w = 100;
  const h = 28;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-7 w-full">
      <defs>
        <linearGradient id={`g-${pts.length}`} x1="0" x2="1">
          <stop offset="0%" stopColor="var(--neon-purple)" />
          <stop offset="100%" stopColor="var(--neon-blue)" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke={`url(#g-${pts.length})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

/* ---------------- Weekly activity ---------------- */
function QuickActions() {
  const actions: { t: string; i: typeof Upload; c: string; to: "/admin/mcq" | "/admin/quiz" | "/admin/mock-test" | "/admin/classes" | "/admin/short-notes" | "/admin/notifications" }[] = [
    { t: "Upload MCQ", i: Upload, c: "from-fuchsia-500/30 to-purple-500/10 text-fuchsia-300", to: "/admin/mcq" },
    { t: "Create Quiz", i: Timer, c: "from-sky-500/30 to-blue-500/10 text-sky-300", to: "/admin/quiz" },
    { t: "Publish Mock", i: Trophy, c: "from-amber-500/30 to-orange-500/10 text-amber-300", to: "/admin/mock-test" },
    { t: "Add Video Class", i: PlayCircle, c: "from-violet-500/30 to-indigo-500/10 text-violet-300", to: "/admin/classes" },
    { t: "Upload Notes", i: FileText, c: "from-cyan-500/30 to-teal-500/10 text-cyan-300", to: "/admin/short-notes" },
    { t: "Send Notification", i: Send, c: "from-emerald-500/30 to-green-500/10 text-emerald-300", to: "/admin/notifications" },
  ];
  return (
    <div className="glass shadow-card-soft rounded-2xl p-5">
      <h3 className="font-display text-lg font-semibold">Quick Actions</h3>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((a) => (
          <Link
            key={a.t}
            to={a.to}
            className={`group flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-gradient-to-br ${a.c} p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-glow`}
          >
            <a.i className="h-5 w-5" />
            <span className="text-xs font-semibold text-foreground">{a.t}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ===================== Real-data sections ===================== */

type CC = AdminControlCenter | undefined;

function SystemOverviewGrid({ data, loading }: { data: CC; loading: boolean }) {
  const u = data?.users;
  const t = data?.traffic;
  const tiles = [
    { l: "Total Students", v: u?.total_students ?? 0, i: Users, tint: "text-sky-300", to: "/admin/users" },
    { l: "Total Admins", v: u?.total_admins ?? 0, i: ShieldCheck, tint: "text-violet-300", to: "/admin/users" },
    { l: "Active Now", v: u?.active_now ?? 0, i: CircleDot, tint: "text-emerald-300", to: "/admin/analytics" },
    { l: "Logins · 24h", v: t?.sessions_24h ?? 0, i: LogIn, tint: "text-amber-300", to: "/admin/analytics" },
    { l: "Page Views · 24h", v: t?.page_views_24h ?? 0, i: Eye, tint: "text-cyan-300", to: "/admin/analytics" },
    { l: "Clicks · 24h", v: t?.clicks_24h ?? 0, i: MousePointerClick, tint: "text-fuchsia-300", to: "/admin/analytics" },
    { l: "Lifetime Active", v: u?.lifetime_active ?? 0, i: Activity, tint: "text-pink-300", to: "/admin/analytics" },
    { l: "Avg Session", v: fmtDuration(u?.avg_session_seconds ?? 0), i: Hourglass, tint: "text-teal-300", to: "/admin/analytics", raw: true },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {tiles.map((s) => (
        <Link
          key={s.l}
          to={s.to as never}
          className="glass shadow-card-soft group relative overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:shadow-glow"
        >
          <div className="flex items-start justify-between">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40 ${s.tint}`}>
              <s.i className="h-4 w-4" />
            </div>
            <ArrowUpRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">{s.l}</p>
          <p className="font-display text-2xl font-bold">{loading ? "—" : s.raw ? s.v : fmtNum(s.v as number)}</p>
        </Link>
      ))}
    </div>
  );
}

function ModuleControlGrid({ data, loading }: { data: CC; loading: boolean }) {
  const mods = data?.modules ?? [];
  return (
    <div className="glass shadow-card-soft rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Module Performance · Live</h3>
          <p className="text-xs text-muted-foreground">
            Real usage from attempts &amp; tracked events. Toggle visibility in Quick Controls above.
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground">{loading ? "Syncing…" : `${mods.length} modules`}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {mods.map((m) => {
          const Icon = MODULE_ICON[m.key] ?? ListChecks;
          const route = MODULE_ROUTE[m.key] ?? "/admin";
          return (
            <Link
              key={m.key}
              to={route as never}
              className="group rounded-2xl border border-border/60 bg-background/40 p-4 transition-all hover:-translate-y-0.5 hover:shadow-glow"
            >
              <div className="flex items-start justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${m.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${m.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                  {m.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold">{m.label}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <p className="text-muted-foreground">Usage · 24h</p>
                  <p className="font-display text-base font-bold">{fmtNum(m.attempts_24h)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Active users</p>
                  <p className="font-display text-base font-bold">{fmtNum(m.active_users_24h)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-display text-base font-bold">{fmtNum(m.attempts_total)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last used</p>
                  <p className="text-xs font-medium">{timeAgo(m.last_used_at)}</p>
                </div>
              </div>
              {m.top_chapter && (
                <p className="mt-2 truncate text-[10px] text-muted-foreground">
                  Top chapter: <span className="text-foreground/80">{m.top_chapter}</span>
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function AreaChart({ points, label, accent }: { points: { date: string; value: number }[]; label: string; accent: string }) {
  const w = 320, h = 130;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const pts = points.map((p, i) => `${i * step},${h - (p.value / max) * (h - 12)}`).join(" ");
  const total = points.reduce((s, p) => s + p.value, 0);
  return (
    <div className="glass shadow-card-soft rounded-2xl p-5">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">{label}</h3>
          <p className="text-xs text-muted-foreground">Last {points.length} days · {fmtNum(total)} total</p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">Live</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-32 w-full">
        <defs>
          <linearGradient id={`a-${label}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.6" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {points.length > 0 && (
          <>
            <polygon fill={`url(#a-${label})`} points={`0,${h} ${pts} ${w},${h}`} />
            <polyline fill="none" stroke={accent} strokeWidth="2" points={pts} />
          </>
        )}
      </svg>
    </div>
  );
}

function UserGrowthChart({ data }: { data: CC }) {
  return <AreaChart points={data?.growth_series ?? []} label="User Growth" accent="var(--neon-purple)" />;
}
function LoginTrendChart({ data }: { data: CC }) {
  return <AreaChart points={data?.login_series ?? []} label="Login Trend" accent="var(--neon-blue)" />;
}

function ModuleUsageChart({ data }: { data: CC }) {
  const rows = data?.module_usage_series ?? [];
  const max = Math.max(1, ...rows.map((r) => r.mcq_practice + r.quiz + r.mock_test + r.flash_cards));
  const colors = { mcq_practice: "#a855f7", quiz: "#3b82f6", mock_test: "#f59e0b", flash_cards: "#22d3ee" };
  return (
    <div className="glass shadow-card-soft rounded-2xl p-5">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Module Usage · 7d</h3>
          <p className="text-xs text-muted-foreground">Events per module per day</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {Object.entries(colors).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: c }} />
              {k.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 flex h-40 items-end gap-2">
        {rows.map((r) => {
          const total = r.mcq_practice + r.quiz + r.mock_test + r.flash_cards;
          return (
            <div key={r.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-md" style={{ height: `${(total / max) * 140 || 2}px` }}>
                {(["mcq_practice", "quiz", "mock_test", "flash_cards"] as const).map((k) => {
                  const v = r[k];
                  if (!v) return null;
                  return <div key={k} style={{ height: `${(v / total) * 100}%`, background: colors[k] }} />;
                })}
              </div>
              <span className="text-[9px] text-muted-foreground">{r.date.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type RecentRow = AdminControlCenter["recent_activity"][number];
function LiveActivityFeed({ data }: { data: CC }) {
  const [items, setItems] = useState<RecentRow[]>([]);
  useEffect(() => {
    if (data?.recent_activity) setItems(data.recent_activity);
  }, [data?.recent_activity]);
  useEffect(() => {
    const ch = supabase
      .channel("admin-live-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_events" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          setItems((prev) => [
            {
              id: String(row.id),
              event_type: String(row.event_type ?? ""),
              element_label: (row.element_label as string) ?? null,
              page_path: (row.page_path as string) ?? null,
              module: (row.module as string) ?? null,
              user_id: (row.user_id as string) ?? null,
              user_name: null,
              created_at: String(row.created_at ?? new Date().toISOString()),
            },
            ...prev,
          ].slice(0, 20));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const tint = (t: string) => {
    switch (t) {
      case "login": return "bg-emerald-500/15 text-emerald-300";
      case "logout": return "bg-rose-500/15 text-rose-300";
      case "click": return "bg-sky-500/15 text-sky-300";
      case "submit": return "bg-fuchsia-500/15 text-fuchsia-300";
      case "page_view": return "bg-violet-500/15 text-violet-300";
      case "crud": return "bg-amber-500/15 text-amber-300";
      case "admin_action": return "bg-pink-500/15 text-pink-300";
      default: return "bg-muted/40 text-muted-foreground";
    }
  };

  return (
    <div className="glass shadow-card-soft rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Live Activity</h3>
        <span className="flex items-center gap-1 text-[11px] text-emerald-300">
          <CircleDot className="h-3 w-3 animate-pulse" /> Streaming
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-2.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${tint(a.event_type)}`}>{a.event_type}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {a.user_name ?? "User"} {a.element_label ? `· ${a.element_label}` : ""}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {a.page_path ?? "—"}{a.module ? ` · ${a.module}` : ""}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground">{timeAgo(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopStudents({ data }: { data: CC }) {
  const rows = data?.top_users ?? [];
  const medal = (r: number) =>
    r === 0 ? "bg-amber-500/20 text-amber-300" : r === 1 ? "bg-slate-400/20 text-slate-200" : r === 2 ? "bg-orange-500/20 text-orange-300" : "bg-muted/40 text-foreground/70";
  return (
    <div className="glass shadow-card-soft rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-semibold">Most Active Users</h3>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No usage data yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((u, i) => (
            <li key={u.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-2.5">
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold ${medal(i)}`}>#{i + 1}</span>
              <Link to="/admin/users" className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{u.display_name ?? "Anonymous"}</p>
                <p className="text-[10px] text-muted-foreground">
                  {fmtDuration(u.total_usage_seconds)} · {u.total_login_count} logins
                </p>
              </Link>
              <span className="flex items-center gap-1 rounded-full border border-orange-400/40 bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-300">
                <Flame className="h-2.5 w-2.5" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopFeatures({ data }: { data: CC }) {
  const rows = data?.top_features ?? [];
  return (
    <div className="glass shadow-card-soft rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-fuchsia-300" />
        <h3 className="text-sm font-semibold">Most Used Features · 7d</h3>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No tracked events yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => {
            const route = MODULE_ROUTE[r.module] ?? "/admin/analytics";
            return (
              <li key={r.module} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-2.5">
                <FileUp className="h-4 w-4 text-fuchsia-300" />
                <Link to={route as never} className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{r.module}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtNum(r.event_count)} events · {r.unique_users} users</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
