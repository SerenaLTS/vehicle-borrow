import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(`${to}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !(await getIsAdmin(supabase, user.id))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data, error } = await supabase
    .from("booking_cancellations")
    .select("booking_id, vehicle_plate_number, vehicle_model, booked_by_email, starts_at, ends_at, is_long_term, booking_comments, cancelled_by_email, cancelled_by_admin, cancellation_note, cancelled_at")
    .order("cancelled_at", { ascending: false })
    .limit(5000);

  if (error) return new NextResponse(error.message, { status: 500 });

  const rows = (data ?? []).filter((row) => {
    const searchable = [row.vehicle_plate_number, row.vehicle_model, row.booked_by_email, row.cancelled_by_email, row.cancellation_note, row.booking_comments].filter(Boolean).join(" ").toLowerCase();
    const time = new Date(row.cancelled_at).getTime();
    return (!query || searchable.includes(query)) && time >= fromTime && time <= toTime;
  });
  const header = ["booking_id", "plate_number", "model", "booked_by", "starts_at", "ends_at", "long_term", "booking_comments", "cancelled_by", "cancelled_by_admin", "cancellation_note", "cancelled_at"];
  const lines = [header.join(","), ...rows.map((row) => [row.booking_id, row.vehicle_plate_number, row.vehicle_model, row.booked_by_email, row.starts_at, row.ends_at, row.is_long_term, row.booking_comments, row.cancelled_by_email, row.cancelled_by_admin, row.cancellation_note, row.cancelled_at].map(escapeCsv).join(","))];

  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="booking-cancellations.csv"' },
  });
}
