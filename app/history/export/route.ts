import { NextResponse } from "next/server";
import { escapeCsvCell } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";

function getFilterParams(request: Request) {
  const url = new URL(request.url);

  return {
    query: (url.searchParams.get("q") ?? "").trim().toLowerCase(),
    from: (url.searchParams.get("from") ?? "").trim(),
    to: (url.searchParams.get("to") ?? "").trim(),
    status: (url.searchParams.get("status") ?? "").trim(),
  };
}

export async function GET(request: Request) {
  const { query, from, to, status } = getFilterParams(request);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data, error } = await supabase
    .from("vehicle_loans")
    .select("driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, is_long_term, returned_at, borrower_email, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)")
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
    "loan_status",
    "borrowed_at",
    "expected_return_at",
    "returned_at",
    "start_odometer",
    "end_odometer",
    "borrow_notes",
    "return_notes",
  ];

  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(`${to}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
  const now = Date.now();
  const filteredRows = (data ?? []).filter((row) => {
    const vehicle = row.vehicle as { plate_number?: string | null; model?: string | null } | null;
    const borrowedAt = (row as { borrowed_at?: string | null }).borrowed_at ?? "";
    const returnedAt = (row as { returned_at?: string | null }).returned_at ?? null;
    const expectedReturnAt = (row as { expected_return_at?: string | null }).expected_return_at ?? null;
    const isLongTerm = Boolean((row as { is_long_term?: boolean }).is_long_term);
    const returnNotes = (row as { return_notes?: string | null }).return_notes ?? "";
    const borrowedTime = new Date(borrowedAt).getTime();
    const isOverdue = !returnedAt && !isLongTerm && expectedReturnAt && new Date(expectedReturnAt).getTime() < now;
    const isAdminReturned = returnNotes.toLowerCase().includes("admin return by");
    const searchable = [
      vehicle?.plate_number,
      vehicle?.model,
      (row as { borrower_email?: string | null }).borrower_email,
      (row as { driver_name?: string | null }).driver_name,
      (row as { purpose?: string | null }).purpose,
      (row as { borrow_notes?: string | null }).borrow_notes,
      returnNotes,
    ].filter(Boolean).join(" ").toLowerCase();

    if (query && !searchable.includes(query)) {
      return false;
    }

    if (Number.isFinite(fromTime) && borrowedTime < fromTime) {
      return false;
    }

    if (Number.isFinite(toTime) && borrowedTime > toTime) {
      return false;
    }

    if (status === "active" && returnedAt) {
      return false;
    }

    if (status === "returned" && !returnedAt) {
      return false;
    }

    if (status === "long-term" && !isLongTerm) {
      return false;
    }

    if (status === "overdue" && !isOverdue) {
      return false;
    }

    if (status === "admin-returned" && !isAdminReturned) {
      return false;
    }

    return true;
  });

  const lines = [
    header.join(","),
    ...filteredRows.map((row) =>
      [
        escapeCsvCell((row.vehicle as { plate_number?: string } | null)?.plate_number ?? ""),
        escapeCsvCell((row.vehicle as { model?: string } | null)?.model ?? ""),
        escapeCsvCell((row as { borrower_email?: string | null }).borrower_email ?? ""),
        escapeCsvCell((row as { driver_name?: string | null }).driver_name ?? ""),
        escapeCsvCell((row as { purpose?: string | null }).purpose ?? ""),
        escapeCsvCell((row as { returned_at?: string | null }).returned_at ? "returned" : "active"),
        escapeCsvCell((row as { borrowed_at?: string | null }).borrowed_at ?? ""),
        escapeCsvCell((row as { is_long_term?: boolean }).is_long_term ? "Long term" : ((row as { expected_return_at?: string | null }).expected_return_at ?? "")),
        escapeCsvCell((row as { returned_at?: string | null }).returned_at ?? ""),
        escapeCsvCell((row as { start_odometer?: number | null }).start_odometer ?? ""),
        escapeCsvCell((row as { end_odometer?: number | null }).end_odometer ?? ""),
        escapeCsvCell((row as { borrow_notes?: string | null }).borrow_notes ?? ""),
        escapeCsvCell((row as { return_notes?: string | null }).return_notes ?? ""),
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
