import { describe, expect, it } from 'vitest';
import { splitReviewWarning } from './review-warning-headline';

describe('splitReviewWarning', () => {
  it('uses a short leading label as the headline', () => {
    expect(
      splitReviewWarning(
        'Controller identity unconfirmed: no firmware family has been detected in this controller session.',
      ),
    ).toEqual({
      headline: 'Controller identity unconfirmed',
      detail: 'No firmware family has been detected in this controller session.',
    });
  });

  it('keeps a quoted operation name with its finding instead of splitting on it', () => {
    expect(
      splitReviewWarning('Layer "Cut": 3 shapes narrower than the 0.2 mm kerf. They will vanish.'),
    ).toEqual({
      headline: 'Layer "Cut": 3 shapes narrower than the 0.2 mm kerf',
      detail: 'They will vanish.',
    });
  });

  it('uses the first sentence and keeps the rest as the detail', () => {
    expect(
      splitReviewWarning(
        'The controller-to-bed coordinate mapping is unverified. The canvas is artwork-relative.',
      ),
    ).toEqual({
      headline: 'The controller-to-bed coordinate mapping is unverified',
      detail: 'The canvas is artwork-relative.',
    });
  });

  it('does not split inside decimals or abbreviations', () => {
    expect(
      splitReviewWarning(
        'Island fill at 1.5 mm uses runways, e.g. Scanline sweeps. Test on scrap.',
      ),
    ).toEqual({
      headline: 'Island fill at 1.5 mm uses runways, e.g. Scanline sweeps',
      detail: 'Test on scrap.',
    });
  });

  it('returns a one-sentence warning whole, without a detail', () => {
    expect(splitReviewWarning('Island fill can overburn small details.')).toEqual({
      headline: 'Island fill can overburn small details',
      detail: null,
    });
  });

  it('reads the first paragraph of a multi-paragraph prompt', () => {
    expect(
      splitReviewWarning('Settings cannot be verified.\n\nCheck $30.\n\nStart anyway?'),
    ).toEqual({
      headline: 'Settings cannot be verified',
      detail: 'Check $30.\n\nStart anyway?',
    });
  });

  it('cuts an overlong headline at a word and keeps the whole warning as the detail', () => {
    const warning = `${'Bidirectional scan output at many speeds '.repeat(4)}has no table. Calibrate.`;
    const parts = splitReviewWarning(warning);
    expect(parts.headline.length).toBeLessThanOrEqual(111);
    expect(parts.headline.endsWith('…')).toBe(true);
    expect(parts.detail).toBe(warning);
  });
});
