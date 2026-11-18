import { cn } from 'cn';
import type { ReactNode } from 'react';

import type { MessagePreview } from '@/lib/messages';

function segmentLimit(encoding: string, segments: number): number {
  if (encoding === 'UCS-2') {
    return segments > 1 ? 67 : 70;
  }
  return segments > 1 ? 153 : 160;
}

function Stat({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="bg-muted/60 rounded-xl px-3 py-2.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-base font-semibold tabular-nums',
          loading && 'bg-muted-foreground/20 h-6 w-14 animate-pulse rounded-md text-transparent',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  );
}

export function Summary({
  preview,
  loading,
  recipients,
  templateName,
  senderLabel,
  caption,
}: {
  preview: MessagePreview | undefined;
  loading: boolean;
  recipients: number;
  templateName: string;
  senderLabel: string;
  caption: string;
}) {
  const segments = preview?.segments ?? 0;
  const characters = preview === undefined ? 0 : Array.from(preview.body).length;
  const limit = preview === undefined ? 0 : segmentLimit(preview.encoding, segments);
  const dash = '\u2014';
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Encoding" value={preview?.encoding ?? dash} loading={loading} />
        <Stat
          label={segments === 1 ? 'Segment' : 'Segments'}
          value={preview === undefined ? dash : String(segments)}
          loading={loading}
        />
        <Stat
          label="Cost (USD)"
          value={preview === undefined ? dash : preview.price.display}
          loading={loading}
        />
      </dl>
      {preview === undefined ? null : (
        <div className="grid gap-1.5">
          <div
            role="img"
            aria-label={`${String(segments)} of up to 10 segments`}
            className="flex gap-1"
          >
            {Array.from({ length: Math.min(Math.max(segments, 1), 10) }, (_, index) => (
              <span key={index} className="bg-primary h-1.5 flex-1 rounded-full" />
            ))}
          </div>
          <p className="text-muted-foreground text-xs tabular-nums">
            {String(characters)} {characters === 1 ? 'character' : 'characters'} · up to{' '}
            {String(limit)} per segment
          </p>
        </div>
      )}
      <dl className="divide-y border-t">
        <Row label="Recipients" value={String(recipients)} />
        <Row label="Template" value={templateName === '' ? dash : templateName} />
        <Row label="From" value={preview?.from ?? (senderLabel === '' ? dash : senderLabel)} />
        <Row label="Country" value={preview?.countryIso2 ?? dash} />
      </dl>
      <p className="text-muted-foreground text-xs">{caption}</p>
    </div>
  );
}
