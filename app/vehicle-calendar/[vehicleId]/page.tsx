import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { VehicleMonthlyCalendar, addMonth, buildInitialMonth, type VehicleScheduleEvent } from "@/components/vehicle-monthly-calendar";
import { createClient } from "@/lib/supabase/server";
import { getFleetSnapshot } from "@/lib/fleet-cache";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDisplayName } from "@/lib/utils";

type VehicleCalendarPageProps = {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function sanitizeBackPath(value: string | null) {
  if (!value || !value.startsWith("/")) {
    return "/dashboard";
  }

  return value;
}

function buildCalendarHref(vehicleId: string, month: string, from: string) {
  return `/vehicle-calendar/${vehicleId}?month=${encodeURIComponent(month)}&from=${encodeURIComponent(from)}`;
}

export default async function VehicleCalendarPage({ params, searchParams }: VehicleCalendarPageProps) {
  const { vehicleId } = await params;
  const pageParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const [isAdmin, snapshot] = await Promise.all([getIsAdmin(supabase, user.id), getFleetSnapshot(supabase)]);
  const vehicle = snapshot.vehicles.find((entry) => entry.id === vehicleId);

  if (!vehicle) {
    redirect(sanitizeBackPath(typeof pageParams.from === "string" ? pageParams.from : null));
  }

  const rawEvents = snapshot.scheduleTimelineByVehicleId.get(vehicleId) ?? [];
  const events = rawEvents.map((event) => ({
    ...event,
    notes: event.notes ?? null,
  }));
  const initialMonth = buildInitialMonth(events);
  const currentMonth = typeof pageParams.month === "string" ? pageParams.month : initialMonth;
  const backHref = sanitizeBackPath(typeof pageParams.from === "string" ? pageParams.from : null);

  return (
    <AppShell
      title={vehicle.plate_number}
      subtitle="Vehicle calendar"
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref={backHref}
      backLabel="Back"
      adminHref={isAdmin ? "/admin" : undefined}
    >
      <section className="panel">
        <div className="calendarPageHeader">
          <div>
            <p className="eyebrow">Vehicle Calendar</p>
            <h2>{vehicle.plate_number}</h2>
            <p className="muted">{vehicle.model}</p>
          </div>
        </div>

        <VehicleMonthlyCalendar
          currentMonth={currentMonth}
          events={events}
          nextHref={buildCalendarHref(vehicleId, addMonth(currentMonth, 1), backHref)}
          previousHref={buildCalendarHref(vehicleId, addMonth(currentMonth, -1), backHref)}
        />
      </section>
    </AppShell>
  );
}
