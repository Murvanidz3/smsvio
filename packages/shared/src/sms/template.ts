import { z } from 'zod';

import { analyzeMessage, type MessageAnalysis } from './encoding.js';

export const TEMPLATE_CATEGORIES = ['AUTHENTICATION', 'UTILITY', 'MARKETING'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ka', label: 'Georgian' },
] as const;

const LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;
const VARIABLE_NAME = /^[a-z0-9_]+$/;
const OPT_OUT = /\bstop\b|opt[\s-]?out|unsubscribe/i;

function variablePattern(): RegExp {
  return /\{\{([a-z0-9_]+)\}\}/g;
}

export const templateDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  category: z.enum(TEMPLATE_CATEGORIES),
  language: z.string().regex(LANGUAGE, 'Use a language code such as en or pt-BR.'),
  body: z.string().min(1).max(2000),
  samples: z.record(z.string().regex(VARIABLE_NAME), z.string().max(200)).optional(),
});

export type TemplateDefinition = z.output<typeof templateDefinitionSchema>;

export const TEMPLATE_JSON_EXAMPLE = {
  name: 'Visit reminder',
  category: 'UTILITY',
  language: 'en',
  body: 'Hi {{name}}, your visit with {{shop}} is on {{date}}.',
  samples: { name: 'Ada', shop: 'North Clinic', date: '12 May' },
} as const satisfies TemplateDefinition;

export interface TemplateSample {
  readonly id: string;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly language: string;
  readonly body: string;
  readonly samples: Readonly<Record<string, string>>;
}

/** Original starter texts. Copying one creates a draft; nothing here is sent on its own. */
export const TEMPLATE_GALLERY: readonly TemplateSample[] = [
  {
    id: 'sign-in-code',
    name: 'Sign-in code',
    category: 'AUTHENTICATION',
    language: 'en',
    body: '{{name}}, your SMSVIO code is {{code}}. It expires in 10 minutes.',
    samples: { name: 'Ada', code: '482913' },
  },
  {
    id: 'visit-reminder',
    name: 'Visit reminder',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{name}}, your visit on {{date}} is confirmed. Reply HELP for help.',
    samples: { name: 'Ada', date: '12 May, 09:30' },
  },
  {
    id: 'delivery-update',
    name: 'Delivery update',
    category: 'UTILITY',
    language: 'en',
    body: '{{name}}, order {{order}} is out for delivery today.',
    samples: { name: 'Ada', order: '1842' },
  },
  {
    id: 'shift-change',
    name: 'Shift change',
    category: 'UTILITY',
    language: 'en',
    body: '{{name}}, your shift on {{date}} now starts at {{time}}.',
    samples: { name: 'Ada', date: 'Tuesday', time: '08:00' },
  },
  {
    id: 'new-arrival',
    name: 'New arrival',
    category: 'MARKETING',
    language: 'en',
    body: '{{name}}, {{shop}} just received {{item}}. Reply STOP to opt out.',
    samples: { name: 'Ada', shop: 'Harbor Goods', item: 'the linen coat' },
  },
  {
    id: 'season-note',
    name: 'Season note',
    category: 'MARKETING',
    language: 'en',
    body: '{{shop}} is open this weekend, {{name}}. Show this text at the desk. Reply STOP to opt out.',
    samples: { name: 'Ada', shop: 'Harbor Goods' },
  },
];

export function templateVariables(body: string): string[] {
  const names: string[] = [];
  for (const match of body.matchAll(variablePattern())) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export function nameFromBody(body: string): string {
  const plain = body.replace(variablePattern(), ' ').replace(/\s+/g, ' ').trim();
  if (plain === '') {
    return 'Untitled template';
  }
  return plain.length > 48 ? `${plain.slice(0, 48).trimEnd()}…` : plain;
}

export function previewTemplate(body: string, samples: Readonly<Record<string, string>>): string {
  return body.replace(variablePattern(), (match, name: string) => {
    const sample = samples[name];
    return sample ?? match;
  });
}

export type RenderResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: 'missing_variable'; readonly missing: readonly string[] };

export function renderTemplate(
  body: string,
  variables: Readonly<Record<string, string | undefined>>,
): RenderResult {
  const missing: string[] = [];
  const text = body.replace(variablePattern(), (match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      if (!missing.includes(name)) {
        missing.push(name);
      }
      return match;
    }
    return value;
  });
  if (missing.length > 0) {
    return { ok: false, code: 'missing_variable', missing };
  }
  return { ok: true, text };
}

export function templateCanBeSent(status: TemplateStatus): boolean {
  return status === 'APPROVED';
}

export interface TemplateCheck {
  readonly variables: readonly string[];
  readonly missingSamples: readonly string[];
  readonly optOutMissing: boolean;
  readonly analysis: MessageAnalysis;
}

export function checkTemplate(input: {
  readonly body: string;
  readonly category: TemplateCategory;
  readonly samples: Readonly<Record<string, string>>;
  readonly smartEncoding: boolean;
  readonly maxSegments?: number;
}): TemplateCheck {
  const variables = templateVariables(input.body);
  const missingSamples = variables.filter((name) => input.samples[name] === undefined);
  return {
    variables,
    missingSamples,
    optOutMissing: input.category === 'MARKETING' && !OPT_OUT.test(input.body),
    analysis: analyzeMessage(previewTemplate(input.body, input.samples), {
      smartEncoding: input.smartEncoding,
      maxSegments: input.maxSegments,
    }),
  };
}

export function gallerySample(id: string): TemplateSample | undefined {
  return TEMPLATE_GALLERY.find((sample) => sample.id === id);
}
