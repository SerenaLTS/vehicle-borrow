"use client";

import { useActionState, useMemo, useState } from "react";
import { createFineNotice } from "@/app/admin/fine-actions";
import { FINE_PDF_MAX_BYTES, matchingFineDrivers, parseFineDateTime, type FineDriverRecord } from "@/lib/fine-notices";
import { formatUtcIsoForDateTimeLocalInput } from "@/lib/datetime";

export function FineNoticeForm({ vehicleId, requestId, date, records }: { vehicleId: string; requestId: string; date: string; records: FineDriverRecord[] }) {
  const [state, action, pending] = useActionState(createFineNotice, {});
  const [occurredAt, setOccurredAt] = useState(`${date}T00:00`);
  const [selection, setSelection] = useState("");
  const [fileError, setFileError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const field = (name: string, fallback = "") => ({ value: fields[name] ?? fallback, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setFields((current) => ({ ...current, [name]: event.target.value })) });
  function resetDriver() { setFields((current) => { const next = { ...current }; delete next.driverName; delete next.driverEmail; return next; }); }
  const iso = parseFineDateTime(occurredAt);
  const matching = useMemo(() => iso ? matchingFineDrivers(records, iso) : [], [records, iso]);
  const automatic = matching.length === 1 ? `${matching[0].source}:${matching[0].id}` : matching.length === 0 ? "manual" : "";
  const selectedKey = selection || automatic;
  const selected = matching.find((record) => `${record.source}:${record.id}` === selectedKey);
  const manual = selectedKey === "manual";

  return (
    <form action={action} className="formGrid" onSubmit={(event) => { if (fileError) event.preventDefault(); }}>
      <input name="vehicleId" type="hidden" value={vehicleId} />
      <input name="requestId" type="hidden" value={requestId} />
      <fieldset disabled={pending} className="fineFieldset">
        <div className="formGrid">
          <label className="fieldLabel">Notice number<input name="noticeNumber" {...field("noticeNumber")} required maxLength={100} /></label>
          <label className="fieldLabel">Offence date and time (Sydney)<input name="occurredAt" type="datetime-local" required value={occurredAt} onChange={(event) => { setOccurredAt(event.target.value); setSelection(""); resetDriver(); }} /></label>
          <label className="fieldLabel">Location<input name="location" {...field("location")} required maxLength={500} /></label>
          <label className="fieldLabel">Reason<textarea name="reason" {...field("reason")} required maxLength={2000} rows={3} /></label>
          <label className="fieldLabel">Fine amount (AUD)<input name="amount" {...field("amount")} type="number" min="0.01" max="9999999.99" step="0.01" required /></label>
        </div>
        {iso ? (
          <div className="formGrid">
            <label className="fieldLabel">Driver record
              <select name="driverRecord" value={selectedKey} required onChange={(event) => { setSelection(event.target.value); resetDriver(); }}>
                {matching.length > 1 ? <option value="">Choose the driver for this offence</option> : null}
                {matching.map((record) => <option key={`${record.source}:${record.id}`} value={`${record.source}:${record.id}`}>{record.driverName || record.driverEmail} · {record.driverEmail} · {formatUtcIsoForDateTimeLocalInput(record.startsAt).replace("T", " ")} – {record.endsAt ? formatUtcIsoForDateTimeLocalInput(record.endsAt).replace("T", " ") : "ongoing"}</option>)}
                {matching.length === 0 ? <option value="manual">No matching record — enter driver and driving period</option> : null}
              </select>
            </label>
            {matching.length > 1 ? <p className="muted">Multiple records cover this time. Confirm who was driving before sending.</p> : null}
            <div className="formGrid" key={`${occurredAt}:${selectedKey}`}>
              <label className="fieldLabel">Driver name<input name="driverName" {...field("driverName", selected?.driverName ?? "")} required maxLength={200} /></label>
              <label className="fieldLabel">Driver email<input name="driverEmail" type="email" {...field("driverEmail", selected?.driverEmail ?? "")} required maxLength={254} /></label>
              <p className="muted">Confirm the recipient is the actual driver. An existing record may contain the borrower’s email.</p>
              {manual ? <>
                <p className="muted">This completed driving period will be added to the vehicle calendar when you save the notice.</p>
                <label className="fieldLabel">Driving started (Sydney)<input name="startsAt" {...field("startsAt")} type="datetime-local" required max={occurredAt} /></label>
                <label className="fieldLabel">Driving ended (Sydney)<input name="endsAt" {...field("endsAt")} type="datetime-local" required min={occurredAt} /></label>
              </> : null}
            </div>
          </div>
        ) : <p className="muted">Choose the offence time to look up the driver.</p>}
        <label className="fieldLabel">Driver licence
          <select name="licence" required {...field("licence")}>
            <option value="" disabled>Choose whether a licence copy is needed</option>
            <option value="required">Request a copy of the driver licence</option>
            <option value="on_file">We already have the licence and will handle the notice</option>
          </select>
        </label>
        <label className="fieldLabel">Fine notice PDF (optional, up to 3 MB)
          <input name="pdf" type="file" accept="application/pdf,.pdf" onChange={(event) => {
            const file = event.target.files?.[0];
            const invalid = file && (file.size > FINE_PDF_MAX_BYTES || !file.name.toLowerCase().endsWith(".pdf"));
            setFileError(invalid ? "Choose a PDF no larger than 3 MB." : "");
          }} />
        </label>
        {fileError ? <p className="message error" role="alert">{fileError}</p> : null}
        {state.error ? <p className="message error" role="alert">{state.error} If you attached a PDF, select it again before retrying.</p> : null}
        <button className="primaryButton" type="submit" disabled={pending || Boolean(fileError) || !iso || !selectedKey}>{pending ? "Saving…" : "Save and preview email"}</button>
      </fieldset>
    </form>
  );
}
