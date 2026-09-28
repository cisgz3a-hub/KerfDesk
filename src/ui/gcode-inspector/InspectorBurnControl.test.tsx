import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorBurnControl } from './InspectorBurnControl';
import type { LaserBurn } from './use-laser-burn';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(burn: LaserBurn): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  root = createRoot(host);
  act(() => root?.render(<InspectorBurnControl burn={burn} />));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function burn(patch: Partial<LaserBurn> = {}): LaserBurn {
  return {
    available: true,
    shown: true,
    onShownChange: vi.fn(),
    toolpathShown: false,
    onToolpathShownChange: vi.fn(),
    hidesToolpath: true,
    material: 'wood',
    onMaterialChange: vi.fn(),
    shadeBy: 'energy',
    onShadeByChange: vi.fn(),
    energy: {
      opticalPowerW: 20,
      assumedPower: false,
      beamMm: 0.09,
      fullDoseJPerMm2: 2,
      range: { min: 0.61, max: 2.4 },
    },
    wrap: null,
    fullPowerS: 1000,
    failed: false,
    ...patch,
  };
}

describe('the burn preview switches (ADR-501)', () => {
  it('shades by energy, says what it counts and shows the program on a scale', () => {
    const host = mount(burn());
    const text = host.textContent ?? '';
    expect(text).toContain('power × 20 W ÷ (speed × 0.09 mm beam)');
    expect(text).toContain('Wood burns fully at about 2 J/mm²');
    expect(text).toContain('this program puts in 0.61 J/mm² to 2.4 J/mm²');
    expect(text).toContain('Uncalibrated');
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      'This program from 0.61 J/mm² to 2.4 J/mm²; full burn at 2 J/mm²',
    );
  });

  it('says when it takes 10 W because the profile gives no laser power', () => {
    const host = mount(
      burn({
        material: 'height',
        energy: {
          opticalPowerW: 10,
          assumedPower: true,
          beamMm: 0.1,
          fullDoseJPerMm2: 2,
          range: null,
        },
      }),
    );
    const text = host.textContent ?? '';
    expect(text).toContain('10 W (taken, as the machine profile gives no laser power)');
    // The burn map shows the burn itself, burned as wood.
    expect(text).toContain('Wood burns fully at about 2 J/mm². ');
    expect(host.querySelector('[role="img"]')).toBeNull();
  });

  it('switches to power alone, as LightBurn shades', () => {
    const onShadeByChange = vi.fn();
    const host = mount(burn({ onShadeByChange }));
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Shade the burn by"]');
    if (select === null) throw new Error('no select');
    act(() => {
      select.value = 'power';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onShadeByChange).toHaveBeenCalledWith('power');
    act(() => root?.render(<InspectorBurnControl burn={burn({ shadeBy: 'power' })} />));
    expect(host.textContent).toContain('Darker the more power, S 1000 darkest.');
    expect(host.textContent).not.toContain('Uncalibrated');
  });
});
