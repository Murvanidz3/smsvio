import { ChevronDown } from 'lucide-react';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useId } from 'react';

export const controlClass =
  'border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 h-11 w-full rounded-xl border px-3.5 text-sm shadow-xs transition outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60';

interface ControlProps {
  id: string;
  'aria-describedby': string | undefined;
}

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <label htmlFor={id} className="text-sm leading-none font-medium">
        {label}
      </label>
      {children({ id, 'aria-describedby': hint === undefined ? undefined : hintId })}
      {hint === undefined ? null : (
        <span id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </span>
      )}
    </div>
  );
}

export function SelectControl({
  children,
  ...props
}: React.ComponentProps<'select'> & { children: ReactNode }) {
  return (
    <div className="relative">
      <select {...props} className={cn(controlClass, 'appearance-none pr-10', props.className)}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
      />
    </div>
  );
}

export function Step({
  number,
  title,
  description,
  aside,
  children,
}: {
  number: number;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 p-4 sm:p-6">
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold"
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-7 font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {aside}
      </header>
      <div className="grid gap-4 sm:pl-10">{children}</div>
    </section>
  );
}
