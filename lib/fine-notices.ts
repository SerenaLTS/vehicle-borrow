import { formatUtcIsoForDateTimeLocalInput, parseDateTimeLocalToUtcIso } from "@/lib/datetime";

export const FINE_PDF_MAX_BYTES = 3 * 1024 * 1024;
export const FINE_PDF_BUCKET = "fine-notices";
export type FineDriverRecord = {
  id: string;
  source: "loan" | "history";
  driverName: string;
  driverEmail: string;
  startsAt: string;
  endsAt: string | null;
};
export type FineNotice = {
  id: string; vehicle_id: string; notice_number: string; occurred_at: string;
  location: string; reason: string; amount_cents: number; rego: string;
  driver_name: string; driver_email: string; requires_licence: boolean;
  loan_id: string | null; driver_record_id: string | null;
  attachment_path: string | null; attachment_name: string | null;
  email_subject: string; email_body: string;
  status: "draft" | "sending" | "sent" | "failed" | "delivery_unknown";
  sent_at: string | null; send_started_at: string | null; created_at: string;
};
export type FineDriverHistory = {
  id: string; driver_name: string; driver_email: string; starts_at: string; ends_at: string;
};

export function parseFineDateTime(value: string) {
  const iso = parseDateTimeLocalToUtcIso(value);
  // Reject invalid dates and local times skipped by daylight saving.
  return iso && formatUtcIsoForDateTimeLocalInput(iso) === value ? iso : null;
}

export function parseFineAmount(value: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  const [dollars, cents = ""] = value.split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return amount > 0 ? amount : null;
}

export function matchingFineDrivers(records: FineDriverRecord[], occurredAt: string) {
  const time = Date.parse(occurredAt);
  return records.filter((record) => Date.parse(record.startsAt) <= time && (!record.endsAt || time < Date.parse(record.endsAt)));
}

export function isSingleEmail(value: string) {
  return value.length <= 254 && /^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(value);
}

export function buildFineEmail(fine: Pick<FineNotice, "notice_number" | "occurred_at" | "location" | "reason" | "amount_cents" | "rego" | "driver_name" | "requires_licence">, hasAttachment: boolean) {
  const date = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", dateStyle: "full", timeStyle: "short",
  }).format(new Date(fine.occurred_at));
  return {
    subject: `Fine notice ${fine.notice_number} — ${fine.rego}`,
    text: [
      `Hi ${fine.driver_name},`, "",
      "We have received a fine notice for the vehicle recorded as being driven by you at the time below.", "",
      `Notice number: ${fine.notice_number}`,
      `Vehicle rego: ${fine.rego}`,
      `Date and time: ${date} (Australia/Sydney)`,
      `Location: ${fine.location}`,
      `Reason: ${fine.reason}`,
      `Fine amount: AUD ${(fine.amount_cents / 100).toFixed(2)}`, "",
      fine.requires_licence
        ? "Please reply to this email with a copy of your driver licence so we can process this fine notice."
        : "We already have a copy of your driver licence on file and will process this fine notice.",
      ...(hasAttachment ? ["", "A PDF copy of the fine notice is attached."] : []),
      "", "If these driving details are incorrect, please let us know by replying to this email.",
      "", "Thank you,", "Fleet Management",
    ].join("\n"),
  };
}
