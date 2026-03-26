import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDisplayName } from "@/lib/utils";
import { borrowVehicle } from "@/app/borrow/actions";
import type { Vehicle } from "@/lib/types";

type BorrowPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BorrowPage({ searchParams }: BorrowPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const isAdmin = await getIsAdmin(supabase, user.id);

  const { data } = await supabase
    .from("vehicles")
    .select("id, plate_number, model, status, comments")
    .in("status", ["available", "booked"])
    .order("plate_number");

  const vehicles = (data ?? []) as Vehicle[];
  const availableVehicles = vehicles.filter((vehicle) => vehicle.status === "available");
  const bookedVehicles = vehicles.filter((vehicle) => vehicle.status === "booked");
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <AppShell
      title="Borrow"
      subtitle="Choose an available vehicle and record who is driving it."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref={isAdmin ? "/admin" : undefined}
    >
      <section className="panel">
        <h2>Borrow a vehicle</h2>
        <p className="muted">Only vehicles marked available can be borrowed. Vehicles marked booked are shown below for visibility.</p>

        {availableVehicles.length === 0 ? (
          <div className="emptyState">No vehicles are available right now.</div>
        ) : (
          <form action={borrowVehicle}>
            <label className="fieldLabel">
              Borrowing as
              <input defaultValue={user.email ?? ""} disabled />
            </label>

            <label className="fieldLabel">
              Vehicle
              <select name="vehicleId" required defaultValue="">
                <option disabled value="">
                  Select a vehicle
                </option>
                {availableVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plate_number} • {vehicle.model}
                  </option>
                ))}
              </select>
            </label>

            <div className="formGrid">
              <label className="fieldLabel">
                Driver (if applicable)
                <input name="driverName" placeholder="Influencer or other driver name" />
              </label>
              <label className="fieldLabel">
                Purpose
                <input name="purpose" placeholder="Client visit, airport pickup..." required />
              </label>
            </div>

            <label className="fieldLabel">
              Current odometer (km)
              <input min="0" name="startOdometer" required type="number" />
            </label>

            <label className="fieldLabel">
              Notes
              <textarea name="borrowNotes" placeholder="Optional booking notes" />
            </label>

            <SubmitButton className="primaryButton" idleLabel="Confirm borrow" pendingLabel="Saving..." />
          </form>
        )}

        {error ? <p className="message error">{error}</p> : null}
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Available now</h2>
          <p className="muted">Snapshot of vehicles that can be borrowed immediately.</p>
        </div>
      </section>

      <div className="cardsGrid">
        {availableVehicles.map((vehicle) => (
          <article className="vehicleCard" key={vehicle.id}>
            <StatusPill status="available" />
            <h3>{vehicle.plate_number}</h3>
            <p className="muted">{vehicle.model}</p>
          </article>
        ))}
      </div>

      {bookedVehicles.length > 0 ? (
        <>
          <section className="sectionHeader">
            <div>
              <h2>Booked</h2>
              <p className="muted">These vehicles are currently reserved and cannot be borrowed from this page.</p>
            </div>
          </section>

          <div className="cardsGrid">
            {bookedVehicles.map((vehicle) => (
              <article className="vehicleCard" key={vehicle.id}>
                <StatusPill status="booked" />
                <h3>{vehicle.plate_number}</h3>
                <p className="muted">{vehicle.model}</p>
                {vehicle.comments ? <div className="vehicleMeta"><span>{vehicle.comments}</span></div> : null}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
