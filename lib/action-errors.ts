type ActionError = {
  code?: string | null;
  message?: string | null;
};

const FRIENDLY_ERROR_RULES: Array<{ patterns: RegExp[]; message: string }> = [
  {
    patterns: [/23P01/i, /vehicle_bookings_no_overlap/i, /already booked/i, /booking.*overlap/i],
    message: "This vehicle is already reserved during the selected time.",
  },
  {
    patterns: [/not currently available/i, /already has an active borrow/i],
    message: "This vehicle is not currently available.",
  },
  {
    patterns: [/expected return/i, /return time/i],
    message: "Please choose a valid return time.",
  },
  {
    patterns: [/odometer/i],
    message: "Please enter a valid odometer reading.",
  },
  {
    patterns: [/23505/i, /duplicate key/i, /already exists/i],
    message: "A record with these details already exists.",
  },
  {
    patterns: [/42501/i, /row-level security/i, /permission denied/i],
    message: "You do not have permission to perform this action.",
  },
  {
    patterns: [/JWT/i, /not authenticated/i, /must be logged in/i],
    message: "Your session has expired. Please sign in again.",
  },
];

export function getSafeActionErrorMessage(error: unknown, fallback: string, context: string) {
  const actionError = typeof error === "object" && error !== null ? (error as ActionError) : null;
  const rawMessage = actionError?.message ?? (typeof error === "string" ? error : "Unknown error");
  const searchable = `${actionError?.code ?? ""} ${rawMessage}`;

  console.error(`[${context}]`, { code: actionError?.code ?? null, message: rawMessage });

  return FRIENDLY_ERROR_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(searchable)))?.message ?? fallback;
}
