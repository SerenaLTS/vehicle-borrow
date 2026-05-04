import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { APP_NAME } from "@/lib/app-config";

type AppShellProps = {
  title: string;
  subtitle: string;
  userLabel: string;
  backHref?: string;
  backLabel?: string;
  adminHref?: string;
  helpHref?: string;
  children: ReactNode;
};

export function AppShell({ title, subtitle, userLabel, backHref, backLabel = "Back to dashboard", adminHref, helpHref, children }: AppShellProps) {
  return (
    <div className="pageShell">
      {helpHref ? (
        <Link aria-label="Open user guide" className="helpButton" href={helpHref} title="User guide">
          ?
        </Link>
      ) : null}

      <aside className="sidebar">
        <div className="sidebarTop">
          <div>
            <p className="eyebrow">{APP_NAME}</p>
            <h1>{title}</h1>
            <p className="sidebarCopy">{subtitle}</p>
          </div>

          <div className="sidebarFooter">
            <p className="signedInAs userIdentity">{userLabel}</p>
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
