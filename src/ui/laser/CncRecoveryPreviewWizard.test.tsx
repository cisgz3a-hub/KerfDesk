import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceJobCheckpoint, createJobCheckpoint } from '../../core/recovery';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { useStore } from '../state';
import { CncRecoveryPreviewWizard } from './CncRecoveryPreviewWizard';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let unmount: (() => void) | null = null;

afterEach(() => {
  act(() => unmount?.());
  host?.remove();
  host = null;
  unmount = null;
  useStore.setState({ project: createProject() });
});

function previewProject(): Project {
  const color = '#ff0000';
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'straight-path',
    source: 'straight.svg',
    bounds: { minX: 20, minY: 20, maxX: 80, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 20, y: 20 },
              { x: 40, y: 20 },
              { x: 60, y: 20 },
              { x: 80, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'layer-a', color }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-on-path' },
        },
      ],
    },
  };
}

function matchingCheckpoint(project: Project) {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected prepared CNC output.');
  const emitted = emitPreparedGcode(prepared);
  if (!emitted.preflight.ok) throw new Error('Expected valid CNC preflight.');
  return advanceJobCheckpoint(
    createJobCheckpoint({
      gcode: emitted.gcode,
      machineKind: 'cnc',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: '2026-07-14T12:00:00.000Z',
    }),
    3,
    '2026-07-14T12:00:00.000Z',
  );
}

function renderWizard(project = createProject()): void {
  useStore.setState({ project });
  const checkpoint =
    project.machine?.kind === 'cnc'
      ? matchingCheckpoint(project)
      : createJobCheckpoint({
          gcode: 'G21\nG90\nM30',
          machineKind: 'cnc',
          outputScope: DEFAULT_OUTPUT_SCOPE,
          nowIso: '2026-07-14T12:00:00.000Z',
        });
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<CncRecoveryPreviewWizard checkpoint={checkpoint} onClose={vi.fn()} />));
  unmount = () => root.unmount();
}

describe('CncRecoveryPreviewWizard', () => {
  it('contains evidence, geometry, and decision steps but no execution action', () => {
    renderWizard();
    expect(host?.textContent).toContain('Evidence audit');
    expect(host?.textContent).toContain('Controller acknowledgements');

    act(() => {
      [...(host?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent === 'Next: Geometry')
        ?.click();
    });
    expect(host?.textContent).toContain('Hypothetical runway geometry');

    act(() => {
      [...(host?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent === 'Next: Safety decision')
        ?.click();
    });
    expect(host?.textContent).toContain('Manual recovery remains required');
    const labels = [...(host?.querySelectorAll('button') ?? [])].map((button) =>
      button.textContent?.trim(),
    );
    expect(labels).not.toContain('Execute');
    expect(labels).not.toContain('Start spindle');
    expect(labels).not.toContain('Run recovery');
  });

  it('renders matching-project event selection, SVG geometry, and runway metrics', () => {
    renderWizard(previewProject());
    act(() => {
      [...(host?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent === 'Next: Geometry')
        ?.click();
    });
    const selector = host?.querySelector<HTMLSelectElement>(
      'select[aria-label="Hypothetical uncertainty segment"]',
    );
    expect(selector).toBeInstanceOf(HTMLSelectElement);
    expect(selector?.options.length).toBeGreaterThan(1);
    expect(
      host?.querySelector(
        'svg[aria-label="Hypothetical CNC recovery runway and uncertainty segment"]',
      ),
    ).toBeInstanceOf(SVGSVGElement);
    expect(host?.textContent).toContain('Required runway:');
    expect(host?.textContent).toContain('Available straight tangent:');

    const originalValue = selector?.value;
    const nextOption = [...(selector?.options ?? [])].find(
      (option) => option.value !== originalValue,
    );
    act(() => {
      if (selector !== null && selector !== undefined && nextOption !== undefined) {
        selector.value = nextOption.value;
        selector.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(selector?.value).toBe(nextOption?.value);
  });
});
