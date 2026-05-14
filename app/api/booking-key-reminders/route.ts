import { NextResponse } from "next/server";
import { sendKeyCollectionReminderEmail } from "@/lib/booking-notifications";
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

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

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
