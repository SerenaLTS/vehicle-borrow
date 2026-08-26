import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { isJwtIssuedInFutureError } from "@/lib/auth-session-errors";

export async function updateSession(request: NextRequest) {
  const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  try {
    const { error } = await supabase.auth.getUser();

    if (isJwtIssuedInFutureError(error)) {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) console.warn("[auth:clock-skew] Unable to refresh the session.");
    }
  } catch (error) {
    if (!isJwtIssuedInFutureError(error)) throw error;

    try {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) console.warn("[auth:clock-skew] Unable to refresh the session.");
    } catch {
      console.warn("[auth:clock-skew] Session refresh failed.");
    }
  }

  return response;
}
