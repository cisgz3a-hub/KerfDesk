import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { useStore } from '../state';
import { CutsLayersPanel } from './CutsLayersPanel';
import { CncLayerFields } from './CncLayerFields';
import { arrangeTwo, button, click, input, layer, mount } from './control-audit-test-support';

async function openDisclosure(host: HTMLElement, label: string): Promise<void> {
  const summary = [...host.querySelectorAll('summary')].find((element) =>
    element.textContent?.trim().startsWith(label),
  );
  const details = summary?.closest('details');
  if (summary === undefined || details === null || details === undefined)
    throw new Error(`Missing disclosure: ${label}`);
  if (!details.open) await click(summary);
  expect(details.open).toBe(true);
}

describe('artwork control audit: cut settings', () => {
  it.each([
    ['line', ['visible', 'output', 'tabsEnabled', 'tabSkipInnerShapes']],
    ['fill', ['fillBidirectional', 'fillCrossHatch', 'allowUncalibratedBidirectionalScan']],
    [
      'image',
      ['negativeImage', 'imageBidirectional', 'passThrough', 'allowUncalibratedBidirectionalScan'],
    ],
  ] as const)('commits every %s advanced checkbox only on Apply settings', async (mode, fields) => {
    arrangeTwo();
    const id = layer(1).id;
    useStore.getState().setLayerParam(id, { mode });
    const before = layer(1);
    const host = await mount(<CutsLayersPanel />);
    await click(button(host, 'Advanced cut settings'));
    await openDisclosure(
      host,
      mode === 'line'
        ? 'Visibility & output'
        : mode === 'fill'
          ? 'Calibration override'
          : 'Image & calibration extras',
    );
    const expected: Record<string, boolean> = {};
    for (const field of fields) {
      const checkbox = input(host, `input[name="${field}"]`);
      expected[field] = !checkbox.checked;
      await click(checkbox);
    }
    expect(layer(1)).toBe(before);
    await click(button(host, 'Apply settings'));
    expect(layer(1)).toMatchObject(expected);
    expect(layer().visible).toBe(true);
    expect(layer().output).toBe(true);
  });

  it.each([
    ['image', 'Negative image', 'negativeImage'],
    ['image', 'Pass-through image', 'passThrough'],
  ] as const)(
    'commits the %s %s inline toggle to the selected operation',
    async (mode, label, field) => {
      arrangeTwo();
      useStore.getState().setLayerParam(layer(1).id, { mode });
      const before = layer(1)[field];
      const host = await mount(<CutsLayersPanel />);
      await openDisclosure(host, 'Image options');
      await click(input(host, `input[aria-label="${label} for selected objects"]`));
      expect(layer(1)[field]).toBe(!before);
    },
  );

  // Scan direction is a per-job speed/quality trade-off, so it has to stay on
  // the always-visible card. No disclosure is opened before the click, and the
  // control must not sit inside one.
  it.each([
    ['fill', 'Bidirectional fill', 'fillBidirectional'],
    ['image', 'Bidirectional image scan', 'imageBidirectional'],
  ] as const)(
    'exposes the %s scan-direction toggle without opening a disclosure',
    async (mode, label, field) => {
      arrangeTwo();
      useStore.getState().setLayerParam(layer(1).id, { mode });
      const before = layer(1)[field];
      const host = await mount(<CutsLayersPanel />);
      const checkbox = input(host, `input[aria-label="${label} for selected objects"]`);
      expect(checkbox.closest('details')).toBeNull();
      await click(checkbox);
      expect(layer(1)[field]).toBe(!before);
    },
  );

  it('makes color and global defaults and resets the live dialog from the saved color default', async () => {
    arrangeTwo();
    const id = layer(1).id;
    useStore.getState().setLayerParam(id, { power: 63, speed: 888 });
    const host = await mount(<CutsLayersPanel />);
    await click(button(host, 'Advanced cut settings'));
    await openDisclosure(host, 'Saved defaults');
    // The operation shows a palette color; the default belongs to its blue artwork.
    await click(button(host, 'Make Default for #0000ff'));
    expect(useStore.getState().layerDefaults.byColor['#0000ff']).toMatchObject({
      power: 63,
      speed: 888,
    });
    expect(useStore.getState().layerDefaults.byColor).not.toHaveProperty(layer(1).color);
    await click(button(host, 'Make Default for All'));
    expect(useStore.getState().layerDefaults.allColors).toMatchObject({ power: 63, speed: 888 });
    await act(async () => useStore.getState().setLayerParam(id, { power: 12, speed: 222 }));
    await openDisclosure(host, 'Saved defaults');
    await click(button(host, 'Reset to Default'));
    expect(layer(1)).toMatchObject({ power: 63, speed: 888 });
    expect(input(host, '[aria-label="Cut settings power"]').value).toBe('63');
    await click(button(host, 'Apply settings'));
    expect(layer(1).power).toBe(63);
  });

  it('removes custom profile lead radius and switches retract off in actual operation state', async () => {
    arrangeTwo();
    useStore.getState().setMachineKind('cnc');
    useStore.getState().setLayerParam(layer().id, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-outside',
        profileLead: { shape: 'arc', radiusMm: 6, sweepDeg: 45 },
      },
    });
    function Fields() {
      const target = useStore((state) => state.project.scene.layers[0]!);
      return <CncLayerFields layer={target} />;
    }
    const host = await mount(<Fields />);
    await openDisclosure(host, 'Entry & travel');
    const reset = [...host.querySelectorAll<HTMLButtonElement>('button')].find((element) =>
      element.textContent?.startsWith('Use cutter radius'),
    )!;
    await click(reset);
    expect(layer().cnc?.profileLead).toEqual({ shape: 'arc', sweepDeg: 45 });
    expect(host.textContent).not.toContain('Use cutter radius');
    await click(input(host, `input[aria-label="Retract between passes for ${layer().color}"]`));
    expect(layer().cnc?.retractBetweenPasses).toBe(false);
  });
});
