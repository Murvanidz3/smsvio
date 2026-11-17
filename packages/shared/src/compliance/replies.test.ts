import { describe, expect, it } from 'vitest';

import { DEFAULT_REPLIES, matchAutoReply, messageTokens, normalizeKeyword } from './replies.js';

describe('auto-replies', () => {
  it('matches a stop word inside a sentence and ignores a longer word', () => {
    expect(messageTokens('Please STOP now!')).toEqual(['please', 'stop', 'now']);
    expect(matchAutoReply(DEFAULT_REPLIES, 'Please STOP now')?.category).toBe('OPT_OUT');
    expect(matchAutoReply(DEFAULT_REPLIES, 'unstoppable')?.category).toBeUndefined();
    expect(matchAutoReply(DEFAULT_REPLIES, '   ')).toBeNull();
  });

  it('prefers opt-out when a message also contains help', () => {
    expect(matchAutoReply(DEFAULT_REPLIES, 'help me stop')?.category).toBe('OPT_OUT');
    expect(matchAutoReply(DEFAULT_REPLIES, 'START')?.category).toBe('OPT_IN');
    expect(matchAutoReply(DEFAULT_REPLIES, 'info')?.body).toMatch(/STOP/);
  });

  it('matches a custom keyword after the protected ones', () => {
    const rules = [
      ...DEFAULT_REPLIES,
      {
        category: 'CUSTOM' as const,
        keywords: ['hours'],
        body: 'We are open 9 to 5.',
        protected: false,
      },
    ];
    expect(matchAutoReply(rules, 'hours')?.body).toBe('We are open 9 to 5.');
  });

  it('accepts a keyword of letters and digits', () => {
    expect(normalizeKeyword(' Stop ')).toBe('stop');
    expect(normalizeKeyword('a')).toBeNull();
    expect(normalizeKeyword('has space')).toBeNull();
  });
});
