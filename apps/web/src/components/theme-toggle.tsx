'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';

export function ThemeToggle({ variant = 'icon' }: { variant?: 'icon' | 'switch' }) {
  const { resolvedTheme, setTheme } = useTheme();

  function toggle() {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }

  if (variant === 'switch') {
    return (
      <button
        type="button"
        aria-label="Toggle colour theme"
        data-testid="theme-toggle"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/40 flex w-full items-center justify-between gap-3 rounded-full px-3 py-2 text-[15px] font-medium outline-none focus-visible:ring-3"
        onClick={toggle}
      >
        <span className="inline-flex items-center gap-2">
          <Sun className="hidden size-4 dark:block" aria-hidden />
          <Moon className="size-4 dark:hidden" aria-hidden />
          <span className="dark:hidden">Light mode</span>
          <span className="hidden dark:inline">Dark mode</span>
        </span>
        <span
          aria-hidden
          className="bg-border dark:bg-primary relative h-[22px] w-10 shrink-0 rounded-full transition-colors"
        >
          <span className="bg-card absolute top-0.5 left-0.5 size-[18px] rounded-full shadow-sm transition-transform dark:translate-x-[18px] dark:bg-black" />
        </span>
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Toggle colour theme"
      data-testid="theme-toggle"
      onClick={toggle}
    >
      <Sun className="hidden size-4 dark:block" aria-hidden />
      <Moon className="size-4 dark:hidden" aria-hidden />
    </Button>
  );
}
