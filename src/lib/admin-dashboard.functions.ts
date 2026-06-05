import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Forbidden: admin role required");
}

export type RecentUpload = {
  id: string;
  title: string;
  kind: "mcq" | "note" | "flash" | "video" | "qbank" | "quiz";
  created_at: string;
  status: string;
};

export type RecentNotification = {
  id: string;
  title: string;
  status: string;
  audience: string;
  created_at: string;
  sent_at: string | null;
};

export type AdminDashboardSnapshot = {
  counters: {
    activeStudents: number;
    totalStudents: number;
    liveExams: number;
    pendingDrafts: number;
    recentUploads24h: number;
    scheduledNotifications: number;
  };
  recentUploads: RecentUpload[];
  recentNotifications: RecentNotification[];
};

export const adminDashboardSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminDashboardSnapshot> => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      profilesActive,
      profilesTotal,
      liveExams,
      mcqDrafts,
      noteDrafts,
      flashDrafts,
      videoDrafts,
      qbankDrafts,
      quizDrafts,
      scheduledNotif,
      recentMcqs,
      recentNotes,
      recentFlash,
      recentVideos,
      recentQbank,
      recentQuiz,
      recentNotifs,
    ] = await Promise.all([
      sb.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
      sb.from("profiles").select("id", { count: "exact", head: true }),
      sb.from("exam_attempts").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
      sb.from("mcqs").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("short_notes").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("flash_cards").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("video_classes").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("question_bank_resources").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("quizzes").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("notifications").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
      sb.from("mcqs").select("id,question,created_at,status").order("created_at", { ascending: false }).limit(5),
      sb.from("short_notes").select("id,title,created_at,status").order("created_at", { ascending: false }).limit(5),
      sb.from("flash_cards").select("id,front,created_at,status").order("created_at", { ascending: false }).limit(5),
      sb.from("video_classes").select("id,title,created_at,status").order("created_at", { ascending: false }).limit(5),
      sb.from("question_bank_resources").select("id,title,created_at,status").order("created_at", { ascending: false }).limit(5),
      sb.from("quizzes").select("id,title,created_at,status").order("created_at", { ascending: false }).limit(5),
      sb.from("notifications").select("id,title,status,audience,created_at,sent_at").order("created_at", { ascending: false }).limit(8),
    ]);

    const pendingDrafts =
      (mcqDrafts.count ?? 0) +
      (noteDrafts.count ?? 0) +
      (flashDrafts.count ?? 0) +
      (videoDrafts.count ?? 0) +
      (qbankDrafts.count ?? 0) +
      (quizDrafts.count ?? 0);

    const ups: RecentUpload[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(recentMcqs.data ?? []).map((r: any) => ({ id: r.id, title: r.question?.slice(0, 80) ?? "MCQ", kind: "mcq" as const, created_at: r.created_at, status: r.status })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(recentNotes.data ?? []).map((r: any) => ({ id: r.id, title: r.title, kind: "note" as const, created_at: r.created_at, status: r.status })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(recentFlash.data ?? []).map((r: any) => ({ id: r.id, title: r.front?.slice(0, 80) ?? "Flash card", kind: "flash" as const, created_at: r.created_at, status: r.status })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(recentVideos.data ?? []).map((r: any) => ({ id: r.id, title: r.title, kind: "video" as const, created_at: r.created_at, status: r.status })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(recentQbank.data ?? []).map((r: any) => ({ id: r.id, title: r.title, kind: "qbank" as const, created_at: r.created_at, status: r.status })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(recentQuiz.data ?? []).map((r: any) => ({ id: r.id, title: r.title, kind: "quiz" as const, created_at: r.created_at, status: r.status })),
    ]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 10);

    const recentUploads24h = ups.filter((u) => u.created_at >= dayAgo).length;

    return {
      counters: {
        activeStudents: profilesActive.count ?? 0,
        totalStudents: profilesTotal.count ?? 0,
        liveExams: liveExams.count ?? 0,
        pendingDrafts,
        recentUploads24h,
        scheduledNotifications: scheduledNotif.count ?? 0,
      },
      recentUploads: ups,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recentNotifications: (recentNotifs.data ?? []) as any,
    };
  });

/* ===================== Premium Control Center ===================== */

export type ModuleStat = {
  key: "mcq_practice" | "quiz" | "mock_test" | "flash_cards";
  label: string;
  enabled: boolean;
  attempts_total: number;
  attempts_24h: number;
  active_users_24h: number;
  last_used_at: string | null;
  top_chapter: string | null;
};

export type SeriesPoint = { date: string; value: number };
export type ModuleUsagePoint = { date: string; mcq_practice: number; quiz: number; mock_test: number; flash_cards: number };

export type AdminControlCenter = {
  users: {
    total_students: number;
    total_admins: number;
    active_now: number;
    active_24h: number;
    active_7d: number;
    active_30d: number;
    lifetime_active: number;
    total_logins: number;
    avg_session_seconds: number;
  };
  traffic: {
    page_views_24h: number;
    clicks_24h: number;
    submits_24h: number;
    total_events_24h: number;
    sessions_24h: number;
    api_errors_24h: number;
  };
  modules: ModuleStat[];
  growth_series: SeriesPoint[];
  login_series: SeriesPoint[];
  module_usage_series: ModuleUsagePoint[];
  top_users: { id: string; display_name: string | null; total_login_count: number; total_usage_seconds: number; last_login_at: string | null }[];
  top_features: { module: string; event_count: number; unique_users: number }[];
  recent_activity: { id: string; event_type: string; element_label: string | null; page_path: string | null; module: string | null; user_id: string | null; user_name: string | null; created_at: string }[];
};

function bucketByDay(rows: { ts: string }[], days: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const map = new Map<string, number>();
  for (const r of rows) {
    const d = new Date(r.ts);
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, value: map.get(key) ?? 0 });
  }
  return out;
}

export const adminControlCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminControlCenter> => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      userAnalyticsRpc,
      activityOverviewRpc,
      topModulesRpc,
      topUsersRpc,
      profilesTotal,
      adminRoles,
      moduleVis,
      attemptsAll,
      attempts24h,
      flashEvents24h,
      flashEventsAll,
      profilesNew,
      loginsRecent,
      eventsLast7d,
      recentEvents,
    ] = await Promise.all([
      sb.rpc("admin_user_analytics"),
      sb.rpc("admin_activity_overview", { _range_hours: 24 }),
      sb.rpc("admin_top_modules", { _range_hours: 168, _limit: 5 }),
      sb.rpc("admin_top_users", { _order: "most", _limit: 5 }),
      sb.from("profiles").select("id", { count: "exact", head: true }).is("deleted_at", null),
      sb.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin"),
      sb.from("module_visibility").select("key,label,hidden"),
      sb.from("exam_attempts").select("kind, chapter_id, completed_at, created_at, user_id"),
      sb.from("exam_attempts").select("kind, user_id, created_at").gte("created_at", dayAgo),
      sb.from("activity_events").select("user_id, created_at").eq("module", "flash_cards").gte("created_at", dayAgo),
      sb.from("activity_events").select("created_at").eq("module", "flash_cards"),
      sb.from("profiles").select("created_at").gte("created_at", monthAgo),
      sb.from("user_login_events").select("login_at").gte("login_at", monthAgo),
      sb.from("activity_events").select("module, created_at").gte("created_at", weekAgo).not("module", "is", null),
      sb.from("activity_events").select("id, event_type, element_label, page_path, module, user_id, created_at").order("created_at", { ascending: false }).limit(15),
    ]);

    const ua = (userAnalyticsRpc.data ?? {}) as Record<string, number>;
    const ao = (activityOverviewRpc.data ?? {}) as Record<string, number>;

    // Module aggregates from exam_attempts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attemptsByKind = (kind: string) => (attemptsAll.data ?? []).filter((a: any) => a.kind === kind);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attempts24hByKind = (kind: string) => (attempts24h.data ?? []).filter((a: any) => a.kind === kind);

    // Top chapter lookup
    const chapterIds = Array.from(
      new Set(
        (attemptsAll.data ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((a: any) => a.chapter_id)
          .filter((c: string | null): c is string => !!c),
      ),
    );
    let chapterNames = new Map<string, string>();
    if (chapterIds.length > 0) {
      const { data: chRows } = await sb.from("chapters").select("id,name").in("id", chapterIds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chapterNames = new Map((chRows ?? []).map((c: any) => [c.id, c.name]));
    }
    const topChapterFor = (kind: string): string | null => {
      const counts = new Map<string, number>();
      for (const a of attemptsByKind(kind)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cid = (a as any).chapter_id;
        if (!cid) continue;
        counts.set(cid, (counts.get(cid) ?? 0) + 1);
      }
      let topId: string | null = null;
      let max = 0;
      counts.forEach((v, k) => { if (v > max) { max = v; topId = k; } });
      return topId ? chapterNames.get(topId) ?? null : null;
    };
    const lastUsedFor = (kind: string): string | null => {
      const rows = attemptsByKind(kind);
      if (rows.length === 0) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((r: any) => r.completed_at ?? r.created_at).sort().slice(-1)[0] ?? null;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visMap = new Map<string, { hidden: boolean; label: string }>(((moduleVis.data ?? []) as any[]).map((m) => [m.key, { hidden: m.hidden, label: m.label }]));

    const buildModule = (key: ModuleStat["key"], fallbackLabel: string): ModuleStat => {
      const vis = visMap.get(key);
      if (key === "flash_cards") {
        const last = (flashEventsAll.data ?? []).map((r: { created_at: string }) => r.created_at).sort().slice(-1)[0] ?? null;
        return {
          key,
          label: vis?.label ?? fallbackLabel,
          enabled: !(vis?.hidden ?? false),
          attempts_total: flashEventsAll.data?.length ?? 0,
          attempts_24h: flashEvents24h.data?.length ?? 0,
          active_users_24h: new Set((flashEvents24h.data ?? []).map((r: { user_id: string | null }) => r.user_id).filter(Boolean)).size,
          last_used_at: last,
          top_chapter: null,
        };
      }
      return {
        key,
        label: vis?.label ?? fallbackLabel,
        enabled: !(vis?.hidden ?? false),
        attempts_total: attemptsByKind(key).length,
        attempts_24h: attempts24hByKind(key).length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        active_users_24h: new Set(attempts24hByKind(key).map((a: any) => a.user_id).filter(Boolean)).size,
        last_used_at: lastUsedFor(key),
        top_chapter: topChapterFor(key),
      };
    };

    const modules: ModuleStat[] = [
      buildModule("mcq_practice", "MCQ Practice"),
      buildModule("quiz", "Quiz System"),
      buildModule("mock_test", "Custom Exam"),
      buildModule("flash_cards", "Flash Cards"),
    ];

    // Series
    const growth_series = bucketByDay(
      (profilesNew.data ?? []).map((r: { created_at: string }) => ({ ts: r.created_at })),
      30,
    );
    const login_series = bucketByDay(
      (loginsRecent.data ?? []).map((r: { login_at: string }) => ({ ts: r.login_at })),
      30,
    );

    // Module usage stacked, 7 days
    const usageMap = new Map<string, ModuleUsagePoint>();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      usageMap.set(key, { date: key, mcq_practice: 0, quiz: 0, mock_test: 0, flash_cards: 0 });
    }
    for (const row of (eventsLast7d.data ?? []) as { module: string; created_at: string }[]) {
      const key = new Date(row.created_at).toISOString().slice(0, 10);
      const bucket = usageMap.get(key);
      if (!bucket) continue;
      const m = row.module;
      if (m === "mcq_practice" || m === "quiz" || m === "mock_test" || m === "flash_cards") {
        bucket[m] += 1;
      }
    }
    const module_usage_series = Array.from(usageMap.values());

    // Recent activity — resolve display names
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recRows = (recentEvents.data ?? []) as any[];
    const userIds = Array.from(new Set(recRows.map((r) => r.user_id).filter(Boolean)));
    let nameMap = new Map<string, string | null>();
    if (userIds.length > 0) {
      const { data: profs } = await sb.from("profiles").select("id, display_name").in("id", userIds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nameMap = new Map((profs ?? []).map((p: any) => [p.id, p.display_name]));
    }

    return {
      users: {
        total_students: profilesTotal.count ?? 0,
        total_admins: adminRoles.count ?? 0,
        active_now: Number(ao.active_now ?? 0),
        active_24h: Number(ua.active_24h ?? 0),
        active_7d: Number(ua.active_7d ?? 0),
        active_30d: Number(ua.active_30d ?? 0),
        lifetime_active: Number(ua.lifetime_active ?? 0),
        total_logins: Number(ua.total_logins ?? 0),
        avg_session_seconds: Number(ua.avg_session_seconds ?? 0),
      },
      traffic: {
        page_views_24h: Number(ao.total_page_views ?? 0),
        clicks_24h: Number(ao.total_clicks ?? 0),
        submits_24h: Number(ao.total_submits ?? 0),
        total_events_24h: Number(ao.total_events ?? 0),
        sessions_24h: Number(ao.unique_users_24h ?? 0),
        api_errors_24h: Number(ao.api_errors ?? 0),
      },
      modules,
      growth_series,
      login_series,
      module_usage_series,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      top_users: ((topUsersRpc.data ?? []) as any[]).map((u) => ({
        id: u.user_id,
        display_name: u.display_name,
        total_login_count: u.total_login_count,
        total_usage_seconds: Number(u.total_usage_seconds ?? 0),
        last_login_at: u.last_login_at,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      top_features: ((topModulesRpc.data ?? []) as any[]).map((m) => ({
        module: m.module,
        event_count: Number(m.event_count ?? 0),
        unique_users: Number(m.unique_users ?? 0),
      })),
      recent_activity: recRows.map((r) => ({
        id: r.id,
        event_type: r.event_type,
        element_label: r.element_label,
        page_path: r.page_path,
        module: r.module,
        user_id: r.user_id,
        user_name: r.user_id ? nameMap.get(r.user_id) ?? null : null,
        created_at: r.created_at,
      })),
    };
  });
