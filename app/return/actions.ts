"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function returnVehicle(formData: FormData) {
  const loanId = String(formData.get("loanId") ?? "");
  const endOdometer = Number(formData.get("endOdometer") ?? 0);
  const returnNotes = String(formData.get("returnNotes") ?? "").trim() || null;

  if (!loanId || Number.isNaN(endOdometer) || endOdometer < 0) {
    redirect("/return?error=Please complete the return details.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { error } = await supabase.rpc("return_vehicle", {
    p_loan_id: loanId,
    p_end_odometer: endOdometer,
    p_return_notes: returnNotes,
  });

  if (error) {
    redirect(`/return?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard");
  revalidatePath("/borrow");
  revalidatePath("/return");
  revalidatePath("/history");
  redirect("/dashboard?message=Vehicle returned successfully.");
}
