import { redirect } from "next/navigation";
import Link from "next/link";
import { signInWithPassword, signUpWithPassword } from "@/app/auth/actions";
import { APP_NAME } from "@/lib/app-config";
import { createClient } from "@/lib/supabase/server";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const error = typeof params.error === "string" ? params.error : null;
  const message = typeof params.message === "string" ? params.message : null;

  return (
    <div className="authPage">
      <Link aria-label="Open login guide" className="helpButton" href="/user-guide#login" title="User guide">
        ?
      </Link>

      <section className="authStack">
        <header className="authHeader">
          <p className="eyebrow">{APP_NAME}</p>
          <h1>Company vehicle usage management</h1>
          <p className="heroLead">Create your password once, then sign in with email and password.</p>
        </header>

        <div className="panel authPanel">
          <h2>Login</h2>
          <form action={signInWithPassword}>
            <label className="fieldLabel">
              Company email
              <input name="email" type="email" placeholder="name@yourcompany.com" required />
            </label>
            <label className="fieldLabel">
              Password
              <input name="password" type="password" placeholder="Your password" required />
            </label>
            <button className="primaryButton authButton" type="submit">
              Sign in
            </button>
          </form>

          {message ? <p className="message">{message}</p> : null}
          {error ? <p className="message error">{error}</p> : null}

          <div className="authDivider" />

          <h2>Create account</h2>
          <p className="muted">First time here? Use your company email and set your own password.</p>
          <form action={signUpWithPassword}>
            <label className="fieldLabel">
              Company email
              <input name="email" type="email" placeholder="name@yourcompany.com" required />
            </label>
            <label className="fieldLabel">
              Password
              <input
                minLength={8}
                name="password"
                type="password"
                placeholder="Minimum 8 characters"
                required
              />
            </label>
            <button className="secondaryButton authButton" type="submit">
              Create account
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
