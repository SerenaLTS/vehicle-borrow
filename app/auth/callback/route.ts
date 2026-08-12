import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeInternalPath } from "@/lib/navigation";
import { getSafeActionErrorMessage } from "@/lib/action-errors";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeInternalPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      const message = getSafeActionErrorMessage(error, "Unable to complete sign in. Please try again.", "auth:callback");
      return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(message)}`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
