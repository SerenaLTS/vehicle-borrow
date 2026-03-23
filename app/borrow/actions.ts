"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function borrowVehicle(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const customDriverName = String(formData.get("driverName") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const startOdometer = Number(formData.get("startOdometer") ?? 0);
  const borrowNotes = String(formData.get("borrowNotes") ?? "").trim() || null;

  if (!vehicleId || !purpose || Number.isNaN(startOdometer) || startOdometer < 0) {
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
  });

  if (error) {
    redirect(`/borrow?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard");
  revalidatePath("/borrow");
  revalidatePath("/return");
  revalidatePath("/history");
  redirect("/dashboard?message=Vehicle borrowed successfully.");
}
