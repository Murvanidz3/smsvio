import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onCancel}>
      <div
        className="bg-popover text-popover-foreground w-full max-w-md rounded-xl border p-5 shadow-xl"
        role="dialog"
        aria-labelledby="confirm-title"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <div className="text-muted-foreground mt-2 text-sm">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
