"use client";

import { useEffect, useId, useRef } from "react";

export function ErrorDialog({ message, onClose }: { message: string; onClose?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // A failed server action may have left the page's loading overlay active.
    window.dispatchEvent(new CustomEvent("app:navigation-end"));
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="errorDialog" role="alertdialog" aria-labelledby={titleId} aria-describedby={messageId} onCancel={(event) => event.preventDefault()}>
    <h2 id={titleId}>Unable to complete your request</h2>
    <p id={messageId} className="errorDialogMessage">{message}</p>
    <p className="muted">Close this message, correct the details, then try again.</p>
    <button className="primaryButton" type="button" autoFocus onClick={() => { dialog.current?.close(); onClose?.(); }}>Close and edit</button>
  </dialog>;
}
