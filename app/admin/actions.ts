"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearFleetSnapshotCache } from "@/lib/fleet-cache";
import { clearVehicleCalendarCache } from "@/lib/vehicle-calendar-cache";
import { sendBookingNotificationEmail, sendImmediateKeyCollectionReminderIfDue } from "@/lib/booking-notifications";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDateTimeLocalToUtcIso } from "@/lib/datetime";
import { getIsAdmin } from "@/lib/user-roles";
import { validateVehicleBookingWindow } from "@/lib/vehicle-bookings";
import { getVehicleOptionalFieldPayload, getVehicleOptionalFieldSupport } from "@/lib/vehicle-schema";
import { getSafeActionErrorMessage } from "@/lib/action-errors";

type AdminVehicleStatus = "available" | "in_transit" | "repair" | "maintenance" | "suspended" | "employee_car" | "deregistered" | "sold" | "retired";

function adminActionError(error: unknown, action: string) {
  return getSafeActionErrorMessage(error, `Unable to ${action}. Please try again.`, `admin:${action}`);
}

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

function parseOptionalNonNegativeInteger(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const number = Number(text);

  if (!Number.isInteger(number) || number < 0) {
    return Number.NaN;
  }

  return number;
}

function redirectToVehicleRecordError(vehicleId: string, message: string): never {
  redirect(`/admin/vehicles/${vehicleId || ""}?error=${encodeURIComponent(message)}`);
}

function revalidateVehicleLoanViews(vehicleId: string) {
  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath("/borrow");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/return");
}

function isEditableStatus(value: string): value is AdminVehicleStatus {
  return ["available", "in_transit", "repair", "maintenance", "suspended", "employee_car", "deregistered", "sold", "retired"].includes(value);
}

function getFleetDetails(formData: FormData) {
  const optional = (name: string) => String(formData.get(name) ?? "").trim() || null;
  const yearText = optional("modelYear");
  const reminderText = optional("reminderDays");
  const modelYear = yearText ? Number(yearText) : null;
  const reminderDays = reminderText ? Number(reminderText) : 30;

  if ((modelYear !== null && (!Number.isInteger(modelYear) || modelYear < 1900 || modelYear > 2100)) ||
      !Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) {
    return { ok: false, error: "Model year or reminder days is invalid." } as const;
  }

  return { ok: true, values: {
    make: optional("make"), model_year: modelYear, vehicle_type: optional("vehicleType"),
    department: optional("department"), fuel_type: optional("fuelType"),
    default_parking_location: optional("defaultParkingLocation"), spare_key_location: optional("spareKeyLocation"),
    current_location_name: optional("currentLocationName"), current_location_address: optional("currentLocationAddress"),
    location_source: optional("locationSource"), location_comments: optional("locationComments"),
    current_custodian_name: optional("currentCustodianName"), current_key_holder_name: optional("currentKeyHolderName"),
    expected_return_or_arrival_at: optional("expectedReturnOrArrivalAt"), registration_state: optional("registrationState"),
    registration_expires_on: optional("registrationExpiresOn"), insurer: optional("insurer"),
    insurance_policy_number: optional("insurancePolicyNumber"), insurance_expires_on: optional("insuranceExpiresOn"),
    inspection_expires_on: optional("inspectionExpiresOn"), usage_restrictions: optional("usageRestrictions"), reminder_days: reminderDays,
  }} as const;
}

async function syncVehicleStateFromActiveLoan(adminClient: ReturnType<typeof createAdminClient>, vehicleId: string) {
  const { data: activeLoan, error: activeLoanError } = await adminClient
    .from("vehicle_loans")
    .select("borrowed_by_user_id")
    .eq("vehicle_id", vehicleId)
    .is("returned_at", null)
    .order("borrowed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeLoanError) {
    return adminActionError(activeLoanError, "check active borrows");
  }

  if (activeLoan) {
    const { error } = await adminClient
      .from("vehicles")
      .update({
        status: "borrowed",
        current_holder_user_id: activeLoan.borrowed_by_user_id,
      })
      .eq("id", vehicleId);

    return error ? adminActionError(error, "synchronize the vehicle status") : null;
  }

  const { data: vehicle, error: vehicleError } = await adminClient
    .from("vehicles")
    .select("status")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehicleError) {
    return adminActionError(vehicleError, "load the vehicle");
  }

  if (vehicle?.status !== "borrowed") {
    return null;
  }

  const { error } = await adminClient
    .from("vehicles")
    .update({
      status: "available",
      current_holder_user_id: null,
    })
    .eq("id", vehicleId);

  return error ? adminActionError(error, "synchronize the vehicle status") : null;
}

export async function createVehicle(formData: FormData) {
  const plateNumber = String(formData.get("plateNumber") ?? "").trim().toUpperCase();
  const model = String(formData.get("model") ?? "").trim();
  const vin = String(formData.get("vin") ?? "").trim().toUpperCase() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  const location = String(formData.get("currentLocationName") ?? formData.get("location") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;
  const fleetDetails = getFleetDetails(formData);
  const errorPath = formData.get("returnTo") === "new" ? "/admin/vehicles/new" : "/admin";

  if (!plateNumber || !model || !isEditableStatus(status)) {
    redirect(`${errorPath}?error=Please complete all vehicle fields.`);
  }
  if (!fleetDetails.ok) redirect(`${errorPath}?error=${encodeURIComponent(fleetDetails.error)}`);

  const supabase = await requireAdmin();
  const optionalFieldSupport = await getVehicleOptionalFieldSupport(supabase);
  const insertPayload = {
    plate_number: plateNumber,
    model,
    status,
    comments,
    ...fleetDetails.values,
    ...getVehicleOptionalFieldPayload(optionalFieldSupport, { vin, color, location }),
  };
  const { error } = await supabase.from("vehicles").insert(insertPayload);

  if (error) {
    redirect(`${errorPath}?error=${encodeURIComponent(adminActionError(error, "add the vehicle"))}`);
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
  const location = String(formData.get("currentLocationName") ?? formData.get("location") ?? "").trim() || null;
  const status = String(formData.get("status") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;
  const fleetDetails = getFleetDetails(formData);

  if (!vehicleId || !model) {
    redirect("/admin?error=Please complete all vehicle fields before saving.");
  }
  if (!fleetDetails.ok) redirect(`/admin?error=${encodeURIComponent(fleetDetails.error)}`);

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
    redirect(`/admin?error=${encodeURIComponent(adminActionError(loadError, "load the vehicle"))}`);
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
      ? { model, comments, ...fleetDetails.values, ...getVehicleOptionalFieldPayload(optionalFieldSupport, { vin, color, location }) }
      : {
          model,
          status,
          comments,
          ...fleetDetails.values,
          current_holder_user_id: null,
          ...getVehicleOptionalFieldPayload(optionalFieldSupport, { vin, color, location }),
        };

  const { error } = await supabase.from("vehicles").update(updatePayload).eq("id", vehicleId);

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(adminActionError(error, "update the vehicle"))}`);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin");
  revalidatePath("/borrow");
  revalidatePath("/dashboard");
  redirect(formData.get("returnTo") === "detail"
    ? `/admin/vehicles/${vehicleId}?message=Vehicle updated successfully.`
    : "/admin?message=Vehicle updated successfully.");
}

export async function updateVehicleSummary(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const vin = String(formData.get("vin") ?? "").trim().toUpperCase() || null;
  const color = String(formData.get("color") ?? "").trim() || null;
  if (!vehicleId) redirect("/admin?error=Vehicle not found.");

  const supabase = await requireAdmin();
  const support = await getVehicleOptionalFieldSupport(supabase);
  const payload = {
    ...(support.vinColumn ? { [support.vinColumn]: vin } : {}),
    ...(support.colorColumn ? { [support.colorColumn]: color } : {}),
  };
  const { error } = await supabase.from("vehicles").update(payload).eq("id", vehicleId);
  if (error) redirect(`/admin?error=${encodeURIComponent(adminActionError(error, "update VIN and colour"))}`);

  clearFleetSnapshotCache(); clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin"); revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath("/book"); revalidatePath("/borrow"); revalidatePath("/dashboard");
  redirect("/admin?message=VIN and colour updated successfully.");
}

export async function adminReturnVehicle(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const loanId = String(formData.get("loanId") ?? "").trim();
  const endOdometerValue = String(formData.get("endOdometer") ?? "").trim();
  const vehicleLocation = String(formData.get("vehicleLocation") ?? "").trim();
  const returnNotes = String(formData.get("returnNotes") ?? "").trim();
  const endOdometer = endOdometerValue ? Number(endOdometerValue) : null;

  if (!vehicleId || !loanId || !vehicleLocation || !returnNotes || (endOdometer !== null && (Number.isNaN(endOdometer) || endOdometer < 0))) {
    redirect("/admin?error=Please enter the vehicle location, a valid admin return note, and odometer.");
  }

  const supabase = await requireAdmin();
  const { error } = await supabase.rpc("admin_return_vehicle", {
    p_loan_id: loanId,
    p_vehicle_id: vehicleId,
    p_end_odometer: endOdometer,
    p_return_notes: returnNotes,
    p_vehicle_location: vehicleLocation,
  });

  if (error) {
    redirect(`/admin?error=${encodeURIComponent(adminActionError(error, "return the vehicle"))}`);
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

export async function decideExternalBooking(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const approvalNotes = String(formData.get("approvalNotes") ?? "").trim() || null;
  if (!bookingId || (decision !== "approved" && decision !== "rejected")) redirect("/admin?tab=bookings&error=Invalid approval request.");

  const supabase = await requireAdmin();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: booking, error: loadError } = await supabase.from("vehicle_bookings").select("id, vehicle_id, borrower_type").eq("id", bookingId).maybeSingle();
  if (loadError || !booking || booking.borrower_type !== "external") redirect("/admin?tab=bookings&error=External reservation not found.");

  const { error } = decision === "rejected"
    ? await supabase.rpc("cancel_vehicle_booking", {
        p_booking_id: bookingId,
        p_cancellation_note: approvalNotes ? `External driver rejected: ${approvalNotes}` : "External driver request rejected by admin.",
        p_cancelled_as_admin: true,
      })
    : await supabase.from("vehicle_bookings").update({
        approval_status: "approved", booking_status: "approved", approved_by: user.id,
        approver_name: user.email ?? "Admin", approval_notes: approvalNotes, approved_at: new Date().toISOString(),
      }).eq("id", bookingId);
  if (error) redirect(`/admin?tab=bookings&error=${encodeURIComponent(adminActionError(error, "record the approval decision"))}`);
  clearFleetSnapshotCache();
  clearVehicleCalendarCache(booking.vehicle_id);
  revalidatePath("/admin"); revalidatePath("/book"); revalidatePath("/dashboard");
  redirect(`/admin?tab=bookings&message=External reservation ${decision}.`);
}

export async function acknowledgeRegistrationReminder(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  if (!vehicleId) redirect("/admin?error=Vehicle not found.");
  const supabase = await requireAdmin();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { error } = await supabase.from("vehicles").update({
    registration_reminder_acknowledged_at: new Date().toISOString(),
    registration_reminder_acknowledged_by: user.id,
  }).eq("id", vehicleId);
  if (error) redirect(`/admin?error=${encodeURIComponent(adminActionError(error, "confirm the registration reminder"))}`);
  clearFleetSnapshotCache(); revalidatePath("/admin");
  redirect("/admin?message=Registration reminder marked as handled.");
}

export async function createAdminBooking(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const bookedForUserId = String(formData.get("bookedForUserId") ?? "").trim();
  const startsAtValue = String(formData.get("startsAt") ?? "").trim();
  const endsAtValue = String(formData.get("endsAt") ?? "").trim();
  const isLongTerm = formData.get("isLongTerm") === "on";
  const comments = String(formData.get("comments") ?? "").trim() || null;

  const startsAt = startsAtValue ? parseDateTimeLocalToUtcIso(startsAtValue) ?? "" : "";
  const endsAt = !isLongTerm && endsAtValue ? parseDateTimeLocalToUtcIso(endsAtValue) ?? "" : null;

  const supabase = await requireAdmin();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  if (!bookedForUserId) {
    redirect(`/admin/vehicles/${vehicleId}?error=Please choose who this reservation is for.`);
  }

  const { data: bookedForUser, error: bookedForUserError } = await supabase
    .from("user_roles")
    .select("user_id, email")
    .eq("user_id", bookedForUserId)
    .maybeSingle();

  if (bookedForUserError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(adminActionError(bookedForUserError, "load the selected user"))}`);
  }

  if (!bookedForUser?.email) {
    redirect(`/admin/vehicles/${vehicleId}?error=Booked-for user not found. Ask the user to sign in once, then try again.`);
  }

  const validationError = await validateVehicleBookingWindow(supabase, {
    vehicleId,
    startsAt,
    endsAt,
    isLongTerm,
  });

  if (validationError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(validationError)}`);
  }

  const { data: createdBooking, error } = await supabase
    .from("vehicle_bookings")
    .insert({
      vehicle_id: vehicleId,
      booked_by_user_id: bookedForUser.user_id,
      booked_by_email: bookedForUser.email,
      starts_at: startsAt,
      ends_at: endsAt,
      is_long_term: isLongTerm,
      comments,
    })
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, is_long_term, comments")
    .single();

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(adminActionError(error, "create the reservation"))}`);
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
        isLongTerm: createdBooking.is_long_term,
        comments: createdBooking.comments,
      },
      notifyAdmins: true,
    });
  } catch (notificationError) {
    console.error("Failed to send admin booking confirmation email.", notificationError);
  }

  if (!createdBooking.is_long_term && createdBooking.ends_at) {
    try {
      await sendImmediateKeyCollectionReminderIfDue({
        supabase,
        booking: {
          bookingId: createdBooking.id,
          vehicleId: createdBooking.vehicle_id,
          bookedByEmail: createdBooking.booked_by_email,
          startsAt: createdBooking.starts_at,
          endsAt: createdBooking.ends_at,
          isLongTerm: createdBooking.is_long_term,
          comments: createdBooking.comments,
        },
      });
    } catch (notificationError) {
      console.error("Failed to send immediate key collection reminder email.", notificationError);
    }
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath("/book");
  revalidatePath("/borrow");
  redirect(`/admin/vehicles/${vehicleId}?message=Reservation created successfully.`);
}

export async function updateAdminBooking(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const startsAtValue = String(formData.get("startsAt") ?? "").trim();
  const endsAtValue = String(formData.get("endsAt") ?? "").trim();
  const isLongTerm = formData.get("isLongTerm") === "on";
  const comments = String(formData.get("comments") ?? "").trim() || null;

  const startsAt = startsAtValue ? parseDateTimeLocalToUtcIso(startsAtValue) ?? "" : "";
  const endsAt = !isLongTerm && endsAtValue ? parseDateTimeLocalToUtcIso(endsAtValue) ?? "" : null;

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
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, is_long_term, comments")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadBookingError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(adminActionError(loadBookingError, "load the reservation"))}`);
  }

  if (!existingBooking) {
    redirect(`/admin/vehicles/${vehicleId}?error=Booking not found.`);
  }

  const validationError = await validateVehicleBookingWindow(supabase, {
    vehicleId,
    startsAt,
    endsAt,
    isLongTerm,
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
      is_long_term: isLongTerm,
      comments,
    })
    .eq("id", bookingId);

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(adminActionError(error, "update the reservation"))}`);
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
        isLongTerm,
        comments,
      },
      previousBooking: {
        startsAt: existingBooking.starts_at,
        endsAt: existingBooking.ends_at,
        isLongTerm: existingBooking.is_long_term,
        comments: existingBooking.comments,
      },
      notifyAdmins: true,
    });
  } catch (notificationError) {
    console.error("Failed to send admin booking update email.", notificationError);
  }

  if (!isLongTerm && endsAt) {
    try {
      await sendImmediateKeyCollectionReminderIfDue({
        supabase,
        booking: {
          bookingId,
          vehicleId,
          bookedByEmail: existingBooking.booked_by_email,
          startsAt,
          endsAt,
          isLongTerm,
          comments,
        },
      });
    } catch (notificationError) {
      console.error("Failed to send immediate key collection reminder email.", notificationError);
    }
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath("/book");
  revalidatePath("/borrow");
  redirect(`/admin/vehicles/${vehicleId}?message=Reservation updated successfully.`);
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
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, is_long_term, comments")
    .eq("id", bookingId)
    .maybeSingle();

  if (loadBookingError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(adminActionError(loadBookingError, "load the reservation"))}`);
  }

  if (!booking) {
    redirect(`/admin/vehicles/${vehicleId}?error=Booking not found.`);
  }

  const adminCancellationComment = [
    `Admin cancelled by ${user.email ?? "admin"}.`,
    booking.comments ? `Original comments: ${booking.comments}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const { error } = await supabase.rpc("cancel_vehicle_booking", {
    p_booking_id: bookingId,
    p_cancellation_note: adminCancellationComment,
    p_cancelled_as_admin: true,
  });

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(adminActionError(error, "cancel the reservation"))}`);
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
        isLongTerm: booking.is_long_term,
        comments: adminCancellationComment,
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
  redirect(`/admin/vehicles/${vehicleId}?message=Reservation deleted successfully.`);
}

export async function adminStartReservationBorrow(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();

  if (!bookingId || !vehicleId) {
    redirect("/admin?error=Reservation not found.");
  }

  const supabase = await requireAdmin();
  const { data: booking, error: bookingError } = await supabase
    .from("vehicle_bookings")
    .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, is_long_term, comments, borrower_type, approval_status")
    .eq("id", bookingId)
    .eq("vehicle_id", vehicleId)
    .maybeSingle();

  if (bookingError) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(adminActionError(bookingError, "load the reservation"))}`);
  }

  if (!booking) {
    redirect(`/admin/vehicles/${vehicleId}?error=Reservation not found.`);
  }

  if (booking.borrower_type === "external" && booking.approval_status !== "approved") {
    redirect(`/admin/vehicles/${vehicleId}?error=Approve the external driver before starting this borrow.`);
  }

  const { error } = await supabase.rpc("admin_start_booking_borrow", {
    p_booking_id: bookingId,
    p_vehicle_id: vehicleId,
  });

  if (error) {
    redirect(`/admin/vehicles/${vehicleId}?error=${encodeURIComponent(adminActionError(error, "start the borrow"))}`);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/dashboard");
  revalidatePath("/book");
  revalidatePath("/borrow");
  revalidatePath("/return");
  revalidatePath("/history");
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  redirect(`/admin/vehicles/${vehicleId}?message=Reservation started as borrow for ${encodeURIComponent(booking.booked_by_email)}.`);
}

export async function createHistoricalLoan(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const borrowerUserId = String(formData.get("borrowerUserId") ?? "").trim();
  const driverName = String(formData.get("driverName") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const borrowNotes = String(formData.get("borrowNotes") ?? "").trim() || null;
  const returnNotes = String(formData.get("returnNotes") ?? "").trim() || null;
  const startOdometer = parseOptionalNonNegativeInteger(formData.get("startOdometer"));
  const endOdometer = parseOptionalNonNegativeInteger(formData.get("endOdometer"));
  const borrowedAtValue = String(formData.get("borrowedAt") ?? "").trim();
  const expectedReturnAtValue = String(formData.get("expectedReturnAt") ?? "").trim();
  const isLongTerm = formData.get("isLongTerm") === "on";
  const returnedAtValue = String(formData.get("returnedAt") ?? "").trim();
  const borrowedAt = borrowedAtValue ? parseDateTimeLocalToUtcIso(borrowedAtValue) : null;
  const expectedReturnAt = !isLongTerm && expectedReturnAtValue ? parseDateTimeLocalToUtcIso(expectedReturnAtValue) : null;
  const returnedAt = returnedAtValue ? parseDateTimeLocalToUtcIso(returnedAtValue) : null;

  if (!vehicleId || !borrowerUserId || !driverName || !purpose || !borrowedAt) {
    redirectToVehicleRecordError(vehicleId, "Please complete the borrower, driver, purpose, and borrowed time.");
  }

  if (Number.isNaN(startOdometer) || Number.isNaN(endOdometer)) {
    redirectToVehicleRecordError(vehicleId, "Odometer values must be whole numbers greater than or equal to zero.");
  }

  if (startOdometer !== null && endOdometer !== null && endOdometer < startOdometer) {
    redirectToVehicleRecordError(vehicleId, "Return odometer cannot be less than the borrow odometer.");
  }

  if (returnedAt && new Date(returnedAt).getTime() <= new Date(borrowedAt).getTime()) {
    redirectToVehicleRecordError(vehicleId, "Returned time must be after borrowed time.");
  }

  if (expectedReturnAt && new Date(expectedReturnAt).getTime() <= new Date(borrowedAt).getTime()) {
    redirectToVehicleRecordError(vehicleId, "Expected return time must be after borrowed time.");
  }

  if (!returnedAt && !isLongTerm && !expectedReturnAt) {
    redirectToVehicleRecordError(vehicleId, "Active borrow records need an expected return time or Long term selected.");
  }

  const supabase = await requireAdmin();
  const [{ data: vehicle, error: vehicleError }, { data: borrower, error: borrowerError }] = await Promise.all([
    supabase.from("vehicles").select("id").eq("id", vehicleId).maybeSingle(),
    supabase.from("user_roles").select("user_id, email").eq("user_id", borrowerUserId).maybeSingle(),
  ]);

  if (vehicleError) {
    redirectToVehicleRecordError(vehicleId, adminActionError(vehicleError, "load the vehicle"));
  }

  if (!vehicle) {
    redirectToVehicleRecordError(vehicleId, "Vehicle not found.");
  }

  if (borrowerError) {
    redirectToVehicleRecordError(vehicleId, adminActionError(borrowerError, "load the borrower"));
  }

  if (!borrower) {
    redirectToVehicleRecordError(vehicleId, "Borrower not found. Ask the user to sign in once, then try again.");
  }

  const adminClient = createAdminClient();
  if (!returnedAt) {
    const { data: activeLoan, error: activeLoanError } = await adminClient
      .from("vehicle_loans")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .is("returned_at", null)
      .maybeSingle();

    if (activeLoanError) {
      redirectToVehicleRecordError(vehicleId, adminActionError(activeLoanError, "check active borrows"));
    }

    if (activeLoan) {
      redirectToVehicleRecordError(vehicleId, "This vehicle already has an active borrow record.");
    }
  }

  const { error } = await adminClient.from("vehicle_loans").insert({
    vehicle_id: vehicleId,
    borrowed_by_user_id: borrower.user_id,
    borrower_email: borrower.email,
    driver_name: driverName,
    purpose,
    start_odometer: startOdometer,
    end_odometer: endOdometer,
    borrow_notes: borrowNotes,
    return_notes: returnNotes,
    borrowed_at: borrowedAt,
    expected_return_at: expectedReturnAt,
    is_long_term: isLongTerm,
    returned_at: returnedAt,
  });

  if (error) {
    redirectToVehicleRecordError(vehicleId, adminActionError(error, "add the borrow record"));
  }

  const syncError = await syncVehicleStateFromActiveLoan(adminClient, vehicleId);

  if (syncError) {
    redirectToVehicleRecordError(vehicleId, adminActionError(syncError, "synchronize the vehicle status"));
  }

  revalidateVehicleLoanViews(vehicleId);
  redirect(`/admin/vehicles/${vehicleId}?message=Historical borrow record added successfully.`);
}

export async function updateHistoricalLoan(formData: FormData) {
  const loanId = String(formData.get("loanId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const borrowerUserId = String(formData.get("borrowerUserId") ?? "").trim();
  const driverName = String(formData.get("driverName") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim();
  const borrowNotes = String(formData.get("borrowNotes") ?? "").trim() || null;
  const returnNotes = String(formData.get("returnNotes") ?? "").trim() || null;
  const startOdometer = parseOptionalNonNegativeInteger(formData.get("startOdometer"));
  const endOdometer = parseOptionalNonNegativeInteger(formData.get("endOdometer"));
  const borrowedAtValue = String(formData.get("borrowedAt") ?? "").trim();
  const expectedReturnAtValue = String(formData.get("expectedReturnAt") ?? "").trim();
  const isLongTerm = formData.get("isLongTerm") === "on";
  const returnedAtValue = String(formData.get("returnedAt") ?? "").trim();
  const borrowedAt = borrowedAtValue ? parseDateTimeLocalToUtcIso(borrowedAtValue) : null;
  const expectedReturnAt = !isLongTerm && expectedReturnAtValue ? parseDateTimeLocalToUtcIso(expectedReturnAtValue) : null;
  const returnedAt = returnedAtValue ? parseDateTimeLocalToUtcIso(returnedAtValue) : null;

  if (!loanId || !vehicleId || !borrowerUserId || !driverName || !purpose || !borrowedAt) {
    redirectToVehicleRecordError(vehicleId, "Please complete the borrower, driver, purpose, and borrowed time.");
  }

  if (Number.isNaN(startOdometer) || Number.isNaN(endOdometer)) {
    redirectToVehicleRecordError(vehicleId, "Odometer values must be whole numbers greater than or equal to zero.");
  }

  if (startOdometer !== null && endOdometer !== null && endOdometer < startOdometer) {
    redirectToVehicleRecordError(vehicleId, "Return odometer cannot be less than the borrow odometer.");
  }

  if (returnedAt && new Date(returnedAt).getTime() <= new Date(borrowedAt).getTime()) {
    redirectToVehicleRecordError(vehicleId, "Returned time must be after borrowed time.");
  }

  if (expectedReturnAt && new Date(expectedReturnAt).getTime() <= new Date(borrowedAt).getTime()) {
    redirectToVehicleRecordError(vehicleId, "Expected return time must be after borrowed time.");
  }

  if (!returnedAt && !isLongTerm && !expectedReturnAt) {
    redirectToVehicleRecordError(vehicleId, "Active borrow records need an expected return time or Long term selected.");
  }

  const supabase = await requireAdmin();
  const [{ data: existingLoan, error: loanLoadError }, { data: borrower, error: borrowerError }] = await Promise.all([
    supabase.from("vehicle_loans").select("id").eq("id", loanId).eq("vehicle_id", vehicleId).maybeSingle(),
    supabase.from("user_roles").select("user_id, email").eq("user_id", borrowerUserId).maybeSingle(),
  ]);

  if (loanLoadError) {
    redirectToVehicleRecordError(vehicleId, adminActionError(loanLoadError, "load the borrow record"));
  }

  if (!existingLoan) {
    redirectToVehicleRecordError(vehicleId, "Borrow record not found.");
  }

  if (borrowerError) {
    redirectToVehicleRecordError(vehicleId, adminActionError(borrowerError, "load the borrower"));
  }

  if (!borrower) {
    redirectToVehicleRecordError(vehicleId, "Borrower not found. Ask the user to sign in once, then try again.");
  }

  const adminClient = createAdminClient();
  if (!returnedAt) {
    const { data: activeLoan, error: activeLoanError } = await adminClient
      .from("vehicle_loans")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .is("returned_at", null)
      .neq("id", loanId)
      .maybeSingle();

    if (activeLoanError) {
      redirectToVehicleRecordError(vehicleId, adminActionError(activeLoanError, "check active borrows"));
    }

    if (activeLoan) {
      redirectToVehicleRecordError(vehicleId, "This vehicle already has another active borrow record.");
    }
  }

  const { error } = await adminClient
    .from("vehicle_loans")
    .update({
      borrowed_by_user_id: borrower.user_id,
      borrower_email: borrower.email,
      driver_name: driverName,
      purpose,
      start_odometer: startOdometer,
      end_odometer: endOdometer,
      borrow_notes: borrowNotes,
      return_notes: returnNotes,
      borrowed_at: borrowedAt,
      expected_return_at: expectedReturnAt,
      is_long_term: isLongTerm,
      returned_at: returnedAt,
    })
    .eq("id", loanId)
    .eq("vehicle_id", vehicleId);

  if (error) {
    redirectToVehicleRecordError(vehicleId, adminActionError(error, "update the borrow record"));
  }

  const syncError = await syncVehicleStateFromActiveLoan(adminClient, vehicleId);

  if (syncError) {
    redirectToVehicleRecordError(vehicleId, adminActionError(syncError, "synchronize the vehicle status"));
  }

  revalidateVehicleLoanViews(vehicleId);
  redirect(`/admin/vehicles/${vehicleId}?message=Borrow record updated successfully.`);
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
    redirect(`/admin?error=${encodeURIComponent(adminActionError(loadError, "load the vehicle"))}`);
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
    redirect(`/admin?error=${encodeURIComponent(adminActionError(error, "retire the vehicle"))}`);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/admin");
  revalidatePath("/borrow");
  revalidatePath("/dashboard");
  redirect("/admin?message=Vehicle retired successfully.");
}

export async function addAllowedUserEmail(formData: FormData) {
  const startedAt = performance.now();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, message: "Please enter a valid email address." };
  }

  try {
    const supabase = await requireAdmin();
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("allowed_user_emails").insert({
      email,
      notes,
      created_by_user_id: user?.id,
    }).select("email, notes, created_at").single();

    if (error) {
      if (error.code === "23505") {
        return { ok: false as const, message: `${email} is already approved.` };
      }

      return { ok: false as const, message: adminActionError(error, "add the approved email") };
    }

    return { ok: true as const, entry: data, message: `${email} is now approved.` };
  } finally {
    console.info(JSON.stringify({ event: "admin_action_timing", action: "approve_email", duration_ms: Math.round(performance.now() - startedAt) }));
  }
}

export async function removeAllowedUserEmail(formData: FormData) {
  const startedAt = performance.now();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) return { ok: false as const, message: "Approved email not found." };

  try {
    const supabase = await requireAdmin();
    const { error } = await supabase.from("allowed_user_emails").delete().eq("email", email);

    if (error) {
      return { ok: false as const, message: adminActionError(error, "remove the approved email") };
    }

    return { ok: true as const, message: `${email} was removed from the approved list.` };
  } finally {
    console.info(JSON.stringify({ event: "admin_action_timing", action: "remove_approved_email", duration_ms: Math.round(performance.now() - startedAt) }));
  }
}
