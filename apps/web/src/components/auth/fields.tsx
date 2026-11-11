'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';

import { ApiError } from '@/lib/api';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby="auth-title"
      className="bg-card text-card-foreground w-full max-w-sm rounded-2xl border p-8 shadow-sm"
    >
      <h1 id="auth-title" className="text-2xl font-bold tracking-tight">
        {title}
      </h1>
      <div className="mt-6 grid gap-4">{children}</div>
    </section>
  );
}

export function TextField({
  label,
  error,
  ...props
}: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <input
        className="border-input bg-background h-10 rounded-lg border px-3 text-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        {...props}
      />
      {error === undefined ? null : (
        <span className="text-destructive text-xs font-normal">{error}</span>
      )}
    </label>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!(error instanceof ApiError) || Object.keys(error.fields).length > 0) {
    return null;
  }
  return (
    <p role="alert" className="text-destructive text-sm">
      {error.message}
    </p>
  );
}

export function fieldError(error: unknown, name: string): string | undefined {
  return error instanceof ApiError ? error.fields[name] : undefined;
}
