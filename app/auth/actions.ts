"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCompanyEmail } from "@/lib/utils";

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
    redirect("/?error=Unable to create the account. Check your details or contact an administrator.");
  }

  redirect("/?message=Account created. Please sign in with your password.");
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
