import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { CncLineArtContoursField } from './CncLineArtContoursField';

const layer = createLayer({ id: 'line-art', color: '#123456' });

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The field reads the scene from the store, so it renders into a live root.
async function render(): Promise<string> {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CncLineArtContoursField
        layer={layer}
        settings={{ ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-on-path' }}
        onCommit={() => undefined}
      />,
    ),
  );
  const html = host.innerHTML;
  await act(async () => root.unmount());
  return html;
}

function useArtwork(objects: ReturnType<typeof svgObj>[]): void {
  useStore.setState({ project: { ...createProject(), scene: { layers: [layer], objects } } });
}

afterEach(() => resetStore());

describe('traced-edge vocabulary', () => {
  it('uses the visible term in the control accessible name', async () => {
    useArtwork([{ ...svgObj('logo', ['#123456']), operationIds: [layer.id] }]);
    const html = await render();
    expect(html).toContain('Traced edges');
    expect(html).toContain('aria-label="Traced edges for #123456"');
  });

  // ADR-431: only imported and traced outlines pair (ADR-277), so the choice
  // stays out of the way for operations that cut nothing it could change.
  it('stays hidden when the operation cuts no imported or traced outline', async () => {
    useArtwork([]);
    expect(await render()).toBe('');
    useArtwork([
      {
        ...svgObj('font-outline', ['#123456']),
        operationIds: [layer.id],
        paths: svgObj('font-outline', ['#123456']).paths.map((path) => ({
          ...path,
          fillRule: 'nonzero' as const,
        })),
      },
    ]);
    expect(await render()).toBe('');
  });
});
