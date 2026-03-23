import { signOut } from "@/app/auth/actions";

export function LogoutButton() {
  return (
    <form action={signOut}>
      <button className="ghostButton" type="submit">
        Sign out
      </button>
    </form>
  );
}
