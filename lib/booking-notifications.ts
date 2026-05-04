import nodemailer from "nodemailer";
import { APP_NAME } from "@/lib/app-config";
import { formatDateTime } from "@/lib/utils";

type SupabaseNotificationClient = {
  from: (table: "vehicles" | "user_roles") => {
    select: (columns: string) => {
      eq: (column: string, value: string | boolean) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error?: { message: string } | null }>;
      };
      order?: (column: string, options?: { ascending?: boolean }) => {
        then?: never;
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
};

export type BookingNotificationSnapshot = {
  bookingId: string;
  vehicleId: string;
  bookedByEmail: string;
  startsAt: string;
  endsAt: string;
  comments: string | null;
};

export type KeyCollectionReminderSnapshot = BookingNotificationSnapshot;

type BookingNotificationAction = "created" | "updated" | "cancelled";

type BookingNotificationParams = {
  supabase: unknown;
  action: BookingNotificationAction;
  actorEmail: string;
  booking: BookingNotificationSnapshot;
  previousBooking?: Pick<BookingNotificationSnapshot, "startsAt" | "endsAt" | "comments"> | null;
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

  return { host, port, secure, user, pass, from };
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
  return parts.length > 0 ? parts.join(" • ") : "Vehicle booking";
}

async function getVehicleForNotification(supabase: unknown, vehicleId: string) {
  const client = supabase as SupabaseNotificationClient;
  const { data, error } = await client.from("vehicles").select("plate_number, model").eq("id", vehicleId).maybeSingle();

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
  previousBooking?: Pick<BookingNotificationSnapshot, "startsAt" | "endsAt" | "comments"> | null;
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
    lines.push(`End time: ${formatDateTime(booking.endsAt)}`);
  }

  if (action === "updated" && previousBooking) {
    lines.push("");
    lines.push("Previous booking details:");
    lines.push(`Start time: ${formatDateTime(previousBooking.startsAt)}`);
    lines.push(`End time: ${formatDateTime(previousBooking.endsAt)}`);
    lines.push(`Comments: ${previousBooking.comments || "-"}`);
  }

  lines.push(`Comments: ${booking.comments || "-"}`);
  lines.push("");
  lines.push("If the dashboard looks delayed, please rely on this email as the latest booking notice.");

  return lines.join("\n");
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

export async function sendKeyCollectionReminderEmail({
  supabase,
  booking,
}: {
  supabase: unknown;
  booking: KeyCollectionReminderSnapshot;
}) {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return;
  }

  const vehicle = await getVehicleForNotification(supabase, booking.vehicleId);
  const vehicleLabel = buildVehicleLabel(vehicle);
  const recipient = booking.bookedByEmail.trim().toLowerCase();

  if (!recipient) {
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
    to: recipient,
    subject: `Have you collected the key? ${vehicleLabel}`,
    text: [
      "Your vehicle booking has reached its start time.",
      "",
      `Vehicle: ${vehicleLabel}`,
      `Start time: ${formatDateTime(booking.startsAt)}`,
      `End time: ${formatDateTime(booking.endsAt)}`,
      `Comments: ${booking.comments || "-"}`,
      "",
      `If you have collected the key, open ${APP_NAME} and select Key collected on your booking. This will convert the booking into an active borrow.`,
      "",
      "Booking alone is not enough once the key has been collected.",
    ].join("\n"),
  });
}
