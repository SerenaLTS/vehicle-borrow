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
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
