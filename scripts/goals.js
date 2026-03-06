export const DEFAULT_DAILY_GOAL = 20;

function localDateKey(date) {
  const current = new Date(date);
  return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(
    current.getDate(),
  ).padStart(2, "0")}`;
}

export function getTodayKey() {
  return localDateKey(Date.now());
}

export function calculateGoalProgress(targetPages, statsRecord) {
  const safeTarget = Math.max(1, Number(targetPages) || DEFAULT_DAILY_GOAL);
  const pagesRead = statsRecord?.pageKeys?.length || 0;
  const percent = Math.min(100, Math.round((pagesRead / safeTarget) * 100));
  const remaining = Math.max(0, safeTarget - pagesRead);

  return {
    targetPages: safeTarget,
    pagesRead,
    percent,
    remaining,
    message:
      remaining === 0
        ? "Goal complete for today."
        : `${remaining} page${remaining === 1 ? "" : "s"} remaining today`,
  };
}

export function calculateStudyStreak(statsRecords) {
  const recordsByDay = new Map(
    statsRecords
      .filter((record) => (record.pageKeys?.length || 0) > 0 || (record.sessionCount || 0) > 0)
      .map((record) => [record.date, record]),
  );

  let streak = 0;
  const cursor = new Date();

  while (true) {
    const key = localDateKey(cursor);
    if (!recordsByDay.has(key)) {
      break;
    }

    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export function sumTotalPagesRead(statsRecords) {
  return statsRecords.reduce((total, record) => total + (record.pageKeys?.length || 0), 0);
}

export function sumTotalSessionCount(statsRecords) {
  return statsRecords.reduce((total, record) => total + (record.sessionCount || 0), 0);
}

export function sumTotalSessionHours(statsRecords) {
  const totalMs = statsRecords.reduce((total, record) => total + (record.totalSessionMs || 0), 0);
  return Number((totalMs / 3_600_000).toFixed(1));
}
