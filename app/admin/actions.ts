"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateTimeLocalToUtcIso } from "@/lib/datetime";
import { getIsAdmin } from "@/lib/user-roles";
import { validateVehicleBookingWindow } from "@/lib/vehicle-bookings";
import { getVehicleOptionalFieldPayload, getVehicleOptionalFieldSupport } from "@/lib/vehicle-schema";

type AdminVehicleStatus = "available" | "maintenance" | "retired";

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
  return value === "available" || value === "maintenance" || value === "retired";
}

export async function createVehicle(formData: FormData) {
  const plateNumber = String(formData.get("plateNumber") ?? "").trim().toUpperCase();
  const model = String(formData.get("model") ?? "").trim();
  const vin = String(formData.get("vin") ?? "").trim().toUpperCase() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;

  if (!plateNumber || !model || !isEditableStatus(status)) {
    redirect("/admin?error=Please complete all vehicle fields.");
  }

  const supabase = await requireAdmin();
  const optionalFieldSupport = await getVehicleOptionalFieldSupport(supabase);
  const insertPayload = {
    plate_number: plateNumber,
    model,
    status,
    comments,
    ...getVehicleOptionalFieldPayload(optionalFieldSupport, { vin, color }),
  };
  const { error } = await supabase.from("vehicles").insert(insertPayload);

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
  const vin = String(formData.get("vin") ?? "").trim().toUpperCase() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;

  if (!vehicleId || !model) {
    redirect("/admin?error=Please complete all vehicle fields before saving.");
  }

  const supabase = await requireAdmin();
  const optionalFieldSupport = await getVehicleOptionalFieldSupport(supabase);
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
      ? { model, comments, ...getVehicleOptionalFieldPayload(optionalFieldSupport, { vin, color }) }
      : {
          model,
          status,
          comments,
          current_holder_user_id: null,
          ...getVehicleOptionalFieldPayload(optionalFieldSupport, { vin, color }),
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

export async function createAdminBooking(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const startsAtValue = String(formData.get("startsAt") ?? "").trim();
  const endsAtValue = String(formData.get("endsAt") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;

  const startsAt = startsAtValue ? parseDateTimeLocalToUtcIso(startsAtValue) ?? "" : "";
  const endsAt = endsAtValue ? parseDateTimeLocalToUtcIso(endsAtValue) ?? "" : "";

  const supabase = await requireAdmin();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const validationError = await validateVehicleBookingWindow(supabase, {
    vehicleId,
    startsAt,
    endsAt,
  });

  if (validationError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(validationError)}`);
  }

  const { error } = await supabase.from("vehicle_bookings").insert({
    vehicle_id: vehicleId,
    booked_by_user_id: user.id,
    booked_by_email: user.email ?? "",
    starts_at: startsAt,
    ends_at: endsAt,
    comments,
  });

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath("/book");
  revalidatePath("/borrow");
  redirect(`/admin/vehicles/${vehicleId}?message=Booking created successfully.`);
}

export async function updateAdminBooking(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const startsAtValue = String(formData.get("startsAt") ?? "").trim();
  const endsAtValue = String(formData.get("endsAt") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;

  const startsAt = startsAtValue ? parseDateTimeLocalToUtcIso(startsAtValue) ?? "" : "";
  const endsAt = endsAtValue ? parseDateTimeLocalToUtcIso(endsAtValue) ?? "" : "";

  if (!bookingId || !vehicleId) {
    redirect("/admin?error=Booking not found.");
  }

  const supabase = await requireAdmin();
  const validationError = await validateVehicleBookingWindow(supabase, {
    vehicleId,
    startsAt,
    endsAt,
    excludeBookingId: bookingId,
  });

  if (validationError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(validationError)}`);
  }

  const { error } = await supabase
    .from("vehicle_bookings")
    .update({
      starts_at: startsAt,
      ends_at: endsAt,
      comments,
    })
    .eq("id", bookingId);

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath("/book");
  revalidatePath("/borrow");
  redirect(`/admin/vehicles/${vehicleId}?message=Booking updated successfully.`);
}

export async function deleteAdminBooking(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();

  if (!bookingId || !vehicleId) {
    redirect("/admin?error=Booking not found.");
  }

  const supabase = await requireAdmin();
  const { error } = await supabase.from("vehicle_bookings").delete().eq("id", bookingId);

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath("/book");
  revalidatePath("/borrow");
  redirect(`/admin/vehicles/${vehicleId}?message=Booking deleted successfully.`);
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
