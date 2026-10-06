import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendBookingNotificationEmail } from "@/lib/booking-notifications";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const booking = {
  bookingId: "booking", vehicleId: "vehicle", bookedByEmail: "booker@example.com",
  startsAt: "2026-10-07T00:00:00Z", endsAt: "2026-10-07T02:00:00Z",
  isLongTerm: false, comments: "Client pickup",
};
function client(emails: string[]) {
  return { from: (table: string) => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: { plate_number: "ABC123", model: "Car" } }),
    is: async (column: string, value: null) => {
      expect(table).toBe("vehicle_loans");
      expect(column).toBe("returned_at"); expect(value).toBeNull();
      return { data: emails.map((borrower_email) => ({ borrower_email })), error: null };
    },
  }) }) }) };
}
beforeEach(() => {
  vi.stubEnv("SMTP_HOST", "smtp.example.com"); vi.stubEnv("SMTP_USER", "user");
  vi.stubEnv("SMTP_PASS", "test"); vi.stubEnv("SMTP_FROM", "sender@example.com");
  sendMail.mockReset().mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("booking notices to current borrowers", () => {
  it.each(["created", "updated", "cancelled"] as const)("notifies current borrower when a booking is %s", async (action) => {
    await sendBookingNotificationEmail({ supabase: client([" BORROWER@example.com ", "borrower@example.com"]), action, actorEmail: booking.bookedByEmail, booking });
    expect(sendMail).toHaveBeenCalledTimes(2);
    const notice = sendMail.mock.calls.map(([mail]) => mail).find((mail) => mail.to === "borrower@example.com");
    expect(notice.text).toContain(booking.bookedByEmail);
    expect(notice.text).toContain("Reservation start:");
    expect(notice.text).toContain(action === "cancelled" ? "no longer requires a handover" : "coordinate availability");
  });
  it("avoids duplicate borrower mail when the booker is borrowing the vehicle", async () => {
    await sendBookingNotificationEmail({ supabase: client([booking.bookedByEmail]), action: "created", actorEmail: booking.bookedByEmail, booking });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
  it("attempts borrower mail even when booking confirmation fails", async () => {
    sendMail.mockRejectedValueOnce(new Error("SMTP failure"));
    await expect(sendBookingNotificationEmail({ supabase: client(["borrower@example.com"]), action: "created", actorEmail: booking.bookedByEmail, booking })).rejects.toThrow("SMTP failure");
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
