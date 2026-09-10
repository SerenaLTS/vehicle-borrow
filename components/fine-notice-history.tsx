import { LoadingLink } from "@/components/loading-link";
import type { FineDriverHistory, FineNotice } from "@/lib/fine-notices";
import { formatDateTime } from "@/lib/utils";

export function FineNoticeHistory({ vehicleId, fines, history, unavailable }: { vehicleId: string; fines: FineNotice[]; history: FineDriverHistory[]; unavailable: boolean }) {
  return <section className="panel">
    <div className="sectionHeader"><div><h2>Fine notices</h2><p className="muted">Select a date in the calendar to register a fine notice.</p></div>
      {!unavailable ? <LoadingLink className="secondaryButton" href={`/admin/vehicles/${vehicleId}/fines/new`}>Add fine notice</LoadingLink> : null}
    </div>
    {unavailable ? <p className="message">Fine notices are unavailable. The database setup may still be required.</p> : fines.length === 0 ? <p className="muted">No fine notices recorded.</p> : <div className="cardsGrid">
      {fines.map((fine) => <article className="vehicleCard" key={fine.id}>
        <h3><LoadingLink href={`/admin/vehicles/${vehicleId}/fines/${fine.id}`}>{fine.notice_number} · {fine.rego}</LoadingLink></h3>
        <p>{formatDateTime(fine.occurred_at)} · {fine.location}</p>
        <p>{fine.driver_name} · AUD {(fine.amount_cents / 100).toFixed(2)}</p>
        <p className="muted">Email: {fine.status.replaceAll("_", " ")}</p>
      </article>)}
    </div>}
    {history.length ? <>
      <h3>Added driving history</h3>
      <div className="cardsGrid">{history.map((record) => <article className="vehicleCard" key={record.id}>
        <h4>{record.driver_name}</h4><p>{record.driver_email}</p>
        <p>{formatDateTime(record.starts_at)} – {formatDateTime(record.ends_at)}</p>
        <p className="muted">Admin-confirmed historical driving period</p>
      </article>)}</div>
    </> : null}
  </section>;
}
