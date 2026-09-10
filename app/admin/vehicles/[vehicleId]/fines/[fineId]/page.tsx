import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ConfirmForm } from "@/components/confirm-form";
import { SubmitButton } from "@/components/submit-button";
import { sendFineNotice, updateFineRecipient } from "@/app/admin/fine-actions";
import { fineDeliveryFingerprint, requireFineAdmin } from "@/lib/fine-notice-server";
import type { FineNotice } from "@/lib/fine-notices";
import { formatDateTime } from "@/lib/utils";

export default async function FinePage({ params, searchParams }: { params: Promise<{ vehicleId: string; fineId: string }>; searchParams: Promise<{ message?: string }> }) {
  const { vehicleId, fineId } = await params;
  const { message } = await searchParams;
  const { supabase, user } = await requireFineAdmin();
  const { data, error } = await supabase.from("vehicle_fine_notices").select("*").eq("id", fineId).eq("vehicle_id", vehicleId).maybeSingle();
  if (error) throw new Error("Unable to load fine notice.");
  if (!data) notFound();
  const fine = data as FineNotice;
  const uncertain = fine.status === "delivery_unknown" || fine.status === "sending";
  const inProgress = fine.status === "sending" && (!fine.send_started_at || Date.now() - Date.parse(fine.send_started_at) < 5 * 60_000);
  return <AppShell title={`Fine ${fine.notice_number} · ${fine.rego}`} subtitle="Fine notice and email" userLabel={user.email ?? "Admin"} backHref={`/admin/vehicles/${vehicleId}`} backLabel="Back to vehicle" adminHref="/admin">
    {message ? <p className="message" role="status">{message}</p> : null}
    <section className="panel">
      <h2>{fine.status === "sent" ? "Sent email" : "Email preview"}</h2>
      <div className="detailList">
        <div><strong>To</strong><span>{fine.driver_name} · {fine.driver_email}</span></div>
        <div><strong>Subject</strong><span>{fine.email_subject}</span></div>
        <div><strong>Status</strong><span>{fine.status.replaceAll("_", " ")}{fine.sent_at ? ` · ${formatDateTime(fine.sent_at)}` : ""}</span></div>
        <div><strong>PDF attachment</strong><span>{fine.attachment_path ? <a href={`/admin/vehicles/${vehicleId}/fines/${fine.id}/attachment`}>{fine.attachment_name}</a> : "No attachment"}</span></div>
      </div>
      {fine.status === "draft" ? <details>
        <summary>Edit recipient or licence request</summary>
        <form action={updateFineRecipient} className="formGrid">
          <input name="vehicleId" type="hidden" value={vehicleId} /><input name="fineId" type="hidden" value={fine.id} />
          <label className="fieldLabel">Driver name<input name="driverName" defaultValue={fine.driver_name} required maxLength={200} /></label>
          <label className="fieldLabel">Driver email<input name="driverEmail" type="email" defaultValue={fine.driver_email} required maxLength={254} /></label>
          <label className="fieldLabel">Driver licence<select name="licence" defaultValue={fine.requires_licence ? "required" : "on_file"}><option value="required">Request a licence copy</option><option value="on_file">We already have the licence</option></select></label>
          <SubmitButton className="secondaryButton" idleLabel="Update preview" pendingLabel="Updating…" />
        </form>
      </details> : null}
      <div className="fineEmailPreview">{fine.email_body}</div>
      {inProgress ? <p className="message">Sending is in progress. Refresh this page to check the result.</p> : fine.status !== "sent" ? <ConfirmForm action={sendFineNotice} confirmMessage={`Send this fine notice to ${fine.driver_email}${fine.attachment_path ? " with the PDF attached" : ""}?`}>
        <input type="hidden" name="vehicleId" value={vehicleId} /><input type="hidden" name="fineId" value={fine.id} /><input type="hidden" name="emailFingerprint" value={fineDeliveryFingerprint(fine)} />
        {uncertain ? <label className="checkboxRow"><input type="checkbox" name="confirmRetry" required />I have checked mail logs or the recipient’s mailbox. I understand retrying may send a duplicate.</label> : null}
        <SubmitButton className="primaryButton" idleLabel={fine.status === "draft" ? "Send email to driver" : "Retry email"} pendingLabel="Sending…" />
      </ConfirmForm> : null}
    </section>
  </AppShell>;
}
