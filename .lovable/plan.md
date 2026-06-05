# Premium Admin Dashboard — Real Data Upgrade

Goal: Replace the hardcoded `AdminFlow.tsx` with a fully database-driven Control Center that reuses the infrastructure we already shipped (`activity_events`, `admin_activity_*` RPCs, `admin_user_analytics`, `module_visibility`, `admin_dashboard.functions.ts`).

No new schema is needed — every required table/RPC already exists.

## 1. New server function: `adminControlCenter`

File: `src/lib/admin-dashboard.functions.ts` (extend, don't replace existing `adminDashboardSnapshot`).

Returns one bundled payload so the dashboard makes a single round-trip:

- **users**: total students, total admins, active now (5 min), active 24h/7d/30d, lifetime active, total logins, avg session secs
- **traffic** (from `activity_events`): page_views_24h, clicks_24h, submits_24h, total_events_24h, sessions_24h (distinct user_id), api_errors_24h
- **modules** (per key: `mcq_practice | quiz | mock_test | flash_cards`): `enabled` (from `module_visibility.hidden` inverted), `attempts_total`, `attempts_24h`, `active_users_24h`, `last_used_at`, `top_chapter` (most-referenced chapter via `exam_attempts.chapter_id` joined to `chapters.name`)
- **growth_series**: signups per day for last 30 days (from `profiles.created_at`)
- **login_series**: logins per day for last 30 days (from `user_login_events.login_at`)
- **module_usage_series**: events per module per day for last 7 days (from `activity_events` grouped by `module`)
- **top_users** (top 5 by `total_usage_seconds`): id, display_name, total_login_count, total_usage_seconds, last_login_at
- **top_features**: top 5 modules by event count last 7d
- **recent_activity**: last 15 `activity_events` (event_type, label, page_path, user display_name, created_at)

All queries gated by `assertAdmin`. Mix of existing RPCs + a couple of new SQL aggregates done inline via `supabase.from(...)`.

## 2. New server function: `adminSetModule`

Reuse existing `adminSetModuleHidden` from `module-visibility.functions.ts` (already admin-gated, real-time). Just call it from the dashboard toggle.

## 3. Rebuild `src/components/admin/AdminFlow.tsx`

Keep the visual language (glass cards, neon gradient, `AdminTopbar`, `AdminQuickControls`, `FloatingQuickActions`) and the file's module-level exports. Replace **every** hardcoded `stats`, `days/a/b`, `data`, `rows`, `acts`, `students`, `tasks`, `recentUploads` array with React Query data from `adminControlCenter` (10s refetch, `useQuery` + `useServerFn`).

New section order:

1. **Topbar** — unchanged.
2. **Hero header** — existing gradient header, kept.
3. **AdminQuickControls** — unchanged.
4. **System Overview KPI grid (8 cards)**: Total Students, Total Admins, Active Now, Logins 24h, Page Views 24h, Clicks 24h, Sessions 24h, Avg Session. Each card links to a real route and renders a real sparkline from a slice of `login_series` / `module_usage_series`.
5. **Module Control Center** (NEW, replaces fake "Subject Performance"): 4 cards (MCQ, Quiz, Custom Exam, Flashcards). Each shows usage 24h, active users, last used, top chapter, and an Enable/Disable `Switch` wired to `adminSetModuleHidden` via `useMutation` with optimistic update + `toast`. Card title links to that module's admin page.
6. **Live charts row**:
   - User Growth (area chart, 30d) from `growth_series`
   - Login Trend (line chart, 30d) from `login_series`
7. **Module Usage Comparison** (stacked bars, 7d) from `module_usage_series`.
8. **Live Activity Feed** — from `recent_activity` + real-time Supabase channel on `activity_events` (prepend new inserts, cap 20).
9. **Top Students / Top Features** sidebar — real data from `top_users` and `top_features`. Each row clickable to `/admin/users` filtered or to that module page.
10. **Platform Status / Pending Tasks** kept but populated from existing `adminDashboardSnapshot` (`scheduledNotifications`, `pendingDrafts`, `recentUploads24h`).

All buttons are real `<Link to=...>` to existing admin routes (already verified to exist: `/admin/users`, `/admin/mcq`, `/admin/quiz`, `/admin/mock-test`, `/admin/flash-cards`, `/admin/analytics`, `/admin/settings`, `/admin/notifications`).

## 4. Real-time

- React Query `refetchInterval: 10_000` for the bundle.
- Live Activity Feed subscribes to `supabase.channel('admin-activity').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_events' }, ...)`.

## 5. Security

- `adminControlCenter` uses `requireSupabaseAuth` + `assertAdmin` (existing pattern).
- All toggles go through admin-gated server fns; no `supabaseAdmin` from client.
- Admin route subtree is already gated by `/admin` layout.

## 6. Files touched

New / extended:
- `src/lib/admin-dashboard.functions.ts` — add `adminControlCenter` server fn.

Rewritten:
- `src/components/admin/AdminFlow.tsx` — full real-data implementation.

No DB migration, no new tables, no edge functions.

Approve and I'll ship in one pass.
