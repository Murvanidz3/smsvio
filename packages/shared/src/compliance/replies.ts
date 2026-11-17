export const AUTO_REPLY_CATEGORIES = ['OPT_OUT', 'OPT_IN', 'HELP', 'CUSTOM'] as const;

export type AutoReplyCategory = (typeof AUTO_REPLY_CATEGORIES)[number];

export interface AutoReplyRule {
  readonly id?: string;
  readonly category: AutoReplyCategory;
  readonly keywords: readonly string[];
  readonly body: string;
  readonly protected: boolean;
}

/** Industry stop, start, and help words. Text can change. The rows cannot be deleted. */
export const DEFAULT_REPLIES: readonly AutoReplyRule[] = [
  {
    category: 'OPT_OUT',
    keywords: ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'],
    body: 'You are unsubscribed and will receive no further messages.',
    protected: true,
  },
  {
    category: 'OPT_IN',
    keywords: ['start', 'unstop', 'yes'],
    body: 'You are subscribed and can receive messages again. Reply STOP to unsubscribe.',
    protected: true,
  },
  {
    category: 'HELP',
    keywords: ['help', 'info'],
    body: 'Reply STOP to unsubscribe. Reply START to subscribe again.',
    protected: true,
  },
];

const ORDER: readonly AutoReplyCategory[] = ['OPT_OUT', 'OPT_IN', 'HELP', 'CUSTOM'];

/** Whole tokens, so "stop" matches "please stop" and does not match "unstoppable". */
export function messageTokens(body: string): string[] {
  return body
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export function normalizeKeyword(value: string): string | null {
  const token = value.trim().toLowerCase();
  if (!/^[a-z0-9]{2,32}$/.test(token)) {
    return null;
  }
  return token;
}

/**
 * First matching rule. Opt-out wins over opt-in, help, and custom keywords.
 */
export function matchAutoReply(
  rules: readonly AutoReplyRule[],
  body: string,
): AutoReplyRule | null {
  const tokens = new Set(messageTokens(body));
  if (tokens.size === 0) {
    return null;
  }
  for (const category of ORDER) {
    for (const rule of rules) {
      if (rule.category !== category) {
        continue;
      }
      if (rule.keywords.some((keyword) => tokens.has(keyword.toLowerCase()))) {
        return rule;
      }
    }
  }
  return null;
}
