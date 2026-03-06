import { countNotesByType } from "./notes.js";

export const DAILY_GOAL_ID = "pages-per-day";
export const DEFAULT_DAILY_GOAL = 12;

export function dayStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeGoal(goalRecord) {
  const targetPages = Math.max(
    1,
    Number(goalRecord?.targetPages) || DEFAULT_DAILY_GOAL,
  );

  return {
    id: DAILY_GOAL_ID,
    targetPages,
    updatedAt: goalRecord?.updatedAt ?? new Date().toISOString(),
  };
}

export function calculateGoalProgress(targetPages, pagesToday) {
  const safeTarget = Math.max(1, Number(targetPages) || DEFAULT_DAILY_GOAL);
  const safePagesToday = Math.max(0, Number(pagesToday) || 0);
  const percent = Math.min(100, Math.round((safePagesToday / safeTarget) * 100));
  const remaining = Math.max(0, safeTarget - safePagesToday);

  let copy = "Set a daily pace that you can actually repeat.";

  if (safePagesToday === 0) {
    copy = `You still have ${safeTarget} pages left today.`;
  } else if (safePagesToday < safeTarget) {
    copy = `${remaining} page${remaining === 1 ? "" : "s"} left to hit today's target.`;
  } else {
    const surplus = safePagesToday - safeTarget;
    copy =
      surplus > 0
        ? `Goal met with ${surplus} extra page${surplus === 1 ? "" : "s"} today.`
        : "Goal met for today.";
  }

  return {
    target: safeTarget,
    pagesToday: safePagesToday,
    percent,
    remaining,
    copy,
  };
}

export function calculateStreakDays(pageVisitRecords) {
  const distinctDates = new Set(
    pageVisitRecords
      .filter((record) => record.type === "page-visit")
      .map((record) => record.date),
  );

  let streak = 0;
  const cursor = new Date();

  while (distinctDates.has(dayStamp(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export function formatStudyTime(durationMs) {
  const totalMinutes = Math.max(0, Math.round((Number(durationMs) || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) {
    return `${minutes}m`;
  }

  if (!minutes) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export function buildStudyStats({ pageVisits = [], sessions = [], notes = [] }) {
  const distinctPageVisits = new Map();

  for (const record of pageVisits) {
    distinctPageVisits.set(record.id, record);
  }

  const activeDays = new Set([...distinctPageVisits.values()].map((record) => record.date)).size;
  const totalSessions = sessions.length;
  const totalStudyTimeMs = sessions.reduce(
    (sum, session) => sum + Math.max(0, Number(session.durationMs) || 0),
    0,
  );

  return {
    totalPagesRead: distinctPageVisits.size,
    totalSessions,
    streakDays: calculateStreakDays([...distinctPageVisits.values()]),
    totalNotes: notes.length,
    activeDays,
    totalStudyTimeMs,
    noteCounts: countNotesByType(notes),
  };
}
