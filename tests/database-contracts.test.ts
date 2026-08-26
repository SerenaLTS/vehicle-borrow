import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/2026-07-21_admin_action_audit_and_atomic_flows.sql"), "utf8");
const cancellationAuditMigration = readFileSync(resolve(process.cwd(), "supabase/2026-07-21_admin_booking_cancellation_action_audit.sql"), "utf8");
const cancellationContextMigration = readFileSync(resolve(process.cwd(), "supabase/2026-07-21_cancel_context_fix.sql"), "utf8");
const reminderResetMigration = readFileSync(resolve(process.cwd(), "supabase/2026-07-29_reset_overdue_reminder_on_extension.sql"), "utf8");
const historyAndBookingMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-11_history_pagination_and_booking_exclusion.sql"), "utf8");
const historyPerformanceMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-12_history_pagination_performance.sql"), "utf8");
const historyCountMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-13_history_count.sql"), "utf8");
const signupAllowlistMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-14_signup_email_allowlist.sql"), "utf8");
const signupAllowlistPermissionsMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-15_signup_allowlist_permissions.sql"), "utf8");
const privateAllowlistMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-16_auth_rate_limits_and_private_allowlist.sql"), "utf8");
const reminderRoute = readFileSync(resolve(process.cwd(), "app/api/booking-key-reminders/route.ts"), "utf8");
const fleetFieldsMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-25_fleet_fields_rls_and_constraints.sql"), "utf8");
const externalApprovalMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-26_external_driver_approval_and_rego_reminders.sql"), "utf8");
const employeeCarStatusMigration = readFileSync(resolve(process.cwd(), "supabase/2026-08-28_add_employee_car_status.sql"), "utf8");
const regoReminderRoute = readFileSync(resolve(process.cwd(), "app/api/vehicle-expiry-reminders/route.ts"), "utf8");

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

  it("resets overdue reminder state inside the loan extension transaction", () => {
    expect(reminderResetMigration).toContain("function public.extend_vehicle_loan");
    expect(reminderResetMigration).toContain("borrow_overdue_reminded_at = null");
  });

  it("prevents concurrent overlapping bookings at the database level", () => {
    expect(historyAndBookingMigration).toContain("constraint vehicle_bookings_no_overlap");
    expect(historyAndBookingMigration).toContain("exclude using gist");
    expect(historyAndBookingMigration).toContain("with &&");
  });

  it("provides a paginated database history search", () => {
    expect(historyAndBookingMigration).toContain("function public.search_vehicle_loan_history");
    expect(historyAndBookingMigration).toContain("p_offset");
    expect(historyAndBookingMigration).toContain("security invoker");
  });

  it("avoids a full count scan while paging history", () => {
    expect(historyPerformanceMigration).toContain("idx_vehicle_loans_borrowed_at_desc");
    expect(historyPerformanceMigration).toContain("null::bigint as total_count");
    expect(historyPerformanceMigration).not.toContain("count(*) over()");
  });

  it("counts history pages separately from the main pagination query", () => {
    expect(historyCountMigration).toContain("function public.count_vehicle_loan_history");
    expect(historyCountMigration).toContain("returns bigint");
    expect(historyCountMigration).toContain("security invoker");
  });

  it("enforces an exact-email signup allowlist through an auth hook", () => {
    expect(signupAllowlistMigration).toContain("table if not exists public.allowed_user_emails");
    expect(signupAllowlistMigration).toContain("function public.hook_require_allowed_user_email");
    expect(signupAllowlistMigration).toContain("to supabase_auth_admin");
    expect(signupAllowlistMigration).toContain("from authenticated, anon, public");
  });

  it("grants allowlist table access explicitly while retaining RLS", () => {
    expect(signupAllowlistPermissionsMigration).toContain("grant select, insert, delete");
    expect(signupAllowlistPermissionsMigration).toContain("to authenticated");
    expect(signupAllowlistPermissionsMigration).toContain("revoke all on table public.allowed_user_emails from anon");
  });

  it("keeps allowlist lookup private and rate limits auth through service role only", () => {
    expect(privateAllowlistMigration).toContain("revoke all on function public.is_signup_email_allowed(text) from anon, authenticated, public");
    expect(privateAllowlistMigration).toContain("table if not exists public.auth_rate_limits");
    expect(privateAllowlistMigration).toContain("function public.consume_auth_rate_limit");
    expect(privateAllowlistMigration).toContain("to service_role");
    expect(privateAllowlistMigration).toContain("from anon, authenticated, public");
  });

  it("claims reminder work before sending email", () => {
    const claimPosition = reminderRoute.indexOf(".update({ key_collection_reminded_at: claimedAt })");
    const sendPosition = reminderRoute.indexOf("sendKeyCollectionReminderEmail", claimPosition);
    expect(claimPosition).toBeGreaterThan(-1);
    expect(claimPosition).toBeLessThan(sendPosition);
    expect(reminderRoute).toContain(".select(\"id\")");
  });

  it("returns reminder counts without exposing record identifiers or error details", () => {
    expect(reminderRoute).toContain("sent: sent.length");
    expect(reminderRoute).toContain("failed: failed.length");
    expect(reminderRoute).toContain("error: \"Unable to process reminders right now.\"");
  });

  it("protects sensitive fleet fields and supplies policies for every new table", () => {
    expect(fleetFieldsMigration).toContain("revoke select on public.vehicles from authenticated");
    expect(fleetFieldsMigration).toContain("view public.admin_vehicle_details");
    expect(fleetFieldsMigration).toContain("Drivers can read own record and admins can read all");
    expect(fleetFieldsMigration).toContain("Admins can manage compliance records");
    expect(fleetFieldsMigration).toContain("Booking participants can read photos");
  });

  it("enforces new status and measurement rules in the database", () => {
    expect(fleetFieldsMigration).toContain("vehicles_status_check");
    expect(fleetFieldsMigration).toContain("vehicle_bookings_external_approval_check");
    expect(fleetFieldsMigration).toContain("pickup_energy_percent between 0 and 100");
    expect(fleetFieldsMigration).toContain("fleet_require_operational_vehicle");
  });

  it("makes employee cars a valid but non-bookable vehicle status", () => {
    expect(employeeCarStatusMigration).toContain("'employee_car'");
    expect(employeeCarStatusMigration).toContain("fleet_require_operational_vehicle");
    expect(employeeCarStatusMigration).toContain("not available for booking or borrowing");
  });

  it("prevents unapproved external drivers from collecting a key", () => {
    expect(externalApprovalMigration).toContain("borrower_type = 'external'");
    expect(externalApprovalMigration).toContain("approval_status <> 'approved'");
    expect(externalApprovalMigration).toContain("must be approved before key collection");
  });

  it("repairs the shared audit trigger before backfilling bookings", () => {
    const repairPosition = externalApprovalMigration.indexOf("create or replace function public.fleet_set_updated_audit_fields");
    const backfillPosition = externalApprovalMigration.indexOf("update public.vehicle_bookings");
    expect(repairPosition).toBeGreaterThan(-1);
    expect(repairPosition).toBeLessThan(backfillPosition);
    expect(externalApprovalMigration).toContain("if tg_table_name = 'vehicles' then");
    expect(externalApprovalMigration).not.toContain("if tg_table_name = 'vehicles' and (");
  });

  it("sends rego reminders once per day until an admin acknowledges them", () => {
    expect(externalApprovalMigration).toContain("registration_reminder_acknowledged_at");
    expect(externalApprovalMigration).toContain("registration_reminder_last_sent_on");
    expect(regoReminderRoute).toContain("registration_reminder_acknowledged_at");
    expect(regoReminderRoute).toContain("registration_reminder_last_sent_on");
    expect(regoReminderRoute).toContain("sendRegistrationExpiryReminderEmail");
  });
});
