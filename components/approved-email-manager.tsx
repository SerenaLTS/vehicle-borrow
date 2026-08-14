"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { addAllowedUserEmail, removeAllowedUserEmail } from "@/app/admin/actions";
import { DuckLoader } from "@/components/duck-loader";
import { formatDateTime } from "@/lib/utils";

export type ApprovedEmailEntry = {
  email: string;
  notes: string | null;
  created_at: string;
};

type ApprovedEmailManagerProps = {
  initialEntries: ApprovedEmailEntry[];
};

export function ApprovedEmailManager({ initialEntries }: ApprovedEmailManagerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return entries;
    return entries.filter((entry) => `${entry.email} ${entry.notes ?? ""}`.toLowerCase().includes(normalizedQuery));
  }, [entries, query]);

  function approve(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const existing = entries.find((entry) => entry.email === email);

    if (existing) {
      setNotice({ kind: "error", text: `${email} is already approved.` });
      return;
    }

    const optimisticEntry: ApprovedEmailEntry = { email, notes, created_at: new Date().toISOString() };
    setEntries((current) => [optimisticEntry, ...current]);
    setPendingEmail(email);
    setNotice(null);

    startTransition(async () => {
      const result = await addAllowedUserEmail(formData);
      setPendingEmail(null);
      if (!result.ok) {
        setEntries((current) => current.filter((entry) => entry.email !== email));
        setNotice({ kind: "error", text: result.message });
        return;
      }

      setEntries((current) => current.map((entry) => entry.email === email ? result.entry : entry));
      setNotice({ kind: "success", text: result.message });
      formRef.current?.reset();
    });
  }

  function remove(email: string) {
    if (!window.confirm(`Remove ${email} from the approved signup list? Existing account access will not be disabled.`)) return;
    const previousEntries = entries;
    setEntries((current) => current.filter((entry) => entry.email !== email));
    setPendingEmail(email);
    setNotice(null);

    const formData = new FormData();
    formData.set("email", email);
    startTransition(async () => {
      const result = await removeAllowedUserEmail(formData);
      setPendingEmail(null);
      if (!result.ok) {
        setEntries(previousEntries);
        setNotice({ kind: "error", text: result.message });
        return;
      }
      setNotice({ kind: "success", text: result.message });
    });
  }

  return (
    <>
      <section className="panel">
        <h2>Approved signup emails</h2>
        <p className="muted">Add an employee before they create an account. Removing an email blocks future signup but does not disable an existing account.</p>
        {notice ? <p aria-live="polite" className={notice.kind === "error" ? "message error" : "message"}>{notice.text}</p> : null}
        <form action={approve} ref={formRef}>
          <div className="formGrid">
            <label className="fieldLabel">Employee email<input autoComplete="email" name="email" placeholder="name@yourcompany.com" required type="email" /></label>
            <label className="fieldLabel">Notes<input name="notes" placeholder="Team or reason (optional)" /></label>
          </div>
          <button className="primaryButton" disabled={isPending} type="submit">
            {isPending && pendingEmail ? <DuckLoader label="Duck is approving..." /> : "Approve email"}
          </button>
        </form>
      </section>

      <section className="sectionHeader">
        <div><h2>Approved list</h2><p className="muted">{entries.length} approved email{entries.length === 1 ? "" : "s"}.</p></div>
        <label className="fieldLabel">Search approved emails<input onChange={(event) => setQuery(event.target.value)} placeholder="Email or notes" type="search" value={query} /></label>
      </section>
      {visibleEntries.length === 0 ? <div className="emptyState">{query ? "No approved emails match your search." : "No approved emails yet."}</div> : (
        <div className="tableWrap">
          <table>
            <thead><tr><th>Approved email</th><th>Notes</th><th>Added</th><th>Action</th></tr></thead>
            <tbody>{visibleEntries.map((entry) => (
              <tr key={entry.email}>
                <td>{entry.email}{pendingEmail === entry.email ? <span className="muted"> • Saving…</span> : null}</td>
                <td>{entry.notes ?? "-"}</td><td>{formatDateTime(entry.created_at)}</td>
                <td><button className="ghostButton" disabled={isPending} onClick={() => remove(entry.email)} type="button">Remove</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
