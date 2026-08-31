import { redirect } from "next/navigation";
import { createVehicle } from "@/app/admin/actions";
import { AppShell } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
import { VehicleDetailsFields } from "@/components/vehicle-details-fields";
import { getVehicleOptionalFieldSupport } from "@/lib/vehicle-schema";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDisplayName } from "@/lib/utils";

type NewVehiclePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewVehiclePage({ searchParams }: NewVehiclePageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  if (!(await getIsAdmin(supabase, user.id))) redirect("/dashboard?message=Admin access required.");

  const optionalFieldSupport = await getVehicleOptionalFieldSupport(supabase);
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <AppShell
      title="Add vehicle"
      subtitle="Create a new fleet record."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/admin"
      backLabel="Back to fleet"
      adminHref="/admin"
    >
      {error ? <p className="message error">{error}</p> : null}
      <section className="panel">
        <form action={createVehicle}>
          <input name="returnTo" type="hidden" value="new" />
          <div className="formGrid">
            <label className="fieldLabel">Plate number<input name="plateNumber" placeholder="ABC123" required /></label>
            <label className="fieldLabel">Model<input name="model" placeholder="T9 PHEV" required /></label>
            {optionalFieldSupport.enabled ? (
              <>
                <label className="fieldLabel">VIN<input name="vin" placeholder="LGWXXXXXXXXXXXXXX" /></label>
                <label className="fieldLabel">Colour<input name="color" placeholder="White" /></label>
              </>
            ) : null}
          </div>

          {!optionalFieldSupport.enabled ? <p className="muted">VIN, colour, and location fields will appear after those columns are added to the vehicles table.</p> : null}
          <VehicleDetailsFields />
          <label className="fieldLabel">
            Status
            <select defaultValue="available" name="status" required>
              <option value="available">available</option>
              <option value="in_transit">in transit</option>
              <option value="repair">repair</option>
              <option value="maintenance">maintenance</option>
              <option value="suspended">suspended</option>
              <option value="employee_car">employee car</option>
              <option value="deregistered">deregistered</option>
              <option value="sold">sold</option>
              <option value="retired">retired</option>
            </select>
          </label>
          <label className="fieldLabel">Comments<textarea name="comments" placeholder="Service notes or anything the team should know" /></label>
          <div className="actionsRow">
            <SubmitButton className="primaryButton" idleLabel="Add vehicle" pendingLabel="Adding..." />
          </div>
        </form>
      </section>
    </AppShell>
  );
}
