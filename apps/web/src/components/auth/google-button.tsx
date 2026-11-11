import { Button } from '@/components/ui/button';

export function GoogleButton({ invitation }: { invitation?: string }) {
  const href =
    invitation === undefined
      ? '/api/internal/auth/google/start'
      : `/api/internal/auth/google/start?invitation=${encodeURIComponent(invitation)}`;
  return (
    <Button variant="outline" className="h-10 w-full" asChild>
      <a href={href}>Continue with Google</a>
    </Button>
  );
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: 'Google sign-in is not available right now.',
  google_denied: 'Google sign-in was cancelled.',
  google_email_unverified: 'That Google account has not verified its email.',
  google_conflict: 'That Google account cannot be linked to this email.',
  invite_email_mismatch: 'Use the Google account for the invited email address.',
  invalid_state: 'That sign-in attempt expired. Try again.',
  invalid_link: 'That invitation link is no longer valid.',
};

export function googleErrorMessage(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  return GOOGLE_ERRORS[code] ?? null;
}
