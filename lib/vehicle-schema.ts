const VEHICLE_BASE_SELECT = "id, plate_number, model, status, comments, current_holder_user_id";

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type VehicleOptionalFieldSupport = {
  enabled: boolean;
  vinColumn: string | null;
  colorColumn: string | null;
};

let cachedVehicleOptionalFieldSupport: Promise<VehicleOptionalFieldSupport> | null = null;

function isMissingColumnError(message: string, column: string) {
  return (
    message.includes(`column vehicles.${column} does not exist`) ||
    message.includes(`column public.vehicles.${column} does not exist`)
  );
}

async function hasVehicleColumn(supabase: unknown, column: string) {
  const client = supabase as {
    from: (table: string) => {
      select: (columns: string) => {
        limit: (count: number) => Promise<QueryResult<unknown[]>>;
      };
    };
  };

  const { error } = await client.from("vehicles").select(column).limit(1);

  if (!error) {
    return true;
  }

  if (isMissingColumnError(error.message, column)) {
    return false;
  }

  throw new Error(error.message);
}

export async function getVehicleOptionalFieldSupport(supabase: unknown): Promise<VehicleOptionalFieldSupport> {
  if (!cachedVehicleOptionalFieldSupport) {
    cachedVehicleOptionalFieldSupport = (async () => {
      const vinColumn = (await hasVehicleColumn(supabase, "vin")) ? "vin" : (await hasVehicleColumn(supabase, "VIN")) ? "VIN" : null;
      const colorColumn = (await hasVehicleColumn(supabase, "color")) ? "color" : (await hasVehicleColumn(supabase, "Color")) ? "Color" : null;

      return {
        enabled: Boolean(vinColumn || colorColumn),
        vinColumn,
        colorColumn,
      };
    })().catch((error) => {
      cachedVehicleOptionalFieldSupport = null;
      throw error;
    });
  }

  return cachedVehicleOptionalFieldSupport;
}

export function getVehicleSelectClause(optionalFieldSupport: VehicleOptionalFieldSupport) {
  const optionalColumns = [
    optionalFieldSupport.vinColumn ? `vin:${optionalFieldSupport.vinColumn}` : null,
    optionalFieldSupport.colorColumn ? `color:${optionalFieldSupport.colorColumn}` : null,
  ].filter(Boolean);

  return optionalColumns.length > 0 ? `${VEHICLE_BASE_SELECT}, ${optionalColumns.join(", ")}` : VEHICLE_BASE_SELECT;
}

export function getVehicleOptionalFieldPayload(
  optionalFieldSupport: VehicleOptionalFieldSupport,
  values: { vin: string | null; color: string | null },
) {
  return {
    ...(optionalFieldSupport.vinColumn ? { [optionalFieldSupport.vinColumn]: values.vin } : {}),
    ...(optionalFieldSupport.colorColumn ? { [optionalFieldSupport.colorColumn]: values.color } : {}),
  };
}
