"use client";

import { useEffect, useState } from "react";

type HistoryPaginationSummaryProps = {
  page: number;
  query: string;
  from: string;
  to: string;
  status: string;
};

export function HistoryPaginationSummary({ page, query, from, to, status }: HistoryPaginationSummaryProps) {
  const [totalPages, setTotalPages] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, from, to, status });

    fetch(`/api/history-count?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to count history records.");
        return (await response.json()) as { totalPages: number };
      })
      .then((result) => setTotalPages(result.totalPages))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTotalPages(null);
      });

    return () => controller.abort();
  }, [from, query, status, to]);

  return (
    <p className="muted">
      Page {page}{totalPages === null ? "" : ` of ${totalPages}`}. Swipe sideways to view all columns.
    </p>
  );
}
