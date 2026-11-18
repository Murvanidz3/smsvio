import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useId } from 'react';

export const controlClass =
  'border-input bg-field text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 h-11 w-full rounded-full border pr-4 pl-4 text-sm transition outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60';

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
    <div className={cn('grid content-start gap-2', className)}>
      <label htmlFor={id} className="text-muted-foreground px-1 text-sm font-medium">
        {label}
      </label>
      {children({ id, 'aria-describedby': hint === undefined ? undefined : hintId })}
      {hint === undefined ? null : (
        <span id={hintId} className="text-muted-foreground px-1 text-xs">
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
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2"
      />
    </div>
  );
}

export function Step({
  icon: Icon,
  tone,
  title,
  description,
  aside,
  children,
}: {
  icon: LucideIcon;
  tone: string;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-card grid gap-5 rounded-2xl border p-5 sm:p-6">
      <header className="flex items-center gap-3">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', tone)}>
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-6 font-bold tracking-tight">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {aside}
      </header>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}
