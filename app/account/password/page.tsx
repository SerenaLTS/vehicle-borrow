import { redirect } from "next/navigation";
import { updatePassword } from "@/app/auth/actions";
import { AppShell } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
import { createClient } from "@/lib/supabase/server";
import { formatDisplayName } from "@/lib/utils";

type PasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PasswordPage({ searchParams }: PasswordPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const message = typeof params.message === "string" ? params.message : null;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <AppShell
      title="Change password"
      subtitle="Update the password used to sign in to your account."
      userLabel={`${formatDisplayName(user.email ?? "")} • ${user.email}`}
      backHref="/dashboard"
      backLabel="Dashboard"
    >
      <section className="panel">
        <h2>Set a new password</h2>
        <p className="muted">Use at least 8 characters and do not reuse your temporary password.</p>
        <form action={updatePassword}>
          <label className="fieldLabel">
            New password
            <input autoComplete="new-password" minLength={8} name="password" required type="password" />
          </label>
          <label className="fieldLabel">
            Confirm new password
            <input autoComplete="new-password" minLength={8} name="confirmPassword" required type="password" />
          </label>
          <SubmitButton idleLabel="Update password" pendingLabel="Updating..." />
        </form>
        {message ? <p className="message">{message}</p> : null}
        {error ? <p className="message error">{error}</p> : null}
      </section>
    </AppShell>
  );
}
