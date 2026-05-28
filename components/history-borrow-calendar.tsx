"use client";

import { useMemo, useState } from "react";
import { APP_TIME_ZONE } from "@/lib/datetime";
import { formatDateTime } from "@/lib/utils";
import type { LoanRow } from "@/lib/types";

type HistoryBorrowCalendarProps = {
  loans: LoanRow[];
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EMPTY_LOANS: LoanRow[] = [];
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

function getTodayKey() {
  return toDayKey(getZonedParts(new Date()));
}

function getMonthKey(value: string | Date) {
  const parts = getZonedParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
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
    cells.push({ key: toDayKey({ year, month, day }), day });
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

function getLoanEndAt(loan: LoanRow) {
  const today = new Date();

  if (loan.returned_at) {
    return new Date(loan.returned_at).getTime() > today.getTime() ? today.toISOString() : loan.returned_at;
  }

  return today.toISOString();
}

function isLoanActiveOnDay(loan: LoanRow, dayKey: string) {
  const startKey = toDayKey(getZonedParts(loan.borrowed_at));
  const endKey = toDayKey(getZonedParts(getLoanEndAt(loan)));

  return startKey <= dayKey && endKey >= dayKey;
}

function getInitialMonth(loans: LoanRow[]) {
  const todayMonth = getMonthKey(new Date());

  if (loans.some((loan) => isLoanActiveOnDay(loan, getTodayKey()))) {
    return todayMonth;
  }

  return loans[0] ? getMonthKey(loans[0].borrowed_at) : todayMonth;
}

function getInitialDay(loans: LoanRow[], monthKey: string) {
  const todayKey = getTodayKey();

  if (todayKey.startsWith(monthKey) && loans.some((loan) => isLoanActiveOnDay(loan, todayKey))) {
    return todayKey;
  }

  const matchingLoan = loans.find((loan) => getMonthKey(loan.borrowed_at) === monthKey);

  if (matchingLoan) {
    return toDayKey(getZonedParts(matchingLoan.borrowed_at));
  }

  return `${monthKey}-01`;
}

function getVehicleLabel(loan: LoanRow) {
  return [loan.vehicle?.plate_number, loan.vehicle?.model].filter(Boolean).join(" - ") || "Unknown vehicle";
}

function formatExpectedReturn(loan: LoanRow) {
  if (loan.is_long_term) {
    return "Long term";
  }

  return loan.expected_return_at ? formatDateTime(loan.expected_return_at) : "-";
}

function groupLoansByVehicle(loans: LoanRow[]) {
  const grouped = new Map<string, { vehicleLabel: string; loans: LoanRow[] }>();

  for (const loan of loans) {
    const existing = grouped.get(loan.vehicle_id);

    if (existing) {
      existing.loans.push(loan);
    } else {
      grouped.set(loan.vehicle_id, {
        vehicleLabel: getVehicleLabel(loan),
        loans: [loan],
      });
    }
  }

  return Array.from(grouped.entries())
    .map(([vehicleId, group]) => ({
      vehicleId,
      vehicleLabel: group.vehicleLabel,
      loans: [...group.loans].sort((first, second) => new Date(first.borrowed_at).getTime() - new Date(second.borrowed_at).getTime()),
    }))
    .sort((first, second) => first.vehicleLabel.localeCompare(second.vehicleLabel));
}

export function HistoryBorrowCalendar({ loans }: HistoryBorrowCalendarProps) {
  const initialMonth = useMemo(() => getInitialMonth(loans), [loans]);
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [selectedDay, setSelectedDay] = useState(() => getInitialDay(loans, initialMonth));
  const [yearText, monthText] = currentMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const monthLabel = MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
  const monthWeeks = useMemo(() => chunkWeeks(getMonthMatrix(year, month), 7), [year, month]);
  const loansByDay = useMemo(() => {
    const grouped = new Map<string, LoanRow[]>();

    for (const week of monthWeeks) {
      for (const cell of week) {
        if (!cell) {
          continue;
        }

        grouped.set(cell.key, loans.filter((loan) => isLoanActiveOnDay(loan, cell.key)));
      }
    }

    return grouped;
  }, [loans, monthWeeks]);
  const selectedLoans = loansByDay.get(selectedDay) ?? EMPTY_LOANS;
  const selectedVehicleGroups = useMemo(() => groupLoansByVehicle(selectedLoans), [selectedLoans]);
  const todayKey = getTodayKey();
  const todayMonthKey = getMonthKey(new Date());
  const canMoveNext = currentMonth < todayMonthKey;

  function moveMonth(delta: number) {
    const targetMonth = addMonth(currentMonth, delta);
    const safeTargetMonth = targetMonth > todayMonthKey ? todayMonthKey : targetMonth;

    setCurrentMonth(safeTargetMonth);
    setSelectedDay(safeTargetMonth === todayMonthKey ? todayKey : `${safeTargetMonth}-01`);
  }

  return (
    <section className="historyCalendarSection">
      <div className="sectionHeader">
        <div>
          <h2>Calendar view</h2>
          <p className="muted">Each day shows how many vehicles were out on loan. Select a day to view the records.</p>
        </div>
      </div>

      <div className="calendarMonthNav">
        <button className="secondaryButton" onClick={() => moveMonth(-1)} type="button">
          Previous
        </button>
        <h4>{monthLabel}</h4>
        <button className="secondaryButton" disabled={!canMoveNext} onClick={() => moveMonth(1)} type="button">
          Next
        </button>
      </div>

      <div className="historyCalendar">
        <div className="calendarGrid calendarGrid-header">
          {WEEKDAY_LABELS.map((label) => (
            <div className="calendarWeekday" key={label}>
              {label}
            </div>
          ))}
        </div>

        <div className="historyCalendarGrid">
          {monthWeeks.flat().map((cell, index) => {
            if (!cell) {
              return <div className="historyCalendarDay historyCalendarDay-empty" key={`${currentMonth}-empty-${index}`} />;
            }

            const dayLoans = loansByDay.get(cell.key) ?? [];
            const vehicleCount = new Set(dayLoans.map((loan) => loan.vehicle_id)).size;
            const isSelected = selectedDay === cell.key;
            const isToday = cell.key === todayKey;
            const isFuture = cell.key > todayKey;

            return (
              <button
                className={`historyCalendarDay${vehicleCount > 0 ? " historyCalendarDay-hasLoans" : ""}${isSelected ? " historyCalendarDay-selected" : ""}${isToday ? " historyCalendarDay-today" : ""}${isFuture ? " historyCalendarDay-future" : ""}`}
                disabled={isFuture}
                key={cell.key}
                onClick={() => setSelectedDay(cell.key)}
                type="button"
              >
                <span className="calendarDayNumber">{cell.day}</span>
                {vehicleCount > 0 ? <span className="historyCalendarCount">{vehicleCount} out</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="historyCalendarDetails">
        <h3>{selectedDay}</h3>
        {selectedVehicleGroups.length === 0 ? (
          <div className="emptyState">No vehicles were on loan for this day.</div>
        ) : (
          <div className="cardsGrid">
            {selectedVehicleGroups.map((group) => (
              <article className="vehicleCard historyVehicleCard" key={group.vehicleId}>
                <h3>{group.vehicleLabel}</h3>
                <div className="historyLoanList">
                  {group.loans.map((loan) => (
                    <div className="historyLoanItem" key={loan.id}>
                      <div className="historyLoanPeople">
                        <strong>{loan.driver_name}</strong>
                        <span>{loan.borrower_email}</span>
                      </div>
                      <div className="historyLoanTimes">
                        <span>Borrowed: {formatDateTime(loan.borrowed_at)}</span>
                        <span>Expected return: {formatExpectedReturn(loan)}</span>
                        <span>Returned: {loan.returned_at ? formatDateTime(loan.returned_at) : "Not returned yet"}</span>
                      </div>
                      <span className="historyLoanPurpose">{loan.purpose}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
