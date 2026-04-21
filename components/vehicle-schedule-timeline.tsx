import Link from "next/link";

type VehicleScheduleTimelineProps = {
  vehicleId: string;
  basePath: string;
};

export function VehicleScheduleTimeline({ vehicleId, basePath }: VehicleScheduleTimelineProps) {
  return (
    <Link className="calendarTriggerButton" href={`/vehicle-calendar/${vehicleId}?from=${encodeURIComponent(basePath)}`}>
      View monthly calendar
    </Link>
  );
}
