'use client';

import { safeNextPath } from '@smsvio/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';

import { AuthCard, fieldError, FormError, TextField } from '@/components/auth/fields';
import { GoogleButton, googleErrorMessage } from '@/components/auth/google-button';
import { Button } from '@/components/ui/button';
import { accountApi } from '@/lib/api';

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => accountApi.config() });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(params.get('totp') === '1' ? '' : null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  function goNext() {
    router.push(safeNextPath(params.get('next')) ?? '/dashboard');
    router.refresh();
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (challenge === null) {
        const result = await accountApi.signIn({ email, password });
        if ('challenge' in result) {
          setChallenge(result.challenge);
          return;
        }
      } else {
        await accountApi.totp(challenge === '' ? { code } : { challenge, code });
      }
      goNext();
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  const googleError = googleErrorMessage(params.get('error'));
  const emailDisabled = config.data?.emailMode === 'disabled';

  return (
    <AuthCard title="Sign in to SMSVIO">
      {googleError === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {googleError}
        </p>
      )}
      {config.data?.google === true && challenge === null ? <GoogleButton /> : null}
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
        {challenge === null ? (
          <>
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
              autoComplete="current-password"
              required
              value={password}
              error={fieldError(error, 'password')}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </>
        ) : (
          <TextField
            label="Authentication code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            error={fieldError(error, 'code')}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
        )}
        <FormError error={error} />
        <Button type="submit" className="h-10" disabled={pending}>
          {pending ? 'Signing in…' : challenge === null ? 'Sign in' : 'Confirm code'}
        </Button>
      </form>
      {emailDisabled ? (
        <p className="text-muted-foreground text-sm">Email registration is coming soon.</p>
      ) : (
        <p className="text-muted-foreground text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" href="/forgot-password">
            Forgot your password?
          </Link>
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        New to SMSVIO?{' '}
        <Link className="text-primary underline-offset-4 hover:underline" href="/signup">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
