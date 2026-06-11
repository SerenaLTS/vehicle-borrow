"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
  showPendingDuck?: boolean;
};

export function SubmitButton({ idleLabel, pendingLabel, className = "primaryButton" }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={pending} type="submit">
      {pending ? (
        <span className="buttonSpinnerLabel">
          <span aria-hidden="true" className="buttonSpinner" />
          {pendingLabel}
        </span>
      ) : idleLabel}
    </button>
  );
}
