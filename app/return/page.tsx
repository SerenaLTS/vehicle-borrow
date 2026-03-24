import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatDisplayName } from "@/lib/utils";
import { returnVehicle } from "@/app/return/actions";
import { normalizeLoan, type RawLoanRow } from "@/lib/types";

type ReturnPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReturnPage({ searchParams }: ReturnPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data } = await supabase
    .from("vehicle_loans")
    .select("id, vehicle_id, borrowed_by_user_id, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, returned_at, vehicle:vehicles(plate_number, model)")
    .eq("borrowed_by_user_id", user.id)
    .is("returned_at", null)
    .order("borrowed_at", { ascending: false });

  const loans = ((data ?? []) as RawLoanRow[]).map(normalizeLoan);
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <AppShell
      title="Return"
      subtitle="Close out a loan and update the odometer."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
    >
      <section className="panel">
        <h2>Return a vehicle</h2>
        <p className="muted">You can only return vehicles currently checked out by you.</p>

        {loans.length === 0 ? (
          <div className="emptyState">You do not have any active vehicle loans to return.</div>
        ) : (
          <form action={returnVehicle}>
            <label className="fieldLabel">
              Vehicle currently borrowed
              <select name="loanId" required defaultValue="">
                <option disabled value="">
                  Select a vehicle
                </option>
                {loans.map((loan) => (
                  <option key={loan.id} value={loan.id}>
                    {loan.vehicle?.plate_number} • {loan.vehicle?.model} • borrowed {formatDateTime(loan.borrowed_at)}
                  </option>
                ))}
              </select>
            </label>

            <label className="fieldLabel">
              Return odometer (km)
              <input min="0" name="endOdometer" required type="number" />
            </label>

            <label className="fieldLabel">
              Notes
              <textarea name="returnNotes" placeholder="Optional return notes" />
            </label>

            <button className="primaryButton" type="submit">
              Confirm return
            </button>
          </form>
        )}

        {error ? <p className="message error">{error}</p> : null}
      </section>

      {loans.length > 0 ? (
        <>
          <section className="sectionHeader">
            <div>
              <h2>Vehicles under your care</h2>
              <p className="muted">Use the list below to confirm you are returning the right vehicle.</p>
            </div>
          </section>

          <div className="cardsGrid">
            {loans.map((loan) => (
              <article className="vehicleCard" key={loan.id}>
                <h3>{loan.vehicle?.plate_number}</h3>
                <p className="muted">{loan.vehicle?.model}</p>
                <div className="vehicleMeta">
                  <span>Driver: {loan.driver_name}</span>
                  <span>Purpose: {loan.purpose}</span>
                  <span>Borrowed: {formatDateTime(loan.borrowed_at)}</span>
                  <span>Start odometer: {loan.start_odometer.toLocaleString()} km</span>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
