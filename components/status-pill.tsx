type StatusPillProps = {
  status: "available" | "borrowed" | "maintenance";
};

export function StatusPill({ status }: StatusPillProps) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}
