import { cn } from 'cn';
import type { ReactNode } from 'react';

import type { MessagePreview } from '@/lib/messages';

const DASH = '\u2014';

function segmentLimit(encoding: string, segments: number): number {
  if (encoding === 'UCS-2') {
    return segments > 1 ? 67 : 70;
  }
  return segments > 1 ? 153 : 160;
}

function Tile({
  label,
  value,
  note,
  tone,
  loading,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  loading: boolean;
}) {
  return (
    <div className={cn('rounded-2xl p-5', tone)}>
      <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
      <dd
        className={cn(
          'text-foreground mt-2 truncate text-3xl font-bold tracking-tight tabular-nums',
          loading && 'bg-foreground/10 h-9 w-20 animate-pulse rounded-lg text-transparent',
        )}
      >
        {value}
      </dd>
      <p className="text-muted-foreground mt-1 truncate text-xs">{note}</p>
    </div>
  );
}

export function Tiles({
  preview,
  loading,
  recipients,
}: {
  preview: MessagePreview | undefined;
  loading: boolean;
  recipients: number;
}) {
  const segments = preview?.segments ?? 0;
  const characters = preview === undefined ? 0 : Array.from(preview.body).length;
  const limit = preview === undefined ? 0 : segmentLimit(preview.encoding, segments);
  const unicode = preview?.encoding === 'UCS-2';
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Recipients"
        value={String(recipients)}
        note={recipients === 0 ? 'Add a number or contact' : 'One message per send'}
        tone="bg-teal"
        loading={false}
      />
      <Tile
        label="Encoding"
        value={preview?.encoding ?? DASH}
        note={
          preview === undefined
            ? 'Known once ready'
            : unicode
              ? 'Unicode, shorter segments'
              : 'Standard characters'
        }
        tone="bg-mint"
        loading={loading}
      />
      <Tile
        label={segments === 1 ? 'Segment' : 'Segments'}
        value={preview === undefined ? DASH : String(segments)}
        note={preview === undefined ? 'Known once ready' : `Up to ${String(limit)} characters each`}
        tone="bg-lavender"
        loading={loading}
      />
      <Tile
        label="Characters"
        value={preview === undefined ? DASH : String(characters)}
        note={
          preview === undefined
            ? 'Known once ready'
            : `${String(Math.max(0, limit * segments - characters))} left in this segment count`
        }
        tone="bg-peach"
        loading={loading}
      />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right font-semibold">{value}</dd>
    </div>
  );
}

export function Details({
  preview,
  templateName,
  senderLabel,
}: {
  preview: MessagePreview | undefined;
  templateName: string;
  senderLabel: string;
}) {
  return (
    <dl className="divide-y border-t">
      <Row label="Template" value={templateName === '' ? DASH : templateName} />
      <Row label="From" value={preview?.from ?? (senderLabel === '' ? DASH : senderLabel)} />
      <Row label="Country" value={preview?.countryIso2 ?? DASH} />
    </dl>
  );
}
