"use client";

type ConfirmFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
  confirmMessage: string;
  className?: string;
};

export function ConfirmForm({ action, children, confirmMessage, className }: ConfirmFormProps) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}
