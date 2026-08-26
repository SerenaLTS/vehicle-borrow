type StatusPillProps = {
  status: "available" | "booked" | "borrowed" | "in_transit" | "repair" | "maintenance" | "suspended" | "employee_car" | "sold" | "retired";
};

export function StatusPill({ status }: StatusPillProps) {
  return <span className={`pill pill-${status}`}>{status === "employee_car" ? "employee car" : status}</span>;
}
