import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createProject } from '../scene';
import { compileJob } from './compile-job';
import {
  FOCUS_TEST_Z_TRAVEL_EXCEEDED_WARNING,
  FOCUS_TEST_Z_UNCONFIRMED_WARNING,
  focusTestOptionsIssue,
  generateFocusTest,
  focusTestWarnings,
  type FocusTestOptions,
} from './focus-test';
import { grblStrategy } from '../output/grbl-strategy';
import { serializeProject } from '../../io/project/serialize-project';
import { deserializeProject } from '../../io/project/deserialize-project';

const OPTIONS: FocusTestOptions = {
  steps: 5,
  minOffsetMm: -1,
  maxOffsetMm: 1,
  speed: 1200,
  power: 10,
  lineLengthMm: 20,
  spacingMm: 3,
  travelFeedMmPerMin: 300,
};
function program(options = OPTIONS): string {
  return grblStrategy.emit(
    compileJob(generateFocusTest(options), DEFAULT_DEVICE_PROFILE),
    DEFAULT_DEVICE_PROFILE,
  );
}

describe('Focus Test', () => {
  it('creates ordered, bound samples with represented offsets and no invented Z datum', () => {
    const scene = generateFocusTest(OPTIONS);
    expect(scene.layers.map((layer) => layer.focusTest?.offsetMm)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(scene.objects.map((object) => object.operationIds?.[0])).toEqual(
      scene.layers.map((layer) => layer.id),
    );
    expect(scene.layers[1]?.name).toContain('-0.500');
    expect(program()).not.toMatch(/G92|G10|G53|G28|G30/);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects nonfinite settings %s',
    (value) => {
      for (const key of Object.keys(OPTIONS))
        expect(() => generateFocusTest({ ...OPTIONS, [key]: value })).toThrow('finite');
    },
  );
  it.each([
    { steps: 1 },
    { steps: 102 },
    { steps: 2.5 },
    { minOffsetMm: 2 },
    { minOffsetMm: -1001 },
    { speed: 0 },
    { power: 101 },
    { power: 0 },
    { spacingMm: 0 },
    { travelFeedMmPerMin: -1 },
    { maxOffsetMm: -0.999 },
  ])('rejects invalid and collapsed sweeps %j', (patch) => {
    expect(focusTestOptionsIssue({ ...OPTIONS, ...patch })).not.toBeNull();
  });
  it('keeps every Z move off, relative, bounded-feed and paired; all burns are absolute', () => {
    const text = program({ ...OPTIONS, travelFeedMmPerMin: 9000 });
    let relative = false;
    let mode = 'M5';
    let z = 0;
    let zMoves = 0;
    for (const line of text.split('\n')) {
      if (/^M[345]\b/.test(line)) mode = line.split(' ')[0] ?? '';
      if (line === 'G91') relative = true;
      if (line === 'G90') relative = false;
      const zWord = /\bZ(-?[\d.]+)/.exec(line);
      if (zWord !== null) {
        expect(relative).toBe(true);
        expect(mode).toBe('M5');
        expect(line).toContain('S0');
        expect(line).toContain('F6000');
        z += Number(zWord[1]);
        zMoves += 1;
        expect(Math.abs(z)).toBeLessThanOrEqual(1);
      }
      if (/\bS100\b/.test(line)) expect(relative).toBe(false);
    }
    expect(zMoves).toBe(8);
    expect(z).toBe(0);
    expect(relative).toBe(false);
  });
  it('emits a real dark XY move before stopping constant-power samples for Z return', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      gcodeDialect: { dialectId: 'grbl-compatible' as const },
    };
    const scene = generateFocusTest(OPTIONS);
    const text = grblStrategy.emit(compileJob(scene, device), device);
    expect(text).toMatch(/G1 X[^\n]+ S100\nG0 X[^\n]+ S0\nM5\nG91\nG1 Z/);
  });
  it('supports stress-size sweeps with deterministic bounded output', () => {
    const options = { ...OPTIONS, steps: 101, minOffsetMm: -5, maxOffsetMm: 5 };
    const text = program(options);
    expect(text).toBe(program(options));
    expect((text.match(/; Focus Test Z offset/g) ?? []).length).toBe(101);
    expect(text.length).toBeLessThan(100000);
  });
  it('does not silently drop unsupported controller or mode semantics', () => {
    const scene = generateFocusTest(OPTIONS);
    expect(() =>
      compileJob(scene, { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'marlin' }),
    ).toThrow('GRBL');
    expect(() =>
      compileJob(
        {
          ...scene,
          layers: scene.layers.map((layer) => ({ ...layer, mode: 'fill' })),
          objects: scene.objects.map((object) =>
            object.kind !== 'imported-svg'
              ? object
              : {
                  ...object,
                  paths: object.paths.map((path) => ({
                    ...path,
                    polylines: [
                      {
                        closed: true,
                        points: [
                          { x: 0, y: 0 },
                          { x: 20, y: 0 },
                          { x: 20, y: 10 },
                          { x: 0, y: 10 },
                        ],
                      },
                    ],
                  })),
                },
          ),
        },
        DEFAULT_DEVICE_PROFILE,
      ),
    ).toThrow('Line mode');
  });
  it('retains focus intent through saving/loading and rejects malformed persisted offsets', () => {
    const project = { ...createProject(), scene: generateFocusTest(OPTIONS) };
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.kind, JSON.stringify(loaded)).toBe('ok');
    if (loaded.kind === 'ok')
      expect(loaded.project.scene.layers.map((layer) => layer.focusTest)).toEqual(
        project.scene.layers.map((layer) => layer.focusTest),
      );
    const bad = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({
          ...layer,
          focusTest: { offsetMm: 0.00001, travelFeedMmPerMin: 300 },
        })),
      },
    };
    expect(deserializeProject(serializeProject(bad)).kind).toBe('invalid');
  });
  it('discloses missing Z qualification and insufficient travel as warnings', () => {
    const warnings = focusTestWarnings(generateFocusTest(OPTIONS).layers, {
      ...DEFAULT_DEVICE_PROFILE,
      zTravelMm: 1,
    });
    expect(warnings.join(' ')).toContain('Frame traces XY only');
    expect(warnings.join(' ')).toContain('exceeds');
    // Job Review lists Focus warnings first: the unconfirmed Z axis leads.
    expect(warnings[0]).toBe(FOCUS_TEST_Z_UNCONFIRMED_WARNING);
    expect(warnings[1]).toBe(FOCUS_TEST_Z_TRAVEL_EXCEEDED_WARNING);
  });
  it('gives every sample a distinct, unique operation colour', () => {
    const colors = generateFocusTest({
      ...OPTIONS,
      steps: 101,
      minOffsetMm: -5,
      maxOffsetMm: 5,
    }).layers.map((layer) => layer.color);
    expect(new Set(colors).size).toBe(101);
    const rgb = (hex: string): number[] =>
      [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
    const [a, b] = [colors[1], colors[2]].map((color) => rgb(color ?? '#000000'));
    const distance = Math.hypot(...(a ?? []).map((value, index) => value - (b?.[index] ?? 0)));
    expect(distance).toBeGreaterThan(100);
  });
});
