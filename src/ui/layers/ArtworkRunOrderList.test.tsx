import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ArtworkRunOrderList } from './ArtworkRunOrderList';
import type { ArtworkRunOrderRowModel } from './artwork-run-order-view-model';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('ArtworkRunOrderList', () => {
  it('renders a bounded window for a 1000-job project', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <ArtworkRunOrderList
          rows={Array.from({ length: 1000 }, (_unused, index) => row(index + 1))}
          activeKey={null}
          machineKind="laser"
          reveal={null}
          onFocus={() => undefined}
          onMove={() => undefined}
          onEditSettings={() => undefined}
        />,
      ),
    );

    expect(host.querySelectorAll('article[aria-label^="Run "]').length).toBeLessThan(30);
    await act(async () => root.unmount());
    host.remove();
  });
});

function row(position: number): ArtworkRunOrderRowModel {
  return {
    key: `job-${position}`,
    objectIds: [`job-${position}`],
    position,
    name: `Job ${position}`,
    kindLabel: 'Vector artwork',
    colors: ['#2563eb'],
    dimensions: '10 × 10 mm',
    operationSummary: `Job ${position}`,
    settingsSummary: 'Line · 30% · 1000 mm/min · 1×',
    effectiveSteps: [position],
    output: true,
    shared: false,
  };
}
