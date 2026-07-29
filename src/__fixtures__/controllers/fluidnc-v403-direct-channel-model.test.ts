import { describe, expect, it } from 'vitest';
import { FLUIDNC_V403_DIRECT_CHANNEL_FIXTURES } from './fluidnc-v403-direct-channel-fixtures';
import {
  simulateFluidncV403BaseChannelRecords,
  simulateFluidncV403DirectChannel,
} from './fluidnc-v403-direct-channel-model';

const G = 0x47;
const ONE = 0x31;
const X = 0x58;
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;
const SAFETY_DOOR = 0x84;
const UTF8_LEAD_C2 = 0xc2;
const COOLANT_FLOOD_TOGGLE = 0xa0;

describe('pinned FluidNC v4.0.3 direct UartChannel source model', () => {
  it.each(FLUIDNC_V403_DIRECT_CHANNEL_FIXTURES)('$name', ({ inputChunks, isEditing, expected }) => {
    expect(simulateFluidncV403DirectChannel(inputChunks, { isEditing })).toEqual(expected);
  });

  it('keeps direct Lineedit CRLF completion separate from base Channel coalescing', () => {
    const bytes = [G, ONE, CARRIAGE_RETURN, LINE_FEED];

    expect(simulateFluidncV403DirectChannel([bytes]).completedRecords).toEqual([
      { lineBytes: [G, ONE], completion: 'nonempty-poll-ready' },
      { lineBytes: [], completion: 'empty-poll-ready' },
    ]);
    expect(simulateFluidncV403BaseChannelRecords(bytes)).toEqual([[G, ONE]]);
  });

  it('asserts routed high-byte removal separately from safety-door event identity', () => {
    const result = simulateFluidncV403DirectChannel([[G, ONE, SAFETY_DOOR, X, LINE_FEED]]);

    expect(result.completedRecords[0]?.lineBytes).toEqual([G, ONE, X]);
    expect(result.realtimeCommands).toEqual([
      { command: SAFETY_DOOR, dispatch: 'safety-door-event' },
    ]);
  });

  it('asserts fragmented UTF-8 realtime decoding separately from ordinary-line removal', () => {
    const result = simulateFluidncV403DirectChannel([
      [G, UTF8_LEAD_C2],
      [COOLANT_FLOOD_TOGGLE, X, LINE_FEED],
    ]);

    expect(result.realtimeCommands).toEqual([
      { command: COOLANT_FLOOD_TOGGLE, dispatch: 'coolant-flood-toggle-event' },
    ]);
    expect(result.completedRecords[0]?.lineBytes).toEqual([G, X]);
  });

  it('retains only the first 254 ordinary bytes from a 255-byte direct record', () => {
    const payload = Array.from({ length: 255 }, () => G);
    const result = simulateFluidncV403DirectChannel([[...payload, LINE_FEED]]);

    expect(result.completedRecords[0]?.lineBytes).toHaveLength(254);
    expect(result.completedRecords[0]?.lineBytes).toEqual(payload.slice(0, 254));
  });

  it.each([0x01, 0x1b])('rejects unsupported editor control %s instead of modeling it', (byte) => {
    expect(() => simulateFluidncV403DirectChannel([[byte]], { isEditing: true })).toThrow(
      /outside this bounded model/,
    );
  });
});
