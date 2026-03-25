import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

type AppShellProps = {
  title: string;
  subtitle: string;
  userLabel: string;
  backHref?: string;
  backLabel?: string;
  adminHref?: string;
  children: ReactNode;
};

export function AppShell({ title, subtitle, userLabel, backHref, backLabel = "Back to dashboard", adminHref, children }: AppShellProps) {
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
            <div className="headerActions">
              {adminHref ? (
                <Link className="ghostButton" href={adminHref}>
                  Admin
                </Link>
              ) : null}
              {backHref ? (
                <Link className="backLink" href={backHref}>
                  {backLabel}
                </Link>
              ) : null}
              <LogoutButton />
            </div>
          </div>
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
