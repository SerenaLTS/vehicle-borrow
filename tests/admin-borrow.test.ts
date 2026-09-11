import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), isAdmin: vi.fn(), confirm: vi.fn(), longTerm: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/user-roles", () => ({ getIsAdmin: mocks.isAdmin }));
vi.mock("@/lib/booking-notifications", () => ({ sendBorrowConfirmationEmail: mocks.confirm, sendLongTermBorrowAdminNotificationEmail: mocks.longTerm }));
vi.mock("@/lib/fleet-cache", () => ({ clearFleetSnapshotCache: vi.fn() }));
vi.mock("@/lib/vehicle-calendar-cache", () => ({ clearVehicleCalendarCache: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { borrowVehicle } from "@/app/borrow/actions";

function setup(email = "employee@company.test") {
  const rpc = vi.fn().mockResolvedValue({ data: { driver_name: "Employee Name", borrower_email: email, borrowed_by_user_id: "employee" }, error: null });
  const record = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { user_id: "employee", email }, error: null }) };
  record.select.mockReturnValue(record); record.eq.mockReturnValue(record);
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin", email: "admin@company.test", user_metadata: { full_name: "Admin Name" } } } }) }, from: vi.fn().mockReturnValue(record), rpc };
  mocks.client.mockResolvedValue(client); mocks.isAdmin.mockResolvedValue(true);
  return client;
}
function form(target = "employee") { const f = new FormData(); f.set("vehicleId", "vehicle"); f.set("purpose", "Client visit"); f.set("isLongTerm", "on"); if (target) f.set("borrowerUserId", target); return f; }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("COMPANY_EMAIL_DOMAIN", "company.test"); });

describe("admin employee borrowing", () => {
  it("uses the employee account for the loan and both notifications", async () => {
    const client = setup();
    await expect(borrowVehicle(form())).rejects.toThrow("Vehicle assigned successfully");
    expect(client.rpc).toHaveBeenCalledWith("admin_borrow_vehicle", expect.objectContaining({ p_borrower_user_id: "employee", p_vehicle_id: "vehicle", p_long_term: true }));
    expect(client.rpc.mock.calls[0][1]).not.toHaveProperty("p_driver_name");
    for (const notify of [mocks.confirm, mocks.longTerm]) expect(notify).toHaveBeenCalledWith(expect.objectContaining({ borrowerEmail: "employee@company.test", driverName: "Employee Name" }));
    for (const path of ["/dashboard", "/return", "/history", "/admin"]) expect(mocks.revalidate).toHaveBeenCalledWith(path);
  });
  it("rejects a forged employee selection from a non-admin", async () => {
    const client = setup(); mocks.isAdmin.mockResolvedValue(false);
    await expect(borrowVehicle(form())).resolves.toMatchObject({ error: expect.stringContaining("Admin access required") });
    expect(client.rpc).not.toHaveBeenCalled(); expect(client.from).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("rejects external accounts", async () => {
    const client = setup("external@other.test");
    await expect(borrowVehicle(form())).resolves.toMatchObject({ error: expect.stringContaining("company employee account") });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("keeps self-service borrowing unchanged", async () => {
    const client = setup();
    await expect(borrowVehicle(form(""))).rejects.toThrow("Vehicle borrowed successfully");
    expect(client.rpc).toHaveBeenCalledWith("borrow_vehicle", expect.objectContaining({ p_driver_name: "Admin Name" }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ borrowerEmail: "admin@company.test", driverName: "Admin Name" }));
  });
  it("does not notify anyone if the vehicle cannot be assigned", async () => {
    const client = setup(); client.rpc.mockResolvedValue({ data: null, error: { message: "Booked" } } as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(borrowVehicle(form())).resolves.toMatchObject({ error: expect.any(String) });
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.longTerm).not.toHaveBeenCalled(); log.mockRestore();
  });
});
