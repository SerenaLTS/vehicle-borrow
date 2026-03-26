import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createVehicle, retireVehicle, updateVehicle } from "@/app/admin/actions";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin, type UserRole } from "@/lib/user-roles";
import { formatDisplayName } from "@/lib/utils";
import type { Vehicle } from "@/lib/types";

type AdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
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

  const [{ data: roles }, { data: vehicles }] = await Promise.all([
    supabase.from("user_roles").select("user_id, email, is_admin, created_at, updated_at").order("email"),
    supabase.from("vehicles").select("id, plate_number, model, status, comments").order("plate_number"),
  ]);

  const userRoles = (roles ?? []) as UserRole[];
  const fleet = (vehicles ?? []) as Vehicle[];
  const message = typeof params.message === "string" ? params.message : null;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <AppShell
      title="Admin"
      subtitle="Review users and fleet records. Admin access is controlled from Supabase."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref="/admin"
    >
      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="message error">{error}</p> : null}

      <section className="panel">
        <h2>How admin access works</h2>
        <div className="vehicleMeta">
          <span>Open Supabase Table Editor and edit the `public.user_roles` table.</span>
          <span>Set `is_admin` to true for any user who should access this page.</span>
          <span>Do not edit admin access in code. This page only reads the database flag.</span>
        </div>
      </section>

      <section className="panel">
        <h2>Add vehicle</h2>
        <form action={createVehicle}>
          <div className="formGrid">
            <label className="fieldLabel">
              Plate number
              <input name="plateNumber" placeholder="ABC123" required />
            </label>
            <label className="fieldLabel">
              Model
              <input name="model" placeholder="T9 PHEV" required />
            </label>
          </div>

          <label className="fieldLabel">
            Status
            <select defaultValue="available" name="status" required>
              <option value="available">available</option>
              <option value="booked">booked</option>
              <option value="maintenance">maintenance</option>
              <option value="retired">retired</option>
            </select>
          </label>

          <label className="fieldLabel">
            Comments
            <textarea name="comments" placeholder="Booked for next week, service notes, or anything the team should know" />
          </label>

          <SubmitButton className="primaryButton" idleLabel="Add vehicle" pendingLabel="Adding..." />
        </form>
      </section>

      <section className="sectionHeader">
        <div>
          <h2>Users</h2>
          <p className="muted">Users appear here automatically after they sign up or after the schema backfill runs.</p>
        </div>
      </section>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Admin</th>
              <th>Joined</th>
              <th>Last synced</th>
            </tr>
          </thead>
          <tbody>
            {userRoles.map((role) => (
              <tr key={role.user_id}>
                <td>{role.email}</td>
                <td>{role.is_admin ? "Yes" : "No"}</td>
                <td>{new Date(role.created_at).toLocaleString("en-AU")}</td>
                <td>{new Date(role.updated_at).toLocaleString("en-AU")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="sectionHeader">
        <div>
          <h2>Fleet manager</h2>
          <p className="muted">Edit vehicle details here. Borrowed vehicles can keep their model updated, but their status stays system-controlled until returned.</p>
        </div>
      </section>

      <div className="cardsGrid">
        {fleet.map((vehicle) => (
          <article className="vehicleCard" key={vehicle.id}>
            <StatusPill status={vehicle.status} />
            <h3>{vehicle.plate_number}</h3>
            <p className="muted">{vehicle.model}</p>

            <form action={updateVehicle}>
              <input name="vehicleId" type="hidden" value={vehicle.id} />

              <label className="fieldLabel">
                Model
                <input defaultValue={vehicle.model} name="model" required />
              </label>

              {vehicle.status === "borrowed" ? (
                <div className="fieldLabel">
                  <span>Status</span>
                  <p className="muted">borrowed</p>
                </div>
              ) : (
                <label className="fieldLabel">
                  Status
                  <select defaultValue={vehicle.status} name="status" required>
                    <option value="available">available</option>
                    <option value="booked">booked</option>
                    <option value="maintenance">maintenance</option>
                    <option value="retired">retired</option>
                  </select>
                </label>
              )}

              <label className="fieldLabel">
                Comments
                <textarea
                  defaultValue={vehicle.comments ?? ""}
                  name="comments"
                  placeholder="Booking details, issues, handover notes..."
                />
              </label>

              <div className="actionsRow">
                <SubmitButton className="primaryButton" idleLabel="Save changes" pendingLabel="Saving..." />
              </div>
            </form>

            {vehicle.status !== "borrowed" ? (
              <form action={retireVehicle}>
                <input name="vehicleId" type="hidden" value={vehicle.id} />
                <SubmitButton className="ghostButton" idleLabel="Mark as retired" pendingLabel="Retiring..." />
              </form>
            ) : (
              <p className="muted">Return this vehicle before retiring it.</p>
            )}
          </article>
        ))}
      </div>
    </AppShell>
  );
}
