// ADR-481 Amendment 1: the closed Entry & travel summary names how the bit
// enters the stock. Adaptive clearing enters each depth on its planner's own
// helix and skips the Ramp entry angle, so an adaptive pocket's summary names
// that helix, not a stored ramp and not a plunge. The angle still ramps the
// roughing of reliefs on the same operation (ADR-424), so there it is named as
// their entry. Every other cut type keeps its summary.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const COLOR = '#2f6f4e';
const ADAPTIVE: Partial<CncLayerSettings> = {
  cutType: 'pocket',
  pocketStrategy: 'adaptive',
  cutDirection: 'climb',
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});

function operation(settings: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id: 'entry-layer', color: COLOR }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...settings },
  };
}

// A 20 mm square: the shape the operation's cut type cuts.
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

function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'relief',
    source: 'fixture.stl',
    targetWidthMm: 10,
    reliefDepthMm: 2,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
      emptyCells: 'floor',
    },
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
  };
}

function ConnectedFields(): JSX.Element {
  const layer = useStore((state) => state.project.scene.layers[0]);
  if (layer === undefined) throw new Error('Operation missing');
  return <CncLayerFields layer={layer} />;
}

async function install(settings: Partial<CncLayerSettings>, withRelief = false): Promise<void> {
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        layers: [operation(settings)],
        objects: withRelief ? [square(), relief()] : [square()],
      },
    },
  });
  await act(async () => root.render(<ConnectedFields />));
}

function entryBadge(): string | null | undefined {
  const summary = [...host.querySelectorAll('summary')].find(
    (node) => node.firstElementChild?.textContent === 'Entry & travel',
  );
  if (summary === undefined) throw new Error('Entry & travel missing');
  return summary.querySelector('.lf-section-badge')?.textContent;
}

function storedRampDeg(): number | undefined {
  return useStore.getState().project.scene.layers[0]?.cnc?.rampEntryDeg;
}

async function chooseFill(value: string): Promise<void> {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Pocket fill method"]');
  if (select === null) throw new Error('Pocket fill method missing');
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Entry & travel summary on an adaptive pocket', () => {
  it('names the adaptive helix, not the stored ramp, and keeps the angle', async () => {
    await install({ ...ADAPTIVE, rampEntryDeg: 5 });

    expect(entryBadge()).toBe('Climb · Adaptive helix');
    const ramp = host.querySelector<HTMLInputElement>(
      `input[aria-label="Ramp entry angle for ${COLOR}"]`,
    );
    expect(ramp?.value).toBe('5');
    expect(storedRampDeg()).toBe(5);
  });

  it('names the helix rather than a plunge when no ramp is stored', async () => {
    await install(ADAPTIVE);

    expect(entryBadge()).toBe('Climb · Adaptive helix');
  });

  it('names the angle as the entry of reliefs on the same operation', async () => {
    await install({ ...ADAPTIVE, rampEntryDeg: 5 }, true);
    expect(entryBadge()).toBe('Climb · Adaptive helix · Relief ramp 5°');

    await install(ADAPTIVE, true);
    expect(entryBadge()).toBe('Climb · Adaptive helix · Relief plunge');
  });

  it('follows the fill method both ways and leaves the stored angle alone', async () => {
    await install({ cutType: 'pocket', cutDirection: 'climb', rampEntryDeg: 5 });
    expect(entryBadge()).toBe('Climb · Ramp 5°');

    await chooseFill('adaptive');
    expect(entryBadge()).toBe('Climb · Adaptive helix');
    expect(storedRampDeg()).toBe(5);

    await chooseFill('offset');
    expect(entryBadge()).toBe('Climb · Ramp 5°');
  });

  // The summary's oracle is the compiler: the operation compiles to the same
  // passes with and without the angle, and each depth starts on a helix.
  it('matches the compiled job, where the angle changes no adaptive pass', () => {
    const passes = (settings: Partial<CncLayerSettings>) =>
      compileCncJob(
        { objects: [square()], layers: [operation(settings)] },
        DEFAULT_DEVICE_PROFILE,
        DEFAULT_CNC_MACHINE_CONFIG,
      ).groups.flatMap((group) => (group.kind === 'cnc' ? group.passes : []));
    const pocket = { ...ADAPTIVE, adaptiveOptimalLoadMm: 0.8, depthMm: 3, depthPerPassMm: 1.5 };
    const ramped = passes({ ...pocket, rampEntryDeg: 5 });

    expect(ramped[0]?.kind).toBe('helical-contour');
    expect(ramped.filter((pass) => pass.kind === 'helical-contour')).toHaveLength(2);
    expect(ramped).toEqual(passes(pocket));
  });
});

describe('Entry & travel summary on other operations', () => {
  it.each<{
    readonly name: string;
    readonly settings: Partial<CncLayerSettings>;
    readonly withRelief?: boolean;
    readonly badge: string;
  }>([
    {
      name: 'an offset pocket',
      settings: { cutType: 'pocket', cutDirection: 'climb', rampEntryDeg: 5 },
      badge: 'Climb · Ramp 5°',
    },
    {
      name: 'a raster pocket',
      settings: { cutType: 'pocket', pocketStrategy: 'raster-x' },
      badge: 'Climb · Plunge',
    },
    {
      name: 'a helical pocket',
      settings: {
        cutType: 'pocket',
        helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
      },
      badge: 'Climb · Circular ramp',
    },
    {
      name: 'an offset pocket carrying reliefs',
      settings: { cutType: 'pocket', rampEntryDeg: 5 },
      withRelief: true,
      badge: 'Climb · Ramp 5°',
    },
    {
      name: 'an outside profile',
      settings: { cutType: 'profile-outside', cutDirection: 'conventional' },
      badge: 'Conventional · Plunge',
    },
    { name: 'an engrave', settings: { cutType: 'engrave', rampEntryDeg: 2 }, badge: 'Ramp 2°' },
    {
      name: 'a V-carve',
      settings: { cutType: 'v-carve', vCarveRampEntryDeg: 3 },
      badge: 'Profile entry',
    },
    { name: 'a fresh V-carve', settings: { cutType: 'v-carve' }, badge: 'Profile entry' },
  ])('keeps the summary of $name', async ({ settings, withRelief, badge }) => {
    await install(settings, withRelief);

    expect(entryBadge()).toBe(badge);
  });
});
