'use client';

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, MessageSquareText, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Activity } from '@/components/send/activity';
import { controlClass, Field, SelectControl, Step } from '@/components/send/form';
import { Hero } from '@/components/send/hero';
import { PhonePreview } from '@/components/send/phone-preview';
import { Details, Tiles } from '@/components/send/summary';
import { useCanMessage } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { ApiError } from '@/lib/api';
import { catalogApi } from '@/lib/catalog';
import { messageApi, type MessageDetail } from '@/lib/messages';
import { senderApi } from '@/lib/senders';

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
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
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
    setOutcome(null);
    try {
      const result = await messageApi.send(payload);
      toast(result.message);
      setOutcome({ ok: true, text: result.message });
      setTracked((current) => [result.id, ...current].slice(0, 8));
      await queryClient.invalidateQueries({ queryKey: ['message-poll'] });
    } catch (error) {
      const text = error instanceof ApiError ? error.message : 'Could not send that message.';
      toast(text);
      setOutcome({ ok: false, text });
    } finally {
      setBusy(false);
    }
  }

  const recipientLabel =
    contactId === ''
      ? phone.trim()
      : (contacts.data?.items.find((item) => item.id === contactId)?.name ?? phone.trim());
  const recipients = phone.trim() === '' && contactId === '' ? 0 : 1;
  const senderValue =
    approvedSenders.find((row) => row.id === selectedSender)?.value ??
    senders.data?.platformSender?.value ??
    '';
  const previewing = canSend && ready && preview.isFetching;
  const caption =
    preview.data === undefined
      ? 'Encoding, segments and price appear when the message is ready.'
      : `${preview.data.encoding} · ${String(preview.data.segments)} ${preview.data.segments === 1 ? 'segment' : 'segments'} · ${preview.data.price.display} USD from ${preview.data.from}`;
  const disabled = !canSend || busy || !ready || preview.data === undefined;
  let blocker = '';
  if (!canSend) {
    blocker = 'Only an owner, admin, or developer can send.';
  } else if (templateId === '') {
    blocker = 'Choose a template to start.';
  } else if (!ready) {
    blocker = 'Add a phone number or pick a contact.';
  } else if (preview.error instanceof ApiError) {
    blocker = 'Fix the issue below to send.';
  } else if (preview.data === undefined) {
    blocker = 'Checking the message…';
  }

  return (
    <section className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Send</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            An approved template, a number or a contact, and the sender for that country.
          </p>
        </div>
        {canSend ? null : (
          <span className="bg-muted text-muted-foreground rounded-full px-4 py-1.5 text-xs font-medium">
            View only
          </span>
        )}
      </header>
      <Hero
        cost={preview.data?.price.display}
        caption={caption}
        segments={preview.data?.segments ?? 0}
        blocker={blocker}
        canSend={canSend}
        disabled={disabled}
        busy={busy}
        outcome={outcome}
        onSend={() => {
          void send();
        }}
      />
      {preview.error instanceof ApiError ? (
        <p className="text-destructive bg-peach rounded-2xl px-5 py-3 text-sm font-medium">
          {preview.error.message}
        </p>
      ) : null}
      <Tiles preview={preview.data} loading={previewing} recipients={recipients} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-4">
          <Step
            icon={MessageSquareText}
            tone="bg-lavender text-lavender-foreground"
            title="Message"
            description="Pick an approved template and fill in its variables."
          >
            <Field label="Template">
              {(props) => (
                <SelectControl
                  {...props}
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
                </SelectControl>
              )}
            </Field>
            {(template?.variables ?? []).length === 0 ? null : (
              <div className="grid gap-4 sm:grid-cols-2">
                {(template?.variables ?? []).map((name) => (
                  <Field key={name} label={name}>
                    {(props) => (
                      <input
                        {...props}
                        className={controlClass}
                        value={variables[name] ?? ''}
                        onChange={(event) => {
                          setVariables((current) => ({ ...current, [name]: event.target.value }));
                        }}
                      />
                    )}
                  </Field>
                ))}
              </div>
            )}
          </Step>
          <Step
            icon={UserRound}
            tone="bg-mint text-mint-foreground"
            title="Recipient"
            description="Choose a saved contact or type a number in international format."
            aside={
              <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs font-medium tabular-nums">
                {recipients === 0 ? 'No recipient yet' : '1 recipient'}
              </span>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact">
                {(props) => (
                  <SelectControl
                    {...props}
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
                  </SelectControl>
                )}
              </Field>
              <Field label="Country">
                {(props) => (
                  <SelectControl
                    {...props}
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
                  </SelectControl>
                )}
              </Field>
            </div>
            <Field label="Phone number">
              {(props) => (
                <input
                  {...props}
                  className={controlClass}
                  inputMode="tel"
                  autoComplete="off"
                  value={phone}
                  placeholder="+14155552671"
                  onChange={(event) => {
                    setContactId('');
                    setPhone(event.target.value);
                  }}
                />
              )}
            </Field>
            {recipients === 0 ? null : (
              <ul aria-label="Recipients" className="flex flex-wrap gap-2">
                <li className="bg-mint text-foreground inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-sm font-semibold">
                  <UserRound aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{recipientLabel}</span>
                  <button
                    type="button"
                    aria-label="Clear recipient"
                    className="hover:bg-foreground/10 focus-visible:ring-ring/50 grid size-6 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3"
                    onClick={() => {
                      setContactId('');
                      setPhone('');
                    }}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              </ul>
            )}
          </Step>
          <Step
            icon={AtSign}
            tone="bg-peach text-peach-foreground"
            title="Sender"
            description="The approved sender ID for the destination country, or the shared number."
          >
            <Field label="Sender">
              {(props) => (
                <SelectControl
                  {...props}
                  value={selectedSender}
                  onChange={(event) => {
                    setSenderId(event.target.value);
                  }}
                >
                  <option value="">
                    Shared number
                    {senders.data?.platformSender === null ||
                    senders.data?.platformSender === undefined
                      ? ''
                      : ` ${senders.data.platformSender.value}`}
                  </option>
                  {approvedSenders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {sender.value}
                    </option>
                  ))}
                </SelectControl>
              )}
            </Field>
          </Step>
        </div>
        <div className="grid gap-4">
          <section className="bg-card grid gap-5 rounded-2xl border p-5 sm:p-6">
            <h2 className="text-lg font-bold tracking-tight">Preview</h2>
            <PhonePreview
              from={preview.data?.from ?? senderValue}
              to={preview.data?.to ?? recipientLabel}
              body={preview.data?.body ?? template?.body ?? ''}
              draft={preview.data === undefined}
              busy={previewing}
            />
            <Details
              preview={preview.data}
              templateName={template?.name ?? ''}
              senderLabel={senderValue}
            />
          </section>
          <Activity items={activity} live={live} />
        </div>
      </div>
    </section>
  );
}
