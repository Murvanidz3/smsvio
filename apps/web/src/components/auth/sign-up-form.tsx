'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type SubmitEvent, useState } from 'react';

import { AuthCard, fieldError, FormError, TextField } from '@/components/auth/fields';
import { GoogleButton } from '@/components/auth/google-button';
import { Button } from '@/components/ui/button';
import { accountApi } from '@/lib/api';

export function SignUpForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => accountApi.config() });

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await accountApi.signUp({ name, email, password, organizationName });
      setMessage(result.message);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  if (config.data?.emailMode === 'disabled') {
    return (
      <AuthCard title="Create your account">
        {config.data.google ? <GoogleButton /> : null}
        <p className="text-muted-foreground text-sm">Email registration is coming soon.</p>
        <p className="text-muted-foreground text-sm">
          Already have an account?{' '}
          <Link className="text-primary underline-offset-4 hover:underline" href="/signin">
            Sign in
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account">
      {config.data?.google === true ? <GoogleButton /> : null}
      {message === null ? (
        <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
          <TextField
            label="Your name"
            autoComplete="name"
            required
            value={name}
            error={fieldError(error, 'name')}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            error={fieldError(error, 'email')}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            error={fieldError(error, 'password')}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <TextField
            label="Organization"
            autoComplete="organization"
            required
            value={organizationName}
            error={fieldError(error, 'organizationName')}
            onChange={(event) => {
              setOrganizationName(event.target.value);
            }}
          />
          <FormError error={error} />
          <Button type="submit" className="h-10" disabled={pending}>
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      ) : (
        <p className="text-sm">{message}</p>
      )}
      <p className="text-muted-foreground text-sm">
        Already have an account?{' '}
        <Link className="text-primary underline-offset-4 hover:underline" href="/signin">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
