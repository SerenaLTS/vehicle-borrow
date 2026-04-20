import { getVehicleOptionalFieldSupport, getVehicleSelectClause } from "@/lib/vehicle-schema";
import { normalizeVehicleBooking, type RawVehicleBooking, type Vehicle, type VehicleBooking } from "@/lib/types";

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
  activeLoanVehicleIds: string[];
  totalFleetCount: number;
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

export async function getFleetSnapshot(supabase: unknown) {
  const now = Date.now();

  if (cachedFleetSnapshot && cachedFleetSnapshotExpiresAt > now) {
    const snapshot = await cachedFleetSnapshot;

    return {
      ...snapshot,
      activeLoanVehicleIds: new Set(snapshot.activeLoanVehicleIds),
      nextBookingByVehicleId: createNextBookingMap(snapshot.upcomingBookings),
    };
  }

  const client = supabase as SupabaseLike;

  cachedFleetSnapshot = (async () => {
    const optionalFieldSupport = await getVehicleOptionalFieldSupport(supabase);
    const nowIso = new Date().toISOString();

    const [{ data: vehicleData }, { data: bookingData }, { data: activeLoanData }] = await Promise.all([
      client.from("vehicles").select(getVehicleSelectClause(optionalFieldSupport)).order?.("plate_number", { ascending: true }) ??
        Promise.resolve({ data: [] }),
      client
        .from("vehicle_bookings")
        .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
        .gte?.("ends_at", nowIso)
        .order("starts_at", { ascending: true }) ?? Promise.resolve({ data: [] }),
      client.from("vehicle_loans").select("vehicle_id").is?.("returned_at", null) ?? Promise.resolve({ data: [] }),
    ]);

    const vehicles = ((vehicleData ?? []) as unknown[]) as Vehicle[];
    const upcomingBookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
    const activeLoanVehicleIds = (activeLoanData ?? []).map((loan) => loan.vehicle_id);

    return {
      fetchedAt: Date.now(),
      vehicles,
      upcomingBookings,
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
  };
}

export function clearFleetSnapshotCache() {
  cachedFleetSnapshot = null;
  cachedFleetSnapshotExpiresAt = 0;
}
