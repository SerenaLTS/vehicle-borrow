"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearFleetSnapshotCache } from "@/lib/fleet-cache";
import { clearVehicleCalendarCache } from "@/lib/vehicle-calendar-cache";
import { sendBookingNotificationEmail, sendImmediateKeyCollectionReminderIfDue } from "@/lib/booking-notifications";
import { createClient } from "@/lib/supabase/server";
import { parseDateTimeLocalToUtcIso } from "@/lib/datetime";
import { validateVehicleBookingWindow } from "@/lib/vehicle-bookings";

export async function createBooking(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const startsAtValue = String(formData.get("startsAt") ?? "").trim();
  const endsAtValue = String(formData.get("endsAt") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;

  const startsAt = startsAtValue ? parseDateTimeLocalToUtcIso(startsAtValue) ?? "" : "";
  const endsAt = endsAtValue ? parseDateTimeLocalToUtcIso(endsAtValue) ?? "" : "";

  const supabase = await createClient();
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
    redirect(`/book?error=${encodeURIComponent(validationError)}`);
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
    redirect(`/book?error=${encodeURIComponent(error.message)}`);
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
    });
  } catch (notificationError) {
    console.error("Failed to send booking confirmation email.", notificationError);
  }

  try {
    await sendImmediateKeyCollectionReminderIfDue({
      supabase,
      booking: {
        bookingId: createdBooking.id,
        vehicleId: createdBooking.vehicle_id,
        bookedByEmail: createdBooking.booked_by_email,
        startsAt: createdBooking.starts_at,
        endsAt: createdBooking.ends_at,
        comments: createdBooking.comments,
      },
    });
  } catch (notificationError) {
    console.error("Failed to send immediate key collection reminder email.", notificationError);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/dashboard");
  revalidatePath("/book");
  revalidatePath("/borrow");
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  redirect("/dashboard?message=Vehicle booked successfully.");
}

export async function updateOwnBooking(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const startsAtValue = String(formData.get("startsAt") ?? "").trim();
  const endsAtValue = String(formData.get("endsAt") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;
  const startsAt = startsAtValue ? parseDateTimeLocalToUtcIso(startsAtValue) ?? "" : "";
  const endsAt = endsAtValue ? parseDateTimeLocalToUtcIso(endsAtValue) ?? "" : "";

  if (!bookingId || !vehicleId) {
    redirect("/book?error=Booking not found.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: booking, error } = await supabase
    .from("vehicle_bookings")
    .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments")
    .eq("id", bookingId)
    .eq("booked_by_user_id", user.id)
    .maybeSingle();

  if (error) {
    redirect(`/book?error=${encodeURIComponent(error.message)}`);
  }

  if (!booking) {
    redirect("/book?error=You can only update your own future bookings.");
  }

  if (new Date(booking.starts_at).getTime() <= Date.now()) {
    redirect("/book?error=This booking has already started and can no longer be changed here.");
  }

  const validationError = await validateVehicleBookingWindow(supabase, {
    vehicleId,
    startsAt,
    endsAt,
    excludeBookingId: bookingId,
  });

  if (validationError) {
    redirect(`/book?error=${encodeURIComponent(validationError)}`);
  }

  const { error: updateError } = await supabase
    .from("vehicle_bookings")
    .update({
      starts_at: startsAt,
      ends_at: endsAt,
      comments,
    })
    .eq("id", bookingId)
    .eq("booked_by_user_id", user.id);

  if (updateError) {
    redirect(`/book?error=${encodeURIComponent(updateError.message)}`);
  }

  try {
    await sendBookingNotificationEmail({
      supabase,
      action: "updated",
      actorEmail: user.email ?? "",
      booking: {
        bookingId,
        vehicleId,
        bookedByEmail: booking.booked_by_email,
        startsAt,
        endsAt,
        comments,
      },
      previousBooking: {
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        comments: booking.comments,
      },
    });
  } catch (notificationError) {
    console.error("Failed to send booking update email.", notificationError);
  }

  try {
    await sendImmediateKeyCollectionReminderIfDue({
      supabase,
      booking: {
        bookingId,
        vehicleId,
        bookedByEmail: booking.booked_by_email,
        startsAt,
        endsAt,
        comments,
      },
    });
  } catch (notificationError) {
    console.error("Failed to send immediate key collection reminder email.", notificationError);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/dashboard");
  revalidatePath("/book");
  revalidatePath("/borrow");
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  redirect("/book?message=Booking updated successfully.");
}

export async function cancelOwnBooking(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();

  if (!bookingId || !vehicleId) {
    redirect("/book?error=Booking not found.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: booking, error } = await supabase
    .from("vehicle_bookings")
    .select("id, vehicle_id, booked_by_email, starts_at, ends_at, comments")
    .eq("id", bookingId)
    .eq("booked_by_user_id", user.id)
    .maybeSingle();

  if (error) {
    redirect(`/book?error=${encodeURIComponent(error.message)}`);
  }

  if (!booking) {
    redirect("/book?error=You can only cancel your own future bookings.");
  }

  if (new Date(booking.starts_at).getTime() <= Date.now()) {
    redirect("/book?error=This booking has already started and can no longer be cancelled here.");
  }

  const { error: deleteError } = await supabase
    .from("vehicle_bookings")
    .delete()
    .eq("id", bookingId)
    .eq("booked_by_user_id", user.id);

  if (deleteError) {
    redirect(`/book?error=${encodeURIComponent(deleteError.message)}`);
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
    });
  } catch (notificationError) {
    console.error("Failed to send booking cancellation email.", notificationError);
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/dashboard");
  revalidatePath("/book");
  revalidatePath("/borrow");
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  redirect("/book?message=Booking cancelled successfully.");
}

export async function collectBookingKey(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "").trim();
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();

  if (!bookingId || !vehicleId) {
    redirect("/book?error=Booking not found.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { error } = await supabase.rpc("collect_booking_key", {
    p_booking_id: bookingId,
  });

  if (error) {
    redirect(`/book?error=${encodeURIComponent(error.message)}`);
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
  redirect("/dashboard?message=Key collected. Booking converted to active borrow.");
}
