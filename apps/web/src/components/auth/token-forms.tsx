'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type SubmitEvent, useEffect, useState } from 'react';

import { AuthCard, fieldError, FormError, TextField } from '@/components/auth/fields';
import { GoogleButton } from '@/components/auth/google-button';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';

export function VerifyEmailForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (token.length < 20) {
      return;
    }
    let cancelled = false;
    accountApi
      .verifyEmail(token)
      .then(() => {
        if (!cancelled) {
          router.push('/dashboard');
          router.refresh();
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router, token]);

  return (
    <AuthCard title="Confirm your email">
      {error === null ? (
        <p className="text-sm">Confirming your email address…</p>
      ) : (
        <FormError error={error} />
      )}
      {token.length < 20 ? (
        <p className="text-destructive text-sm">This confirmation link is incomplete.</p>
      ) : null}
    </AuthCard>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setMessage((await accountApi.forgot(email)).message);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Reset your password">
      {message === null ? (
        <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
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
          <FormError error={error} />
          <Button type="submit" className="h-10" disabled={pending}>
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      ) : (
        <p className="text-sm">{message}</p>
      )}
      <Link className="text-primary text-sm underline-offset-4 hover:underline" href="/signin">
        Back to sign in
      </Link>
    </AuthCard>
  );
}

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setMessage((await accountApi.reset(token, password)).message);
      window.setTimeout(() => {
        router.push('/signin');
      }, 800);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Choose a new password">
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          error={fieldError(error, 'password')}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <FormError error={error} />
        <Button type="submit" className="h-10" disabled={pending || token.length < 20}>
          {pending ? 'Saving…' : 'Update password'}
        </Button>
      </form>
      {message === null ? null : <p className="text-sm">{message}</p>}
    </AuthCard>
  );
}

export function AcceptInviteForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<{
    email: string;
    organizationName: string;
    hasAccount: boolean;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => accountApi.config() });

  useEffect(() => {
    if (token.length < 20) {
      return;
    }
    let cancelled = false;
    accountApi
      .previewInvite(token)
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await accountApi.acceptInvite(
        preview?.hasAccount ? { token } : { token, name, password },
      );
      if ('status' in result && result.status === 'sign_in_required') {
        setNotice(`Sign in as ${result.email} to accept this invitation.`);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard title="Accept invitation">
      {preview === null ? (
        <FormError error={error} />
      ) : (
        <div className="grid gap-4">
          <p className="text-sm">
            {preview.organizationName} invited {preview.email}.
          </p>
          {config.data?.google === true ? <GoogleButton invitation={token} /> : null}
          {config.data?.emailMode === 'disabled' && !preview.hasAccount ? (
            <p className="text-muted-foreground text-sm">
              Continue with Google using {preview.email} to accept.
            </p>
          ) : (
            <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
              {preview.hasAccount || config.data?.emailMode === 'disabled' ? null : (
                <>
                  <TextField
                    label="Your name"
                    required
                    value={name}
                    error={fieldError(error, 'name')}
                    onChange={(event) => {
                      setName(event.target.value);
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
                </>
              )}
              <FormError error={error} />
              {notice === null ? null : <p className="text-sm">{notice}</p>}
              <Button type="submit" className="h-10" disabled={pending}>
                {pending ? 'Joining…' : 'Accept invitation'}
              </Button>
            </form>
          )}
        </div>
      )}
    </AuthCard>
  );
}
