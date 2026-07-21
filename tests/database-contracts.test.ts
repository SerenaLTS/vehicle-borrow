import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/2026-07-21_admin_action_audit_and_atomic_flows.sql"), "utf8");
const cancellationAuditMigration = readFileSync(resolve(process.cwd(), "supabase/2026-07-21_admin_booking_cancellation_action_audit.sql"), "utf8");
const cancellationContextMigration = readFileSync(resolve(process.cwd(), "supabase/2026-07-21_cancel_context_fix.sql"), "utf8");

describe("admin database transaction contracts", () => {
  it("keeps booking conversion in one database function with an audit write", () => {
    expect(migration).toContain("function public.admin_start_booking_borrow");
    expect(migration).toContain("insert into public.vehicle_loans");
    expect(migration).toContain("delete from public.vehicle_bookings");
    expect(migration).toContain("'booking_started_as_borrow'");
  });

  it("keeps admin return and its audit in one database function", () => {
    expect(migration).toContain("function public.admin_return_vehicle");
    expect(migration).toContain("'vehicle_returned'");
    expect(migration).toContain("Admins can read admin action audits");
  });

  it("does not expose either admin function publicly", () => {
    expect(migration).toContain("revoke all on function public.admin_start_booking_borrow");
    expect(migration).toContain("revoke all on function public.admin_return_vehicle");
  });

  it("records and backfills admin booking cancellations", () => {
    expect(cancellationAuditMigration).toContain("'booking_cancelled'");
    expect(cancellationAuditMigration).toContain("after insert on public.booking_cancellations");
    expect(cancellationAuditMigration).toContain("cancelled_by_admin = true");
    expect(cancellationAuditMigration).toContain("not exists");
  });

  it("uses the cancellation UI context rather than the user's admin role", () => {
    expect(cancellationContextMigration).toContain("p_cancelled_as_admin boolean default false");
    expect(cancellationContextMigration).toContain("p_cancelled_as_admin and not v_has_admin_role");
    expect(cancellationContextMigration).toContain("not p_cancelled_as_admin and v_booking.booked_by_user_id <> v_user_id");
    expect(cancellationContextMigration).toContain("v_email, p_cancelled_as_admin");
  });
});
