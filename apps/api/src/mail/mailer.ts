import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { render } from 'react-email';
import type { ReactNode } from 'react';
import nodemailer, { type Transporter } from 'nodemailer';

import type { ApiEnv } from '../env.js';
import { randomToken } from '../security/tokens.js';

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface Mailer {
  send(message: OutboundEmail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

export async function renderMessage(node: ReactNode): Promise<{ html: string; text: string }> {
  const html = await render(node, { pretty: false });
  const text = await render(node, { plainText: true, pretty: false });
  return { html, text };
}

export function emailSubject(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 140);
}

export function createMailer(env: ApiEnv): Mailer {
  if (env.NODE_ENV !== 'production' && env.MAIL_SINK_DIR !== undefined) {
    return new FileMailer(env.MAIL_SINK_DIR);
  }
  return new SmtpMailer(env);
}

class FileMailer implements Mailer {
  constructor(private readonly directory: string) {}

  async send(message: OutboundEmail): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, `${Date.now().toString(36)}-${randomToken(8)}.json`);
    await writeFile(
      file,
      JSON.stringify({
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      { mode: 0o600 },
    );
  }
}

class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly env: ApiEnv) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER === undefined || env.SMTP_PASSWORD === undefined
          ? undefined
          : { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  }

  async send(message: OutboundEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
