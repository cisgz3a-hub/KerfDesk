import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RotaryWrapPreview } from './RotaryWrapPreview';

it('shows both seam references and bounds limits without introducing any machine action', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <RotaryWrapPreview
          setup={{
            enabled: true,
            type: 'chuck',
            objectDiameterMm: 60,
            mmPerRotation: 360,
            reverseAxis: true,
          }}
          artwork={{ widthMm: 30, heightMm: Math.PI * 75 }}
          outputDescription="marlin / marlin-fan"
        />,
      ),
    );
    expect(host.querySelector('[aria-label="Unwrapped rotary surface and seam"]')).not.toBeNull();
    expect(host.textContent).toContain('Same seam');
    expect(host.textContent).toContain('125.0%');
    expect(host.textContent).toContain('Extends 47.12 mm');
    expect(host.textContent).toContain('Reverse mirrors traversal within the artwork extent');
    expect(host.textContent).toContain('does not establish controller or accessory compatibility');
    expect(host.textContent).toContain('marlin / marlin-fan');
    expect(host.querySelectorAll('button,input')).toHaveLength(0);
    expect(host.querySelector('rect[x="72"]')?.getAttribute('y')).toBe('30');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
