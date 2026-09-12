import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TILING,
  type CncTiling,
} from '../../../core/scene';
import { prepareProjectForPersistence } from '../../../io/project/prepare-project-persistence';
import { DeviceSetupCncTilingFields } from './DeviceSetupCncTilingFields';

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => vi.unstubAllGlobals());

describe('registration authoring and persistence (O5)', () => {
  it('configures independent values, edits bore size/tool/depth, and preserves the plan while disabled', () => {
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: 'large',
      tools: [
        { id: 'large', name: '4 mm flat mill', kind: 'end-mill' as const, diameterMm: 4 },
        { id: 'small', name: '2 mm flat mill', kind: 'end-mill' as const, diameterMm: 2 },
      ],
    };
    const reference = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      depthMm: 0.02,
      depthPerPassMm: 0.01,
      feedMmPerMin: 612,
      plungeMmPerMin: 123,
      spindleRpm: 9000,
    };
    let current: CncTiling | undefined = DEFAULT_CNC_TILING;
    const changes: Array<CncTiling | undefined> = [];
    function Harness(): JSX.Element {
      const [tiling, setTiling] = useState(current);
      return (
        <DeviceSetupCncTilingFields
          machine={machine}
          referenceSettings={reference}
          tiling={tiling}
          onChange={(next) => {
            current = next;
            changes.push(next);
            setTiling(next);
          }}
        />
      );
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<Harness />));
    try {
      expect(changes).toHaveLength(0);
      const configure = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Configure registration',
      );
      expect(configure).toBeDefined();
      act(() => configure!.click());
      expect(current?.registration).toEqual({
        toolId: 'large',
        holeDiameterMm: 4,
        depthMm: 0.02,
        depthPerPassMm: 0.01,
        feedMmPerMin: 612,
        plungeMmPerMin: 123,
        spindleRpm: 9000,
      });
      const depth = container.querySelector<HTMLInputElement>('[aria-label="Registration depth"]')!;
      const changeCount = changes.length;
      act(() => {
        depth.focus();
        depth.blur();
      });
      expect(changes).toHaveLength(changeCount);
      const select = container.querySelector<HTMLSelectElement>(
        '[aria-label="Registration cutter"]',
      )!;
      act(() => {
        select.value = 'small';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      editNumber(container, 'Registration hole diameter', '3');
      editNumber(container, 'Registration depth', '3.7');
      editNumber(container, 'Registration depth per pass', '1.1');
      expect(current?.registration).toEqual({
        toolId: 'small',
        holeDiameterMm: 3,
        depthMm: 3.7,
        depthPerPassMm: 1.1,
        feedMmPerMin: 612,
        plungeMmPerMin: 123,
        spindleRpm: 9000,
      });
      const checkbox = container.querySelector<HTMLInputElement>(
        '[aria-label="Drill registration holes"]',
      )!;
      const savedPlan = current?.registration;
      act(() => checkbox.click());
      expect(current?.registrationHoles).toBe(false);
      expect(current?.registration).toEqual(savedPlan);
      const persisted = prepareProjectForPersistence({
        ...createProject(),
        machine: { ...machine, tiling: current! },
      });
      expect(persisted.kind).toBe('ok');
      if (persisted.kind === 'ok' && persisted.project.machine?.kind === 'cnc')
        expect(persisted.project.machine.tiling).toEqual(current);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

function editNumber(container: HTMLElement, label: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  act(() => {
    input.focus();
    input.blur();
  });
}
