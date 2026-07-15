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
import { runCncSupervisedRecoveryFlow } from './cnc-supervised-recovery-flow';
import { CncRecoveryPreviewWizard } from './CncRecoveryPreviewWizard';

vi.mock('./cnc-supervised-recovery-flow', () => ({
  runCncSupervisedRecoveryFlow: vi.fn(async () => true),
}));

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
  vi.mocked(runCncSupervisedRecoveryFlow).mockReset().mockResolvedValue(true);
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

function renderWizard(project = createProject()): {
  readonly checkpoint: ReturnType<typeof matchingCheckpoint>;
  readonly onClose: ReturnType<typeof vi.fn>;
} {
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
  const onClose = vi.fn();
  act(() => root.render(<CncRecoveryPreviewWizard checkpoint={checkpoint} onClose={onClose} />));
  unmount = () => root.unmount();
  return { checkpoint, onClose };
}

function wizardButton(label: string): HTMLButtonElement {
  const button = [...(host?.querySelectorAll('button') ?? [])].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected wizard button: ${label}`);
  }
  return button;
}

function chooseUncertaintyEvent(suffix = 'cut-2'): HTMLSelectElement {
  const selector = host?.querySelector<HTMLSelectElement>(
    'select[aria-label="First uncertain CNC contour segment"]',
  );
  if (!(selector instanceof HTMLSelectElement)) {
    throw new Error('Expected CNC uncertainty selector.');
  }
  const selected = [...selector.options].find((option) => option.value.endsWith(suffix));
  if (selected === undefined) throw new Error(`Expected uncertainty event ending in ${suffix}.`);
  act(() => {
    selector.value = selected.value;
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return selector;
}

function completePhysicalQualification(qualificationId: string): void {
  const qualification = host?.querySelector<HTMLInputElement>(
    'input[aria-label="CNC recovery runway qualification record"]',
  );
  if (!(qualification instanceof HTMLInputElement)) {
    throw new Error('Expected CNC recovery qualification input.');
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('Expected native input value setter.');
  act(() => {
    for (const checkbox of host?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ??
      []) {
      checkbox.click();
    }
    setter.call(qualification, qualificationId);
    qualification.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CncRecoveryPreviewWizard', () => {
  it('keeps execution gated until geometry and every physical qualification are explicit', async () => {
    const { checkpoint, onClose } = renderWizard(previewProject());
    expect(host?.textContent).toContain('Evidence audit');
    expect(host?.textContent).toContain('Controller acknowledgements');

    act(() => wizardButton('Next: Geometry').click());
    expect(host?.textContent).toContain('Select uncertainty and runway');
    chooseUncertaintyEvent();
    const physicalChecks = wizardButton('Next: Physical checks');
    expect(physicalChecks.disabled).toBe(false);

    act(() => physicalChecks.click());
    expect(host?.textContent).toContain('Physical requalification');
    const finalReview = wizardButton('Next: Final review');
    expect(finalReview.disabled).toBe(true);
    completePhysicalQualification('AIR-CUT-2026-07-15');
    expect(finalReview.disabled).toBe(false);
    act(() => finalReview.click());
    expect(host?.textContent).toContain('Final recovery-job review');
    const start = wizardButton('Start supervised recovery');
    expect(start.disabled).toBe(false);
    await act(async () => start.click());
    expect(runCncSupervisedRecoveryFlow).toHaveBeenCalledWith(
      checkpoint,
      expect.objectContaining({
        uncertaintyEventId: expect.stringContaining('cut-2'),
        qualificationId: 'AIR-CUT-2026-07-15',
        cutterClear: true,
        spindleStopped: true,
        positionRequalified: true,
        toolInspected: true,
        workholdingConfirmed: true,
        priorWorkConfirmed: true,
        clearedPathConfirmed: true,
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders matching-project event selection, SVG geometry, and runway metrics', () => {
    renderWizard(previewProject());
    act(() => wizardButton('Next: Geometry').click());
    const selector = chooseUncertaintyEvent();
    expect(selector.options.length).toBeGreaterThan(1);
    expect(
      host?.querySelector('svg[aria-label="Proposed CNC recovery runway and uncertainty segment"]'),
    ).toBeInstanceOf(SVGSVGElement);
    expect(host?.textContent).toContain('Required runway:');
    expect(host?.textContent).toContain('Available straight tangent:');
    expect(selector.value).toMatch(/cut-2$/);
  });
});
