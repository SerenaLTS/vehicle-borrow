export function isJwtIssuedInFutureError(error: unknown) {
  if (!error) return false;
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error);
  return /jwt issued (?:at|in the) future/i.test(message);
}
