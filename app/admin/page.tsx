import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin, type UserRole } from "@/lib/user-roles";
import { formatDisplayName } from "@/lib/utils";
import type { Vehicle } from "@/lib/types";

export default async function AdminPage() {
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
    supabase.from("vehicles").select("id, plate_number, model, status, current_holder_user_id").order("plate_number"),
  ]);

  const userRoles = (roles ?? []) as UserRole[];
  const fleet = (vehicles ?? []) as Vehicle[];

  return (
    <AppShell
      title="Admin"
      subtitle="Review users and fleet records. Admin access is controlled from Supabase."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      adminHref="/admin"
    >
      <section className="panel">
        <h2>How admin access works</h2>
        <div className="vehicleMeta">
          <span>Open Supabase Table Editor and edit the `public.user_roles` table.</span>
          <span>Set `is_admin` to true for any user who should access this page.</span>
          <span>Do not edit admin access in code. This page only reads the database flag.</span>
        </div>
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
          <h2>Fleet</h2>
          <p className="muted">Use this list to confirm which vehicles are active, under maintenance, borrowed, or retired.</p>
        </div>
      </section>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Plate</th>
              <th>Model</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>{vehicle.plate_number}</td>
                <td>{vehicle.model}</td>
                <td>{vehicle.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
