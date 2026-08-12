import { NextResponse } from "next/server";
import { getHistoryDateBounds, getHistoryMonthBounds } from "@/lib/history-filters";
import { createClient } from "@/lib/supabase/server";
import { normalizeLoan, type RawLoanRow } from "@/lib/types";

const LOAN_SELECT =
  "id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, is_long_term, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const monthBounds = getHistoryMonthBounds(url.searchParams.get("month") ?? "");

  if (!monthBounds?.monthStartIso || !monthBounds.monthEndExclusiveIso) {
    return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  }

  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const { fromIso, toExclusiveIso } = getHistoryDateBounds(from, to);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let loansQuery = supabase
    .from("vehicle_loans")
    .select(LOAN_SELECT)
    .lt("borrowed_at", monthBounds.monthEndExclusiveIso)
    .or(`returned_at.is.null,returned_at.gte.${monthBounds.monthStartIso}`)
    .order("borrowed_at", { ascending: false });

  if (fromIso) loansQuery = loansQuery.gte("borrowed_at", fromIso);
  if (toExclusiveIso) loansQuery = loansQuery.lt("borrowed_at", toExclusiveIso);
  if (status === "active") loansQuery = loansQuery.is("returned_at", null);
  if (status === "returned") loansQuery = loansQuery.not("returned_at", "is", null);
  if (status === "long-term") loansQuery = loansQuery.eq("is_long_term", true);
  if (status === "overdue") {
    loansQuery = loansQuery.is("returned_at", null).eq("is_long_term", false).lt("expected_return_at", new Date().toISOString());
  }
  if (status === "admin-returned") loansQuery = loansQuery.ilike("return_notes", "%admin return by%");

  const { data, error } = await loansQuery;

  if (error) {
    console.error("[history:calendar]", error);
    return NextResponse.json({ error: "Unable to load calendar records." }, { status: 500 });
  }

  const loans = ((data ?? []) as RawLoanRow[])
    .map(normalizeLoan)
    .filter((loan) => {
      if (!query) return true;
      return [
        loan.vehicle?.plate_number,
        loan.vehicle?.model,
        loan.borrower_email,
        loan.driver_name,
        loan.purpose,
        loan.borrow_notes,
        loan.return_notes,
      ].filter(Boolean).join(" ").toLowerCase().includes(query);
    });

  return NextResponse.json({ loans });
}
