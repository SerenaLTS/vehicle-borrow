"use client";

import { useMemo, useState } from "react";
import { APP_TIME_ZONE } from "@/lib/datetime";
import { formatDateTime } from "@/lib/utils";
import type { LoanRow } from "@/lib/types";

type HistoryBorrowCalendarProps = {
  loans: LoanRow[];
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
  if (loan.returned_at) {
    return loan.returned_at;
  }

  const now = new Date();
  const expectedReturn = loan.expected_return_at ? new Date(loan.expected_return_at) : null;

  if (loan.expected_return_at && expectedReturn && expectedReturn.getTime() > now.getTime()) {
    return loan.expected_return_at;
  }

  return now.toISOString();
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

function getVehicleLabel(loan: LoanRow) {
  return [loan.vehicle?.plate_number, loan.vehicle?.model].filter(Boolean).join(" - ") || "Unknown vehicle";
}

export function HistoryBorrowCalendar({ loans }: HistoryBorrowCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => getInitialMonth(loans));
  const [selectedDay, setSelectedDay] = useState(() => getTodayKey());
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
  const selectedLoans = loansByDay.get(selectedDay) ?? [];

  function moveMonth(delta: number) {
    const targetMonth = addMonth(currentMonth, delta);
    setCurrentMonth(targetMonth);
    setSelectedDay(`${targetMonth}-01`);
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
        <button className="secondaryButton" onClick={() => moveMonth(1)} type="button">
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

            return (
              <button
                className={`historyCalendarDay${vehicleCount > 0 ? " historyCalendarDay-hasLoans" : ""}${isSelected ? " historyCalendarDay-selected" : ""}`}
                key={cell.key}
                onClick={() => setSelectedDay(cell.key)}
                type="button"
              >
                <span className="calendarDayNumber">{cell.day}</span>
                <span className="historyCalendarCount">{vehicleCount > 0 ? `${vehicleCount} out` : "-"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="historyCalendarDetails">
        <h3>{selectedDay}</h3>
        {selectedLoans.length === 0 ? (
          <div className="emptyState">No vehicles were on loan for this day.</div>
        ) : (
          <div className="cardsGrid">
            {selectedLoans.map((loan) => (
              <article className="vehicleCard" key={loan.id}>
                <h3>{getVehicleLabel(loan)}</h3>
                <div className="vehicleMeta">
                  <span>Borrower: {loan.borrower_email}</span>
                  <span>Driver: {loan.driver_name}</span>
                  <span>Purpose: {loan.purpose}</span>
                  <span>Borrowed: {formatDateTime(loan.borrowed_at)}</span>
                  <span>Expected return: {formatDateTime(loan.expected_return_at)}</span>
                  <span>Returned: {loan.returned_at ? formatDateTime(loan.returned_at) : "Not returned yet"}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
