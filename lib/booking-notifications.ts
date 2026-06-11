import nodemailer from "nodemailer";
import { APP_NAME } from "@/lib/app-config";
import { parseDateTimeLocalToUtcIso } from "@/lib/datetime";
import { formatDateTime } from "@/lib/utils";

type SupabaseNotificationClient = {
  from: (table: "vehicles" | "user_roles" | "vehicle_bookings" | "vehicle_loans") => {
    select: (columns: string) => {
      eq: (column: string, value: string | boolean) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error?: { message: string } | null }>;
      };
      order?: (column: string, options?: { ascending?: boolean }) => {
        then?: never;
      };
    };
    update?: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => {
        is: (column: string, value: null) => Promise<{ error?: { message: string } | null }>;
      };
    };
  };
};

type AdminUserRoleRow = {
  email: string | null;
};

type VehicleRow = {
  plate_number: string | null;
  model: string | null;
  location?: string | null;
};

export type BookingNotificationSnapshot = {
  bookingId: string;
  vehicleId: string;
  bookedByEmail: string;
  startsAt: string;
  endsAt: string | null;
  isLongTerm: boolean;
  comments: string | null;
};

export type KeyCollectionReminderSnapshot = BookingNotificationSnapshot;
export type BookingBorrowReminderSnapshot = BookingNotificationSnapshot;

export type ActiveLoanForBookingConflictSnapshot = {
  loanId: string;
  borrowerEmail: string;
  driverName: string;
  purpose: string;
  borrowedAt: string;
  expectedReturnAt: string | null;
  isLongTerm: boolean;
};

type BookingNotificationAction = "created" | "updated" | "cancelled";

type LongTermBorrowNotificationParams = {
  supabase: unknown;
  borrowerEmail: string;
  vehicleId: string;
  driverName: string;
  purpose: string;
  startOdometer: number | null;
  borrowNotes: string | null;
};

type BorrowConfirmationParams = {
  supabase: unknown;
  borrowerEmail: string;
  vehicleId: string;
  driverName: string;
  purpose: string;
  startOdometer: number | null;
  expectedReturnAt: string | null;
  isLongTerm: boolean;
  borrowNotes: string | null;
};

export type BorrowOverdueReminderSnapshot = {
  loanId: string;
  vehicleId: string;
  borrowerEmail: string;
  driverName: string;
  purpose: string;
  borrowedAt: string;
  expectedReturnAt: string;
};

type BookingNotificationParams = {
  supabase: unknown;
  action: BookingNotificationAction;
  actorEmail: string;
  booking: BookingNotificationSnapshot;
  previousBooking?: Pick<BookingNotificationSnapshot, "startsAt" | "endsAt" | "isLongTerm" | "comments"> | null;
  notifyAdmins?: boolean;
};

type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

const MAIL_FROM_NAME = "serena wang";

function getEmailAddress(value: string) {
  const bracketMatch = value.match(/<([^>]+)>/);

  return (bracketMatch?.[1] ?? value).trim();
}

function buildFromAddress(from: string) {
  const address = getEmailAddress(from);

  return `"${MAIL_FROM_NAME}" <${address}>`;
}

function getMailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();

  if (!host || !user || !pass || !from) {
    return null;
  }

  const parsedPort = Number(process.env.SMTP_PORT?.trim() ?? "587");
  const port = Number.isFinite(parsedPort) ? parsedPort : 587;
  const secureSetting = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureSetting ? secureSetting === "true" : port === 465;

  return { host, port, secure, user, pass, from: buildFromAddress(from) };
}

function getSydneyDateTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
  };
}

function addOneSydneyDay(parts: ReturnType<typeof getSydneyDateTimeParts>) {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));

  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
  };
}

function toDateTimeLocalValue(parts: ReturnType<typeof getSydneyDateTimeParts>) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function getNextSydneyNineAmIso(now = new Date()) {
  const nowParts = getSydneyDateTimeParts(now);
  const cutoffParts = nowParts.hour >= 9 ? addOneSydneyDay(nowParts) : nowParts;
  const cutoffLocalValue = toDateTimeLocalValue({ ...cutoffParts, hour: 9, minute: 0 });

  return parseDateTimeLocalToUtcIso(cutoffLocalValue);
}

function shouldSendImmediateKeyCollectionReminder(startsAt: string) {
  const startTime = new Date(startsAt).getTime();
  const cutoffIso = getNextSydneyNineAmIso();
  const cutoffTime = cutoffIso ? new Date(cutoffIso).getTime() : Number.NaN;

  return Number.isFinite(startTime) && Number.isFinite(cutoffTime) && startTime < cutoffTime;
}

function getActionLabel(action: BookingNotificationAction) {
  if (action === "created") {
    return "confirmed";
  }

  if (action === "updated") {
    return "updated";
  }

  return "cancelled";
}

function buildVehicleLabel(vehicle: VehicleRow | null) {
  if (!vehicle) {
    return "Vehicle booking";
  }

  const parts = [vehicle.plate_number, vehicle.model].filter(Boolean);
  if (vehicle.location) {
    parts.push(vehicle.location);
  }

  return parts.length > 0 ? parts.join(" • ") : "Vehicle booking";
}

async function getVehicleForNotification(supabase: unknown, vehicleId: string) {
  const client = supabase as SupabaseNotificationClient;
  const { data, error } = await client.from("vehicles").select("plate_number, model, location").eq("id", vehicleId).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as VehicleRow | null) ?? null;
}

async function getAdminEmails(supabase: unknown) {
  const client = supabase as {
    from: (table: "user_roles") => {
      select: (columns: "email") => {
        eq: (column: "is_admin", value: boolean) => {
          order: (
            column: "email",
            options?: { ascending?: boolean },
          ) => Promise<{ data: AdminUserRoleRow[] | null; error?: { message: string } | null }>;
        };
      };
    };
  };

  const { data, error } = await client.from("user_roles").select("email").eq("is_admin", true).order("email", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => row.email?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
}

function buildSubject(action: BookingNotificationAction, vehicleLabel: string) {
  return `Vehicle booking ${getActionLabel(action)}: ${vehicleLabel}`;
}

function isLongTermBooking(booking: BookingNotificationSnapshot) {
  return booking.isLongTerm;
}

function buildTextBody({
  action,
  actorEmail,
  booking,
  previousBooking,
  vehicleLabel,
}: {
  action: BookingNotificationAction;
  actorEmail: string;
  booking: BookingNotificationSnapshot;
  previousBooking?: Pick<BookingNotificationSnapshot, "startsAt" | "endsAt" | "isLongTerm" | "comments"> | null;
  vehicleLabel: string;
}) {
  const lines = [
    `Your vehicle booking has been ${getActionLabel(action)}.`,
    "",
    `Vehicle: ${vehicleLabel}`,
    `Booked for: ${booking.bookedByEmail}`,
    `Actioned by: ${actorEmail}`,
  ];

  if (action !== "cancelled") {
    lines.push(`Start time: ${formatDateTime(booking.startsAt)}`);
    lines.push(`End time: ${isLongTermBooking(booking) ? "Long term" : formatDateTime(booking.endsAt)}`);
  }

  if (action === "updated" && previousBooking) {
    lines.push("");
    lines.push("Previous booking details:");
    lines.push(`Start time: ${formatDateTime(previousBooking.startsAt)}`);
    lines.push(`End time: ${previousBooking.isLongTerm ? "Long term" : formatDateTime(previousBooking.endsAt)}`);
    lines.push(`Comments: ${previousBooking.comments || "-"}`);
  }

  lines.push(`Comments: ${booking.comments || "-"}`);
  lines.push("");
  lines.push("If the dashboard looks delayed, please rely on this email as the latest booking notice.");

  return lines.join("\n");
}

export async function sendLongTermBorrowAdminNotificationEmail({
  supabase,
  borrowerEmail,
  vehicleId,
  driverName,
  purpose,
  startOdometer,
  borrowNotes,
}: LongTermBorrowNotificationParams) {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return;
  }

  const [vehicle, adminEmails] = await Promise.all([getVehicleForNotification(supabase, vehicleId), getAdminEmails(supabase)]);
  const toList = adminEmails.filter(Boolean);

  if (toList.length === 0) {
    return;
  }

  const vehicleLabel = buildVehicleLabel(vehicle);
  const transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass,
    },
  });

  await transporter.sendMail({
    from: mailConfig.from,
    to: toList.join(", "),
    subject: `Long term vehicle borrow: ${vehicleLabel}`,
    text: [
      "A long term vehicle borrow has been created.",
      "",
      `Vehicle: ${vehicleLabel}`,
      `Borrower: ${borrowerEmail}`,
      `Driver: ${driverName || "-"}`,
      `Purpose: ${purpose}`,
      `Current odometer: ${startOdometer === null ? "-" : `${startOdometer.toLocaleString()} km`}`,
      `Notes: ${borrowNotes || "-"}`,
      "",
      "No expected return date was provided.",
    ].join("\n"),
  });
}

export async function sendBorrowConfirmationEmail({
  supabase,
  borrowerEmail,
  vehicleId,
  driverName,
  purpose,
  startOdometer,
  expectedReturnAt,
  isLongTerm,
  borrowNotes,
}: BorrowConfirmationParams) {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return;
  }

  const recipient = borrowerEmail.trim().toLowerCase();

  if (!recipient) {
    return;
  }

  const vehicle = await getVehicleForNotification(supabase, vehicleId);
  const vehicleLabel = buildVehicleLabel(vehicle);
  const transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass,
    },
  });

  await transporter.sendMail({
    from: mailConfig.from,
    to: recipient,
    subject: `Vehicle borrow confirmed: ${vehicleLabel}`,
    text: [
      "Your vehicle borrow has been confirmed.",
      "",
      `Vehicle: ${vehicleLabel}`,
      `Borrower: ${recipient}`,
      `Driver: ${driverName || "-"}`,
      `Purpose: ${purpose}`,
      `Borrowed at: ${formatDateTime(new Date().toISOString())}`,
      `Expected return: ${isLongTerm ? "Long term" : formatDateTime(expectedReturnAt)}`,
      `Start odometer: ${startOdometer === null ? "-" : `${startOdometer.toLocaleString()} km`}`,
      `Notes: ${borrowNotes || "-"}`,
      "",
      `Please open ${APP_NAME} when you return the vehicle so the return is registered.`,
    ].join("\n"),
  });
}

export async function sendBookingNotificationEmail({
  supabase,
  action,
  actorEmail,
  booking,
  previousBooking = null,
  notifyAdmins = false,
}: BookingNotificationParams) {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return;
  }

  const [vehicle, adminEmails] = await Promise.all([
    getVehicleForNotification(supabase, booking.vehicleId),
    notifyAdmins ? getAdminEmails(supabase) : Promise.resolve([]),
  ]);

  const vehicleLabel = buildVehicleLabel(vehicle);
  const recipients = new Set<string>([booking.bookedByEmail.trim().toLowerCase()]);

  adminEmails.forEach((email) => recipients.add(email));

  const toList = Array.from(recipients).filter(Boolean);

  if (toList.length === 0) {
    return;
  }

  const transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass,
    },
  });

  await transporter.sendMail({
    from: mailConfig.from,
    to: toList.join(", "),
    subject: buildSubject(action, vehicleLabel),
    text: buildTextBody({
      action,
      actorEmail,
      booking,
      previousBooking,
      vehicleLabel,
    }),
  });
}

export async function sendBorrowOverdueReminderEmail({
  supabase,
  loan,
}: {
  supabase: unknown;
  loan: BorrowOverdueReminderSnapshot;
}) {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return false;
  }

  const recipient = loan.borrowerEmail.trim().toLowerCase();

  if (!recipient) {
    return false;
  }

  const vehicle = await getVehicleForNotification(supabase, loan.vehicleId);
  const vehicleLabel = buildVehicleLabel(vehicle);
  const transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass,
    },
  });

  await transporter.sendMail({
    from: mailConfig.from,
    to: recipient,
    subject: `Vehicle return reminder: ${vehicleLabel}`,
    text: [
      "The expected return time for your active vehicle borrow has passed.",
      "",
      `Vehicle: ${vehicleLabel}`,
      `Borrower: ${recipient}`,
      `Driver: ${loan.driverName || "-"}`,
      `Purpose: ${loan.purpose}`,
      `Borrowed at: ${formatDateTime(loan.borrowedAt)}`,
      `Expected return: ${formatDateTime(loan.expectedReturnAt)}`,
      "",
      `If you have already returned the vehicle, please open ${APP_NAME} and register the return.`,
      "If you still need the vehicle, please extend the borrow time.",
    ].join("\n"),
  });

  return true;
}

export async function sendKeyCollectionReminderEmail({
  supabase,
  booking,
}: {
  supabase: unknown;
  booking: KeyCollectionReminderSnapshot;
}) {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return false;
  }

  const vehicle = await getVehicleForNotification(supabase, booking.vehicleId);
  const vehicleLabel = buildVehicleLabel(vehicle);
  const recipient = booking.bookedByEmail.trim().toLowerCase();

  if (!recipient) {
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass,
    },
  });

  await transporter.sendMail({
    from: mailConfig.from,
    to: recipient,
    subject: `Upcoming key collection reminder: ${vehicleLabel}`,
    text: [
      "You have a vehicle booking coming up in the next 24 hours.",
      "",
      `Vehicle: ${vehicleLabel}`,
      `Start time: ${formatDateTime(booking.startsAt)}`,
      `End time: ${formatDateTime(booking.endsAt)}`,
      `Comments: ${booking.comments || "-"}`,
      "",
      `When you collect the key, open ${APP_NAME} and select Key collected on your booking. This will convert the booking into an active borrow.`,
      "",
      "Booking alone is not enough once the key has been collected.",
    ].join("\n"),
  });

  return true;
}

export async function sendBookingBorrowReminderEmail({
  supabase,
  booking,
}: {
  supabase: unknown;
  booking: BookingBorrowReminderSnapshot;
}) {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return false;
  }

  const vehicle = await getVehicleForNotification(supabase, booking.vehicleId);
  const vehicleLabel = buildVehicleLabel(vehicle);
  const recipient = booking.bookedByEmail.trim().toLowerCase();

  if (!recipient) {
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass,
    },
  });

  await transporter.sendMail({
    from: mailConfig.from,
    to: recipient,
    subject: `Vehicle borrow action needed: ${vehicleLabel}`,
    text: [
      "Your vehicle booking is currently active, but it has not been converted into an active borrow yet.",
      "",
      `Vehicle: ${vehicleLabel}`,
      `Start time: ${formatDateTime(booking.startsAt)}`,
      `End time: ${booking.isLongTerm ? "Long term" : formatDateTime(booking.endsAt)}`,
      `Comments: ${booking.comments || "-"}`,
      "",
      "if you collect the key and already using the car, make sure to click borrow the vehicle.",
      "",
      `Open ${APP_NAME}, go to Book, and select Key collected / Borrow vehicle on your booking.`,
    ].join("\n"),
    html: [
      "<p>Your vehicle booking is currently active, but it has not been converted into an active borrow yet.</p>",
      "<ul>",
      `<li><strong>Vehicle:</strong> ${vehicleLabel}</li>`,
      `<li><strong>Start time:</strong> ${formatDateTime(booking.startsAt)}</li>`,
      `<li><strong>End time:</strong> ${booking.isLongTerm ? "Long term" : formatDateTime(booking.endsAt)}</li>`,
      `<li><strong>Comments:</strong> ${booking.comments || "-"}</li>`,
      "</ul>",
      '<p>if you collect the key and already using the car, <strong style="font-size: 18px;">make sure to click borrow the vehicle.</strong></p>',
      `<p>Open ${APP_NAME}, go to Book, and select Key collected / Borrow vehicle on your booking.</p>`,
    ].join(""),
  });

  return true;
}

export async function sendBookingHandoverConflictReminderEmail({
  supabase,
  booking,
  activeLoan,
}: {
  supabase: unknown;
  booking: BookingBorrowReminderSnapshot;
  activeLoan: ActiveLoanForBookingConflictSnapshot;
}) {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return false;
  }

  const bookingRecipient = booking.bookedByEmail.trim().toLowerCase();
  const borrowerRecipient = activeLoan.borrowerEmail.trim().toLowerCase();
  const recipients = Array.from(new Set([bookingRecipient, borrowerRecipient])).filter(Boolean);

  if (recipients.length === 0) {
    return false;
  }

  const vehicle = await getVehicleForNotification(supabase, booking.vehicleId);
  const vehicleLabel = buildVehicleLabel(vehicle);
  const transporter = nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port,
    secure: mailConfig.secure,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass,
    },
  });

  await transporter.sendMail({
    from: mailConfig.from,
    to: recipients.join(", "),
    subject: `Vehicle handover coordination needed: ${vehicleLabel}`,
    text: [
      "A vehicle booking has started, but the vehicle is still recorded as borrowed.",
      "",
      `Vehicle: ${vehicleLabel}`,
      `Booked for: ${bookingRecipient || "-"}`,
      `Booking start: ${formatDateTime(booking.startsAt)}`,
      `Booking end: ${booking.isLongTerm ? "Long term" : formatDateTime(booking.endsAt)}`,
      `Current borrower: ${borrowerRecipient || "-"}`,
      `Current driver: ${activeLoan.driverName || "-"}`,
      `Borrow purpose: ${activeLoan.purpose || "-"}`,
      `Borrowed at: ${formatDateTime(activeLoan.borrowedAt)}`,
      `Expected return: ${activeLoan.isLongTerm ? "Long term" : formatDateTime(activeLoan.expectedReturnAt)}`,
      "",
      "Please coordinate the handover directly. The booking can be converted into an active borrow after the previous borrow is returned.",
      "",
      `Open ${APP_NAME} to return the vehicle or check the booking details.`,
    ].join("\n"),
    html: [
      "<p>A vehicle booking has started, but the vehicle is still recorded as borrowed.</p>",
      "<ul>",
      `<li><strong>Vehicle:</strong> ${vehicleLabel}</li>`,
      `<li><strong>Booked for:</strong> ${bookingRecipient || "-"}</li>`,
      `<li><strong>Booking start:</strong> ${formatDateTime(booking.startsAt)}</li>`,
      `<li><strong>Booking end:</strong> ${booking.isLongTerm ? "Long term" : formatDateTime(booking.endsAt)}</li>`,
      `<li><strong>Current borrower:</strong> ${borrowerRecipient || "-"}</li>`,
      `<li><strong>Current driver:</strong> ${activeLoan.driverName || "-"}</li>`,
      `<li><strong>Expected return:</strong> ${activeLoan.isLongTerm ? "Long term" : formatDateTime(activeLoan.expectedReturnAt)}</li>`,
      "</ul>",
      "<p>Please coordinate the handover directly. The booking can be converted into an active borrow after the previous borrow is returned.</p>",
      `<p>Open ${APP_NAME} to return the vehicle or check the booking details.</p>`,
    ].join(""),
  });

  return true;
}

export async function sendImmediateKeyCollectionReminderIfDue({
  supabase,
  booking,
}: {
  supabase: unknown;
  booking: KeyCollectionReminderSnapshot;
}) {
  if (booking.isLongTerm || !booking.endsAt || !shouldSendImmediateKeyCollectionReminder(booking.startsAt)) {
    return false;
  }

  const sent = await sendKeyCollectionReminderEmail({ supabase, booking });

  if (!sent) {
    return false;
  }

  const client = supabase as SupabaseNotificationClient;
  const { error } =
    (await client
      .from("vehicle_bookings")
      .update?.({ key_collection_reminded_at: new Date().toISOString() })
      .eq("id", booking.bookingId)
      .is("key_collection_reminded_at", null)) ?? {};

  if (error) {
    throw new Error(error.message);
  }

  return true;
}
