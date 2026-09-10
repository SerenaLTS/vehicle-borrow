"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { fineDeliveryFingerprint, loadFineDrivers, requireFineAdmin } from "@/lib/fine-notice-server";
import { buildFineEmail, FINE_PDF_BUCKET, FINE_PDF_MAX_BYTES, isSingleEmail, matchingFineDrivers, parseFineAmount, parseFineDateTime, type FineNotice } from "@/lib/fine-notices";
import { clearVehicleCalendarCache } from "@/lib/vehicle-calendar-cache";
import { sendFineNoticeEmail } from "@/lib/booking-notifications";

export type FineFormState = { error?: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createFineNotice(_previous: FineFormState, form: FormData): Promise<FineFormState> {
  const { supabase } = await requireFineAdmin();
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const id = value("requestId");
  const vehicleId = value("vehicleId");
  if (!uuidPattern.test(id) || !uuidPattern.test(vehicleId)) return { error: "Invalid vehicle or notice ID. Reload and try again." };
  const occurredAt = parseFineDateTime(value("occurredAt"));
  const amount = parseFineAmount(value("amount"));
  const name = value("driverName");
  const email = value("driverEmail").toLowerCase();
  const noticeNumber = value("noticeNumber");
  const location = value("location");
  const reason = value("reason");
  if (!occurredAt || Date.parse(occurredAt) > Date.now()) return { error: "Enter a valid offence date and time in the past (Australia/Sydney)." };
  if (amount === null) return { error: "Enter a positive fine amount with up to two decimal places." };
  if (!name || name.length > 200 || !isSingleEmail(email)) return { error: "Enter the driver's name and a single valid email address." };
  if (!noticeNumber || noticeNumber.length > 100 || /[\r\n]/.test(noticeNumber) || !location || location.length > 500 || !reason || reason.length > 2000) return { error: "Complete the notice number, location and reason within the field limits." };
  if (!["required", "on_file"].includes(value("licence"))) return { error: "Choose whether a driver licence copy is needed." };
  let uploadedPath: string | null = null;
  const admin = createAdminClient();
  try {
    const existing = await supabase.from("vehicle_fine_notices").select("id").eq("id", id).eq("vehicle_id", vehicleId).maybeSingle();
    if (existing.error) return { error: "Unable to load fine notices. Check that the database migration has been applied." };
    if (!existing.data) {
      const [{ data: vehicle, error: vehicleError }, records] = await Promise.all([
        supabase.from("vehicles").select("plate_number").eq("id", vehicleId).maybeSingle(),
        loadFineDrivers(supabase, vehicleId),
      ]);
      if (vehicleError || !vehicle) return { error: "Unable to load this vehicle." };
      const matching = matchingFineDrivers(records, occurredAt);
      const sourceKey = value("driverRecord");
      const selected = matching.find((record) => `${record.source}:${record.id}` === sourceKey);
      let startsAt: string | null = null;
      let endsAt: string | null = null;
      if (!selected) {
        if (sourceKey !== "manual" || matching.length) return { error: "Select a driver record covering the offence time. Reload if the records have changed." };
        startsAt = parseFineDateTime(value("startsAt"));
        endsAt = parseFineDateTime(value("endsAt"));
        if (!startsAt || !endsAt || startsAt > occurredAt || endsAt <= occurredAt || Date.parse(endsAt) > Date.now()) return { error: "Enter a completed driving period that includes the offence time." };
        if (records.some((record) => Date.parse(record.startsAt) < Date.parse(endsAt!) && (!record.endsAt || Date.parse(record.endsAt) > Date.parse(startsAt!)))) return { error: "This driving period overlaps an existing record. Review the calendar and adjust the times." };
      }
      const file = form.get("pdf");
      let attachmentName: string | null = null;
      if (file instanceof File && file.size > 0) {
        if (file.size > FINE_PDF_MAX_BYTES || !file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) return { error: "Upload a PDF no larger than 3 MB." };
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return { error: "The attachment is not a valid PDF file." };
        attachmentName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
        const path = `${vehicleId}/${id}/${randomUUID()}.pdf`;
        const { error } = await admin.storage.from(FINE_PDF_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
        if (error) return { error: "Unable to upload the PDF. Check storage setup and try again." };
        uploadedPath = path;
      }
      const details = { notice_number: noticeNumber, occurred_at: occurredAt, location, reason, amount_cents: amount, rego: vehicle.plate_number, driver_name: name, driver_email: email, requires_licence: value("licence") === "required" };
      const message = buildFineEmail(details, Boolean(uploadedPath));
      const { error } = await supabase.rpc("admin_create_fine_notice", { p_data: {
        id, vehicle_id: vehicleId, ...details, loan_id: selected?.source === "loan" ? selected.id : null,
        driver_record_id: selected?.source === "history" ? selected.id : null,
        starts_at: startsAt, ends_at: endsAt, attachment_path: uploadedPath, attachment_name: attachmentName,
        email_subject: message.subject, email_body: message.text,
      } });
      if (error) {
        // A network timeout may happen after commit: never delete a PDF that a saved notice uses.
        const saved = await supabase.from("vehicle_fine_notices").select("attachment_path").eq("id", id).maybeSingle();
        if (!saved.error && uploadedPath && saved.data?.attachment_path !== uploadedPath) await admin.storage.from(FINE_PDF_BUCKET).remove([uploadedPath]);
        if (!saved.data) return { error: error.code === "23505" ? "This notice number is already registered for this vehicle. Open the existing notice from the vehicle page." : "Unable to save. The driver records may have changed; review the times and try again." };
      } else if (uploadedPath) {
        // Concurrent submissions with the same request ID can create only one notice.
        const saved = await supabase.from("vehicle_fine_notices").select("attachment_path").eq("id", id).maybeSingle();
        if (!saved.error && saved.data && saved.data.attachment_path !== uploadedPath) await admin.storage.from(FINE_PDF_BUCKET).remove([uploadedPath]);
      }
    }
  } catch {
    return { error: "Unable to save the notice right now. Your entries are still here; try again." };
  }
  clearVehicleCalendarCache(vehicleId);
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath(`/vehicle-calendar/${vehicleId}`);
  redirect(`/admin/vehicles/${vehicleId}/fines/${id}`);
}

export async function sendFineNotice(form: FormData) {
  const { supabase, user } = await requireFineAdmin();
  const id = String(form.get("fineId") ?? "");
  const vehicleId = String(form.get("vehicleId") ?? "");
  if (!uuidPattern.test(id) || !uuidPattern.test(vehicleId)) redirect("/admin?error=Invalid notice.");
  const href = `/admin/vehicles/${vehicleId}/fines/${id}`;
  const finish = (message: string) => redirect(`${href}?message=${encodeURIComponent(message)}`);
  const { data, error } = await supabase.from("vehicle_fine_notices").select("*").eq("id", id).eq("vehicle_id", vehicleId).maybeSingle();
  if (error || !data) finish("Unable to load this notice.");
  const fine = data as FineNotice;
  if (fine.status === "sent") finish("This notice has already been sent.");
  if (form.get("emailFingerprint") !== fineDeliveryFingerprint(fine)) finish("The email preview has changed. Review the updated message before sending.");
  const uncertain = fine.status === "delivery_unknown" || fine.status === "sending";
  if (uncertain && form.get("confirmRetry") !== "on") finish("Check the recipient's mailbox or mail logs before retrying; the earlier email may have been sent.");
  if (fine.status === "sending" && (!fine.send_started_at || Date.now() - Date.parse(fine.send_started_at) < 5 * 60_000)) finish("Sending is already in progress. Wait before checking again.");
  const admin = createAdminClient();
  let attachment: { filename: string; content: Buffer } | undefined;
  if (fine.attachment_path) {
    const { data: pdf, error: pdfError } = await admin.storage.from(FINE_PDF_BUCKET).download(fine.attachment_path);
    if (pdfError || !pdf) finish("Unable to load the PDF. Nothing was sent; try again.");
    attachment = { filename: fine.attachment_name ?? "fine-notice.pdf", content: Buffer.from(await pdf!.arrayBuffer()) };
  }
  const started = new Date().toISOString();
  let claim = admin.from("vehicle_fine_notices").update({ status: "sending", send_started_at: started, sent_by: user.id }).eq("id", id).eq("status", fine.status).eq("driver_email", fine.driver_email).eq("email_body", fine.email_body).eq("email_subject", fine.email_subject);
  claim = fine.send_started_at ? claim.eq("send_started_at", fine.send_started_at) : claim.is("send_started_at", null);
  const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
  if (claimError || !claimed) finish("Another request is handling this notice. Refresh to see its status.");
  let outcome: "sent" | "failed" | "delivery_unknown" = "delivery_unknown";
  let messageId: string | null = null;
  try {
    const result = await sendFineNoticeEmail({ to: fine.driver_email, subject: fine.email_subject, text: fine.email_body, attachment, noticeId: fine.id });
    outcome = result.sent ? "sent" : "failed";
    messageId = result.messageId ?? null;
  } catch {
    // SMTP timeouts can occur after acceptance; make any retry an explicit admin decision.
    outcome = "delivery_unknown";
  }
  const { error: statusError } = await admin.from("vehicle_fine_notices").update({ status: outcome, sent_at: outcome === "sent" ? new Date().toISOString() : null, message_id: messageId }).eq("id", id).eq("status", "sending").eq("send_started_at", started);
  revalidatePath(`/admin/vehicles/${vehicleId}`);
  revalidatePath(href);
  finish(statusError ? "The delivery status could not be saved. Check mail logs before retrying." : outcome === "sent" ? "Fine notice email sent." : outcome === "failed" ? "Email was not sent. Check SMTP configuration and try again." : "Delivery could not be confirmed. Check mail logs before retrying to avoid a duplicate email.");
}

export async function updateFineDraft(form: FormData) {
  const { supabase } = await requireFineAdmin();
  const id = String(form.get("fineId") ?? "");
  const vehicleId = String(form.get("vehicleId") ?? "");
  if (!uuidPattern.test(id) || !uuidPattern.test(vehicleId)) redirect("/admin?error=Invalid notice.");
  const href = `/admin/vehicles/${vehicleId}/fines/${id}`;
  const name = String(form.get("driverName") ?? "").trim();
  const email = String(form.get("driverEmail") ?? "").trim().toLowerCase();
  const licence = String(form.get("licence") ?? "");
  const subject = String(form.get("emailSubject") ?? "").trim();
  const body = String(form.get("emailBody") ?? "");
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || !body.trim() || body.length > 20000) redirect(`${href}?message=Enter a subject (up to 200 characters) and email text (up to 20000 characters).`);
  if (!name || name.length > 200 || !isSingleEmail(email) || !["required", "on_file"].includes(licence)) redirect(`${href}?message=Enter a driver name, valid email and licence choice.`);
  const { data } = await supabase.from("vehicle_fine_notices").select("*").eq("id", id).eq("vehicle_id", vehicleId).eq("status", "draft").maybeSingle();
  if (!data) redirect(`${href}?message=Only unsent drafts can be edited.`);
  const fine = data as FineNotice;
  const changes = { driver_name: name, driver_email: email, requires_licence: licence === "required" };
  const { data: updated, error } = await createAdminClient().from("vehicle_fine_notices").update({ ...changes, email_subject: subject, email_body: body }).eq("id", id).eq("status", "draft").eq("email_subject", fine.email_subject).eq("email_body", fine.email_body).eq("driver_email", fine.driver_email).select("id").maybeSingle();
  revalidatePath(href);
  redirect(`${href}?message=${encodeURIComponent(error || !updated ? "Unable to update. The draft may have changed or sending may already have started." : "Draft saved. Review the saved email below before sending.")}`);
}
