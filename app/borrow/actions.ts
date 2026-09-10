"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDateTimeLocalToUtcIso } from "@/lib/datetime";
import { clearFleetSnapshotCache } from "@/lib/fleet-cache";
import { clearVehicleCalendarCache } from "@/lib/vehicle-calendar-cache";
import { sendBorrowConfirmationEmail, sendLongTermBorrowAdminNotificationEmail } from "@/lib/booking-notifications";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { isCompanyEmail } from "@/lib/utils";
import { getSafeActionErrorMessage } from "@/lib/action-errors";

function borrowError(error: unknown, action: string) {
  return getSafeActionErrorMessage(error, `Unable to ${action}. Please try again.`, `borrow:${action}`);
}

function getExtendReturnPath(formData: FormData) {
  const returnTo = String(formData.get("returnTo") ?? "");

  return returnTo === "/dashboard" ? "/dashboard" : "/borrow";
}

export async function borrowVehicle(formData: FormData) {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim();
  const startOdometerValue = String(formData.get("startOdometer") ?? "").trim();
  const expectedReturnAtValue = String(formData.get("expectedReturnAt") ?? "").trim();
  const isLongTerm = formData.get("isLongTerm") === "on";
  const startOdometer = startOdometerValue ? Number(startOdometerValue) : null;
  const expectedReturnAt = !isLongTerm && expectedReturnAtValue ? parseDateTimeLocalToUtcIso(expectedReturnAtValue) : null;
  const borrowNotes = String(formData.get("borrowNotes") ?? "").trim() || null;

  if (
    !vehicleId ||
    !purpose ||
    (!isLongTerm && !expectedReturnAt) ||
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

  const profileName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  let driverName = profileName || user.email || "";
  let borrowerEmail = user.email ?? "";
  const borrowerUserId = String(formData.get("borrowerUserId") ?? "").trim() || user.id;
  const assigningEmployee = borrowerUserId !== user.id;
  if (assigningEmployee) {
    if (!(await getIsAdmin(supabase, user.id))) redirect("/borrow?error=Admin access required to assign an employee.");
    const { data: employee, error: employeeError } = await supabase.from("user_roles").select("user_id, email").eq("user_id", borrowerUserId).maybeSingle();
    if (employeeError || !employee || !isCompanyEmail(employee.email, process.env.COMPANY_EMAIL_DOMAIN ?? "")) redirect("/borrow?error=Please select an existing company employee account.");
    borrowerEmail = employee.email;
  }

  if (!driverName) {
    redirect("/borrow?error=Unable to detect the signed-in email address.");
  }

  const { data: loan, error } = await supabase.rpc(assigningEmployee ? "admin_borrow_vehicle" : "borrow_vehicle", {
    p_vehicle_id: vehicleId,
    ...(assigningEmployee ? { p_borrower_user_id: borrowerUserId } : { p_driver_name: driverName }),
    p_purpose: purpose,
    p_start_odometer: startOdometer,
    p_borrow_notes: borrowNotes,
    p_expected_return_at: expectedReturnAt,
    p_long_term: isLongTerm,
  });

  if (error) {
    redirect(`/borrow?error=${encodeURIComponent(borrowError(error, "borrow the vehicle"))}`);
  }

  if (assigningEmployee && loan) {
    driverName = loan.driver_name;
    borrowerEmail = loan.borrower_email;
  }

  try {
    await sendBorrowConfirmationEmail({
      supabase,
      borrowerEmail,
      vehicleId,
      driverName,
      purpose,
      startOdometer,
      expectedReturnAt,
      isLongTerm,
      borrowNotes,
    });
  } catch (notificationError) {
    console.error("Failed to send borrow confirmation email.", notificationError);
  }

  if (isLongTerm) {
    try {
      await sendLongTermBorrowAdminNotificationEmail({
        supabase,
        borrowerEmail,
        vehicleId,
        driverName,
        purpose,
        startOdometer,
        borrowNotes,
      });
    } catch (notificationError) {
      console.error("Failed to send long term borrow admin notification email.", notificationError);
    }
  }

  clearFleetSnapshotCache();
  clearVehicleCalendarCache(vehicleId);
  revalidatePath("/dashboard");
  revalidatePath("/borrow");
  revalidatePath("/return");
  revalidatePath("/history");
  revalidatePath("/admin");
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  redirect(assigningEmployee ? "/borrow?message=Vehicle assigned successfully. The employee can now view this borrow in their dashboard." : "/dashboard?message=Vehicle borrowed successfully.");
}

export async function extendVehicleLoan(formData: FormData) {
  const returnPath = getExtendReturnPath(formData);
  const loanId = String(formData.get("loanId") ?? "");
  const expectedReturnAtValue = String(formData.get("expectedReturnAt") ?? "").trim();
  const extensionReason = String(formData.get("extensionReason") ?? "").trim();
  const expectedReturnAt = expectedReturnAtValue ? parseDateTimeLocalToUtcIso(expectedReturnAtValue) : null;

  if (!loanId || !expectedReturnAt || !extensionReason) {
    redirect(`${returnPath}?error=Please choose a new return time and enter an extension reason.`);
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
    redirect(`${returnPath}?error=${encodeURIComponent(borrowError(loanLoadError, "load the borrow record"))}`);
  }

  const { error } = await supabase.rpc("extend_vehicle_loan", {
    p_loan_id: loanId,
    p_expected_return_at: expectedReturnAt,
    p_extension_reason: extensionReason,
  });

  if (error) {
    redirect(`${returnPath}?error=${encodeURIComponent(borrowError(error, "extend the borrow"))}`);
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
  redirect(`${returnPath}?message=Borrow time extended successfully.`);
}
