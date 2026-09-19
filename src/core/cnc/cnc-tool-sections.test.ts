import { describe, expect, it } from 'vitest';
import type { CncGroup } from '../job';
import { orderGroupsIntoToolSections } from './cnc-tool-sections';

function group(toolId: string, layerId: string, fields: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId,
    sourceObjectId: layerId,
    color: '#ff0000',
    cutType: 'pocket',
    toolId,
    layerPrimaryToolId: toolId,
    toolDiameterMm: 3,
    feedMmPerMin: 1000,
    plungeMmPerMin: 200,
    spindleRpm: 10000,
    spindleSpinupSec: 1,
    safeZMm: 5,
    passes: [],
    ...fields,
  };
}

describe('CNC tool sections with secondary clearing dependencies', () => {
  it('preserves ordinary tool grouping and keeps every profile after clearing', () => {
    const a = group('A', 'one');
    const b = group('B', 'two');
    const c = group('A', 'three');
    const profile = group('A', 'profile', { cutType: 'profile-outside' });
    expect(orderGroupsIntoToolSections([a, profile, b, c])).toEqual([a, c, b, profile]);
  });

  it('returns to the V-bit only after its later operation has actually cleared', () => {
    const first = group('V', 'first', { cutType: 'v-carve' });
    const clear = group('E', 'second', { layerPrimaryToolId: 'V' });
    const finish = group('V', 'second', { cutType: 'v-carve' });
    const original = [first, clear, finish];
    expect(orderGroupsIntoToolSections(original)).toEqual(original);
    expect(orderGroupsIntoToolSections(orderGroupsIntoToolSections(original))).toEqual(original);
  });

  it('waits for all earlier secondary tools while preserving same-tool source order', () => {
    const first = group('V', 'first');
    const rough = group('R', 'second', { layerPrimaryToolId: 'V' });
    const clear = group('E', 'second', { layerPrimaryToolId: 'V' });
    const finish = group('V', 'second');
    const later = group('V', 'third');
    expect(orderGroupsIntoToolSections([first, rough, clear, finish, later])).toEqual([
      first,
      rough,
      clear,
      finish,
      later,
    ]);
  });

  it.each(['different object', 'different layer'] as const)(
    'does not invent a dependency for a %s',
    (kind) => {
      const first = group('V', 'first');
      const clear = group('E', 'shared', { sourceObjectId: 'source', layerPrimaryToolId: 'V' });
      const finish = group('V', 'shared', {
        sourceObjectId: kind === 'different object' ? 'other' : 'source',
        layerId: kind === 'different layer' ? 'other' : 'shared',
      });
      expect(orderGroupsIntoToolSections([first, clear, finish])).toEqual([first, finish, clear]);
    },
  );

  it('resolves crossed tool reuse without reversing either operation dependency', () => {
    const first = group('A', 'first');
    const clearB = group('B', 'one', { layerPrimaryToolId: 'C' });
    const finishC = group('C', 'one');
    const clearC = group('C', 'two', { layerPrimaryToolId: 'B' });
    const finishB = group('B', 'two');
    expect(orderGroupsIntoToolSections([first, clearB, finishC, clearC, finishB])).toEqual([
      first,
      clearB,
      finishC,
      clearC,
      finishB,
    ]);
  });

  it.each(['shared primary', 'nested clearing target'] as const)(
    'clears with the large tool before a reused secondary rest tool with %s ownership',
    (ownership) => {
      const first = group('B', 'first');
      const large = group('C', 'carve', {
        layerPrimaryToolId: ownership === 'shared primary' ? 'V' : 'B',
      });
      const rest = group('B', 'carve', { layerPrimaryToolId: 'V' });
      const finish = group('V', 'carve', { cutType: 'v-carve' });
      expect(orderGroupsIntoToolSections([first, large, rest, finish])).toEqual([
        first,
        large,
        rest,
        finish,
      ]);
    },
  );

  it('retains deterministic tool rank across many ready sections and repeated groups', () => {
    const first = Array.from({ length: 2000 }, (_, index) =>
      group(`tool-${index}`, `first-${index}`),
    );
    const second = Array.from({ length: 2000 }, (_, index) =>
      group(`tool-${index}`, `second-${index}`),
    );
    expect(orderGroupsIntoToolSections([...first, ...second])).toEqual(
      first.flatMap((entry, index) => [entry, second[index]]),
    );
  });
});
