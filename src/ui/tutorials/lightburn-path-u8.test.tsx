// The LightBurn beginner path (UX audit U8-P3-1 to U8-P3-4): the first-burn
// lesson, the Material Test's cut ranges and reading lines, the origin
// corner check and per-second speeds.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CUT_START_RANGES,
  offersCutStartRanges,
  withCutStartRanges,
} from '../calibration/material-test-cut-start';
import {
  DEFAULT_MATERIAL_TEST_DRAFT,
  withMaterialTestChoice,
  type MaterialTestDraft,
} from '../calibration/material-test-draft';
import {
  MATERIAL_TEST_READING,
  MATERIAL_TEST_SAFETY,
  MaterialTestGuidance,
} from '../calibration/MaterialTestGuidance';
import { ORIGIN_CHECK_HINT, OriginCornerPicker } from '../laser/DeviceProfileFields';
import { dimensionEntry, dimensionEntryError } from '../layers/dimension-entry';
import { findTutorial, TUTORIALS } from './tutorial-catalog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(element: JSX.Element): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

describe('Burn your first coaster (U8-P3-1)', () => {
  const lesson = findTutorial('first-burn');
  const text = (): string =>
    lesson === undefined
      ? ''
      : [lesson.summary, lesson.tip, ...lesson.steps.map((step) => step.instruction)].join(' ');

  it('is a laser Getting started lesson right after Make your first project', () => {
    expect(lesson).toMatchObject({ category: 'Getting started', machine: 'laser' });
    const ids = TUTORIALS.map((tutorial) => tutorial.id);
    expect(ids.indexOf('first-burn')).toBe(ids.indexOf('first-project') + 1);
    expect(findTutorial('first-project')?.related[0]).toBe('first-burn');
  });

  it('follows LightBurn First Project from safety to Start, in KerfDesk names', () => {
    const order = [
      'safety glasses',
      'Sort cuts last',
      'Material Test',
      'focus gauge or spacer',
      'Set origin here',
      'Frame job',
      'Start job',
    ];
    const at = order.map((phrase) => text().indexOf(phrase));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text()).toContain('never leave the laser while it runs');
  });
});

describe('Material Test for a cut (U8-P3-2)', () => {
  const cut: MaterialTestDraft = withMaterialTestChoice(
    DEFAULT_MATERIAL_TEST_DRAFT,
    'mode',
    'line',
  );

  it('offers cut starting ranges only for a Cut on the engraving ranges', () => {
    expect(offersCutStartRanges(cut)).toBe(true);
    expect(offersCutStartRanges(DEFAULT_MATERIAL_TEST_DRAFT)).toBe(false);
    expect(offersCutStartRanges(withCutStartRanges(cut))).toBe(false);
    expect(offersCutStartRanges({ ...cut, speedMax: '800' })).toBe(false);
  });

  it('sets 100 % power and varies speed and passes, as LightBurn advises', () => {
    expect(withCutStartRanges(cut)).toMatchObject({
      mode: 'line',
      rowParameter: 'speed',
      columnParameter: 'passes',
      speedMin: '60',
      speedMax: '600',
      power: '100',
      passesMin: '1',
      passesMax: '5',
    });
    expect(CUT_START_RANGES.power).toBe('100');
  });

  it('applies the ranges only when the operator chooses them, and says how to read the grid', () => {
    let applied: MaterialTestDraft | null = null;
    const view = render(<MaterialTestGuidance draft={cut} apply={(next) => (applied = next)} />);
    expect(view.textContent).toContain(MATERIAL_TEST_READING.line);
    expect(view.textContent).toContain(MATERIAL_TEST_SAFETY);
    expect(applied).toBeNull();
    const button = [...view.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Use cut starting ranges',
    );
    act(() => button?.click());
    expect(applied).toMatchObject({ power: '100', columnParameter: 'passes' });
  });

  it('shows no offer on an engraving test', () => {
    const view = render(
      <MaterialTestGuidance draft={DEFAULT_MATERIAL_TEST_DRAFT} apply={() => undefined} />,
    );
    expect(view.textContent).toContain(MATERIAL_TEST_READING.fill);
    expect(view.querySelector('button')).toBeNull();
  });
});

describe('the origin corner says how to check it (U8-P3-3)', () => {
  it('names the jog check and what upside down and mirrored mean', () => {
    const view = render(<OriginCornerPicker value="front-left" onChange={() => undefined} />);
    expect(view.textContent).toContain(ORIGIN_CHECK_HINT);
    expect(ORIGIN_CHECK_HINT).toContain('upside down, pick the other front/back corner');
    expect(ORIGIN_CHECK_HINT).toContain('mirrored, the other left/right corner');
  });
});

describe('a speed typed per second (U8-P3-4)', () => {
  const feed = (text: string, unit: 'mm' | 'in' = 'mm') => dimensionEntry(text, unit, 'feed');

  it('converts mm/s, mm/sec, cm/s and in/s to mm/min', () => {
    expect(feed('100 mm/s')).toEqual({ kind: 'ok', value: 6000 });
    expect(feed('100mm/sec')).toEqual({ kind: 'ok', value: 6000 });
    expect(feed('1.5 cm/s')).toEqual({ kind: 'ok', value: 900 });
    const inches = feed('1 in/s', 'in');
    expect(inches.kind === 'ok' ? inches.value : null).toBeCloseTo(25.4 * 60);
  });

  // Rolling audit v12 X5-P3-4: the unit covers the whole expression, as
  // "1/2 in" does in a length box; "1/2 mm/s" committed 1 mm/min.
  it('applies a per-second unit to the whole expression', () => {
    const close = (text: string, unit: 'mm' | 'in' = 'mm'): number | null => {
      const result = feed(text, unit);
      return result.kind === 'ok' ? result.value : null;
    };
    expect(close('1/2 mm/s')).toBeCloseTo(30);
    expect(close('60/2 mm/s')).toBeCloseTo(1_800);
    expect(close('1/2 in/s')).toBeCloseTo(762);
    expect(close('1/2 in/s', 'in')).toBeCloseTo(762);
    expect(close('50+50 mm/s')).toBeCloseTo(6_000);
    expect(close('(50+50) mm/s')).toBeCloseTo(6_000);
    expect(close('.5 mm/s')).toBeCloseTo(30);
  });

  it('refuses a per-second unit inside the expression rather than misread it', () => {
    for (const text of ['100 mm/s + 5', '2 mm/s * 3', '1 mm/s + 1 mm/s']) {
      expect(feed(text)).toEqual({
        kind: 'invalid',
        message: 'write mm/s once, after the whole speed, such as 1/2 mm/s',
      });
    }
  });

  it('keeps mm/min and bare numbers as they were', () => {
    expect(feed('100')).toEqual({ kind: 'ok', value: 100 });
    expect(feed('100 mm/min')).toEqual({ kind: 'ok', value: 100 });
  });

  it('names mm/s in the feed error', () => {
    expect(dimensionEntryError('fast', 'mm', 'feed')).toMatch(
      /^Enter a speed in mm\/min \(or type mm\/s\): /,
    );
    expect(dimensionEntryError('wide', 'mm', 'length')).toMatch(/^Enter a value in mm: /);
  });
});
