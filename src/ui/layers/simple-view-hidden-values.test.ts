// ADR-698: Simple view may hide a laser setting only while it is at the value
// a new operation has. Every other value it hides is listed with its value.
import { describe, expect, it } from 'vitest';
import { createLayer, type LayerMode } from '../../core/scene';
import { LAYER_OPERATION_SETTING_KEYS } from '../../core/scene/layer';
import {
  SIMPLE_VIEW_HIDDEN_SPECS,
  SIMPLE_VIEW_VISIBLE_KEYS,
  showsPowerMultiplier,
  simpleViewHiddenValues,
} from './simple-view-hidden-values';

function operation(mode: LayerMode, patch: Record<string, unknown> = {}) {
  return { ...createLayer({ id: 'op', color: '#000000', mode }), ...patch };
}

describe('Simple view hidden values', () => {
  it('classifies every operation setting, so a new one is never hidden by omission', () => {
    const classified = [...SIMPLE_VIEW_VISIBLE_KEYS, ...Object.keys(SIMPLE_VIEW_HIDDEN_SPECS)];
    expect([...classified].sort()).toEqual([...LAYER_OPERATION_SETTING_KEYS].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it.each(['line', 'fill', 'image'] as const)(
    'lists nothing for a new %s operation, whatever its power, speed and passes',
    (mode) => {
      expect(simpleViewHiddenValues(operation(mode, { power: 80, speed: 300, passes: 3 }))).toEqual(
        [],
      );
    },
  );

  it('lists each hidden Fill value that differs from a new operation, with its value', () => {
    const values = simpleViewHiddenValues(
      operation('fill', {
        hatchSpacingMm: 0.05,
        hatchAngleDeg: 45,
        fillBidirectional: false,
        airAssist: true,
      }),
    );
    expect(values.map((entry) => `${entry.label}: ${entry.value}`)).toEqual([
      'Air assist: on',
      'Angle: 45°',
      'Line spacing: 0.05 mm',
      'Scan both ways: off',
    ]);
  });

  it('lists only the settings the operation’s process uses', () => {
    const line = operation('line', { hatchSpacingMm: 0.05, linesPerMm: 20, kerfOffsetMm: 0.1 });
    expect(simpleViewHiddenValues(line).map((entry) => entry.key)).toEqual(['kerfOffsetMm']);
    const image = operation('image', { hatchSpacingMm: 0.05, linesPerMm: 20, kerfOffsetMm: 0.1 });
    expect(simpleViewHiddenValues(image).map((entry) => entry.key)).toEqual(['linesPerMm']);
  });

  it('lists the details of a switch only while that switch is on', () => {
    expect(simpleViewHiddenValues(operation('line', { tabSizeMm: 2 }))).toEqual([]);
    expect(
      simpleViewHiddenValues(operation('line', { tabsEnabled: true, tabSizeMm: 2 })).map(
        (entry) => entry.key,
      ),
    ).toEqual(['tabsEnabled', 'tabSizeMm']);
  });

  it('lists optional cut settings once they hold a value that changes the burn', () => {
    expect(simpleViewHiddenValues(operation('line', { overcutMm: 0 }))).toEqual([]);
    expect(simpleViewHiddenValues(operation('line', { overcutMm: 1.5 }))).toEqual([
      { key: 'overcutMm', label: 'Overcut', value: '1.5 mm' },
    ]);
    expect(simpleViewHiddenValues(operation('image', { imageOverscanMm: 5 }))).toEqual([]);
    expect(simpleViewHiddenValues(operation('image', { imageOverscanMm: 8 }))).toHaveLength(1);
  });

  it('keeps the artwork Power multiplier in sight unless every artwork is at 100%', () => {
    expect(showsPowerMultiplier(false, [{}])).toBe(true);
    expect(showsPowerMultiplier(true, [{}, { powerScale: 100 }])).toBe(false);
    expect(showsPowerMultiplier(true, [{}, { powerScale: 80 }])).toBe(true);
  });

  it('says a hidden setting differs between selected artworks instead of picking one value', () => {
    expect(simpleViewHiddenValues(operation('fill'), { hatchSpacingMm: true })).toEqual([
      {
        key: 'hatchSpacingMm',
        label: 'Line spacing',
        value: 'differs between the selected artwork',
      },
    ]);
  });
});
