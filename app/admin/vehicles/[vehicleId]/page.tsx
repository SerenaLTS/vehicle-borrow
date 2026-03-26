import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName } from "@/lib/utils";
import { normalizeLoan, type RawLoanRow, type Vehicle } from "@/lib/types";

type VehicleRecordPageProps = {
  params: Promise<{
    vehicleId: string;
  }>;
};

export default async function VehicleRecordPage({ params }: VehicleRecordPageProps) {
  const { vehicleId } = await params;
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

  const [{ data: vehicle, error: vehicleError }, { data: loanData, error: loansError }] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate_number, model, status, comments, current_holder_user_id")
      .eq("id", vehicleId)
      .maybeSingle(),
    supabase
      .from("vehicle_loans")
      .select(
        "id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)",
      )
      .eq("vehicle_id", vehicleId)
      .order("borrowed_at", { ascending: false }),
  ]);

  if (vehicleError) {
    redirect(`/admin?error=${encodeURIComponent(vehicleError.message)}`);
  }

  if (!vehicle) {
    redirect("/admin?error=Vehicle not found.");
  }

  if (loansError) {
    redirect(`/admin?error=${encodeURIComponent(loansError.message)}`);
  }

  const record = vehicle as Vehicle;
  const history = ((loanData ?? []) as RawLoanRow[]).map(normalizeLoan);
  const currentLoan = history.find((loan) => loan.returned_at === null) ?? null;

  return (
    <AppShell
      title={record.plate_number}
      subtitle="Vehicle borrowing history and current assignment details."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/admin"
      backLabel="Back to admin"
      adminHref="/admin"
    >
      <section className="panel">
        <div className="sectionHeader compactSectionHeader">
          <div>
            <StatusPill status={record.status} />
            <h2>{record.model}</h2>
            <p className="muted">Vehicle ID: {record.id}</p>
          </div>
          <Link className="secondaryButton" href="/admin">
            All vehicles
          </Link>
        </div>

        <div className="detailList">
          <div>
            <strong>Plate number</strong>
            <span>{record.plate_number}</span>
          </div>
          <div>
            <strong>Status</strong>
            <span>{record.status}</span>
          </div>
          <div>
            <strong>Current borrower</strong>
            <span>{currentLoan?.borrower_email ?? "-"}</span>
          </div>
          <div>
            <strong>Driver</strong>
            <span>{currentLoan?.driver_name ?? "-"}</span>
          </div>
          <div>
            <strong>Borrowed at</strong>
            <span>{formatDateTime(currentLoan?.borrowed_at ?? null)}</span>
          </div>
          <div>
            <strong>Comments</strong>
            <span>{record.comments || "-"}</span>
          </div>
        </div>
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Borrow records</h2>
          <p className="muted">All recorded loans for this vehicle, newest first.</p>
        </div>
      </section>

      {history.length === 0 ? (
        <div className="emptyState">No borrowing history has been recorded for this vehicle yet.</div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Driver</th>
                <th>Purpose</th>
                <th>Borrowed</th>
                <th>Returned</th>
                <th>Start KM</th>
                <th>End KM</th>
              </tr>
            </thead>
            <tbody>
              {history.map((loan) => (
                <tr key={loan.id}>
                  <td>{loan.borrower_email}</td>
                  <td>{loan.driver_name}</td>
                  <td>{loan.purpose}</td>
                  <td>{formatDateTime(loan.borrowed_at)}</td>
                  <td>{formatDateTime(loan.returned_at)}</td>
                  <td>{loan.start_odometer?.toLocaleString() ?? "-"}</td>
                  <td>{loan.end_odometer?.toLocaleString() ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
