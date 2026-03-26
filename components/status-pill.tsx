type StatusPillProps = {
  status: "available" | "booked" | "borrowed" | "maintenance" | "retired";
};

export function StatusPill({ status }: StatusPillProps) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}
