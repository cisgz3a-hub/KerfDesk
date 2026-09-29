// ADR-258 Amendment 4, end to end: the tab part of an operation's line comes
// from the exact job the review shows, so an open path cut through the stock is
// promised no tabs while a closed part beside it keeps them.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileCncJob } from '../../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
} from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { buildEffectiveOperationReview } from './job-review-effective-operations';
import { JobReviewLayersTable } from './JobReviewLayersTable';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  resetStore();
});

// Imported artwork of one polyline, bound to the operation of its colour.
function artwork(id: string, color: string, polyline: Polyline): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [polyline] }],
  };
}

const LINE: Polyline = {
  closed: false,
  points: [
    { x: 50, y: 70 },
    { x: 90, y: 70 },
  ],
};

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 120, y: 50 },
    { x: 160, y: 50 },
    { x: 160, y: 90 },
    { x: 120, y: 90 },
  ],
};

describe('JobReviewLayersTable compiled tabs', () => {
  it('names tabs only for the operations whose compiled passes rise into them', async () => {
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      depthMm: 6.6,
      depthPerPassMm: 2,
      tabsEnabled: true,
    };
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 6 },
    };
    const scene = {
      ...EMPTY_SCENE,
      objects: [artwork('line', '#ff0000', LINE), artwork('part', '#0000ff', SQUARE)],
      layers: [
        { ...createLayer({ id: 'line', color: '#ff0000' }), cnc: settings },
        { ...createLayer({ id: 'part', color: '#0000ff' }), cnc: settings },
      ],
    };
    useStore.setState({ project: { ...createProject(), machine, scene } });
    const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, machine);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <JobReviewLayersTable
          machineKind="cnc"
          effectiveOperations={buildEffectiveOperationReview(job, scene)}
        />,
      );
    });

    const cells = [...host.querySelectorAll('td')].map((cell) => cell.textContent);
    expect(cells).toContain('4 passes · stepover 40% · Manual feeds');
    expect(cells).toContain(
      '4 passes · stepover 40% · tabs 4 per shape (6 × 2 mm) above the stock bottom · Manual feeds',
    );
  });
});
