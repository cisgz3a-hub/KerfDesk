import { describe, expect, it } from 'vitest';
import { unrestoredOriginOfferPrompt } from './unrestored-abort-origin';

// Rolling audit v12 X8-P3-2: on a Y-port rotary, machine Y turns the part.
// The Abort-origin offer said "The head is 12.3 mm from it (X +0, Y +12.3 mm)",
// which on the Creality chuck (40 machine mm per turn) is a 111° turn.

const SAVED = { x: 120, y: 40 };

describe('the Abort-origin offer on a rotary', () => {
  it('names a chuck turn in degrees and the X offset as head distance', () => {
    const prompt = unrestoredOriginOfferPrompt(
      'User Origin',
      SAVED,
      { x: 0, y: 12.3 },
      false,
      false,
      { turnMm: 40, roller: false },
    );
    expect(prompt).toContain(
      'The head is 0 mm from it in X, and the part has turned +111° since (+12.3 machine mm of Y).',
    );
    expect(prompt).not.toContain('The head is 12.3 mm from it');
    expect(prompt).not.toContain('slipped');
  });

  it('warns that a part on rollers may have slipped', () => {
    const prompt = unrestoredOriginOfferPrompt(
      'Verified Origin',
      SAVED,
      { x: -2, y: -64 },
      false,
      false,
      { turnMm: 128, roller: true },
    );
    expect(prompt).toContain('The head is −2 mm from it in X, and the part has turned −180° since');
    expect(prompt).toContain('A part on rollers may also have slipped');
  });

  it('says when the part is at the same turn', () => {
    const prompt = unrestoredOriginOfferPrompt('User Origin', SAVED, { x: 3, y: 0 }, false, false, {
      turnMm: 40,
      roller: false,
    });
    expect(prompt).toContain('The head is +3 mm from it in X, and the part is at the same turn.');
  });

  it('keeps the flat-bed wording without a rotary', () => {
    const prompt = unrestoredOriginOfferPrompt('User Origin', SAVED, { x: 0, y: 12.3 }, false);
    expect(prompt).toContain('The head is 12.3 mm from it (X 0, Y +12.3 mm).');
  });
});
