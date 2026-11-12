// K40 burn speeds and doses (ADR-703 Amendment 2, C2 verification E2-P1-1,
// E2-P1-2, E2-P2-3 and E2-P3-3): rotary strokes run speed classes 5 % apart
// from the layer speed, a speed below the board's slowest runs at it and says
// so, and the export names burned tabs and air the board cannot set.

import { describe, expect, it } from 'vitest';
import { LhyDecoder } from '../../../__fixtures__/controllers/lihuiyu-decoder';
import type { CutGroup, Job } from '../../job';
import { rotaryFeedMatchFor } from '../../output/rotary-surface-feed';
import { egvAdvisories } from '../../../io/egv/egv-advisories';
import { lhySlowestMmPerSec } from './lhy-burn-speed';
import { encodeLhyJob, lhyBoardSetting, type LhyEncodeOptions } from './lhy-encoder';
import { lhySpeedCode, parseLhySpeedCode } from './lhy-speed-code';

const M2: LhyEncodeOptions = { board: lhyBoardSetting('M2'), fullPowerPerMille: 1000 };
const M3: LhyEncodeOptions = { board: lhyBoardSetting('M3-pwm'), fullPowerPerMille: 1000 };
// The Creality chuck (40 mm a turn) round an Ø80 glass: k = 40 / (π · 80).
const K_80 = 40 / (Math.PI * 80);

function cut(speed: number, polyline: CutGroup['segments'][number]['polyline']): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#f00',
    power: 100,
    speed,
    passes: 1,
    airAssist: false,
    segments: [{ polyline, closed: false }],
  };
}

// A 20 mm stroke along X, then 20 mm of surface round the part.
function corner(speed: number, k: number): Job {
  const group = cut(speed, [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 10 + 20 * k },
  ]);
  return { groups: [group], rotarySurfaceYScale: k };
}

function encoded(job: Job, options: LhyEncodeOptions = M2) {
  const rotaryFeed = rotaryFeedMatchFor(job, 30000);
  const result = encodeLhyJob(job, {
    ...options,
    ...(rotaryFeed === undefined ? {} : { rotaryFeed }),
  });
  if (!result.ok) throw new Error(result.error.kind);
  return result;
}

function messages(job: Job, options: LhyEncodeOptions = M2): string[] {
  return egvAdvisories(encoded(job, options), options.board, job).map((issue) => issue.message);
}

describe('K40 slowest speed (E2-P1-2)', () => {
  it('is 23.49 mm/min on an M2 or M3 with suffix C', () => {
    expect(lhySlowestMmPerSec('M2', true) * 60).toBeCloseTo(23.49, 2);
    expect(lhySlowestMmPerSec('M3', true)).toBe(lhySlowestMmPerSec('M2', true));
    // Slower than that, the code's period is the slowest period.
    const period = (mmPerSec: number) =>
      parseLhySpeedCode(lhySpeedCode(mmPerSec, { board: 'M2', suffixC: true })).value;
    expect(period(0.1)).toBe(period(lhySlowestMmPerSec('M2', true)));
    expect(period(0.5)).not.toBe(period(lhySlowestMmPerSec('M2', true)));
  });

  it('names the speed a slower layer runs at and the dose it gets', () => {
    const job: Job = {
      groups: [
        cut(6, [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ]),
      ],
    };
    expect(encoded(job).layerDoses).toEqual([
      {
        layerId: 'L1',
        minDose: expect.closeTo(6 / 23.49, 3),
        maxDose: expect.closeTo(0.2554, 3),
        rotary: false,
      },
    ]);
    expect(messages(job)).toContain(
      'Layer L1: a K40 board runs no slower than 23.5 mm/min, so its 6 mm/min runs at 23.5 mm/min (26 % of the set dose).',
    );
  });

  it('says nothing at an ordinary speed', () => {
    const job: Job = {
      groups: [
        cut(600, [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ]),
      ],
    };
    expect(messages(job).some((message) => message.includes('set dose'))).toBe(false);
  });
});

describe('K40 rotary speed classes (E2-P1-1)', () => {
  it.each([300, 600, 1200])(
    'keeps every stroke within 2.5 %% of its dose at %i mm/min on an Ø80 glass',
    (speed) => {
      const result = encoded(corner(speed, K_80));
      const [dose] = result.layerDoses;
      expect(dose?.minDose).toBeGreaterThanOrEqual(0.975);
      expect(dose?.maxDose).toBeLessThanOrEqual(1.025);
      expect(messages(corner(speed, K_80)).some((m) => m.includes('set dose'))).toBe(false);
    },
  );

  it('runs a stroke along X at exactly the layer speed', () => {
    const job = corner(600, K_80);
    const decoder = new LhyDecoder();
    decoder.writeStream(encoded(job).stream);
    expect(decoder.speedCodes[0]).toBe(
      lhySpeedCode(10, { board: 'M2', suffixC: true }).replace(/C$/, ''),
    );
  });

  it('names the dose when strokes round the part fall below the slowest speed', () => {
    // 120 mm/min round an Ø80 glass is 0.32 mm/s of machine Y: below 0.39.
    const result = encoded(corner(120, K_80));
    expect(result.layerDoses[0]?.minDose).toBeCloseTo(
      (2 * K_80) / lhySlowestMmPerSec('M2', true),
      2,
    );
    expect(messages(corner(120, K_80))).toContain(
      'Layer L1: on the rotary, strokes burn between 81 % and 100 % of the set dose: a K40 board runs no slower than 23.5 mm/min, within Max feed.',
    );
  });
});

describe('K40 power the board cannot set (E2-P2-3, E2-P3-3)', () => {
  // A 100 % layer with burned tabs at 20 %: the tab group runs at 20 %.
  function tabbed(airAssist = false): Job {
    const main = cut(600, [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
    ]);
    const tabs: CutGroup = {
      ...cut(600, [
        { x: 30, y: 10 },
        { x: 31, y: 10 },
      ]),
      power: 20,
      tabSpanPowerPercent: 20,
    };
    return {
      groups: [
        { ...main, airAssist },
        { ...tabs, airAssist },
      ],
    };
  }

  it('names burned tabs on an M2, not the 100 % layer as below 100 %', () => {
    const notes = messages(tabbed());
    expect(notes).toContain(
      "Layer L1: its burned tabs are set to 20 % of the cut, but the M2 board has no software power control, so they burn at the power the machine's current knob sets and cut through. Set the tab power to 0 % to leave the tabs uncut.",
    );
    expect(notes.some((note) => note.includes('below 100 %'))).toBe(false);
  });

  it('says nothing of tabs on an M3, whose PWM sets the tab power', () => {
    expect(messages(tabbed(), M3).some((note) => note.includes('burned tabs'))).toBe(false);
  });

  it('says the board cannot switch air', () => {
    expect(messages(tabbed(true), M3)).toContain(
      'Air assist is on for layer L1, but a M3 board has no air output KerfDesk can switch. Run the air from the machine.',
    );
  });
});
