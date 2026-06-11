"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent } from "react";

type LoadingLinkProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function LoadingLink({ href, children, className, ariaLabel }: LoadingLinkProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

    window.dispatchEvent(new CustomEvent("app:navigation-start"));
    router.push(href);
  }

  return (
    <a aria-label={ariaLabel} className={className} href={href} onClick={handleClick}>
      {children}
    </a>
  );
}
