import { redirect } from "next/navigation";
import { AdminFleetSearch } from "@/components/admin-fleet-search";
import { AppShell } from "@/components/app-shell";
import { LoadingLink } from "@/components/loading-link";
import { StatusPill } from "@/components/status-pill";
import { createClient } from "@/lib/supabase/server";
import { getFleetSnapshot } from "@/lib/fleet-cache";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDateTime, formatDisplayName, getVehicleDisplayStatus } from "@/lib/utils";

function text(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

export default async function FleetPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const [snapshot, isAdmin] = await Promise.all([getFleetSnapshot(supabase), getIsAdmin(supabase, user.id)]);

  return (
    <AppShell
      title="Fleet"
      subtitle="View the company fleet and current vehicle information."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref={isAdmin ? "/admin" : undefined}
    >
      <section className="sectionHeader">
        <div>
          <h2>All vehicles</h2>
          <p className="muted">This page is read-only. Contact an administrator if vehicle information needs updating.</p>
        </div>
      </section>

      <AdminFleetSearch totalCount={snapshot.vehicles.length}>
        {snapshot.vehicles.map((vehicle) => {
          const nextBooking = snapshot.nextBookingByVehicleId.get(vehicle.id);
          const now = Date.now();
          const hasActiveBooking = Boolean(nextBooking && new Date(nextBooking.starts_at).getTime() <= now &&
            (nextBooking.is_long_term || (nextBooking.ends_at ? new Date(nextBooking.ends_at).getTime() > now : false)));
          const status = getVehicleDisplayStatus({
            storedStatus: vehicle.status,
            hasActiveLoan: snapshot.activeLoanVehicleIds.has(vehicle.id),
            hasCurrentHolder: Boolean(vehicle.current_holder_user_id),
            hasActiveBooking,
          });
          const canReserve = !["retired", "sold", "maintenance", "repair", "suspended", "in_transit"].includes(vehicle.status);

          return (
            <article
              className="vehicleCard"
              data-fleet-card
              data-search={[
                vehicle.plate_number, vehicle.vin, vehicle.color, vehicle.make, vehicle.model,
                vehicle.model_year, vehicle.vehicle_type, vehicle.department, vehicle.fuel_type,
                vehicle.current_location_name, vehicle.location, vehicle.registration_state,
              ].filter(Boolean).join(" ")}
              key={vehicle.id}
            >
              <div className="vehicleCardHeader">
                <div>
                  <StatusPill status={status} />
                  <h3>{vehicle.plate_number}</h3>
                  <p className="muted">{[vehicle.make, vehicle.model, vehicle.model_year].filter(Boolean).join(" • ") || "Vehicle"}</p>
                </div>
              </div>
              <div className="vehicleMeta">
                <span><strong>VIN</strong>{text(vehicle.vin)}</span>
                <span><strong>Colour</strong>{text(vehicle.color)}</span>
                <span><strong>Type</strong>{text(vehicle.vehicle_type)}</span>
                <span><strong>Fuel</strong>{text(vehicle.fuel_type)}</span>
                <span><strong>Department</strong>{text(vehicle.department)}</span>
                <span><strong>Current location</strong>{text(vehicle.current_location_name ?? vehicle.location)}</span>
                <span><strong>Location address</strong>{text(vehicle.current_location_address)}</span>
                <span><strong>Default parking</strong>{text(vehicle.default_parking_location)}</span>
                <span><strong>Registration</strong>{[vehicle.registration_state, vehicle.registration_expires_on ? `expires ${vehicle.registration_expires_on}` : null].filter(Boolean).join(" • ") || "-"}</span>
                <span><strong>Insurance expiry</strong>{text(vehicle.insurance_expires_on)}</span>
                <span><strong>Inspection expiry</strong>{text(vehicle.inspection_expires_on)}</span>
                <span><strong>Expected return / arrival</strong>{formatDateTime(vehicle.expected_return_or_arrival_at)}</span>
                <span><strong>Usage restrictions</strong>{text(vehicle.usage_restrictions)}</span>
                <span><strong>Comments</strong>{text(vehicle.comments)}</span>
              </div>
              <div className="actionsRow">
                {status === "available" ? (
                  <LoadingLink className="primaryButton" href={`/borrow?vehicleId=${encodeURIComponent(vehicle.id)}`}>Borrow</LoadingLink>
                ) : null}
                {canReserve ? (
                  <LoadingLink className="secondaryButton" href={`/vehicle-calendar/${encodeURIComponent(vehicle.id)}?from=%2Ffleet&action=reserve`}>Reserve</LoadingLink>
                ) : null}
              </div>
            </article>
          );
        })}
      </AdminFleetSearch>
    </AppShell>
  );
}
