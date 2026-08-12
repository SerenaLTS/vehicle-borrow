import { parseDateTimeLocalToUtcIso } from "@/lib/datetime";

function addOneCalendarDay(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const nextDay = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));

  return `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay.getUTCDate()).padStart(2, "0")}`;
}

export function getHistoryDateBounds(from: string, to: string) {
  const nextDay = to ? addOneCalendarDay(to) : null;

  return {
    fromIso: from ? parseDateTimeLocalToUtcIso(`${from}T00:00`) : null,
    toExclusiveIso: nextDay ? parseDateTimeLocalToUtcIso(`${nextDay}T00:00`) : null,
  };
}

export function getHistoryMonthBounds(monthKey: string) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) return null;

  const nextMonth = new Date(Date.UTC(year, month, 1));
  const nextMonthKey = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`;

  return {
    monthStartIso: parseDateTimeLocalToUtcIso(`${monthKey}-01T00:00`),
    monthEndExclusiveIso: parseDateTimeLocalToUtcIso(`${nextMonthKey}-01T00:00`),
  };
}
