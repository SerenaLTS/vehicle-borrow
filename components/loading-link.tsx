"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type MouseEvent } from "react";

type LoadingLinkProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  loadingLabel?: string;
  ariaLabel?: string;
};

export function LoadingLink({ href, children, className, loadingLabel = "Loading...", ariaLabel }: LoadingLinkProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    const currentSearch = searchParams.toString();
    const currentHref = currentSearch ? `${pathname}?${currentSearch}` : pathname;

    event.preventDefault();

    if (href === currentHref) {
      return;
    }

    setIsLoading(true);
    router.push(href);
  }

  return (
    <a aria-label={ariaLabel} aria-busy={isLoading} className={className} href={href} onClick={handleClick}>
      {isLoading ? (
        <span className="buttonSpinnerLabel">
          <span aria-hidden="true" className="buttonSpinner" />
          {loadingLabel}
        </span>
      ) : (
        children
      )}
    </a>
  );
}
