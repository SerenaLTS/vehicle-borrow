type StatusPillProps = {
  status: "available" | "borrowed" | "maintenance" | "retired";
};

export function StatusPill({ status }: StatusPillProps) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}
