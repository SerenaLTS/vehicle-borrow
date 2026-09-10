import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdmin: vi.fn(), send: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/fine-notice-server", () => ({ requireFineAdmin: mocks.requireAdmin, loadFineDrivers: vi.fn(), fineDeliveryFingerprint: () => "preview-v1" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdmin }));
vi.mock("@/lib/booking-notifications", () => ({ sendFineNoticeEmail: mocks.send }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/vehicle-calendar-cache", () => ({ clearVehicleCalendarCache: vi.fn() }));
import { sendFineNotice } from "@/app/admin/fine-actions";

function query(result: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result), then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve) };
  for (const method of [q.select, q.eq, q.is]) method.mockReturnValue(q);
  return q;
}
const fine = {
  id: "11111111-1111-4111-8111-111111111111", vehicle_id: "22222222-2222-4222-8222-222222222222",
  driver_email: "driver@example.test", email_subject: "Fine TEST123", email_body: "Please provide a licence copy.",
  status: "draft", send_started_at: null, attachment_path: null, attachment_name: null,
};
function form(retry = false) { const value = new FormData(); value.set("fineId", fine.id); value.set("emailFingerprint", "preview-v1"); value.set("vehicleId", fine.vehicle_id); if (retry) value.set("confirmRetry", "on"); return value; }
function setup(overrides = {}, claimed = true) {
  const read = query({ data: { ...fine, ...overrides }, error: null });
  mocks.requireAdmin.mockResolvedValue({ supabase: { from: () => read }, user: { id: "admin" } });
  const claim = query({ data: claimed ? { id: fine.id } : null, error: null });
  const complete = query({ error: null });
  const update = vi.fn().mockReturnValueOnce(claim).mockReturnValue(complete);
  const download = vi.fn().mockResolvedValue({ data: new Blob(["%PDF-1.7\nfixture"]), error: null });
  mocks.createAdmin.mockReturnValue({ from: () => ({ update }), storage: { from: () => ({ download }) } });
  return { update, download, claim };
}

beforeEach(() => { vi.resetAllMocks(); mocks.send.mockResolvedValue({ sent: true, messageId: "test-message" }); });

describe("fine email send workflow (mail transport mocked)", () => {
  it("checks admin access before loading or sending anything", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Forbidden"));
    await expect(sendFineNotice(form())).rejects.toThrow("Forbidden");
    expect(mocks.createAdmin).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sends the saved preview with the stored PDF and records SMTP acceptance", async () => {
    const { update, claim } = setup({ attachment_path: "private/notice.pdf", attachment_name: "notice.pdf" });
    await expect(sendFineNotice(form())).rejects.toThrow("Fine%20notice%20email%20sent");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: fine.driver_email, text: fine.email_body, attachment: { filename: "notice.pdf", content: Buffer.from("%PDF-1.7\nfixture") } }));
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: "sent", message_id: "test-message" }));
    expect(claim.eq).toHaveBeenCalledWith("email_body", fine.email_body);
  });
  it("requires a new review if the preview changed", async () => {
    setup(); const stale = form(); stale.set("emailFingerprint", "old-preview");
    await expect(sendFineNotice(stale)).rejects.toThrow("preview%20has%20changed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not send if another request claimed it first", async () => {
    setup({}, false);
    await expect(sendFineNotice(form())).rejects.toThrow("Another%20request");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not send an already sent notice", async () => {
    setup({ status: "sent" });
    await expect(sendFineNotice(form())).rejects.toThrow("already%20been%20sent");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not send without a promised attachment", async () => {
    const { download, update } = setup({ attachment_path: "missing.pdf" });
    download.mockResolvedValue({ data: null, error: { message: "Not found" } });
    await expect(sendFineNotice(form())).rejects.toThrow("Nothing%20was%20sent");
    expect(mocks.send).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it("retains a failed status when SMTP is not configured", async () => {
    const { update } = setup(); mocks.send.mockResolvedValue({ sent: false });
    await expect(sendFineNotice(form())).rejects.toThrow("Email%20was%20not%20sent");
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", sent_at: null }));
  });
  it("preserves uncertainty on transport errors and requires explicit retry confirmation", async () => {
    const { update } = setup(); mocks.send.mockRejectedValue(new Error("SMTP timeout"));
    await expect(sendFineNotice(form())).rejects.toThrow("Delivery%20could%20not%20be%20confirmed");
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: "delivery_unknown" }));
    mocks.send.mockClear(); setup({ status: "delivery_unknown" });
    await expect(sendFineNotice(form())).rejects.toThrow("Check%20the%20recipient");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("allows an explicit retry after a stale claim, but never while a send is fresh", async () => {
    setup({ status: "sending", send_started_at: new Date().toISOString() });
    await expect(sendFineNotice(form(true))).rejects.toThrow("already%20in%20progress");
    expect(mocks.send).not.toHaveBeenCalled();
    setup({ status: "sending", send_started_at: new Date(Date.now() - 6 * 60_000).toISOString() });
    await expect(sendFineNotice(form(true))).rejects.toThrow("email%20sent");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
