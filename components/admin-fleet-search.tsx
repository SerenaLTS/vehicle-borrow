"use client";

import { useMemo, useState, type ReactNode } from "react";

type AdminFleetSearchProps = {
  children: ReactNode;
  totalCount: number;
};

export function AdminFleetSearch({ children, totalCount }: AdminFleetSearchProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const childArray = useMemo(() => (Array.isArray(children) ? children : [children]), [children]);
  const visibleCount = normalizedQuery
    ? childArray.filter((child) => {
        if (!child || typeof child !== "object" || !("props" in child)) {
          return false;
        }

        const searchable = String((child.props as { "data-search"?: string })["data-search"] ?? "").toLowerCase();
        return searchable.includes(normalizedQuery);
      }).length
    : totalCount;

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

      <div className="cardsGrid">
        {childArray.map((child, index) => {
          if (!normalizedQuery || !child || typeof child !== "object" || !("props" in child)) {
            return child;
          }

          const searchable = String((child.props as { "data-search"?: string })["data-search"] ?? "").toLowerCase();
          return searchable.includes(normalizedQuery) ? child : null;
        })}
      </div>
    </>
  );
}
