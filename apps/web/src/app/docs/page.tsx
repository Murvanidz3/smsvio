import { WEBHOOK_SIGNATURE_GUIDE, openApiOperations } from '@smsvio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'API reference',
  description: 'SMSVIO public API reference, code samples, and webhook signature verification.',
};

export default function DocsPage() {
  const operations = openApiOperations();
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/signin" aria-label="SMSVIO home">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link className="text-sm underline" href="/signin">
            Sign in
          </Link>
        </div>
      </header>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">API reference</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Authenticate with <code className="font-mono">x-api-key</code> or{' '}
          <code className="font-mono">Authorization: Bearer</code>. Timestamps are ISO 8601 UTC.
          Errors use RFC 9457 problem details. The machine-readable document is{' '}
          <a className="underline" href="/api/v1/openapi.json">
            /api/v1/openapi.json
          </a>
          .
        </p>
      </div>
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Verify a webhook signature</h2>
        <p className="text-sm leading-6">{WEBHOOK_SIGNATURE_GUIDE}</p>
      </section>
      <div className="grid gap-8">
        {operations.map((operation) => (
          <article
            key={`${operation.method} ${operation.path}`}
            className="border-border grid gap-3 rounded-xl border p-4"
          >
            <h2 className="text-lg font-semibold">
              <span className="font-mono text-sm tracking-wide uppercase">{operation.method}</span>{' '}
              <span className="font-mono text-sm">{operation.path}</span>
            </h2>
            <p className="text-muted-foreground text-sm">
              {operation.summary} Returns HTTP {operation.status}.
            </p>
            <div className="grid gap-3">
              <Sample title="cURL" code={operation.samples.curl} />
              <Sample title="Node" code={operation.samples.node} />
              <Sample title="Python" code={operation.samples.python} />
              <Sample title="PHP" code={operation.samples.php} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Sample({ title, code }: { title: string; code: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <pre className="bg-muted mt-2 overflow-x-auto rounded-lg p-3 font-mono text-xs leading-5">
        {code}
      </pre>
    </details>
  );
}
