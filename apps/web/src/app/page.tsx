import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@smsvio/shared';

export default async function HomePage() {
  const jar = await cookies();
  redirect(jar.get(SESSION_COOKIE)?.value === undefined ? '/signin' : '/dashboard');
}
