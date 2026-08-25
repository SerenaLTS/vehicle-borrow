import { NextResponse } from "next/server";
import { sendRegistrationExpiryReminderEmail } from "@/lib/booking-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  return cronSecret ? request.headers.get("authorization") === `Bearer ${cronSecret}` : process.env.NODE_ENV !== "production";
}

function sydneyDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function dateDifferenceInDays(expiry: string, today: string) {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Reminder service is temporarily unavailable." }, { status: 503 });

  const supabase = createAdminClient();
  const today = sydneyDateString();
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, plate_number, model, registration_state, registration_expires_on, reminder_days, registration_reminder_last_sent_on")
    .not("registration_expires_on", "is", null)
    .is("registration_reminder_acknowledged_at", null);

  if (error) {
    console.error("[rego-reminders:load]", error.message);
    return NextResponse.json({ error: "Unable to process reminders right now." }, { status: 500 });
  }

  const due = (data ?? []).filter((vehicle) => {
    if (!vehicle.registration_expires_on || vehicle.registration_reminder_last_sent_on === today) return false;
    return dateDifferenceInDays(vehicle.registration_expires_on, today) <= (vehicle.reminder_days ?? 30);
  });
  let sent = 0;
  let failed = 0;

  for (const vehicle of due) {
    const { data: claimed, error: claimError } = await supabase.from("vehicles")
      .update({ registration_reminder_last_sent_on: today })
      .eq("id", vehicle.id)
      .is("registration_reminder_acknowledged_at", null)
      .or(`registration_reminder_last_sent_on.is.null,registration_reminder_last_sent_on.neq.${today}`)
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) continue;
    try {
      await sendRegistrationExpiryReminderEmail({
        supabase,
        reminder: {
          vehicleId: vehicle.id, plateNumber: vehicle.plate_number, model: vehicle.model,
          registrationState: vehicle.registration_state, expiresOn: vehicle.registration_expires_on,
          daysRemaining: dateDifferenceInDays(vehicle.registration_expires_on, today),
        },
      });
      sent += 1;
    } catch (sendError) {
      failed += 1;
      console.error("[rego-reminders:send]", sendError instanceof Error ? sendError.message : sendError);
      await supabase.from("vehicles").update({ registration_reminder_last_sent_on: null }).eq("id", vehicle.id).eq("registration_reminder_last_sent_on", today);
    }
  }

  return NextResponse.json({ processed: due.length, sent, failed });
}
