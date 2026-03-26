"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";

type AdminVehicleStatus = "available" | "booked" | "maintenance" | "retired";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const isAdmin = await getIsAdmin(supabase, user.id);

  if (!isAdmin) {
    redirect("/dashboard?message=Admin access required.");
  }

  return supabase;
}

function isEditableStatus(value: string): value is AdminVehicleStatus {
  return value === "available" || value === "booked" || value === "maintenance" || value === "retired";
}

export async function createVehicle(formData: FormData) {
  const plateNumber = String(formData.get("plateNumber") ?? "").trim().toUpperCase();
  const model = String(formData.get("model") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;

  if (!plateNumber || !model || !isEditableStatus(status)) {
    redirect("/admin?error=Please complete all vehicle fields.");
  }

  const supabase = await requireAdmin();
  const { error } = await supabase.from("vehicles").insert({
    plate_number: plateNumber,
    model,
    status,
    comments,
  });

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath("/borrow");
  revalidatePath("/dashboard");
  redirect("/admin?message=Vehicle added successfully.");
}

export async function updateVehicle(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;

  if (!vehicleId || !model) {
    redirect("/admin?error=Please complete all vehicle fields before saving.");
  }

  const supabase = await requireAdmin();
  const { data: existingVehicle, error: loadError } = await supabase
    .from("vehicles")
    .select("status")
    .eq("id", vehicleId)
    .maybeSingle();

  if (loadError) {
    redirect(`/admin?error=${encodeURIComponent(loadError.message)}`);
  }

  if (!existingVehicle) {
    redirect("/admin?error=Vehicle not found.");
  }

  if (existingVehicle.status !== "borrowed" && !isEditableStatus(status)) {
    redirect("/admin?error=Please choose a valid vehicle status.");
  }

  const updatePayload =
    existingVehicle.status === "borrowed"
      ? { model, comments }
      : {
          model,
          status,
          comments,
          current_holder_user_id: null,
        };

  const { error } = await supabase.from("vehicles").update(updatePayload).eq("id", vehicleId);

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath("/borrow");
  revalidatePath("/dashboard");
  redirect("/admin?message=Vehicle updated successfully.");
}

export async function retireVehicle(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();

  if (!vehicleId) {
    redirect("/admin?error=Vehicle not found.");
  }

  const supabase = await requireAdmin();
  const { data: existingVehicle, error: loadError } = await supabase
    .from("vehicles")
    .select("status")
    .eq("id", vehicleId)
    .maybeSingle();

  if (loadError) {
    redirect(`/admin?error=${encodeURIComponent(loadError.message)}`);
  }

  if (!existingVehicle) {
    redirect("/admin?error=Vehicle not found.");
  }

  if (existingVehicle.status === "borrowed") {
    redirect("/admin?error=Borrowed vehicles cannot be retired until they are returned.");
  }

  const { error } = await supabase
    .from("vehicles")
    .update({ status: "retired", current_holder_user_id: null })
    .eq("id", vehicleId);

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath("/borrow");
  revalidatePath("/dashboard");
  redirect("/admin?message=Vehicle retired successfully.");
}
