"use client";

import { useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { ErrorDialog } from "@/components/error-dialog";
import { validateBorrowForm } from "@/lib/borrow-validation";

type BorrowResult = { error: string; field?: string };

export function BorrowForm({ action, children }: { action: (data: FormData) => Promise<BorrowResult>; children: React.ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const preserveEntries = useRef(false);
  const [error, setError] = useState<BorrowResult | null>(null);

  async function submit(data: FormData) {
    preserveEntries.current = false;
    try {
      const result = await action(data);
      preserveEntries.current = true;
      setError(result);
    } catch (failure) {
      unstable_rethrow(failure);
      preserveEntries.current = true;
      setError({ error: "The request could not be completed. Your entries have been kept. Check your connection and try again." });
    }
  }

  return <>
    <form ref={form} action={submit} noValidate onReset={(event) => {
      // React resets uncontrolled fields after an action resolves, including a
      // handled validation error. Keep them intact until the borrow succeeds.
      if (preserveEntries.current) event.preventDefault();
    }} onSubmit={(event) => {
      const issues = validateBorrowForm(new FormData(event.currentTarget));
      const invalid = Array.from(event.currentTarget.elements).find((element) =>
        (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && !element.validity.valid,
      ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
      if (issues.length || invalid) {
        event.preventDefault();
        setError({ error: issues.length ? issues.map((issue) => issue.message).join("\n\n") : invalid!.validationMessage, field: issues[0]?.field ?? invalid?.name });
      }
    }}>{children}</form>
    {error ? <ErrorDialog message={error.error} onClose={() => {
      const field = error.field ? form.current?.elements.namedItem(error.field) : null;
      setError(null);
      if (field instanceof HTMLElement) { field.focus(); field.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }} /> : null}
  </>;
}
