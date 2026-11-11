'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { useCanManage, useIsOwner } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';

const TABS = ['profile', 'details', 'security', 'business'] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const params = useSearchParams();
  const requested = params.get('tab');
  const initial = TABS.find((tab) => tab === requested) ?? 'profile';
  const [tab, setTab] = useState<Tab>(initial);
  const canManage = useCanManage();
  const isOwner = useIsOwner();

  return (
    <section className="mx-auto grid max-w-3xl gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.filter((item) => item !== 'business' || canManage).map((item) => (
          <Button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            variant={tab === item ? 'default' : 'outline'}
            onClick={() => {
              setTab(item);
            }}
          >
            {item[0]?.toUpperCase()}
            {item.slice(1)}
          </Button>
        ))}
      </div>
      {tab === 'profile' ? <ProfileTab /> : null}
      {tab === 'details' ? <DetailsTab /> : null}
      {tab === 'security' ? <SecurityTab /> : null}
      {tab === 'business' && canManage ? <BusinessTab isOwner={isOwner} /> : null}
    </section>
  );
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong.';
}

function ProfileTab() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(session.data?.user.name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const hasPassword = session.data === undefined || session.data.user.hasPassword;

  return (
    <div className="grid gap-6">
      <form
        className="grid max-w-sm gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void accountApi
            .updateProfile(name)
            .then(async () => {
              toast('Name updated.');
              await queryClient.invalidateQueries({ queryKey: ['session'] });
            })
            .catch((error: unknown) => {
              toast(message(error));
            });
        }}
      >
        <h2 className="font-semibold">Profile</h2>
        <input
          className="border-input h-10 rounded-lg border px-3"
          aria-label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Button type="submit">Save name</Button>
      </form>
      <form
        className="grid max-w-sm gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const save = hasPassword
            ? accountApi.changePassword(currentPassword, password)
            : accountApi.setPassword(password);
          void save
            .then(() => {
              toast('Password updated.');
              setCurrentPassword('');
              setPassword('');
            })
            .catch((error: unknown) => {
              toast(message(error));
            });
        }}
      >
        <h2 className="font-semibold">Password</h2>
        {hasPassword ? null : (
          <p className="text-muted-foreground text-sm">
            This account signs in with Google. You can add a password as well.
          </p>
        )}
        {hasPassword ? (
          <input
            className="border-input h-10 rounded-lg border px-3"
            type="password"
            aria-label="Current password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
          />
        ) : null}
        <input
          className="border-input h-10 rounded-lg border px-3"
          type="password"
          aria-label="New password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <Button type="submit">Change password</Button>
      </form>
      <div className="grid max-w-sm gap-3">
        <h2 className="font-semibold">Two-factor authentication</h2>
        <p className="text-muted-foreground text-sm">
          {session.data?.user.totpEnabled ? 'On' : 'Off'}
        </p>
        {setup === null ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const current = window.prompt('Confirm your current password to start setup.');
              if (current === null || current === '') {
                return;
              }
              void accountApi
                .setupTotp(current)
                .then(setSetup)
                .catch((error: unknown) => {
                  toast(message(error));
                });
            }}
          >
            Set up authenticator
          </Button>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void accountApi
                .confirmTotp(code)
                .then(async () => {
                  toast('Two-factor authentication is on.');
                  setSetup(null);
                  await queryClient.invalidateQueries({ queryKey: ['session'] });
                })
                .catch((error: unknown) => {
                  toast(message(error));
                });
            }}
          >
            <div
              role="img"
              aria-label="Authenticator QR code"
              className="size-40 bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url("${setup.qrDataUrl}")` }}
            />
            <p className="font-mono text-xs break-all">{setup.secret}</p>
            <input
              className="border-input h-10 rounded-lg border px-3"
              aria-label="Authentication code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
            <Button type="submit">Confirm code</Button>
          </form>
        )}
        {session.data?.user.totpEnabled ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              const current = window.prompt('Current password');
              const totp = window.prompt('Authentication code');
              if (current === null || totp === null) {
                return;
              }
              void accountApi
                .disableTotp(current, totp)
                .then(async () => {
                  toast('Two-factor authentication is off.');
                  await queryClient.invalidateQueries({ queryKey: ['session'] });
                })
                .catch((error: unknown) => {
                  toast(message(error));
                });
            }}
          >
            Turn off
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DetailsTab() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [timezone, setTimezone] = useState(session.data?.user.timezone ?? 'UTC');
  const [contactPhone, setContactPhone] = useState(session.data?.user.contactPhone ?? '');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => accountApi.config() });

  return (
    <div className="grid max-w-sm gap-6">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void accountApi
            .updateDetails({ timezone, contactPhone })
            .then(async () => {
              toast('Details saved.');
              await queryClient.invalidateQueries({ queryKey: ['session'] });
            })
            .catch((error: unknown) => {
              toast(message(error));
            });
        }}
      >
        <h2 className="font-semibold">Details</h2>
        <input
          className="border-input h-10 rounded-lg border px-3"
          aria-label="Time zone"
          value={timezone}
          onChange={(event) => {
            setTimezone(event.target.value);
          }}
        />
        <input
          className="border-input h-10 rounded-lg border px-3"
          aria-label="Contact phone"
          placeholder="+14155552671"
          value={contactPhone}
          onChange={(event) => {
            setContactPhone(event.target.value);
          }}
        />
        <Button type="submit">Save details</Button>
      </form>
      {config.data?.emailMode === 'disabled' ? null : (
        <>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void accountApi
                .startPhone(phone)
                .then((result) => {
                  toast(result.message);
                })
                .catch((error: unknown) => {
                  toast(message(error));
                });
            }}
          >
            <h2 className="font-semibold">Account phone</h2>
            <p className="text-muted-foreground text-sm">
              {session.data?.user.accountPhoneE164 ?? 'Not confirmed.'} The code is emailed until
              text-message delivery exists.
            </p>
            <input
              className="border-input h-10 rounded-lg border px-3"
              aria-label="Phone number"
              placeholder="+14155550100"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
            <Button type="submit" variant="outline">
              Email me a code
            </Button>
          </form>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void accountApi
                .confirmPhone(code)
                .then(async () => {
                  toast('Phone confirmed.');
                  await queryClient.invalidateQueries({ queryKey: ['session'] });
                })
                .catch((error: unknown) => {
                  toast(message(error));
                });
            }}
          >
            <input
              className="border-input h-10 rounded-lg border px-3"
              aria-label="Confirmation code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
            <Button type="submit">Confirm phone</Button>
          </form>
        </>
      )}
    </div>
  );
}

function SecurityTab() {
  const router = useRouter();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => accountApi.sessions() });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => accountApi.audit() });
  const queryClient = useQueryClient();
  const toast = useToast();

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="font-semibold">Sessions</h2>
        <ul className="mt-3 grid gap-2">
          {(sessions.data?.items ?? []).map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
            >
              <span>
                {item.current ? 'This session' : 'Other session'} · {item.ip ?? 'unknown IP'}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void accountApi
                    .revokeSession(item.id)
                    .then(async () => {
                      toast(item.current ? 'Signed out.' : 'Session revoked.');
                      if (item.current) {
                        router.push('/signin');
                        router.refresh();
                        return;
                      }
                      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
                    })
                    .catch((error: unknown) => {
                      toast(message(error));
                    });
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="font-semibold">Recent activity</h2>
        <ul className="mt-3 grid gap-2 text-sm">
          {(audit.data?.items ?? []).map((item) => (
            <li key={item.id} className="rounded-lg border px-3 py-2">
              {item.action} · {new Date(item.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function BusinessTab({ isOwner }: { isOwner: boolean }) {
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const queryClient = useQueryClient();
  const toast = useToast();
  const organization = session.data?.organization;
  const [legalName, setLegalName] = useState(organization?.legalName ?? '');
  const [taxIdType, setTaxIdType] = useState(organization?.taxIdType ?? '');
  const [taxId, setTaxId] = useState(organization?.taxId ?? '');
  const [confirmName, setConfirmName] = useState('');

  return (
    <div className="grid max-w-sm gap-6">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void accountApi
            .updateBusiness({ legalName, taxIdType, taxId })
            .then(async () => {
              toast('Business details saved.');
              await queryClient.invalidateQueries({ queryKey: ['session'] });
            })
            .catch((error: unknown) => {
              toast(message(error));
            });
        }}
      >
        <h2 className="font-semibold">Business</h2>
        <input
          className="border-input h-10 rounded-lg border px-3"
          aria-label="Legal name"
          value={legalName}
          onChange={(event) => {
            setLegalName(event.target.value);
          }}
        />
        <input
          className="border-input h-10 rounded-lg border px-3"
          aria-label="Tax ID type"
          value={taxIdType}
          onChange={(event) => {
            setTaxIdType(event.target.value);
          }}
        />
        <input
          className="border-input h-10 rounded-lg border px-3"
          aria-label="Tax ID"
          value={taxId}
          onChange={(event) => {
            setTaxId(event.target.value);
          }}
        />
        <Button type="submit">Save business details</Button>
      </form>
      {isOwner ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void accountApi
              .deleteOrganization(confirmName)
              .then(async () => {
                toast('Organization deleted.');
                await queryClient.invalidateQueries({ queryKey: ['session'] });
              })
              .catch((error: unknown) => {
                toast(message(error));
              });
          }}
        >
          <h2 className="font-semibold">Delete organization</h2>
          <p className="text-muted-foreground text-sm">
            Type {organization?.name} to confirm. This cannot be undone.
          </p>
          <input
            className="border-input h-10 rounded-lg border px-3"
            aria-label="Confirm organization name"
            value={confirmName}
            onChange={(event) => {
              setConfirmName(event.target.value);
            }}
          />
          <Button type="submit" variant="destructive">
            Delete organization
          </Button>
        </form>
      ) : null}
    </div>
  );
}
