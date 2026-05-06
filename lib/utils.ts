import { APP_TIME_ZONE } from "@/lib/datetime";

export function formatDisplayName(email: string) {
  const local = email.split("@")[0] ?? "";

  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isCompanyEmail(email: string, companyDomain: string) {
  return email.toLowerCase().endsWith(`@${companyDomain.toLowerCase()}`);
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-AU", {
    timeZone: APP_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function getVehicleDisplayStatus({
  storedStatus,
  hasActiveLoan,
  hasActiveBooking,
}: {
  storedStatus: "available" | "booked" | "borrowed" | "maintenance" | "retired";
  hasActiveLoan: boolean;
  hasActiveBooking: boolean;
}) {
  if (storedStatus === "maintenance" || storedStatus === "retired") {
    return storedStatus;
  }

  if (hasActiveLoan) {
    return "borrowed" as const;
  }

  if (hasActiveBooking) {
    return "booked" as const;
  }

  return "available" as const;
}
