import { getVehicleOptionalFieldSupport, getVehicleSelectClause } from "@/lib/vehicle-schema";
import { normalizeLoan, normalizeVehicleBooking, type LoanRow, type RawLoanRow, type RawVehicleBooking, type Vehicle, type VehicleBooking } from "@/lib/types";

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string, options?: { count?: "exact"; head?: boolean }) => {
      not?: (column: string, operator: string, value: string) => {
        order: (column: string, options?: { ascending?: boolean }) => Promise<{ data: unknown[] | null }>;
      };
      gte?: (column: string, value: string) => {
        order: (column: string, options?: { ascending?: boolean }) => Promise<{ data: unknown[] | null }>;
      };
      is?: (column: string, value: null) => Promise<{ data: Array<{ vehicle_id: string }> | null }>;
      order?: (column: string, options?: { ascending?: boolean }) => Promise<{ data: unknown[] | null }>;
    };
  };
};

type FleetSnapshot = {
  fetchedAt: number;
  vehicles: Vehicle[];
  upcomingBookings: VehicleBooking[];
  timelineBookings: VehicleBooking[];
  timelineLoans: LoanRow[];
  activeLoanVehicleIds: string[];
  totalFleetCount: number;
};

type FleetSnapshotResult = Omit<FleetSnapshot, "activeLoanVehicleIds"> & {
  activeLoanVehicleIds: Set<string>;
  nextBookingByVehicleId: Map<string, VehicleBooking>;
  scheduleTimelineByVehicleId: ReturnType<typeof createScheduleTimelineMap>;
};

const SNAPSHOT_TTL_MS = 5_000;

let cachedFleetSnapshot: Promise<FleetSnapshot> | null = null;
let cachedFleetSnapshotExpiresAt = 0;

function createNextBookingMap(bookings: VehicleBooking[]) {
  const nextBookingByVehicleId = new Map<string, VehicleBooking>();

  for (const booking of bookings) {
    if (!nextBookingByVehicleId.has(booking.vehicle_id)) {
      nextBookingByVehicleId.set(booking.vehicle_id, booking);
    }
  }

  return nextBookingByVehicleId;
}

function createScheduleTimelineMap(bookings: VehicleBooking[], loans: LoanRow[]) {
  const timelineByVehicleId = new Map<string, Array<
    | {
        id: string;
        kind: "booked";
        actor: string;
        startAt: string;
        endAt: string | null;
        notes: string | null;
      }
    | {
        id: string;
        kind: "borrowed";
        actor: string;
        startAt: string;
        endAt: string | null;
        notes: string | null;
      }
  >>();

  for (const booking of bookings) {
    const vehicleTimeline = timelineByVehicleId.get(booking.vehicle_id) ?? [];
    vehicleTimeline.push({
      id: booking.id,
      kind: "booked",
      actor: booking.booked_by_email,
      startAt: booking.starts_at,
      endAt: booking.ends_at,
      notes: booking.comments,
    });
    timelineByVehicleId.set(booking.vehicle_id, vehicleTimeline);
  }

  for (const loan of loans) {
    const vehicleTimeline = timelineByVehicleId.get(loan.vehicle_id) ?? [];
    vehicleTimeline.push({
      id: loan.id,
      kind: "borrowed",
      actor: loan.borrower_email,
      startAt: loan.borrowed_at,
      endAt: loan.returned_at ?? loan.expected_return_at ?? new Date().toISOString(),
      notes: loan.purpose || loan.borrow_notes,
    });
    timelineByVehicleId.set(loan.vehicle_id, vehicleTimeline);
  }

  for (const [vehicleId, events] of timelineByVehicleId) {
    events.sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
    timelineByVehicleId.set(vehicleId, events);
  }

  return timelineByVehicleId;
}

export async function getFleetSnapshot(supabase: unknown): Promise<FleetSnapshotResult> {
  const now = Date.now();

  if (cachedFleetSnapshot && cachedFleetSnapshotExpiresAt > now) {
    const snapshot = await cachedFleetSnapshot;

    return {
      ...snapshot,
      activeLoanVehicleIds: new Set(snapshot.activeLoanVehicleIds),
      nextBookingByVehicleId: createNextBookingMap(snapshot.upcomingBookings),
      scheduleTimelineByVehicleId: createScheduleTimelineMap(snapshot.timelineBookings, snapshot.timelineLoans),
    };
  }

  const client = supabase as SupabaseLike;

  cachedFleetSnapshot = (async () => {
    const optionalFieldSupport = await getVehicleOptionalFieldSupport(supabase);
    const nowIso = new Date().toISOString();
    const timelineWindowStartIso = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();

    const [{ data: vehicleData }, { data: bookingData }, { data: activeLoanData }, { data: loanTimelineData }] = await Promise.all([
      client.from("vehicles").select(getVehicleSelectClause(optionalFieldSupport)).order?.("plate_number", { ascending: true }) ??
        Promise.resolve({ data: [] }),
      client
        .from("vehicle_bookings")
        .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
        .gte?.("ends_at", nowIso)
        .order("starts_at", { ascending: true }) ?? Promise.resolve({ data: [] }),
      client.from("vehicle_loans").select("vehicle_id").is?.("returned_at", null) ?? Promise.resolve({ data: [] }),
      client
        .from("vehicle_loans")
        .select(
          "id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)",
        )
        .gte?.("borrowed_at", timelineWindowStartIso)
        .order("borrowed_at", { ascending: true }) ?? Promise.resolve({ data: [] }),
    ]);

    const vehicles = ((vehicleData ?? []) as unknown[]) as Vehicle[];
    const upcomingBookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
    const timelineBookings = upcomingBookings;
    const timelineLoans = ((loanTimelineData ?? []) as RawLoanRow[]).map(normalizeLoan);
    const activeLoanVehicleIds = (activeLoanData ?? []).map((loan) => loan.vehicle_id);

    return {
      fetchedAt: Date.now(),
      vehicles,
      upcomingBookings,
      timelineBookings,
      timelineLoans,
      activeLoanVehicleIds,
      totalFleetCount: vehicles.length,
    };
  })().catch((error) => {
    cachedFleetSnapshot = null;
    cachedFleetSnapshotExpiresAt = 0;
    throw error;
  });

  cachedFleetSnapshotExpiresAt = now + SNAPSHOT_TTL_MS;

  const snapshot = await cachedFleetSnapshot;

  return {
    ...snapshot,
    activeLoanVehicleIds: new Set(snapshot.activeLoanVehicleIds),
    nextBookingByVehicleId: createNextBookingMap(snapshot.upcomingBookings),
    scheduleTimelineByVehicleId: createScheduleTimelineMap(snapshot.timelineBookings, snapshot.timelineLoans),
  };
}

export function clearFleetSnapshotCache() {
  cachedFleetSnapshot = null;
  cachedFleetSnapshotExpiresAt = 0;
}
