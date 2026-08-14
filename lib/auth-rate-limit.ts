import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

type AuthOperation = "sign_in" | "sign_up";

const LIMITS: Record<AuthOperation, { emailAndIp: number; ip: number; windowSeconds: number }> = {
  sign_in: { emailAndIp: 10, ip: 30, windowSeconds: 15 * 60 },
  sign_up: { emailAndIp: 5, ip: 20, windowSeconds: 60 * 60 },
};

function hashRateLimitKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function consumeAuthRateLimit(operation: AuthOperation, email: string) {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || requestHeaders.get("x-real-ip") || "unknown";
  const limit = LIMITS[operation];
  const admin = createAdminClient();
  const keys = [
    { key: hashRateLimitKey(`${operation}:email-ip:${email}:${ip}`), maxAttempts: limit.emailAndIp },
    { key: hashRateLimitKey(`${operation}:ip:${ip}`), maxAttempts: limit.ip },
  ];

  try {
    const results = await Promise.all(keys.map(({ key, maxAttempts }) => admin.rpc("consume_auth_rate_limit", {
      p_key: key,
      p_action: operation,
      p_max_attempts: maxAttempts,
      p_window_seconds: limit.windowSeconds,
    })));

    for (const { data, error } of results) {
      if (error) throw error;
      if (data !== true) return false;
    }
    return true;
  } catch (error) {
    console.error("Auth rate-limit check failed.", error);
    return false;
  }
}
