import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Daily Progress Center — student-facing realtime aggregate.
 * Pulls today / week / month metrics, weekly bars, activity heatmap,
 * smart insights, wrong/bookmark stats, plus subject and chapter aggregates
 * (counts, completion %, accuracy, study minutes, last activity).
 */
export const studentDailyProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const startOfPrevWeek = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const since60 = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();

    const [attemptsR, subjectsR, chaptersR, mcqsR, wrongR, bookmarksR, profileR, answersR] = await Promise.all([
      supabase
        .from("exam_attempts")
        .select(
          "id,kind,status,subject_id,chapter_id,quiz_id,level,score,correct_count,total_count,duration_seconds,started_at,completed_at,created_at,title",
        )
        .eq("user_id", userId)
        .gte("created_at", since60)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("subjects").select("id,name,color,level").eq("status", "published"),
      supabase.from("chapters").select("id,name,subject_id").eq("status", "published"),
      supabase.from("mcqs").select("id,chapter_id").eq("status", "published"),
      supabase
        .from("mcq_wrong_questions")
        .select("id,mastered,retry_count,subject_id,chapter_id,last_wrong_at")
        .eq("user_id", userId),
      supabase
        .from("mcq_bookmarks")
        .select("id,subject_id,chapter_id,created_at")
        .eq("user_id", userId),
      supabase.from("profiles").select("level").eq("id", userId).maybeSingle(),
      // Solved MCQ ids per chapter via attempt_answers join
      supabase
        .from("attempt_answers")
        .select("mcq_id,is_correct,attempt_id,exam_attempts!inner(user_id,chapter_id,subject_id,created_at)")
        .eq("exam_attempts.user_id", userId)
        .gte("exam_attempts.created_at", since60)
        .limit(5000),
    ]);

    const attempts = attemptsR.data ?? [];
    const subjects = subjectsR.data ?? [];
    const chapters = chaptersR.data ?? [];
    const allMcqs = mcqsR.data ?? [];
    const wrong = wrongR.data ?? [];
    const bookmarks = bookmarksR.data ?? [];
    const answers = (answersR.data ?? []) as Array<{ mcq_id: string; is_correct: boolean; attempt_id: string }>;
    const userLevel = (profileR.data as { level?: string } | null)?.level ?? "professional";

    const subjectMap = new Map(subjects.map((s) => [s.id, s]));
    const chapterMap = new Map(chapters.map((c) => [c.id, c]));

    // Total MCQs per chapter
    const mcqsByChapter = new Map<string, number>();
    for (const m of allMcqs) {
      if (!m.chapter_id) continue;
      mcqsByChapter.set(m.chapter_id, (mcqsByChapter.get(m.chapter_id) ?? 0) + 1);
    }

    const completed = attempts.filter((a) => a.status === "completed");
    const ts = (a: typeof attempts[number]) =>
      new Date(a.completed_at ?? a.created_at).getTime();
    const inRange = (a: typeof attempts[number], from: Date) => ts(a) >= from.getTime();

    const sumBy = (
      list: typeof attempts,
      pick: (a: typeof attempts[number]) => number,
    ) => list.reduce((s, a) => s + (pick(a) ?? 0), 0);

    const todayList = completed.filter((a) => inRange(a, startOfToday));
    const weekList = completed.filter((a) => inRange(a, startOfWeek));
    const prevWeekList = completed.filter(
      (a) => inRange(a, startOfPrevWeek) && !inRange(a, startOfWeek),
    );
    const monthList = completed.filter((a) => inRange(a, startOfMonth));

    const countKind = (list: typeof attempts, kind: string) =>
      list.filter((a) => a.kind === kind).length;

    const accuracyOf = (list: typeof attempts) => {
      const t = sumBy(list, (a) => a.total_count);
      const c = sumBy(list, (a) => a.correct_count);
      return t ? Math.round((c / t) * 100) : 0;
    };

    // Weekly bars (last 7 days accuracy %)
    const weeklyBars: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      const day = completed.filter((a) => {
        const t = ts(a);
        return t >= d.getTime() && t < next.getTime();
      });
      weeklyBars.push(accuracyOf(day));
    }

    // Streak
    const daySet = new Set<string>();
    for (const a of completed) {
      const d = new Date(ts(a));
      d.setHours(0, 0, 0, 0);
      daySet.add(d.toISOString().slice(0, 10));
    }
    let streak = 0;
    {
      const cursor = new Date(startOfToday);
      while (daySet.has(cursor.toISOString().slice(0, 10))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
    }

    // 30-day heatmap
    const heatmap: { date: string; label: string; count: number; minutes: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      const day = completed.filter((a) => {
        const t = ts(a);
        return t >= d.getTime() && t < next.getTime();
      });
      heatmap.push({
        date: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString("en", { day: "numeric" }),
        count: day.length,
        minutes: Math.round(sumBy(day, (a) => a.duration_seconds) / 60),
      });
    }

    // Timeline
    const timeline = completed.slice(0, 12).map((a) => {
      const subjName = a.subject_id ? subjectMap.get(a.subject_id)?.name ?? null : null;
      const chapName = a.chapter_id ? chapterMap.get(a.chapter_id)?.name ?? null : null;
      const kindLabel =
        a.kind === "mcq_practice" ? "MCQ practice"
          : a.kind === "quiz" ? "Quiz"
          : a.kind === "mock" ? "Mock test"
          : "Custom exam";
      return {
        id: a.id,
        kind: a.kind,
        title: a.title ?? chapName ?? subjName ?? kindLabel,
        kindLabel,
        score: a.score,
        correct: a.correct_count,
        total: a.total_count,
        duration: a.duration_seconds,
        subjectId: a.subject_id ?? null,
        chapterId: a.chapter_id ?? null,
        subjectName: subjName,
        chapterName: chapName,
        at: a.completed_at ?? a.created_at,
      };
    });

    // ---- CHAPTER aggregates ----
    type ChapterAgg = {
      id: string;
      name: string;
      subjectId: string | null;
      subjectName: string | null;
      subjectColor: string | null;
      totalMcqs: number;
      mcqsSolved: number;
      correct: number;
      totalAnswered: number;
      accuracy: number;
      completionPct: number;
      bookmarks: number;
      wrong: number;
      studyMinutes: number;
      quizCompleted: number;
      mockCompleted: number;
      lastAt: string | null;
    };

    const solvedByChapter = new Map<string, Set<string>>();
    const correctByChapter = new Map<string, number>();
    const answeredByChapter = new Map<string, number>();
    for (const ans of answers) {
      const ea = (ans as unknown as { exam_attempts: { chapter_id: string | null } }).exam_attempts;
      const cid = ea?.chapter_id;
      if (!cid) continue;
      let set = solvedByChapter.get(cid);
      if (!set) { set = new Set(); solvedByChapter.set(cid, set); }
      set.add(ans.mcq_id);
      answeredByChapter.set(cid, (answeredByChapter.get(cid) ?? 0) + 1);
      if (ans.is_correct) correctByChapter.set(cid, (correctByChapter.get(cid) ?? 0) + 1);
    }

    const studyByChapter = new Map<string, number>();
    const lastByChapter = new Map<string, number>();
    const quizDoneByChapter = new Map<string, number>();
    const mockDoneByChapter = new Map<string, number>();
    for (const a of completed) {
      if (!a.chapter_id) continue;
      studyByChapter.set(a.chapter_id, (studyByChapter.get(a.chapter_id) ?? 0) + (a.duration_seconds ?? 0));
      lastByChapter.set(a.chapter_id, Math.max(lastByChapter.get(a.chapter_id) ?? 0, ts(a)));
      if (a.kind === "quiz") quizDoneByChapter.set(a.chapter_id, (quizDoneByChapter.get(a.chapter_id) ?? 0) + 1);
      if (a.kind === "mock") mockDoneByChapter.set(a.chapter_id, (mockDoneByChapter.get(a.chapter_id) ?? 0) + 1);
    }

    const bookmarksByChapter = new Map<string, number>();
    for (const b of bookmarks) {
      if (!b.chapter_id) continue;
      bookmarksByChapter.set(b.chapter_id, (bookmarksByChapter.get(b.chapter_id) ?? 0) + 1);
    }
    const wrongByChapter = new Map<string, number>();
    for (const w of wrong) {
      if (w.mastered || !w.chapter_id) continue;
      wrongByChapter.set(w.chapter_id, (wrongByChapter.get(w.chapter_id) ?? 0) + 1);
    }

    const chapterAgg: ChapterAgg[] = chapters.map((c) => {
      const subj = c.subject_id ? subjectMap.get(c.subject_id) : null;
      const totalMcqs = mcqsByChapter.get(c.id) ?? 0;
      const mcqsSolved = solvedByChapter.get(c.id)?.size ?? 0;
      const correct = correctByChapter.get(c.id) ?? 0;
      const totalAnswered = answeredByChapter.get(c.id) ?? 0;
      const lastAt = lastByChapter.get(c.id);
      return {
        id: c.id,
        name: c.name,
        subjectId: c.subject_id ?? null,
        subjectName: subj?.name ?? null,
        subjectColor: subj?.color ?? null,
        totalMcqs,
        mcqsSolved,
        correct,
        totalAnswered,
        accuracy: totalAnswered ? Math.round((correct / totalAnswered) * 100) : 0,
        completionPct: totalMcqs ? Math.min(100, Math.round((mcqsSolved / totalMcqs) * 100)) : 0,
        bookmarks: bookmarksByChapter.get(c.id) ?? 0,
        wrong: wrongByChapter.get(c.id) ?? 0,
        studyMinutes: Math.round((studyByChapter.get(c.id) ?? 0) / 60),
        quizCompleted: quizDoneByChapter.get(c.id) ?? 0,
        mockCompleted: mockDoneByChapter.get(c.id) ?? 0,
        lastAt: lastAt ? new Date(lastAt).toISOString() : null,
      };
    });

    // ---- SUBJECT aggregates ----
    type SubjectAgg = {
      id: string;
      name: string;
      color: string | null;
      level: string;
      totalChapters: number;
      completedChapters: number;
      completionPct: number;
      avgScore: number;
      weakChapters: number;
      pendingMcqs: number;
      attempts: number;
      lastAt: string | null;
      inactiveDays: number | null;
    };

    const subjectAgg: SubjectAgg[] = subjects.map((s) => {
      const ch = chapterAgg.filter((c) => c.subjectId === s.id);
      const total = ch.length;
      const completed = ch.filter((c) => c.completionPct >= 80).length;
      const weak = ch.filter((c) => c.totalAnswered >= 5 && c.accuracy < 50).length;
      const pending = ch.reduce((sum, c) => sum + Math.max(0, c.totalMcqs - c.mcqsSolved), 0);
      const subjAttempts = completed; // placeholder reset below
      const subjAttemptList = monthList.filter((a) => a.subject_id === s.id);
      const last = ch.reduce((m, c) => (c.lastAt && new Date(c.lastAt).getTime() > m ? new Date(c.lastAt).getTime() : m), 0);
      const totalAnsweredAll = ch.reduce((sum, c) => sum + c.totalAnswered, 0);
      const correctAll = ch.reduce((sum, c) => sum + c.correct, 0);
      void subjAttempts;
      return {
        id: s.id,
        name: s.name,
        color: s.color ?? null,
        level: s.level ?? "professional",
        totalChapters: total,
        completedChapters: completed,
        completionPct: total ? Math.round((completed / total) * 100) : 0,
        avgScore: totalAnsweredAll ? Math.round((correctAll / totalAnsweredAll) * 100) : 0,
        weakChapters: weak,
        pendingMcqs: pending,
        attempts: subjAttemptList.length,
        lastAt: last ? new Date(last).toISOString() : null,
        inactiveDays: last ? Math.floor((now - last) / 86400000) : null,
      };
    });

    const sortedBySkill = [...subjectAgg]
      .filter((s) => s.attempts > 0 || s.completedChapters > 0)
      .sort((a, b) => b.avgScore - a.avgScore);
    const strongest = sortedBySkill[0] ?? null;
    const weakest = sortedBySkill.length ? sortedBySkill[sortedBySkill.length - 1] : null;
    const inactive = subjectAgg.filter((s) => s.inactiveDays !== null && s.inactiveDays >= 7).slice(0, 3);

    // Wrong/bookmark top
    const wrongUnresolved = wrong.filter((w) => !w.mastered).length;
    const wrongResolved = wrong.filter((w) => w.mastered).length;
    const wrongRetries = wrong.reduce((s, w) => s + (w.retry_count ?? 0), 0);
    const wrongBySubject = new Map<string, number>();
    for (const w of wrong) {
      if (w.mastered || !w.subject_id) continue;
      wrongBySubject.set(w.subject_id, (wrongBySubject.get(w.subject_id) ?? 0) + 1);
    }
    const wrongTopSubjects = Array.from(wrongBySubject.entries())
      .map(([id, count]) => ({
        id,
        name: subjectMap.get(id)?.name ?? "Unknown",
        color: subjectMap.get(id)?.color ?? null,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    const bookmarksBySubject = new Map<string, number>();
    for (const b of bookmarks) {
      if (!b.subject_id) continue;
      bookmarksBySubject.set(b.subject_id, (bookmarksBySubject.get(b.subject_id) ?? 0) + 1);
    }
    const bookmarksTopSubjects = Array.from(bookmarksBySubject.entries())
      .map(([id, count]) => ({
        id,
        name: subjectMap.get(id)?.name ?? "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    // Available levels for filter
    const levels = Array.from(new Set(subjects.map((s) => s.level ?? "professional")));

    return {
      userLevel,
      levels,
      today: {
        mcqs: countKind(todayList, "mcq_practice"),
        quizzes: countKind(todayList, "quiz"),
        mocks: countKind(todayList, "mock"),
        customExams: countKind(todayList, "custom_exam"),
        attempts: todayList.length,
        studyMinutes: Math.round(sumBy(todayList, (a) => a.duration_seconds) / 60),
        accuracy: accuracyOf(todayList),
        chaptersTouched: new Set(
          todayList.map((a) => a.chapter_id).filter(Boolean),
        ).size,
        streak,
      },
      week: {
        attempts: weekList.length,
        mcqs: countKind(weekList, "mcq_practice"),
        quizzes: countKind(weekList, "quiz"),
        mocks: countKind(weekList, "mock"),
        studyMinutes: Math.round(sumBy(weekList, (a) => a.duration_seconds) / 60),
        accuracy: accuracyOf(weekList),
        deltaAccuracy: accuracyOf(weekList) - accuracyOf(prevWeekList),
        deltaAttempts: weekList.length - prevWeekList.length,
        bars: weeklyBars,
      },
      month: {
        attempts: monthList.length,
        accuracy: accuracyOf(monthList),
        studyMinutes: Math.round(sumBy(monthList, (a) => a.duration_seconds) / 60),
        activeDays: new Set(
          monthList.map((a) => new Date(ts(a)).toISOString().slice(0, 10)),
        ).size,
      },
      heatmap,
      timeline,
      subjects: subjectAgg,
      chapters: chapterAgg,
      insights: { strongest, weakest, inactive },
      wrongQuestions: {
        unresolved: wrongUnresolved,
        resolved: wrongResolved,
        retries: wrongRetries,
        topSubjects: wrongTopSubjects,
      },
      bookmarks: {
        total: bookmarks.length,
        topSubjects: bookmarksTopSubjects,
      },
    };
  });
