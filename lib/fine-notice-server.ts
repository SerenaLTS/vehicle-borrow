import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import type { FineDriverHistory, FineDriverRecord, FineNotice } from "@/lib/fine-notices";

export async function requireFineAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  if (!(await getIsAdmin(supabase, user.id))) redirect("/dashboard?message=Admin access required.");
  return { supabase, user };
}

export async function loadFineDrivers(supabase: Awaited<ReturnType<typeof createClient>>, vehicleId: string): Promise<FineDriverRecord[]> {
  const [loans, history] = await Promise.all([
    supabase.from("vehicle_loans").select("id, driver_name, borrower_email, borrowed_at, returned_at").eq("vehicle_id", vehicleId).order("borrowed_at", { ascending: false }),
    supabase.from("vehicle_driver_history").select("id, driver_name, driver_email, starts_at, ends_at").eq("vehicle_id", vehicleId).order("starts_at", { ascending: false }),
  ]);
  if (loans.error || history.error) throw new Error("Unable to load driver records. Check that the fine notice database migration has been applied.");
  return [
    ...(loans.data ?? []).map((loan) => ({ id: loan.id, source: "loan" as const, driverName: loan.driver_name, driverEmail: loan.borrower_email, startsAt: loan.borrowed_at, endsAt: loan.returned_at })),
    ...(history.data ?? []).map((record) => ({ id: record.id, source: "history" as const, driverName: record.driver_name, driverEmail: record.driver_email, startsAt: record.starts_at, endsAt: record.ends_at })),
  ];
}

export async function loadVehicleFines(supabase: Awaited<ReturnType<typeof createClient>>, vehicleId: string) {
  const [fines, history] = await Promise.all([
    supabase.from("vehicle_fine_notices").select("*").eq("vehicle_id", vehicleId).order("occurred_at", { ascending: false }),
    supabase.from("vehicle_driver_history").select("id, driver_name, driver_email, starts_at, ends_at").eq("vehicle_id", vehicleId).order("starts_at", { ascending: false }),
  ]);
  return { fines: (fines.data ?? []) as FineNotice[], history: (history.data ?? []) as FineDriverHistory[], error: fines.error || history.error };
}

export function fineDeliveryFingerprint(fine: Pick<FineNotice, "driver_email" | "email_subject" | "email_body" | "attachment_path">) {
  return createHash("sha256").update(JSON.stringify([fine.driver_email, fine.email_subject, fine.email_body, fine.attachment_path])).digest("hex");
}
