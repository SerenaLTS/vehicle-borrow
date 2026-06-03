import { NextResponse } from "next/server";
import { sendBookingBorrowReminderEmail, sendBorrowOverdueReminderEmail, sendKeyCollectionReminderEmail } from "@/lib/booking-notifications";
import { APP_TIME_ZONE, parseDateTimeLocalToUtcIso } from "@/lib/datetime";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type ReminderBookingRow = {
  id: string;
  vehicle_id: string;
  booked_by_email: string;
  starts_at: string;
  ends_at: string | null;
  is_long_term: boolean;
  comments: string | null;
};

type OverdueLoanRow = {
  id: string;
  vehicle_id: string;
  borrower_email: string;
  driver_name: string;
  purpose: string;
  borrowed_at: string;
  expected_return_at: string;
};

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

function getSydneyParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
  };
}

function getSydneyDateString(date: Date) {
  const parts = getSydneyParts(date);

  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getSydneyNineAmWindow(date: Date) {
  const parts = getSydneyParts(date);
  const startLocal = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T09:00`;
  const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const endLocal = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay.getUTCDate()).padStart(2, "0")}T09:00`;

  return {
    isSydneyNineAmHour: parts.hour === 9,
    windowStart: parseDateTimeLocalToUtcIso(startLocal) ?? date.toISOString(),
    windowEnd: parseDateTimeLocalToUtcIso(endLocal) ?? new Date(date.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const todaySydney = getSydneyDateString(now);
  const { isSydneyNineAmHour, windowStart, windowEnd } = getSydneyNineAmWindow(now);

  if (process.env.NODE_ENV === "production" && !isSydneyNineAmHour) {
    return NextResponse.json({ skipped: true, reason: "Not Sydney 9am hour.", windowStart, windowEnd, checked: 0, sent: [], failed: [] });
  }

  const { data, error } = await supabase
    .from("vehicle_bookings")
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, is_long_term, comments")
    .gte("starts_at", windowStart)
    .lt("starts_at", windowEnd)
    .eq("is_long_term", false)
    .is("key_collection_reminded_at", null)
    .order("starts_at", { ascending: true })
    .limit(25);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const bookings = (data ?? []) as ReminderBookingRow[];
  const sent: string[] = [];
  const failed: Array<{ bookingId: string; error: string }> = [];

  for (const booking of bookings) {
    try {
      const sentReminder = await sendKeyCollectionReminderEmail({
        supabase,
        booking: {
          bookingId: booking.id,
          vehicleId: booking.vehicle_id,
          bookedByEmail: booking.booked_by_email,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          isLongTerm: booking.is_long_term,
          comments: booking.comments,
        },
      });

      if (!sentReminder) {
        continue;
      }

      const { error: updateError } = await supabase
        .from("vehicle_bookings")
        .update({ key_collection_reminded_at: new Date().toISOString() })
        .eq("id", booking.id)
        .is("key_collection_reminded_at", null);

      if (updateError) {
        throw new Error(updateError.message);
      }

      sent.push(booking.id);
    } catch (reminderError) {
      failed.push({
        bookingId: booking.id,
        error: reminderError instanceof Error ? reminderError.message : "Unknown reminder error",
      });
    }
  }

  const { data: activeBookingData, error: activeBookingError } = await supabase
    .from("vehicle_bookings")
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, is_long_term, comments")
    .lte("starts_at", nowIso)
    .or(`ends_at.gt.${nowIso},is_long_term.eq.true`)
    .or(`borrow_click_reminded_on.is.null,borrow_click_reminded_on.neq.${todaySydney}`)
    .order("starts_at", { ascending: true })
    .limit(25);

  if (activeBookingError) {
    return NextResponse.json({ error: activeBookingError.message }, { status: 500 });
  }

  const activeBookings = (activeBookingData ?? []) as ReminderBookingRow[];
  const activeBookingSent: string[] = [];
  const activeBookingFailed: Array<{ bookingId: string; error: string }> = [];

  for (const booking of activeBookings) {
    try {
      const sentReminder = await sendBookingBorrowReminderEmail({
        supabase,
        booking: {
          bookingId: booking.id,
          vehicleId: booking.vehicle_id,
          bookedByEmail: booking.booked_by_email,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          isLongTerm: booking.is_long_term,
          comments: booking.comments,
        },
      });

      if (!sentReminder) {
        continue;
      }

      const { error: updateError } = await supabase
        .from("vehicle_bookings")
        .update({ borrow_click_reminded_on: todaySydney })
        .eq("id", booking.id)
        .or(`borrow_click_reminded_on.is.null,borrow_click_reminded_on.neq.${todaySydney}`);

      if (updateError) {
        throw new Error(updateError.message);
      }

      activeBookingSent.push(booking.id);
    } catch (reminderError) {
      activeBookingFailed.push({
        bookingId: booking.id,
        error: reminderError instanceof Error ? reminderError.message : "Unknown active booking reminder error",
      });
    }
  }

  const { data: overdueLoanData, error: overdueLoanError } = await supabase
    .from("vehicle_loans")
    .select("id, vehicle_id, borrower_email, driver_name, purpose, borrowed_at, expected_return_at")
    .is("returned_at", null)
    .eq("is_long_term", false)
    .lt("expected_return_at", now.toISOString())
    .is("borrow_overdue_reminded_at", null)
    .order("expected_return_at", { ascending: true })
    .limit(25);

  if (overdueLoanError) {
    return NextResponse.json({ error: overdueLoanError.message }, { status: 500 });
  }

  const overdueLoans = (overdueLoanData ?? []) as OverdueLoanRow[];
  const overdueSent: string[] = [];
  const overdueFailed: Array<{ loanId: string; error: string }> = [];

  for (const loan of overdueLoans) {
    try {
      const sentReminder = await sendBorrowOverdueReminderEmail({
        supabase,
        loan: {
          loanId: loan.id,
          vehicleId: loan.vehicle_id,
          borrowerEmail: loan.borrower_email,
          driverName: loan.driver_name,
          purpose: loan.purpose,
          borrowedAt: loan.borrowed_at,
          expectedReturnAt: loan.expected_return_at,
        },
      });

      if (!sentReminder) {
        continue;
      }

      const { error: updateError } = await supabase
        .from("vehicle_loans")
        .update({ borrow_overdue_reminded_at: new Date().toISOString() })
        .eq("id", loan.id)
        .is("borrow_overdue_reminded_at", null);

      if (updateError) {
        throw new Error(updateError.message);
      }

      overdueSent.push(loan.id);
    } catch (reminderError) {
      overdueFailed.push({
        loanId: loan.id,
        error: reminderError instanceof Error ? reminderError.message : "Unknown borrow overdue reminder error",
      });
    }
  }

  return NextResponse.json({
    windowStart,
    windowEnd,
    bookingKeyReminders: { checked: bookings.length, sent, failed },
    bookingBorrowReminders: { checked: activeBookings.length, sent: activeBookingSent, failed: activeBookingFailed },
    borrowOverdueReminders: { checked: overdueLoans.length, sent: overdueSent, failed: overdueFailed },
  });
}
