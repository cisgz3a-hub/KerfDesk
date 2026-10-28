// ADR-675: Machine Setup's planner fields say how $120/$121 reach a diagonal.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlannerFields } from './PlannerAdvanced';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Motion layout', () => {
  it('shows the profile kinematics and reports a change', () => {
    const onKinematicsChange = vi.fn();
    act(() =>
      root.render(
        <PlannerFields
          accel={1000}
          kinematics="corexy"
          jd={0.01}
          cutTimeScale={1}
          travelTimeScale={1}
          onAccelChange={vi.fn()}
          onKinematicsChange={onKinematicsChange}
          onJdChange={vi.fn()}
          onCutTimeScaleChange={vi.fn()}
          onTravelTimeScaleChange={vi.fn()}
        />,
      ),
    );
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Motion layout"]');
    if (select === null) throw new Error('no Motion layout select');
    expect(select.value).toBe('corexy');
    expect([...select.options].map((option) => option.value)).toEqual(['cartesian', 'corexy']);
    act(() => {
      select.value = 'cartesian';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onKinematicsChange).toHaveBeenCalledWith('cartesian');
  });
});
