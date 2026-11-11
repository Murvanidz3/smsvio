import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/components/auth/token-forms';

export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
