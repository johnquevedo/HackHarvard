const DAY_MS = 24 * 60 * 60 * 1000;

function isoDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addUtcDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function utcWeekday(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00.000Z`).getUTCDay();
}

export function resolveTimeframe(
  kind: string,
  now: Date,
  tz: string,
): { from: string; to: string } {
  const today = isoDateInTimeZone(now, tz);

  if (kind === "this_weekend") {
    const weekday = utcWeekday(today);
    const daysUntilSaturday = (6 - weekday + 7) % 7;
    const saturday = addUtcDays(today, daysUntilSaturday);
    return { from: saturday, to: addUtcDays(saturday, 1) };
  }

  if (kind === "this_week") {
    const weekday = utcWeekday(today);
    const daysUntilSunday = (7 - weekday) % 7;
    return { from: today, to: addUtcDays(today, daysUntilSunday) };
  }

  if (kind === "this_month") {
    const [year, month] = today.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year!, month!, 1));
    nextMonth.setUTCDate(0);
    return { from: today, to: nextMonth.toISOString().slice(0, 10) };
  }

  if (kind === "flexible") {
    return { from: today, to: addUtcDays(today, 30) };
  }

  return { from: today, to: addUtcDays(today, 14) };
}

export function roundBudgetBand(cents: number | null): number | null {
  if (cents === null) {
    return null;
  }
  return Math.ceil(cents / 2500) * 2500;
}

export const ONE_DAY_MS = DAY_MS;
