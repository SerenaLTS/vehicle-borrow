import { NextResponse } from "next/server";
import { getHistoryDateBounds } from "@/lib/history-filters";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const { fromIso, toExclusiveIso } = getHistoryDateBounds(from, to);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("count_vehicle_loan_history", {
    p_query: query,
    p_from: fromIso,
    p_to_exclusive: toExclusiveIso,
    p_status: status,
  });

  if (error) {
    console.error("[history:count]", error);
    return NextResponse.json({ error: "Unable to count history records." }, { status: 500 });
  }

  const totalCount = Number(data ?? 0);
  return NextResponse.json({ totalCount, totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) });
}
