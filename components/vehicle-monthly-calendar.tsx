"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { APP_TIME_ZONE } from "@/lib/datetime";

import type { VehicleCalendarEvent } from "@/lib/vehicle-calendar-cache";

type VehicleMonthlyCalendarProps = {
  initialMonth?: string;
  events: VehicleCalendarEvent[];
  crossYearNextHref?: string;
  crossYearPreviousHref?: string;
  loadedYear?: number;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-AU", {
  timeZone: APP_TIME_ZONE,
  month: "long",
  year: "numeric",
});

function getZonedParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

function toDayKey(parts: { year: number; month: number; day: number }) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function compareDayKeys(left: string, right: string) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getMonthMatrix(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: Array<{ key: string; day: number } | null> = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      key: toDayKey({ year, month, day }),
      day,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function chunkWeeks<T>(cells: T[], size: number) {
  const weeks: T[][] = [];

  for (let index = 0; index < cells.length; index += size) {
    weeks.push(cells.slice(index, index + size));
  }

  return weeks;
}

function addMonth(monthKey: string, delta: number) {
  const [yearText, monthText] = monthKey.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildInitialMonth(events: VehicleCalendarEvent[]) {
  const today = getZonedParts(new Date());
  const todayKey = `${today.year}-${String(today.month).padStart(2, "0")}`;

  if (events.length === 0) {
    return todayKey;
  }

  const coveredMonths = new Set<string>();

  for (const event of events) {
    const start = getZonedParts(event.startAt);
    const end = getZonedParts(event.endAt ?? event.startAt);
    let year = start.year;
    let month = start.month;

    while (year < end.year || (year === end.year && month <= end.month)) {
      coveredMonths.add(`${year}-${String(month).padStart(2, "0")}`);
      month += 1;

      if (month === 13) {
        month = 1;
        year += 1;
      }
    }
  }

  if (coveredMonths.has(todayKey)) {
    return todayKey;
  }

  return Array.from(coveredMonths).sort()[0] ?? todayKey;
}

function getWeekSegments(
  week: Array<{ key: string; day: number } | null>,
  events: Array<VehicleCalendarEvent & { startKey: string; endKey: string }>,
) {
  const weekStartKey = week.find((cell) => cell)?.key;
  const weekEndKey = [...week].reverse().find((cell) => cell)?.key;

  if (!weekStartKey || !weekEndKey) {
    return [];
  }

  const segments = events
    .filter((event) => compareDayKeys(event.startKey, weekEndKey) <= 0 && compareDayKeys(event.endKey, weekStartKey) >= 0)
    .map((event) => {
      let startColumn = 1;
      let endColumn = 7;

      for (let index = 0; index < week.length; index += 1) {
        const cell = week[index];
        if (cell && compareDayKeys(cell.key, event.startKey) >= 0) {
          startColumn = index + 1;
          break;
        }
      }

      for (let index = week.length - 1; index >= 0; index -= 1) {
        const cell = week[index];
        if (cell && compareDayKeys(cell.key, event.endKey) <= 0) {
          endColumn = index + 1;
          break;
        }
      }

      return { ...event, startColumn, endColumn };
    })
    .sort((left, right) => {
      if (left.startColumn !== right.startColumn) {
        return left.startColumn - right.startColumn;
      }

      return left.endColumn - right.endColumn;
    });

  const lanes: typeof segments[] = [];

  for (const segment of segments) {
    let assigned = false;

    for (const lane of lanes) {
      const overlaps = lane.some(
        (existing) => !(segment.endColumn < existing.startColumn || segment.startColumn > existing.endColumn),
      );

      if (!overlaps) {
        lane.push(segment);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      lanes.push([segment]);
    }
  }

  return lanes;
}

export function VehicleMonthlyCalendar({
  initialMonth,
  events,
  crossYearNextHref,
  crossYearPreviousHref,
  loadedYear,
}: VehicleMonthlyCalendarProps) {
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(initialMonth ?? buildInitialMonth(events));
  const resolvedMonth = currentMonth;
  const [yearText, monthText] = resolvedMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const monthLabel = MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
  const monthWeeks = useMemo(() => chunkWeeks(getMonthMatrix(year, month), 7), [year, month]);
  const normalizedEvents = useMemo(
    () =>
      events.map((event) => ({
        ...event,
        startKey: toDayKey(getZonedParts(event.startAt)),
        endKey: toDayKey(getZonedParts(event.endAt ?? event.startAt)),
      })),
    [events],
  );
  const effectiveLoadedYear = loadedYear ?? Number((initialMonth ?? buildInitialMonth(events)).slice(0, 4));

  function moveMonth(delta: number) {
    const targetMonth = addMonth(resolvedMonth, delta);
    const targetYear = Number(targetMonth.slice(0, 4));

    if (targetYear === effectiveLoadedYear) {
      setCurrentMonth(targetMonth);
      return;
    }

    if (delta < 0 && crossYearPreviousHref) {
      router.push(crossYearPreviousHref);
      return;
    }

    if (delta > 0 && crossYearNextHref) {
      router.push(crossYearNextHref);
      return;
    }

    setCurrentMonth(targetMonth);
  }

  return (
    <>
      <div className="calendarLegend">
        <span className="calendarLegendItem">
          <span className="calendarLegendSwatch calendarLegendSwatch-booked" />
          Booked
        </span>
        <span className="calendarLegendItem">
          <span className="calendarLegendSwatch calendarLegendSwatch-borrowed" />
          Borrowed
        </span>
      </div>

      <div className="calendarMonthNav">
        <button className="secondaryButton" onClick={() => moveMonth(-1)} type="button">
          Previous
        </button>
        <h4>{monthLabel}</h4>
        <button className="secondaryButton" onClick={() => moveMonth(1)} type="button">
          Next
        </button>
      </div>

      {events.length === 0 ? <div className="calendarNoEventsMonth">No bookings or loans on record for this vehicle yet.</div> : null}

      <div className="calendarMonth">
        <div className="calendarGrid calendarGrid-header">
          {WEEKDAY_LABELS.map((label) => (
            <div className="calendarWeekday" key={label}>
              {label}
            </div>
          ))}
        </div>

        <div className="calendarWeekStack">
          {monthWeeks.map((week, weekIndex) => {
            const lanes = getWeekSegments(week, normalizedEvents);

            return (
              <section className="calendarWeek" key={`${resolvedMonth}-week-${weekIndex}`}>
                <div className="calendarGrid">
                  {week.map((cell, index) =>
                    cell ? (
                      <div className="calendarCell" key={cell.key}>
                        <span className="calendarDayNumber">{cell.day}</span>
                      </div>
                    ) : (
                      <div className="calendarCell calendarCell-empty" key={`${resolvedMonth}-empty-${weekIndex}-${index}`} />
                    ),
                  )}
                </div>

                {lanes.length > 0 ? (
                  <div className="calendarLaneStack">
                    {lanes.map((lane, laneIndex) => (
                      <div className="calendarGrid calendarLane" key={`${resolvedMonth}-${weekIndex}-lane-${laneIndex}`}>
                        {lane.map((segment) => (
                          <div
                            className={`calendarEvent calendarEvent-${segment.kind}`}
                            key={`${segment.kind}-${segment.id}-${resolvedMonth}-${weekIndex}`}
                            style={{ gridColumn: `${segment.startColumn} / ${segment.endColumn + 1}` }}
                            title={`${segment.kind === "booked" ? "Booked" : "Borrowed"} • ${segment.actor}`}
                          >
                            <span>{segment.actor}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="calendarNoEvents">No bookings or loans this week.</div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
