"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateVehicleBookingWindow } from "@/lib/vehicle-bookings";

export async function createBooking(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "").trim();
  const startsAtValue = String(formData.get("startsAt") ?? "").trim();
  const endsAtValue = String(formData.get("endsAt") ?? "").trim();
  const comments = String(formData.get("comments") ?? "").trim() || null;

  const startsAt = startsAtValue ? new Date(startsAtValue).toISOString() : "";
  const endsAt = endsAtValue ? new Date(endsAtValue).toISOString() : "";

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

  const { error } = await supabase.from("vehicle_bookings").insert({
    vehicle_id: vehicleId,
    booked_by_user_id: user.id,
    booked_by_email: user.email ?? "",
    starts_at: startsAt,
    ends_at: endsAt,
    comments,
  });

  if (error) {
    redirect(`/book?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard");
  revalidatePath("/book");
  revalidatePath("/borrow");
  revalidatePath("/admin");
  redirect("/dashboard?message=Vehicle booked successfully.");
}
