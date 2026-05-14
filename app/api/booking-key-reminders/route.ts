import { NextResponse } from "next/server";
import { sendKeyCollectionReminderEmail } from "@/lib/booking-notifications";
import { APP_TIME_ZONE, parseDateTimeLocalToUtcIso } from "@/lib/datetime";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type ReminderBookingRow = {
  id: string;
  vehicle_id: string;
  booked_by_email: string;
  starts_at: string;
  ends_at: string;
  comments: string | null;
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
  const { isSydneyNineAmHour, windowStart, windowEnd } = getSydneyNineAmWindow(now);

  if (process.env.NODE_ENV === "production" && !isSydneyNineAmHour) {
    return NextResponse.json({ skipped: true, reason: "Not Sydney 9am hour.", windowStart, windowEnd, checked: 0, sent: [], failed: [] });
  }

  const { data, error } = await supabase
    .from("vehicle_bookings")
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, comments")
    .gte("starts_at", windowStart)
    .lt("starts_at", windowEnd)
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

  return NextResponse.json({ windowStart, windowEnd, checked: bookings.length, sent, failed });
}
