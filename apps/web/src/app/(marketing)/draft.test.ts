import { describe, expect, it } from 'vitest';

import { describeDraft } from './draft';

describe('describeDraft', () => {
  it('counts an empty GSM-7 message against 160', () => {
    expect(describeDraft('')).toEqual({
      encoding: 'GSM-7',
      left: 160,
      limit: 160,
      segments: 0,
    });
  });

  it('switches to Unicode 70 when a Georgian letter is included', () => {
    expect(describeDraft('ა')).toEqual({
      encoding: 'Unicode',
      left: 69,
      limit: 70,
      segments: 1,
    });
  });
});
