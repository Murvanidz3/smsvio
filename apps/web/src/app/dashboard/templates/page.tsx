'use client';

import {
  saveTemplateSchema,
  TEMPLATE_CATEGORIES,
  TEMPLATE_JSON_EXAMPLE,
  TEMPLATE_STATUSES,
} from '@smsvio/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/catalog/confirm';
import { PageSize, Pager, showing } from '@/components/catalog/table-tools';
import { useCanMessage } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { catalogApi, type TemplateDraft, type TemplateItem } from '@/lib/catalog';

export default function TemplatesPage() {
  const canMessage = useCanMessage();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TemplateItem | null>(null);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
    ...(status === '' ? {} : { status }),
    ...(category === '' ? {} : { category }),
  });
  const list = useQuery({
    queryKey: ['templates', query.toString()],
    queryFn: () => catalogApi.templates(`?${query.toString()}`),
  });
  const gallery = useQuery({
    queryKey: ['template-gallery'],
    queryFn: () => catalogApi.gallery(),
    enabled: galleryOpen,
  });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function act(work: () => Promise<TemplateItem | { message: string }>, done: string) {
    setBusy(true);
    try {
      const result = await work();
      toast('message' in result ? result.message : done);
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['templates'] });
      if ('id' in result) {
        router.push(`/dashboard/templates/${result.id}`);
      }
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Drafts stay private until they are approved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageSize
            value={pageSize}
            onChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
          {canMessage ? (
            <>
              <Button asChild>
                <Link href="/dashboard/templates/new">From scratch</Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setGalleryOpen(true);
                }}
              >
                Gallery
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setJsonOpen(true);
                }}
              >
                JSON
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="grid min-w-48 flex-1 gap-1 text-sm font-medium">
          Search
          <input
            className="border-input bg-background h-9 rounded-lg border px-3 font-normal"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <Filter
          label="Status"
          value={status}
          options={TEMPLATE_STATUSES}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <Filter
          label="Category"
          value={category}
          options={TEMPLATE_CATEGORIES}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
      </div>
      {list.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="bg-muted h-36 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-2xl border p-6">
          <p className="font-medium">No templates yet</p>
          <p className="text-muted-foreground text-sm">
            Start from a blank message, a sample, or a JSON definition.
          </p>
          {canMessage ? (
            <Button asChild>
              <Link href="/dashboard/templates/new">From scratch</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <article key={row.id} className="bg-card grid gap-3 rounded-2xl border p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{row.name}</h2>
                <span className="bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
                  {row.status}
                </span>
              </div>
              <p className="text-muted-foreground text-sm">{row.category}</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href={`/dashboard/templates/${row.id}`}>View</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href={`/dashboard/templates/${row.id}/analytics`}>Analytics</Link>
                </Button>
                {canMessage ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        void act(() => catalogApi.duplicateTemplate(row.id), 'Template copied.');
                      }}
                    >
                      Duplicate
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setPendingDelete(row);
                      }}
                    >
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{showing(total, page, pageSize)}</p>
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
      {galleryOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
          onClick={() => {
            setGalleryOpen(false);
          }}
        >
          <div
            className="bg-popover grid max-h-[80dvh] w-full max-w-2xl gap-3 overflow-auto rounded-xl border p-5"
            role="dialog"
            aria-labelledby="gallery-title"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 id="gallery-title" className="text-lg font-semibold">
              Sample gallery
            </h2>
            {(gallery.data?.items ?? []).map((sample) => (
              <div
                key={sample.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{sample.name}</p>
                  <p className="text-muted-foreground mt-1 text-sm">{sample.body}</p>
                </div>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void act(() => catalogApi.copyGallery(sample.id), 'Draft created.');
                  }}
                >
                  Use
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {jsonOpen ? (
        <JsonImport
          busy={busy}
          onClose={() => {
            setJsonOpen(false);
          }}
          onImport={(text) => {
            void act(async () => {
              const parsed = saveTemplateSchema.safeParse(JSON.parse(text));
              if (!parsed.success) {
                throw new ApiError(
                  400,
                  'validation_error',
                  parsed.error.issues[0]?.message ?? 'Check the definition.',
                );
              }
              return catalogApi.createTemplate(parsed.data satisfies TemplateDraft);
            }, 'Draft created.');
          }}
        />
      ) : null}
      {pendingDelete === null ? null : (
        <ConfirmDialog
          title="Delete template"
          confirmLabel="Delete"
          pending={busy}
          onCancel={() => {
            setPendingDelete(null);
          }}
          onConfirm={() => {
            void act(() => catalogApi.deleteTemplate(pendingDelete.id), 'Template deleted.');
          }}
        >
          {pendingDelete.name} will be removed. Messages already sent keep their record.
        </ConfirmDialog>
      )}
    </section>
  );
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select
        className="border-input bg-background h-9 rounded-lg border px-2 font-normal"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function JsonImport({
  busy,
  onClose,
  onImport,
}: {
  busy: boolean;
  onClose: () => void;
  onImport: (text: string) => void;
}) {
  const [text, setText] = useState(JSON.stringify(TEMPLATE_JSON_EXAMPLE, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onClose}>
      <form
        className="bg-popover grid w-full max-w-lg gap-3 rounded-xl border p-5"
        role="dialog"
        aria-labelledby="json-title"
        onClick={(event) => {
          event.stopPropagation();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          try {
            JSON.parse(text);
            setError(null);
            onImport(text);
          } catch {
            setError('That is not valid JSON.');
          }
        }}
      >
        <h2 id="json-title" className="text-lg font-semibold">
          Import JSON
        </h2>
        <textarea
          aria-label="Template JSON"
          className="border-input bg-background min-h-48 rounded-lg border p-3 font-mono text-xs"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        {error === null ? null : <p className="text-destructive text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" disabled={busy}>
            Create draft
          </Button>
        </div>
      </form>
    </div>
  );
}
