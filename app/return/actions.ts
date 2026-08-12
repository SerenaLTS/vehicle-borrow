"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearFleetSnapshotCache } from "@/lib/fleet-cache";
import { clearVehicleCalendarCache } from "@/lib/vehicle-calendar-cache";
import { createClient } from "@/lib/supabase/server";
import { getSafeActionErrorMessage } from "@/lib/action-errors";

function returnError(error: unknown, action: string) {
  return getSafeActionErrorMessage(error, `Unable to ${action}. Please try again.`, `return:${action}`);
}

export async function returnVehicle(formData: FormData) {
  const loanId = String(formData.get("loanId") ?? "");
  const endOdometerValue = String(formData.get("endOdometer") ?? "").trim();
  const endOdometer = endOdometerValue ? Number(endOdometerValue) : null;
  const returnNotes = String(formData.get("returnNotes") ?? "").trim() || null;

  if (!loanId || (endOdometer !== null && (Number.isNaN(endOdometer) || endOdometer < 0))) {
    redirect("/return?error=Please complete the return details.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: loanRecord, error: loanLoadError } = await supabase
    .from("vehicle_loans")
    .select("vehicle_id")
    .eq("id", loanId)
    .maybeSingle();

  if (loanLoadError) {
    redirect(`/return?error=${encodeURIComponent(returnError(loanLoadError, "load the borrow record"))}`);
  }

  const { error } = await supabase.rpc("return_vehicle", {
    p_loan_id: loanId,
    p_end_odometer: endOdometer,
    p_return_notes: returnNotes,
  });

  if (error) {
    redirect(`/return?error=${encodeURIComponent(returnError(error, "return the vehicle"))}`);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(loanRecord?.vehicle_id ?? undefined);
  revalidatePath("/dashboard");
  revalidatePath("/borrow");
  revalidatePath("/book");
  revalidatePath("/return");
  revalidatePath("/history");
  revalidatePath("/admin");
  if (loanRecord?.vehicle_id) {
    revalidatePath(`/admin/vehicles/${loanRecord.vehicle_id}`);
  }
  redirect("/dashboard?message=Vehicle returned successfully.");
}
