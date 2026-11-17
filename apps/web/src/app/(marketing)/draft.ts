import { analyzeMessage } from '@smsvio/shared';

export const EXAMPLE_MESSAGE = 'Your order is ready for pickup.';

export interface DraftSummary {
  readonly encoding: 'GSM-7' | 'Unicode';
  readonly left: number;
  readonly limit: number;
  readonly segments: number;
}

export function describeDraft(text: string): DraftSummary {
  const analysis = analyzeMessage(text);
  return {
    encoding: analysis.encoding === 'GSM-7' ? 'GSM-7' : 'Unicode',
    left: analysis.unitsLeft,
    limit: analysis.unitLimit,
    segments: analysis.segmentCount,
  };
}
