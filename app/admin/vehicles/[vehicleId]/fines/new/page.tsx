import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FineNoticeForm } from "@/components/fine-notice-form";
import { loadFineDrivers, requireFineAdmin } from "@/lib/fine-notice-server";
import { formatUtcIsoForDateTimeLocalInput } from "@/lib/datetime";
import { parseFineDateTime } from "@/lib/fine-notices";

export default async function NewFinePage({ params, searchParams }: { params: Promise<{ vehicleId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { vehicleId } = await params;
  const { date: requestedDate } = await searchParams;
  const { supabase, user } = await requireFineAdmin();
  const { data: vehicle } = await supabase.from("vehicles").select("id, plate_number, model").eq("id", vehicleId).maybeSingle();
  if (!vehicle) notFound();
  const date = requestedDate && parseFineDateTime(`${requestedDate}T12:00`) ? requestedDate : formatUtcIsoForDateTimeLocalInput(new Date().toISOString()).slice(0, 10);
  let records: Awaited<ReturnType<typeof loadFineDrivers>> = [];
  let error = "";
  try { records = await loadFineDrivers(supabase, vehicleId); } catch { error = "Fine notices are not available yet. Apply the fine notice database migration, then reload."; }
  return <AppShell title={`Fine notice · ${vehicle.plate_number}`} subtitle={vehicle.model} userLabel={user.email ?? "Admin"} backHref={`/admin/vehicles/${vehicleId}?month=${date.slice(0, 7)}`} backLabel="Back to vehicle" adminHref="/admin">
    <section className="panel">
      <h2>Register a fine notice</h2>
      <p className="muted">Enter the offence details, confirm the driver, then preview and send the email. Rego: {vehicle.plate_number}.</p>
      {error ? <p className="message error">{error}</p> : <FineNoticeForm vehicleId={vehicleId} requestId={randomUUID()} date={date} records={records} />}
    </section>
  </AppShell>;
}
