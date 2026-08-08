import { describe, expect, it } from 'vitest';
import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { cncGrblStrategy } from '../../core/output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type CncTool,
  type Scene,
} from '../../core/scene';
import { TABLER_LIBRARY_ENTRIES } from './design-library-tabler';
import { librarySvgObjectFor } from './library-entry-insert';

const VBIT_30: CncTool = {
  id: 'library-v30',
  name: '30 degree V-bit',
  kind: 'v-bit',
  diameterMm: 3.175,
  tipAngleDeg: 30,
};

describe('design-library V-carve compilation', () => {
  it('preserves the pinned round-stroke width for every bundled Tabler asset', async () => {
    const objects = await Promise.all(
      TABLER_LIBRARY_ENTRIES.map((entry, index) => librarySvgObjectFor(entry, `tabler-${index}`)),
    );

    objects.forEach((object, index) => {
      expect(object, TABLER_LIBRARY_ENTRIES[index]?.title).not.toBeNull();
      expect(object?.paths.length, TABLER_LIBRARY_ENTRIES[index]?.title).toBeGreaterThan(0);
      object?.paths.forEach((path) => {
        expect(path.strokeWidthMm, TABLER_LIBRARY_ENTRIES[index]?.title).toBeCloseTo(
          (2 * 25.4) / 96,
        );
      });
    });
  });

  it('emits V-carve motion for the bundled Apple artwork', async () => {
    const entry = TABLER_LIBRARY_ENTRIES.find(({ title }) => title === 'Apple');
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error('Expected the bundled Apple entry.');
    const object = await librarySvgObjectFor(entry, 'reported-library-apple');
    expect(object).not.toBeNull();
    if (object === null) throw new Error('Expected the Apple SVG object.');
    const color = object.paths[0]?.color;
    expect(color).toBeDefined();
    if (color === undefined) throw new Error('Expected the Apple path color.');
    const scene: Scene = {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'apple-vcarve', color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            depthMm: 3,
            depthPerPassMm: 0.5,
            vResolutionMm: 0.1,
          },
        },
      ],
    };

    const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [VBIT_30],
      toolId: VBIT_30.id,
    });
    const passes = job.groups.flatMap((group) =>
      group.kind === 'cnc' && group.cutType === 'v-carve'
        ? group.passes.filter((pass) => pass.kind === 'path3d')
        : [],
    );
    const passDepths = passes.map((pass) =>
      Number(Math.min(...pass.points.map((point) => point.z)).toFixed(3)),
    );
    const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

    expect(passDepths).toEqual([-0.5, -1, -1.5, -1.513, -0.5, -0.99]);
    expect(gcode).toContain('Z-1.513');
    expect(gcode).toContain('Z-0.990');
    expect(gcode).toMatch(/^G1?X-?\d+\.\d{3}Y-?\d+\.\d{3}Z-?\d+\.\d{3}/m);
  });

  it('keeps visible Tabler strokes when a decorative descendant is stroke none', async () => {
    const source = TABLER_LIBRARY_ENTRIES.find(({ title }) => title === 'Apple');
    if (source === undefined) throw new Error('Expected the bundled Apple entry.');
    const object = await librarySvgObjectFor(
      {
        ...source,
        title: 'Synthetic hidden stroke',
        insert: {
          kind: 'svg',
          loadSvgText: async () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
  width="24" height="24" fill="none" stroke="#000000" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M 2 2 L 22 2" />
  <path d="M 2 22 L 22 22" stroke="none" />
</svg>`,
        },
      },
      'synthetic-hidden-stroke',
    );

    expect(object?.paths).toHaveLength(1);
    expect(object?.paths[0]?.strokeWidthMm).toBeCloseTo((2 * 25.4) / 96);
  });

  it('keeps the Apple centerlines for engrave and materializes closed regions only for V-carve', async () => {
    const entry = TABLER_LIBRARY_ENTRIES.find(({ title }) => title === 'Apple');
    if (entry === undefined) throw new Error('Expected the bundled Apple entry.');
    const object = await librarySvgObjectFor(entry, 'library-apple-operation-semantics');
    if (object === null) throw new Error('Expected the Apple SVG object.');
    const color = object.paths[0]?.color;
    if (color === undefined) throw new Error('Expected the Apple path color.');
    const baseLayer = createLayer({ id: 'apple-operation', color });
    const engrave = collectLayerPolylines(
      [object],
      {
        ...baseLayer,
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' },
      },
      DEFAULT_DEVICE_PROFILE,
    );
    const vCarve = collectLayerPolylines(
      [object],
      {
        ...baseLayer,
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(engrave.some((polyline) => !polyline.closed)).toBe(true);
    expect(vCarve.length).toBeGreaterThan(0);
    expect(vCarve.every((polyline) => polyline.closed)).toBe(true);
  });
});
