import { describe, expect, it } from 'vitest';
import { ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE } from '../job-placement';
import {
  FRAME_G54_POSITION_UNREPORTED_MESSAGE,
  FRAME_WORK_POSITION_UNKNOWN_MESSAGE,
  positionWithheldFrameMessage,
  withPositionWithheldRemedy,
} from './frame-position-withheld';

const withheld = { positionEvidenceSuppressed: true, reportUnitsUnconfirmed: false };

describe('withPositionWithheldRemedy (ADR-367 Amendment 2)', () => {
  it('says every "wait for a report" refusal as its remedy, once', () => {
    expect(
      withPositionWithheldRemedy(
        [
          FRAME_WORK_POSITION_UNKNOWN_MESSAGE,
          ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE,
          FRAME_G54_POSITION_UNREPORTED_MESSAGE,
          'Another refusal.',
        ],
        withheld,
        true,
      ),
    ).toEqual([positionWithheldFrameMessage(true), 'Another refusal.']);
  });

  it('leaves the refusals alone while the position is reported', () => {
    const messages = [FRAME_WORK_POSITION_UNKNOWN_MESSAGE];
    expect(withPositionWithheldRemedy(messages, { positionEvidenceSuppressed: false }, true)).toBe(
      messages,
    );
  });

  it('keeps them while report units are unconfirmed, which a settings read fixes', () => {
    const messages = [FRAME_WORK_POSITION_UNKNOWN_MESSAGE];
    expect(
      withPositionWithheldRemedy(messages, { ...withheld, reportUnitsUnconfirmed: true }, true),
    ).toBe(messages);
  });

  it('names Home only when the machine has homing', () => {
    expect(positionWithheldFrameMessage(true)).toContain('Home the machine');
    expect(positionWithheldFrameMessage(false)).not.toContain('Home');
    expect(positionWithheldFrameMessage(false)).toContain('Set origin here');
  });
});
