import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/2026-07-21_admin_action_audit_and_atomic_flows.sql"), "utf8");

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
});
