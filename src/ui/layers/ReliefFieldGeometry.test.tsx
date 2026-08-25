import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_RELIEF_LAYER_COLOR, IDENTITY_TRANSFORM } from '../../core/scene';
import type { HeightfieldReliefObject, ReliefHeightfieldMapping } from '../../core/scene/relief';
import { ReliefFieldGeometry } from './ReliefFieldGeometry';

// React exposes no narrower typed test seam for this documented act-environment flag.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

type ReliefFixture = {
  readonly width?: number;
  readonly height?: number;
  readonly physicalWidthMm?: number;
  readonly physicalHeightMm?: number;
  readonly crop?: ReliefHeightfieldMapping['crop'];
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotationDeg?: number;
  readonly mirrorX?: boolean;
  readonly mirrorY?: boolean;
};

function relief(input: ReliefFixture = {}): HeightfieldReliefObject {
  const width = input.width ?? 4;
  const height = input.height ?? 2;
  const physicalWidthMm = input.physicalWidthMm ?? 100;
  const physicalHeightMm = input.physicalHeightMm ?? 50;
  return {
    kind: 'relief',
    id: 'R1',
    source: 'field.png',
    targetWidthMm: physicalWidthMm,
    reliefDepthMm: 5,
    reliefSource: testReliefHeightfield({
      width,
      height,
      physicalWidthMm,
      physicalHeightMm,
      maxDepthMm: 5,
      ...(input.crop === undefined ? {} : { mapping: { crop: input.crop } }),
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: physicalWidthMm, maxY: physicalHeightMm },
    transform: {
      ...IDENTITY_TRANSFORM,
      scaleX: input.scaleX ?? 1,
      scaleY: input.scaleY ?? 1,
      rotationDeg: input.rotationDeg ?? 0,
      mirrorX: input.mirrorX ?? false,
      mirrorY: input.mirrorY ?? false,
    },
  };
}

async function render(object: HeightfieldReliefObject): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<ReliefFieldGeometry source={object.reliefSource} transform={object.transform} />),
  );
  return { host, root };
}

describe('ReliefFieldGeometry', () => {
  it('shows physical relief-axis size and full-crop nominal source-cell pitch', async () => {
    const { host, root } = await render(relief());
    try {
      const group = host.querySelector('[aria-label="Relief field geometry"]');
      expect(group?.textContent).toContain('Physical size (relief W × H)100 × 50 mm');
      expect(group?.textContent).toContain(
        'Nominal full source-cell pitch (relief X × Y)25 × 25 mm/cell',
      );
      expect(group?.textContent).toContain('Rotation and mirrors change orientation');
      expect(group?.textContent).toContain('Source sampling only—not preview or CAM spacing.');
      expect(group?.textContent).toContain(
        'Values round to six significant decimal digits with insignificant trailing zeros omitted; very large or small finite results use scientific notation.',
      );
      expect(group?.querySelector('input, select, button')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('uses crop span in the nominal pitch and discloses partial edge source cells', async () => {
    const { host, root } = await render(
      relief({
        width: 1,
        height: 1,
        physicalWidthMm: 12,
        physicalHeightMm: 12,
        crop: { kind: 'normalized-v1', x: 0.25, y: 0, width: 0.5, height: 1 },
      }),
    );
    try {
      expect(host.textContent).toContain('Physical size (relief W × H)12 × 12 mm');
      expect(host.textContent).toContain(
        'Nominal full source-cell pitch (relief X × Y)24 × 12 mm/cell',
      );
      expect(host.textContent).toContain('Cropped edge source cells can be smaller;');
      expect(host.textContent).toContain('nominal pitch can exceed the physical span.');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('uses absolute nonuniform scale while keeping rotation and mirrors out of magnitudes', async () => {
    const { host, root } = await render(
      relief({ scaleX: -0.5, scaleY: 2, rotationDeg: 37, mirrorX: true, mirrorY: true }),
    );
    try {
      expect(host.textContent).toContain('Physical size (relief W × H)50 × 100 mm');
      expect(host.textContent).toContain(
        'Nominal full source-cell pitch (relief X × Y)12.5 × 50 mm/cell',
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps a tiny positive pitch visible instead of rounding it to zero', async () => {
    const { host, root } = await render(
      relief({ width: 1_000, height: 1, physicalWidthMm: 1e-7, physicalHeightMm: 1 }),
    );
    try {
      expect(host.textContent).toContain(
        'Nominal full source-cell pitch (relief X × Y)1e-10 × 1 mm/cell',
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps a finite pitch beyond the binary64 result range in scientific notation', async () => {
    const { host, root } = await render(
      relief({
        width: 1,
        height: 1,
        physicalWidthMm: 1,
        physicalHeightMm: 1,
        crop: {
          kind: 'normalized-v1',
          x: 0,
          y: 0,
          width: Number.MIN_VALUE,
          height: 1,
        },
      }),
    );
    try {
      expect(host.textContent).toContain(
        'Nominal full source-cell pitch (relief X × Y)2.02402e+323 × 1 mm/cell',
      );
      expect(host.textContent).not.toContain('Infinity');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps a positive scaled size below the binary64 result range distinct from zero scale', async () => {
    const { host, root } = await render(
      relief({
        width: 1,
        height: 1,
        physicalWidthMm: Number.MIN_VALUE,
        physicalHeightMm: 1,
        scaleX: 0.5,
      }),
    );
    try {
      expect(host.textContent).toContain('Physical size (relief W × H)2.47033e-324 × 1 mm');
      expect(host.textContent).toContain(
        'Nominal full source-cell pitch (relief X × Y)2.47033e-324 × 1 mm/cell',
      );
      expect(host.querySelector('[role="note"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('retains useful significant digits across the old three-decimal rounding boundary', async () => {
    const { host, root } = await render(
      relief({
        width: 1,
        height: 1,
        physicalWidthMm: 0.0005001,
        physicalHeightMm: 0.0015001,
      }),
    );
    try {
      expect(host.textContent).toContain('Physical size (relief W × H)0.0005001 × 0.0015001 mm');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows zero-scale collapse as an informational compatibility state', async () => {
    const { host, root } = await render(relief({ scaleX: 0, scaleY: 0 }));
    try {
      expect(host.textContent).toContain('Physical size (relief W × H)0 × 0 mm');
      expect(host.textContent).toContain(
        'Nominal full source-cell pitch (relief X × Y)0 × 0 mm/cell',
      );
      expect(host.querySelector('[role="note"]')?.textContent).toBe(
        'Zero-scale compatibility: the X and Y relief axes are collapsed after planning, so physical carving geometry on those axes is not qualified.',
      );
    } finally {
      await act(async () => root.unmount());
    }
  });
});
