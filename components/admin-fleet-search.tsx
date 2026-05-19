"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
      <div className="fleetSearchBar">
        <label className="fieldLabel">
          Search fleet
          <input
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rego, VIN, colour, model, location..."
            type="search"
            value={query}
          />
        </label>
        <p className="fieldHint">{visibleCount} of {totalCount} vehicles shown</p>
      </div>

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
