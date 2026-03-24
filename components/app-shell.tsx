import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

type AppShellProps = {
  title: string;
  subtitle: string;
  userLabel: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
};

export function AppShell({ title, subtitle, userLabel, backHref, backLabel = "Back to dashboard", children }: AppShellProps) {
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
