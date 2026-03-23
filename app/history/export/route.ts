import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function escapeCsv(value: string | number | null) {
  const cell = value === null ? "" : String(value);
  return `"${cell.replaceAll('"', '""')}"`;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data, error } = await supabase
    .from("vehicle_loans")
    .select("driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, returned_at, borrower_email, vehicle:vehicles(plate_number, model)")
    .order("borrowed_at", { ascending: false });

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const header = [
    "plate_number",
    "model",
    "borrower_email",
    "driver_name",
    "purpose",
    "borrowed_at",
    "returned_at",
    "start_odometer",
    "end_odometer",
    "borrow_notes",
    "return_notes",
  ];

  const lines = [
    header.join(","),
    ...(data ?? []).map((row) =>
      [
        escapeCsv((row.vehicle as { plate_number?: string } | null)?.plate_number ?? ""),
        escapeCsv((row.vehicle as { model?: string } | null)?.model ?? ""),
        escapeCsv((row as { borrower_email?: string | null }).borrower_email ?? ""),
        escapeCsv((row as { driver_name?: string | null }).driver_name ?? ""),
        escapeCsv((row as { purpose?: string | null }).purpose ?? ""),
        escapeCsv((row as { borrowed_at?: string | null }).borrowed_at ?? ""),
        escapeCsv((row as { returned_at?: string | null }).returned_at ?? ""),
        escapeCsv((row as { start_odometer?: number | null }).start_odometer ?? ""),
        escapeCsv((row as { end_odometer?: number | null }).end_odometer ?? ""),
        escapeCsv((row as { borrow_notes?: string | null }).borrow_notes ?? ""),
        escapeCsv((row as { return_notes?: string | null }).return_notes ?? ""),
      ].join(","),
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vehicle-history.csv"`,
    },
  });
}
