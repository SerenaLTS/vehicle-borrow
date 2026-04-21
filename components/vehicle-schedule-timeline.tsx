import { formatDateTime } from "@/lib/utils";

type VehicleScheduleEvent = {
  id: string;
  kind: "booked" | "borrowed";
  actor: string;
  startAt: string;
  endAt: string | null;
  notes: string | null;
};

type VehicleScheduleTimelineProps = {
  events: VehicleScheduleEvent[];
};

export function VehicleScheduleTimeline({ events }: VehicleScheduleTimelineProps) {
  if (events.length === 0) {
    return (
      <details className="timelineDisclosure">
        <summary>Schedule timeline</summary>
        <div className="timelineEmpty">No recent or upcoming bookings found for this vehicle.</div>
      </details>
    );
  }

  return (
    <details className="timelineDisclosure">
      <summary>Schedule timeline</summary>
      <div className="timelineList">
        {events.map((event) => (
          <div className="timelineItem" key={`${event.kind}-${event.id}`}>
            <span className={`timelineDot timelineDot-${event.kind}`} />
            <div className="timelineCard">
              <div className="timelineHeader">
                <strong>{event.kind === "booked" ? "Booked" : "Borrowed"}</strong>
                <span>{event.actor}</span>
              </div>
              <div className="timelineMeta">
                <span>From: {formatDateTime(event.startAt)}</span>
                <span>Until: {formatDateTime(event.endAt)}</span>
                {event.notes ? <span>Notes: {event.notes}</span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
