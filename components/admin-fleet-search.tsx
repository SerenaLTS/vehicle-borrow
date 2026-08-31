"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

type AdminFleetSearchProps = {
  children: ReactNode;
  totalCount: number;
};

export function AdminFleetSearch({ children, totalCount }: AdminFleetSearchProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(totalCount);
  const normalizedQuery = useMemo(() => normalizeSearchText(query), [query]);

  useEffect(() => {
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-fleet-card]") ?? []);

    if (!normalizedQuery) {
      cards.forEach((card) => {
        card.hidden = false;
      });
      setVisibleCount(totalCount);
      return;
    }

    let nextVisibleCount = 0;

    cards.forEach((card) => {
      const searchable = normalizeSearchText(`${card.dataset.search ?? ""} ${card.textContent ?? ""}`);
      const isVisible = searchable.includes(normalizedQuery);
      card.hidden = !isVisible;
      if (isVisible) {
        nextVisibleCount += 1;
      }
    });

    setVisibleCount(nextVisibleCount);
  }, [normalizedQuery, totalCount]);

  return (
    <>
      <form className="fleetSearchBar" onSubmit={(event) => event.preventDefault()} role="search">
        <label className="fleetSearchField">
          <span className="srOnly">Search fleet</span>
          <input
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rego, VIN, colour, model, custodian, location..."
            type="search"
            value={query}
          />
        </label>
        <button aria-label="Search fleet" className="fleetIconButton" title="Search fleet" type="submit">
          <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="m16.5 16.5 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="2"/></svg>
        </button>
        <Link aria-label="Add vehicle" className="fleetIconButton fleetAddButton" href="/admin/vehicles/new" title="Add vehicle">
          <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2"/></svg>
        </Link>
        <p className="fieldHint">{visibleCount} of {totalCount} vehicles shown</p>
      </form>

      <div className="cardsGrid" ref={gridRef}>
        {children}
      </div>
    </>
  );
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
