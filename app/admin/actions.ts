"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearFleetSnapshotCache } from "@/lib/fleet-cache";
import { clearVehicleCalendarCache } from "@/lib/vehicle-calendar-cache";
import { sendBookingNotificationEmail } from "@/lib/booking-notifications";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  clearFleetSnapshotCache();
  clearVehicleCalendarCache();
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
  const [{ data: existingVehicle, error: loadError }, { data: activeLoan }] = await Promise.all([
    supabase
    .from("vehicles")
    .select("status")
    .eq("id", vehicleId)
    .maybeSingle(),
    supabase.from("vehicle_loans").select("id").eq("vehicle_id", vehicleId).is("returned_at", null).maybeSingle(),
  ]);

  if (loadError) {
    redirect(`/admin?error=${encodeURIComponent(loadError.message)}`);
  }

  if (!existingVehicle) {
    redirect("/admin?error=Vehicle not found.");
  }

  const isActivelyBorrowed = Boolean(activeLoan);

  if (!isActivelyBorrowed && !isEditableStatus(status)) {
    redirect("/admin?error=Please choose a valid vehicle status.");
  }

  const updatePayload =
    isActivelyBorrowed
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

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin");
  revalidatePath("/borrow");
  revalidatePath("/dashboard");
  redirect("/admin?message=Vehicle updated successfully.");
}

export async function adminReturnVehicle(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const loanId = String(formData.get("loanId") ?? "").trim();
  const endOdometerValue = String(formData.get("endOdometer") ?? "").trim();
  const returnNotes = String(formData.get("returnNotes") ?? "").trim();
  const endOdometer = endOdometerValue ? Number(endOdometerValue) : null;

  if (!vehicleId || !loanId || !returnNotes || (endOdometer !== null && (Number.isNaN(endOdometer) || endOdometer < 0))) {
    redirect("/admin?error=Please enter a valid admin return note and odometer.");
  }

  const supabase = await requireAdmin();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const adminClient = createAdminClient();

  const { data: loanRecord, error: loanLoadError } = await adminClient
    .from("vehicle_loans")
    .select("id, vehicle_id, start_odometer, returned_at, return_notes")
    .eq("id", loanId)
    .eq("vehicle_id", vehicleId)
    .maybeSingle();

  if (loanLoadError) {
    redirect(`/admin?error=${encodeURIComponent(loanLoadError.message)}`);
  }

  if (!loanRecord) {
    redirect("/admin?error=Active loan record not found.");
  }

  if (loanRecord.returned_at) {
    redirect("/admin?error=This vehicle has already been returned.");
  }

  if (endOdometer !== null && loanRecord.start_odometer !== null && endOdometer < Number(loanRecord.start_odometer)) {
    redirect("/admin?error=Return odometer cannot be less than the borrow odometer.");
  }

  const adminReturnNote = `Admin return by ${user?.email ?? "admin"}: ${returnNotes}`;
  const combinedReturnNotes = loanRecord.return_notes ? `${loanRecord.return_notes}\n${adminReturnNote}` : adminReturnNote;

  const { data: returnedLoan, error: updateLoanError } = await adminClient
    .from("vehicle_loans")
    .update({
      end_odometer: endOdometer,
      return_notes: combinedReturnNotes,
      returned_at: new Date().toISOString(),
    })
    .eq("id", loanId)
    .is("returned_at", null)
    .select("id")
    .maybeSingle();

  if (updateLoanError) {
    redirect(`/admin?error=${encodeURIComponent(updateLoanError.message)}`);
  }

  if (!returnedLoan) {
    redirect("/admin?error=This vehicle has already been returned.");
  }

  const { error: updateVehicleError } = await adminClient
    .from("vehicles")
    .update({
      status: "available",
      current_holder_user_id: null,
    })
    .eq("id", vehicleId);

  if (updateVehicleError) {
    redirect(`/admin?error=${encodeURIComponent(updateVehicleError.message)}`);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/borrow");
  revalidatePath("/book");
  revalidatePath("/return");
  revalidatePath("/history");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  redirect("/admin?message=Vehicle returned by admin successfully.");
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

  const { data: createdBooking, error } = await supabase
    .from("vehicle_bookings")
    .insert({
      vehicle_id: vehicleId,
      booked_by_user_id: user.id,
      booked_by_email: user.email ?? "",
      starts_at: startsAt,
      ends_at: endsAt,
      comments,
    })
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, comments")
    .single();

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(error.message)}`);
  }

  try {
    await sendBookingNotificationEmail({
      supabase,
      action: "created",
      actorEmail: user.email ?? "",
      booking: {
        bookingId: createdBooking.id,
        vehicleId: createdBooking.vehicle_id,
        bookedByEmail: createdBooking.booked_by_email,
        startsAt: createdBooking.starts_at,
        endsAt: createdBooking.ends_at,
        comments: createdBooking.comments,
      },
      notifyAdmins: true,
    });
  } catch (notificationError) {
    console.error("Failed to send admin booking confirmation email.", notificationError);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: existingBooking, error: loadBookingError } = await supabase
    .from("vehicle_bookings")
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, comments")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadBookingError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(loadBookingError.message)}`);
  }

  if (!existingBooking) {
    redirect(`/admin/vehicles/${vehicleId}?error=Booking not found.`);
  }

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

  try {
    await sendBookingNotificationEmail({
      supabase,
      action: "updated",
      actorEmail: user.email ?? "",
      booking: {
        bookingId,
        vehicleId,
        bookedByEmail: existingBooking.booked_by_email,
        startsAt,
        endsAt,
        comments,
      },
      previousBooking: {
        startsAt: existingBooking.starts_at,
        endsAt: existingBooking.ends_at,
        comments: existingBooking.comments,
      },
      notifyAdmins: true,
    });
  } catch (notificationError) {
    console.error("Failed to send admin booking update email.", notificationError);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: booking, error: loadBookingError } = await supabase
    .from("vehicle_bookings")
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, comments")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadBookingError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(loadBookingError.message)}`);
  }

  if (!booking) {
    redirect(`/admin/vehicles/${vehicleId}?error=Booking not found.`);
  }

  const { error } = await supabase.from("vehicle_bookings").delete().eq("id", bookingId);

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(error.message)}`);
  }

  try {
    await sendBookingNotificationEmail({
      supabase,
      action: "cancelled",
      actorEmail: user.email ?? "",
      booking: {
        bookingId,
        vehicleId: booking.vehicle_id,
        bookedByEmail: booking.booked_by_email,
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        comments: booking.comments,
      },
      notifyAdmins: true,
    });
  } catch (notificationError) {
    console.error("Failed to send admin booking cancellation email.", notificationError);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
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
  const [{ data: existingVehicle, error: loadError }, { data: activeLoan }] = await Promise.all([
    supabase
      .from("vehicles")
      .select("status")
      .eq("id", vehicleId)
      .maybeSingle(),
    supabase.from("vehicle_loans").select("id").eq("vehicle_id", vehicleId).is("returned_at", null).maybeSingle(),
  ]);

  if (loadError) {
    redirect(`/admin?error=${encodeURIComponent(loadError.message)}`);
  }

  if (!existingVehicle) {
    redirect("/admin?error=Vehicle not found.");
  }

  if (activeLoan) {
    redirect("/admin?error=Borrowed vehicles cannot be retired until they are returned.");
  }

  const { error } = await supabase
    .from("vehicles")
    .update({ status: "retired", current_holder_user_id: null })
    .eq("id", vehicleId);

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin");
  revalidatePath("/borrow");
  revalidatePath("/dashboard");
  redirect("/admin?message=Vehicle retired successfully.");
}
