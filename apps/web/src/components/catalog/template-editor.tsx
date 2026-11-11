'use client';

import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_JSON_EXAMPLE,
  TEMPLATE_LANGUAGES,
  checkTemplate,
  previewTemplate,
  type TemplateCategory,
} from '@smsvio/shared';
import { type ReactNode, useRef, useState } from 'react';

import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
type Panel = 'preview' | 'checks' | 'api';

export function TemplateEditor({
  templateId,
  name,
  category,
  language,
  body,
  samples,
  status,
  saving,
  smartEncoding,
  onChange,
  locked = false,
  onSave,
  onSubmit,
}: {
  templateId?: string;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  samples: Record<string, string>;
  status?: string;
  saving: boolean;
  smartEncoding: boolean;
  onChange: (next: {
    name: string;
    category: TemplateCategory;
    language: string;
    body: string;
    samples: Record<string, string>;
  }) => void;
  locked?: boolean;
  onSave: () => void;
  onSubmit?: () => void;
}) {
  const toast = useToast();
  const area = useRef<HTMLTextAreaElement>(null);
  const [panel, setPanel] = useState<Panel>('preview');
  const [variable, setVariable] = useState('name');
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const checked = checkTemplate({ body, category, samples, smartEncoding });
  const preview = previewTemplate(body, samples);
  const languages = TEMPLATE_LANGUAGES.some((item) => item.code === language)
    ? TEMPLATE_LANGUAGES
    : [...TEMPLATE_LANGUAGES, { code: language, label: language }];

  function editBody(next: string, remember: boolean) {
    if (remember) {
      setPast((current) => [...current, body].slice(-80));
      setFuture([]);
    }
    onChange({ name, category, language, body: next, samples });
  }

  function undo() {
    const previous = past.at(-1);
    if (previous === undefined) {
      return;
    }
    setPast((current) => current.slice(0, -1));
    setFuture((current) => [body, ...current]);
    onChange({ name, category, language, body: previous, samples });
  }

  function redo() {
    const next = future[0];
    if (next === undefined) {
      return;
    }
    setFuture((current) => current.slice(1));
    setPast((current) => [...current, body]);
    onChange({ name, category, language, body: next, samples });
  }

  function insertVariable() {
    if (!/^[a-z0-9_]+$/.test(variable)) {
      toast('Variable names use lowercase letters, numbers, and underscores.');
      return;
    }
    const token = `{{${variable}}}`;
    const element = area.current;
    if (element === null) {
      editBody(`${body}${token}`, true);
      return;
    }
    const start = element.selectionStart;
    const end = element.selectionEnd;
    editBody(`${body.slice(0, start)}${token}${body.slice(end)}`, true);
  }

  const snippetBody = JSON.stringify(
    {
      template_id: templateId ?? 'TEMPLATE_ID',
      to: '+14155552671',
      variables: samples,
    },
    null,
    2,
  );
  const origin = typeof window === 'undefined' ? 'https://smsvio.com' : window.location.origin;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-48 flex-1 gap-1 text-sm font-medium">
            Name
            <input
              className="border-input bg-background h-9 rounded-lg border px-3 font-normal"
              placeholder="Generated from the message when blank"
              value={name}
              onChange={(event) => {
                onChange({ name: event.target.value, category, language, body, samples });
              }}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Category
            <select
              className="border-input bg-background h-9 rounded-lg border px-2 font-normal"
              value={category}
              onChange={(event) => {
                onChange({
                  name,
                  category: event.target.value as TemplateCategory,
                  language,
                  body,
                  samples,
                });
              }}
            >
              {TEMPLATE_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Language
            <select
              className="border-input bg-background h-9 rounded-lg border px-2 font-normal"
              value={language}
              onChange={(event) => {
                onChange({ name, category, language: event.target.value, body, samples });
              }}
            >
              {languages.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {status === undefined ? null : <StatusBadge status={status} />}
        </div>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={past.length === 0} onClick={undo}>
              Undo
            </Button>
            <Button type="button" variant="outline" disabled={future.length === 0} onClick={redo}>
              Redo
            </Button>
            <label className="sr-only" htmlFor="variable-name">
              Variable name
            </label>
            <input
              id="variable-name"
              className="border-input bg-background h-8 w-28 rounded-lg border px-2 text-sm"
              value={variable}
              onChange={(event) => {
                setVariable(event.target.value);
              }}
            />
            <Button type="button" variant="outline" onClick={insertVariable}>
              Add variable
            </Button>
          </div>
          <textarea
            ref={area}
            aria-label="Message"
            className="border-input bg-background min-h-40 rounded-xl border p-3 font-mono text-sm"
            value={body}
            onChange={(event) => {
              editBody(event.target.value, true);
            }}
          />
          <p className="text-muted-foreground text-sm">
            {checked.analysis.encoding} · {checked.analysis.unitsLeft} left in this segment ·{' '}
            {checked.analysis.segmentCount}{' '}
            {checked.analysis.segmentCount === 1 ? 'segment' : 'segments'}
            {smartEncoding ? ' · smart encoding on' : ''}
            {checked.analysis.tooLong ? ' · over the 10 segment limit' : ''}
          </p>
        </div>
        {checked.variables.length === 0 ? null : (
          <div className="grid gap-2 sm:grid-cols-2">
            {checked.variables.map((item) => (
              <label key={item} className="grid gap-1 text-sm font-medium">
                Sample for {item}
                <input
                  className="border-input bg-background h-9 rounded-lg border px-3 font-normal"
                  value={samples[item] ?? ''}
                  onChange={(event) => {
                    onChange({
                      name,
                      category,
                      language,
                      body,
                      samples: { ...samples, [item]: event.target.value },
                    });
                  }}
                />
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={locked || saving || body.length === 0} onClick={onSave}>
            Save draft
          </Button>
          {onSubmit === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={locked || saving || checked.analysis.tooLong}
              onClick={onSubmit}
            >
              Submit for review
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Example definition: <code>{JSON.stringify(TEMPLATE_JSON_EXAMPLE)}</code>
        </p>
      </div>
      <section className="bg-card grid h-fit gap-3 rounded-2xl border p-4">
        <div className="flex gap-1" role="tablist" aria-label="Template tools">
          {(
            [
              ['preview', 'Preview'],
              ['checks', 'Checks'],
              ['api', 'API'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={panel === id}
              className={`rounded-lg px-3 py-1 text-sm font-medium ${panel === id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
              onClick={() => {
                setPanel(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {panel === 'preview' ? <PhonePreview text={preview} /> : null}
        {panel === 'checks' ? <Checks body={body} checked={checked} /> : null}
        {panel === 'api' ? (
          <ApiSnippets
            origin={origin}
            body={snippetBody}
            onCopy={(text) => {
              copy(text, toast);
            }}
          />
        ) : null}
      </section>
    </div>
  );
}

function Checks({ body, checked }: { body: string; checked: ReturnType<typeof checkTemplate> }) {
  const unicode = new Set(
    checked.analysis.characters
      .filter((flag) => flag.effect === 'unicode')
      .map((flag) => flag.index),
  );
  return (
    <div className="grid gap-3 text-sm">
      <p>
        {checked.analysis.tooLong
          ? 'This message is longer than 10 segments, so it cannot be submitted.'
          : `${String(checked.analysis.segmentCount)} segment${checked.analysis.segmentCount === 1 ? '' : 's'} with the sample values.`}
      </p>
      {checked.optOutMissing ? (
        <p>Marketing messages need an opt-out, such as “Reply STOP to opt out”.</p>
      ) : null}
      {checked.missingSamples.length > 0 ? (
        <p>Add samples for {checked.missingSamples.join(', ')}.</p>
      ) : null}
      {checked.analysis.replacements.length > 0 ? (
        <p>
          Smart encoding will replace{' '}
          {checked.analysis.replacements.map((item) => item.from).join(' ')}.
        </p>
      ) : null}
      <p className="bg-muted rounded-lg p-3 leading-6 break-words whitespace-pre-wrap">
        {marked(body, unicode)}
      </p>
    </div>
  );
}

function marked(text: string, indexes: ReadonlySet<number>): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const index of [...indexes].sort((left, right) => left - right)) {
    if (index < cursor) {
      continue;
    }
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    const width = text.charCodeAt(index) >= 0xd800 && text.charCodeAt(index) <= 0xdbff ? 2 : 1;
    nodes.push(
      <mark key={index} className="bg-accent text-accent-foreground rounded-sm px-0.5">
        {text.slice(index, index + width)}
      </mark>,
    );
    cursor = index + width;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function PhonePreview({ text }: { text: string }) {
  return (
    <div className="bg-muted mx-auto w-full max-w-56 rounded-[1.75rem] border p-3">
      <div className="bg-background min-h-36 rounded-2xl p-3 text-sm leading-6 break-words whitespace-pre-wrap">
        {text === '' ? 'The preview appears here.' : text}
      </div>
    </div>
  );
}

function ApiSnippets({
  origin,
  body,
  onCopy,
}: {
  origin: string;
  body: string;
  onCopy: (text: string) => void;
}) {
  const curl = `curl -X POST ${origin}/api/v1/messages \\\n  -H "Authorization: Bearer $SMSVIO_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
  const node = `await fetch(${JSON.stringify(`${origin}/api/v1/messages`)}, {\n  method: 'POST',\n  headers: {\n    authorization: \`Bearer \${process.env.SMSVIO_API_KEY}\`,\n    'content-type': 'application/json',\n  },\n  body: JSON.stringify(${body}),\n});`;
  const python = `import json, os, urllib.request\nrequest = urllib.request.Request(\n    ${JSON.stringify(`${origin}/api/v1/messages`)},\n    data=json.dumps(${body}).encode(),\n    headers={\n        'Authorization': f'Bearer {os.environ["SMSVIO_API_KEY"]}',\n        'Content-Type': 'application/json',\n    },\n)\nurllib.request.urlopen(request)`;
  return (
    <div className="grid gap-3">
      {(
        [
          ['cURL', curl],
          ['Node', node],
          ['Python', python],
        ] as const
      ).map(([label, text]) => (
        <div key={label} className="grid gap-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{label}</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onCopy(text);
              }}
            >
              Copy
            </Button>
          </div>
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">{text}</pre>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="bg-accent text-accent-foreground rounded-full px-2 py-1 text-xs font-semibold">
      {status}
    </span>
  );
}

function copy(text: string, toast: (message: string) => void) {
  void navigator.clipboard.writeText(text).then(() => {
    toast('Copied.');
  });
}
