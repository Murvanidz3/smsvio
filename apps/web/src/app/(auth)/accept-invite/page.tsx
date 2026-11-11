import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AcceptInviteForm } from '@/components/auth/token-forms';

export const metadata: Metadata = {
  title: 'Accept invitation',
  robots: { index: false, follow: false },
};

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}
