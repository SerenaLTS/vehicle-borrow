import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { VehicleMonthlyCalendar } from "@/components/vehicle-monthly-calendar";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/user-roles";
import { formatDisplayName } from "@/lib/utils";
import { getVehicleCalendarSnapshotForYear } from "@/lib/vehicle-calendar-cache";

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

function sanitizeMonth(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return undefined;
  }

  return value;
}

function buildVehicleCalendarHref(vehicleId: string, month: string, from: string) {
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

  const backHref = sanitizeBackPath(typeof pageParams.from === "string" ? pageParams.from : null);
  const requestedMonth = sanitizeMonth(typeof pageParams.month === "string" ? pageParams.month : undefined);
  const requestedYear = Number((requestedMonth ?? `${new Date().getFullYear()}-01`).slice(0, 4));
  const [isAdmin, calendarSnapshot] = await Promise.all([
    getIsAdmin(supabase, user.id),
    getVehicleCalendarSnapshotForYear(supabase, vehicleId, requestedYear),
  ]);
  const vehicle = calendarSnapshot.vehicle;

  if (!vehicle) {
    redirect(sanitizeBackPath(typeof pageParams.from === "string" ? pageParams.from : null));
  }

  const events = calendarSnapshot.events.map((event) => ({
    ...event,
    notes: event.notes ?? null,
  }));
  const initialMonth = requestedMonth;

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
          crossYearNextHref={buildVehicleCalendarHref(vehicleId, `${calendarSnapshot.year + 1}-01`, backHref)}
          crossYearPreviousHref={buildVehicleCalendarHref(vehicleId, `${calendarSnapshot.year - 1}-12`, backHref)}
          events={events}
          initialMonth={initialMonth}
          loadedYear={calendarSnapshot.year}
        />
      </section>
    </AppShell>
  );
}
