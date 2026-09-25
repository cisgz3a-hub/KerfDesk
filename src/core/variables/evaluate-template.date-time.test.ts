import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type TextObject,
  type VariableDateTimeFormat,
} from '../scene';
import { evaluateVariableTemplate } from './evaluate-template';

const text: TextObject = {
  kind: 'text',
  id: 'T1',
  content: 'fallback',
  fontKey: 'roboto',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  color: '#ff0000',
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
};

function evaluate(format: VariableDateTimeFormat, now: Date) {
  return evaluateVariableTemplate(
    { tokens: [{ kind: 'date-time', format }] },
    text,
    createProject(),
    { now },
  );
}

// Presents an instant through a fixed zone's local-time methods without
// touching process.env.TZ, so these cases hold on every host, including UTC
// CI runners where local and UTC output would otherwise coincide.
function inZone(instant: string, utcOffsetMinutes: number): Date {
  const now = new globalThis.Date(instant);
  const wallClock = new globalThis.Date(now.getTime() + utcOffsetMinutes * 60_000);
  return Object.assign(now, {
    getFullYear: () => wallClock.getUTCFullYear(),
    getMonth: () => wallClock.getUTCMonth(),
    getDate: () => wallClock.getUTCDate(),
    getHours: () => wallClock.getUTCHours(),
    getMinutes: () => wallClock.getUTCMinutes(),
    getSeconds: () => wallClock.getUTCSeconds(),
    getTimezoneOffset: () => -utcOffsetMinutes,
  });
}

describe('evaluateVariableTemplate date and time fields', () => {
  it("prints this host's local date and 24-hour time for a local clock reading", () => {
    const now = new globalThis.Date(2026, 8, 24, 23, 30, 5);

    expect(evaluate('date-iso', now)).toEqual({ ok: true, value: '2026-09-24' });
    expect(evaluate('time-24h', now)).toEqual({ ok: true, value: '23:30:05' });
    const full = evaluate('datetime-iso', now);
    expect(full).toEqual({
      ok: true,
      value: expect.stringMatching(/^2026-09-24T23:30:05[+-]\d{2}:\d{2}$/),
    });
    // The printed offset ties the local fields back to the evaluated instant.
    expect(full.ok && Date.parse(full.value)).toBe(now.getTime());
  });

  it.each([
    {
      zone: 'UTC-04:00',
      instant: '2026-09-25T03:05:07Z',
      offset: -240,
      date: '2026-09-24',
      time: '23:05:07',
      full: '2026-09-24T23:05:07-04:00',
    },
    {
      zone: 'UTC-02:30',
      instant: '2026-09-25T01:00:00Z',
      offset: -150,
      date: '2026-09-24',
      time: '22:30:00',
      full: '2026-09-24T22:30:00-02:30',
    },
    {
      zone: 'UTC+05:30',
      instant: '2026-09-24T20:00:00Z',
      offset: 330,
      date: '2026-09-25',
      time: '01:30:00',
      full: '2026-09-25T01:30:00+05:30',
    },
    {
      zone: 'UTC+00:00',
      instant: '2026-09-24T20:00:00Z',
      offset: 0,
      date: '2026-09-24',
      time: '20:00:00',
      full: '2026-09-24T20:00:00+00:00',
    },
  ])('prints wall-clock fields for a host in $zone at $instant', (row) => {
    const now = inZone(row.instant, row.offset);

    expect(evaluate('date-iso', now)).toEqual({ ok: true, value: row.date });
    expect(evaluate('time-24h', now)).toEqual({ ok: true, value: row.time });
    expect(evaluate('datetime-iso', now)).toEqual({ ok: true, value: row.full });
    expect(Date.parse(row.full)).toBe(now.getTime());
  });
});
