// Audit 2026-10-21 06-P2-4. Cut Settings refused to Apply when a value the app
// itself stores failed the dialog's native step or range check: a 37.5 %
// power or a 22.5° angle typed in the inspector, 12 in/min (304.8 mm/min), or a
// LightBurn layer's 33.3 mm/s speed, 12.5 % power, 0.125 mm kerf, 0.03 mm
// interval or converted overscan. The browser blocked Apply for an edit to
// another field. Each case stores the value through the real inline field or
// the real LightBurn importer, edits only Passes in Cut Settings, and checks
// that Apply went through, kept every stored value and changed only the pass
// count in the emitted program.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { captureLayerOperationSettings, type Layer, type Project } from '../../core/scene';
import { importLightBurnProject } from '../../io/lightburn/lbrn-import';
import { useStore } from '../state';
import { useDisplayUnitsStore } from '../state/display-units';
import { resetStore } from '../state/test-helpers';
import { edit, field, openAdvanced } from './__fixtures__/selected-operation-inspector';
import { emittedBurn } from './__fixtures__/operation-gcode';
import { SelectedOperationInspector } from './SelectedOperationInspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useDisplayUnitsStore.setState({ lengthUnit: 'mm' });
  resetStore();
  document.body.replaceChildren();
});

function lightBurn(setting: string): Project {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">${setting}
      <Shape Type="Rect" CutIndex="0" W="40" H="20"><XForm>1 0 0 1 100 100</XForm></Shape>
    </LightBurnProject>`,
    'badge.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result.project;
}

function load(project: Project): void {
  useStore.setState({
    project,
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

function Inspector(): JSX.Element {
  const objects = useStore((state) => state.project.scene.objects);
  return <SelectedOperationInspector objects={objects} selectionActive />;
}

async function inspect() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Inspector />));
  return { host, unmount: () => act(async () => root.unmount()) };
}

const operation = (): Layer => useStore.getState().project.scene.layers[0]!;

/** Opens Cut Settings, changes only Passes, and presses Apply. */
async function applyPassesOnly(host: HTMLElement, passes: number): Promise<void> {
  await openAdvanced(host);
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Cut settings passes"]');
  if (input === null || input.form === null) throw new Error('Cut Settings passes missing');
  const form = input.form;
  await act(async () => {
    // The prototype setter, as a browser does: React's tracker ignores a
    // value set on the element itself and would see no edit.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      String(passes),
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const blocked = [...form.querySelectorAll('input')]
    .filter((control) => !control.checkValidity())
    .map((control) => `${control.getAttribute('aria-label') ?? control.name}=${control.value}`);
  expect(blocked).toEqual([]);
  await act(async () => form.requestSubmit());
}

async function expectPassesOnlyApply(host: HTMLElement): Promise<void> {
  const before = captureLayerOperationSettings(operation());
  const burnBefore = emittedBurn(useStore.getState().project);
  await applyPassesOnly(host, 2);
  // Every stored value is kept exactly. (A Fill Apply on the operation also
  // writes explicit defaults for absent options, which compile the same.)
  expect(captureLayerOperationSettings(operation())).toMatchObject({ ...before, passes: 2 });
  const burnAfter = emittedBurn(useStore.getState().project);
  expect(burnAfter.feeds).toEqual(burnBefore.feeds);
  expect(burnAfter.powers).toEqual(burnBefore.powers);
  expect(burnAfter.cutMoves).toBe(2 * burnBefore.cutMoves);
}

describe('Cut Settings applies values the inspector stores', () => {
  it.each([
    ['Power', '37.5', { power: 37.5 }, 'mm'],
    ['Speed', '12', { speed: 304.8 }, 'in'],
  ] as const)('a typed %s of %s', async (label, typed, stored, unit) => {
    load(lightBurn(cutSetting('Cut')));
    useDisplayUnitsStore.setState({ lengthUnit: unit });
    const view = await inspect();
    try {
      await edit(field(view.host, label), typed);
      expect(operation()).toMatchObject(stored);
      await expectPassesOnlyApply(view.host);
      const burn = emittedBurn(useStore.getState().project);
      if ('power' in stored) expect(burn.powers).toEqual([375]);
      // Feeds of 1 mm/min and up are floored to whole numbers (feed-word.ts).
      else expect(burn.feeds).toEqual([304]);
    } finally {
      await view.unmount();
    }
  });

  it('a typed 22.5° fill angle', async () => {
    load(lightBurn(cutSetting('Scan', '<interval Value="0.1"/>')));
    const view = await inspect();
    try {
      await edit(field(view.host, 'Hatch angle'), '22.5');
      expect(operation().hatchAngleDeg).toBe(22.5);
      await expectPassesOnlyApply(view.host);
    } finally {
      await view.unmount();
    }
  });
});

describe('Cut Settings applies values a LightBurn project stores', () => {
  it('a Cut layer at 33.3 mm/s, 12.5 % and a 0.125 mm kerf', async () => {
    load(lightBurn(cutSetting('Cut', '<kerf Value="0.125"/>', '12.5', '33.3')));
    expect(operation()).toMatchObject({ power: 12.5, speed: 33.3 * 60, kerfOffsetMm: 0.125 });
    const view = await inspect();
    try {
      await expectPassesOnlyApply(view.host);
    } finally {
      await view.unmount();
    }
  });

  it('a Scan layer with a 0.03 mm interval, 22.5° angle and converted overscan', async () => {
    load(
      lightBurn(
        cutSetting(
          'Scan',
          '<interval Value="0.03"/><angle Value="22.5"/><overscan Value="1"/><overscanPercent Value="7.5"/>',
          '12.5',
          '33.3',
        ),
      ),
    );
    expect(operation()).toMatchObject({
      mode: 'fill',
      hatchSpacingMm: 0.03,
      hatchAngleDeg: 22.5,
      fillOverscanMm: 33.3 * 0.075,
    });
    const view = await inspect();
    try {
      await expectPassesOnlyApply(view.host);
    } finally {
      await view.unmount();
    }
  });
});

function cutSetting(type: string, fields = '', power = '40', speedMmSec = '100'): string {
  return `<CutSetting type="${type}"><index Value="0"/><name Value="Badge"/><maxPower Value="${power}"/><speed Value="${speedMmSec}"/>${fields}</CutSetting>`;
}
