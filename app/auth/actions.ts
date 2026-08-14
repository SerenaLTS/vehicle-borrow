"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCompanyEmail } from "@/lib/utils";
import { consumeAuthRateLimit } from "@/lib/auth-rate-limit";

function getAuthOrigin() {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
}

function validateCompanyEmail(email: string) {
  const companyDomain = process.env.COMPANY_EMAIL_DOMAIN ?? "";

  if (!email || !isCompanyEmail(email, companyDomain)) {
    redirect("/?error=Please use your company email address.");
  }
}

function logAuthError(operation: string, error: { message: string }) {
  console.error(`Supabase authentication error during ${operation}:`, error.message);
}

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  validateCompanyEmail(email);

  if (!password) {
    redirect("/?error=Please enter your password.");
  }

  if (!await consumeAuthRateLimit("sign_in", email)) {
    redirect("/?error=Unable to complete sign in. Please wait and try again.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    logAuthError("sign in", error);
    redirect("/?error=Unable to sign in. Check your email and password and try again.");
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUpWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  validateCompanyEmail(email);

  if (password.length < 8) {
    redirect("/?error=Password must be at least 8 characters.");
  }

  if (!await consumeAuthRateLimit("sign_up", email)) {
    redirect("/?message=If this email is eligible, the account request will be processed. Please wait before trying again.");
  }

  const admin = createAdminClient();
  const { data: approvedEmail, error: approvalError } = await admin
    .from("allowed_user_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (approvalError) logAuthError("private allowlist check", approvalError);
  if (!approvedEmail || approvalError) {
    redirect("/?message=If this email is eligible, the account request has been processed. Check your inbox or try signing in.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getAuthOrigin()}/auth/callback`,
    },
  });

  if (error) {
    logAuthError("account creation", error);
  }

  redirect("/?message=If this email is eligible, the account request has been processed. Check your inbox or try signing in.");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    redirect("/account/password?error=Password must be at least 8 characters.");
  }

  if (password !== confirmPassword) {
    redirect("/account/password?error=Passwords do not match.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    logAuthError("password update", error);
    redirect("/account/password?error=Unable to update the password. Please try again.");
  }

  redirect("/account/password?message=Password updated successfully.");
}
