import type { Metadata } from 'next';
import { Suspense } from 'react';

import { VerifyEmailForm } from '@/components/auth/token-forms';

export const metadata: Metadata = {
  title: 'Confirm email',
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
