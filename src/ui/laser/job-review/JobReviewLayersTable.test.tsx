import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../../__fixtures__/relief-heightfield';
import { compileCncJob } from '../../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { CncGroup, Job } from '../../../core/job';
import {
  createLayer,
  createLayerSubLayer,
  createRegistrationLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type ReliefObject,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import {
  buildEffectiveOperationReview,
  type JobReviewEffectiveOperation,
} from './job-review-effective-operations';
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

function seedLayers(layers: ReadonlyArray<Layer>, machineKind: 'laser' | 'cnc'): void {
  useStore.setState({
    project: {
      ...createProject(),
      ...(machineKind === 'cnc' ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
      scene: { ...EMPTY_SCENE, objects: [], layers: [...layers] },
    },
  });
}

async function render(
  machineKind: 'laser' | 'cnc',
  effectiveOperations: ReadonlyArray<JobReviewEffectiveOperation> = [],
): Promise<void> {
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <JobReviewLayersTable machineKind={machineKind} effectiveOperations={effectiveOperations} />,
    );
  });
}

function numberInput(label: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input "${label}" not found`);
  return input;
}

async function typeAndBlur(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

function storedLayer(id: string): Layer {
  const layer = useStore.getState().project.scene.layers.find((entry) => entry.id === id);
  if (layer === undefined) throw new Error(`Layer ${id} missing from the store`);
  return layer;
}

function cellTexts(): ReadonlyArray<string | null> {
  return [...host.querySelectorAll('td')].map((cell) => cell.textContent);
}

// A 20 mm relief with a flat floor `depthMm` down, moved `xMm` along X.
function flatRelief(id: string, depthMm: number, xMm: number): ReliefObject {
  return {
    kind: 'relief',
    id,
    source: `${id}.png`,
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      maxDepthMm: depthMm,
      samplesU8: [0],
    }),
    targetWidthMm: 20,
    reliefDepthMm: depthMm,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: { ...IDENTITY_TRANSFORM, x: xMm },
  };
}

// Compile the reliefs on one default operation, then review that exact job.
async function renderCompiledReliefs(reliefs: ReadonlyArray<ReliefObject>): Promise<void> {
  const layer: Layer = {
    ...createLayer({ id: 'relief', color: '#a0522d' }),
    cnc: DEFAULT_CNC_LAYER_SETTINGS,
  };
  seedLayers([layer], 'cnc');
  useStore.setState((state) => ({
    project: { ...state.project, scene: { ...state.project.scene, objects: [...reliefs] } },
  }));
  const job = compileCncJob(
    { objects: [...reliefs], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  await render('cnc', buildEffectiveOperationReview(job));
}

function ring(zMm: number): CncGroup['passes'][number] {
  return {
    kind: 'contour',
    zMm,
    closed: true,
    polyline: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  };
}

function cncGroup(cutType: CncGroup['cutType'], passes: CncGroup['passes']): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'relief',
    color: '#a0522d',
    cutType,
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12_000,
    spindleSpinupSec: 2,
    safeZMm: 5,
    passes,
  };
}

describe('JobReviewLayersTable', () => {
  it('edits laser power/speed/passes through the store with clamping, and toggles air', async () => {
    const layer = createLayer({ id: 'red', color: '#ff0000' });
    seedLayers([layer], 'laser');
    await render('laser');

    await typeAndBlur(numberInput(`Power % for ${layer.name}`), '55');
    expect(storedLayer('red').power).toBe(55);

    await typeAndBlur(numberInput(`Speed mm/min for ${layer.name}`), '999999');
    expect(storedLayer('red').speed).toBe(useStore.getState().project.device.maxFeed);

    await typeAndBlur(numberInput(`Passes for ${layer.name}`), '2.7');
    expect(storedLayer('red').passes).toBe(2);

    const air = host.querySelector(`input[aria-label="Air assist for ${layer.name}"]`);
    if (!(air instanceof HTMLInputElement)) throw new Error('Air checkbox not found');
    await act(async () => air.click());
    expect(storedLayer('red').airAssist).toBe(true);
  });

  it('rejects non-decimal English number syntax with accessible feedback and preserves the value', async () => {
    const layer = createLayer({ id: 'red', color: '#ff0000' });
    seedLayers([layer], 'laser');
    await render('laser');
    const input = numberInput(`Power % for ${layer.name}`);

    await typeAndBlur(input, '1e2');

    expect(storedLayer('red').power).toBe(layer.power);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).toContain('decimal point');
  });

  it('shows only output-enabled operations', async () => {
    const on = createLayer({ id: 'on', color: '#ff0000' });
    const off = { ...createLayer({ id: 'off', color: '#00ff00' }), output: false };
    seedLayers([on, off], 'laser');
    await render('laser');

    expect(host.querySelectorAll('input[aria-label^="Power % for"]')).toHaveLength(1);
  });

  it('shows CNC operation values read-only without mutating the store', async () => {
    const layer = createLayer({ id: 'red', color: '#ff0000' });
    seedLayers([layer], 'cnc');
    await render('cnc');

    expect(host.querySelectorAll('input')).toHaveLength(0);
    expect(
      host.querySelector(`output[aria-label="Feed mm/min for ${layer.name}"]`)?.textContent,
    ).toBe('1,000');
    expect(storedLayer('red').cnc).toBeUndefined();
    expect(host.textContent).toContain('read-only — edit operation values in Artwork settings');
  });

  it('shows compiled actual depth instead of an inert cut-depth editor for flowing V-carve', async () => {
    const base = createLayer({ id: 'script', color: '#000000' });
    const layer: Layer = {
      ...base,
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'v-carve',
        vCarveFlatDepthEnabled: false,
      },
    };
    seedLayers([layer], 'cnc');
    await render('cnc', [
      {
        layerId: 'script',
        summaries: ['Actual max depth 3.175 mm'],
        cncActualMaxDepthMm: 3.175,
      },
    ]);

    expect(host.querySelector(`input[aria-label="Cut depth mm for ${layer.name}"]`)).toBeNull();
    const actual = host.querySelector(
      `output[aria-label="Actual compiled max depth mm for ${layer.name}"]`,
    );
    expect(actual?.textContent).toBe('3.175 mm actual');
    expect(host.textContent).toContain(
      'Partial compiled summary (groups with matching shown values are combined): Actual max depth 3.175 mm',
    );
    expect(
      host.querySelector(`output[aria-label="Depth per pass mm for ${layer.name}"]`)?.textContent,
    ).toBe('1.5');
  });

  it('states plainly when nothing has Output enabled', async () => {
    const off = { ...createLayer({ id: 'off', color: '#00ff00' }), output: false };
    seedLayers([off], 'laser');
    await render('laser');

    expect(host.textContent).toContain('No operations have Output enabled');
  });

  it('shows the mode-specific detail line under a laser operation', async () => {
    seedLayers([createLayer({ id: 'red', color: '#ff0000' })], 'laser');
    await render('laser');

    expect(host.textContent).toContain('Artwork settings');
    expect(host.textContent).toContain(
      'Kerf 0 mm · stored contour entry target 5 mm · tabs off · min power 0%',
    );
  });

  it('identifies the registration jig outline operation and its exact outline count', async () => {
    const registration = createRegistrationLayer();
    const first = {
      ...createRectangle({
        id: 'jig-1',
        color: registration.color,
        spec: { widthMm: 80, heightMm: 40, cornerRadiusMm: 0 },
      }),
      operationIds: [registration.id],
    };
    const second = { ...first, id: 'jig-2' };
    seedLayers([registration], 'laser');
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, objects: [first, second] },
      },
    }));
    await render('laser');

    expect(host.textContent).toContain('Registration jig outline operation (2 outlines)');
    expect(numberInput('Power % for Registration jig').value).toBe(String(registration.power));
  });

  it('keeps editable base values while labeling combined compiled summaries as partial', async () => {
    const layer = { ...createLayer({ id: 'red', color: '#ff0000' }), power: 30 };
    seedLayers([layer], 'laser');
    const base = {
      kind: 'cut' as const,
      layerId: 'red',
      color: '#ff0000',
      power: 15,
      speed: 1000,
      passes: 1,
      airAssist: false,
      powerMode: 'constant' as const,
      segments: [],
    };
    const summaries = buildEffectiveOperationReview({
      groups: [base, base, { ...base, power: 30 }],
    });
    await render('laser', summaries);

    expect(numberInput(`Power % for ${layer.name}`).value).toBe('30');
    expect(host.textContent).toContain(
      'Partial compiled summary (groups with matching shown values are combined): Line · 15% power',
    );
    expect(host.textContent?.match(/Line · 15% power/g)).toHaveLength(1);
    expect(host.textContent).toContain('Line · 30% power');
  });

  it('matches sublayer review summaries by the compiler canonical operation id', async () => {
    const base = createLayer({ id: 'red', color: '#ff0000' });
    const subLayer = createLayerSubLayer(base, { id: 'sub-1', label: 'Second pass' });
    seedLayers([{ ...base, subLayers: [subLayer] }], 'laser');
    await render('laser', [
      {
        layerId: 'red:sub-1',
        summaries: ['Line · 21% power · 900 mm/min · 1 pass · air off · constant power'],
      },
    ]);

    expect(host.textContent).toContain('Second pass');
    expect(host.textContent).toContain(
      'Partial compiled summary (groups with matching shown values are combined): Line · 21% power',
    );
  });

  it('shows the strategy detail line under a CNC operation', async () => {
    seedLayers([createLayer({ id: 'red', color: '#ff0000' })], 'cnc');
    await render('cnc');

    // Two decisions meet on this line. ADR-258 defaults tabs ON, so the tab
    // configuration is reported rather than "tabs off". Audit 3.8 removes the
    // cut direction: the default cut type is profile-on-path (ADR-256), which
    // has no material side, so no direction applies and printing one was
    // inert noise.
    expect(host.textContent).toContain('1 pass · stepover 40% · tabs 4 per shape (6 × 2 mm)');
  });

  it('says beside the ramp which compiled relief stages plunge', async () => {
    const base = createLayer({ id: 'relief', color: '#a0522d' });
    seedLayers([{ ...base, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, rampEntryDeg: 5 } }], 'cnc');
    await render('cnc', [
      { layerId: 'relief', summaries: [], plungingReliefStages: ['relief-rough', 'relief-finish'] },
    ]);

    // ADR-273 Amendment 1: the layer ramps only its other shapes.
    expect(host.textContent).toContain('ramp entry 5° (relief passes plunge)');
  });

  // ADR-224 Amendment 3, end to end: the relief compiler's own output, read
  // back from the exact job the review shows.
  it('names the relief levels a relief-only operation cuts instead of its pass count and tabs', async () => {
    await renderCompiledReliefs([flatRelief('floor', 3, 0)]);

    // 1.5 mm per pass to the 3 mm floor, less the 0.5 mm roughing allowance.
    // The operation's 1 mm Cut depth and its tabs reach no relief.
    expect(cellTexts()).toContain(
      'relief roughing 2 levels to 2.5 mm · stepover 40% · Manual feeds',
    );
  });

  it('counts the depths across reliefs that share an operation', async () => {
    await renderCompiledReliefs([flatRelief('floor', 3, 0), flatRelief('deep', 5, 30)]);

    // 1.5 and 2.5 mm for the first relief; 1.5, 3 and 4.5 mm for the second.
    expect(cellTexts()).toContain(
      'relief roughing at 4 depths to 4.5 mm across 2 reliefs · stepover 40% · Manual feeds',
    );
  });

  it('reads relief levels from the emitted roughing passes beside the other shapes', async () => {
    seedLayers([createLayer({ id: 'relief', color: '#a0522d' })], 'cnc');
    const job: Job = {
      groups: [
        cncGroup('relief-rough', [
          ring(-1.5),
          // A ramped ring descends from the level above to its own.
          {
            kind: 'path3d',
            closed: false,
            points: [
              { x: 0, y: 0, z: -1.5 },
              { x: 10, y: 0, z: -2.5 },
              { x: 10, y: 10, z: -2.5 },
            ],
          },
          // A path that cannot be emitted cuts nothing.
          { kind: 'path3d', closed: false, points: [{ x: 0, y: 0, z: -4 }] },
        ]),
        // Finishing follows the surface; it adds no roughing level.
        cncGroup('relief-finish', [ring(-3)]),
        cncGroup('profile-on-path', [ring(-1)]),
      ],
    };
    await render('cnc', buildEffectiveOperationReview(job));

    expect(cellTexts()).toContain(
      'relief roughing 2 levels to 2.5 mm · 1 pass on the other shapes · stepover 40% · tabs 4 per shape (6 × 2 mm), none on reliefs · Manual feeds',
    );
  });
});
