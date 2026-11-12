'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { PageSize, Pager, showing } from '@/components/catalog/table-tools';
import { Button } from '@/components/ui/button';
import { catalogApi } from '@/lib/catalog';
import { messageApi, type MessageDetail } from '@/lib/messages';

const field = 'border-input bg-background h-9 rounded-lg border px-3 text-sm';

export default function MessagesPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [country, setCountry] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const templates = useQuery({
    queryKey: ['message-templates'],
    queryFn: () => catalogApi.templates('?pageSize=100'),
  });
  const keyId = /^[0-9a-f-]{36}$/i.test(apiKeyId) ? apiKeyId : '';
  const query = new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
    ...(status === '' ? {} : { status }),
    ...(direction === '' ? {} : { direction }),
    ...(country.length === 2 ? { country: country.toUpperCase() } : {}),
    ...(templateId === '' ? {} : { templateId }),
    ...(keyId === '' ? {} : { apiKeyId: keyId }),
    ...(from === '' ? {} : { from }),
    ...(to === '' ? {} : { to }),
  });
  const list = useQuery({
    queryKey: ['messages', query.toString()],
    queryFn: () => messageApi.list(`?${query.toString()}`),
  });
  const detail = useQuery({
    queryKey: ['message', openId],
    queryFn: () => messageApi.get(openId ?? ''),
    enabled: openId !== null,
  });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  async function download() {
    setNotice('');
    const response = await fetch(`/api/internal/messages/export?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.status === 202) {
      const payload = (await response.json()) as { message?: string };
      setNotice(payload.message ?? 'We emailed the download link.');
      return;
    }
    if (!response.ok) {
      setNotice('Could not export those messages.');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'messages.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Every message this organization has queued.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void download();
          }}
        >
          Download CSV
        </Button>
      </div>
      {notice === '' ? null : <p className="text-sm">{notice}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Search
          <input
            className={`${field} w-56`}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Status
          <select
            className={field}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Any</option>
            {['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'UNDELIVERED', 'EXPIRED', 'FAILED'].map(
              (value) => (
                <option key={value} value={value}>
                  {value.toLowerCase()}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Direction
          <select
            className={field}
            value={direction}
            onChange={(event) => {
              setDirection(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Any</option>
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Country
          <input
            className={`${field} w-24 uppercase`}
            maxLength={2}
            value={country}
            placeholder="DE"
            onChange={(event) => {
              setCountry(event.target.value.toUpperCase());
              setPage(1);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          From
          <input
            className={field}
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <input
            className={field}
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Template
          <select
            className={field}
            value={templateId}
            onChange={(event) => {
              setTemplateId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Any</option>
            {templates.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          API key
          <input
            className={`${field} w-72 font-mono`}
            value={apiKeyId}
            placeholder="Key id"
            onChange={(event) => {
              setApiKeyId(event.target.value.trim());
              setPage(1);
            }}
          />
        </label>
        <p className="text-muted-foreground text-sm">{showing(total, page, pageSize)}</p>
        <PageSize
          value={pageSize}
          onChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Recipient</th>
              <th className="px-3 py-2 font-medium">Sender</th>
              <th className="px-3 py-2 font-medium">Template</th>
              <th className="px-3 py-2 font-medium">Direction</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Segments</th>
              <th className="px-3 py-2 font-medium">Sent</th>
              <th className="px-3 py-2 font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="text-muted-foreground px-3 py-8" colSpan={9}>
                  No messages yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-muted/40 cursor-pointer border-t"
                  onClick={() => {
                    setOpenId(row.id);
                  }}
                >
                  <td className="px-3 py-2 font-mono">
                    <span title={row.id}>{row.shortId}</span>
                    <button
                      type="button"
                      className="text-muted-foreground ml-2 underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        void navigator.clipboard.writeText(row.shortId);
                      }}
                    >
                      Copy
                    </button>
                  </td>
                  <td className="px-3 py-2">{row.to}</td>
                  <td className="px-3 py-2">{row.from}</td>
                  <td className="px-3 py-2">{row.templateName ?? '—'}</td>
                  <td className="px-3 py-2 capitalize">{row.direction.toLowerCase()}</td>
                  <td className="px-3 py-2 capitalize">{row.status}</td>
                  <td className="px-3 py-2">{row.segments}</td>
                  <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{row.price.display} USD</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
      {openId !== null && detail.data !== undefined
        ? createPortal(
            <MessageDialog
              message={detail.data}
              onClose={() => {
                setOpenId(null);
              }}
            />,
            document.body,
          )
        : null}
    </section>
  );
}

function MessageDialog({ message, onClose }: { message: MessageDetail; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="message-title"
      className="bg-popover m-auto w-[min(100%-2rem,32rem)] rounded-xl border p-5 backdrop:bg-black/40"
      onClose={onClose}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="message-title" className="font-mono text-sm break-all">
          {message.id}
        </h2>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(message.id);
          }}
        >
          Copy
        </Button>
      </div>
      <div className="bg-muted mt-4 max-w-xs rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap">
        {message.body}
      </div>
      <dl className="mt-4 grid gap-1 text-sm">
        <div>Status: {message.status.toLowerCase()}</div>
        <div>Price: {message.price.display} USD</div>
        <div>
          Destination: {message.countryIso2 ?? '—'}
          {message.mccmnc === null ? '' : ` · ${message.mccmnc}`}
        </div>
        <div>Direction: {message.direction.toLowerCase()}</div>
        <div>
          Template: {message.templateName ?? '—'}
          {message.templateCategory === null ? '' : ` · ${message.templateCategory.toLowerCase()}`}
        </div>
        {message.errorCode === null ? null : (
          <div>
            {message.errorCode}
            {message.error === null ? '' : ` — ${message.error}`}
          </div>
        )}
      </dl>
      <ol className="mt-4 grid gap-2 text-sm">
        {message.events.map((event) => (
          <li key={`${event.at}-${event.status}`}>
            <span className="capitalize">{event.status}</span>
            <span className="text-muted-foreground">
              {' '}
              · {event.detail ?? 'Recorded'} · {new Date(event.at).toLocaleString()}
            </span>
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" className="mt-5" onClick={onClose}>
        Close
      </Button>
    </dialog>
  );
}
