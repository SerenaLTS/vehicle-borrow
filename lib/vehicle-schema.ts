const VEHICLE_BASE_SELECT = "id, plate_number, model, status, comments, current_holder_user_id";
const VEHICLE_OPTIONAL_SELECT = "vin, color";

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

function isMissingColumnError(message: string) {
  return message.includes("column vehicles.vin does not exist") || message.includes("column public.vehicles.vin does not exist");
}

export async function supportsVehicleOptionalFields(supabase: unknown) {
  const client = supabase as {
    from: (table: string) => {
      select: (columns: string) => {
        limit: (count: number) => Promise<QueryResult<unknown[]>>;
      };
    };
  };

  const { error } = await client.from("vehicles").select("vin").limit(1);

  if (!error) {
    return true;
  }

  if (isMissingColumnError(error.message)) {
    return false;
  }

  throw new Error(error.message);
}

export function getVehicleSelectClause(includeOptionalFields: boolean) {
  return includeOptionalFields ? `${VEHICLE_BASE_SELECT}, ${VEHICLE_OPTIONAL_SELECT}` : VEHICLE_BASE_SELECT;
}
