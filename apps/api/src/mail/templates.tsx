import type { ReactNode } from 'react';
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from 'react-email';

const page = {
  backgroundColor: '#f4f7f8',
  fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif',
  margin: 0,
};
const card = {
  backgroundColor: '#ffffff',
  borderRadius: '16px',
  margin: '32px auto',
  maxWidth: '480px',
  padding: '32px',
};
const brand = { color: '#0f766e', fontSize: '22px', margin: '0 0 12px' };
const copy = { color: '#243044', fontSize: '15px', lineHeight: '1.5' };
const action = {
  backgroundColor: '#0f766e',
  borderRadius: '8px',
  color: '#f8fffe',
  display: 'inline-block',
  fontSize: '15px',
  padding: '12px 18px',
  textDecoration: 'none',
};
const fine = { color: '#5c6b7a', fontSize: '13px', lineHeight: '1.5' };

function Frame({
  preview,
  title,
  children,
}: {
  preview: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={page}>
        <Container style={card}>
          <Heading style={brand}>{title}</Heading>
          {children}
        </Container>
      </Body>
    </Html>
  );
}

export function VerifyEmail({ name, url }: { name: string; url: string }) {
  return (
    <Frame preview="Confirm your email for SMSVIO" title="Confirm your email">
      <Text style={copy}>
        Hi {name}, confirm this address to finish opening your SMSVIO account.
      </Text>
      <Button href={url} style={action}>
        Confirm email
      </Button>
      <Text style={fine}>Or copy this link into your browser: {url}</Text>
    </Frame>
  );
}

export function ResetPasswordEmail({ url }: { url: string }) {
  return (
    <Frame preview="Reset your SMSVIO password" title="Reset your password">
      <Text style={copy}>
        We received a request to choose a new password for your SMSVIO account.
      </Text>
      <Button href={url} style={action}>
        Choose a new password
      </Button>
      <Text style={fine}>
        This link expires in one hour. If you did not ask for it, you can ignore this email. {url}
      </Text>
    </Frame>
  );
}

export function InvitationEmail({
  organizationName,
  url,
}: {
  organizationName: string;
  url: string;
}) {
  return (
    <Frame preview={`Join ${organizationName} on SMSVIO`} title="You are invited">
      <Text style={copy}>{organizationName} invited you to their SMSVIO workspace.</Text>
      <Button href={url} style={action}>
        Accept invitation
      </Button>
      <Text style={fine}>This invitation expires in 7 days. {url}</Text>
    </Frame>
  );
}

export function PhoneCodeEmail({ code }: { code: string }) {
  return (
    <Frame preview="Your SMSVIO confirmation code" title="Confirm your phone number">
      <Text style={copy}>
        Enter this code in SMSVIO to confirm the phone number on your account. We send it by email
        until text-message delivery is available.
      </Text>
      <Text style={{ ...brand, letterSpacing: '4px' }}>{code}</Text>
      <Text style={fine}>
        The code expires in 10 minutes. If you did not ask for it, ignore this email.
      </Text>
    </Frame>
  );
}

export function ExistingAccountEmail({ url }: { url: string }) {
  return (
    <Frame preview="Sign in to SMSVIO" title="You already have an account">
      <Text style={copy}>
        Someone tried to create an SMSVIO account with this email. You can sign in with your
        existing password.
      </Text>
      <Button href={url} style={action}>
        Sign in
      </Button>
    </Frame>
  );
}
