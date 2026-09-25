import { describe, expect, it } from 'vitest';
import { createHpglState } from './hpgl-interpreter';
import { reservePoints } from './hpgl-types';
import { HPGL_IMPORT_ADVISORIES, parseHpgl } from './index';

function largeArtwork(text: string) {
  const result = parseHpgl({ text, id: 'large', source: 'large.plt' });
  if (result.kind !== 'ok' || result.object === null) throw new Error(JSON.stringify(result));
  const advisories = result.diagnostics.filter((diagnostic) => diagnostic.code === 'large-import');
  expect(advisories).toHaveLength(1);
  const advisory = advisories[0];
  if (advisory === undefined) throw new Error('Missing HPGL size advisory');
  expect(advisory.severity).toBe('warning');
  expect(result.notes).toContain(advisory.message);
  return { object: result.object, pathCount: result.pathCount, message: advisory.message };
}

describe('HPGL size advisories preserve complete artwork (ADR-268)', () => {
  it('imports drawable source beyond the former character ceiling', () => {
    const text = `CO "${'x'.repeat(HPGL_IMPORT_ADVISORIES.textLength)}";SP1;PD40,0;`;
    const result = largeArtwork(text);
    expect(result.object.bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 0 });
    expect(result.pathCount).toBe(1);
    expect(result.message).toContain(`${text.length.toLocaleString()} characters`);
  });

  it('retains every stroke beyond the former command and path ceilings', () => {
    const count = HPGL_IMPORT_ADVISORIES.paths + 1;
    const result = largeArtwork(`SP1;${'PU0,0;PD40,0;'.repeat(count)}`);
    expect(result.pathCount).toBe(count);
    expect(result.object.paths).toHaveLength(count);
    expect(result.object.paths.at(-1)?.polylines[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(result.message).toContain(`${(count * 2 + 1).toLocaleString()} commands`);
    expect(result.message).toContain(`${count.toLocaleString()} paths`);
  });

  it('consumes every parameter in one oversized coordinate command', () => {
    const pairs = HPGL_IMPORT_ADVISORIES.numbers / 2;
    const result = largeArtwork(`SP1;PU${'0,0,'.repeat(pairs)}80,0;PD120,0;`);
    expect(result.object.bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 0 });
    expect(result.object.paths[0]?.polylines[0]?.points).toHaveLength(2);
    expect(result.message).toContain(`${(pairs * 2 + 5).toLocaleString()} numeric parameters`);
    expect(result.message).toContain(`${(pairs + 2).toLocaleString()} generated points`);
  });

  it('retains all arc samples after crossing the former generated-point ceiling', () => {
    const result = largeArtwork(`SP1;PU40,0;PD;${'AA0,0,32767,.5;'.repeat(5)}`);
    expect(result.pathCount).toBe(1);
    expect(result.object.paths[0]?.polylines[0]?.points).toHaveLength(327_671);
    expect(result.message).toContain(`${(327_676).toLocaleString()} generated points`);
    expect(result.message).toContain(`${(327_671).toLocaleString()} output points`);
  });

  it('retains every repeated polygon beyond the former output-point ceiling', () => {
    const result = largeArtwork(`SP1;PM0;CI40,.5;PM2;${'EP;'.repeat(350)}`);
    expect(result.pathCount).toBe(350);
    expect(result.object.paths).toHaveLength(350);
    expect(result.object.paths.every((path) => path.polylines[0]?.points.length === 720)).toBe(
      true,
    );
    expect(result.object.paths.at(-1)?.polylines[0]?.closed).toBe(true);
    expect(result.message).toContain(`${(252_000).toLocaleString()} output points`);
  });
});

describe('HPGL generated-array representation', () => {
  it('checks each generated array against the JavaScript limit without capping total work', () => {
    const state = createHpglState();
    reservePoints(state, 2 ** 32 - 1);
    reservePoints(state, 2);
    expect(state.workPoints).toBe(2 ** 32 + 1);
    expect(() => reservePoints(state, 2 ** 32)).toThrow(/JavaScript array representation/);
    expect(state.workPoints).toBe(2 ** 32 + 1);
  });

  it.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid generated-point count %s before expansion',
    (count) => {
      const state = createHpglState();
      expect(() => reservePoints(state, count)).toThrow(/nonnegative safe integers/);
      expect(state.workPoints).toBe(0);
    },
  );
});
