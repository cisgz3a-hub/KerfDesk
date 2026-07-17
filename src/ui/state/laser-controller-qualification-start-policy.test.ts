import { describe, expect, it } from 'vitest';
import {
  normalStartQualificationBlockMessage,
  qualifyingController,
} from './laser-controller-qualification';

describe('normal Start controller-qualification policy', () => {
  it('does not add an independent qualification blocker to ordinary laser Start', () => {
    expect(
      normalStartQualificationBlockMessage('laser', qualifyingController(4, 'settings-read'), 4),
    ).toBeNull();
  });

  it('keeps the strict controller-qualification gate for CNC Start', () => {
    expect(
      normalStartQualificationBlockMessage('cnc', qualifyingController(4, 'settings-read'), 4),
    ).toBe('Reading controller settings…');
  });
});
