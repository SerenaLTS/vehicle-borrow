import { normalizeLoan, normalizeVehicleBooking, type RawLoanRow, type RawVehicleBooking } from "@/lib/types";

export type VehicleCalendarEvent = {
  id: string;
  kind: "booked" | "borrowed";
  actor: string;
  startAt: string;
  endAt: string | null;
  notes: string | null;
};

type VehicleCalendarSnapshot = {
  fetchedAt: number;
  year: number;
  vehicle: {
    id: string;
    plate_number: string;
    model: string;
  } | null;
  events: VehicleCalendarEvent[];
};

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => unknown;
    };
  };
};

const CALENDAR_TTL_MS = 60_000;

const cachedVehicleCalendarById = new Map<
  string,
  {
    expiresAt: number;
    snapshotPromise: Promise<VehicleCalendarSnapshot>;
  }
>();

function sortEvents(events: VehicleCalendarEvent[]) {
  return [...events].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
}

export async function getVehicleCalendarSnapshot(supabase: unknown, vehicleId: string): Promise<VehicleCalendarSnapshot> {
  const currentYear = new Date().getFullYear();
  return getVehicleCalendarSnapshotForYear(supabase, vehicleId, currentYear);
}

export async function getVehicleCalendarSnapshotForYear(
  supabase: unknown,
  vehicleId: string,
  year: number,
): Promise<VehicleCalendarSnapshot> {
  const now = Date.now();
  const cacheKey = `${vehicleId}:${year}`;
  const cached = cachedVehicleCalendarById.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.snapshotPromise;
  }

  const client = supabase as SupabaseLike;
  const yearStartIso = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)).toISOString();
  const yearEndIso = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0)).toISOString();
  const snapshotPromise = (async () => {
    const [{ data: vehicleData, error: vehicleError }, { data: bookingData, error: bookingError }, { data: loanData, error: loanError }] =
      await Promise.all([
        ((client.from("vehicles").select("id, plate_number, model").eq("id", vehicleId) as {
          maybeSingle: () => Promise<{ data: unknown | null; error?: { message: string } | null }>;
        }).maybeSingle?.() ?? Promise.resolve({ data: null, error: null })),
        (((client
          .from("vehicle_bookings")
          .select("id, vehicle_id, booked_by_user_id, booked_by_email, starts_at, ends_at, comments, created_at, vehicle:vehicles!vehicle_bookings_vehicle_id_fkey(plate_number, model)")
          .eq("vehicle_id", vehicleId) as {
          lt: (column: string, value: string) => {
            gte: (column: string, value: string) => {
              order: (column: string, options?: { ascending?: boolean }) => Promise<{
                data: unknown[] | null;
                error?: { message: string } | null;
              }>;
            };
          };
        })
          .lt("starts_at", yearEndIso)
          .gte("ends_at", yearStartIso)
          .order("starts_at", { ascending: true })) ?? Promise.resolve({ data: [], error: null })),
        (((client
          .from("vehicle_loans")
          .select(
            "id, vehicle_id, borrowed_by_user_id, borrower_email, driver_name, purpose, start_odometer, end_odometer, borrow_notes, return_notes, borrowed_at, expected_return_at, returned_at, vehicle:vehicles!vehicle_loans_vehicle_id_fkey(plate_number, model)",
          )
          .eq("vehicle_id", vehicleId) as {
          lt: (column: string, value: string) => {
            order: (column: string, options?: { ascending?: boolean }) => Promise<{
              data: unknown[] | null;
              error?: { message: string } | null;
            }>;
          };
        })
          .lt("borrowed_at", yearEndIso)
          .order("borrowed_at", { ascending: true })) ?? Promise.resolve({ data: [], error: null })),
      ]);

    if (vehicleError) {
      throw new Error(vehicleError.message);
    }

    if (bookingError) {
      throw new Error(bookingError.message);
    }

    if (loanError) {
      throw new Error(loanError.message);
    }

    const bookings = ((bookingData ?? []) as RawVehicleBooking[]).map(normalizeVehicleBooking);
    const loans = ((loanData ?? []) as RawLoanRow[])
      .map(normalizeLoan)
      .filter((loan) => {
        const loanEnd = loan.returned_at ?? loan.expected_return_at ?? new Date().toISOString();
        return loanEnd >= yearStartIso;
      });
    const events = sortEvents([
      ...bookings.map((booking) => ({
        id: booking.id,
        kind: "booked" as const,
        actor: booking.booked_by_email,
        startAt: booking.starts_at,
        endAt: booking.ends_at,
        notes: booking.comments ?? null,
      })),
      ...loans.map((loan) => ({
        id: loan.id,
        kind: "borrowed" as const,
        actor: loan.borrower_email,
        startAt: loan.borrowed_at,
        endAt: loan.returned_at ?? loan.expected_return_at ?? new Date().toISOString(),
        notes: loan.purpose || loan.borrow_notes || null,
      })),
    ]);

    return {
      fetchedAt: Date.now(),
      year,
      vehicle: vehicleData as VehicleCalendarSnapshot["vehicle"],
      events,
    };
  })().catch((error) => {
    cachedVehicleCalendarById.delete(cacheKey);
    throw error;
  });

  cachedVehicleCalendarById.set(cacheKey, {
    expiresAt: now + CALENDAR_TTL_MS,
    snapshotPromise,
  });

  return snapshotPromise;
}

export function clearVehicleCalendarCache(vehicleId?: string) {
  if (vehicleId) {
    for (const key of cachedVehicleCalendarById.keys()) {
      if (key.startsWith(`${vehicleId}:`)) {
        cachedVehicleCalendarById.delete(key);
      }
    }
    return;
  }

  cachedVehicleCalendarById.clear();
}
