'use client';

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useCanMessage } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { catalogApi } from '@/lib/catalog';
import { messageApi, type MessageDetail } from '@/lib/messages';
import { senderApi } from '@/lib/senders';

const field = 'border-input bg-background h-9 w-full rounded-lg border px-3 text-sm';

export default function SendPage() {
  const canSend = useCanMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ['send-templates'],
    queryFn: () => catalogApi.templates('?status=APPROVED&pageSize=100'),
  });
  const senders = useQuery({ queryKey: ['senders'], queryFn: () => senderApi.overview() });
  const contacts = useQuery({
    queryKey: ['send-contacts'],
    queryFn: () => catalogApi.contacts('?pageSize=50'),
  });
  const [templateId, setTemplateId] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [contactId, setContactId] = useState('');
  const [senderId, setSenderId] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [tracked, setTracked] = useState<string[]>([]);
  const [liveRows, setLiveRows] = useState<MessageDetail[]>([]);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const template = templates.data?.items.find((item) => item.id === templateId);
  const destinations = (senders.data?.destinations ?? []).filter(
    (row) => row.orgCountryId !== null,
  );
  const approvedSenders = (senders.data?.senderIds ?? []).filter((row) => {
    if (row.status !== 'APPROVED') {
      return false;
    }
    return country === '' || row.countries.includes(country);
  });
  const selectedSender = approvedSenders.some((row) => row.id === senderId) ? senderId : '';
  const ready = templateId !== '' && (contactId !== '' || phone.trim() !== '');
  const payload = {
    templateId,
    ...(contactId === ''
      ? { to: phone.trim(), ...(country === '' ? {} : { country }) }
      : { contactId }),
    ...(selectedSender === '' ? {} : { senderId: selectedSender }),
    variables,
  };
  const preview = useQuery({
    queryKey: ['send-preview', payload],
    queryFn: () => messageApi.preview(payload),
    enabled: canSend && ready,
    retry: false,
  });
  const polled = useQueries({
    queries: tracked.map((id) => ({
      queryKey: ['message-poll', id],
      queryFn: () => messageApi.get(id),
      enabled: !live && tracked.length > 0,
      refetchInterval: live ? (false as const) : 2000,
    })),
  });

  useEffect(() => {
    if (!live || tracked.length === 0) {
      return;
    }
    const source = new EventSource(`/api/internal/messages/stream?ids=${tracked.join(',')}`);
    source.onmessage = (event: MessageEvent) => {
      const parsed = JSON.parse(String(event.data)) as MessageDetail[];
      if (Array.isArray(parsed)) {
        setLiveRows(parsed);
      }
    };
    source.onerror = () => {
      source.close();
      setLive(false);
    };
    return () => {
      source.close();
    };
  }, [live, tracked]);

  const activity = live
    ? liveRows
    : polled.flatMap((query) => (query.data === undefined ? [] : [query.data]));

  async function send() {
    setBusy(true);
    try {
      const result = await messageApi.send(payload);
      toast(result.message);
      setTracked((current) => [result.id, ...current].slice(0, 8));
      await queryClient.invalidateQueries({ queryKey: ['message-poll'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not send that message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Send</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            An approved template, a number or a contact, and the sender for that country.
          </p>
        </div>
        <label className="grid gap-1 text-sm">
          Template
          <select
            className={field}
            value={templateId}
            onChange={(event) => {
              setTemplateId(event.target.value);
              setVariables({});
            }}
          >
            <option value="">Choose a template</option>
            {templates.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {(template?.variables ?? []).map((name) => (
          <label key={name} className="grid gap-1 text-sm">
            {name}
            <input
              className={field}
              value={variables[name] ?? ''}
              onChange={(event) => {
                setVariables((current) => ({ ...current, [name]: event.target.value }));
              }}
            />
          </label>
        ))}
        <label className="grid gap-1 text-sm">
          Country
          <select
            className={field}
            value={country}
            onChange={(event) => {
              setCountry(event.target.value);
            }}
          >
            <option value="">Detect from the number</option>
            {destinations.map((row) => (
              <option key={row.iso2} value={row.iso2}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Contact
          <select
            className={field}
            value={contactId}
            onChange={(event) => {
              const id = event.target.value;
              setContactId(id);
              const contact = contacts.data?.items.find((item) => item.id === id);
              if (contact !== undefined) {
                setPhone(contact.phoneE164);
                setCountry(contact.countryCode);
              }
            }}
          >
            <option value="">Type a number instead</option>
            {contacts.data?.items.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name ?? contact.phoneE164}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Phone number
          <input
            className={field}
            value={phone}
            placeholder="+14155552671"
            onChange={(event) => {
              setContactId('');
              setPhone(event.target.value);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Sender
          <select
            className={field}
            value={selectedSender}
            onChange={(event) => {
              setSenderId(event.target.value);
            }}
          >
            <option value="">
              Shared number
              {senders.data?.platformSender === null || senders.data?.platformSender === undefined
                ? ''
                : ` ${senders.data.platformSender.value}`}
            </option>
            {approvedSenders.map((sender) => (
              <option key={sender.id} value={sender.id}>
                {sender.value}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground text-sm">
          {preview.data === undefined
            ? 'Encoding, segments and price appear when the message is ready.'
            : `${preview.data.encoding} · ${String(preview.data.segments)} ${preview.data.segments === 1 ? 'segment' : 'segments'} · ${preview.data.price.display} USD from ${preview.data.from}`}
        </p>
        {preview.error instanceof ApiError ? (
          <p className="text-destructive text-sm">{preview.error.message}</p>
        ) : null}
        <span
          title={canSend ? undefined : 'Only an owner, admin, or developer can send.'}
          className="inline-flex"
        >
          <Button
            type="button"
            disabled={!canSend || busy || !ready || preview.data === undefined}
            style={{ height: '3rem', minWidth: '8rem' }}
            onClick={() => {
              void send();
            }}
          >
            Send
          </Button>
        </span>
      </div>
      <aside className="grid content-start gap-3">
        <h2 className="text-sm font-semibold">Activity</h2>
        <p className="text-muted-foreground text-xs">
          {live ? 'Live updates' : 'Live updates unavailable. Refreshing every few seconds.'}
        </p>
        {activity.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Messages you send from this page show up here.
          </p>
        ) : (
          <ul className="grid gap-2">
            {activity.map((item) => (
              <li key={item.id} className="rounded-xl border px-3 py-2 text-sm">
                <p className="font-medium capitalize">{item.status}</p>
                <p className="text-muted-foreground">{item.to}</p>
                <ol className="mt-2 grid gap-1">
                  {item.events.map((event) => (
                    <li key={`${event.at}-${event.status}`} className="text-muted-foreground">
                      <span className="text-foreground capitalize">{event.status}</span>
                      {event.detail === null ? '' : ` · ${event.detail}`}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </section>
  );
}
