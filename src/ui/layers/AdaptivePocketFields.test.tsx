import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { AdaptivePocketFields } from './AdaptivePocketFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});

describe('AdaptivePocketFields', () => {
  it('describes geometric engagement without implying live load feedback', async () => {
    const layer = createLayer({ id: 'adaptive', color: '#000000' });
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket' as const,
      pocketStrategy: 'adaptive' as const,
    };
    useStore.setState({ project: createProject() });
    useStore.getState().setMachineKind('cnc');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () =>
      root.render(<AdaptivePocketFields layer={layer} settings={settings} onCommit={vi.fn()} />),
    );

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Radial engagement for #000000"]',
    );
    expect(input?.title ?? '').toContain('Compile-time geometric radial-engagement limit');
    expect(input?.title ?? '').toContain(
      'does not measure live cutting force or spindle/axis load',
    );
    expect(input?.title ?? '').toContain('does not change feed automatically');
    expect(host.querySelector('[role="note"]')?.textContent).toContain(
      'no live load sensing or automatic feed adjustment',
    );
  });
});
