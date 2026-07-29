import { describe, expect, it } from 'vitest';
import {
  fluidncV403RealtimeDispatch,
  isFluidncV403RealtimeByte,
} from './fluidnc-v403-realtime-dispatch';

const DEFINED_DISPATCHES = [
  [0x18, 'reset-event'],
  [0x3f, 'status-report-direct'],
  [0x7e, 'cycle-start-event'],
  [0x21, 'feed-hold-event'],
  [0x84, 'safety-door-event'],
  [0x85, 'motion-cancel-event-if-jogging'],
  [0x86, 'debug-event'],
  [0x87, 'macro-0-event'],
  [0x88, 'macro-1-event'],
  [0x89, 'macro-2-event'],
  [0x8a, 'macro-3-event'],
  [0x90, 'feed-override-reset-event'],
  [0x91, 'feed-override-coarse-plus-event'],
  [0x92, 'feed-override-coarse-minus-event'],
  [0x93, 'feed-override-fine-plus-event'],
  [0x94, 'feed-override-fine-minus-event'],
  [0x95, 'rapid-override-reset-event'],
  [0x96, 'rapid-override-medium-event'],
  [0x97, 'rapid-override-low-event'],
  [0x98, 'rapid-override-extra-low-event'],
  [0x99, 'spindle-override-reset-event'],
  [0x9a, 'spindle-override-coarse-plus-event'],
  [0x9b, 'spindle-override-coarse-minus-event'],
  [0x9c, 'spindle-override-fine-plus-event'],
  [0x9d, 'spindle-override-fine-minus-event'],
  [0x9e, 'spindle-override-stop-event'],
  [0xa0, 'coolant-flood-toggle-event'],
  [0xa1, 'coolant-mist-toggle-event'],
  [0xb2, 'pin-ack-channel-control'],
  [0xb3, 'pin-nak-channel-control'],
  [0xb4, 'pin-reset-channel-control'],
] as const;

describe('pinned FluidNC v4.0.3 realtime dispatch identity', () => {
  it.each(DEFINED_DISPATCHES)('maps command %s to %s', (command, dispatch) => {
    expect(isFluidncV403RealtimeByte(command)).toBe(true);
    expect(fluidncV403RealtimeDispatch(command)).toBe(dispatch);
  });

  it.each([0x80, 0x8b, 0x9f, 0xbe])(
    'distinguishes undefined intercepted byte %s from defined handlers',
    (command) => {
      expect(isFluidncV403RealtimeByte(command)).toBe(true);
      expect(fluidncV403RealtimeDispatch(command)).toBe('undefined-no-op');
    },
  );

  it.each([
    [0x100, 'pin-low-channel-event'],
    [0x13e, 'pin-low-channel-event'],
    [0x140, 'pin-high-channel-event'],
    [0x17e, 'pin-high-channel-event'],
  ] as const)('maps decoded pin command %s to %s', (command, dispatch) => {
    expect(fluidncV403RealtimeDispatch(command)).toBe(dispatch);
  });

  it('applies the pinned uint8 command cast only after decoded pin handling', () => {
    expect(fluidncV403RealtimeDispatch(0x13f)).toBe('status-report-direct');
    expect(fluidncV403RealtimeDispatch(0x17f)).toBe('undefined-no-op');
    expect(fluidncV403RealtimeDispatch(0x184)).toBe('safety-door-event');
    expect(fluidncV403RealtimeDispatch(0x1b2)).toBe('undefined-no-op');
  });

  it.each([0x00, 0x20, 0x7f])('leaves ordinary byte %s for Lineedit', (byte) => {
    expect(isFluidncV403RealtimeByte(byte)).toBe(false);
  });
});
