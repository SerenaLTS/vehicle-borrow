import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

type AppShellProps = {
  title: string;
  subtitle: string;
  userLabel: string;
  children: ReactNode;
};

export function AppShell({ title, subtitle, userLabel, children }: AppShellProps) {
  return (
    <div className="pageShell">
      <aside className="sidebar">
        <div className="sidebarTop">
          <div>
            <p className="eyebrow">Vehicle Borrow</p>
            <h1>{title}</h1>
            <p className="sidebarCopy">{subtitle}</p>
          </div>

          <div className="sidebarFooter">
            <p className="signedInAs">{userLabel}</p>
            <LogoutButton />
          </div>
        </div>

        <nav className="nav">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/borrow">Borrow</Link>
          <Link href="/return">Return</Link>
          <Link href="/history">History</Link>
        </nav>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
