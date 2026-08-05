import { describe, expect, it } from 'vitest';
import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { cncPassXyPoints } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type CncTool,
  type Scene,
} from '../../core/scene';
import { TABLER_LIBRARY_ENTRIES } from './design-library-tabler';
import { librarySvgObjectFor } from './library-entry-insert';

const VBIT_90: CncTool = {
  id: 'library-v90',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 6.35,
  tipAngleDeg: 90,
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
            depthPerPassMm: 2,
            vResolutionMm: 0.1,
          },
        },
      ],
    };

    const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [VBIT_90],
      toolId: VBIT_90.id,
    });
    const motionPoints = job.groups
      .filter((group) => group.kind === 'cnc')
      .flatMap((group) => group.passes)
      .flatMap(cncPassXyPoints);

    expect(motionPoints.length).toBeGreaterThan(0);
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
