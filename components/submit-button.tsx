"use client";

import { useFormStatus } from "react-dom";
import { DuckLoader } from "@/components/duck-loader";

type SubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
  showPendingDuck?: boolean;
};

export function SubmitButton({ idleLabel, pendingLabel, className = "primaryButton", showPendingDuck = false }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={className} disabled={pending} type="submit">
      {pending && showPendingDuck ? <DuckLoader label={pendingLabel} /> : pending ? pendingLabel : idleLabel}
    </button>
  );
}
