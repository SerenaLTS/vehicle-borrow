"use client";

type ConfirmFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
  confirmMessage: string;
  className?: string;
};

export function ConfirmForm({ action, children, confirmMessage, className }: ConfirmFormProps) {
  async function runAction(formData: FormData) {
    try {
      await action(formData);
    } finally {
      // A server action can redirect back to the same pathname (for example after
      // deleting a booking). In that case pathname-based loading cleanup may not
      // run, so explicitly finish the overlay when the action settles.
      window.dispatchEvent(new CustomEvent("app:navigation-end"));
    }
  }

  return (
    <form
      action={runAction}
      className={className}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
          return;
        }

        window.dispatchEvent(new CustomEvent("app:navigation-start"));
      }}
    >
      {children}
    </form>
  );
}
