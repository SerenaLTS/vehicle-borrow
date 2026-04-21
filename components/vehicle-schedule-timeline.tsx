import { APP_TIME_ZONE } from "@/lib/datetime";

type VehicleScheduleEvent = {
  id: string;
  kind: "booked" | "borrowed";
  actor: string;
  startAt: string;
  endAt: string | null;
  notes: string | null;
};

type VehicleScheduleTimelineProps = {
  events: VehicleScheduleEvent[];
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

function buildCoveredMonths(events: VehicleScheduleEvent[]) {
  const months = new Set<string>();

  for (const event of events) {
    const start = getZonedParts(event.startAt);
    const end = getZonedParts(event.endAt ?? event.startAt);
    let year = start.year;
    let month = start.month;

    while (year < end.year || (year === end.year && month <= end.month)) {
      months.add(`${year}-${String(month).padStart(2, "0")}`);
      month += 1;

      if (month === 13) {
        month = 1;
        year += 1;
      }
    }
  }

  if (months.size === 0) {
    const today = getZonedParts(new Date());
    months.add(`${today.year}-${String(today.month).padStart(2, "0")}`);
  }

  return Array.from(months).sort().slice(0, 4);
}

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getMonthMatrix(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: Array<{ key: string; day: number; weekday: number } | null> = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      key: toDayKey({ year, month, day }),
      day,
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
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

function getWeekSegments(
  week: Array<{ key: string; day: number; weekday: number } | null>,
  events: Array<VehicleScheduleEvent & { startKey: string; endKey: string }>,
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

        if (!cell) {
          continue;
        }

        if (compareDayKeys(cell.key, event.startKey) >= 0) {
          startColumn = index + 1;
          break;
        }
      }

      for (let index = week.length - 1; index >= 0; index -= 1) {
        const cell = week[index];

        if (!cell) {
          continue;
        }

        if (compareDayKeys(cell.key, event.endKey) <= 0) {
          endColumn = index + 1;
          break;
        }
      }

      return {
        ...event,
        startColumn,
        endColumn,
      };
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

export function VehicleScheduleTimeline({ events }: VehicleScheduleTimelineProps) {
  if (events.length === 0) {
    return (
      <details className="timelineDisclosure">
        <summary>Monthly calendar</summary>
        <div className="timelineEmpty">No recent or upcoming bookings found for this vehicle.</div>
      </details>
    );
  }

  const months = buildCoveredMonths(events);
  const normalizedEvents = events.map((event) => {
    const startKey = toDayKey(getZonedParts(event.startAt));
    const endKey = toDayKey(getZonedParts(event.endAt ?? event.startAt));

    return {
      ...event,
      startKey,
      endKey,
    };
  });

  return (
    <details className="timelineDisclosure">
      <summary>Monthly calendar</summary>
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

      <div className="calendarMonthStack">
        {months.map((monthKey) => {
          const [yearText, monthText] = monthKey.split("-");
          const year = Number(yearText);
          const month = Number(monthText);
          const monthCells = getMonthMatrix(year, month);
          const monthWeeks = chunkWeeks(monthCells, 7);
          const monthLabel = MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));

          return (
            <section className="calendarMonth" key={monthKey}>
              <h4>{monthLabel}</h4>
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
                    <section className="calendarWeek" key={`${monthKey}-week-${weekIndex}`}>
                      <div className="calendarGrid">
                        {week.map((cell, index) => {
                          if (!cell) {
                            return <div className="calendarCell calendarCell-empty" key={`empty-${monthKey}-${weekIndex}-${index}`} />;
                          }

                          return (
                            <div className="calendarCell" key={cell.key}>
                              <span className="calendarDayNumber">{cell.day}</span>
                            </div>
                          );
                        })}
                      </div>
                      {lanes.length > 0 ? (
                        <div className="calendarLaneStack">
                          {lanes.map((lane, laneIndex) => (
                            <div className="calendarGrid calendarLane" key={`${monthKey}-${weekIndex}-lane-${laneIndex}`}>
                              {lane.map((segment) => (
                                <div
                                  className={`calendarEvent calendarEvent-${segment.kind}`}
                                  key={`${segment.kind}-${segment.id}-${monthKey}-${weekIndex}`}
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
            </section>
          );
        })}
      </div>
    </details>
  );
}
