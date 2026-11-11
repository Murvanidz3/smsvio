import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Shell } from '@/components/shell/shell';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
