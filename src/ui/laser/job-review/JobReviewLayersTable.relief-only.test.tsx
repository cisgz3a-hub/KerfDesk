// ADR-224 Amendment 4: an operation whose compiled job cuts only reliefs cuts
// no shape of its own cut type, so its Cut and Depth mm cells describe the
// reliefs. A layer holding only a 20 mm flat relief 3 mm deep, on the default
// On path operation (Cut depth 1 mm, 1.5 mm per pass), showed On path and 1
// while the relief roughed at 1.5 and 2.5 mm. The oracle is the relief
// compiler's own output, read back from the exact job the review shows.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../../__fixtures__/relief-heightfield';
import { compileCncJob } from '../../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type ReliefObject,
  type SceneObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { buildEffectiveOperationReview } from './job-review-effective-operations';
import { JobReviewLayersTable } from './JobReviewLayersTable';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const COLOR = '#a0522d';
const NAME = 'Carving';

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  resetStore();
  document.body.replaceChildren();
});

// A 20 mm relief with a flat floor 3 mm down.
function flatRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'floor',
    source: 'floor.png',
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      maxDepthMm: 3,
      samplesU8: [0],
    }),
    targetWidthMm: 20,
    reliefDepthMm: 3,
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
}

// A 20 mm square beside the relief, cut by the operation's own cut type.
function square(): ImportedSvg {
  const points = [
    { x: 40, y: 40 },
    { x: 60, y: 40 },
    { x: 60, y: 60 },
    { x: 40, y: 60 },
  ];
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines: [{ closed: true, points }] }],
  };
}

async function renderReview(
  objects: ReadonlyArray<SceneObject>,
  settings: Partial<CncLayerSettings> = {},
): Promise<HTMLElement> {
  const layer: Layer = {
    ...createLayer({ id: 'carving', color: COLOR }),
    name: NAME,
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...settings },
  };
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { ...EMPTY_SCENE, objects: [...objects], layers: [layer] },
    },
  });
  const job = compileCncJob(
    { objects: [...objects], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <JobReviewLayersTable
        machineKind="cnc"
        effectiveOperations={buildEffectiveOperationReview(job)}
      />,
    );
  });
  return host;
}

// The chip in the operation row's Cut column.
function cutChip(host: HTMLElement): HTMLElement | null {
  return host.querySelector('tbody tr td:nth-child(2) span');
}

function output(host: HTMLElement, label: string): HTMLOutputElement | null {
  return host.querySelector(`output[aria-label="${label} for ${NAME}"]`);
}

describe('JobReviewLayersTable for an operation that cuts only reliefs', () => {
  it('shows Relief and the deepest compiled relief pass instead of the cut type and Cut depth', async () => {
    const host = await renderReview([flatRelief()]);

    expect(cutChip(host)?.textContent).toBe('Relief');
    expect(cutChip(host)?.title).toBe(
      'This operation cuts only reliefs. Its cut type, On path, applies to other shapes only.',
    );
    // The 3 mm floor less the 0.5 mm Rough allowance, not the 1 mm Cut depth.
    expect(output(host, 'Cut depth mm')).toBeNull();
    expect(output(host, 'Actual compiled max depth mm')?.textContent).toBe('2.5 mm actual');
    // The relief roughs by Depth/pass, so that cell still describes the cut.
    expect(output(host, 'Depth per pass mm')?.textContent).toBe('1.5');
  });

  it('reads the depth from the finishing pass where it cuts below the roughing', async () => {
    const host = await renderReview([flatRelief()], { reliefFinishToolId: 'bn-3175' });

    // The ball nose cuts the allowance roughing leaves, down to the floor.
    expect(output(host, 'Actual compiled max depth mm')?.textContent).toBe('3 mm actual');
    expect(host.textContent).toContain('relief roughing 2 levels to 2.5 mm');
  });

  it('shows the relief depth, not Pending, on a flowing V-carve operation', async () => {
    const host = await renderReview([flatRelief()], {
      cutType: 'v-carve',
      vCarveFlatDepthEnabled: false,
    });

    expect(cutChip(host)?.title).toBe(
      'This operation cuts only reliefs. Its cut type, V-carve (angled bit), applies to other shapes only.',
    );
    expect(output(host, 'Actual compiled max depth mm')?.textContent).toBe('2.5 mm actual');
  });

  it('keeps the cut type and Cut depth while the operation also cuts other shapes', async () => {
    const host = await renderReview([square(), flatRelief()]);

    expect(cutChip(host)?.textContent).toBe('On path');
    expect(cutChip(host)?.hasAttribute('title')).toBe(false);
    expect(output(host, 'Cut depth mm')?.textContent).toBe('1');
    expect(output(host, 'Actual compiled max depth mm')).toBeNull();
  });
});
