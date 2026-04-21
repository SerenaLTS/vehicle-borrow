"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDateTimeLocalToUtcIso } from "@/lib/datetime";
import { clearFleetSnapshotCache } from "@/lib/fleet-cache";
import { clearVehicleCalendarCache } from "@/lib/vehicle-calendar-cache";
import { createClient } from "@/lib/supabase/server";

export async function borrowVehicle(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const customDriverName = String(formData.get("driverName") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const startOdometerValue = String(formData.get("startOdometer") ?? "").trim();
  const expectedReturnAtValue = String(formData.get("expectedReturnAt") ?? "").trim();
  const startOdometer = startOdometerValue ? Number(startOdometerValue) : null;
  const expectedReturnAt = expectedReturnAtValue ? parseDateTimeLocalToUtcIso(expectedReturnAtValue) : null;
  const borrowNotes = String(formData.get("borrowNotes") ?? "").trim() || null;

  if (
    !vehicleId ||
    !purpose ||
    !expectedReturnAt ||
    (startOdometer !== null && (Number.isNaN(startOdometer) || startOdometer < 0))
  ) {
    redirect("/borrow?error=Please complete all required fields.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const driverName = customDriverName || user.email || "";

  if (!driverName) {
    redirect("/borrow?error=Unable to detect the signed-in email address.");
  }

  const { error } = await supabase.rpc("borrow_vehicle", {
    p_vehicle_id: vehicleId,
    p_driver_name: driverName,
    p_purpose: purpose,
    p_start_odometer: startOdometer,
    p_borrow_notes: borrowNotes,
    p_expected_return_at: expectedReturnAt,
  });

  if (error) {
    redirect(`/borrow?error=${encodeURIComponent(error.message)}`);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/dashboard");
  revalidatePath("/borrow");
  revalidatePath("/return");
  revalidatePath("/history");
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  redirect("/dashboard?message=Vehicle borrowed successfully.");
}
